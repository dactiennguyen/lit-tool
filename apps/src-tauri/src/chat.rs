//! Chat commands: connection check, history and sending one text message.
//!
//! The IM server (host, port, REST base, login template) is shared and comes
//! from the settings; each account brings its own IM username and password,
//! saved from its profile at login. The username replaces the one in the template.
//!
//! IM tokens obtained from the hxPwd are cached here, in memory only, so that
//! reading history does not request a new token every time. Neither the token
//! nor any other IM secret is ever returned to the webview.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::Manager;
use uuid::Uuid;

use crate::accounts::AccountRegistry;
use crate::hx::{self, HandshakeStep, HistoryPage, HistoryTarget, HxError, LoginTemplate};
use crate::lit::{self, LitError};
use crate::settings::SettingsStore;

const SEND_TIMEOUT: Duration = Duration::from_secs(15);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(8);
/// Used when the token response has no `expires_in`.
const DEFAULT_TOKEN_TTL: Duration = Duration::from_secs(3600);
const MAX_TOKEN_TTL: Duration = Duration::from_secs(24 * 3600);
/// After a failed token request, callers get the same error for this long
/// instead of asking again (e.g. a wrong hxPwd with one preview per conversation).
const TOKEN_FAILURE_TTL: Duration = Duration::from_secs(60);

#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error(transparent)]
    Account(#[from] crate::accounts::AccountError),
    #[error(transparent)]
    Hx(#[from] HxError),
    #[error(transparent)]
    Lit(#[from] lit::CommandError),
    #[error(transparent)]
    Settings(#[from] crate::settings::SettingsError),
}

impl From<LitError> for CommandError {
    fn from(e: LitError) -> Self {
        Self::Lit(e.into())
    }
}

impl Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

type Result<T> = std::result::Result<T, CommandError>;

// ---------- token cache ----------

struct CachedToken {
    /// Hash of the credentials the token was issued for: new credentials miss the cache.
    fingerprint: [u8; 32],
    token: String,
    expires: Instant,
}

/// A failed token request: credentials fingerprint, until when it is reused, error text.
type TokenFailure = ([u8; 32], Instant, String);

#[derive(Default)]
pub struct HxTokens {
    cache: Mutex<HashMap<Uuid, CachedToken>>,
    /// Held while a token is requested, so parallel reads (e.g. one preview per
    /// conversation) wait for one token instead of each requesting their own.
    fetching: tokio::sync::Mutex<()>,
    /// Last failed request per account.
    failures: Mutex<HashMap<Uuid, TokenFailure>>,
}

/// Everything a token depends on: a change to any of them misses the cache.
fn fingerprint(template_b64: &str, username: &str, password: &str, rest_base: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    for part in [template_b64, username, password, rest_base] {
        h.update(part.as_bytes());
        h.update([0]);
    }
    h.finalize().into()
}

fn token_ttl(expires_in: Option<u64>) -> Duration {
    // Renew well before the server-side expiry.
    expires_in.map_or(DEFAULT_TOKEN_TTL, |s| Duration::from_secs(s.saturating_mul(9) / 10)).min(MAX_TOKEN_TTL)
}

impl HxTokens {
    fn get(&self, id: Uuid, fp: &[u8; 32]) -> Option<String> {
        let map = self.cache.lock().unwrap();
        map.get(&id).filter(|c| &c.fingerprint == fp && c.expires > Instant::now()).map(|c| c.token.clone())
    }

    fn put(&self, id: Uuid, fingerprint: [u8; 32], token: String, ttl: Duration) {
        self.cache.lock().unwrap().insert(id, CachedToken { fingerprint, token, expires: Instant::now() + ttl });
    }

    fn forget(&self, id: Uuid) {
        self.cache.lock().unwrap().remove(&id);
    }

    fn recent_failure(&self, id: Uuid, fp: &[u8; 32]) -> Option<String> {
        let map = self.failures.lock().unwrap();
        map.get(&id).filter(|(f, until, _)| f == fp && *until > Instant::now()).map(|(_, _, e)| e.clone())
    }

    fn record(&self, id: Uuid, fp: [u8; 32], failure: Option<String>) {
        let mut map = self.failures.lock().unwrap();
        match failure {
            Some(e) => map.insert(id, (fp, Instant::now() + TOKEN_FAILURE_TTL, e)),
            None => map.remove(&id),
        };
    }
}

/// Everything needed to talk to the IM server as one account.
struct Session {
    account_id: Uuid,
    host: String,
    port: u16,
    rest_base: String,
    /// The shared template with this account's username.
    template: LoginTemplate,
    password: String,
    fingerprint: [u8; 32],
}

/// Where the token came from: only a cached one is worth replacing on rejection.
#[derive(PartialEq)]
enum TokenSource {
    Cached,
    Fresh,
}

impl Session {
    async fn load(app: &tauri::AppHandle, account_id: Uuid) -> Result<Self> {
        let handle = app.clone();
        // Keychain reads can block (or prompt), so keep them off the async workers.
        let (settings, template_b64, (username, password)) = tauri::async_runtime::spawn_blocking(move || {
            let settings = handle.state::<SettingsStore>();
            let template = settings.im_template()?;
            let im = handle.state::<AccountRegistry>().im_material(account_id)?;
            Ok::<_, CommandError>((settings.get(), template, im))
        })
        .await
        .map_err(|e| HxError::Invalid(format!("Lỗi nội bộ: {e}")))??;
        let template_b64 =
            template_b64.ok_or_else(|| HxError::Invalid("Chưa có login template: nhập trong Cài đặt › Server chat".into()))?;
        let template = hx::with_username(&hx::parse_template(&template_b64)?, &username)?;
        let fingerprint = fingerprint(&template_b64, &username, &password, &settings.im_rest_base);
        Ok(Self {
            account_id,
            host: settings.im_host,
            port: settings.im_port,
            rest_base: settings.im_rest_base,
            template,
            password,
            fingerprint,
        })
    }

    async fn token(&self, app: &tauri::AppHandle) -> Result<(String, TokenSource, Option<u64>)> {
        let tokens = app.state::<HxTokens>();
        let fp = self.fingerprint;
        if let Some(t) = tokens.get(self.account_id, &fp) {
            return Ok((t, TokenSource::Cached, None));
        }
        let _one_at_a_time = tokens.fetching.lock().await;
        // Another caller may have stored a token (or failed) while this one waited.
        if let Some(t) = tokens.get(self.account_id, &fp) {
            return Ok((t, TokenSource::Cached, None));
        }
        if let Some(e) = tokens.recent_failure(self.account_id, &fp) {
            return Err(HxError::Token(format!("{e} (thử lại sau ít phút)")).into());
        }
        let result =
            hx::request_user_token(&self.template.app_key, &self.template.username, &self.password, &self.rest_base).await;
        let failure = result.as_ref().err().map(|e| match e {
            HxError::Token(m) => m.clone(),
            other => other.to_string(),
        });
        tokens.record(self.account_id, fp, failure);
        let t = result?;
        tokens.put(self.account_id, fp, t.access_token.clone(), token_ttl(t.expires_in));
        Ok((t.access_token, TokenSource::Fresh, t.expires_in))
    }

    fn forget_token(&self, app: &tauri::AppHandle) {
        app.state::<HxTokens>().forget(self.account_id);
    }
}

// ---------- commands ----------

/// One page of `messageroaming` for a conversation, newest first. Read-only.
#[tauri::command]
pub async fn hx_history(
    app: tauri::AppHandle,
    account_id: Uuid,
    conversation_id: String,
    conversation_type: i64,
    cursor: Option<String>,
    limit: u32,
) -> Result<HistoryPage> {
    let session = Session::load(&app, account_id).await?;
    let target = HistoryTarget {
        app_key: &session.template.app_key,
        username: &session.template.username,
        rest_base: &session.rest_base,
        to: &conversation_id,
        conversation_type,
    };
    hx::history_request(&target, limit, cursor.as_deref())?; // validate before any network call
    let (token, source, _) = session.token(&app).await?;
    match hx::fetch_history(&target, &token, limit, cursor.as_deref()).await {
        // A cached token may have been revoked: a read can safely be repeated once with a new one.
        Err(HxError::Unauthorized) if source == TokenSource::Cached => {
            session.forget_token(&app);
            let (token, ..) = session.token(&app).await?;
            Ok(hx::fetch_history(&target, &token, limit, cursor.as_deref()).await?)
        }
        Err(HxError::Unauthorized) => {
            session.forget_token(&app);
            Err(HxError::Unauthorized.into())
        }
        other => Ok(other?),
    }
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SendOutcome {
    /// Server id from the ACK: the server accepted the message (not delivered or read).
    pub server_id: String,
    pub local_id: String,
    /// Set when the message was sent but a metadata write afterwards failed.
    /// The message must not be sent again because of it.
    pub metadata_error: Option<String>,
}

/// Sends exactly one text message over a fresh TCP login, waits for the server
/// ACK, then disconnects. With `first_contact`, the Litmatch metadata writes the
/// phone app makes for a new conversation follow (`accost_count`, `conversation`,
/// `conversation/source`). Nothing is retried after the message frame is written.
#[tauri::command]
pub async fn hx_send_text(
    app: tauri::AppHandle,
    account_id: Uuid,
    to: String,
    text: String,
    first_contact: bool,
) -> Result<SendOutcome> {
    if !lit::is_id(&to) {
        return Err(HxError::Invalid("IM ID người nhận không hợp lệ".into()).into());
    }
    hx::validate_text(&text)?;
    if first_contact && !app.state::<crate::settings::SettingsStore>().get().api_base_url.starts_with("https://") {
        return Err(LitError::Invalid("Hội thoại mới cần Base URL https để ghi thông tin hội thoại".into()).into());
    }
    let session = Session::load(&app, account_id).await?;
    if to == session.template.username {
        return Err(HxError::Invalid("Không gửi tin cho chính mình".into()).into());
    }
    let local_id = hx::new_local_id(crate::store::now_ms())?;
    let message =
        hx::build_text_message(&session.template.username, &to, &text, local_id, &Uuid::new_v4().to_string())?;

    let send = |token: String| {
        let (host, port, template, message) = (&session.host, session.port, &session.template, &message);
        async move {
            let login = hx::build_login_frame(template, &token)?;
            hx::connect(host, port, &login, Some(message), SEND_TIMEOUT).await
        }
    };
    let (token, source, _) = session.token(&app).await?;
    let result = match send(token).await {
        // Rejected at login, so the message was never written: safe to try once with a new token.
        Err(HxError::Rejected { step: "login", .. }) if source == TokenSource::Cached => {
            session.forget_token(&app);
            let (token, ..) = session.token(&app).await?;
            send(token).await
        }
        other => other,
    };
    if matches!(result, Err(HxError::Rejected { step: "login", .. })) {
        session.forget_token(&app);
    }
    let ack = result?.1.ok_or_else(|| HxError::SendUnknown("không có ACK".into()))?;

    let metadata_error = if first_contact {
        lit::sync_metadata(&app, account_id, &to, &lit::metadata_plan(true)).await.err().map(|e| e.to_string())
    } else {
        None
    };
    Ok(SendOutcome { server_id: ack.server_id, local_id: message.local_id, metadata_error })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub username: String,
    pub app_key: String,
    pub host: String,
    pub port: u16,
    /// Set when a new token was requested for this check.
    pub token_expires_in: Option<u64>,
    pub steps: Vec<HandshakeStep>,
}

/// Get a token, log in over TCP, run the followup and disconnect. Sends no chat.
#[tauri::command]
pub async fn hx_check_connection(app: tauri::AppHandle, account_id: Uuid) -> Result<CheckResult> {
    let session = Session::load(&app, account_id).await?;
    let (token, _, token_expires_in) = session.token(&app).await?;
    let login = hx::build_login_frame(&session.template, &token)?;
    let steps = match hx::connect_and_check(&session.host, session.port, &login, HANDSHAKE_TIMEOUT).await {
        Ok(steps) => steps,
        Err(e) => {
            if matches!(e, HxError::Rejected { step: "login", .. }) {
                session.forget_token(&app);
            }
            return Err(e.into());
        }
    };
    Ok(CheckResult {
        username: session.template.username.clone(),
        app_key: session.template.app_key.clone(),
        host: session.host.clone(),
        port: session.port,
        token_expires_in,
        steps,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fp(username: &str, password: &str, rest: &str) -> [u8; 32] {
        fingerprint("T", username, password, rest)
    }

    #[test]
    fn token_cache_misses_on_new_credentials_and_expiry() {
        let tokens = HxTokens::default();
        let id = Uuid::new_v4();
        let fp = fp("love_1", "pw1", "r");
        tokens.put(id, fp, "tok".into(), Duration::from_secs(60));
        assert_eq!(tokens.get(id, &fp).as_deref(), Some("tok"));
        assert_eq!(tokens.get(id, &fingerprint("T", "love_1", "pw2", "r")), None);
        assert_eq!(tokens.get(id, &fingerprint("T", "love_1", "pw1", "https://x.easemob.com")), None);
        assert_eq!(tokens.get(id, &fingerprint("T", "love_2", "pw1", "r")), None);
        assert_eq!(tokens.get(id, &fingerprint("T2", "love_1", "pw1", "r")), None);
        assert_eq!(tokens.get(Uuid::new_v4(), &fp), None);
        tokens.forget(id);
        assert_eq!(tokens.get(id, &fp), None);
        tokens.put(id, fp, "old".into(), Duration::ZERO);
        assert_eq!(tokens.get(id, &fp), None);
    }

    #[test]
    fn token_failures_are_remembered_briefly_per_credentials() {
        let tokens = HxTokens::default();
        let id = Uuid::new_v4();
        let fp = fp("love_1", "pw1", "r");
        assert_eq!(tokens.recent_failure(id, &fp), None);
        tokens.record(id, fp, Some("HTTP 401".into()));
        assert_eq!(tokens.recent_failure(id, &fp).as_deref(), Some("HTTP 401"));
        // New credentials are tried at once.
        assert_eq!(tokens.recent_failure(id, &fingerprint("T", "love_1", "pw2", "r")), None);
        tokens.record(id, fp, None);
        assert_eq!(tokens.recent_failure(id, &fp), None);
    }

    #[test]
    fn token_ttl_renews_early_and_is_capped() {
        assert_eq!(token_ttl(None), DEFAULT_TOKEN_TTL);
        assert_eq!(token_ttl(Some(1000)), Duration::from_secs(900));
        assert_eq!(token_ttl(Some(u64::MAX)), MAX_TOKEN_TTL);
    }

    #[test]
    fn send_outcome_contract() {
        let outcome = SendOutcome {
            server_id: "1234567890123456789".into(),
            local_id: "17314150001230042".into(),
            metadata_error: Some("user/conversation: Server từ chối (HTTP 200, result 9)".into()),
        };
        crate::lit_types::check_contract("send-outcome.json", serde_json::to_value(&outcome).unwrap());
    }
}
