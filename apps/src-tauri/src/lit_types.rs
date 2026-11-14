//! Typed Litmatch API responses.
//!
//! Field names follow the server (snake_case) when reading and are sent to the
//! webview as camelCase. The matching TypeScript types are written by hand in
//! `apps/src/lib/lit-types.ts`; `contract_files_match_typescript` keeps both sides
//! in sync through the JSON files in `apps/src/lib/contract/`.
//!
//! Only fields the app uses are declared. Everything else in a response is
//! ignored, which also means secrets such as `session` and the IM credentials
//! (`huanxin`) can never reach the webview: they have no field to land in.
//!
//! Each field is read leniently: a value of an unexpected type becomes `None`
//! (or is skipped, inside lists) instead of failing the whole response, because
//! the server schema is observed, not a contract. A response whose `data` is
//! missing or not an object still fails with [`LitError::Schema`].

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::lit::LitError;

/// Wallet balances: `account/account_info` data, and `account_info` inside the own profile.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct Wallet {
    #[serde(default, deserialize_with = "lenient::int")]
    pub diamonds: Option<i64>,
    #[serde(default, deserialize_with = "lenient::int")]
    pub stars: Option<i64>,
    #[serde(default, deserialize_with = "lenient::int")]
    pub amethysts: Option<i64>,
    #[serde(default, deserialize_with = "lenient::int")]
    pub frozen_diamonds: Option<i64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct UserTag {
    #[serde(default, deserialize_with = "lenient::string")]
    pub tag_id: Option<String>,
    #[serde(default, deserialize_with = "lenient::string")]
    pub tag_name: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct MoodStatus {
    #[serde(default, deserialize_with = "lenient::string")]
    pub mood_name: Option<String>,
    /// The server's "show this mood" flag; absent means unknown.
    #[serde(default, deserialize_with = "lenient::boolean")]
    pub is_show: Option<bool>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct ActiveInfo {
    /// Unix seconds.
    #[serde(default, deserialize_with = "lenient::int")]
    pub time: Option<i64>,
    /// Server-localised text, e.g. "Hoạt động".
    #[serde(default, deserialize_with = "lenient::string")]
    pub time_desc: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct VipInfo {
    #[serde(default, deserialize_with = "lenient::int")]
    pub level: Option<i64>,
    /// Unix seconds; 0 when the account never had VIP.
    #[serde(default, deserialize_with = "lenient::int")]
    pub expire_time: Option<i64>,
}

/// A user as returned by `user/get_info/me`, `user/get_info/:id` and each entry
/// of `home/online_users`. Fields only some endpoints send are optional.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct UserProfile {
    #[serde(default, deserialize_with = "lenient::string")]
    pub user_id: Option<String>,
    #[serde(default, deserialize_with = "lenient::int")]
    pub lit_id: Option<i64>,
    #[serde(default, deserialize_with = "lenient::string")]
    pub nickname: Option<String>,
    /// CDN file id (a UUID), not a URL.
    #[serde(default, deserialize_with = "lenient::string")]
    pub avatar: Option<String>,
    /// "girl" / "boy" as sent by the server.
    #[serde(default, deserialize_with = "lenient::string")]
    pub gender: Option<String>,
    #[serde(default, deserialize_with = "lenient::int")]
    pub age: Option<i64>,
    #[serde(default, deserialize_with = "lenient::string")]
    pub bio: Option<String>,
    #[serde(default, deserialize_with = "lenient::string")]
    pub country: Option<String>,
    #[serde(default, deserialize_with = "lenient::string")]
    pub region: Option<String>,
    #[serde(default, deserialize_with = "lenient::string")]
    pub ip_city: Option<String>,
    #[serde(default, deserialize_with = "lenient::string")]
    pub ip_country: Option<String>,
    /// IM (Hyphenate) user id. Public; the IM password is never read.
    #[serde(default, deserialize_with = "lenient::string")]
    pub huanxin_id: Option<String>,
    #[serde(default, deserialize_with = "lenient::list")]
    pub tags: Vec<UserTag>,
    #[serde(default, deserialize_with = "lenient::object")]
    pub mood_status_info: Option<MoodStatus>,
    #[serde(default, deserialize_with = "lenient::int")]
    pub follower: Option<i64>,
    #[serde(default, deserialize_with = "lenient::int")]
    pub following: Option<i64>,
    #[serde(default, deserialize_with = "lenient::boolean")]
    pub is_vip: Option<bool>,
    #[serde(default, deserialize_with = "lenient::object")]
    pub vip_info: Option<VipInfo>,
    /// Unix seconds.
    #[serde(default, deserialize_with = "lenient::int")]
    pub create_time: Option<i64>,
    #[serde(default, deserialize_with = "lenient::object")]
    pub active_info: Option<ActiveInfo>,
    /// YYYY-MM-DD; own profile only.
    #[serde(default, deserialize_with = "lenient::string")]
    pub birthdate: Option<String>,
    /// Wallet balances; own profile only.
    #[serde(default, deserialize_with = "lenient::object")]
    pub account_info: Option<Wallet>,
    /// Online flag; online list only.
    #[serde(default, deserialize_with = "lenient::boolean")]
    pub online: Option<bool>,
}

/// One page of `home/online_users`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct OnlineUsersPage {
    #[serde(rename(deserialize = "user_infos"), default, deserialize_with = "lenient::list")]
    pub users: Vec<UserProfile>,
    #[serde(default, deserialize_with = "lenient::boolean")]
    pub has_next: Option<bool>,
    /// Server cursor for the next page; may legitimately be 0.
    #[serde(default, deserialize_with = "lenient::int")]
    pub next_start: Option<i64>,
}

/// One entry of `user/conversations`. Only the two fields the scripts rely on are
/// read; an entry missing either one is skipped by [`ConversationList`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct Conversation {
    /// The peer's IM (Hyphenate) username, or a group id.
    pub conversation_id: String,
    /// 0 = one-to-one, 1 = group; other values are listed but cannot be opened.
    pub conversation_type: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct ConversationList {
    #[serde(default, deserialize_with = "lenient::list")]
    conversations: Vec<Conversation>,
}

impl ConversationList {
    /// Entries whose id is a valid IM ID, first occurrence only.
    pub fn into_valid(self) -> Vec<Conversation> {
        let mut seen = std::collections::HashSet::new();
        self.conversations
            .into_iter()
            .filter(|c| crate::lit::is_id(&c.conversation_id) && seen.insert(c.conversation_id.clone()))
            .collect()
    }
}

/// `data` of an already accepted response (see `decode_response`), as `T`.
pub fn parse_data<T: DeserializeOwned>(json: serde_json::Value) -> Result<T, LitError> {
    #[derive(Deserialize)]
    struct Envelope<T> {
        data: T,
    }
    // serde would also accept a JSON array for a struct (fields by position), so
    // `data: [..]` must be refused explicitly.
    if !json.get("data").is_some_and(serde_json::Value::is_object) {
        return Err(LitError::Schema("trường `data` thiếu hoặc không phải object".into()));
    }
    serde_json::from_value::<Envelope<T>>(json)
        .map(|e| e.data)
        .map_err(|e| LitError::Schema(e.to_string()))
}

/// Field deserializers that turn values of an unexpected type into `None`.
mod lenient {
    use serde::de::DeserializeOwned;
    use serde::{Deserialize, Deserializer};
    use serde_json::Value;

    /// Trimmed non-empty string; numbers become their decimal text (ids are sometimes numeric).
    pub fn string<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
        Ok(match Value::deserialize(d)? {
            Value::String(s) => Some(s.trim().to_owned()).filter(|s| !s.is_empty()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        })
    }

    /// Integer, from a JSON integer, a whole float, or an all-digit string ("21").
    pub fn int<'de, D: Deserializer<'de>>(d: D) -> Result<Option<i64>, D::Error> {
        Ok(match Value::deserialize(d)? {
            Value::Number(n) => n.as_i64().or_else(|| {
                n.as_f64()
                    .filter(|f| f.is_finite() && f.fract() == 0.0 && f.abs() <= i64::MAX as f64)
                    .map(|f| f as i64)
            }),
            Value::String(s) if !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) => s.parse().ok(),
            _ => None,
        })
    }

    pub fn boolean<'de, D: Deserializer<'de>>(d: D) -> Result<Option<bool>, D::Error> {
        Ok(Value::deserialize(d)?.as_bool())
    }

    /// Nested object; anything that is not an object becomes `None`.
    pub fn object<'de, D: Deserializer<'de>, T: DeserializeOwned>(d: D) -> Result<Option<T>, D::Error> {
        Ok(match Value::deserialize(d)? {
            v @ Value::Object(_) => serde_json::from_value(v).ok(),
            _ => None,
        })
    }

    /// List of objects; a non-array becomes empty and entries that are not objects are skipped.
    pub fn list<'de, D: Deserializer<'de>, T: DeserializeOwned>(d: D) -> Result<Vec<T>, D::Error> {
        Ok(match Value::deserialize(d)? {
            Value::Array(items) => items
                .into_iter()
                .filter(Value::is_object)
                .filter_map(|v| serde_json::from_value(v).ok())
                .collect(),
            _ => Vec::new(),
        })
    }
}

/// Writes or checks one file in `apps/src/lib/contract/` (see `contract_files_match_typescript`).
#[cfg(test)]
pub(crate) fn check_contract(name: &str, value: serde_json::Value) {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/lib/contract");
    let path = dir.join(name);
    let expected = format!("{}\n", serde_json::to_string_pretty(&value).unwrap());
    if std::env::var_os("UPDATE_CONTRACT").is_some() {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, &expected).unwrap();
    }
    let actual = std::fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("missing {}; run UPDATE_CONTRACT=1 cargo test contract", path.display()));
    assert_eq!(actual, expected, "{name} is stale; run UPDATE_CONTRACT=1 cargo test contract");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The anonymised real `user/get_info/me` response shared with scripts/.
    const ME_FIXTURE: &str = include_str!("../../../scripts/test/fixtures/user-info-me.example.json");

    fn me() -> UserProfile {
        parse_data(serde_json::from_str(ME_FIXTURE).unwrap()).unwrap()
    }

    #[test]
    fn parses_the_real_own_profile() {
        let p = me();
        assert_eq!(p.user_id.as_deref(), Some("000000000000000000000001"));
        assert_eq!(p.lit_id, Some(1000000001));
        assert_eq!(p.nickname.as_deref(), Some("test_user"));
        assert_eq!(p.gender.as_deref(), Some("boy"));
        assert_eq!(p.age, Some(25));
        assert_eq!(p.huanxin_id.as_deref(), Some("love000000000000000001"));
        assert_eq!(p.tags.len(), 1);
        assert_eq!(p.tags[0].tag_name.as_deref(), Some("Thể thao"));
        assert_eq!(p.mood_status_info.as_ref().unwrap().mood_name.as_deref(), Some("Muốn chat"));
        assert_eq!(p.active_info.as_ref().unwrap().time_desc.as_deref(), Some("Hoạt động"));
        assert_eq!(p.vip_info.as_ref().unwrap().level, Some(0));
        assert_eq!(p.birthdate.as_deref(), Some("2000-01-01"));
        assert_eq!(p.account_info.as_ref().unwrap().diamonds, Some(0));
        assert_eq!(p.online, None);
    }

    #[test]
    fn secrets_never_reach_the_webview() {
        // The fixture still contains `session` and `huanxin.password`; the typed
        // profile has no field for them, so its serialized form cannot carry them.
        let raw: serde_json::Value = serde_json::from_str(ME_FIXTURE).unwrap();
        assert!(raw["data"].get("session").is_some() && raw["data"].get("huanxin").is_some());
        let out = serde_json::to_string(&me()).unwrap();
        for secret in ["\"session\"", "\"huanxin\"", "password", "REDACTED"] {
            assert!(!out.contains(secret), "{secret} leaked: {out}");
        }
        assert!(out.contains("\"huanxinId\""), "IM id is public and kept");
    }

    #[test]
    fn serializes_camel_case_for_typescript() {
        let keys: Vec<String> = match serde_json::to_value(me()).unwrap() {
            serde_json::Value::Object(map) => map.keys().cloned().collect(),
            _ => unreachable!(),
        };
        assert_eq!(
            keys,
            [
                "userId", "litId", "nickname", "avatar", "gender", "age", "bio", "country", "region", "ipCity",
                "ipCountry", "huanxinId", "tags", "moodStatusInfo", "follower", "following", "isVip", "vipInfo",
                "createTime", "activeInfo", "birthdate", "accountInfo", "online",
            ]
        );
    }

    #[test]
    fn wrong_field_types_become_none_not_errors() {
        let p: UserProfile = parse_data(json!({ "data": {
            "user_id": 7, "nickname": "  Lan  ", "age": "21", "bio": "", "follower": 3.0, "following": "x",
            "is_vip": "yes", "tags": [{ "tag_name": "A" }, "junk", { "tag_name": 5 }, null],
            "mood_status_info": "nope", "account_info": { "diamonds": "10", "stars": 2.5 }, "online": false,
        }}))
        .unwrap();
        assert_eq!(p.user_id.as_deref(), Some("7"));
        assert_eq!(p.nickname.as_deref(), Some("Lan"));
        assert_eq!(p.age, Some(21));
        assert_eq!(p.bio, None, "empty strings are absent");
        assert_eq!(p.follower, Some(3));
        assert_eq!(p.following, None);
        assert_eq!(p.is_vip, None);
        assert_eq!(p.tags.iter().map(|t| t.tag_name.as_deref()).collect::<Vec<_>>(), [Some("A"), Some("5")]);
        assert_eq!(p.mood_status_info, None);
        assert_eq!(p.account_info, Some(Wallet { diamonds: Some(10), ..Default::default() }));
        assert_eq!(p.online, Some(false));
    }

    #[test]
    fn online_page_keeps_cursor_zero_and_skips_bad_entries() {
        let page: OnlineUsersPage = parse_data(json!({ "success": true, "result": 0, "data": {
            "user_infos": [{ "user_id": "a1", "online": true }, 3, { "user_id": "b2" }],
            "has_next": true, "next_start": 0,
        }}))
        .unwrap();
        assert_eq!(page.users.iter().map(|u| u.user_id.as_deref()).collect::<Vec<_>>(), [Some("a1"), Some("b2")]);
        assert_eq!(page.has_next, Some(true));
        assert_eq!(page.next_start, Some(0));
        let empty: OnlineUsersPage = parse_data(json!({ "data": {} })).unwrap();
        assert_eq!(empty, OnlineUsersPage::default());
    }

    #[test]
    fn missing_or_non_object_data_is_a_schema_error() {
        for bad in [json!({}), json!({ "data": null }), json!({ "data": [1] }), json!({ "data": "x" })] {
            assert!(matches!(parse_data::<UserProfile>(bad.clone()), Err(LitError::Schema(_))), "{bad}");
        }
    }

    /// Typed output for the shared fixtures, checked into `apps/src/lib/contract/` and
    /// type-checked against the hand-written TS types (lit-types.contract.test.ts).
    /// Regenerate after changing a struct: `UPDATE_CONTRACT=1 cargo test contract`.
    #[test]
    fn contract_files_match_typescript() {
        let me = me();
        let online = OnlineUsersPage {
            users: vec![UserProfile { online: Some(true), account_info: None, birthdate: None, ..me.clone() }],
            has_next: Some(true),
            next_start: Some(15),
        };
        let files = [
            ("user-profile.json", serde_json::to_value(&me).unwrap()),
            ("online-users-page.json", serde_json::to_value(&online).unwrap()),
            ("wallet.json", serde_json::to_value(me.account_info.clone().unwrap()).unwrap()),
        ];
        for (name, value) in files {
            check_contract(name, value);
        }
    }

    #[test]
    fn conversations_skip_invalid_and_duplicate_entries() {
        let json = serde_json::json!({ "data": { "conversations": [
            { "conversation_id": "love_1", "conversation_type": 0, "extra": 1 },
            { "conversation_id": "a b", "conversation_type": 0 },
            { "conversation_id": "love_2" },
            { "conversation_id": "love_1", "conversation_type": 0 },
            "junk",
            { "conversation_id": "grp_9", "conversation_type": 1 },
        ] } });
        let list = parse_data::<ConversationList>(json).unwrap().into_valid();
        assert_eq!(list.iter().map(|c| c.conversation_id.as_str()).collect::<Vec<_>>(), ["love_1", "grp_9"]);
        check_contract("conversations.json", serde_json::to_value(&list).unwrap());
    }
}
