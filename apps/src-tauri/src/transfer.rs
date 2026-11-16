//! Account export and import: a file with every account, its sid and its IM
//! credentials, encrypted with a password the user chooses, to move the
//! accounts to another machine or keep a backup.
//!
//! File (JSON): `format`, `version`, `kdf` (PBKDF2-HMAC-SHA256 with `iterations`
//! and a random 16-byte `salt`), a random 12-byte `nonce`, and `data`: the
//! AES-256-GCM ciphertext of the account list, the header bound as associated
//! data. Without the password nothing in it can be read; a wrong password or
//! a changed byte fails the tag check.
//!
//! Secrets never pass through the webview: it only gives the file path and the
//! password. Import adds accounts whose device UUID is new and skips the rest.
//! The proxy goes with its password; an imported one is not tested. The device
//! setup (JSON, DFPID refresh) is not exported.

use std::path::Path;

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::accounts::{AccountRegistry, NewAccount};

const FORMAT: &str = "sky-manager-accounts";
const VERSION: u32 = 1;
const KDF: &str = "pbkdf2-sha256";
/// PBKDF2 rounds for new files (OWASP 2023 figure for HMAC-SHA256).
const ITERATIONS: u32 = 600_000;
/// Rounds a file may ask for: enough to refuse a file built to stall the app.
const MAX_ITERATIONS: u32 = 10_000_000;
const MIN_PASSWORD: usize = 8;
/// Largest file read on import.
const MAX_FILE: u64 = 16 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum TransferError {
    #[error("{0}")]
    Invalid(String),
    #[error("Sai mật khẩu hoặc file đã bị sửa")]
    Decrypt,
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

/// The file as written.
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

/// The decrypted content.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bundle {
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
    proxy: Option<crate::proxy::Proxy>,
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

fn check_password(password: &str) -> Result<()> {
    if password.chars().count() < MIN_PASSWORD {
        return Err(TransferError::Invalid(format!("Mật khẩu file cần ít nhất {MIN_PASSWORD} ký tự")));
    }
    Ok(())
}

fn key(password: &str, salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, iterations, &mut key);
    key
}

/// The header fields bound to the ciphertext, so none can be swapped.
fn aad(iterations: u32, salt: &str) -> Vec<u8> {
    format!("{FORMAT}/{VERSION}/{KDF}/{iterations}/{salt}").into_bytes()
}

fn random<const N: usize>() -> Result<[u8; N]> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).map_err(|e| TransferError::Invalid(format!("Không tạo được số ngẫu nhiên: {e}")))?;
    Ok(bytes)
}

fn seal(bundle: &Bundle, password: &str, iterations: u32) -> Result<Vec<u8>> {
    check_password(password)?;
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
        version: VERSION,
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
    if envelope.version != VERSION || envelope.kdf != KDF {
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

/// Exports every account to `path`, encrypted with `password`.
#[tauri::command]
pub async fn accounts_export(app: tauri::AppHandle, path: String, password: String) -> Result<ExportReport> {
    use tauri::Manager;
    check_password(&password)?;
    blocking(move || {
        let registry = app.state::<AccountRegistry>();
        let (accounts, skipped) = collect(&registry);
        if accounts.is_empty() {
            return Err(invalid("Không có account nào có sid để export"));
        }
        let exported = accounts.len();
        let file = seal(&Bundle { exported_at: crate::store::now_ms(), accounts }, &password, ITERATIONS)?;
        write_private(Path::new(&path), &file)?;
        Ok(ExportReport { exported, skipped })
    })
    .await
}

/// Imports the accounts of the file at `path`; those already here are skipped.
#[tauri::command]
pub async fn accounts_import(app: tauri::AppHandle, path: String, password: String) -> Result<ImportReport> {
    use tauri::Manager;
    blocking(move || {
        let bundle = open(&read_limited(Path::new(&path))?, &password)?;
        Ok(restore(&app.state::<AccountRegistry>(), bundle.accounts))
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
        let db = Arc::new(crate::db::Db::open(dir.path(), None).unwrap());
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
    fn a_file_opens_only_with_its_password_and_hides_every_secret() {
        let bundle = Bundle {
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
                proxy: Some(crate::proxy::Proxy {
                    enabled: true,
                    kind: crate::proxy::ProxyKind::Http,
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

        assert!(seal(&bundle, "ngan", FAST).is_err(), "password too short");
        assert!(open(b"{}", "mat-khau-dai").is_err());
        assert!(open(b"not json", "mat-khau-dai").is_err());
    }

    #[test]
    fn export_then_import_moves_accounts_with_their_secrets_and_skips_known_ones() {
        let (_a, source) = registry();
        let proxy = crate::proxy::ProxyForm {
            enabled: false,
            kind: crate::proxy::ProxyKind::Socks5,
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
        let file = seal(&Bundle { exported_at: 1, accounts }, "mat-khau-dai", FAST).unwrap();

        let (_b, target) = registry();
        target.add(new("Đã có", "dev-2", "sid-x")).unwrap();
        let report = restore(&target, open(&file, "mat-khau-dai").unwrap().accounts);
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
