//! The proxy of an account: SOCKS5 (RFC 1928/1929) or an HTTP proxy with
//! CONNECT. Port of co-lau-loan-the's core/src/proxy.rs.
//!
//! While it is turned on, everything the account sends goes through it: its
//! HTTP requests (Litmatch API, Easemob token and history; [`client`]) and its
//! chat TCP connection ([`connect`]). Only the connection changes; the
//! protocols run inside the tunnel as they do without one.
//!
//! The account keeps the proxy while it is off, so it can be turned on again.
//! Its password stays in the backend (`secrets` table); the webview gets
//! [`ProxyView`], without it.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProxyKind {
    #[default]
    Socks5,
    Http,
}

impl ProxyKind {
    fn name(self) -> &'static str {
        match self {
            ProxyKind::Socks5 => "socks5",
            ProxyKind::Http => "http",
        }
    }
}

/// The proxy of an account, password included (backend only). An empty
/// `username` means no authentication.
#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Proxy {
    #[serde(default = "on")]
    pub enabled: bool,
    #[serde(default)]
    pub kind: ProxyKind,
    pub host: String,
    pub port: u16,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub username: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub password: String,
}

fn on() -> bool {
    true
}

impl std::fmt::Debug for Proxy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Proxy({}, enabled: {})", self.label(), self.enabled)
    }
}

impl Proxy {
    /// For logs and errors: kind and address, never the credentials.
    pub fn label(&self) -> String {
        if self.host.contains(':') {
            format!("{} [{}]:{}", self.kind.name(), self.host, self.port)
        } else {
            format!("{} {}:{}", self.kind.name(), self.host, self.port)
        }
    }

    /// What the add and edit form must fill in.
    pub fn check_fields(&self) -> Result<(), String> {
        if self.host.trim().is_empty() || self.host.contains(char::is_whitespace) {
            return Err("Proxy cần địa chỉ (host), không có dấu cách".into());
        }
        if self.port == 0 {
            return Err("Cổng proxy phải từ 1 đến 65535".into());
        }
        if self.kind == ProxyKind::Socks5 && (self.username.len() > 255 || self.password.len() > 255) {
            return Err("Tài khoản và mật khẩu proxy SOCKS5 dài tối đa 255 byte".into());
        }
        if self.username.chars().chain(self.password.chars()).any(char::is_control) {
            return Err("Tài khoản và mật khẩu proxy không được có ký tự điều khiển".into());
        }
        Ok(())
    }

    /// The webview's copy, without the password.
    pub fn view(&self) -> ProxyView {
        ProxyView {
            enabled: self.enabled,
            kind: self.kind,
            host: self.host.clone(),
            port: self.port,
            username: self.username.clone(),
            has_password: !self.password.is_empty(),
            label: self.label(),
        }
    }

    /// The same proxy for reqwest. SOCKS5 as `socks5h`: the proxy resolves the
    /// name, as [`Tunnel`] has it do.
    fn for_reqwest(&self) -> Result<reqwest::Proxy, String> {
        let host = if self.host.contains(':') { format!("[{}]", self.host) } else { self.host.clone() };
        let scheme = match self.kind {
            ProxyKind::Socks5 => "socks5h",
            ProxyKind::Http => "http",
        };
        let mut url = url::Url::parse(&format!("{scheme}://{host}:{}", self.port))
            .map_err(|_| format!("Proxy {}: địa chỉ không hợp lệ", self.label()))?;
        let bad = |_| format!("Proxy {}: tài khoản không hợp lệ", self.label());
        if !self.username.is_empty() && self.kind == ProxyKind::Socks5 {
            url.set_username(&self.username).map_err(bad)?;
            url.set_password(Some(&self.password)).map_err(bad)?;
        }
        let mut proxy = reqwest::Proxy::all(url.as_str()).map_err(|_| format!("Proxy {}: không dùng được", self.label()))?;
        if !self.username.is_empty() && self.kind == ProxyKind::Http {
            proxy = proxy.basic_auth(&self.username, &self.password);
        }
        Ok(proxy)
    }
}

/// The account's proxy as the webview has it (`ProxyView` in src/lib/api.ts).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyView {
    pub enabled: bool,
    pub kind: ProxyKind,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub has_password: bool,
    /// "socks5 1.2.3.4:1080", for the list and the header.
    pub label: String,
}

/// The proxy part of the add and edit form (`ProxyForm` in src/lib/api.ts).
/// Off with no address saves no proxy; an empty password with the saved
/// username keeps the saved password.
#[derive(Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyForm {
    pub enabled: bool,
    #[serde(default)]
    pub kind: ProxyKind,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: u32,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
}

impl std::fmt::Debug for ProxyForm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ProxyForm({} {}:{}, enabled: {})", self.kind.name(), self.host, self.port, self.enabled)
    }
}

impl ProxyForm {
    /// The proxy to save, given the one saved now. None when off with no address: nothing to keep.
    pub fn resolve(self, saved: Option<&Proxy>) -> Result<Option<Proxy>, String> {
        let host = self.host.trim().trim_start_matches('[').trim_end_matches(']');
        if !self.enabled && host.is_empty() {
            return Ok(None);
        }
        let username = self.username.trim().to_owned();
        let proxy = Proxy {
            enabled: self.enabled,
            kind: self.kind,
            host: host.to_owned(),
            port: u16::try_from(self.port).unwrap_or(0),
            password: if username.is_empty() { String::new() } else { self.password },
            username,
        };
        let proxy = keep_password(saved, proxy);
        proxy.check_fields()?;
        Ok(Some(proxy))
    }
}

impl From<Proxy> for ProxyForm {
    fn from(p: Proxy) -> Self {
        ProxyForm { enabled: p.enabled, kind: p.kind, host: p.host, port: p.port.into(), username: p.username, password: p.password }
    }
}

/// A proxy edited with its username kept and no password typed in keeps the saved password.
pub fn keep_password(old: Option<&Proxy>, mut edit: Proxy) -> Proxy {
    if !edit.username.is_empty()
        && edit.password.is_empty()
        && let Some(old) = old.filter(|o| o.username == edit.username)
    {
        edit.password = old.password.clone();
    }
    edit
}

/// A proxy is tested before it is saved when it is on and is new, was off, or changed.
pub fn needs_check(old: Option<&Proxy>, new: Option<&Proxy>) -> bool {
    new.is_some_and(|n| n.enabled && old.is_none_or(|o| !o.enabled || o != n))
}

// ---------- the tunnel ----------

#[derive(Debug, Clone, Copy, PartialEq)]
enum Stage {
    Method,
    Auth,
    Connect,
    Http,
}

/// An HTTP proxy answer bigger than this without its blank line is not a CONNECT reply.
const HTTP_HEAD_MAX: usize = 16384;

const NEEDS_LOGIN: &str = "proxy cần tài khoản và mật khẩu";
const REFUSED_LOGIN: &str = "proxy từ chối tài khoản hoặc mật khẩu";

/// Opens a tunnel to host:port through a proxy with no I/O of its own: send
/// `start()`, feed what the proxy answers to `receive`, write back what it
/// returns, until `open`. Errors are the reason in Vietnamese, without the
/// proxy's name; [`open_tunnel`] adds it.
pub struct Tunnel<'a> {
    proxy: &'a Proxy,
    host: &'a str,
    port: u16,
    stage: Stage,
    buf: Vec<u8>,
    pub open: bool,
}

impl<'a> Tunnel<'a> {
    pub fn new(proxy: &'a Proxy, host: &'a str, port: u16) -> Self {
        Self { proxy, host, port, stage: Stage::Method, buf: vec![], open: false }
    }

    pub fn start(&mut self) -> Vec<u8> {
        let p = self.proxy;
        if p.kind == ProxyKind::Http {
            self.stage = Stage::Http;
            let target = if self.host.contains(':') {
                format!("[{}]:{}", self.host, self.port)
            } else {
                format!("{}:{}", self.host, self.port)
            };
            let auth = if p.username.is_empty() {
                String::new()
            } else {
                let basic = STANDARD.encode(format!("{}:{}", p.username, p.password));
                format!("Proxy-Authorization: Basic {basic}\r\n")
            };
            return format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n{auth}\r\n").into_bytes();
        }
        // No authentication (0), plus username/password (2) when there are credentials.
        if p.username.is_empty() { vec![5, 1, 0] } else { vec![5, 2, 0, 2] }
    }

    /// The bytes to send back (maybe none), and once `open`, whatever came
    /// after the proxy's last reply: the server's first bytes may share a chunk with it.
    pub fn receive(&mut self, chunk: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
        self.buf.extend_from_slice(chunk);
        let b = &self.buf;
        match self.stage {
            Stage::Method => {
                if b.len() < 2 {
                    return Ok((vec![], vec![]));
                }
                if b[0] != 5 {
                    return Err("không phải proxy SOCKS5".into());
                }
                let method = b[1];
                self.buf.drain(..2);
                match method {
                    0 => Ok((self.connect()?, vec![])),
                    2 if !self.proxy.username.is_empty() => {
                        self.stage = Stage::Auth;
                        let (u, p) = (self.proxy.username.as_bytes(), self.proxy.password.as_bytes());
                        // RFC 1929 gives each one byte of length: a longer one would be cut,
                        // and the proxy would read the rest as something else.
                        if u.len() > 255 || p.len() > 255 {
                            return Err("Tài khoản và mật khẩu proxy SOCKS5 dài tối đa 255 byte".into());
                        }
                        let mut out = vec![1, u.len() as u8];
                        out.extend_from_slice(u);
                        out.push(p.len() as u8);
                        out.extend_from_slice(p);
                        Ok((out, vec![]))
                    }
                    0xff if self.proxy.username.is_empty() => Err(NEEDS_LOGIN.into()),
                    0xff => Err("proxy không nhận cách đăng nhập nào app đưa ra".into()),
                    m => Err(format!("proxy SOCKS5 chọn cách đăng nhập {m}, app không đưa ra cách đó")),
                }
            }
            Stage::Auth => {
                if b.len() < 2 {
                    return Ok((vec![], vec![]));
                }
                if b[1] != 0 {
                    return Err(REFUSED_LOGIN.into());
                }
                self.buf.drain(..2);
                Ok((self.connect()?, vec![]))
            }
            Stage::Connect => {
                if b.len() < 2 {
                    return Ok((vec![], vec![]));
                }
                if b[0] != 5 {
                    return Err("trả lời không phải của proxy SOCKS5".into());
                }
                if b[1] != 0 {
                    return Err(format!("không nối được tới server ({})", socks_reply(b[1])));
                }
                if b.len() < 5 {
                    return Ok((vec![], vec![]));
                }
                // VER REP RSV ATYP BND.ADDR BND.PORT: the bound address is IPv4 (1),
                // a name with its length (3), IPv6 (4).
                let address = match b[3] {
                    1 => 4,
                    3 => 1 + b[4] as usize,
                    4 => 16,
                    t => return Err(format!("proxy SOCKS5 trả địa chỉ loại {t}")),
                };
                if b.len() < 4 + address + 2 {
                    return Ok((vec![], vec![]));
                }
                self.open = true;
                Ok((vec![], b[4 + address + 2..].to_vec()))
            }
            Stage::Http => {
                let Some(end) = b.windows(4).position(|w| w == b"\r\n\r\n") else {
                    if b.len() > HTTP_HEAD_MAX {
                        return Err("trả lời của proxy HTTP không có dòng trống kết thúc".into());
                    }
                    return Ok((vec![], vec![]));
                };
                let line_end = b.windows(2).position(|w| w == b"\r\n").unwrap_or(end);
                let line = String::from_utf8_lossy(&b[..line_end]).into_owned();
                let status = line
                    .strip_prefix("HTTP/1.1 ")
                    .or_else(|| line.strip_prefix("HTTP/1.0 "))
                    .and_then(|s| s.get(..3))
                    .and_then(|s| s.parse::<u16>().ok())
                    .ok_or("không phải proxy HTTP")?;
                match status {
                    200..=299 => {
                        self.open = true;
                        Ok((vec![], b[end + 4..].to_vec()))
                    }
                    407 if self.proxy.username.is_empty() => Err(NEEDS_LOGIN.into()),
                    407 => Err(REFUSED_LOGIN.into()),
                    _ => Err(format!("proxy HTTP từ chối: {}", line[9..].trim())),
                }
            }
        }
    }

    /// CONNECT host:port: IPv4 and IPv6 as addresses, anything else as a name the proxy resolves.
    fn connect(&mut self) -> Result<Vec<u8>, String> {
        self.stage = Stage::Connect;
        let mut out = vec![5, 1, 0];
        match self.host.parse::<IpAddr>() {
            Ok(IpAddr::V4(ip)) => {
                out.push(1);
                out.extend_from_slice(&ip.octets());
            }
            Ok(IpAddr::V6(ip)) => {
                out.push(4);
                out.extend_from_slice(&ip.octets());
            }
            Err(_) => {
                let name = self.host.as_bytes();
                if name.len() > 255 {
                    return Err("tên server quá dài cho SOCKS5".into());
                }
                out.extend_from_slice(&[3, name.len() as u8]);
                out.extend_from_slice(name);
            }
        }
        out.extend_from_slice(&self.port.to_be_bytes());
        Ok(out)
    }
}

/// SOCKS5 replies other than 0 (RFC 1928 §6).
fn socks_reply(rep: u8) -> String {
    match rep {
        1 => "lỗi chung của proxy".into(),
        2 => "proxy không cho phép kết nối này".into(),
        3 => "không tới được mạng".into(),
        4 => "không tới được máy".into(),
        5 => "server từ chối kết nối".into(),
        6 => "hết TTL".into(),
        7 => "proxy không hỗ trợ lệnh CONNECT".into(),
        8 => "proxy không hỗ trợ loại địa chỉ".into(),
        r => format!("mã {r}"),
    }
}

/// Runs the tunnel's handshake on a stream connected to the proxy; the bytes after the proxy's last reply.
pub async fn open_tunnel<S: AsyncRead + AsyncWrite + Unpin>(
    stream: &mut S,
    proxy: &Proxy,
    host: &str,
    port: u16,
) -> Result<Vec<u8>, String> {
    let fail = |e: String| format!("Proxy {}: {e}", proxy.label());
    let io = |e: std::io::Error| fail(e.to_string());
    let mut t = Tunnel::new(proxy, host, port);
    stream.write_all(&t.start()).await.map_err(io)?;
    let mut buf = [0u8; 2048];
    loop {
        let n = stream.read(&mut buf).await.map_err(io)?;
        if n == 0 {
            return Err(fail("đóng kết nối trước khi mở đường tới server".into()));
        }
        let (send, rest) = t.receive(&buf[..n]).map_err(fail)?;
        if !send.is_empty() {
            stream.write_all(&send).await.map_err(io)?;
        }
        if t.open {
            return Ok(rest);
        }
    }
}

// ---------- connections ----------

/// Why a connection through a proxy failed (proxy named, password not).
#[derive(Debug)]
pub enum ConnectError {
    /// Connecting (to the server or the proxy) took longer than allowed.
    Timeout(String),
    Io(std::io::Error),
    Proxy(String),
}

/// Connects to the proxy and opens its tunnel to host:port, each within `step`.
pub async fn tunnel(p: &Proxy, host: &str, port: u16, step: Duration) -> Result<(TcpStream, Vec<u8>), ConnectError> {
    let mut stream = timeout(step, TcpStream::connect((p.host.as_str(), p.port)))
        .await
        .map_err(|_| ConnectError::Timeout(format!("Hết giờ kết nối proxy {}", p.label())))?
        .map_err(|e| ConnectError::Proxy(format!("Không kết nối được proxy {}: {e}", p.label())))?;
    let _ = stream.set_nodelay(true);
    let early = timeout(step, open_tunnel(&mut stream, p, host, port))
        .await
        .map_err(|_| ConnectError::Timeout(format!("Proxy {} không trả lời", p.label())))?
        .map_err(ConnectError::Proxy)?;
    Ok((stream, early))
}

/// The TCP connection to host:port, through `proxy` when there is one; with
/// the bytes the proxy passed on after its last reply.
pub async fn connect(
    host: &str,
    port: u16,
    proxy: Option<&Proxy>,
    step: Duration,
) -> Result<(TcpStream, Vec<u8>), ConnectError> {
    let Some(p) = proxy else {
        let stream = timeout(step, TcpStream::connect((host, port)))
            .await
            .map_err(|_| ConnectError::Timeout("Hết giờ kết nối".into()))?
            .map_err(ConnectError::Io)?;
        let _ = stream.set_nodelay(true);
        return Ok((stream, vec![]));
    };
    tunnel(p, host, port, step).await
}

/// How long each step of a check may take.
const CHECK_STEP: Duration = Duration::from_secs(10);

/// "Kiểm tra" of the form, and the test before saving: opens a tunnel to
/// host:port through `proxy` and closes it without sending anything. How long that took.
pub async fn check(proxy: &Proxy, host: &str, port: u16) -> Result<Duration, String> {
    let start = Instant::now();
    tunnel(proxy, host, port, CHECK_STEP).await.map_err(|e| match e {
        ConnectError::Timeout(m) | ConnectError::Proxy(m) => m,
        ConnectError::Io(e) => e.to_string(),
    })?;
    Ok(start.elapsed())
}

// ---------- HTTP clients ----------

/// Each request may take this long in all.
pub const HTTP_TIMEOUT: Duration = Duration::from_secs(12);

fn build(proxy: Option<&Proxy>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().timeout(HTTP_TIMEOUT).redirect(reqwest::redirect::Policy::none());
    if let Some(p) = proxy {
        builder = builder.proxy(p.for_reqwest()?);
    }
    builder.build().map_err(|e| e.to_string())
}

/// The HTTP client for requests through `proxy` (direct when None). One per
/// proxy for the whole run, so connections and TLS sessions are reused.
pub fn client(proxy: Option<&Proxy>) -> Result<reqwest::Client, String> {
    static DIRECT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    static PROXIED: OnceLock<Mutex<HashMap<Proxy, reqwest::Client>>> = OnceLock::new();
    let Some(p) = proxy else {
        return DIRECT.get_or_init(|| build(None)).clone();
    };
    let mut clients = PROXIED.get_or_init(Mutex::default).lock().unwrap_or_else(|e| e.into_inner());
    if let Some(c) = clients.get(p) {
        return Ok(c.clone());
    }
    let c = build(Some(p))?;
    clients.insert(p.clone(), c.clone());
    Ok(c)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proxy(kind: ProxyKind, username: &str, password: &str) -> Proxy {
        Proxy { enabled: true, kind, host: "127.0.0.1".into(), port: 1080, username: username.into(), password: password.into() }
    }

    #[test]
    fn socks5_offers_username_and_password_only_with_them_and_keeps_the_bytes_after_its_reply() {
        let p = proxy(ProxyKind::Socks5, "ab", "cd");
        let mut t = Tunnel::new(&p, "im.example.com", 6717);
        assert_eq!(t.start(), [5, 2, 0, 2]);
        assert_eq!(t.receive(&[5, 2]).unwrap().0, [1, 2, b'a', b'b', 2, b'c', b'd']);
        let mut connect = vec![5, 1, 0, 3, 14];
        connect.extend_from_slice(b"im.example.com");
        connect.extend_from_slice(&6717u16.to_be_bytes());
        assert_eq!(t.receive(&[1, 0]).unwrap().0, connect);
        // The reply one byte at a time, its last byte in the same chunk as the server's first.
        for b in [5, 0, 0, 1, 10, 0, 0, 1, 0x04] {
            assert!(t.receive(&[b]).unwrap().1.is_empty());
        }
        assert!(!t.open);
        assert_eq!(t.receive(&[0x38, 0xde, 0xad]).unwrap().1, [0xde, 0xad]);
        assert!(t.open);
        let plain = proxy(ProxyKind::Socks5, "", "");
        let mut t = Tunnel::new(&plain, "10.1.2.3", 80);
        assert_eq!(t.start(), [5, 1, 0]);
        assert_eq!(t.receive(&[5, 0]).unwrap().0, [5, 1, 0, 1, 10, 1, 2, 3, 0, 80]);
    }

    #[test]
    fn http_connect_sends_basic_auth_and_keeps_the_bytes_after_the_headers() {
        let p = proxy(ProxyKind::Http, "u", "p");
        let mut t = Tunnel::new(&p, "im.example.com", 6717);
        assert_eq!(
            String::from_utf8(t.start()).unwrap(),
            "CONNECT im.example.com:6717 HTTP/1.1\r\nHost: im.example.com:6717\r\nProxy-Authorization: Basic dTpw\r\n\r\n"
        );
        assert!(t.receive(b"HTTP/1.1 200 OK\r\n").unwrap().1.is_empty());
        assert_eq!(t.receive(b"Via: x\r\n\r\n\x01\x02").unwrap().1, [1, 2]);
        assert!(t.open);
    }

    #[test]
    fn refusals_say_why() {
        let err = |p: &Proxy, replies: &[&[u8]]| {
            let mut t = Tunnel::new(p, "1.2.3.4", 443);
            t.start();
            replies.iter().find_map(|r| t.receive(r).err()).unwrap_or_default()
        };
        let none = proxy(ProxyKind::Socks5, "", "");
        let login = proxy(ProxyKind::Socks5, "u", "x");
        assert_eq!(err(&none, &[&[5, 0xff]]), NEEDS_LOGIN);
        assert_eq!(err(&login, &[&[5, 2], &[1, 1]]), REFUSED_LOGIN);
        assert_eq!(err(&none, &[&[5, 0], &[5, 5]]), "không nối được tới server (server từ chối kết nối)");
        assert_eq!(err(&none, &[b"HT"]), "không phải proxy SOCKS5");
        let http = proxy(ProxyKind::Http, "", "");
        assert_eq!(err(&http, &[b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n"]), NEEDS_LOGIN);
        assert_eq!(err(&http, &[b"HTTP/1.0 403 Forbidden\r\n\r\n"]), "proxy HTTP từ chối: 403 Forbidden");
        assert_eq!(err(&http, &[b"\x05\x00\r\n\r\n"]), "không phải proxy HTTP");
    }

    #[test]
    fn the_saved_proxy_and_its_view_never_show_the_password() {
        let p = proxy(ProxyKind::Http, "bot", "s3cret");
        let json = serde_json::to_string(&p).unwrap();
        assert_eq!(json, r#"{"enabled":true,"kind":"http","host":"127.0.0.1","port":1080,"username":"bot","password":"s3cret"}"#);
        assert_eq!(serde_json::from_str::<Proxy>(&json).unwrap(), p);
        let bare: Proxy = serde_json::from_str(r#"{"host":"::1","port":1080}"#).unwrap();
        assert_eq!((bare.enabled, bare.kind, bare.label()), (true, ProxyKind::Socks5, "socks5 [::1]:1080".into()));
        assert_eq!(format!("{p:?}"), "Proxy(http 127.0.0.1:1080, enabled: true)");
        let view = serde_json::to_string(&p.view()).unwrap();
        assert!(!view.contains("s3cret") && view.contains(r#""hasPassword":true"#), "{view}");
        assert!(Proxy { host: " ".into(), ..p.clone() }.check_fields().is_err());
        assert!(Proxy { port: 0, ..p.clone() }.check_fields().is_err());
        let form = format!("{:?}", ProxyForm::from(p));
        assert!(!form.contains("s3cret") && !form.contains("bot"), "{form}");
    }

    fn form(enabled: bool, host: &str, username: &str, password: &str) -> ProxyForm {
        ProxyForm { enabled, kind: ProxyKind::Http, host: host.into(), port: 8080, username: username.into(), password: password.into() }
    }

    #[test]
    fn the_form_keeps_the_saved_password_only_for_the_same_username() {
        let saved = Proxy { port: 8080, ..proxy(ProxyKind::Http, "bot", "s3cret") };
        let kept = form(true, " [127.0.0.1] ", " bot ", "").resolve(Some(&saved)).unwrap().unwrap();
        assert_eq!((kept.host.as_str(), kept.username.as_str(), kept.password.as_str()), ("127.0.0.1", "bot", "s3cret"));
        assert_eq!(form(true, "127.0.0.1", "other", "").resolve(Some(&saved)).unwrap().unwrap().password, "");
        assert_eq!(form(true, "127.0.0.1", "bot", "new").resolve(Some(&saved)).unwrap().unwrap().password, "new");
        assert_eq!(form(true, "127.0.0.1", "", "x").resolve(None).unwrap().unwrap().password, "", "no username, no password");
        assert_eq!(form(false, " ", "", "").resolve(Some(&saved)).unwrap(), None, "off and empty: no proxy");
        let off = form(false, "127.0.0.1", "bot", "").resolve(Some(&saved)).unwrap().unwrap();
        assert!(!off.enabled && off.password == "s3cret", "kept while off");
        assert!(form(true, "", "", "").resolve(None).is_err());
        assert!(ProxyForm { port: 70000, ..form(true, "h.example", "", "") }.resolve(None).is_err());
    }

    #[test]
    fn a_proxy_is_checked_when_turned_on_new_or_changed() {
        let on = proxy(ProxyKind::Socks5, "", "");
        let off = Proxy { enabled: false, ..on.clone() };
        assert!(needs_check(None, Some(&on)));
        assert!(needs_check(Some(&off), Some(&on)));
        assert!(needs_check(Some(&on), Some(&Proxy { port: 1081, ..on.clone() })));
        assert!(!needs_check(Some(&on), Some(&on)));
        assert!(!needs_check(Some(&on), Some(&off)));
        assert!(!needs_check(Some(&on), None));
    }

    #[test]
    fn reqwest_gets_the_same_proxy() {
        for p in [proxy(ProxyKind::Socks5, "u@x", "p:w"), proxy(ProxyKind::Http, "u", "p"), Proxy { host: "::1".into(), ..proxy(ProxyKind::Socks5, "", "") }] {
            assert!(client(Some(&p)).is_ok(), "{p:?}");
        }
        assert!(client(None).is_ok());
    }

    /// A SOCKS5 proxy on localhost that tunnels to a server sending "hi".
    #[tokio::test]
    async fn connects_through_a_socks5_proxy() {
        use tokio::net::TcpListener;
        let server = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let server_port = server.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = server.accept().await.unwrap();
            s.write_all(b"hi").await.unwrap();
        });
        let socks = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let socks_port = socks.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut c, _) = socks.accept().await.unwrap();
            let mut greet = [0u8; 3];
            c.read_exact(&mut greet).await.unwrap();
            c.write_all(&[5, 0]).await.unwrap();
            let mut req = [0u8; 10];
            c.read_exact(&mut req).await.unwrap();
            assert_eq!(&req[..4], &[5, 1, 0, 1]);
            let port = u16::from_be_bytes([req[8], req[9]]);
            let mut up = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            c.write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 0]).await.unwrap();
            let _ = tokio::io::copy_bidirectional(&mut c, &mut up).await;
        });
        let p = Proxy { port: socks_port, ..proxy(ProxyKind::Socks5, "", "") };
        let (mut stream, early) = connect("127.0.0.1", server_port, Some(&p), CHECK_STEP).await.unwrap();
        let mut got = early;
        while got.len() < 2 {
            let mut b = [0u8; 8];
            let n = stream.read(&mut b).await.unwrap();
            got.extend_from_slice(&b[..n]);
        }
        assert_eq!(got, b"hi");
        let dead = Proxy { port: 1, ..p };
        assert!(check(&dead, "127.0.0.1", server_port).await.unwrap_err().contains("proxy socks5 127.0.0.1:1"));
    }
}
