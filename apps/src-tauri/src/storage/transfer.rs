//! Account export and import as plain JSON text: every account with its sid,
//! its IM credentials and its proxy, to copy to another machine, paste, or
//! keep in a file. Anyone holding the text can use the accounts.
//!
//! Text (JSON): an array of accounts, nothing else. Import also reads the
//! `{ format, version: 2, exportedAt, accounts }` object of 1.3.0 to 1.5.0,
//! and the password-protected files of version 1 (PBKDF2-HMAC-SHA256 + AES-256-GCM, header bound as
//! associated data). It adds accounts whose device UUID is new and skips the
//! rest. An imported proxy is not tested. The device setup (JSON, DFPID
//! refresh) is not exported.

use std::path::Path;

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::storage::accounts::{AccountRegistry, NewAccount};

const FORMAT: &str = "sky-manager-accounts";
/// The plain JSON object of 1.3.0 to 1.5.0 (read only; exports are a bare array now).
const VERSION: u32 = 2;
/// Password-protected files of earlier builds (read only).
const ENCRYPTED_VERSION: u32 = 1;
const KDF: &str = "pbkdf2-sha256";
/// Rounds a file may ask for: enough to refuse a file built to stall the app.
const MAX_ITERATIONS: u32 = 10_000_000;
/// Largest file or text read on import.
const MAX_FILE: u64 = 16 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum TransferError {
    #[error("{0}")]
    Invalid(String),
    #[error("Sai mật khẩu hoặc file đã bị sửa")]
    Decrypt,
    #[error("File này có mật khẩu (export từ bản cũ): nhập mật khẩu để mở")]
    NeedsPassword,
    #[error("Không đọc/ghi được file: {0}")]
    Io(#[from] std::io::Error),
}

impl Serialize for TransferError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

type Result<T> = std::result::Result<T, TransferError>;

fn invalid(m: &str) -> TransferError {
    TransferError::Invalid(m.into())
}

/// A password-protected file of version 1.
#[derive(Debug, Serialize, Deserialize)]
struct Envelope {
    format: String,
    version: u32,
    kdf: String,
    iterations: u32,
    salt: String,
    nonce: String,
    data: String,
}

/// The content: the plain text of version 2, or what a version 1 file decrypts to.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bundle {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    version: Option<u32>,
    #[serde(default)]
    exported_at: u64,
    accounts: Vec<Exported>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Exported {
    label: String,
    user_id: Option<String>,
    device_uuid: String,
    version: String,
    siua: Option<String>,
    dfpid: Option<String>,
    sid: String,
    im: Option<ImCredentials>,
    /// The saved proxy, on or off, with its password (files of earlier builds have none).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    proxy: Option<crate::net::proxy::Proxy>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct ImCredentials {
    username: String,
    password: String,
}

/// Result of an export (`ExportReport` in src/lib/api.ts).
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub exported: usize,
    /// Labels of accounts left out because they have no saved sid.
    pub skipped: Vec<String>,
    /// The JSON text (only from `accounts_export_text`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// Result of an import (`ImportReport` in src/lib/api.ts).
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub added: Vec<String>,
    /// Labels of accounts already here (same device UUID).
    pub skipped: Vec<String>,
    /// Label and reason of accounts that could not be added.
    pub failed: Vec<(String, String)>,
}

fn key(password: &str, salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, iterations, &mut key);
    key
}

/// The header fields bound to the ciphertext, so none can be swapped.
fn aad(iterations: u32, salt: &str) -> Vec<u8> {
    format!("{FORMAT}/{ENCRYPTED_VERSION}/{KDF}/{iterations}/{salt}").into_bytes()
}

#[cfg(test)]
fn random<const N: usize>() -> Result<[u8; N]> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).map_err(|e| TransferError::Invalid(format!("Không tạo được số ngẫu nhiên: {e}")))?;
    Ok(bytes)
}

/// A version 1 file, as earlier builds wrote them (tests only: exports are plain now).
#[cfg(test)]
fn seal(bundle: &Bundle, password: &str, iterations: u32) -> Result<Vec<u8>> {
    let (salt, nonce) = (random::<16>()?, random::<12>()?);
    let salt_b64 = STANDARD.encode(salt);
    let cipher = Aes256Gcm::new_from_slice(&key(password, &salt, iterations)).expect("32-byte key");
    let plain = serde_json::to_vec(bundle).expect("the bundle serializes");
    let aad = aad(iterations, &salt_b64);
    let data = cipher
        .encrypt(&nonce.into(), Payload { msg: &plain, aad: &aad })
        .map_err(|_| invalid("Không mã hoá được dữ liệu"))?;
    let envelope = Envelope {
        format: FORMAT.into(),
        version: ENCRYPTED_VERSION,
        kdf: KDF.into(),
        iterations,
        salt: salt_b64,
        nonce: STANDARD.encode(nonce),
        data: STANDARD.encode(data),
    };
    Ok(serde_json::to_vec_pretty(&envelope).expect("the envelope serializes"))
}

fn open(file: &[u8], password: &str) -> Result<Bundle> {
    let envelope: Envelope =
        serde_json::from_slice(file).map_err(|_| invalid("Không phải file export account của Sky Manager"))?;
    if envelope.format != FORMAT {
        return Err(invalid("Không phải file export account của Sky Manager"));
    }
    if envelope.version != ENCRYPTED_VERSION || envelope.kdf != KDF {
        return Err(invalid("File export của phiên bản khác, app này chưa đọc được"));
    }
    if !(1..=MAX_ITERATIONS).contains(&envelope.iterations) {
        return Err(invalid("File export có tham số mã hoá không hợp lệ"));
    }
    let decode = |s: &str| STANDARD.decode(s).map_err(|_| invalid("File export bị hỏng"));
    let (salt, data) = (decode(&envelope.salt)?, decode(&envelope.data)?);
    let nonce: [u8; 12] = decode(&envelope.nonce)?.try_into().map_err(|_| invalid("File export bị hỏng"))?;
    let cipher = Aes256Gcm::new_from_slice(&key(password, &salt, envelope.iterations)).expect("32-byte key");
    let aad = aad(envelope.iterations, &envelope.salt);
    let plain = cipher.decrypt(&nonce.into(), Payload { msg: &data, aad: &aad }).map_err(|_| TransferError::Decrypt)?;
    serde_json::from_slice(&plain).map_err(|_| invalid("Nội dung file export không hợp lệ"))
}

/// The accounts as plain, pretty JSON text: an array of accounts.
fn to_text(accounts: &[Exported]) -> String {
    serde_json::to_string_pretty(accounts).expect("the accounts serialize")
}

/// The accounts of an export text: an array of accounts, the version 2 object
/// of earlier builds, or a password-protected file of version 1.
fn parse(text: &str, password: Option<&str>) -> Result<Vec<Exported>> {
    if text.len() as u64 > MAX_FILE {
        return Err(invalid("Nội dung quá lớn, không phải export account"));
    }
    let text = text.trim().trim_start_matches('\u{feff}');
    if text.is_empty() {
        return Err(invalid("Chưa có nội dung để import"));
    }
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| TransferError::Invalid(format!("Nội dung không phải JSON hợp lệ: {e}")))?;
    let shape = |e: serde_json::Error| TransferError::Invalid(format!("Danh sách account không hợp lệ: {e}"));
    if value.is_array() {
        return serde_json::from_value(value).map_err(shape);
    }
    if value.get("kdf").is_some() && value.get("data").is_some() {
        let password = password.filter(|p| !p.is_empty()).ok_or(TransferError::NeedsPassword)?;
        return Ok(open(text.as_bytes(), password)?.accounts);
    }
    if value.get("format").is_some_and(|f| f != FORMAT) {
        return Err(invalid("Không phải export account của Sky Manager"));
    }
    if value.get("version").and_then(|v| v.as_u64()).is_some_and(|v| v > VERSION as u64) {
        return Err(invalid("Export của phiên bản mới hơn, hãy cập nhật app"));
    }
    if value.get("accounts").is_none() {
        return Err(invalid("Không phải export account của Sky Manager"));
    }
    Ok(serde_json::from_value::<Bundle>(value).map_err(shape)?.accounts)
}

/// Collects the accounts with their secrets. Touches the disk (secrets): run off the async runtime.
fn collect(registry: &AccountRegistry) -> (Vec<Exported>, Vec<String>) {
    let mut exported = Vec::new();
    let mut skipped = Vec::new();
    for account in registry.list() {
        let Ok((account, sid)) = registry.with_session(account.id) else {
            skipped.push(account.label);
            continue;
        };
        let im = registry
            .im_material(account.id)
            .ok()
            .map(|(username, password)| ImCredentials { username, password });
        exported.push(Exported {
            label: account.label,
            user_id: account.user_id,
            device_uuid: account.device_uuid,
            version: account.version,
            siua: account.siua,
            dfpid: account.dfpid,
            sid,
            im,
            proxy: registry.proxy(account.id),
        });
    }
    (exported, skipped)
}

/// Adds the accounts that are new here, each with its sid and IM credentials.
fn restore(registry: &AccountRegistry, accounts: Vec<Exported>) -> ImportReport {
    let mut report = ImportReport { added: Vec::new(), skipped: Vec::new(), failed: Vec::new() };
    for a in accounts {
        if registry.list().iter().any(|have| have.device_uuid == a.device_uuid) {
            report.skipped.push(a.label);
            continue;
        }
        let label = a.label.clone();
        let new = NewAccount {
            label: a.label,
            user_id: a.user_id,
            device_uuid: a.device_uuid,
            version: a.version,
            siua: a.siua,
            dfpid: a.dfpid,
            device: None,
            device_enabled: false,
            sid: a.sid,
            proxy: a.proxy.map(Into::into),
        };
        match registry.add(new) {
            Ok(account) => {
                // The account is usable without them (a login fetches them again), so a bad pair is not fatal.
                if let Some(im) = a.im
                    && let Err(e) = registry.save_im_credentials(account.id, &im.username, &im.password)
                {
                    eprintln!("import: IM credentials of {label} not saved: {e}");
                }
                report.added.push(label);
            }
            Err(e) => report.failed.push((label, e.to_string())),
        }
    }
    report
}

/// Writes `bytes` readable by the current user only (like sky.db).
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(path)?;
    // The mode above only applies to a new file; an overwritten one keeps its own.
    #[cfg(unix)]
    file.set_permissions(std::os::unix::fs::PermissionsExt::from_mode(0o600))?;
    file.write_all(bytes)
}

fn read_limited(path: &Path) -> Result<Vec<u8>> {
    if std::fs::metadata(path)?.len() > MAX_FILE {
        return Err(invalid("File quá lớn, không phải file export account"));
    }
    Ok(std::fs::read(path)?)
}

// ---------- tauri commands ----------

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| TransferError::Invalid(format!("Lỗi nội bộ: {e}")))?
}

/// Every account with a sid, as JSON text.
fn export(app: &tauri::AppHandle) -> Result<(String, usize, Vec<String>)> {
    use tauri::Manager;
    let (accounts, skipped) = collect(&app.state::<AccountRegistry>());
    if accounts.is_empty() {
        return Err(invalid("Không có account nào có sid để export"));
    }
    let exported = accounts.len();
    Ok((to_text(&accounts), exported, skipped))
}

/// Every account as JSON text, to show and copy.
#[tauri::command]
pub async fn accounts_export_text(app: tauri::AppHandle) -> Result<ExportReport> {
    blocking(move || {
        let (text, exported, skipped) = export(&app)?;
        Ok(ExportReport { exported, skipped, text: Some(text) })
    })
    .await
}

/// Writes every account as JSON text to `path` (readable by the current user only).
#[tauri::command]
pub async fn accounts_export_file(app: tauri::AppHandle, path: String) -> Result<ExportReport> {
    blocking(move || {
        let (text, exported, skipped) = export(&app)?;
        write_private(Path::new(&path), text.as_bytes())?;
        Ok(ExportReport { exported, skipped, text: None })
    })
    .await
}

/// The text of a file picked for import, to show before importing it.
#[tauri::command]
pub async fn accounts_read_file(path: String) -> Result<String> {
    blocking(move || {
        String::from_utf8(read_limited(Path::new(&path))?).map_err(|_| invalid("File không phải văn bản (UTF-8)"))
    })
    .await
}

/// Imports the accounts of an export text; those already here are skipped.
/// `password` only for a password-protected file of an earlier build.
#[tauri::command]
pub async fn accounts_import_text(app: tauri::AppHandle, text: String, password: Option<String>) -> Result<ImportReport> {
    use tauri::Manager;
    blocking(move || {
        let accounts = parse(&text, password.as_deref())?;
        Ok(restore(&app.state::<AccountRegistry>(), accounts))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    /// Few rounds: the test build is unoptimised.
    const FAST: u32 = 10;

    fn registry() -> (tempfile::TempDir, AccountRegistry) {
        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(crate::storage::db::Db::open(dir.path(), None).unwrap());
        (dir, AccountRegistry::open(db).unwrap())
    }

    fn new(label: &str, uuid: &str, sid: &str) -> NewAccount {
        NewAccount {
            label: label.into(),
            user_id: Some("u1".into()),
            device_uuid: uuid.into(),
            version: "7.77.0".into(),
            siua: None,
            dfpid: None,
            device: None,
            device_enabled: false,
            sid: sid.into(),
            proxy: None,
        }
    }

    #[test]
    fn old_password_files_open_only_with_their_password() {
        let bundle = Bundle {
            format: None,
            version: None,
            exported_at: 1,
            accounts: vec![Exported {
                label: "A".into(),
                user_id: None,
                device_uuid: "d1".into(),
                version: "7.77.0".into(),
                siua: None,
                dfpid: None,
                sid: "SID-SECRET".into(),
                im: Some(ImCredentials { username: "love1".into(), password: "IM-SECRET".into() }),
                proxy: Some(crate::net::proxy::Proxy {
                    enabled: true,
                    kind: crate::net::proxy::ProxyKind::Http,
                    host: "198.51.100.7".into(),
                    port: 8080,
                    username: "PROXY-USER".into(),
                    password: "PROXY-SECRET".into(),
                }),
            }],
        };
        let file = seal(&bundle, "mat-khau-dai", FAST).unwrap();
        let text = String::from_utf8(file.clone()).unwrap();
        for secret in ["SID-SECRET", "IM-SECRET", "love1", "d1\"", "PROXY-USER", "PROXY-SECRET", "198.51.100.7"] {
            assert!(!text.contains(secret), "{secret} readable in the file");
        }
        assert_eq!(open(&file, "mat-khau-dai").unwrap().accounts, bundle.accounts);
        assert!(matches!(open(&file, "sai-mat-khau"), Err(TransferError::Decrypt)));

        // A changed header (fewer rounds) or ciphertext byte fails the tag check.
        let mut envelope: Envelope = serde_json::from_slice(&file).unwrap();
        envelope.iterations = FAST + 1;
        assert!(matches!(open(&serde_json::to_vec(&envelope).unwrap(), "mat-khau-dai"), Err(TransferError::Decrypt)));
        let mut envelope: Envelope = serde_json::from_slice(&file).unwrap();
        let mut data = STANDARD.decode(&envelope.data).unwrap();
        data[0] ^= 1;
        envelope.data = STANDARD.encode(data);
        assert!(matches!(open(&serde_json::to_vec(&envelope).unwrap(), "mat-khau-dai"), Err(TransferError::Decrypt)));

        assert!(open(b"{}", "mat-khau-dai").is_err());

        // Through the import text: the password is asked for, then used.
        let text = std::str::from_utf8(&file).unwrap();
        assert!(matches!(parse(text, None), Err(TransferError::NeedsPassword)));
        assert!(matches!(parse(text, Some("")), Err(TransferError::NeedsPassword)));
        assert!(matches!(parse(text, Some("sai-mat-khau")), Err(TransferError::Decrypt)));
        assert_eq!(parse(text, Some("mat-khau-dai")).unwrap(), bundle.accounts);
        assert!(open(b"not json", "mat-khau-dai").is_err());
    }

    #[test]
    fn export_then_import_moves_accounts_with_their_secrets_and_skips_known_ones() {
        let (_a, source) = registry();
        let proxy = crate::net::proxy::ProxyForm {
            enabled: false,
            kind: crate::net::proxy::ProxyKind::Socks5,
            host: "10.0.0.9".into(),
            port: 1080,
            username: "pu".into(),
            password: "pp".into(),
        };
        let one = source.add(NewAccount { proxy: Some(proxy), ..new("Một", "dev-1", "sid-1") }).unwrap();
        source.add(new("Hai", "dev-2", "sid-2")).unwrap();
        source.save_im_credentials(one.id, "love1", "pw1").unwrap();
        let (accounts, skipped) = collect(&source);
        assert_eq!((accounts.len(), skipped.len()), (2, 0));
        let text = to_text(&accounts);
        assert!(text.starts_with('[') && text.contains("\"sid\": \"sid-1\""), "a bare array: {text}");
        assert!(!text.contains("format") && !text.contains("exportedAt"), "accounts only: {text}");

        let (_b, target) = registry();
        target.add(new("Đã có", "dev-2", "sid-x")).unwrap();
        let report = restore(&target, parse(&text, None).unwrap());
        assert_eq!(report, ImportReport { added: vec!["Một".into()], skipped: vec!["Hai".into()], failed: vec![] });

        let moved = target.list().into_iter().find(|a| a.device_uuid == "dev-1").unwrap();
        assert_eq!(target.with_session(moved.id).unwrap().1, "sid-1");
        assert_eq!(target.im_material(moved.id).unwrap(), ("love1".into(), "pw1".into()));
        let p = target.proxy(moved.id).unwrap();
        assert_eq!((p.enabled, p.host.as_str(), p.username.as_str(), p.password.as_str()), (false, "10.0.0.9", "pu", "pp"));
        let kept = target.list().into_iter().find(|a| a.device_uuid == "dev-2").unwrap();
        assert_eq!((kept.label.as_str(), target.with_session(kept.id).unwrap().1.as_str()), ("Đã có", "sid-x"));
        assert_ne!(moved.id, one.id, "a new local id");
    }

    #[test]
    fn import_text_takes_a_bare_list_and_refuses_what_is_not_an_export() {
        let one = r#"{"label":"A","deviceUuid":"d1","version":"7.77.0","sid":"s1"}"#;
        let accounts = parse(&format!("\u{feff}  [{one}]\n"), None).unwrap();
        assert_eq!((accounts.len(), accounts[0].sid.as_str(), accounts[0].im.is_none()), (1, "s1", true));
        assert_eq!(parse(&format!(r#"{{"accounts":[{one}]}}"#), None).unwrap().len(), 1);

        for bad in ["", "   ", "not json", "{}", r#"{"format":"other","accounts":[]}"#, r#"[{"label":"A"}]"#] {
            assert!(matches!(parse(bad, None), Err(TransferError::Invalid(_))), "{bad:?} accepted");
        }
        let newer = format!(r#"{{"format":"{FORMAT}","version":3,"accounts":[]}}"#);
        assert!(parse(&newer, None).unwrap_err().to_string().contains("mới hơn"));
    }

    #[test]
    fn invalid_accounts_are_reported_not_fatal() {
        let (_d, target) = registry();
        let bad = Exported {
            label: "Hỏng".into(),
            user_id: None,
            device_uuid: "dev-9".into(),
            version: "7.77.0".into(),
            siua: None,
            dfpid: None,
            sid: String::new(),
            im: None,
            proxy: None,
        };
        let report = restore(&target, vec![bad]);
        assert_eq!((report.added.len(), report.failed.len()), (0, 1));
        assert_eq!(report.failed[0].0, "Hỏng");
    }

    #[cfg(unix)]
    #[test]
    fn the_file_is_readable_by_its_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("accounts.skyacc");
        std::fs::write(&path, b"old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        write_private(&path, b"x").unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(read_limited(&path).unwrap(), b"x");
    }
}
