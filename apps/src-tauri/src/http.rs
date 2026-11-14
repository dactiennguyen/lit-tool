//! Every HTTP request of the app goes through [`fetch`] (or [`fetch_with`]),
//! which reads the response with a size limit and reports the exchange as an
//! "http-log" event for the connection log: URL, headers and bodies of the
//! request and the response, with every secret masked (inspect.rs). A
//! Litmatch URL carries the sid and its signature; token requests carry the
//! IM password and their answers the token.

use std::sync::OnceLock;
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::inspect::{self, masked};

/// Set once at startup; without it (tests) nothing is reported.
static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

/// Who a request is for, for the log.
#[derive(Debug, Clone, Copy)]
pub struct Trace {
    /// None for requests of no account (the server list).
    pub account_id: Option<Uuid>,
    /// What the request is, in the UI's words.
    pub service: &'static str,
}

type Pairs = Vec<(String, String)>;

/// "http-log" event payload (`HttpLogEvent` in src/lib/api.ts). Secrets masked.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpLog {
    account_id: Option<Uuid>,
    at: u64,
    service: &'static str,
    method: String,
    /// Scheme and host.
    origin: String,
    path: String,
    query: Pairs,
    request_headers: Pairs,
    request_body: String,
    status: Option<u16>,
    ms: u64,
    bytes: Option<usize>,
    response_headers: Pairs,
    response_body: String,
    error: Option<String>,
}

pub struct Fetched {
    pub status: u16,
    pub headers: reqwest::header::HeaderMap,
    pub body: Vec<u8>,
}

#[derive(Debug)]
pub enum FetchError {
    /// Without the URL (it may carry the sid).
    Network(String),
    /// The body passed the limit.
    TooLarge,
}

/// The request as logged, taken before it is sent.
struct Sent {
    method: String,
    url: reqwest::Url,
    headers: Pairs,
    body: String,
}

impl Sent {
    fn of(request: &reqwest::Request, plain_body: Option<&str>) -> Self {
        let body = match plain_body {
            Some(text) => inspect::body_view(text.as_bytes()),
            None => request.body().and_then(|b| b.as_bytes()).map(inspect::body_view).unwrap_or_default(),
        };
        Sent { method: request.method().to_string(), url: request.url().clone(), headers: header_pairs(request.headers()), body }
    }
}

fn header_pairs(headers: &reqwest::header::HeaderMap) -> Pairs {
    headers
        .iter()
        .map(|(k, v)| (k.to_string(), masked(k.as_str(), v.to_str().unwrap_or("(nhị phân)"))))
        .collect()
}

/// Sends `request`, reads at most `limit` bytes of its body, and logs the exchange.
pub async fn fetch(request: reqwest::RequestBuilder, limit: usize, trace: Trace) -> Result<Fetched, FetchError> {
    fetch_with(request, limit, trace, None, |_| None).await
}

/// [`fetch`] for encrypted bodies: the log shows `plain_request` instead of the
/// request body sent, and what `plain_response` makes of the response.
pub async fn fetch_with(
    request: reqwest::RequestBuilder,
    limit: usize,
    trace: Trace,
    plain_request: Option<&str>,
    plain_response: impl FnOnce(&Fetched) -> Option<String>,
) -> Result<Fetched, FetchError> {
    let started = Instant::now();
    let (client, request) = request.build_split();
    let request = request.map_err(|e| FetchError::Network(e.without_url().to_string()))?;
    let sent = APP.get().map(|_| Sent::of(&request, plain_request));
    let result = exchange(&client, request, limit).await;
    if let (Some(app), Some(sent)) = (APP.get(), sent) {
        let plain = result.as_ref().ok().and_then(plain_response);
        let _ = app.emit("http-log", log_entry(trace, sent, &result, plain, limit, started));
    }
    result
}

/// The log entry of one exchange, secrets masked.
fn log_entry(
    trace: Trace,
    sent: Sent,
    result: &Result<Fetched, FetchError>,
    plain_response: Option<String>,
    limit: usize,
    started: Instant,
) -> HttpLog {
    let mut entry = HttpLog {
        account_id: trace.account_id,
        at: crate::store::now_ms(),
        service: trace.service,
        method: sent.method,
        origin: sent.url.origin().ascii_serialization(),
        path: sent.url.path().to_owned(),
        query: sent.url.query_pairs().map(|(k, v)| (k.to_string(), masked(&k, &v))).collect(),
        request_headers: sent.headers,
        request_body: sent.body,
        status: None,
        ms: started.elapsed().as_millis() as u64,
        bytes: None,
        response_headers: Vec::new(),
        response_body: String::new(),
        error: None,
    };
    match result {
        Ok(f) => {
            entry.status = Some(f.status);
            entry.bytes = Some(f.body.len());
            entry.response_headers = header_pairs(&f.headers);
            entry.response_body = inspect::body_view(plain_response.as_deref().map_or(&f.body[..], str::as_bytes));
        }
        Err(FetchError::Network(e)) => entry.error = Some(e.clone()),
        Err(FetchError::TooLarge) => entry.error = Some(format!("response vượt {} KiB", limit / 1024)),
    }
    entry
}

async fn exchange(client: &reqwest::Client, request: reqwest::Request, limit: usize) -> Result<Fetched, FetchError> {
    let net = |e: reqwest::Error| FetchError::Network(e.without_url().to_string());
    let mut response = client.execute(request).await.map_err(net)?;
    let status = response.status().as_u16();
    let headers = std::mem::take(response.headers_mut());
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(net)? {
        if body.len() + chunk.len() > limit {
            return Err(FetchError::TooLarge);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(Fetched { status, headers, body })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    const TRACE: Trace = Trace { account_id: None, service: "test" };

    /// Answers one request with `body`.
    async fn server(body: &'static str) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 2048];
            let _ = socket.read(&mut buf).await;
            let response = format!("HTTP/1.1 200 OK\r\nx-is-enc: 1\r\ncontent-length: {}\r\n\r\n{body}", body.len());
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        port
    }

    #[tokio::test]
    async fn reads_the_body_within_the_limit() {
        let client = reqwest::Client::new();
        let port = server("hello").await;
        let ok = fetch(client.get(format!("http://127.0.0.1:{port}/a")), 64, TRACE).await.unwrap();
        assert_eq!((ok.status, ok.body.as_slice()), (200, b"hello".as_slice()));
        assert_eq!(ok.headers.get("x-is-enc").unwrap(), "1");

        let port = server("too long for the limit").await;
        let result = fetch(client.get(format!("http://127.0.0.1:{port}/a")), 4, TRACE).await;
        assert!(matches!(result, Err(FetchError::TooLarge)));
    }

    #[test]
    fn the_log_shows_the_exchange_with_every_secret_masked() {
        let request = reqwest::Client::new()
            .post("https://api.example.com/api/sns/v1/lit/user/get_info/me?sid=SECRET&sign=SIG&num=10")
            .header("litSign", "LS")
            .header("X-Application-Info", "ENCODED-QUERY")
            .header("accept", "application/json")
            .body(r#"{"username":"love_1","password":"PW"}"#)
            .build()
            .unwrap();
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("set-cookie", "C".parse().unwrap());
        let body = br#"{"data":{"nickname":"Lan","session":"S","huanxin":{"password":"HP"}},"access_token":"T"}"#.to_vec();
        let result = Ok(Fetched { status: 200, headers, body });
        let entry = log_entry(TRACE, Sent::of(&request, None), &result, None, 1024, Instant::now());
        let json = serde_json::to_string(&entry).unwrap();
        for secret in ["SECRET", "SIG", "\"LS\"", "ENCODED-QUERY", "PW", "\"S\"", "HP", "\"T\"", "\"C\""] {
            assert!(!json.contains(secret), "{secret} leaked: {json}");
        }
        assert!(entry.query.contains(&("num".into(), "10".into())));
        assert!(entry.request_body.contains("love_1") && entry.response_body.contains("Lan"));
        assert_eq!((entry.path.as_str(), entry.status, entry.bytes), ("/api/sns/v1/lit/user/get_info/me", Some(200), Some(88)));

        // An encrypted body is logged as given in plain.
        let entry = log_entry(TRACE, Sent::of(&request, Some(r#"{"a":1}"#)), &result, Some(r#"{"b":2}"#.into()), 1024, Instant::now());
        assert!(entry.request_body.contains("\"a\": 1") && entry.response_body.contains("\"b\": 2"));
    }
}
