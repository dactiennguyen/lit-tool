//! Chat commands: history and sending one text message for a stored account.
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

use crate::accounts::{AccountRegistry, HxConfig};
use crate::hx::{self, HistoryPage, HistoryTarget, HxError, HxSecret, LoginTemplate};
use crate::lit::{self, LitError};

const SEND_TIMEOUT: Duration = Duration::from_secs(15);
/// Used when the token response has no `expires_in`.
const DEFAULT_TOKEN_TTL: Duration = Duration::from_secs(3600);
const MAX_TOKEN_TTL: Duration = Duration::from_secs(24 * 3600);

#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error(transparent)]
    Account(#[from] crate::accounts::AccountError),
    #[error(transparent)]
    Hx(#[from] HxError),
    #[error(transparent)]
    Lit(#[from] lit::CommandError),
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

#[derive(Default)]
pub struct HxTokens(Mutex<HashMap<Uuid, CachedToken>>);

fn fingerprint(config: &HxConfig, secret: &HxSecret) -> [u8; 32] {
    let mut h = Sha256::new();
    for part in [secret.template_b64.as_str(), secret.password.as_deref().unwrap_or(""), config.rest_base.as_deref().unwrap_or("")] {
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
        let map = self.0.lock().unwrap();
        map.get(&id).filter(|c| &c.fingerprint == fp && c.expires > Instant::now()).map(|c| c.token.clone())
    }

    fn put(&self, id: Uuid, fingerprint: [u8; 32], token: String, ttl: Duration) {
        self.0.lock().unwrap().insert(id, CachedToken { fingerprint, token, expires: Instant::now() + ttl });
    }

    fn forget(&self, id: Uuid) {
        self.0.lock().unwrap().remove(&id);
    }
}

/// Everything needed to talk to the IM server as one account.
struct Session {
    account_id: Uuid,
    config: HxConfig,
    secret: HxSecret,
    template: LoginTemplate,
}

/// Where the token came from: only a cached one is worth replacing on rejection.
#[derive(PartialEq)]
enum TokenSource {
    Configured,
    Cached,
    Fresh,
}

impl Session {
    async fn load(app: &tauri::AppHandle, account_id: Uuid) -> Result<Self> {
        let handle = app.clone();
        // The keychain read can block (or prompt), so keep it off the async workers.
        let (config, secret) =
            tauri::async_runtime::spawn_blocking(move || handle.state::<AccountRegistry>().hx_material(account_id))
                .await
                .map_err(|e| HxError::Invalid(format!("Lỗi nội bộ: {e}")))??;
        let template = hx::parse_template(&secret.template_b64)?;
        Ok(Self { account_id, config, secret, template })
    }

    fn rest_base(&self) -> &str {
        self.config.rest_base.as_deref().unwrap_or(hx::DEFAULT_REST_BASE)
    }

    async fn token(&self, app: &tauri::AppHandle) -> Result<(String, TokenSource)> {
        if let Some(t) = &self.secret.access_token {
            return Ok((t.clone(), TokenSource::Configured));
        }
        let Some(password) = &self.secret.password else {
            return Err(HxError::Invalid("Chưa có hxPwd hoặc access token".into()).into());
        };
        let tokens = app.state::<HxTokens>();
        let fp = fingerprint(&self.config, &self.secret);
        if let Some(t) = tokens.get(self.account_id, &fp) {
            return Ok((t, TokenSource::Cached));
        }
        let t = hx::request_user_token(&self.template.app_key, &self.template.username, password, self.rest_base()).await?;
        tokens.put(self.account_id, fp, t.access_token.clone(), token_ttl(t.expires_in));
        Ok((t.access_token, TokenSource::Fresh))
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
        rest_base: session.rest_base(),
        to: &conversation_id,
        conversation_type,
    };
    hx::history_request(&target, limit, cursor.as_deref())?; // validate before any network call
    let (token, source) = session.token(&app).await?;
    match hx::fetch_history(&target, &token, limit, cursor.as_deref()).await {
        // A cached token may have been revoked: a read can safely be repeated once with a new one.
        Err(HxError::Unauthorized) if source == TokenSource::Cached => {
            session.forget_token(&app);
            let (token, _) = session.token(&app).await?;
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
        let (host, port, template, message) = (&session.config.host, session.config.port, &session.template, &message);
        async move {
            let login = hx::build_login_frame(template, &token)?;
            hx::connect(host, port, &login, Some(message), SEND_TIMEOUT).await
        }
    };
    let (token, source) = session.token(&app).await?;
    let result = match send(token).await {
        // Rejected at login, so the message was never written: safe to try once with a new token.
        Err(HxError::Rejected { step: "login", .. }) if source == TokenSource::Cached => {
            session.forget_token(&app);
            let (token, _) = session.token(&app).await?;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn config(rest: Option<&str>) -> HxConfig {
        HxConfig {
            host: "127.0.0.1".into(),
            port: 6717,
            rest_base: rest.map(Into::into),
            app_key: "org1#app1".into(),
            username: "love_100".into(),
            auth: "password".into(),
        }
    }

    fn secret(pw: &str) -> HxSecret {
        HxSecret { template_b64: "T".into(), password: Some(pw.into()), access_token: None }
    }

    #[test]
    fn token_cache_misses_on_new_credentials_and_expiry() {
        let tokens = HxTokens::default();
        let id = Uuid::new_v4();
        let fp = fingerprint(&config(None), &secret("pw1"));
        tokens.put(id, fp, "tok".into(), Duration::from_secs(60));
        assert_eq!(tokens.get(id, &fp).as_deref(), Some("tok"));
        assert_eq!(tokens.get(id, &fingerprint(&config(None), &secret("pw2"))), None);
        assert_eq!(tokens.get(id, &fingerprint(&config(Some("https://x.easemob.com")), &secret("pw1"))), None);
        assert_eq!(tokens.get(Uuid::new_v4(), &fp), None);
        tokens.forget(id);
        assert_eq!(tokens.get(id, &fp), None);
        tokens.put(id, fp, "old".into(), Duration::ZERO);
        assert_eq!(tokens.get(id, &fp), None);
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
