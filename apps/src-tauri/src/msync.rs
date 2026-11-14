//! MSync frames of a live IM connection: what the server sends after login
//! (UNREAD answers, NOTICEs, SYNC pages and send ACKs), and the SYNC request
//! that pulls one queue. Pure decoding, no I/O (listen.rs does that).
//! Port of scripts/src/hyphenate/msync.ts and the frame helpers of listener.ts.
//!
//! Outer frame: 4 compression, 5 negotiation, 8 command (0 SYNC, 1 UNREAD,
//! 2 NOTICE, 3 PROVISION = login, 4 LOGOUT), 9 body, 11 encryption.

use crate::hx::{self, Field, HxError, Value, read_fields, write_fields};

/// Longest queue identity (a JID) accepted.
const MAX_QUEUE_BYTES: usize = 4096;

/// One frame from the server.
#[derive(Debug, PartialEq)]
pub enum Frame {
    /// Answer to the login frame; `status` "0" is success.
    Login { status: Option<String> },
    /// Answer to an UNREAD request: the queues that hold something.
    Unread { status: Option<String>, queues: Vec<Vec<u8>> },
    /// Something new in a queue.
    Notice { queue: Option<Vec<u8>> },
    /// The server ended this session (e.g. the same client logged in elsewhere).
    Logout,
    Sync(SyncResponse),
    /// Compressed or encrypted: not handled.
    Unsupported(&'static str),
    Unknown(u64),
}

/// A SYNC answer: a page of a queue, or the ACK of a sent message (`local_id`).
#[derive(Debug, Default, PartialEq)]
pub struct SyncResponse {
    pub status: Option<String>,
    pub local_id: Option<String>,
    /// Server id of an acknowledged message.
    pub server_id: Option<String>,
    /// Encoded `Meta`s (hx::decode_meta).
    pub metas: Vec<Vec<u8>>,
    pub next_key: Option<u64>,
    pub queue: Option<Vec<u8>>,
    pub is_last: bool,
}

fn bad_frame(_: HxError) -> HxError {
    HxError::Tcp("frame từ server không hợp lệ".into())
}

fn varint(fields: &[Field], number: u32) -> Option<u64> {
    match hx::get(fields, number) {
        Some(Value::Varint(v)) => Some(*v),
        _ => None,
    }
}

fn bytes(fields: &[Field], number: u32) -> Option<&[u8]> {
    match hx::get(fields, number) {
        Some(Value::Bytes(b)) => Some(b),
        _ => None,
    }
}

fn repeated_bytes(fields: &[Field], number: u32) -> impl Iterator<Item = &Vec<u8>> {
    fields.iter().filter(move |f| f.number == number).filter_map(|f| match &f.value {
        Value::Bytes(b) => Some(b),
        _ => None,
    })
}

/// A `Status` message (code in field 1, absent = 0); `None` when the field is missing.
fn status(fields: &[Field], number: u32) -> Result<Option<String>, HxError> {
    let Some(raw) = bytes(fields, number) else { return Ok(None) };
    let status = read_fields(raw).map_err(bad_frame)?;
    Ok(Some(hx::get(&status, 1).map_or_else(|| "0".to_owned(), Value::text)))
}

/// Field 11 is a varint or a packed list; every value must be 0 (no encryption).
fn encrypted(outer: &[Field]) -> bool {
    outer.iter().filter(|f| f.number == 11).any(|f| match &f.value {
        Value::Varint(v) => *v != 0,
        Value::Bytes(packed) => packed.iter().any(|&b| b != 0),
        _ => true,
    })
}

pub fn decode(payload: &[u8]) -> Result<Frame, HxError> {
    let outer = read_fields(payload).map_err(bad_frame)?;
    let command = varint(&outer, 8).ok_or_else(|| HxError::Tcp("frame thiếu command".into()))?;
    if varint(&outer, 4).unwrap_or(0) != 0 {
        return Ok(Frame::Unsupported("nén"));
    }
    if varint(&outer, 5).unwrap_or(0) != 0 || encrypted(&outer) {
        return Ok(Frame::Unsupported("mã hoá"));
    }
    if command == 4 {
        return Ok(Frame::Logout);
    }
    let body = match bytes(&outer, 9) {
        Some(b) => read_fields(b).map_err(bad_frame)?,
        None if command <= 3 => return Ok(Frame::Unsupported("thiếu nội dung")),
        None => return Ok(Frame::Unknown(command)),
    };
    Ok(match command {
        3 => Frame::Login { status: status(&body, 8)? },
        1 => Frame::Unread {
            status: status(&body, 1)?,
            queues: repeated_bytes(&body, 2)
                .filter_map(|entry| Some(bytes(&read_fields(entry).ok()?, 1)?.to_vec()))
                .collect(),
        },
        2 => Frame::Notice { queue: bytes(&body, 1).map(<[u8]>::to_vec) },
        0 => Frame::Sync(SyncResponse {
            status: status(&body, 1)?,
            local_id: varint(&body, 2).map(|v| v.to_string()),
            server_id: varint(&body, 3).map(|v| v.to_string()),
            metas: repeated_bytes(&body, 4).cloned().collect(),
            next_key: varint(&body, 5),
            queue: bytes(&body, 6).map(<[u8]>::to_vec),
            is_last: varint(&body, 7) == Some(1),
        }),
        other => Frame::Unknown(other),
    })
}

/// Identity of a queue (a JID: 1 app key, 2 name, 3 domain, 4 resource), to
/// tell queues apart; `None` when it names nothing.
pub fn queue_id(queue: &[u8]) -> Option<String> {
    if queue.len() > MAX_QUEUE_BYTES {
        return None;
    }
    let fields = read_fields(queue).ok()?;
    let text = |n| bytes(&fields, n).map(|b| String::from_utf8_lossy(b).trim().to_owned()).unwrap_or_default();
    let (app, name, domain, resource) = (text(1), text(2), text(3), text(4));
    if !name.is_empty() {
        Some(format!("name:{name}"))
    } else if !domain.is_empty() {
        Some(format!("domain:{domain}/{resource}"))
    } else if !resource.is_empty() {
        Some(format!("resource:{resource}"))
    } else if !app.is_empty() {
        Some(format!("app:{app}"))
    } else {
        None
    }
}

/// Port of `buildSyncFrame`: pulls one page of `queue`, after `key` when given.
pub fn sync_frame(queue: &[u8], key: Option<u64>) -> Vec<u8> {
    let mut body = vec![Field { number: 3, value: Value::Bytes(queue.to_vec()) }];
    if let Some(key) = key {
        body.push(Field { number: 2, value: Value::Varint(key) });
    }
    let varint = |number, v| Field { number, value: Value::Varint(v) };
    hx::frame(&write_fields(&[
        varint(1, 0),
        varint(8, 0),
        Field { number: 9, value: Value::Bytes(write_fields(&body)) },
        varint(11, 0),
    ]))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn b(number: u32, v: impl AsRef<[u8]>) -> Field {
        Field { number, value: Value::Bytes(v.as_ref().to_vec()) }
    }
    pub fn v(number: u32, v: u64) -> Field {
        Field { number, value: Value::Varint(v) }
    }
    pub fn ok() -> Field {
        b(1, write_fields(&[v(1, 0)]))
    }
    pub fn response(command: u64, body: &[Field]) -> Vec<u8> {
        write_fields(&[v(8, command), b(9, write_fields(body))])
    }
    pub fn queue(name: &str) -> Vec<u8> {
        write_fields(&[b(1, "org#app"), b(2, name), b(3, "easemob.com")])
    }

    #[test]
    fn decodes_each_server_frame() {
        let login = write_fields(&[v(8, 3), b(9, write_fields(&[b(8, write_fields(&[v(1, 5)]))]))]);
        assert_eq!(decode(&login).unwrap(), Frame::Login { status: Some("5".into()) });

        let unread = response(1, &[ok(), b(2, write_fields(&[b(1, queue("alice")), v(2, 3)]))]);
        assert_eq!(decode(&unread).unwrap(), Frame::Unread { status: Some("0".into()), queues: vec![queue("alice")] });

        let notice = response(2, &[b(1, queue("bob"))]);
        assert_eq!(decode(&notice).unwrap(), Frame::Notice { queue: Some(queue("bob")) });

        let page = response(0, &[ok(), b(4, b"m1"), b(4, b"m2"), v(5, 18446744073709551613), b(6, queue("bob")), v(7, 0)]);
        assert_eq!(
            decode(&page).unwrap(),
            Frame::Sync(SyncResponse {
                status: Some("0".into()),
                metas: vec![b"m1".to_vec(), b"m2".to_vec()],
                next_key: Some(18446744073709551613),
                queue: Some(queue("bob")),
                ..Default::default()
            })
        );
        let ack = response(0, &[ok(), v(2, 42), v(3, 99)]);
        assert!(matches!(decode(&ack).unwrap(), Frame::Sync(SyncResponse { local_id: Some(id), .. }) if id == "42"));

        assert_eq!(decode(&write_fields(&[v(8, 4)])).unwrap(), Frame::Logout);
        assert_eq!(decode(&write_fields(&[v(8, 9), b(9, b"")])).unwrap(), Frame::Unknown(9));
    }

    #[test]
    fn compressed_encrypted_and_broken_frames_are_not_read() {
        assert_eq!(decode(&[response(0, &[]), write_fields(&[v(4, 1)])].concat()).unwrap(), Frame::Unsupported("nén"));
        assert_eq!(decode(&[response(0, &[]), write_fields(&[v(11, 2)])].concat()).unwrap(), Frame::Unsupported("mã hoá"));
        assert_eq!(decode(&[response(0, &[]), write_fields(&[b(11, [0, 1])])].concat()).unwrap(), Frame::Unsupported("mã hoá"));
        assert_eq!(decode(&[response(1, &[ok()]), write_fields(&[v(11, 0)])].concat()).unwrap(), Frame::Unread { status: Some("0".into()), queues: vec![] });
        assert!(decode(&write_fields(&[b(9, b"")])).is_err(), "no command");
        assert!(decode(&[0x42, 0x05, 0x01]).is_err(), "truncated");
    }

    fn unhex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    #[test]
    fn sync_frame_matches_typescript() {
        // buildSyncFrame(queue[, "18446744073709551613"]) in scripts/src/hyphenate/listener.ts.
        let q = write_fields(&[b(1, "org#app"), b(2, "easemob_chat"), b(3, "easemob.com")]);
        assert_eq!(
            sync_frame(&q, Some(18446744073709551613)),
            unhex("00000039080040004a311a240a076f726723617070120c656173656d6f625f636861741a0b656173656d6f622e636f6d10fdffffffffffffffff015800")
        );
        assert_eq!(
            sync_frame(&q, None),
            unhex("0000002e080040004a261a240a076f726723617070120c656173656d6f625f636861741a0b656173656d6f622e636f6d5800")
        );
    }

    #[test]
    fn queue_identity_prefers_the_name() {
        assert_eq!(queue_id(&queue("alice")).as_deref(), Some("name:alice"));
        assert_eq!(queue_id(&write_fields(&[b(3, "conference.easemob.com"), b(4, "r1")])).as_deref(), Some("domain:conference.easemob.com/r1"));
        assert_eq!(queue_id(&write_fields(&[b(1, "org#app")])).as_deref(), Some("app:org#app"));
        assert_eq!(queue_id(&write_fields(&[b(2, "  ")])), None);
        assert_eq!(queue_id(&[0xff]), None);
    }
}
