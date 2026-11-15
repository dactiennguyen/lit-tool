//! Litmatch API client: request signing and response decoding.
//! Port of scripts/src/lit/request.ts, client.ts and crypto/{litsign,shadow}.ts.

use std::sync::OnceLock;
use std::time::Duration;

use aes::cipher::{BlockModeDecrypt, BlockModeEncrypt, KeyIvInit, block_padding::Pkcs7};
use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use hmac::{Hmac, KeyInit, Mac};
use md5::{Digest, Md5};
use serde::Serialize;
use sha2::Sha256;
use url::Url;

use crate::lit_types::{Conversation, ConversationList, FeedPage, OnlineUsersPage, UserProfile, Wallet, parse_data};

const LITSIGN_SALT: &str = "R@s9!bu8";
const STS_HMAC_KEY: &[u8] = b"I am your father";
const SHADOW_KEY_3: &[u8; 32] = b"f1c9208ccd8ef6d85c44b451da593cd4";
const API_PREFIX: &str = "/api/sns/v1/lit/";
const HTTP_TIMEOUT: Duration = Duration::from_secs(12);
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

/// Same order and values as COMMON_QUERY_DEFAULTS in scripts/src/lit/profile.ts.
const COMMON_QUERY: [(&str, &str); 8] = [
    ("app_source", "litmatch"),
    ("appid", "NxUUhRSQH3qPJmY2Vn/edRz4vrc="),
    ("lang", "vi"),
    ("loc", "US"),
    ("loctype", "0"),
    ("model", "Pixel 8 Pro"),
    ("net_type", "wifi"),
    ("os", "33"),
];

type Aes256CbcEnc = cbc::Encryptor<aes::Aes256>;
type Aes256CbcDec = cbc::Decryptor<aes::Aes256>;

#[derive(Debug, thiserror::Error)]
pub enum LitError {
    #[error("{0}")]
    Invalid(String),
    #[error("Không kết nối được server: {0}")]
    Network(String),
    #[error("Response vượt giới hạn 2 MiB")]
    TooLarge,
    #[error("Không giải mã được response hoặc request ID không khớp")]
    Decode,
    #[error("Server trả về dữ liệu không phải JSON (HTTP {0})")]
    NotJson(u16),
    #[error("Server từ chối (HTTP {status}, result {result}){}", message.as_deref().map(|m| format!(": {m}")).unwrap_or_default())]
    Rejected { status: u16, result: String, message: Option<String> },
    #[error("Response không đúng định dạng mong đợi: {0}")]
    Schema(String),
}

impl Serialize for LitError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

// ---------- signing ----------

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// `litSign` header: base64("1|" + md5hex(litTime + "1" + salt)).
pub fn lit_sign(lit_time_ms: u64) -> String {
    let digest = Md5::digest(format!("{lit_time_ms}1{LITSIGN_SALT}").as_bytes());
    STANDARD.encode(format!("1|{}", hex(&digest)))
}

/// `sts-sign` header: base64(hex(HMAC-SHA256(key, ts + "_" + uuid))).
pub fn sts_sign(ts: &str, uuid: &str) -> String {
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(STS_HMAC_KEY).expect("HMAC accepts any key length");
    mac.update(format!("{ts}_{uuid}").as_bytes());
    STANDARD.encode(hex(&mac.finalize().into_bytes()))
}

/// Shadow mode 3: AES-256-CBC, ciphertext followed by the IV, base64url without padding.
pub fn shadow_encode(text: &str, iv: [u8; 16]) -> String {
    let mut out = Aes256CbcEnc::new(SHADOW_KEY_3.into(), &iv.into()).encrypt_padded_vec::<Pkcs7>(text.as_bytes());
    out.extend_from_slice(&iv);
    URL_SAFE_NO_PAD.encode(out)
}

pub fn shadow_decode(value: &str) -> Result<String, LitError> {
    // Accept either base64 alphabet, with or without padding (like Node's Buffer).
    let normalized: String = value
        .trim()
        .trim_end_matches('=')
        .chars()
        .map(|c| match c {
            '+' => '-',
            '/' => '_',
            c => c,
        })
        .collect();
    let data = URL_SAFE_NO_PAD.decode(normalized).map_err(|_| LitError::Decode)?;
    if data.len() < 32 || data.len() % 16 != 0 {
        return Err(LitError::Decode);
    }
    let (ct, iv) = data.split_at(data.len() - 16);
    let iv: [u8; 16] = iv.try_into().map_err(|_| LitError::Decode)?;
    let plain = Aes256CbcDec::new(SHADOW_KEY_3.into(), &iv.into())
        .decrypt_padded_vec::<Pkcs7>(ct)
        .map_err(|_| LitError::Decode)?;
    String::from_utf8(plain).map_err(|_| LitError::Decode)
}

// ---------- requests ----------

/// Everything needed to sign a request for one account.
#[derive(Clone, Copy)]
pub struct LitProfile<'a> {
    pub sid: &'a str,
    pub uuid: &'a str,
    pub version: &'a str,
    pub user_id: Option<&'a str>,
    pub dfpid: Option<&'a str>,
    pub base_url: &'a str,
}

pub struct SignOptions {
    pub now_ms: u64,
    pub request_id: String,
    pub shadow_iv: [u8; 16],
}

impl SignOptions {
    pub fn fresh() -> Result<Self, LitError> {
        let mut iv = [0u8; 16];
        getrandom::fill(&mut iv).map_err(|e| LitError::Invalid(format!("Không tạo được số ngẫu nhiên: {e}")))?;
        Ok(Self { now_ms: crate::store::now_ms(), request_id: uuid::Uuid::new_v4().to_string(), shadow_iv: iv })
    }
}

#[derive(Debug)]
pub struct SignedRequest {
    pub url: Url,
    pub headers: Vec<(&'static str, String)>,
    pub request_id: String,
    /// Shadow-encoded JSON body; `Some` makes this a POST.
    pub body: Option<String>,
    /// The body before encoding, for the connection log.
    pub plain_body: Option<String>,
}

/// Each request gets a fresh X-SIUA; saved account tokens are not reused.
/// `query` comes first in the URL, then the common params, exactly like the TS version.
pub fn build_get(
    endpoint: &str,
    profile: &LitProfile,
    query: &[(&str, String)],
    opts: SignOptions,
) -> Result<SignedRequest, LitError> {
    let mut path = endpoint.to_owned();
    if path.contains(":id") {
        let id = profile.user_id.ok_or_else(|| LitError::Invalid("Account chưa có user ID".into()))?;
        path = path.replace(":id", id);
    }
    let mut url = Url::parse(profile.base_url)
        .and_then(|base| base.join(&format!("{API_PREFIX}{path}")))
        .map_err(|_| LitError::Invalid("Server API URL không hợp lệ".into()))?;
    {
        let mut q = url.query_pairs_mut();
        for (k, v) in query {
            q.append_pair(k, v);
        }
        for (k, v) in COMMON_QUERY {
            q.append_pair(k, v);
        }
        q.append_pair("uuid", profile.uuid);
        q.append_pair("version", profile.version);
        q.append_pair("platform", "android");
        q.append_pair("sid", profile.sid);
    }

    let ts = (opts.now_ms / 1000).to_string();
    let mut headers = vec![
        ("accept", "application/json".to_owned()),
        ("v-mode", "0".to_owned()),
        ("ts", ts.clone()),
        ("litTime", opts.now_ms.to_string()),
        ("litSign", lit_sign(opts.now_ms)),
        ("X-request-Id", opts.request_id.clone()),
        ("sts-sign", sts_sign(&ts, profile.uuid)),
        ("X-Application-Info", shadow_encode(url.query().unwrap_or(""), opts.shadow_iv)),
    ];
    if let Some(id) = profile.user_id {
        headers.push(("lit-user-id", id.to_owned()));
    }
    if let Some(dfpid) = profile.dfpid {
        headers.push(("X-DFPID", dfpid.to_owned()));
    }
    let siua = crate::siua::generate(opts.now_ms)
        .map_err(|_| LitError::Invalid("Không tạo được X-SIUA".into()))?;
    headers.push(("X-SIUA", siua));
    Ok(SignedRequest { url, headers, request_id: opts.request_id, body: None, plain_body: None })
}

pub(crate) fn is_id(v: &str) -> bool {
    !v.is_empty() && v.len() <= 128 && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Port of scripts/src/cli/user-info.ts: `:id` is the user being viewed, while
/// `lit-user-id` stays the account's own id (dropped when missing or the same).
pub fn build_user_info(profile: &LitProfile, target_id: &str, opts: SignOptions) -> Result<SignedRequest, LitError> {
    if !is_id(target_id) {
        return Err(LitError::Invalid("User ID cần xem không hợp lệ".into()));
    }
    let as_target = LitProfile { user_id: Some(target_id), ..*profile };
    let mut req = build_get("user/get_info/:id", &as_target, &[], opts)?;
    req.headers.retain(|(k, _)| *k != "lit-user-id");
    if let Some(own) = profile.user_id
        && own != target_id
    {
        req.headers.push(("lit-user-id", own.to_owned()));
    }
    Ok(req)
}

/// The IM metadata writes the phone app makes around a chat (scripts/src/hyphenate/metadata.ts).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MetadataStep {
    /// `user/accost_count`: only for a genuine first contact.
    AccostCount,
    /// `user/conversation`: registers the one-to-one conversation.
    Conversation,
    /// `user/conversation/source`
    Source,
}

impl MetadataStep {
    pub fn endpoint(self) -> &'static str {
        match self {
            Self::AccostCount => "user/accost_count",
            Self::Conversation => "user/conversation",
            Self::Source => "user/conversation/source",
        }
    }

    fn payload(self, to: &str) -> serde_json::Value {
        match self {
            Self::AccostCount => serde_json::json!({ "targetId": to }),
            Self::Conversation => serde_json::json!({ "conversation_id": to, "conversation_type": 0 }),
            Self::Source => serde_json::json!({ "source": "other", "target_user_id": to }),
        }
    }
}

/// Port of `metadataPlan`.
pub fn metadata_plan(first_contact: bool) -> Vec<MetadataStep> {
    let mut plan = Vec::with_capacity(3);
    if first_contact {
        plan.push(MetadataStep::AccostCount);
    }
    plan.extend([MetadataStep::Conversation, MetadataStep::Source]);
    plan
}

/// Port of `buildPostRequest`: the signed GET plus a shadow-encoded JSON body.
/// Writes go over https only, since the URL carries the sid.
pub fn build_post(step: MetadataStep, to: &str, profile: &LitProfile, opts: SignOptions) -> Result<SignedRequest, LitError> {
    if !is_id(to) {
        return Err(LitError::Invalid("IM ID người nhận không hợp lệ".into()));
    }
    let mut req = build_get(step.endpoint(), profile, &[], opts)?;
    if req.url.scheme() != "https" {
        return Err(LitError::Invalid("Request ghi dữ liệu chỉ gửi qua https".into()));
    }
    let mut iv = [0u8; 16];
    getrandom::fill(&mut iv).map_err(|e| LitError::Invalid(format!("Không tạo được số ngẫu nhiên: {e}")))?;
    req.headers.push(("Content-Type", "application/x-litatom-json; charset=UTF-8".to_owned()));
    let payload = step.payload(to).to_string();
    req.body = Some(shadow_encode(&payload, iv));
    req.plain_body = Some(payload);
    Ok(req)
}

/// The response body as text, decrypted when the `x-is-enc` flag says so.
fn response_text(status: u16, enc_flag: Option<&str>, body: &[u8], request_id: &str) -> Result<String, LitError> {
    let mut text = String::from_utf8_lossy(body).into_owned();
    if (200..300).contains(&status)
        && let Some(flag) = enc_flag
    {
        let flag = shadow_decode(flag)?;
        let (mode, id) = flag.split_at_checked(1).ok_or(LitError::Decode)?;
        if id != request_id || !matches!(mode, "0" | "1") {
            return Err(LitError::Decode);
        }
        if mode == "1" {
            text = shadow_decode(&text)?;
        }
    }
    Ok(text)
}

/// Port of the response handling in `fetchRequest` + `isLitAccepted`.
pub fn decode_response(
    status: u16,
    enc_flag: Option<&str>,
    body: &[u8],
    request_id: &str,
) -> Result<serde_json::Value, LitError> {
    let ok = (200..300).contains(&status);
    let text = response_text(status, enc_flag, body, request_id)?;
    let json: serde_json::Value = serde_json::from_str(&text).map_err(|_| LitError::NotJson(status))?;
    let success = json.get("success").and_then(|v| v.as_bool());
    let result = json.get("result").and_then(|v| v.as_i64());
    if ok && success == Some(true) && result == Some(0) {
        return Ok(json);
    }
    let message = ["message", "msg", "error"]
        .iter()
        .find_map(|k| json.get(*k).and_then(|v| v.as_str()))
        .map(str::to_owned);
    Err(LitError::Rejected {
        status,
        result: result.map(|r| r.to_string()).unwrap_or_else(|| "?".into()),
        message,
    })
}

/// One client for the whole app, so connections and TLS sessions are reused.
pub(crate) fn http_client() -> Result<&'static reqwest::Client, LitError> {
    static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .timeout(HTTP_TIMEOUT)
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|e| e.to_string())
        })
        .as_ref()
        .map_err(|e| LitError::Network(e.clone()))
}

/// Sends a signed GET, or a POST when the request has a body.
pub async fn send(req: SignedRequest, account_id: uuid::Uuid) -> Result<serde_json::Value, LitError> {
    let client = http_client()?;
    let mut builder = match req.body {
        Some(body) => client.post(req.url).body(body),
        None => client.get(req.url),
    };
    for (k, v) in &req.headers {
        builder = builder.header(*k, v);
    }
    let trace = crate::http::Trace { account_id: Some(account_id), service: "Litmatch API" };
    let enc_flag = |f: &crate::http::Fetched| f.headers.get("x-is-enc").and_then(|v| v.to_str().ok()).map(str::to_owned);
    // The log shows both bodies decrypted (secrets masked there).
    let plain_response = |f: &crate::http::Fetched| response_text(f.status, enc_flag(f).as_deref(), &f.body, &req.request_id).ok();
    // Errors never include the URL: it carries the sid.
    let response = crate::http::fetch_with(builder, MAX_RESPONSE_BYTES, trace, req.plain_body.as_deref(), plain_response)
        .await
        .map_err(|e| match e {
            crate::http::FetchError::Network(m) => LitError::Network(m),
            crate::http::FetchError::TooLarge => LitError::TooLarge,
        })?;
    decode_response(response.status, enc_flag(&response).as_deref(), &response.body, &req.request_id)
}

// ---------- tauri commands ----------

#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error(transparent)]
    Account(#[from] crate::accounts::AccountError),
    #[error(transparent)]
    Lit(#[from] LitError),
}

impl Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

/// Signed request for one stored account. The sid is read from the secret store here
/// and never leaves the backend.
pub(crate) async fn request_for_account(
    app: &tauri::AppHandle,
    account_id: uuid::Uuid,
    build: impl FnOnce(&LitProfile, SignOptions) -> Result<SignedRequest, LitError>,
) -> Result<serde_json::Value, CommandError> {
    use tauri::Manager;
    // The secret read touches the disk, so keep it off the async workers.
    let handle = app.clone();
    let (account, sid) = tauri::async_runtime::spawn_blocking(move || {
        handle.state::<crate::accounts::AccountRegistry>().with_session(account_id)
    })
    .await
    .map_err(|e| LitError::Invalid(format!("Lỗi nội bộ: {e}")))??;
    let base_url = app.state::<crate::settings::SettingsStore>().get().api_base_url;
    let profile = LitProfile {
        sid: &sid,
        uuid: &account.device_uuid,
        version: &account.version,
        user_id: account.user_id.as_deref(),
        dfpid: account.dfpid.as_deref(),
        base_url: &base_url,
    };
    let request = build(&profile, SignOptions::fresh()?)?;
    Ok(send(request, account_id).await?)
}

/// [`request_for_account`] with the response `data` parsed as `T` (see lit_types.rs).
async fn get_typed<T: serde::de::DeserializeOwned>(
    app: &tauri::AppHandle,
    account_id: uuid::Uuid,
    build: impl FnOnce(&LitProfile, SignOptions) -> Result<SignedRequest, LitError>,
) -> Result<T, CommandError> {
    let json = request_for_account(app, account_id, build).await?;
    Ok(parse_data(json)?)
}

/// Wallet balances (`account/account_info`).
#[tauri::command]
pub async fn lit_account_info(app: tauri::AppHandle, account_id: uuid::Uuid) -> Result<Wallet, CommandError> {
    get_typed(&app, account_id, |p, o| build_get("account/account_info", p, &[], o)).await
}

pub const ONLINE_PAGE_MAX: u32 = 50;
const ONLINE_START_MAX: u32 = 10_000;

/// Query for `home/online_users`, same params as scripts/src/cli/home-online.ts.
pub fn online_users_query(start_pos: u32, num: u32) -> Result<Vec<(&'static str, String)>, LitError> {
    if !(1..=ONLINE_PAGE_MAX).contains(&num) || start_pos > ONLINE_START_MAX {
        return Err(LitError::Invalid("Tham số phân trang không hợp lệ".into()));
    }
    Ok(vec![("start_pos", start_pos.to_string()), ("num", num.to_string()), ("from_page", "home".to_owned())])
}

#[tauri::command]
pub async fn lit_online_users(
    app: tauri::AppHandle,
    account_id: uuid::Uuid,
    start_pos: u32,
    num: u32,
) -> Result<OnlineUsersPage, CommandError> {
    let query = online_users_query(start_pos, num)?;
    get_typed(&app, account_id, |p, o| build_get("home/online_users", p, &query, o)).await
}

/// The feeds the app shows (the "Gợi ý" pages of `feed/feed_page_structure`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
pub enum FeedKind {
    /// Phổ biến: `feed/hq`.
    Trends,
    /// Kết bạn: `feed/sep_page_feeds/Associate`.
    Associate,
}

impl FeedKind {
    pub fn endpoint(self) -> &'static str {
        match self {
            Self::Trends => "feed/hq",
            Self::Associate => "feed/sep_page_feeds/Associate",
        }
    }
}

pub const FEED_PAGE_MAX: u32 = 50;
const FEED_START_MAX: u32 = 2_147_483_647;

/// Same bounds as `getForYouFeeds` in scripts/src/lit/api.ts.
pub fn feed_query(start_pos: u32, num: u32) -> Result<Vec<(&'static str, String)>, LitError> {
    if !(1..=FEED_PAGE_MAX).contains(&num) || start_pos > FEED_START_MAX {
        return Err(LitError::Invalid("Tham số phân trang không hợp lệ".into()));
    }
    Ok(vec![("start_pos", start_pos.to_string()), ("num", num.to_string())])
}

/// One page of a feed, as seen from one stored account. Read-only.
#[tauri::command]
pub async fn lit_feeds(
    app: tauri::AppHandle,
    account_id: uuid::Uuid,
    kind: FeedKind,
    start_pos: u32,
    num: u32,
) -> Result<FeedPage, CommandError> {
    let query = feed_query(start_pos, num)?;
    get_typed(&app, account_id, |p, o| build_get(kind.endpoint(), p, &query, o)).await
}

/// `user/get_info/:id` for another user, as seen from one stored account.
#[tauri::command]
pub async fn lit_user_info(
    app: tauri::AppHandle,
    account_id: uuid::Uuid,
    target_id: String,
) -> Result<UserProfile, CommandError> {
    get_typed(&app, account_id, |p, o| build_user_info(p, &target_id, o)).await
}

/// Query for `user/get_info/me`, same as scripts/src/cli/user-me.ts.
fn user_info_me_query() -> [(&'static str, String); 2] {
    [("from", "me".to_owned()), ("source", "me".to_owned())]
}

/// IM credentials inside the own profile (`data.huanxin`), when well-formed.
pub fn im_credentials(json: &serde_json::Value) -> Option<(String, String)> {
    let h = json.get("data")?.get("huanxin")?;
    let user = h.get("user_id")?.as_str()?;
    let password = h.get("password")?.as_str()?;
    (is_id(user) && !password.is_empty()).then(|| (user.to_owned(), password.to_owned()))
}

/// The account's own profile; this is the "Đăng nhập" check. The IM username and
/// password found in it are saved for chat (password in the secret store).
/// `UserProfile` has no field for the session token or the IM credentials, so
/// they cannot leave the backend (see lit_types.rs).
#[tauri::command]
pub async fn lit_user_info_me(app: tauri::AppHandle, account_id: uuid::Uuid) -> Result<UserProfile, CommandError> {
    use tauri::Manager;
    let query = user_info_me_query();
    let json = request_for_account(&app, account_id, |p, o| build_get("user/get_info/me", p, &query, o)).await?;
    if let Some((user, password)) = im_credentials(&json) {
        let handle = app.clone();
        let saved = tauri::async_runtime::spawn_blocking(move || {
            handle.state::<crate::accounts::AccountRegistry>().save_im_credentials(account_id, &user, &password)
        })
        .await;
        // Login itself succeeded; chat will report what is missing.
        match saved {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => eprintln!("could not save IM credentials: {e}"),
            Err(e) => eprintln!("could not save IM credentials: {e}"),
        }
    }
    Ok(parse_data(json)?)
}

/// `user/conversations`: the account's Litmatch conversation list. Entries
/// without a valid IM ID are dropped (see `ConversationList`).
#[tauri::command]
pub async fn lit_conversations(app: tauri::AppHandle, account_id: uuid::Uuid) -> Result<Vec<Conversation>, CommandError> {
    let list: ConversationList = get_typed(&app, account_id, |p, o| build_get("user/conversations", p, &[], o)).await?;
    Ok(list.into_valid())
}

/// Runs `plan` in order and stops at the first failure: no retries, since
/// a write whose outcome is unknown must not be repeated blindly.
pub(crate) async fn sync_metadata(
    app: &tauri::AppHandle,
    account_id: uuid::Uuid,
    to: &str,
    plan: &[MetadataStep],
) -> Result<(), CommandError> {
    for &step in plan {
        request_for_account(app, account_id, |p, o| build_post(step, to, p, o)).await.map_err(|e| match e {
            CommandError::Lit(e) => CommandError::Lit(LitError::Invalid(format!("{}: {e}", step.endpoint()))),
            other => other,
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected values generated from scripts/src (TypeScript) with the same inputs.
    const IV: [u8; 16] = [0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff];
    const REQ_ID: &str = "11111111-2222-4333-8444-555555555555";

    #[test]
    fn signatures_match_typescript() {
        assert_eq!(lit_sign(1731415000123), "MXwwMTIyOTE2ZDhlOTM5ZGY4MjA3NGI0MWI1YmE3NmViOQ==");
        assert_eq!(
            sts_sign("1731415000", "dev-uuid-1"),
            "N2ZiYjk0MzVkNGM5Njc2ZmNmNzljN2RkMmFjY2QyYTE0OWEzNzUyYjRjZDVmNGE5YzBkMTdjNjc0MWUzMmY0YQ=="
        );
        assert_eq!(shadow_encode("hello world", IV), "1rCeZHUJRv8sjIcKRCGkUwARIjNEVWZ3iJmqu8zd7v8");
        assert_eq!(shadow_decode("1rCeZHUJRv8sjIcKRCGkUwARIjNEVWZ3iJmqu8zd7v8").unwrap(), "hello world");
    }

    #[test]
    fn get_request_matches_typescript() {
        let profile = LitProfile {
            sid: "test-sid",
            uuid: "dev-uuid-1",
            version: "7.77.0",
            user_id: Some("u10"),
            dfpid: Some("DFP1"),
            base_url: "https://www.litatom.com",
        };
        let req = build_get(
            "account/account_info",
            &profile,
            &[],
            SignOptions { now_ms: 1731415000123, request_id: REQ_ID.into(), shadow_iv: IV },
        )
        .unwrap();
        assert_eq!(
            req.url.as_str(),
            "https://www.litatom.com/api/sns/v1/lit/account/account_info?app_source=litmatch&appid=NxUUhRSQH3qPJmY2Vn%2FedRz4vrc%3D&lang=vi&loc=US&loctype=0&model=Pixel+8+Pro&net_type=wifi&os=33&uuid=dev-uuid-1&version=7.77.0&platform=android&sid=test-sid"
        );
        let h: std::collections::HashMap<_, _> = req.headers.iter().cloned().collect();
        assert_eq!(h["ts"], "1731415000");
        assert_eq!(h["litTime"], "1731415000123");
        assert_eq!(h["X-request-Id"], REQ_ID);
        assert_eq!(h["lit-user-id"], "u10");
        assert_eq!(h["X-DFPID"], "DFP1");
        assert!(crate::siua::decode(&h["X-SIUA"]).starts_with("2.1}}1.9.9|1731415000123|"));
        assert_eq!(
            h["X-Application-Info"],
            "xCur9oYpgJGphl2g6aMtKmr5KmMg_oTAW8Wk0VgofiRCXB9cHNgZk6lTPiBTKrZBtywHpBuSzVaclga4iHzBTfDsMTMQN0tQoj06XtE3HavPtkGjoipjfU-6sI-jRUTeiBGR1BTyruyMEwLCfDESP_EiAzYqHRfXK2Oy3k9TAHAhju_lhNoGhBmhDQ7o9qMGYszhSqo2R0fmY9NGW3QHYJKC2oCQR-GWv1H8gQznEqjvbtESIZzXwvHzomPWsfudABEiM0RVZneImaq7zN3u_w"
        );
    }

    #[test]
    fn post_requests_match_typescript() {
        let profile = LitProfile {
            sid: "test-sid",
            uuid: "dev-uuid-1",
            version: "7.77.0",
            user_id: Some("u10"),
            dfpid: Some("DFP1"),
            base_url: "https://www.litatom.com",
        };
        let opts = || SignOptions { now_ms: 1731415000123, request_id: REQ_ID.into(), shadow_iv: IV };
        let cases = [
            (MetadataStep::Conversation, "user/conversation", r#"{"conversation_id":"love_200","conversation_type":0}"#),
            (MetadataStep::Source, "user/conversation/source", r#"{"source":"other","target_user_id":"love_200"}"#),
            (MetadataStep::AccostCount, "user/accost_count", r#"{"targetId":"love_200"}"#),
        ];
        for (step, endpoint, body) in cases {
            let req = build_post(step, "love_200", &profile, opts()).unwrap();
            assert_eq!(
                req.url.as_str(),
                format!("https://www.litatom.com/api/sns/v1/lit/{endpoint}?app_source=litmatch&appid=NxUUhRSQH3qPJmY2Vn%2FedRz4vrc%3D&lang=vi&loc=US&loctype=0&model=Pixel+8+Pro&net_type=wifi&os=33&uuid=dev-uuid-1&version=7.77.0&platform=android&sid=test-sid")
            );
            let h: std::collections::HashMap<_, _> = req.headers.iter().cloned().collect();
            assert_eq!(h["Content-Type"], "application/x-litatom-json; charset=UTF-8");
            assert_eq!(h["litSign"], "MXwwMTIyOTE2ZDhlOTM5ZGY4MjA3NGI0MWI1YmE3NmViOQ==");
            assert_eq!(h["lit-user-id"], "u10");
            // Body IV is random, so compare the decoded JSON (same key order as TS).
            assert_eq!(shadow_decode(req.body.as_deref().unwrap()).unwrap(), body);
        }
    }

    #[test]
    fn post_requests_validate_target_and_scheme() {
        let mut profile = LitProfile {
            sid: "s", uuid: "u", version: "1", user_id: None, dfpid: None, base_url: "https://www.litatom.com",
        };
        for bad in ["", "a b", "../x"] {
            assert!(build_post(MetadataStep::Conversation, bad, &profile, SignOptions::fresh().unwrap()).is_err());
        }
        profile.base_url = "http://127.0.0.1:9";
        assert!(build_post(MetadataStep::Conversation, "love_1", &profile, SignOptions::fresh().unwrap()).is_err());
        assert_eq!(metadata_plan(false), [MetadataStep::Conversation, MetadataStep::Source]);
        assert_eq!(metadata_plan(true)[0], MetadataStep::AccostCount);
    }

    #[test]
    fn online_users_request_matches_typescript() {
        let profile = LitProfile {
            sid: "test-sid", uuid: "dev-uuid-1", version: "7.77.0", user_id: None, dfpid: None,
            base_url: "https://www.litatom.com",
        };
        let query = online_users_query(15, 15).unwrap();
        let req = build_get(
            "home/online_users",
            &profile,
            &query,
            SignOptions { now_ms: 1731415000123, request_id: REQ_ID.into(), shadow_iv: IV },
        )
        .unwrap();
        assert_eq!(
            req.url.as_str(),
            "https://www.litatom.com/api/sns/v1/lit/home/online_users?start_pos=15&num=15&from_page=home&app_source=litmatch&appid=NxUUhRSQH3qPJmY2Vn%2FedRz4vrc%3D&lang=vi&loc=US&loctype=0&model=Pixel+8+Pro&net_type=wifi&os=33&uuid=dev-uuid-1&version=7.77.0&platform=android&sid=test-sid"
        );
        let app_info = &req.headers.iter().find(|(k, _)| *k == "X-Application-Info").unwrap().1;
        assert_eq!(
            app_info,
            "Q9DM8L5MGD4qpuBfpmNTgI60T_pDghemgQXKPXQzDrckl_7SIEK3F5a1oNkB2yRB2qOty9oRNzGPWyk7W-ccSkcdTZY9OdLr4LU5H2X7rClGMA6cayNW8PnPk3PLdLIYSepQJ-zS6Uvkgu8xKuF2dYln8ijhcdcBi7aVJ6lRBBS8oF87-V9WVzU832VolrhZ0NYlLfdQ9t0L-suXnu5pKhJGCl_f4HlIGHp9Fc-V7safW2VZwGlTKIT44mWLeBkeu0qRiBQmuyHbNQpqmfz7Y7YzCArPZB2WitzxqsmrM4QAESIzRFVmd4iZqrvM3e7_"
        );
    }

    #[test]
    fn user_info_request_matches_typescript() {
        let url = "https://www.litatom.com/api/sns/v1/lit/user/get_info/target-9?app_source=litmatch&appid=NxUUhRSQH3qPJmY2Vn%2FedRz4vrc%3D&lang=vi&loc=US&loctype=0&model=Pixel+8+Pro&net_type=wifi&os=33&uuid=dev-uuid-1&version=7.77.0&platform=android&sid=test-sid";
        let lit_user_id = |own: Option<&str>| {
            let profile = LitProfile {
                sid: "test-sid", uuid: "dev-uuid-1", version: "7.77.0", user_id: own, dfpid: None,
                base_url: "https://www.litatom.com",
            };
            let req = build_user_info(&profile, "target-9", SignOptions::fresh().unwrap()).unwrap();
            assert_eq!(req.url.as_str(), url);
            req.headers.iter().find(|(k, _)| *k == "lit-user-id").map(|(_, v)| v.clone())
        };
        assert_eq!(lit_user_id(Some("u10")).as_deref(), Some("u10"));
        assert_eq!(lit_user_id(Some("target-9")), None);
        assert_eq!(lit_user_id(None), None);
    }

    #[test]
    fn user_info_rejects_bad_target_ids() {
        let profile = LitProfile {
            sid: "s", uuid: "u", version: "1", user_id: None, dfpid: None, base_url: "https://www.litatom.com",
        };
        for bad in ["", "a/b", "../x", "a b", &"x".repeat(129)] {
            assert!(build_user_info(&profile, bad, SignOptions::fresh().unwrap()).is_err(), "{bad}");
        }
    }

    #[test]
    fn user_info_me_request_puts_from_source_first() {
        let profile = LitProfile {
            sid: "s", uuid: "u", version: "1", user_id: Some("u10"), dfpid: None,
            base_url: "https://www.litatom.com",
        };
        let req = build_get("user/get_info/me", &profile, &user_info_me_query(), SignOptions::fresh().unwrap()).unwrap();
        assert_eq!(req.url.path(), "/api/sns/v1/lit/user/get_info/me");
        assert!(req.url.query().unwrap().starts_with("from=me&source=me&app_source=litmatch&"));
        assert!(req.headers.iter().any(|(k, v)| *k == "lit-user-id" && v == "u10"));
    }

    #[test]
    fn reads_im_credentials_from_the_own_profile() {
        let json = serde_json::json!({ "data": { "huanxin": { "user_id": "love_1", "password": "pw" } } });
        assert_eq!(im_credentials(&json), Some(("love_1".into(), "pw".into())));
        for bad in [
            serde_json::json!({ "data": {} }),
            serde_json::json!({ "data": { "huanxin": { "user_id": "a b", "password": "pw" } } }),
            serde_json::json!({ "data": { "huanxin": { "user_id": "love_1", "password": "" } } }),
            serde_json::json!({ "data": { "huanxin": { "user_id": 5, "password": "pw" } } }),
        ] {
            assert_eq!(im_credentials(&bad), None);
        }
    }

    #[test]
    fn feed_requests_match_the_scripts() {
        assert!(feed_query(0, 0).is_err());
        assert!(feed_query(0, FEED_PAGE_MAX + 1).is_err());
        assert_eq!(feed_query(10, 20).unwrap(), [("start_pos", "10".to_owned()), ("num", "20".to_owned())]);
        let profile = LitProfile {
            sid: "s", uuid: "u", version: "1", user_id: Some("me"), dfpid: None,
            base_url: "https://www.litatom.com",
        };
        for (kind, path) in [(FeedKind::Trends, "/api/sns/v1/lit/feed/hq"), (FeedKind::Associate, "/api/sns/v1/lit/feed/sep_page_feeds/Associate")] {
            let req = build_get(kind.endpoint(), &profile, &feed_query(0, 20).unwrap(), SignOptions::fresh().unwrap()).unwrap();
            assert_eq!(req.url.path(), path);
            assert!(req.url.query().unwrap().starts_with("start_pos=0&num=20&"));
        }
        assert!(serde_json::from_str::<FeedKind>("\"Nearby\"").is_err());
    }

    #[test]
    fn online_users_query_is_bounded() {
        assert!(online_users_query(0, 0).is_err());
        assert!(online_users_query(0, ONLINE_PAGE_MAX + 1).is_err());
        assert!(online_users_query(10_001, 15).is_err());
        assert!(online_users_query(0, 15).is_ok());
    }

    #[test]
    fn siua_is_fresh_for_get_post_and_self_profile_with_stable_dfpid() {
        let profile = LitProfile {
            sid: "test-sid", uuid: "device-id", version: "7.77.0", user_id: Some("me"),
            dfpid: Some("cached-dfpid"), base_url: "https://www.litatom.com",
        };
        let before = crate::store::now_ms();
        let requests = [
            build_get("home/online_users", &profile, &[], SignOptions::fresh().unwrap()).unwrap(),
            build_get("home/online_users", &profile, &[], SignOptions::fresh().unwrap()).unwrap(),
            build_get("user/get_info/me", &profile, &user_info_me_query(), SignOptions::fresh().unwrap()).unwrap(),
            build_user_info(&profile, "me", SignOptions::fresh().unwrap()).unwrap(),
            build_post(MetadataStep::Conversation, "peer", &profile, SignOptions::fresh().unwrap()).unwrap(),
        ];
        let after = crate::store::now_ms();
        let mut tokens = std::collections::HashSet::new();
        for request in requests {
            let headers: std::collections::HashMap<_, _> = request.headers.iter().cloned().collect();
            assert_eq!(headers["X-DFPID"], "cached-dfpid");
            assert_eq!(request.headers.iter().filter(|(k, _)| *k == "X-SIUA").count(), 1);
            assert!(tokens.insert(headers["X-SIUA"].clone()));
            let plaintext = crate::siua::decode(&headers["X-SIUA"]);
            let metadata: Vec<_> = plaintext.split("}}").nth(1).unwrap().split('|').collect();
            let timestamp = metadata[1].parse::<u64>().unwrap();
            assert!((before..=after).contains(&timestamp));
            assert_eq!(metadata[1], headers["litTime"]);
            assert_eq!(uuid::Uuid::parse_str(metadata[2]).unwrap().get_version_num(), 4);
            assert_ne!(metadata[2], request.request_id);
        }
    }

    #[test]
    fn time_headers_preserve_milliseconds_and_floor_seconds() {
        let profile = LitProfile {
            sid: "test-sid", uuid: "device-id", version: "7.77.0", user_id: None,
            dfpid: None, base_url: "https://www.litatom.com",
        };
        for (now_ms, seconds) in [(1731415000999, "1731415000"), (1731415001000, "1731415001"), (1731415001001, "1731415001")] {
            let request = build_get("account/account_info", &profile, &[], SignOptions {
                now_ms, request_id: REQ_ID.into(), shadow_iv: IV,
            }).unwrap();
            let headers: std::collections::HashMap<_, _> = request.headers.into_iter().collect();
            assert_eq!(headers["ts"], seconds);
            assert_eq!(headers["litTime"], now_ms.to_string());
            assert!(crate::siua::decode(&headers["X-SIUA"]).starts_with(&format!("2.1}}}}1.9.9|{now_ms}|")));
        }
    }

    #[test]
    #[ignore = "requires Node.js 22.18+; offline Rust-to-Node interoperability check"]
    fn generated_headers_interoperate_with_node() {
        use std::io::Write;
        use std::process::{Command, Stdio};

        let profile = LitProfile {
            sid: "synthetic-session", uuid: "synthetic-device", version: "7.77.0", user_id: Some("me"),
            dfpid: Some("synthetic-dfpid"), base_url: "https://www.litatom.com",
        };
        let fresh = SignOptions::fresh().unwrap().now_ms;
        let mut samples = Vec::new();
        for now_ms in [1731415000999, 1731415001000, 1731415001001, fresh, fresh] {
            for method in ["GET", "POST"] {
                let opts = SignOptions { now_ms, request_id: uuid::Uuid::new_v4().to_string(), shadow_iv: IV };
                let request = if method == "GET" {
                    build_get("user/get_info/me", &profile, &user_info_me_query(), opts)
                } else {
                    build_post(MetadataStep::Conversation, "peer", &profile, opts)
                }.unwrap();
                samples.push(serde_json::json!({
                    "nowMs": now_ms, "method": method, "url": request.url.as_str(),
                    "headers": request.headers, "body": request.body, "plainBody": request.plain_body,
                }));
            }
        }
        let fixture = serde_json::json!({ "fresh": fresh, "samples": samples });
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let mut child = Command::new("node")
            .arg(manifest.join("tests/verify-lit-headers.mjs"))
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .spawn().expect("Node.js 22.18+ is required for this opt-in test");
        child.stdin.take().unwrap().write_all(fixture.to_string().as_bytes()).unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success(), "Node verification failed: {}", String::from_utf8_lossy(&output.stderr));
        println!("{}", String::from_utf8_lossy(&output.stdout));
    }

    #[test]
    fn optional_headers_are_omitted() {
        let profile = LitProfile {
            sid: "s", uuid: "u", version: "1", user_id: None, dfpid: None,
            base_url: "http://127.0.0.1:9",
        };
        let req = build_get("account/account_info", &profile, &[], SignOptions::fresh().unwrap()).unwrap();
        assert!(req.headers.iter().all(|(k, _)| !matches!(*k, "lit-user-id" | "X-DFPID")));
        assert_eq!(req.headers.iter().filter(|(k, _)| *k == "X-SIUA").count(), 1);
        assert!(build_get("user/get_info/:id", &profile, &[], SignOptions::fresh().unwrap()).is_err());
    }

    #[test]
    fn decodes_plain_and_encrypted_responses() {
        let ok = br#"{"success":true,"result":0,"data":{"nickname":"A"}}"#;
        assert_eq!(decode_response(200, None, ok, REQ_ID).unwrap()["data"]["nickname"], "A");

        let flag = "S5Cksg4yaV1EJ0eCEzrmro5_akF7P3vwS8MIRu89z0VuL_SXd7SM4XxOEAi0UyGzABEiM0RVZneImaq7zN3u_w";
        let body = shadow_encode(std::str::from_utf8(ok).unwrap(), IV);
        assert_eq!(decode_response(200, Some(flag), body.as_bytes(), REQ_ID).unwrap()["data"]["nickname"], "A");
        assert!(matches!(decode_response(200, Some(flag), body.as_bytes(), "other-id"), Err(LitError::Decode)));
    }

    #[test]
    fn rejected_responses_carry_server_message() {
        let err = decode_response(200, None, br#"{"success":false,"result":9,"message":"sid expired"}"#, REQ_ID)
            .unwrap_err();
        assert_eq!(err.to_string(), "Server từ chối (HTTP 200, result 9): sid expired");
        assert!(matches!(decode_response(502, None, b"<html>", REQ_ID), Err(LitError::NotJson(502))));
    }
}
