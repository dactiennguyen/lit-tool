//! Hyphenate (Easemob) IM: token request, TCP login, sending one text message
//! and reading history.
//! Port of scripts/src/hyphenate/{fields,template,token,connection,message,history}.ts.

use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

pub const DEFAULT_IM_PORT: u16 = 6717;
pub const DEFAULT_REST_BASE: &str = "https://a1-sgp-ga.easemob.com";
const MAX_TEMPLATE_B64: usize = 65_536;
const MAX_FRAME_BYTES: usize = 1024 * 1024;
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
    #[error("Server chat không nhận tin (code={0})")]
    SendRejected(String),
    /// The message frame was written but no matching ACK arrived.
    #[error("Không rõ tin đã gửi được chưa ({0}). Kiểm tra lịch sử trước khi gửi lại")]
    SendUnknown(String),
    #[error("Đọc lịch sử thất bại: {0}")]
    History(String),
    /// HTTP 401 from the REST API: the token is no longer valid.
    #[error("Token Hyphenate hết hạn hoặc không hợp lệ")]
    Unauthorized,
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

/// The shared template with another account's IM username: only the `name`
/// inside the identity JID (outer field 2) changes; every other byte is kept.
pub fn with_username(template: &LoginTemplate, username: &str) -> Result<LoginTemplate> {
    if !is_id(username) {
        return Err(HxError::Invalid("IM username không hợp lệ".into()));
    }
    let mut outer = read_fields(&template.payload)?;
    let mut identity = read_fields(bytes_field(&outer, 2)?)?;
    replace_bytes(&mut identity, 2, username.as_bytes().to_vec())?;
    replace_bytes(&mut outer, 2, write_fields(&identity))?;
    Ok(LoginTemplate { payload: write_fields(&outer), app_key: template.app_key.clone(), username: username.to_owned() })
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

/// Server acceptance of one sent message (not delivery or read).
#[derive(Debug, Clone, PartialEq)]
pub struct SendAck {
    pub code: String,
    pub server_id: String,
    pub accepted: bool,
}

/// Port of `connectAndCheck`: login, followup, then either close or send
/// `message` and wait for its ACK. The whole run shares one `timeout`.
pub async fn connect(
    host: &str,
    port: u16,
    login_frame: &[u8],
    message: Option<&TextMessage>,
    timeout: Duration,
) -> Result<(Vec<HandshakeStep>, Option<SendAck>)> {
    let mut sent = false;
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
        let mut ack = None;
        if let Some(message) = message {
            sent = true;
            stream.write_all(&message.frame).await.map_err(io)?;
            // Other frames (e.g. queued incoming messages) are skipped until ours is acknowledged.
            ack = loop {
                if let Some(found) = read_send_response(&read_frame(&mut stream).await?, &message.local_id)? {
                    break Some(found);
                }
            };
        }
        let _ = stream.shutdown().await;
        Ok((steps, ack))
    };
    let result = match tokio::time::timeout(timeout, run).await {
        Ok(r) => r,
        Err(_) => Err(HxError::Timeout),
    };
    match result {
        Ok((_, Some(ack))) if !ack.accepted => Err(HxError::SendRejected(ack.code)),
        Err(e) if sent => Err(HxError::SendUnknown(e.to_string())),
        other => other,
    }
}

/// Login + followup only; sends nothing.
pub async fn connect_and_check(host: &str, port: u16, login_frame: &[u8], timeout: Duration) -> Result<Vec<HandshakeStep>> {
    Ok(connect(host, port, login_frame, None, timeout).await?.0)
}

// ---------- text message ----------

pub const MAX_TEXT_BYTES: usize = 4096;

/// A plain text message ready to send. `local_id` is the client id the ACK echoes.
#[derive(Debug, Clone)]
pub struct TextMessage {
    pub local_id: String,
    pub frame: Vec<u8>,
}

/// Port of the text check in `buildTextMessage`.
pub fn validate_text(text: &str) -> Result<()> {
    if text.trim().is_empty() || text.len() > MAX_TEXT_BYTES || text.contains('\0') {
        return Err(HxError::Invalid(format!("Tin nhắn phải có nội dung và tối đa {MAX_TEXT_BYTES} byte")));
    }
    Ok(())
}

/// Port of `buildTextMessage` with explicit ids (see [`new_local_id`]).
pub fn build_text_message(from: &str, to: &str, text: &str, local_id: u64, mark_id: &str) -> Result<TextMessage> {
    if !is_id(from) || !is_id(to) {
        return Err(HxError::Invalid("IM username không hợp lệ".into()));
    }
    validate_text(text)?;
    let bytes = |number, v: &[u8]| Field { number, value: Value::Bytes(v.to_vec()) };
    let varint = |number, v| Field { number, value: Value::Varint(v) };
    let jid = |user: &str| write_fields(&[bytes(2, user.as_bytes())]);
    let body = write_fields(&[
        varint(1, 1),
        bytes(2, &jid(from)),
        bytes(3, &jid(to)),
        bytes(4, &write_fields(&[varint(1, 0), bytes(2, text.as_bytes())])),
        bytes(5, &write_fields(&[bytes(1, b"mark_msg_id"), varint(2, 7), bytes(6, mark_id.as_bytes())])),
    ]);
    let meta = write_fields(&[varint(1, local_id), bytes(3, &jid(to)), varint(5, 1), bytes(6, &body)]);
    let payload = write_fields(&[varint(1, 0), varint(8, 0), bytes(9, &write_fields(&[bytes(1, &meta)])), varint(11, 0)]);
    Ok(TextMessage { local_id: local_id.to_string(), frame: frame(&payload) })
}

/// Same shape as the TS default: milliseconds * 10000 + a random 0..9999.
pub fn new_local_id(now_ms: u64) -> Result<u64> {
    let mut r = [0u8; 2];
    getrandom::fill(&mut r).map_err(|e| HxError::Invalid(format!("Không tạo được số ngẫu nhiên: {e}")))?;
    Ok(now_ms * 10_000 + u64::from(u16::from_le_bytes(r) % 10_000))
}

fn is_server_id(v: &str) -> bool {
    !v.is_empty() && !v.starts_with('0') && v.bytes().all(|b| b.is_ascii_digit())
}

/// Port of `readSendResponse`: `None` for frames that are not our ACK.
fn read_send_response(payload: &[u8], local_id: &str) -> Result<Option<SendAck>> {
    let outer = read_fields(payload)?;
    if get(&outer, 8).map(Value::text).as_deref() != Some("0") {
        return Ok(None);
    }
    let body = read_fields(bytes_field(&outer, 9)?)?;
    if get(&body, 2).map(Value::text).as_deref() != Some(local_id) {
        return Ok(None);
    }
    let code = get(&read_fields(bytes_field(&body, 1)?)?, 1).map(Value::text).unwrap_or_default();
    let server_id = get(&body, 3).map(Value::text).unwrap_or_default();
    let valid_id = is_server_id(&server_id);
    if code.is_empty() || !code.bytes().all(|b| b.is_ascii_digit()) || (code == "0" && !valid_id) {
        return Err(HxError::Tcp("ACK gửi tin không đầy đủ".into()));
    }
    Ok(Some(SendAck { accepted: code == "0" && valid_id, code, server_id }))
}

// ---------- history (messageroaming) ----------

const MAX_HISTORY_BYTES: usize = 2 * 1024 * 1024;
pub const HISTORY_PAGE_MAX: u32 = 50;

/// One part of a message. `type`: 0 text, 1 image, 2 video, 3 location,
/// 4 voice, 5 file, 6 command, 7 custom, 8 combine. Attachment keys and
/// remote paths are not exposed.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageContent {
    #[serde(rename = "type")]
    pub kind: u64,
    pub text: Option<String>,
    pub file_name: Option<String>,
    pub address: Option<String>,
    /// Seconds, for voice and video.
    pub duration: Option<u64>,
    pub custom_event: Option<String>,
}

/// A decoded chat message (namespace CHAT only).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    /// Server id: a uint64 kept as text, since it does not fit a JS number.
    pub id: String,
    pub from: Option<String>,
    pub to: Option<String>,
    /// Milliseconds since the epoch.
    pub timestamp: Option<u64>,
    pub contents: Vec<MessageContent>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    /// In server order (newest first).
    pub messages: Vec<ChatMessage>,
    /// Pass back to read older messages; `None` when `is_last`.
    pub cursor: Option<String>,
    pub is_last: bool,
}

fn last(fields: &[Field], number: u32) -> Option<&Value> {
    fields.iter().rev().find(|f| f.number == number).map(|f| &f.value)
}

fn last_varint(fields: &[Field], number: u32) -> Option<u64> {
    match last(fields, number) {
        Some(Value::Varint(v)) => Some(*v),
        _ => None,
    }
}

fn last_text(fields: &[Field], number: u32) -> Option<String> {
    match last(fields, number) {
        Some(Value::Bytes(b)) if !b.is_empty() => Some(String::from_utf8_lossy(b).into_owned()),
        _ => None,
    }
}

fn jid_name(fields: &[Field], number: u32) -> Option<String> {
    match last(fields, number) {
        Some(Value::Bytes(b)) => last_text(&read_fields(b).ok()?, 2),
        _ => None,
    }
}

fn history_err(m: &str) -> HxError {
    HxError::History(m.into())
}

/// Port of `decodeMessage`. Returns `None` for non-chat namespaces.
pub fn decode_message(encoded: &str) -> Result<Option<ChatMessage>> {
    if encoded.is_empty() || encoded.len() > MAX_HISTORY_BYTES {
        return Err(history_err("tin nhắn mã hoá sai"));
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| history_err("tin nhắn mã hoá sai"))?;
    if STANDARD.encode(&bytes) != encoded {
        return Err(history_err("base64 không chuẩn"));
    }
    let bad = |_| history_err("protobuf tin nhắn sai");
    let meta = read_fields(&bytes).map_err(bad)?;
    let id = last_varint(&meta, 1).filter(|&v| v != 0).ok_or_else(|| history_err("tin nhắn thiếu server ID"))?;
    if last_varint(&meta, 5).unwrap_or(0) != 1 {
        return Ok(None);
    }
    let body = match last(&meta, 6) {
        Some(Value::Bytes(b)) => read_fields(b).map_err(bad)?,
        _ => Vec::new(),
    };
    let mut contents = Vec::new();
    for field in body.iter().filter(|f| f.number == 4) {
        let Value::Bytes(raw) = &field.value else { continue };
        let c = read_fields(raw).map_err(bad)?;
        contents.push(MessageContent {
            kind: last_varint(&c, 1).unwrap_or(0),
            text: last_text(&c, 2),
            address: last_text(&c, 5),
            file_name: last_text(&c, 6),
            duration: last_varint(&c, 12),
            custom_event: last_text(&c, 19),
        });
    }
    Ok(Some(ChatMessage {
        id: id.to_string(),
        from: jid_name(&body, 2).or_else(|| jid_name(&meta, 2)),
        to: jid_name(&body, 3).or_else(|| jid_name(&meta, 3)),
        timestamp: last_varint(&meta, 4),
        contents,
    }))
}

/// Who is reading which conversation.
pub struct HistoryTarget<'a> {
    pub app_key: &'a str,
    pub username: &'a str,
    pub rest_base: &'a str,
    pub to: &'a str,
    /// 0 one-to-one, 1 group.
    pub conversation_type: i64,
}

impl HistoryTarget<'_> {
    fn queue(&self) -> String {
        let domain = if self.conversation_type == 0 { "easemob.com" } else { "conference.easemob.com" };
        format!("{}@{domain}", self.to)
    }
}

fn is_cursor(v: &str) -> bool {
    !v.is_empty() && v.len() <= 30 && v.bytes().all(|b| b.is_ascii_digit())
}

/// Port of `historyRequest`: URL and body of one `messageroaming` query.
pub fn history_request(t: &HistoryTarget, limit: u32, cursor: Option<&str>) -> Result<(String, serde_json::Value)> {
    if !is_id(t.to) || !matches!(t.conversation_type, 0 | 1) {
        return Err(HxError::Invalid("Cần IM ID và loại hội thoại 0 hoặc 1".into()));
    }
    if !(1..=HISTORY_PAGE_MAX).contains(&limit) {
        return Err(HxError::Invalid("Số tin mỗi trang không hợp lệ".into()));
    }
    if cursor.is_some_and(|c| !is_cursor(c)) {
        return Err(HxError::Invalid("Cursor lịch sử không hợp lệ".into()));
    }
    let (org, app) = t.app_key.split_once('#').filter(|_| is_app_key(t.app_key)).ok_or_else(|| HxError::Invalid("App key sai".into()))?;
    if !is_id(t.username) {
        return Err(HxError::Invalid("IM username không hợp lệ".into()));
    }
    let url = format!("{}/{org}/{app}/users/{}/messageroaming", easemob_origin(t.rest_base)?, t.username);
    let start = cursor.map_or(serde_json::json!(-1), |c| serde_json::json!(c));
    let body = serde_json::json!({
        "queue": t.queue(), "start": start, "pull_number": limit, "is_positive": false,
        "msgType": "", "end": -1, "startTime": null, "endTime": null, "userId": null,
    });
    Ok((url, body))
}

/// Port of the checks in `fetchHistoryPage`: the response must be for this user and queue.
pub fn parse_history(t: &HistoryTarget, json: &serde_json::Value) -> Result<HistoryPage> {
    let data = json.get("data").ok_or_else(|| history_err("response thiếu data"))?;
    let msgs = data.get("msgs").and_then(|v| v.as_array());
    let is_last = data.get("is_last").and_then(|v| v.as_bool());
    let (Some(msgs), Some(is_last)) = (msgs, is_last) else {
        return Err(history_err("response sai định dạng"));
    };
    let queue_ok = data.get("queue").and_then(|v| v.as_str()) == Some(&format!("{}_{}", t.app_key, t.queue()));
    let user_ok = data.get("user").and_then(|v| v.as_str()) == Some(&format!("{}_{}@easemob.com", t.app_key, t.username));
    if !queue_ok || !user_ok {
        return Err(history_err("response không khớp user hoặc hội thoại"));
    }
    let cursor = if is_last {
        None
    } else {
        match data.get("next_key") {
            Some(serde_json::Value::String(s)) if is_cursor(s) => Some(s.clone()),
            Some(serde_json::Value::Number(n)) if n.as_u64().is_some_and(|v| v < 1 << 53) => Some(n.to_string()),
            _ => return Err(history_err("cursor thiếu hoặc không an toàn")),
        }
    };
    let mut messages = Vec::with_capacity(msgs.len());
    for m in msgs {
        let encoded = m.get("msg").and_then(|v| v.as_str()).ok_or_else(|| history_err("tin nhắn mã hoá sai"))?;
        messages.extend(decode_message(encoded)?);
    }
    Ok(HistoryPage { messages, cursor, is_last })
}

/// One `messageroaming` page with a user token. Read-only: sends nothing.
pub async fn fetch_history(t: &HistoryTarget<'_>, token: &str, limit: u32, cursor: Option<&str>) -> Result<HistoryPage> {
    let (url, body) = history_request(t, limit, cursor)?;
    if token.is_empty() {
        return Err(HxError::Invalid("Thiếu access token Hyphenate".into()));
    }
    let client = crate::lit::http_client().map_err(|e| HxError::History(e.to_string()))?;
    let net = |e: reqwest::Error| HxError::History(e.without_url().to_string());
    let mut response = client
        .post(url)
        .bearer_auth(token)
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(net)?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(HxError::Unauthorized);
    }
    let mut raw = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(net)? {
        if raw.len() + chunk.len() > MAX_HISTORY_BYTES {
            return Err(history_err("response vượt 2 MiB"));
        }
        raw.extend_from_slice(&chunk);
    }
    if !status.is_success() {
        return Err(HxError::History(format!("HTTP {}", status.as_u16())));
    }
    let json: serde_json::Value = serde_json::from_slice(&raw).map_err(|_| history_err("JSON không hợp lệ"))?;
    parse_history(t, &json)
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
    fn shared_template_takes_each_accounts_username() {
        let t = parse_template(TEMPLATE).unwrap();
        let other = with_username(&t, "love_200").unwrap();
        assert_eq!((other.app_key.as_str(), other.username.as_str()), ("org1#app1", "love_200"));
        // Re-parses as a valid template, and swapping back gives the original bytes.
        let reparsed = parse_template(&STANDARD.encode(&other.payload)).unwrap();
        assert_eq!(reparsed.username, "love_200");
        assert_eq!(with_username(&other, "love_100").unwrap().payload, t.payload);
        assert!(with_username(&t, "bad name").is_err());
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

    // From scripts/src/hyphenate/message.ts with localId 17314150001230042 and a fixed markId.
    const TXT_FRAME_HEX: &str = "00000089080040004a80010a7e08da81a5838be4e01e1a0a12086c6f76655f323030280132650801120a12086c6f76655f3130301a0a12086c6f76655f32303022120800120e58696e206368c3a06f20f09f918b2a350a0b6d61726b5f6d73675f69641007322430623863376135322d316431652d346633652d396135352d3132333435363738396162635800";
    const LOCAL_ID: u64 = 17314150001230042;
    const MARK_ID: &str = "0b8c7a52-1d1e-4f3e-9a55-123456789abc";
    const ACK_OK: &str = "40004a170a02080010da81a5838be4e01e189582a6efc79e849111";
    const ACK_REJECTED: &str = "40004a0e0a0308fc0310da81a5838be4e01e";

    fn framed(payload_hex: &str) -> Vec<u8> {
        frame(&unhex(payload_hex))
    }

    #[test]
    fn text_message_and_acks_match_typescript() {
        let m = build_text_message("love_100", "love_200", "Xin chào 👋", LOCAL_ID, MARK_ID).unwrap();
        assert_eq!(m.frame, unhex(TXT_FRAME_HEX));
        assert_eq!(m.local_id, "17314150001230042");

        let ok = read_send_response(&unhex(ACK_OK), &m.local_id).unwrap().unwrap();
        assert_eq!(ok, SendAck { code: "0".into(), server_id: "1234567890123456789".into(), accepted: true });
        let bad = read_send_response(&unhex(ACK_REJECTED), &m.local_id).unwrap().unwrap();
        assert_eq!((bad.code.as_str(), bad.accepted), ("508", false));
        // Another message's ACK and handshake frames are not ours.
        assert_eq!(read_send_response(&unhex(ACK_OK), "1").unwrap(), None);
        assert_eq!(read_send_response(&unhex(&FOLLOW_OK[8..]), &m.local_id).unwrap(), None);
    }

    #[test]
    fn text_message_rejects_bad_input() {
        for (from, to, text) in [
            ("love_100", "love 200", "hi"),
            ("love_100", "love_200", "   "),
            ("love_100", "love_200", "a\0b"),
            ("love_100", "love_200", &"x".repeat(MAX_TEXT_BYTES + 1)),
        ] {
            assert!(build_text_message(from, to, text, LOCAL_ID, MARK_ID).is_err(), "{to} {text:.10}");
        }
        assert!(build_text_message("love_100", "love_200", &"é".repeat(MAX_TEXT_BYTES / 2), LOCAL_ID, MARK_ID).is_ok());
        let id = new_local_id(1731415000123).unwrap();
        assert!((17314150001230000..17314150001240000).contains(&id));
    }

    /// Replies to login and followup, then to the message with `after_send` frames.
    async fn send_server(after_send: Vec<Vec<u8>>) -> (u16, tokio::task::JoinHandle<Vec<Vec<u8>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut received = Vec::new();
            for reply in [unhex(LOGIN_OK), unhex(FOLLOW_OK)] {
                received.push(read_frame(&mut sock).await.unwrap());
                sock.write_all(&reply).await.unwrap();
            }
            if let Ok(msg) = read_frame(&mut sock).await {
                received.push(msg);
                for f in after_send {
                    sock.write_all(&f).await.unwrap();
                }
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
            received
        });
        (port, handle)
    }

    #[tokio::test]
    async fn sends_one_message_and_waits_for_its_ack() {
        let m = build_text_message("love_100", "love_200", "Xin chào 👋", LOCAL_ID, MARK_ID).unwrap();
        // ACK for local id 1 (another message) first: must be skipped.
        let other_ack = "40004a100a0208001001189582a6efc79e849111";
        let (port, server) = send_server(vec![framed(other_ack), framed(ACK_OK)]).await;
        let login = unhex(LOGIN_FRAME_HEX);
        let (steps, ack) = connect("127.0.0.1", port, &login, Some(&m), Duration::from_secs(2)).await.unwrap();
        assert_eq!(steps.len(), 2);
        assert_eq!(ack.unwrap().server_id, "1234567890123456789");
        let received = server.await.unwrap();
        assert_eq!(received[2], m.frame[4..]);
    }

    #[tokio::test]
    async fn send_rejection_and_missing_ack_are_reported() {
        let m = build_text_message("love_100", "love_200", "hi", LOCAL_ID, MARK_ID).unwrap();
        let login = unhex(LOGIN_FRAME_HEX);

        let (port, _s) = send_server(vec![framed(ACK_REJECTED)]).await;
        let err = connect("127.0.0.1", port, &login, Some(&m), Duration::from_secs(2)).await.unwrap_err();
        assert!(matches!(err, HxError::SendRejected(ref c) if c == "508"), "{err}");

        let (port, _s) = send_server(vec![]).await;
        let err = connect("127.0.0.1", port, &login, Some(&m), Duration::from_millis(500)).await.unwrap_err();
        assert!(matches!(err, HxError::SendUnknown(_)), "{err}");
    }

    // ---------- history ----------

    const MSG_TXT: &str = "CNCUgOCo1eG8FhIXEghsb3ZlXzIwMBoLZWFzZW1vYi5jb20aChIIbG92ZV8xMDAgu4iBg7IyKAEyPwgBEgoSCGxvdmVfMjAwGgoSCGxvdmVfMTAwIg0SC0Now6BvIGLhuqFuKhQKC21hcmtfbXNnX2lkEAcyA2FiYw==";
    const MSG_IMG: &str = "CP///////////wESFxIIbG92ZV8yMDAaC2Vhc2Vtb2IuY29tGgoSCGxvdmVfMTAwIJiEvoOyMigBMmcIARIKEghsb3ZlXzEwMBoKEghsb3ZlXzIwMCJLCAEyBWEuanBnOiRodHRwczovL2ExLmVhc2Vtb2IuY29tL3gvY2hhdGZpbGVzLzFCBlNFQ1JFVGoSCQAAAAAAACRAEQAAAAAAADRA";
    const MSG_NONCHAT: &str = "CAUgASgC";

    fn target() -> HistoryTarget<'static> {
        HistoryTarget {
            app_key: "org1#app1",
            username: "love_100",
            rest_base: DEFAULT_REST_BASE,
            to: "love_200",
            conversation_type: 0,
        }
    }

    #[test]
    fn decodes_history_messages_like_typescript() {
        let txt = decode_message(MSG_TXT).unwrap().unwrap();
        assert_eq!(txt.id, "1619473608067779152");
        assert_eq!((txt.from.as_deref(), txt.to.as_deref()), (Some("love_200"), Some("love_100")));
        assert_eq!(txt.timestamp, Some(1731415000123));
        assert_eq!(txt.contents, [MessageContent { kind: 0, text: Some("Chào bạn".into()), ..Default::default() }]);

        let img = decode_message(MSG_IMG).unwrap().unwrap();
        assert_eq!(img.id, "18446744073709551615"); // full uint64, no precision loss
        assert_eq!(img.from.as_deref(), Some("love_100")); // body JID wins over the envelope
        assert_eq!(img.contents[0].kind, 1);
        assert_eq!(img.contents[0].file_name.as_deref(), Some("a.jpg"));
        // The attachment key and path are never exposed.
        let json = serde_json::to_string(&img).unwrap();
        assert!(!json.contains("SECRET") && !json.contains("chatfiles"), "{json}");

        assert_eq!(decode_message(MSG_NONCHAT).unwrap(), None);
        for bad in ["", "not base64", &format!("{MSG_NONCHAT}=="), "CAAgASgB"] {
            assert!(decode_message(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn history_request_matches_typescript() {
        let (url, body) = history_request(&target(), 20, Some("1619473608067779152")).unwrap();
        assert_eq!(url, "https://a1-sgp-ga.easemob.com/org1/app1/users/love_100/messageroaming");
        assert_eq!(
            body.to_string(),
            r#"{"queue":"love_200@easemob.com","start":"1619473608067779152","pull_number":20,"is_positive":false,"msgType":"","end":-1,"startTime":null,"endTime":null,"userId":null}"#
        );
        let (_, first) = history_request(&HistoryTarget { conversation_type: 1, ..target() }, 1, None).unwrap();
        assert_eq!((first["queue"].as_str(), first["start"].as_i64()), (Some("love_200@conference.easemob.com"), Some(-1)));
        assert!(history_request(&HistoryTarget { conversation_type: 2, ..target() }, 20, None).is_err());
        assert!(history_request(&target(), 0, None).is_err());
        assert!(history_request(&target(), HISTORY_PAGE_MAX + 1, None).is_err());
        assert!(history_request(&target(), 20, Some("-5")).is_err());
        assert!(history_request(&HistoryTarget { to: "../x", ..target() }, 20, None).is_err());
    }

    fn history_json(is_last: bool, next_key: serde_json::Value) -> serde_json::Value {
        serde_json::json!({ "data": {
            "msgs": [{ "msg": MSG_TXT }, { "msg": MSG_NONCHAT }, { "msg": MSG_IMG }],
            "is_last": is_last, "next_key": next_key,
            "queue": "org1#app1_love_200@easemob.com", "user": "org1#app1_love_100@easemob.com",
        } })
    }

    #[test]
    fn parses_history_pages_and_checks_identity() {
        let page = parse_history(&target(), &history_json(false, "1619467109815818896".into())).unwrap();
        assert_eq!(page.messages.len(), 2); // non-chat dropped, server order kept
        assert_eq!(page.cursor.as_deref(), Some("1619467109815818896"));
        let last = parse_history(&target(), &history_json(true, "undefined".into())).unwrap();
        assert_eq!((last.cursor, last.is_last), (None, true));
        assert_eq!(parse_history(&target(), &history_json(false, 42.into())).unwrap().cursor.as_deref(), Some("42"));

        assert!(parse_history(&target(), &history_json(false, "undefined".into())).is_err());
        assert!(parse_history(&target(), &history_json(false, serde_json::Value::Null)).is_err());
        let mut wrong_user = history_json(true, serde_json::Value::Null);
        wrong_user["data"]["user"] = "org1#app1_love_999@easemob.com".into();
        assert!(parse_history(&target(), &wrong_user).is_err());
        assert!(parse_history(&HistoryTarget { to: "love_300", ..target() }, &history_json(true, serde_json::Value::Null)).is_err());
        assert!(parse_history(&target(), &serde_json::json!({ "data": { "msgs": {} } })).is_err());

        let contract = parse_history(&target(), &history_json(false, "1619467109815818896".into())).unwrap();
        crate::lit_types::check_contract("history-page.json", serde_json::to_value(&contract).unwrap());
    }
}
