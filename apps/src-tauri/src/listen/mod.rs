//! Chat connections to the IM server: the live connection of each account,
//! which hears new messages as they arrive, and sending through it (or over a
//! one-off login when it is not open). Port of scripts/src/hyphenate/listener.ts
//! plus reconnecting and sending.
//!
//! - session.rs: one login and what happens on it (protocol, no Tauri).
//! - here: one listener per account, reconnecting, the webview events and the commands.
//!
//! Events: "hx-status" (where a connection stands, [`LiveState`]),
//! "hx-message" (a new chat message), "hx-log" (each frame in or out, no
//! token or message text).
//!
//! While a live connection is open, sends go through it: a second login with
//! the same client id would end it. A lost connection is opened again after a
//! pause, up to [`MAX_RETRIES`] times in a row; a refused login, a server
//! LOGOUT or bad IM credentials stop it.

mod session;

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, oneshot};
use tokio::time::{Instant, sleep_until};
use uuid::Uuid;

use crate::chat::{CommandError, Session, TokenSource};
use crate::hx::{self, HxError, SendAck, TextMessage};
use session::{End, Event, Incoming, Link, LogLine, MAX_ACKS, Outgoing, Seen, TIMING, run_session};

/// Pauses before connecting again, by failure count.
const BACKOFF_SECS: [u64; 5] = [3, 10, 30, 60, 120];
/// Failures in a row before giving up.
const MAX_RETRIES: u32 = 8;
/// A connection that stayed up this long resets the failure count.
const STABLE: Duration = Duration::from_secs(120);

/// Where the live connection of an account stands (`LiveState` in src/lib/api.ts).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum LiveState {
    Connecting,
    /// Logged in and listening since `since` (ms since the epoch).
    Live { since: u64 },
    /// Lost at `at`; connects again at `retry_at`.
    Retrying { at: u64, message: String, retry_at: u64 },
    /// Ended, by the user (`message` None) or by an error.
    Stopped { at: u64, message: Option<String> },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusEvent {
    account_id: Uuid,
    #[serde(flatten)]
    state: LiveState,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MessageEvent {
    account_id: Uuid,
    #[serde(flatten)]
    incoming: Incoming,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogEvent {
    account_id: Uuid,
    at: u64,
    #[serde(flatten)]
    line: LogLine,
}

fn now() -> u64 {
    crate::store::now_ms()
}

// ---------- listeners, one per account ----------

struct Handle {
    /// Tells this listener's task from an earlier one for the same account.
    generation: u64,
    task: tauri::async_runtime::JoinHandle<()>,
    outbox: mpsc::Sender<Outgoing>,
    state: LiveState,
}

/// Managed state: the running listeners. A stopped listener is removed.
#[derive(Default)]
pub struct Listeners {
    running: Mutex<HashMap<Uuid, Handle>>,
    generation: AtomicU64,
}

impl Listeners {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<Uuid, Handle>> {
        self.running.lock().unwrap_or_else(|e| e.into_inner())
    }
}

fn emit_state(app: &AppHandle, account_id: Uuid, state: LiveState) {
    let _ = app.emit("hx-status", StatusEvent { account_id, state });
}

/// Records and announces the state of a listener, if it is still the running one.
fn set_state(app: &AppHandle, account_id: Uuid, generation: u64, state: LiveState) {
    {
        let listeners = app.state::<Listeners>();
        let mut running = listeners.lock();
        match running.get_mut(&account_id) {
            Some(h) if h.generation == generation => {
                if matches!(state, LiveState::Stopped { .. }) {
                    running.remove(&account_id);
                } else {
                    h.state = state.clone();
                }
            }
            _ => return,
        }
    }
    emit_state(app, account_id, state);
}

/// Starts listening for an account; does nothing when it already is.
pub fn start(app: &AppHandle, account_id: Uuid) -> LiveState {
    let listeners = app.state::<Listeners>();
    let mut running = listeners.lock();
    if let Some(h) = running.get(&account_id) {
        return h.state.clone();
    }
    let generation = listeners.generation.fetch_add(1, Ordering::Relaxed);
    let (outbox, inbox) = mpsc::channel(MAX_ACKS);
    // Spawned under the lock: the task's first state change waits for its handle.
    let task = tauri::async_runtime::spawn(run(app.clone(), account_id, generation, inbox));
    running.insert(account_id, Handle { generation, task, outbox, state: LiveState::Connecting });
    drop(running);
    emit_state(app, account_id, LiveState::Connecting);
    LiveState::Connecting
}

/// Stops listening for an account (no-op when it is not).
pub fn stop(app: &AppHandle, account_id: Uuid) {
    let Some(handle) = app.state::<Listeners>().lock().remove(&account_id) else { return };
    handle.task.abort();
    emit_state(app, account_id, LiveState::Stopped { at: now(), message: None });
}

/// Connects, listens, and connects again after a pause while that is worth it.
async fn run(app: AppHandle, account_id: Uuid, generation: u64, mut outbox: mpsc::Receiver<Outgoing>) {
    let mut seen = Seen::default();
    let mut failures = 0u32;
    let state = |s| set_state(&app, account_id, generation, s);
    loop {
        state(LiveState::Connecting);
        let mut live_at = None;
        let end = connect_once(&app, account_id, generation, &mut outbox, &mut seen, &mut live_at).await;
        if live_at.is_some_and(|t: Instant| t.elapsed() >= STABLE) {
            failures = 0;
        }
        let error = match end {
            End::Stopped => return,
            End::Fatal(e) => return state(LiveState::Stopped { at: now(), message: Some(e.to_string()) }),
            End::Retry(e) => e,
        };
        failures += 1;
        if failures > MAX_RETRIES {
            let message = format!("{error} (đã thử lại {MAX_RETRIES} lần)");
            return state(LiveState::Stopped { at: now(), message: Some(message) });
        }
        let wait = Duration::from_secs(BACKOFF_SECS[(failures as usize - 1).min(BACKOFF_SECS.len() - 1)]);
        let at = now();
        state(LiveState::Retrying { at, message: error.to_string(), retry_at: at + wait.as_millis() as u64 });
        if !pause(wait, &mut outbox).await {
            return;
        }
    }
}

/// Waits `wait`, turning down sends meanwhile without writing them. False when the outbox closed.
async fn pause(wait: Duration, outbox: &mut mpsc::Receiver<Outgoing>) -> bool {
    let until = Instant::now() + wait;
    loop {
        tokio::select! {
            _ = sleep_until(until) => return true,
            out = outbox.recv() => match out {
                Some(out) => {
                    let _ = out.reply.send(Err(HxError::Tcp("đang kết nối lại server chat, chưa gửi".into())));
                }
                None => return false,
            },
        }
    }
}

/// The session's errors as a connection end: IM errors keep their own sorting, others stop.
fn end_of(e: CommandError) -> End {
    match e {
        CommandError::Hx(e) | CommandError::Server(crate::settings::ServerError::Hx(e)) => e.into(),
        other => End::Fatal(HxError::Invalid(other.to_string())),
    }
}

fn link<'a>(session: &'a Session, login: &'a [u8], sync: bool) -> Link<'a> {
    Link { host: &session.host, port: session.port, login, me: &session.template.username, timing: TIMING, sync }
}

async fn connect_once(
    app: &AppHandle,
    account_id: Uuid,
    generation: u64,
    outbox: &mut mpsc::Receiver<Outgoing>,
    seen: &mut Seen,
    live_at: &mut Option<Instant>,
) -> End {
    let session = match Session::load(app, account_id).await {
        Ok(s) => s,
        Err(e) => return end_of(e),
    };
    let (token, source, _) = match session.token(app).await {
        Ok(t) => t,
        Err(e) => return end_of(e),
    };
    let login = match hx::build_login_frame(&session.template, &token) {
        Ok(l) => l,
        Err(e) => return End::Fatal(e),
    };
    let on_event = |event| match event {
        Event::Live => {
            *live_at = Some(Instant::now());
            set_state(app, account_id, generation, LiveState::Live { since: now() });
        }
        Event::Message(incoming) => {
            let _ = app.emit("hx-message", MessageEvent { account_id, incoming });
        }
        Event::Log(line) => {
            let _ = app.emit("hx-log", LogEvent { account_id, at: now(), line });
        }
    };
    match run_session(link(&session, &login, true), outbox, seen, on_event).await {
        // Only a cached token is worth replacing: the next attempt asks for a new one.
        End::Fatal(e @ HxError::Rejected { .. }) => {
            session.forget_token(app);
            if source == TokenSource::Cached { End::Retry(e) } else { End::Fatal(e) }
        }
        end => end,
    }
}

// ---------- sending ----------

/// Sends one message and waits for the server's ACK: through the account's
/// live connection when one is open, else over a one-off login.
pub async fn send(app: &AppHandle, session: &Session, message: TextMessage) -> Result<SendAck, CommandError> {
    match send_live(app, session.account_id, message.clone()).await {
        Some(ack) => Ok(ack?),
        None => send_once(app, session, message).await,
    }
}

/// `None` when the account has no live connection.
async fn send_live(app: &AppHandle, account_id: Uuid, message: TextMessage) -> Option<Result<SendAck, HxError>> {
    let outbox = {
        let listeners = app.state::<Listeners>();
        let running = listeners.lock();
        let handle = running.get(&account_id)?;
        if !matches!(handle.state, LiveState::Live { .. }) {
            return Some(Err(HxError::Tcp("đang kết nối server chat, chưa gửi. Thử lại sau ít giây".into())));
        }
        handle.outbox.clone()
    };
    let (reply, answer) = oneshot::channel();
    if outbox.send(Outgoing { message, reply }).await.is_err() {
        return Some(Err(HxError::Tcp("kết nối vừa đóng, chưa gửi".into())));
    }
    Some(answer.await.unwrap_or_else(|_| Err(HxError::SendUnknown("mất kết nối trước khi có ACK".into()))))
}

async fn send_once(app: &AppHandle, session: &Session, message: TextMessage) -> Result<SendAck, CommandError> {
    let message = &message;
    let attempt = |token: String| async move {
        let login = hx::build_login_frame(&session.template, &token)?;
        session::send_once(link(session, &login, false), message.clone()).await
    };
    let (token, source, _) = session.token(app).await?;
    let result = match attempt(token).await {
        // Refused at login, so nothing was written: safe to try once more with a new token.
        Err(HxError::Rejected { .. }) if source == TokenSource::Cached => {
            session.forget_token(app);
            let (token, ..) = session.token(app).await?;
            attempt(token).await
        }
        other => other,
    };
    if matches!(result, Err(HxError::Rejected { .. })) {
        session.forget_token(app);
    }
    Ok(result?)
}

// ---------- tauri commands ----------

/// Starts the live connection of an account; its progress comes as "hx-status" events.
#[tauri::command]
pub fn hx_listen_start(app: AppHandle, account_id: Uuid) -> LiveState {
    start(&app, account_id)
}

#[tauri::command]
pub fn hx_listen_stop(app: AppHandle, account_id: Uuid) {
    stop(&app, account_id);
}

/// The running listeners and their states.
#[tauri::command]
pub fn hx_listen_status(app: AppHandle) -> HashMap<Uuid, LiveState> {
    app.state::<Listeners>().lock().iter().map(|(id, h)| (*id, h.state.clone())).collect()
}
