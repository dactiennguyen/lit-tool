//! The conversations each account has chatted in, kept in `sky.db` (table
//! `conversations`, db.rs) so the chat list shows at once and keeps every
//! conversation seen, even when the server list fails or drops one.
//!
//! A row holds the conversation, the peer's name and avatar (from the push
//! payload of a message they sent) and the newest message known, for the
//! preview. It is written when the server list loads, when the newest page of
//! a conversation is read, when a message is heard on the live connection and
//! when one is sent. Message history itself is not stored.

use std::sync::Arc;

use rusqlite::params;
use serde::Serialize;
use uuid::Uuid;

use crate::db::{Db, DbError};
use crate::hx::ChatMessage;
use crate::lit_types::Conversation;
use crate::store::now_ms;

/// One saved conversation (`SavedConversation` in src/lib/lit-types.ts).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedConversation {
    pub conversation_id: String,
    pub conversation_type: i64,
    pub peer_name: Option<String>,
    /// CDN file id of the avatar.
    pub peer_avatar: Option<String>,
    /// The newest message known, as the IM commands return it.
    pub last_message: Option<serde_json::Value>,
    /// When the row last changed (ms since the epoch).
    pub updated_at: u64,
}

/// Managed state: the database, for the chat commands.
pub struct ChatStore(Arc<Db>);

impl ChatStore {
    pub fn new(db: Arc<Db>) -> Self {
        Self(db)
    }

    /// Records the server's list: new conversations are added, known ones keep their details.
    pub fn save_listed(&self, account_id: Uuid, list: &[Conversation]) -> Result<(), DbError> {
        let now = now_ms() as i64;
        self.0.write(|tx| -> Result<(), DbError> {
            let mut upsert = tx.prepare_cached(
                "INSERT INTO conversations (account_id, conversation_id, conversation_type, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT (account_id, conversation_id) DO UPDATE SET conversation_type = excluded.conversation_type",
            )?;
            for c in list {
                upsert.execute(params![account_id.to_string(), c.conversation_id, c.conversation_type, now])?;
            }
            Ok(())
        })
    }

    /// Records a message of a conversation: it becomes the preview when it is
    /// the newest known, and a message from the peer names them.
    pub fn save_message(
        &self,
        account_id: Uuid,
        conversation_id: &str,
        conversation_type: i64,
        message: &ChatMessage,
    ) -> Result<(), DbError> {
        let (at, id) = (message.timestamp.unwrap_or(0) as i64, message.id.as_str());
        let json = serde_json::to_string(message).expect("a message serializes");
        let from_peer = conversation_type == 0 && message.from.as_deref() == Some(conversation_id);
        let sender = message.sender.as_ref().filter(|_| from_peer);
        let (name, avatar) = (sender.and_then(|s| s.name.as_deref()), sender.and_then(|s| s.avatar.as_deref()));
        self.0.write(|tx| -> Result<(), DbError> {
            let account = account_id.to_string();
            tx.execute(
                "INSERT INTO conversations (account_id, conversation_id, conversation_type, updated_at)
                 VALUES (?1, ?2, ?3, ?4) ON CONFLICT (account_id, conversation_id) DO NOTHING",
                params![account, conversation_id, conversation_type, now_ms() as i64],
            )?;
            // Newer: later in time, or as late with a larger server id (ids grow; compared as numbers).
            tx.execute(
                "UPDATE conversations SET last_message = ?3, last_at = ?4, last_id = ?5, updated_at = ?6
                 WHERE account_id = ?1 AND conversation_id = ?2
                   AND (last_at IS NULL OR ?4 > last_at
                        OR (?4 = last_at AND (length(?5) > length(last_id) OR (length(?5) = length(last_id) AND ?5 > last_id))))",
                params![account, conversation_id, json, at, id, now_ms() as i64],
            )?;
            if name.is_some() || avatar.is_some() {
                tx.execute(
                    "UPDATE conversations SET peer_name = COALESCE(?3, peer_name), peer_avatar = COALESCE(?4, peer_avatar)
                     WHERE account_id = ?1 AND conversation_id = ?2",
                    params![account, conversation_id, name, avatar],
                )?;
            }
            Ok(())
        })
    }

    /// The account's conversations, newest message first (those without one last).
    pub fn list(&self, account_id: Uuid) -> Result<Vec<SavedConversation>, DbError> {
        self.0.read(|c| {
            let mut query = c.prepare_cached(
                "SELECT conversation_id, conversation_type, peer_name, peer_avatar, last_message, updated_at
                 FROM conversations WHERE account_id = ?1
                 ORDER BY last_at IS NULL, last_at DESC, rowid",
            )?;
            let rows = query.query_map([account_id.to_string()], |r| {
                let last: Option<String> = r.get(4)?;
                Ok(SavedConversation {
                    conversation_id: r.get(0)?,
                    conversation_type: r.get(1)?,
                    peer_name: r.get(2)?,
                    peer_avatar: r.get(3)?,
                    // A row we wrote ourselves; an unreadable one only loses its preview.
                    last_message: last.and_then(|j| serde_json::from_str(&j).ok()),
                    updated_at: r.get::<_, i64>(5)?.max(0) as u64,
                })
            })?;
            rows.collect()
        })
    }
}

/// Orders messages by time, then by server id (ids grow; compared as numbers).
fn order(m: &ChatMessage) -> (u64, usize, &str) {
    (m.timestamp.unwrap_or(0), m.id.len(), m.id.as_str())
}

/// The newest of `messages`, in whatever order the server gave them.
pub fn newest(messages: &[ChatMessage]) -> Option<&ChatMessage> {
    messages.iter().max_by(|a, b| order(a).cmp(&order(b)))
}

/// Saving is best effort: the chat works without it, so a failure is only logged.
pub fn note(result: Result<(), DbError>) {
    if let Err(e) = result {
        eprintln!("chat store: {e}");
    }
}

// ---------- tauri commands ----------

/// The conversations saved for an account (no network).
#[tauri::command]
pub fn chat_saved_conversations(
    store: tauri::State<'_, ChatStore>,
    account_id: Uuid,
) -> Result<Vec<SavedConversation>, DbError> {
    store.list(account_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hx::{MessageContent, MessageSender};

    fn store() -> (tempfile::TempDir, ChatStore) {
        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(Db::open(dir.path(), None).unwrap());
        (dir, ChatStore::new(db))
    }

    fn message(id: &str, from: &str, to: &str, at: u64, text: &str, sender: Option<&str>) -> ChatMessage {
        ChatMessage {
            id: id.into(),
            from: Some(from.into()),
            to: Some(to.into()),
            timestamp: Some(at),
            contents: vec![MessageContent { kind: 0, text: Some(text.into()), ..Default::default() }],
            sender: sender.map(|n| MessageSender { name: Some(n.into()), avatar: None }),
        }
    }

    fn conv(id: &str, kind: i64) -> Conversation {
        Conversation { conversation_id: id.into(), conversation_type: kind }
    }

    fn text(saved: &SavedConversation) -> Option<&str> {
        saved.last_message.as_ref()?["contents"][0]["text"].as_str()
    }

    #[test]
    fn keeps_every_conversation_with_its_newest_message_and_peer() {
        let (_dir, s) = store();
        let (a, other) = (Uuid::new_v4(), Uuid::new_v4());
        s.save_listed(a, &[conv("alice", 0), conv("g1", 1)]).unwrap();
        s.save_message(a, "alice", 0, &message("9", "alice", "me", 200, "chào", Some("Alice"))).unwrap();
        // Older, and as old with a smaller id: the preview stays.
        s.save_message(a, "alice", 0, &message("8", "me", "alice", 100, "cũ", None)).unwrap();
        s.save_message(a, "alice", 0, &message("10", "me", "alice", 200, "cùng lúc", None)).unwrap();
        s.save_message(a, "alice", 0, &message("7", "me", "alice", 200, "nhỏ hơn", None)).unwrap();
        // A conversation first seen through a message is added.
        s.save_message(a, "bob", 0, &message("1", "bob", "me", 50, "hi", Some("Bob"))).unwrap();
        // A later server list without bob keeps him and keeps alice's details.
        s.save_listed(a, &[conv("alice", 0)]).unwrap();

        let list = s.list(a).unwrap();
        let ids: Vec<_> = list.iter().map(|c| c.conversation_id.as_str()).collect();
        assert_eq!(ids, ["alice", "bob", "g1"], "newest message first, none last");
        assert_eq!((text(&list[0]), list[0].peer_name.as_deref()), (Some("cùng lúc"), Some("Alice")));
        assert_eq!(list[1].peer_name.as_deref(), Some("Bob"));
        assert_eq!((list[2].conversation_type, list[2].last_message.is_none()), (1, true));
        assert!(s.list(other).unwrap().is_empty(), "per account");
    }

    #[test]
    fn the_newest_message_is_by_time_then_numeric_id() {
        let ms = [message("99", "a", "b", 5, "", None), message("100", "a", "b", 5, "", None), message("7", "a", "b", 4, "", None)];
        assert_eq!(newest(&ms).unwrap().id, "100");
        assert!(newest(&[]).is_none());
    }

    #[test]
    fn my_own_message_does_not_rename_the_peer() {
        let (_dir, s) = store();
        let a = Uuid::new_v4();
        s.save_message(a, "alice", 0, &message("1", "alice", "me", 1, "a", Some("Alice"))).unwrap();
        s.save_message(a, "alice", 0, &message("2", "me", "alice", 2, "b", Some("Tên tôi"))).unwrap();
        assert_eq!(s.list(a).unwrap()[0].peer_name.as_deref(), Some("Alice"));
    }

    #[test]
    fn removing_the_account_removes_its_conversations() {
        let (dir, s) = store();
        let db = Arc::new(Db::open(dir.path(), None).unwrap());
        let a = Uuid::new_v4();
        s.save_listed(a, &[conv("alice", 0)]).unwrap();
        db.write(|tx| crate::db::delete_account(tx, a)).unwrap();
        assert!(s.list(a).unwrap().is_empty());
    }

    #[test]
    fn saved_conversation_contract() {
        let saved = SavedConversation {
            conversation_id: "love123".into(),
            conversation_type: 0,
            peer_name: Some("Lan".into()),
            peer_avatar: Some("0b8c7a52-1d1e-4f3e-9a55-123456789abc".into()),
            last_message: Some(serde_json::to_value(message("9", "love123", "me", 1700000000000, "chào", None)).unwrap()),
            updated_at: 1700000000001,
        };
        crate::lit_types::check_contract("saved-conversations.json", serde_json::to_value([saved]).unwrap());
    }
}
