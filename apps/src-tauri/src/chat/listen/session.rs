//! One login to the IM server and everything on it until it ends: the
//! handshake, pulling the queues the server names, the UNREAD heartbeat, and
//! the messages written through it with their ACKs. No Tauri here: what
//! happens is reported through an [`Event`] callback (mod.rs turns it into
//! webview events).
//!
//! A live connection pulls queues (`Link::sync`); a one-off send
//! ([`send_once`]) does not, it only logs in, writes and waits for the ACK.

use std::collections::{HashMap, HashSet, VecDeque};
use std::time::Duration;

use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};
use tokio::time::{Instant, sleep_until, timeout, timeout_at};

use crate::chat::hx::{self, ChatMessage, HxError, SendAck, TextMessage};
use crate::net::inspect;
use crate::chat::msync::{self, Frame, SyncResponse};
use crate::net::proxy::{self, ConnectError, Proxy};

/// Queues waiting to be pulled.
const MAX_QUEUES: usize = 1000;
/// Pages pulled from one queue in one go.
const MAX_PAGES: u32 = 1000;
/// Message ids remembered, so a message pulled twice is shown once.
const MAX_SEEN: usize = 5000;
/// Messages sent and not yet acknowledged.
pub(crate) const MAX_ACKS: usize = 16;

#[derive(Debug, Clone, Copy)]
pub(crate) struct Timing {
    pub connect: Duration,
    /// For the login, UNREAD and SYNC answers and each write.
    pub response: Duration,
    pub heartbeat: Duration,
    pub ack: Duration,
}

pub(crate) const TIMING: Timing = Timing {
    connect: Duration::from_secs(8),
    response: Duration::from_secs(15),
    heartbeat: Duration::from_secs(30),
    ack: Duration::from_secs(15),
};

/// Why a session ended.
#[derive(Debug)]
pub(crate) enum End {
    /// Worth connecting again after a pause.
    Retry(HxError),
    /// Connecting again would end the same way (a refused login is `Fatal(HxError::Rejected)`).
    Fatal(HxError),
    /// The outbox closed and nothing is waiting for an ACK.
    Stopped,
}

impl From<HxError> for End {
    fn from(e: HxError) -> Self {
        let retry = match &e {
            HxError::Tcp(_) | HxError::Timeout | HxError::Discovery(_) => true,
            // A wrong IM password stays wrong; a network failure does not.
            HxError::Token(m) => !m.starts_with("HTTP 4"),
            _ => false,
        };
        if retry { End::Retry(e) } else { End::Fatal(e) }
    }
}

fn tcp(message: impl Into<String>) -> End {
    End::Retry(HxError::Tcp(message.into()))
}

fn io(e: std::io::Error) -> End {
    tcp(e.kind().to_string())
}

/// A message to write, and where its ACK goes.
pub(crate) struct Outgoing {
    pub message: TextMessage,
    pub reply: oneshot::Sender<Result<SendAck, HxError>>,
}

/// A new chat message and the conversation it belongs to.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Incoming {
    /// The peer's IM id (one-to-one) or the group id.
    pub conversation_id: String,
    /// 0 one-to-one, 1 group.
    pub conversation_type: u8,
    pub message: ChatMessage,
}

/// Which way a frame went.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Dir {
    In,
    Out,
}

/// What the log says about one frame. Never holds a token or message text.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    /// login, unread, notice, sync, send, ack, logout, unsupported, unknown.
    pub kind: &'static str,
    /// One line for the list.
    pub summary: String,
    /// Name and value pairs for the details.
    pub info: Vec<(&'static str, String)>,
}

impl Note {
    fn new(kind: &'static str, summary: impl Into<String>, info: Vec<(&'static str, String)>) -> Self {
        Note { kind, summary: summary.into(), info }
    }
}

/// One frame in or out, for the connection log.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub dir: Dir,
    /// Frame size, length prefix included.
    pub bytes: usize,
    #[serde(flatten)]
    pub note: Note,
    /// The whole frame as a field tree, secrets masked (inspect::proto_dump).
    pub data: String,
}

fn code(status: &Option<String>) -> String {
    status.clone().unwrap_or_else(|| "?".into())
}

fn queue_name(queue: &[u8]) -> String {
    msync::queue_id(queue).unwrap_or_else(|| "?".into())
}

/// The log note of a frame from the server.
fn note_in(frame: &Frame) -> Note {
    match frame {
        Frame::Login { status } => Note::new("login", format!("code={}", code(status)), vec![("code", code(status))]),
        Frame::Unread { status, queues } => {
            let names: Vec<String> = queues.iter().map(|q| queue_name(q)).collect();
            Note::new(
                "unread",
                format!("code={}, {} queue", code(status), queues.len()),
                vec![("code", code(status)), ("queue", names.join(", "))],
            )
        }
        Frame::Notice { queue } => {
            let name = queue.as_deref().map(queue_name).unwrap_or_default();
            Note::new("notice", name.clone(), vec![("queue", name)])
        }
        Frame::Sync(r) if r.metas.is_empty() && r.local_id.is_some() => {
            let local_id = r.local_id.clone().unwrap_or_default();
            let server_id = r.server_id.clone().unwrap_or_default();
            Note::new(
                "ack",
                format!("local id {local_id}, code={}", code(&r.status)),
                vec![("local id", local_id), ("code", code(&r.status)), ("server id", server_id)],
            )
        }
        Frame::Sync(r) => {
            let ids: Vec<String> = r.metas.iter().filter_map(|m| hx::decode_meta(m).ok().flatten()).map(|(m, _)| m.id).collect();
            Note::new(
                "sync",
                format!("code={}, {} tin{}", code(&r.status), r.metas.len(), if r.is_last { ", hết" } else { "" }),
                vec![
                    ("code", code(&r.status)),
                    ("queue", r.queue.as_deref().map(queue_name).unwrap_or_default()),
                    ("số tin", r.metas.len().to_string()),
                    ("id tin chat", ids.join(", ")),
                    ("trang cuối", if r.is_last { "có" } else { "không" }.into()),
                    ("cursor tiếp", r.next_key.map(|k| k.to_string()).unwrap_or_default()),
                ],
            )
        }
        Frame::Logout => Note::new("logout", "server đăng xuất client này", vec![]),
        Frame::Unsupported(what) => Note::new("unsupported", *what, vec![("loại", (*what).into())]),
        Frame::Unknown(command) => Note::new("unknown", format!("command={command}"), vec![("command", command.to_string())]),
    }
}

/// How a frame that does not belong where it came ends the session.
fn unexpected(frame: Frame) -> End {
    match frame {
        Frame::Logout => End::Fatal(HxError::Tcp("server chat đã đăng xuất client này (có thể do đăng nhập ở nơi khác)".into())),
        Frame::Unsupported(what) => End::Fatal(HxError::Tcp(format!("server chat gửi frame {what}, chưa hỗ trợ"))),
        _ => tcp("server chat trả lời sai thứ tự khi đăng nhập"),
    }
}

/// What a session reports while it runs.
#[derive(Debug)]
pub(crate) enum Event {
    /// Logged in and the first UNREAD answered.
    Live,
    Message(Incoming),
    Log(LogLine),
}

/// Message ids already shown, the oldest forgotten first.
#[derive(Default)]
pub(crate) struct Seen {
    ids: HashSet<String>,
    order: VecDeque<String>,
}

impl Seen {
    /// False when `id` was seen before.
    fn insert(&mut self, id: &str) -> bool {
        if self.ids.contains(id) {
            return false;
        }
        if self.order.len() >= MAX_SEEN
            && let Some(old) = self.order.pop_front()
        {
            self.ids.remove(&old);
        }
        self.ids.insert(id.to_owned());
        self.order.push_back(id.to_owned());
        true
    }
}

/// The conversation of a message, from `me`'s side. Only chat messages count
/// (body type 0 normal, 1 chat, 2 group chat); acks, recalls and the like do not.
fn incoming(message: ChatMessage, kind: u64, me: &str) -> Option<Incoming> {
    let (conversation_id, conversation_type) = match kind {
        0 | 1 if message.from.as_deref() == Some(me) => (message.to.clone()?, 0),
        0 | 1 => (message.from.clone()?, 0),
        2 => (message.to.clone()?, 1),
        _ => return None,
    };
    Some(Incoming { conversation_id, conversation_type, message })
}

/// Where and as whom to log in.
pub(crate) struct Link<'a> {
    pub host: &'a str,
    pub port: u16,
    /// The full login frame, token filled in.
    pub login: &'a [u8],
    pub me: &'a str,
    pub timing: Timing,
    /// Pull the queues the server names (a live connection); false for a one-off send.
    pub sync: bool,
    /// The account's proxy, when it has one turned on.
    pub proxy: Option<&'a Proxy>,
}

/// Logs in and runs until the connection ends, or until `outbox` closes with
/// no ACK still awaited.
pub(crate) async fn run_session(
    link: Link<'_>,
    outbox: &mut mpsc::Receiver<Outgoing>,
    seen: &mut Seen,
    on_event: impl FnMut(Event),
) -> End {
    // Through the account's proxy when it has one turned on; it may pass on the server's first bytes with its reply.
    let (stream, early) = match proxy::connect(link.host, link.port, link.proxy, link.timing.connect).await {
        Ok(connected) => connected,
        Err(ConnectError::Io(e)) => return io(e),
        Err(ConnectError::Timeout(m)) if link.proxy.is_some() => return tcp(m),
        Err(ConnectError::Timeout(_)) => return End::Retry(HxError::Timeout),
        Err(ConnectError::Proxy(m)) => return tcp(m),
    };
    let mut conn = Conn {
        stream,
        buf: early,
        me: link.me,
        timing: link.timing,
        sync: link.sync,
        seen,
        on_event,
        pending: VecDeque::new(),
        current: None,
        acks: HashMap::new(),
        unread_due: None,
        sync_due: None,
    };
    let end = match conn.handshake(link.login).await {
        Ok(()) => {
            (conn.on_event)(Event::Live);
            match conn.next_queue().await {
                Ok(()) => conn.listen(outbox).await,
                Err(end) => end,
            }
        }
        Err(end) => end,
    };
    // Sends still waiting learn that their ACK will not come.
    for (_, (reply, _)) in conn.acks.drain() {
        let _ = reply.send(Err(HxError::SendUnknown("mất kết nối trước khi có ACK".into())));
    }
    end
}

/// A one-off login that writes `message`, waits for its ACK and disconnects.
/// An error before the message is written means it was not sent; after, the
/// error is `SendUnknown`.
pub(crate) async fn send_once(link: Link<'_>, message: TextMessage) -> Result<SendAck, HxError> {
    let (outbox, mut inbox) = mpsc::channel(1);
    let (reply, answer) = oneshot::channel();
    outbox.try_send(Outgoing { message, reply }).expect("a new channel has room");
    drop(outbox); // so the session ends once the ACK is in
    let end = run_session(Link { sync: false, ..link }, &mut inbox, &mut Seen::default(), |_| {}).await;
    drop(inbox); // a message never written goes with it, and its reply with it
    match answer.await {
        Ok(result) => result,
        Err(_) => Err(match end {
            End::Retry(e) | End::Fatal(e) => e,
            End::Stopped => HxError::Tcp("phiên kết thúc trước khi gửi".into()),
        }),
    }
}

/// A queue being pulled.
struct Pull {
    id: String,
    queue: Vec<u8>,
    cursors: HashSet<u64>,
    pages: u32,
    /// A NOTICE came for it meanwhile: pull it again when done.
    dirty: bool,
}

struct Conn<'a, F> {
    stream: TcpStream,
    buf: Vec<u8>,
    me: &'a str,
    timing: Timing,
    sync: bool,
    seen: &'a mut Seen,
    on_event: F,
    /// Queues waiting to be pulled, by identity, in order.
    pending: VecDeque<(String, Vec<u8>)>,
    current: Option<Pull>,
    /// Sent messages by local id: where the ACK goes, and until when it may come.
    acks: HashMap<String, (oneshot::Sender<Result<SendAck, HxError>>, Instant)>,
    unread_due: Option<Instant>,
    sync_due: Option<Instant>,
}

impl<F: FnMut(Event)> Conn<'_, F> {
    // ----- bytes and frames -----

    async fn write(&mut self, bytes: &[u8], note: Note) -> Result<(), End> {
        match timeout(self.timing.response, self.stream.write_all(bytes)).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(io(e)),
            Err(_) => return Err(tcp("hết thời gian chờ ghi lên server chat")),
        }
        let data = inspect::proto_dump(&bytes[4..]);
        (self.on_event)(Event::Log(LogLine { dir: Dir::Out, bytes: bytes.len(), note, data }));
        Ok(())
    }

    /// Decodes a frame from the server and logs it.
    fn decode(&mut self, frame: &[u8]) -> Result<Frame, End> {
        let decoded = msync::decode(frame)?;
        let line = LogLine { dir: Dir::In, bytes: frame.len() + 4, note: note_in(&decoded), data: inspect::proto_dump(frame) };
        (self.on_event)(Event::Log(line));
        Ok(decoded)
    }

    /// The next whole frame already read, if any.
    fn take_frame(&mut self) -> Result<Option<Vec<u8>>, End> {
        let Some(len) = self.buf.get(..4) else { return Ok(None) };
        let len = u32::from_be_bytes(len.try_into().expect("4 bytes")) as usize;
        if len == 0 || len > hx::MAX_FRAME_BYTES {
            return Err(tcp("độ dài frame không hợp lệ"));
        }
        if self.buf.len() < len + 4 {
            return Ok(None);
        }
        let frame = self.buf[4..len + 4].to_vec();
        self.buf.drain(..len + 4);
        Ok(Some(frame))
    }

    /// Reads more bytes. Cancel safe (used in `select!`).
    async fn read_more(&mut self) -> Result<(), End> {
        match self.stream.read_buf(&mut self.buf).await {
            Ok(0) => Err(tcp("server chat đóng kết nối")),
            Ok(_) => Ok(()),
            Err(e) => Err(io(e)),
        }
    }

    async fn next_frame(&mut self, due: Instant) -> Result<Frame, End> {
        loop {
            if let Some(frame) = self.take_frame()? {
                return self.decode(&frame);
            }
            timeout_at(due, self.read_more()).await.map_err(|_| End::Retry(HxError::Timeout))??;
        }
    }

    // ----- login -----

    /// Login, then the first UNREAD (NOTICEs meanwhile are kept).
    async fn handshake(&mut self, login: &[u8]) -> Result<(), End> {
        self.write(login, Note::new("login", "", vec![("command", "3 PROVISION".into())])).await?;
        let code = match self.next_frame(Instant::now() + self.timing.response).await? {
            Frame::Login { status } => code(&status),
            other => return Err(unexpected(other)),
        };
        if code != "0" {
            return Err(End::Fatal(HxError::Rejected { step: "login", kind: "3".into(), code }));
        }
        self.unread().await?;
        loop {
            let due = self.unread_due.expect("UNREAD just sent");
            match self.next_frame(due).await? {
                Frame::Unread { status, queues } => return self.on_unread(status, queues),
                Frame::Notice { queue } => self.enqueue_notice(queue)?,
                other => return Err(unexpected(other)),
            }
        }
    }


    // ----- listening -----

    async fn listen(&mut self, outbox: &mut mpsc::Receiver<Outgoing>) -> End {
        let mut heartbeat = tokio::time::interval_at(Instant::now() + self.timing.heartbeat, self.timing.heartbeat);
        heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut open = true;
        loop {
            if !open && self.acks.is_empty() {
                return End::Stopped;
            }
            let due = [self.unread_due, self.sync_due].into_iter().flatten().chain(self.acks.values().map(|a| a.1)).min();
            let step = tokio::select! {
                read = self.read_more() => match read {
                    Ok(()) => self.handle_frames().await,
                    Err(end) => Err(end),
                },
                out = outbox.recv(), if open => match out {
                    Some(out) => self.send(out).await,
                    None => {
                        open = false;
                        Ok(())
                    }
                },
                _ = heartbeat.tick() => match self.unread_due {
                    None => self.unread().await,
                    Some(_) => Ok(()),
                },
                _ = sleep_until(due.unwrap_or_else(Instant::now)), if due.is_some() => self.expire(),
            };
            if let Err(end) = step {
                return end;
            }
        }
    }

    async fn handle_frames(&mut self) -> Result<(), End> {
        while let Some(frame) = self.take_frame()? {
            match self.decode(&frame)? {
                Frame::Unread { status, queues } => {
                    self.on_unread(status, queues)?;
                    self.next_queue().await?;
                }
                Frame::Notice { queue } => {
                    self.enqueue_notice(queue)?;
                    self.next_queue().await?;
                }
                Frame::Sync(response) => self.on_sync(&frame, response).await?,
                Frame::Login { .. } | Frame::Unknown(_) => {}
                other => return Err(unexpected(other)),
            }
        }
        Ok(())
    }

    /// Times out an awaited answer: UNREAD and SYNC end the session, a late ACK only its send.
    fn expire(&mut self) -> Result<(), End> {
        let now = Instant::now();
        if self.unread_due.is_some_and(|d| d <= now) {
            return Err(tcp("server chat không trả lời UNREAD"));
        }
        if self.sync_due.is_some_and(|d| d <= now) {
            return Err(tcp("server chat không trả lời SYNC"));
        }
        let late: Vec<String> = self.acks.iter().filter(|(_, (_, d))| *d <= now).map(|(id, _)| id.clone()).collect();
        for id in late {
            if let Some((reply, _)) = self.acks.remove(&id) {
                let _ = reply.send(Err(HxError::SendUnknown(format!("không có ACK sau {} s", self.timing.ack.as_secs()))));
            }
        }
        Ok(())
    }

    // ----- UNREAD and NOTICE -----

    async fn unread(&mut self) -> Result<(), End> {
        self.write(&hx::FOLLOWUP_FRAME, Note::new("unread", "", vec![("command", "1 UNREAD".into())])).await?;
        self.unread_due = Some(Instant::now() + self.timing.response);
        Ok(())
    }

    fn on_unread(&mut self, status: Option<String>, queues: Vec<Vec<u8>>) -> Result<(), End> {
        let code = code(&status);
        if code != "0" {
            return Err(tcp(format!("server chat từ chối UNREAD (code={code})")));
        }
        self.unread_due = None;
        queues.into_iter().try_for_each(|q| self.enqueue(q, false))
    }

    fn enqueue_notice(&mut self, queue: Option<Vec<u8>>) -> Result<(), End> {
        queue.map_or(Ok(()), |q| self.enqueue(q, true))
    }

    // ----- SYNC: pulling queues -----

    fn enqueue(&mut self, queue: Vec<u8>, notice: bool) -> Result<(), End> {
        let Some(id) = msync::queue_id(&queue) else { return Ok(()) };
        if let Some(current) = self.current.as_mut().filter(|c| c.id == id) {
            current.dirty |= notice;
            return Ok(());
        }
        if self.pending.iter().any(|(p, _)| *p == id) {
            return Ok(());
        }
        if self.pending.len() >= MAX_QUEUES {
            return Err(tcp("quá nhiều queue chờ đồng bộ"));
        }
        self.pending.push_back((id, queue));
        Ok(())
    }

    /// Starts pulling the next waiting queue when none is being pulled.
    async fn next_queue(&mut self) -> Result<(), End> {
        if !self.sync || self.current.is_some() {
            return Ok(());
        }
        let Some((id, queue)) = self.pending.pop_front() else { return Ok(()) };
        self.current = Some(Pull { id, queue, cursors: HashSet::new(), pages: 0, dirty: false });
        self.pull(None).await
    }

    async fn pull(&mut self, key: Option<u64>) -> Result<(), End> {
        let pull = self.current.as_mut().expect("a queue is being pulled");
        pull.pages += 1;
        if pull.pages > MAX_PAGES {
            return Err(tcp("quá nhiều trang SYNC cho một queue"));
        }
        let frame = msync::sync_frame(&pull.queue, key);
        let note = Note::new(
            "sync",
            format!("{} trang {}", pull.id, pull.pages),
            vec![
                ("command", "0 SYNC".into()),
                ("queue", pull.id.clone()),
                ("trang", pull.pages.to_string()),
                ("cursor", key.map(|k| k.to_string()).unwrap_or_else(|| "đầu".into())),
            ],
        );
        self.write(&frame, note).await?;
        self.sync_due = Some(Instant::now() + self.timing.response);
        Ok(())
    }

    async fn on_sync(&mut self, frame: &[u8], response: SyncResponse) -> Result<(), End> {
        if response.metas.is_empty()
            && let Some(local_id) = &response.local_id
        {
            self.on_ack(frame, local_id);
            return Ok(());
        }
        let code = code(&response.status);
        if code != "0" {
            return Err(tcp(format!("server chat từ chối SYNC (code={code})")));
        }
        self.show(&response.metas);
        let Some(pull) = self.current.as_mut() else { return Ok(()) };
        if response.queue.as_deref().is_some_and(|q| msync::queue_id(q).as_deref() != Some(&pull.id)) {
            return Err(tcp("server chat trả SYNC của queue khác"));
        }
        self.sync_due = None;
        if response.is_last {
            let done = self.current.take().expect("checked above");
            if done.dirty {
                self.pending.push_back((done.id, done.queue));
            }
            return self.next_queue().await;
        }
        match response.next_key {
            Some(key) if key != 0 && pull.cursors.insert(key) => self.pull(Some(key)).await,
            _ => Err(tcp("cursor SYNC thiếu hoặc bị lặp")),
        }
    }

    /// Reports each new chat message of a page. One that does not decode is
    /// skipped, not fatal: the rest of the page still counts.
    fn show(&mut self, metas: &[Vec<u8>]) {
        for meta in metas {
            let Ok(Some((message, kind))) = hx::decode_meta(meta) else { continue };
            if self.seen.insert(&message.id)
                && let Some(event) = incoming(message, kind, self.me)
            {
                (self.on_event)(Event::Message(event));
            }
        }
    }

    // ----- sending -----

    async fn send(&mut self, out: Outgoing) -> Result<(), End> {
        if self.acks.len() >= MAX_ACKS || self.acks.contains_key(&out.message.local_id) {
            let _ = out.reply.send(Err(HxError::Invalid("Đang chờ ACK của quá nhiều tin, thử lại sau".into())));
            return Ok(());
        }
        let local_id = out.message.local_id.clone();
        let note = Note::new("send", format!("local id {local_id}"), vec![("command", "0 SYNC (gửi tin)".into()), ("local id", local_id)]);
        if let Err(end) = self.write(&out.message.frame, note).await {
            let _ = out.reply.send(Err(HxError::SendUnknown("mất kết nối khi đang gửi".into())));
            return Err(end);
        }
        self.acks.insert(out.message.local_id, (out.reply, Instant::now() + self.timing.ack));
        Ok(())
    }

    /// The ACK of a message sent through this connection (others' are ignored).
    fn on_ack(&mut self, frame: &[u8], local_id: &str) {
        let Some((reply, _)) = self.acks.remove(local_id) else { return };
        let ack = hx::read_send_response(frame, local_id)
            .and_then(|a| a.ok_or_else(|| HxError::SendUnknown("ACK không khớp".into())));
        let _ = reply.send(ack);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::hx::{Value, read_fields, write_fields};
    use crate::chat::msync::tests::{b, ok, queue, response, v};
    use tokio::net::TcpListener;

    const ME: &str = "love_me";
    const FAST: Timing = Timing {
        connect: Duration::from_secs(2),
        response: Duration::from_millis(500),
        heartbeat: Duration::from_millis(40),
        ack: Duration::from_millis(300),
    };
    /// A login frame (command 3); the fake server does not read it.
    const LOGIN: &[u8] = b"\x00\x00\x00\x02\x40\x03";

    fn link(port: u16, sync: bool) -> Link<'static> {
        Link { host: "127.0.0.1", port, login: LOGIN, me: ME, timing: FAST, sync, proxy: None }
    }

    /// Bytes field `n` of a protobuf message.
    fn field(message: &[u8], n: u32) -> Vec<u8> {
        match hx::get(&read_fields(message).unwrap(), n) {
            Some(Value::Bytes(b)) => b.clone(),
            other => panic!("field {n}: {other:?}"),
        }
    }

    /// The `Meta` of a text message from `from` to `to` with server id `id`.
    fn meta(from: &str, to: &str, id: u64) -> Vec<u8> {
        let m = hx::build_text_message(from, to, "xin chào", id, "mark").unwrap();
        field(&field(&m.frame[4..], 9), 1)
    }

    fn command(payload: &[u8]) -> u64 {
        match hx::get(&read_fields(payload).unwrap(), 8) {
            Some(Value::Varint(c)) => *c,
            _ => panic!("no command"),
        }
    }

    /// The local id of a sent message frame.
    fn local_id(payload: &[u8]) -> u64 {
        match hx::get(&read_fields(&field(&field(payload, 9), 1)).unwrap(), 1) {
            Some(Value::Varint(id)) => *id,
            other => panic!("not a message: {other:?}"),
        }
    }

    fn login_answer(code: u64) -> Vec<u8> {
        write_fields(&[v(8, 3), b(9, write_fields(&[b(8, write_fields(&[v(1, code)]))]))])
    }

    fn ack(local: u64, code: u64, server_id: Option<u64>) -> Vec<u8> {
        let mut body = vec![b(1, write_fields(&[v(1, code)])), v(2, local)];
        body.extend(server_id.map(|id| v(3, id)));
        response(0, &body)
    }

    fn describe(end: End) -> (&'static str, String) {
        match end {
            End::Retry(e) => ("retry", e.to_string()),
            End::Fatal(e) => ("fatal", e.to_string()),
            End::Stopped => ("stopped", String::new()),
        }
    }

    /// A server that answers each client frame with what `reply` returns (an
    /// empty frame closes the connection), and hands back every frame it got.
    async fn server(
        mut reply: impl FnMut(&[u8]) -> Vec<Vec<u8>> + Send + 'static,
    ) -> (u16, tokio::task::JoinHandle<Vec<Vec<u8>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            // Without it, Nagle plus delayed ACKs hold a second small write ~40 ms on Linux.
            socket.set_nodelay(true).unwrap();
            let mut got = Vec::new();
            loop {
                let mut len = [0u8; 4];
                if socket.read_exact(&mut len).await.is_err() {
                    return got;
                }
                let mut payload = vec![0u8; u32::from_be_bytes(len) as usize];
                socket.read_exact(&mut payload).await.unwrap();
                let replies = reply(&payload);
                let close = replies.iter().any(Vec::is_empty);
                // All frames of one reply in one write.
                let bytes: Vec<u8> = replies.iter().take_while(|f| !f.is_empty()).flat_map(|f| hx::frame(f)).collect();
                if !bytes.is_empty() && socket.write_all(&bytes).await.is_err() {
                    return got;
                }
                if close {
                    return got;
                }
                got.push(payload);
            }
        });
        (port, task)
    }

    /// Runs a live session; returns how it ended, whether it went live, the messages and the log.
    async fn live(port: u16, outbox: &mut mpsc::Receiver<Outgoing>) -> (End, bool, Vec<Incoming>, Vec<LogLine>) {
        let (mut went_live, mut messages, mut log) = (false, Vec::new(), Vec::new());
        let end = run_session(link(port, true), outbox, &mut Seen::default(), |e| match e {
            Event::Live => went_live = true,
            Event::Message(m) => messages.push(m),
            Event::Log(l) => log.push(l),
        })
        .await;
        (end, went_live, messages, log)
    }

    #[tokio::test]
    async fn pulls_every_page_shows_each_message_once_and_keeps_polling_unread() {
        let mut unreads = 0;
        let (port, server) = server(move |p| match command(p) {
            3 => vec![login_answer(0)],
            1 => {
                unreads += 1;
                match unreads {
                    1 => vec![response(1, &[ok(), b(2, write_fields(&[b(1, queue("alice")), v(2, 2)]))])],
                    2 => vec![response(1, &[ok()])],
                    _ => vec![vec![]],
                }
            }
            _ => match hx::get(&read_fields(&field(p, 9)).unwrap(), 2) {
                None => vec![response(0, &[ok(), b(4, meta("alice", ME, 11)), v(5, 7), b(6, queue("alice")), v(7, 0)])],
                Some(Value::Varint(7)) => vec![response(
                    0,
                    &[ok(), b(4, meta("alice", ME, 11)), b(4, meta(ME, "alice", 12)), b(6, queue("alice")), v(7, 1)],
                )],
                other => panic!("cursor {other:?}"),
            },
        })
        .await;
        let (_tx, mut rx) = mpsc::channel(1);
        let (end, went_live, messages, log) = live(port, &mut rx).await;
        assert!(went_live);
        assert_eq!(describe(end), ("retry", "Kết nối TCP thất bại: server chat đóng kết nối".into()));
        let ids: Vec<_> = messages.iter().map(|m| (m.message.id.as_str(), m.conversation_id.as_str(), m.conversation_type)).collect();
        assert_eq!(ids, [("11", "alice", 0), ("12", "alice", 0)], "the repeated message shows once; mine goes to the peer's conversation");
        let commands: Vec<_> = server.await.unwrap().iter().map(|p| command(p)).collect();
        assert_eq!(commands[..3], [3, 1, 0]);
        assert_eq!(commands.iter().filter(|&&c| c == 0).count(), 2, "two pages, then nothing left to pull");
        let first: Vec<_> = log.iter().take(5).map(|l| (l.dir, l.note.kind)).collect();
        assert_eq!(first, [(Dir::Out, "login"), (Dir::In, "login"), (Dir::Out, "unread"), (Dir::In, "unread"), (Dir::Out, "sync")]);
        let last_page = log.iter().find(|l| l.dir == Dir::In && l.note.summary == "code=0, 2 tin, hết").expect("last page logged");
        assert!(last_page.note.info.contains(&("id tin chat", "11, 12".into())), "{:?}", last_page.note.info);
        assert!(log.iter().all(|l| l.bytes > 4 && !l.data.is_empty()));
        assert!(last_page.data.contains("xin chào"), "the page's messages are in its data: {}", last_page.data);
    }

    #[tokio::test]
    async fn notice_requeues_a_queue_being_pulled() {
        let mut syncs = 0;
        let (port, server) = server(move |p| match command(p) {
            3 => vec![login_answer(0)],
            1 => vec![response(1, &[ok(), b(2, write_fields(&[b(1, queue("bob"))]))])],
            _ => {
                syncs += 1;
                match syncs {
                    1 => vec![response(2, &[b(1, queue("bob"))]), response(0, &[ok(), b(6, queue("bob")), v(7, 1)])],
                    2 => vec![response(0, &[ok(), b(4, meta("bob", ME, 5)), b(6, queue("bob")), v(7, 1)])],
                    _ => vec![vec![]],
                }
            }
        })
        .await;
        let (_tx, mut rx) = mpsc::channel(1);
        let (_, _, messages, _) = live(port, &mut rx).await;
        assert_eq!(messages.len(), 1);
        assert_eq!(server.await.unwrap().iter().filter(|p| command(p) == 0).count(), 2);
    }

    #[tokio::test]
    async fn sends_through_a_live_session_and_returns_the_ack() {
        let (port, _server) = server(|p| match command(p) {
            3 => vec![login_answer(0)],
            1 => vec![response(1, &[ok()])],
            _ => vec![ack(local_id(p), 0, Some(777))],
        })
        .await;
        let (tx, mut rx) = mpsc::channel(1);
        let client = tokio::spawn(async move { describe(live(port, &mut rx).await.0) });
        let (reply, answer) = oneshot::channel();
        // Queued until the session is live and reading its outbox.
        tx.send(Outgoing { message: hx::build_text_message(ME, "alice", "hi", 123, "m").unwrap(), reply }).await.unwrap();
        let ack = answer.await.unwrap().unwrap();
        assert_eq!((ack.accepted, ack.server_id.as_str()), (true, "777"));
        drop(tx);
        assert_eq!(client.await.unwrap().0, "stopped");
    }

    #[tokio::test]
    async fn an_unanswered_send_is_reported_unknown_without_dropping_the_connection() {
        let mut unreads = 0;
        let (port, _server) = server(move |p| match command(p) {
            3 => vec![login_answer(0)],
            1 => {
                unreads += 1;
                if unreads < 12 { vec![response(1, &[ok()])] } else { vec![vec![]] }
            }
            _ => vec![],
        })
        .await;
        let (tx, mut rx) = mpsc::channel(1);
        let client = tokio::spawn(async move { describe(live(port, &mut rx).await.0) });
        let (reply, answer) = oneshot::channel();
        tx.send(Outgoing { message: hx::build_text_message(ME, "alice", "hi", 9, "m").unwrap(), reply }).await.unwrap();
        assert!(matches!(answer.await.unwrap(), Err(HxError::SendUnknown(_))));
        // Still listening afterwards, until the server goes away.
        assert_eq!(client.await.unwrap().1, "Kết nối TCP thất bại: server chat đóng kết nối");
    }

    #[tokio::test]
    async fn refused_login_logout_and_silence_end_a_live_session() {
        let (_tx, mut rx) = mpsc::channel(1);
        let (port, _s) = server(|_| vec![login_answer(8)]).await;
        let (end, went_live, ..) = live(port, &mut rx).await;
        assert!(matches!(end, End::Fatal(HxError::Rejected { ref code, .. }) if code == "8"));
        assert!(!went_live);

        let (port, _s) = server(|p| if command(p) == 3 { vec![login_answer(0)] } else { vec![write_fields(&[v(8, 4)])] }).await;
        let (end, ..) = live(port, &mut rx).await;
        assert!(matches!(&end, End::Fatal(e) if e.to_string().contains("đăng xuất")), "{end:?}");

        let (port, _s) = server(|p| if command(p) == 3 { vec![login_answer(0)] } else { vec![] }).await;
        assert!(matches!(live(port, &mut rx).await.0, End::Retry(HxError::Timeout)));
    }

    #[tokio::test]
    async fn send_once_logs_in_writes_and_waits_for_its_own_ack_without_pulling() {
        let message = hx::build_text_message(ME, "alice", "hi", 4242, "m").unwrap();
        let (port, server) = server(|p| match command(p) {
            3 => vec![login_answer(0)],
            // A queue is named, but a one-off send pulls nothing.
            1 => vec![response(1, &[ok(), b(2, write_fields(&[b(1, queue("bob"))]))])],
            // Another message's ACK first: skipped.
            _ => vec![ack(1, 0, Some(5)), ack(local_id(p), 0, Some(1234567890123456789))],
        })
        .await;
        let ack = send_once(link(port, true), message.clone()).await.unwrap();
        assert_eq!((ack.accepted, ack.server_id.as_str()), (true, "1234567890123456789"));
        let frames = server.await.unwrap();
        assert_eq!(frames.iter().take(2).map(|p| command(p)).collect::<Vec<_>>(), [3, 1]);
        // Heartbeat UNREADs may come and go; the only command 0 is the message: no SYNC pull.
        let syncs: Vec<_> = frames.iter().filter(|p| command(p) == 0).collect();
        assert_eq!(syncs, [&message.frame[4..]]);
    }

    #[tokio::test]
    async fn send_once_reports_refusal_rejection_silence_and_no_server() {
        let message = || hx::build_text_message(ME, "alice", "hi", 4242, "m").unwrap();

        let (port, refused) = server(|_| vec![login_answer(5)]).await;
        let err = send_once(link(port, false), message()).await.unwrap_err();
        assert_eq!(err.to_string(), "Server chat từ chối bước login (type=3, code=5)");
        assert_eq!(refused.await.unwrap().len(), 1, "nothing written after the refused login");

        let (port, _s) = server(|p| match command(p) {
            3 => vec![login_answer(0)],
            1 => vec![response(1, &[ok()])],
            _ => vec![ack(local_id(p), 508, None)],
        })
        .await;
        let ack = send_once(link(port, false), message()).await.unwrap();
        assert_eq!((ack.accepted, ack.code.as_str()), (false, "508"));

        let (port, _s) = server(|p| match command(p) {
            3 => vec![login_answer(0)],
            1 => vec![response(1, &[ok()])],
            _ => vec![],
        })
        .await;
        assert!(matches!(send_once(link(port, false), message()).await, Err(HxError::SendUnknown(_))));

        let closed = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = closed.local_addr().unwrap().port();
        drop(closed);
        assert!(matches!(send_once(link(port, false), message()).await, Err(HxError::Tcp(_))));
    }

    #[test]
    fn only_chat_messages_make_events() {
        let message = |from: &str, to: &str| ChatMessage {
            id: "1".into(),
            from: Some(from.into()),
            to: Some(to.into()),
            timestamp: None,
            contents: vec![],
            sender: None,
        };
        assert_eq!(incoming(message("a", ME), 1, ME).unwrap().conversation_id, "a");
        assert_eq!(incoming(message(ME, "a"), 0, ME).unwrap().conversation_id, "a");
        let group = incoming(message("a", "g1"), 2, ME).unwrap();
        assert_eq!((group.conversation_id.as_str(), group.conversation_type), ("g1", 1));
        assert!(incoming(message("a", ME), 4, ME).is_none(), "read ack");
        assert!(incoming(message("a", ME), 6, ME).is_none(), "recall");
    }

    #[test]
    fn errors_sort_into_retry_or_stop() {
        assert!(matches!(End::from(HxError::Tcp("x".into())), End::Retry(_)));
        assert!(matches!(End::from(HxError::Token("HTTP 401".into())), End::Fatal(_)));
        assert!(matches!(End::from(HxError::Token("error sending request".into())), End::Retry(_)));
        assert!(matches!(End::from(HxError::Invalid("x".into())), End::Fatal(_)));
        let mut seen = Seen::default();
        assert!(seen.insert("1") && !seen.insert("1"));
    }
}
