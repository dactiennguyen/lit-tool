//! Hyphenate (Easemob) IM: token request and the TCP login handshake.
//! Port of scripts/src/hyphenate/{fields,template,token,connection}.ts and the
//! handshake half of message.ts. Sending messages is not ported yet.

use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

pub const DEFAULT_IM_PORT: u16 = 6717;
pub const DEFAULT_REST_BASE: &str = "https://a1-sgp-ga.easemob.com";
const MAX_TEMPLATE_B64: usize = 65_536;
const MAX_FRAME_BYTES: usize = 1024 * 1024;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(8);
/// Sent after a successful login, before the session is usable.
const FOLLOWUP_FRAME: [u8; 12] = [0, 0, 0, 8, 0x08, 0x00, 0x40, 0x01, 0x4a, 0x00, 0x58, 0x00];

#[derive(Debug, thiserror::Error)]
pub enum HxError {
    #[error("{0}")]
    Invalid(String),
    #[error("Login template không hợp lệ: {0}")]
    Template(String),
    #[error("Lấy token Hyphenate thất bại: {0}")]
    Token(String),
    #[error("Kết nối TCP thất bại: {0}")]
    Tcp(String),
    #[error("Hết thời gian chờ bắt tay với server chat")]
    Timeout,
    #[error("Server chat từ chối bước {step} (type={kind}, code={code})")]
    Rejected { step: &'static str, kind: String, code: String },
}

impl Serialize for HxError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

type Result<T> = std::result::Result<T, HxError>;

// ---------- minimal protobuf wire format (keeps unknown fields) ----------

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Varint(u64),
    Fixed64(u64),
    Bytes(Vec<u8>),
    Fixed32(u32),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Field {
    pub number: u32,
    pub value: Value,
}

impl Value {
    /// Same text as `String(getField(...))` in the TS code.
    fn text(&self) -> String {
        match self {
            Value::Varint(v) | Value::Fixed64(v) => v.to_string(),
            Value::Fixed32(v) => v.to_string(),
            Value::Bytes(b) => String::from_utf8_lossy(b).into_owned(),
        }
    }
}

fn read_varint(buf: &[u8], pos: &mut usize) -> Result<u64> {
    let mut out = 0u64;
    for shift in (0..64).step_by(7) {
        let b = *buf.get(*pos).ok_or_else(|| HxError::Template("protobuf bị cắt cụt".into()))?;
        *pos += 1;
        out |= u64::from(b & 0x7f) << shift;
        if b & 0x80 == 0 {
            return Ok(out);
        }
    }
    Err(HxError::Template("varint quá dài".into()))
}

fn take<'a>(buf: &'a [u8], pos: &mut usize, n: usize) -> Result<&'a [u8]> {
    let end = pos.checked_add(n).filter(|&e| e <= buf.len()).ok_or_else(|| HxError::Template("protobuf bị cắt cụt".into()))?;
    let out = &buf[*pos..end];
    *pos = end;
    Ok(out)
}

pub fn read_fields(buf: &[u8]) -> Result<Vec<Field>> {
    let mut pos = 0;
    let mut fields = Vec::new();
    while pos < buf.len() {
        let tag = read_varint(buf, &mut pos)? as u32; // protobufjs reads the tag as uint32
        let number = tag >> 3;
        if number == 0 {
            return Err(HxError::Template("field number 0".into()));
        }
        let value = match tag & 7 {
            0 => Value::Varint(read_varint(buf, &mut pos)?),
            1 => Value::Fixed64(u64::from_le_bytes(take(buf, &mut pos, 8)?.try_into().unwrap())),
            2 => {
                let len = usize::try_from(read_varint(buf, &mut pos)?).map_err(|_| HxError::Template("độ dài sai".into()))?;
                Value::Bytes(take(buf, &mut pos, len)?.to_vec())
            }
            5 => Value::Fixed32(u32::from_le_bytes(take(buf, &mut pos, 4)?.try_into().unwrap())),
            w => return Err(HxError::Template(format!("wire type {w} không hỗ trợ"))),
        };
        fields.push(Field { number, value });
    }
    Ok(fields)
}

fn write_varint(out: &mut Vec<u8>, mut v: u64) {
    while v >= 0x80 {
        out.push((v as u8) | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

pub fn write_fields(fields: &[Field]) -> Vec<u8> {
    let mut out = Vec::new();
    for f in fields {
        let wire = match f.value {
            Value::Varint(_) => 0,
            Value::Fixed64(_) => 1,
            Value::Bytes(_) => 2,
            Value::Fixed32(_) => 5,
        };
        write_varint(&mut out, u64::from(f.number << 3 | wire));
        match &f.value {
            Value::Varint(v) => write_varint(&mut out, *v),
            Value::Fixed64(v) => out.extend_from_slice(&v.to_le_bytes()),
            Value::Bytes(b) => {
                write_varint(&mut out, b.len() as u64);
                out.extend_from_slice(b);
            }
            Value::Fixed32(v) => out.extend_from_slice(&v.to_le_bytes()),
        }
    }
    out
}

fn get(fields: &[Field], number: u32) -> Option<&Value> {
    fields.iter().find(|f| f.number == number).map(|f| &f.value)
}

fn bytes_field(fields: &[Field], number: u32) -> Result<&[u8]> {
    match get(fields, number) {
        Some(Value::Bytes(b)) => Ok(b),
        _ => Err(HxError::Template(format!("thiếu bytes field {number}"))),
    }
}

fn replace_bytes(fields: &mut [Field], number: u32, value: Vec<u8>) -> Result<()> {
    let field = fields
        .iter_mut()
        .find(|f| f.number == number && matches!(f.value, Value::Bytes(_)))
        .ok_or_else(|| HxError::Template(format!("thiếu bytes field {number}")))?;
    field.value = Value::Bytes(value);
    Ok(())
}

fn frame(payload: &[u8]) -> Vec<u8> {
    let mut out = (payload.len() as u32).to_be_bytes().to_vec();
    out.extend_from_slice(payload);
    out
}

// ---------- login template ----------

/// Account-specific login frame captured from the real app.
#[derive(Debug, Clone)]
pub struct LoginTemplate {
    pub payload: Vec<u8>,
    pub app_key: String,
    pub username: String,
}

/// Port of `loadTemplate` (minus host/port, which are stored separately).
pub fn parse_template(b64: &str) -> Result<LoginTemplate> {
    let b64 = b64.trim();
    if b64.is_empty() || b64.len() > MAX_TEMPLATE_B64 {
        return Err(HxError::Template("thiếu hoặc quá dài".into()));
    }
    let payload = STANDARD.decode(b64).map_err(|_| HxError::Template("base64 sai".into()))?;
    if STANDARD.encode(&payload) != b64 {
        return Err(HxError::Template("base64 không chuẩn".into()));
    }
    let outer = read_fields(&payload)?;
    if get(&outer, 8).map(Value::text).as_deref() != Some("3") {
        return Err(HxError::Template("không phải frame đăng nhập".into()));
    }
    let identity = read_fields(bytes_field(&outer, 2)?)?;
    let text = |n| String::from_utf8(bytes_field(&identity, n)?.to_vec()).map_err(|_| HxError::Template("UTF-8 sai".into()));
    let (app_key, username) = (text(1)?, text(2)?);
    if !is_app_key(&app_key) || !is_id(&username) {
        return Err(HxError::Template("appKey hoặc username sai định dạng".into()));
    }
    Ok(LoginTemplate { payload, app_key, username })
}

/// Port of `buildLoginFrame`: only `token` inside the auth JSON changes.
pub fn build_login_frame(template: &LoginTemplate, access_token: &str) -> Result<Vec<u8>> {
    if access_token.is_empty() {
        return Err(HxError::Invalid("Thiếu access token Hyphenate".into()));
    }
    let mut outer = read_fields(&template.payload)?;
    let mut body = read_fields(bytes_field(&outer, 9)?)?;
    let mut auth: serde_json::Map<String, serde_json::Value> =
        serde_json::from_slice(bytes_field(&body, 18)?).map_err(|_| HxError::Template("auth JSON sai".into()))?;
    auth.insert("token".into(), access_token.into());
    replace_bytes(&mut body, 18, serde_json::to_vec(&auth).expect("map serializes"))?;
    replace_bytes(&mut outer, 9, write_fields(&body))?;
    Ok(frame(&write_fields(&outer)))
}

fn is_id(v: &str) -> bool {
    !v.is_empty() && v.len() <= 128 && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn is_app_key(v: &str) -> bool {
    matches!(v.split_once('#'), Some((org, app)) if is_id(org) && is_id(app))
}

/// IM host: an IP or a plain hostname, like the TS check.
pub fn validate_host(host: &str) -> Result<String> {
    let host = host.trim();
    let ok = host.parse::<std::net::IpAddr>().is_ok()
        || (!host.is_empty()
            && host.len() <= 253
            && host.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-'));
    if ok { Ok(host.to_owned()) } else { Err(HxError::Invalid("IM host không hợp lệ".into())) }
}

/// Port of `easemobOrigin`: https, an easemob.com host, port 443, no credentials.
pub fn easemob_origin(raw: &str) -> Result<String> {
    let invalid = || HxError::Invalid("REST base phải là https://…easemob.com".into());
    let url = url::Url::parse(raw.trim()).map_err(|_| invalid())?;
    let host = url.host_str().unwrap_or_default();
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|p| p != 443)
        || !(host == "easemob.com" || host.ends_with(".easemob.com"))
    {
        return Err(invalid());
    }
    Ok(url.origin().ascii_serialization())
}

// ---------- token ----------

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Token {
    #[serde(skip)]
    pub access_token: String,
    pub expires_in: Option<u64>,
}

/// Port of `requestUserToken`. The password is never put in an error.
pub async fn request_user_token(app_key: &str, username: &str, password: &str, rest_base: &str) -> Result<Token> {
    let (org, app) = app_key.split_once('#').filter(|_| is_app_key(app_key)).ok_or_else(|| HxError::Invalid("App key sai".into()))?;
    if username.is_empty() || password.is_empty() {
        return Err(HxError::Invalid("Cần username và hxPwd để lấy token".into()));
    }
    let origin = easemob_origin(rest_base)?;
    let client = crate::lit::http_client().map_err(|e| HxError::Token(e.to_string()))?;
    let net = |e: reqwest::Error| HxError::Token(e.without_url().to_string());
    let mut response = client
        .post(format!("{origin}/{org}/{app}/token"))
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .body(serde_json::json!({ "grant_type": "password", "username": username, "password": password }).to_string())
        .send()
        .await
        .map_err(net)?;
    let status = response.status();
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(net)? {
        if body.len() + chunk.len() > MAX_FRAME_BYTES {
            return Err(HxError::Token("response vượt 1 MiB".into()));
        }
        body.extend_from_slice(&chunk);
    }
    let data: serde_json::Value =
        serde_json::from_slice(&body).map_err(|_| HxError::Token(format!("JSON không hợp lệ (HTTP {})", status.as_u16())))?;
    match data.get("access_token").and_then(|v| v.as_str()) {
        Some(t) if status.is_success() && !t.is_empty() => {
            Ok(Token { access_token: t.to_owned(), expires_in: data.get("expires_in").and_then(|v| v.as_u64()) })
        }
        _ => Err(HxError::Token(format!("HTTP {}", status.as_u16()))),
    }
}

// ---------- TCP handshake ----------

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HandshakeStep {
    pub step: &'static str,
    #[serde(rename = "type")]
    pub kind: String,
    pub code: String,
    pub accepted: bool,
}

/// Port of `readResponse`.
fn read_response(payload: &[u8], step: &'static str) -> Result<HandshakeStep> {
    let outer = read_fields(payload)?;
    let body = read_fields(bytes_field(&outer, 9)?)?;
    let status = read_fields(bytes_field(&body, if step == "login" { 8 } else { 1 })?)?;
    let kind = get(&outer, 8).map(Value::text).unwrap_or_default();
    let code = get(&status, 1).map(Value::text).unwrap_or_default();
    let expected = if step == "login" { "3" } else { "1" };
    let accepted = kind == expected && code == "0";
    Ok(HandshakeStep { step, kind, code, accepted })
}

async fn read_frame(stream: &mut TcpStream) -> Result<Vec<u8>> {
    let io = |e: std::io::Error| HxError::Tcp(e.kind().to_string());
    let mut len = [0u8; 4];
    stream.read_exact(&mut len).await.map_err(io)?;
    let len = u32::from_be_bytes(len) as usize;
    if len == 0 || len > MAX_FRAME_BYTES {
        return Err(HxError::Tcp("độ dài frame không hợp lệ".into()));
    }
    let mut payload = vec![0u8; len];
    stream.read_exact(&mut payload).await.map_err(io)?;
    Ok(payload)
}

/// Port of `connectAndCheck` without a message: login, followup, then close.
pub async fn connect_and_check(host: &str, port: u16, login_frame: &[u8], timeout: Duration) -> Result<Vec<HandshakeStep>> {
    let run = async {
        let io = |e: std::io::Error| HxError::Tcp(e.kind().to_string());
        let mut stream = TcpStream::connect((host, port)).await.map_err(io)?;
        let mut steps = Vec::new();
        stream.write_all(login_frame).await.map_err(io)?;
        for step in ["login", "followup"] {
            let response = read_response(&read_frame(&mut stream).await?, step)?;
            steps.push(response.clone());
            if !response.accepted {
                return Err(HxError::Rejected { step, kind: response.kind, code: response.code });
            }
            if step == "login" {
                stream.write_all(&FOLLOWUP_FRAME).await.map_err(io)?;
            }
        }
        let _ = stream.shutdown().await;
        Ok(steps)
    };
    tokio::time::timeout(timeout, run).await.map_err(|_| HxError::Timeout)?
}

// ---------- tauri command ----------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub username: String,
    pub app_key: String,
    pub host: String,
    pub port: u16,
    /// "access_token" or "password"
    pub token_source: &'static str,
    pub token_expires_in: Option<u64>,
    pub steps: Vec<HandshakeStep>,
}

#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error(transparent)]
    Account(#[from] crate::accounts::AccountError),
    #[error(transparent)]
    Hx(#[from] HxError),
}

impl Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

/// Secrets for the IM login, stored in the keychain next to the sid.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HxSecret {
    pub template_b64: String,
    pub password: Option<String>,
    pub access_token: Option<String>,
}

/// Get a token, log in over TCP, run the followup and disconnect. Sends no chat.
#[tauri::command]
pub async fn hx_check_connection(app: tauri::AppHandle, account_id: uuid::Uuid) -> std::result::Result<CheckResult, CommandError> {
    use tauri::Manager;
    let handle = app.clone();
    let (config, secret) = tauri::async_runtime::spawn_blocking(move || {
        handle.state::<crate::accounts::AccountRegistry>().hx_material(account_id)
    })
    .await
    .map_err(|e| HxError::Invalid(format!("Lỗi nội bộ: {e}")))??;

    let template = parse_template(&secret.template_b64)?;
    let (token, token_source, token_expires_in) = match (&secret.access_token, &secret.password) {
        (Some(t), _) => (t.clone(), "access_token", None),
        (None, Some(pw)) => {
            let rest = config.rest_base.as_deref().unwrap_or(DEFAULT_REST_BASE);
            let t = request_user_token(&template.app_key, &template.username, pw, rest).await?;
            (t.access_token, "password", t.expires_in)
        }
        (None, None) => return Err(HxError::Invalid("Chưa có hxPwd hoặc access token".into()).into()),
    };
    let login = build_login_frame(&template, &token)?;
    let steps = connect_and_check(&config.host, config.port, &login, HANDSHAKE_TIMEOUT).await?;
    Ok(CheckResult {
        username: template.username,
        app_key: template.app_key,
        host: config.host,
        port: config.port,
        token_source,
        token_expires_in,
        steps,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    // Generated from scripts/test/helpers.ts (templateB64) and scripts/src/hyphenate.
    const TEMPLATE: &str = "EiIKCW9yZzEjYXBwMRIIbG92ZV8xMDAaC2Vhc2Vtb2IuY29tQANKMwgFkgEieyJ0b2tlbiI6IiIsInZpZCI6InYxIiwiY2lkIjoiYzEifaAB////////////AWAH";
    const LOGIN_FRAME_HEX: &str = "0000006412220a096f726731236170703112086c6f76655f3130301a0b656173656d6f622e636f6d40034a3a08059201297b22746f6b656e223a22746f6b2d313233222c22766964223a227631222c22636964223a226331227da001ffffffffffffffffff016007";
    const LOGIN_OK: &str = "0000000840034a0442020800";
    const LOGIN_BAD: &str = "0000000840034a0442020805";
    const FOLLOW_OK: &str = "0000000840014a040a020800";

    fn unhex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    #[test]
    fn template_and_login_frame_match_typescript() {
        let t = parse_template(TEMPLATE).unwrap();
        assert_eq!((t.app_key.as_str(), t.username.as_str()), ("org1#app1", "love_100"));
        // Unknown fields and the max uint64 survive the round trip.
        assert_eq!(build_login_frame(&t, "tok-123").unwrap(), unhex(LOGIN_FRAME_HEX));
        assert_eq!(write_fields(&read_fields(&t.payload).unwrap()), t.payload);
    }

    #[test]
    fn rejects_bad_templates() {
        assert!(parse_template("").is_err());
        assert!(parse_template("not base64!").is_err());
        assert!(parse_template(&format!("{TEMPLATE}=")).is_err()); // non-canonical
        // A followup response is a valid frame but not a login template.
        assert!(parse_template(&STANDARD.encode(&unhex(FOLLOW_OK)[4..])).is_err());
    }

    #[test]
    fn validates_hosts_and_rest_base() {
        assert!(validate_host("127.0.0.1").is_ok());
        assert!(validate_host("im-api.easemob.com").is_ok());
        assert!(validate_host("evil.com:80").is_err());
        assert!(validate_host("").is_err());
        assert_eq!(easemob_origin("https://a1-sgp-ga.easemob.com/x").unwrap(), "https://a1-sgp-ga.easemob.com");
        for bad in ["http://a1.easemob.com", "https://easemob.com.evil.io", "https://a1.easemob.com:8443", "https://u:p@a1.easemob.com"] {
            assert!(easemob_origin(bad).is_err(), "{bad}");
        }
    }

    async fn fake_server(replies: Vec<&'static str>) -> (u16, tokio::task::JoinHandle<Vec<Vec<u8>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut received = Vec::new();
            for reply in replies {
                let Ok(payload) = read_frame(&mut sock).await else { break };
                received.push(payload);
                sock.write_all(&unhex(reply)).await.unwrap();
            }
            received
        });
        (port, handle)
    }

    #[tokio::test]
    async fn handshake_logs_in_then_sends_followup() {
        let (port, server) = fake_server(vec![LOGIN_OK, FOLLOW_OK]).await;
        let login = unhex(LOGIN_FRAME_HEX);
        let steps = connect_and_check("127.0.0.1", port, &login, Duration::from_secs(2)).await.unwrap();
        assert_eq!(steps.iter().map(|s| (s.step, s.accepted)).collect::<Vec<_>>(), [("login", true), ("followup", true)]);
        let received = server.await.unwrap();
        assert_eq!(received[0], login[4..]);
        assert_eq!(received[1], FOLLOWUP_FRAME[4..]);
    }

    #[tokio::test]
    async fn handshake_reports_rejection_timeout_and_refusal() {
        let (port, _server) = fake_server(vec![LOGIN_BAD]).await;
        let err = connect_and_check("127.0.0.1", port, &unhex(LOGIN_FRAME_HEX), Duration::from_secs(2)).await.unwrap_err();
        assert_eq!(err.to_string(), "Server chat từ chối bước login (type=3, code=5)");

        let silent = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = silent.local_addr().unwrap().port();
        let err = connect_and_check("127.0.0.1", port, &unhex(LOGIN_FRAME_HEX), Duration::from_millis(200)).await.unwrap_err();
        assert!(matches!(err, HxError::Timeout));
        drop(silent);

        let err = connect_and_check("127.0.0.1", port, &unhex(LOGIN_FRAME_HEX), Duration::from_secs(2)).await.unwrap_err();
        assert!(matches!(err, HxError::Tcp(_)), "{err}");
    }
}
