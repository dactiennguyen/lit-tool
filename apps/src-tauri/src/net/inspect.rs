//! Readable views of request and response data and of IM frames, for the
//! connection log, with every secret masked: the sid, signatures, tokens,
//! passwords (hxPwd), sessions, cookies and the header that carries the
//! encoded query (and so the sid). Views are cut at [`MAX_VIEW`] bytes.

use crate::chat::hx::{Value, read_fields};

/// What a masked value shows.
pub const MASK: &str = "•••";
/// Longest view kept.
const MAX_VIEW: usize = 32 * 1024;
/// Bytes shown as hex before the rest is cut.
const MAX_HEX: usize = 256;
/// Nesting shown in a frame dump.
const MAX_DEPTH: usize = 12;

/// Whether a field, parameter or header of this name holds a secret.
pub fn is_secret(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n == "x-application-info" || n.contains("dfpid") || n.contains("siua")
        || ["sid", "sign", "token", "password", "pwd", "secret", "session", "auth", "cookie"].iter().any(|s| n.contains(s))
}

/// `value`, or the mask when `name` names a secret.
pub fn masked(name: &str, value: &str) -> String {
    if is_secret(name) { MASK.to_owned() } else { value.to_owned() }
}

/// A JSON value with every secret member masked, at any depth.
pub fn redact_json(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            for (k, v) in map.iter_mut() {
                if is_secret(k) && !v.is_null() {
                    *v = MASK.into();
                } else {
                    redact_json(v);
                }
            }
        }
        serde_json::Value::Array(items) => items.iter_mut().for_each(redact_json),
        _ => {}
    }
}

fn cut(mut text: String, total: usize) -> String {
    if text.len() > MAX_VIEW {
        let mut end = MAX_VIEW;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
        text.push_str(&format!("\n… (cắt, tổng {total} byte)"));
    }
    text
}

fn hex(bytes: &[u8]) -> String {
    let shown: String = bytes.iter().take(MAX_HEX).map(|b| format!("{b:02x}")).collect();
    if bytes.len() > MAX_HEX { format!("{shown}… ({} byte)", bytes.len()) } else { shown }
}

/// A body as text: JSON pretty-printed with secrets masked, other text as is,
/// anything else as a byte count.
pub fn body_view(body: &[u8]) -> String {
    if body.is_empty() {
        return String::new();
    }
    let Ok(text) = std::str::from_utf8(body) else { return format!("({} byte nhị phân)", body.len()) };
    cut(text_view(text), body.len())
}

/// A text as shown: JSON with secrets masked, else as is.
fn text_view(text: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(mut json) if json.is_object() || json.is_array() => {
            redact_json(&mut json);
            serde_json::to_string_pretty(&json).unwrap_or_default()
        }
        _ => text.to_owned(),
    }
}

fn printable(text: &str) -> bool {
    !text.chars().any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
}

/// A protobuf message as an indented tree of `field: value` lines. Bytes are
/// shown as text when they read as text (JSON with secrets masked), as a
/// nested message when they parse as one, else as hex. A token in the login
/// frame sits in its auth JSON, so it is masked too.
pub fn proto_dump(payload: &[u8]) -> String {
    let mut out = String::new();
    dump_into(&mut out, payload, 0);
    cut(out, payload.len())
}

fn dump_into(out: &mut String, payload: &[u8], depth: usize) {
    let Ok(fields) = read_fields(payload) else {
        out.push_str(&format!("{}(không đọc được) {}\n", "  ".repeat(depth), hex(payload)));
        return;
    };
    for field in fields {
        let pad = "  ".repeat(depth);
        let number = field.number;
        match &field.value {
            Value::Varint(v) | Value::Fixed64(v) => out.push_str(&format!("{pad}{number}: {v}\n")),
            Value::Fixed32(v) => out.push_str(&format!("{pad}{number}: {v}\n")),
            Value::Bytes(b) => match std::str::from_utf8(b) {
                Ok(text) if !b.is_empty() && printable(text) => {
                    let view = text_view(text).replace('\n', &format!("\n{pad}  "));
                    out.push_str(&format!("{pad}{number}: \"{view}\"\n"));
                }
                _ if !b.is_empty() && depth < MAX_DEPTH && read_fields(b).is_ok() => {
                    out.push_str(&format!("{pad}{number}: {{\n"));
                    dump_into(out, b, depth + 1);
                    out.push_str(&format!("{pad}}}\n"));
                }
                _ => out.push_str(&format!("{pad}{number}: {}\n", if b.is_empty() { "\"\"".into() } else { hex(b) })),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::hx::{Field, write_fields};

    #[test]
    fn secrets_are_masked_by_name_at_any_depth() {
        let mut json = serde_json::json!({
            "access_token": "T", "expires_in": 3600, "next_key": "5",
            "data": { "user_info": { "nickname": "Lan", "session": "S", "huanxin": { "password": "P" }, "hxPwd": "H" } },
            "list": [{ "sid": "X" }],
        });
        redact_json(&mut json);
        let text = json.to_string();
        for secret in ["\"T\"", "\"S\"", "\"P\"", "\"H\"", "\"X\""] {
            assert!(!text.contains(secret), "{secret} in {text}");
        }
        assert!(text.contains("Lan") && text.contains("3600") && text.contains("\"5\""));
        for header in ["Authorization", "litSign", "sts-sign", "X-Application-Info", "Cookie", "X-DFPID", "dfpId", "X-SIUA"] {
            assert!(is_secret(header), "{header}");
        }
        for name in ["accept", "X-request-Id", "uuid", "num", "app_key"] {
            assert!(!is_secret(name), "{name}");
        }
    }

    #[test]
    fn bodies_show_as_masked_json_text_or_a_byte_count() {
        assert!(body_view(br#"{"grant_type":"password","password":"PW"}"#).contains(&format!("\"password\": \"{MASK}\"")));
        assert_eq!(body_view(b"plain"), "plain");
        assert_eq!(body_view(&[0xff, 0xfe]), "(2 byte nhị phân)");
        let long = "a".repeat(MAX_VIEW + 10);
        assert!(body_view(long.as_bytes()).ends_with(&format!("(cắt, tổng {} byte)", MAX_VIEW + 10)));
    }

    #[test]
    fn frames_dump_as_a_tree_with_the_login_token_masked() {
        let b = |number, v: &[u8]| Field { number, value: Value::Bytes(v.to_vec()) };
        let v = |number, v| Field { number, value: Value::Varint(v) };
        let auth = br#"{"token":"$t$SECRET"}"#;
        let frame = write_fields(&[v(8, 3), b(2, &write_fields(&[b(2, b"love_100")])), b(9, &write_fields(&[b(18, auth), b(7, &[0, 1, 2])]))]);
        let dump = proto_dump(&frame);
        assert!(!dump.contains("SECRET"), "{dump}");
        assert!(dump.contains("8: 3\n") && dump.contains("  2: \"love_100\"") && dump.contains("  7: 000102"), "{dump}");
        assert!(dump.contains(MASK));
    }
}
