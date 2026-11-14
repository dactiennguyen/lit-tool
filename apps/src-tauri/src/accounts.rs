//! Account registry for Sky Manager.
//!
//! Non-secret metadata lives in `accounts.json` inside the app data dir.
//! The session token (`sid`) is stored in the OS credential store and is
//! never sent back to the webview.

#[cfg(test)]
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Deserializer, Serialize};
use uuid::Uuid;

use crate::store::{self, Loaded, now_ms};

const KEYRING_SERVICE: &str = "sky-manager.session";
const FILE_NAME: &str = "accounts.json";

#[derive(Debug, thiserror::Error)]
pub enum AccountError {
    #[error("{0}")]
    Invalid(String),
    #[error("Không tìm thấy account")]
    NotFound,
    #[error("Đã có account dùng device UUID này")]
    Duplicate,
    #[error("Lỗi đọc/ghi dữ liệu: {0}")]
    Io(#[from] std::io::Error),
    #[error("Không truy cập được kho bảo mật của hệ điều hành: {0}")]
    Secret(String),
}

impl Serialize for AccountError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AccountError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: Uuid,
    pub label: String,
    pub user_id: Option<String>,
    pub device_uuid: String,
    pub version: String,
    pub created_at: u64,
    /// When the sid was last written to the credential store (ms since epoch).
    pub session_saved_at: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAccount {
    pub label: String,
    pub user_id: Option<String>,
    pub device_uuid: String,
    pub version: String,
    pub sid: String,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountPatch {
    pub label: Option<String>,
    /// absent = keep, `null` = clear, string = set.
    #[serde(default, deserialize_with = "present")]
    pub user_id: Option<Option<String>>,
    pub version: Option<String>,
    pub sid: Option<String>,
}

/// Distinguishes a field sent as `null` (Some(None)) from a missing one (None).
fn present<'de, D: Deserializer<'de>>(d: D) -> std::result::Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(d).map(Some)
}

// ---------- validation (mirrors scripts/src/lit/profile.ts) ----------

fn is_token(s: &str, max: usize, extra: &[char]) -> bool {
    !s.is_empty()
        && s.chars().count() <= max
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || extra.contains(&c))
}

fn clean_label(label: &str) -> Result<String> {
    let label = label.trim();
    if label.is_empty() || label.chars().count() > 64 {
        return Err(AccountError::Invalid("Tên hiển thị phải từ 1 đến 64 ký tự".into()));
    }
    Ok(label.to_owned())
}

fn clean_user_id(user_id: Option<String>) -> Result<Option<String>> {
    match user_id.map(|u| u.trim().to_owned()).filter(|u| !u.is_empty()) {
        None => Ok(None),
        Some(u) if is_token(&u, 128, &[]) => Ok(Some(u)),
        Some(_) => Err(AccountError::Invalid("User ID chỉ gồm chữ, số, _ và -".into())),
    }
}

fn clean_device_uuid(v: &str) -> Result<String> {
    let v = v.trim();
    if !is_token(v, 128, &[]) {
        return Err(AccountError::Invalid("Device UUID chỉ gồm chữ, số, _ và - (tối đa 128 ký tự)".into()));
    }
    Ok(v.to_owned())
}

fn clean_version(v: &str) -> Result<String> {
    let v = v.trim();
    if !is_token(v, 64, &['.']) {
        return Err(AccountError::Invalid("Version không hợp lệ (ví dụ 7.77.0)".into()));
    }
    Ok(v.to_owned())
}

fn clean_sid(v: &str) -> Result<String> {
    let v = v.trim();
    if v.is_empty() || v.len() > 4096 || v.chars().any(char::is_control) {
        return Err(AccountError::Invalid("Session (sid) không hợp lệ".into()));
    }
    Ok(v.to_owned())
}

// ---------- secret storage ----------

pub trait SecretStore: Send + Sync {
    fn set(&self, key: &str, secret: &str) -> Result<()>;
    fn delete(&self, key: &str) -> Result<()>;
}

pub struct KeyringStore;

impl KeyringStore {
    fn entry(key: &str) -> Result<keyring::Entry> {
        keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| AccountError::Secret(e.to_string()))
    }
}

impl SecretStore for KeyringStore {
    fn set(&self, key: &str, secret: &str) -> Result<()> {
        Self::entry(key)?
            .set_password(secret)
            .map_err(|e| AccountError::Secret(e.to_string()))
    }

    fn delete(&self, key: &str) -> Result<()> {
        match Self::entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AccountError::Secret(e.to_string())),
        }
    }
}

/// In-memory store used by tests.
#[cfg(test)]
#[derive(Default)]
pub struct MemoryStore(pub Mutex<HashMap<String, String>>);

#[cfg(test)]
impl SecretStore for MemoryStore {
    fn set(&self, key: &str, secret: &str) -> Result<()> {
        self.0.lock().unwrap().insert(key.to_owned(), secret.to_owned());
        Ok(())
    }
    fn delete(&self, key: &str) -> Result<()> {
        self.0.lock().unwrap().remove(key);
        Ok(())
    }
}

// ---------- registry ----------

pub struct AccountRegistry {
    path: PathBuf,
    accounts: Mutex<Vec<Account>>,
    secrets: Box<dyn SecretStore>,
    /// Set when accounts.json was unreadable and moved aside on startup.
    recovered_backup: Option<PathBuf>,
}

impl AccountRegistry {
    pub fn open(dir: &Path, secrets: Box<dyn SecretStore>) -> Result<Self> {
        fs::create_dir_all(dir)?;
        let path = dir.join(FILE_NAME);
        let (accounts, recovered_backup) = match store::read_json_or_quarantine(&path)? {
            Loaded::Ok(accounts) => (accounts, None),
            Loaded::Missing => (Vec::new(), None),
            Loaded::Recovered(backup) => {
                eprintln!("accounts.json was corrupt, moved to {}", backup.display());
                (Vec::new(), Some(backup))
            }
        };
        Ok(Self { path, accounts: Mutex::new(accounts), secrets, recovered_backup })
    }

    pub fn recovered_backup(&self) -> Option<String> {
        self.recovered_backup.as_ref().map(|p| p.display().to_string())
    }

    pub fn list(&self) -> Vec<Account> {
        self.accounts.lock().unwrap().clone()
    }

    pub fn add(&self, input: NewAccount) -> Result<Account> {
        let label = clean_label(&input.label)?;
        let user_id = clean_user_id(input.user_id)?;
        let device_uuid = clean_device_uuid(&input.device_uuid)?;
        let version = clean_version(&input.version)?;
        let sid = clean_sid(&input.sid)?;

        let mut accounts = self.accounts.lock().unwrap();
        if accounts.iter().any(|a| a.device_uuid == device_uuid) {
            return Err(AccountError::Duplicate);
        }
        let now = now_ms();
        let account = Account {
            id: Uuid::new_v4(),
            label,
            user_id,
            device_uuid,
            version,
            created_at: now,
            session_saved_at: Some(now),
        };
        let key = account.id.to_string();
        self.secrets.set(&key, &sid)?;

        let mut next = accounts.clone();
        next.push(account.clone());
        if let Err(e) = self.persist(&next) {
            let _ = self.secrets.delete(&key);
            return Err(e);
        }
        *accounts = next;
        Ok(account)
    }

    pub fn update(&self, id: Uuid, patch: AccountPatch) -> Result<Account> {
        let mut accounts = self.accounts.lock().unwrap();
        let mut next = accounts.clone();
        let account = next.iter_mut().find(|a| a.id == id).ok_or(AccountError::NotFound)?;

        if let Some(label) = patch.label {
            account.label = clean_label(&label)?;
        }
        if let Some(user_id) = patch.user_id {
            account.user_id = clean_user_id(user_id)?;
        }
        if let Some(version) = patch.version {
            account.version = clean_version(&version)?;
        }
        let sid = patch.sid.as_deref().map(clean_sid).transpose()?;
        if sid.is_some() {
            account.session_saved_at = Some(now_ms());
        }
        let updated = account.clone();

        // Metadata first: if that fails nothing has changed. If the keychain
        // write then fails, roll the metadata back so the old sid stays valid.
        self.persist(&next)?;
        if let Some(sid) = sid
            && let Err(e) = self.secrets.set(&id.to_string(), &sid)
        {
            let _ = self.persist(&accounts);
            return Err(e);
        }
        *accounts = next;
        Ok(updated)
    }

    pub fn remove(&self, id: Uuid) -> Result<()> {
        let mut accounts = self.accounts.lock().unwrap();
        let next: Vec<Account> = accounts.iter().filter(|a| a.id != id).cloned().collect();
        if next.len() == accounts.len() {
            return Err(AccountError::NotFound);
        }
        self.persist(&next)?;
        *accounts = next;
        drop(accounts);
        // The account is gone either way; a leftover keychain item is harmless
        // and must not make the UI think the removal failed.
        if let Err(e) = self.secrets.delete(&id.to_string()) {
            eprintln!("account removed but keychain cleanup failed: {e}");
        }
        Ok(())
    }

    fn persist(&self, accounts: &[Account]) -> Result<()> {
        Ok(store::write_json_atomic(&self.path, accounts)?)
    }
}

// ---------- tauri commands ----------

type State<'a> = tauri::State<'a, AccountRegistry>;

#[tauri::command(async)]
pub fn accounts_list(registry: State<'_>) -> Vec<Account> {
    registry.list()
}

#[tauri::command(async)]
pub fn accounts_add(registry: State<'_>, input: NewAccount) -> Result<Account> {
    registry.add(input)
}

#[tauri::command(async)]
pub fn accounts_update(registry: State<'_>, id: Uuid, patch: AccountPatch) -> Result<Account> {
    registry.update(id, patch)
}

#[tauri::command]
pub fn accounts_recovered_backup(registry: State<'_>) -> Option<String> {
    registry.recovered_backup()
}

#[tauri::command(async)]
pub fn accounts_remove(registry: State<'_>, id: Uuid) -> Result<()> {
    registry.remove(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    struct Shared(Arc<MemoryStore>);
    impl SecretStore for Shared {
        fn set(&self, k: &str, s: &str) -> Result<()> { self.0.set(k, s) }
        fn delete(&self, k: &str) -> Result<()> { self.0.delete(k) }
    }

    fn input(device: &str) -> NewAccount {
        NewAccount {
            label: "  Acc 1 ".into(),
            user_id: Some("".into()),
            device_uuid: device.into(),
            version: "7.77.0".into(),
            sid: "secret-sid".into(),
        }
    }

    fn registry(dir: &Path) -> (AccountRegistry, Arc<MemoryStore>) {
        let store = Arc::new(MemoryStore::default());
        (AccountRegistry::open(dir, Box::new(Shared(store.clone()))).unwrap(), store)
    }

    #[test]
    fn add_persists_metadata_and_keeps_sid_out_of_file() {
        let dir = tempfile::tempdir().unwrap();
        let (reg, store) = registry(dir.path());
        let acc = reg.add(input("dev-1")).unwrap();
        assert_eq!(acc.label, "Acc 1");
        assert_eq!(acc.user_id, None);

        let raw = fs::read_to_string(dir.path().join(FILE_NAME)).unwrap();
        assert!(!raw.contains("secret-sid"));
        assert_eq!(store.0.lock().unwrap().get(&acc.id.to_string()).unwrap(), "secret-sid");

        let (reopened, _) = registry(dir.path());
        assert_eq!(reopened.list(), vec![acc]);
    }

    #[test]
    fn rejects_duplicate_device_and_bad_fields() {
        let dir = tempfile::tempdir().unwrap();
        let (reg, store) = registry(dir.path());
        reg.add(input("dev-1")).unwrap();
        assert!(matches!(reg.add(input("dev-1")), Err(AccountError::Duplicate)));
        assert!(matches!(reg.add(input("bad uuid!")), Err(AccountError::Invalid(_))));
        let mut bad_version = input("dev-2");
        bad_version.version = "7 77".into();
        assert!(matches!(reg.add(bad_version), Err(AccountError::Invalid(_))));
        let mut no_sid = input("dev-3");
        no_sid.sid = "   ".into();
        assert!(matches!(reg.add(no_sid), Err(AccountError::Invalid(_))));
        assert_eq!(reg.list().len(), 1);
        assert_eq!(store.0.lock().unwrap().len(), 1);
    }

    #[test]
    fn update_and_remove() {
        let dir = tempfile::tempdir().unwrap();
        let (reg, store) = registry(dir.path());
        let acc = reg.add(input("dev-1")).unwrap();
        let updated = reg
            .update(acc.id, AccountPatch {
                label: Some("Renamed".into()),
                user_id: Some(Some("10".into())),
                version: None,
                sid: Some("new-sid".into()),
            })
            .unwrap();
        assert_eq!(updated.label, "Renamed");
        assert_eq!(updated.user_id.as_deref(), Some("10"));
        assert_eq!(store.0.lock().unwrap().get(&acc.id.to_string()).unwrap(), "new-sid");

        // A failed patch must not partially apply.
        let bad = reg.update(acc.id, AccountPatch {
            label: Some("Ok".into()),
            user_id: None,
            version: Some("bad version".into()),
            sid: None,
        });
        assert!(bad.is_err());
        assert_eq!(reg.list()[0].label, "Renamed");

        reg.remove(acc.id).unwrap();
        assert!(reg.list().is_empty());
        assert!(store.0.lock().unwrap().is_empty());
        assert!(matches!(reg.remove(acc.id), Err(AccountError::NotFound)));
    }

    #[test]
    fn corrupt_file_is_moved_aside_not_lost() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(FILE_NAME), b"{not json").unwrap();
        let reg = AccountRegistry::open(dir.path(), Box::new(MemoryStore::default())).unwrap();
        assert!(reg.list().is_empty());
        let backup = reg.recovered_backup().expect("backup path");
        assert_eq!(fs::read(&backup).unwrap(), b"{not json");
        assert!(!dir.path().join(FILE_NAME).exists());
    }

    #[test]
    fn patch_distinguishes_null_from_missing_user_id() {
        let clear: AccountPatch = serde_json::from_str(r#"{"userId":null}"#).unwrap();
        assert_eq!(clear.user_id, Some(None));
        let keep: AccountPatch = serde_json::from_str("{}").unwrap();
        assert_eq!(keep.user_id, None);

        let dir = tempfile::tempdir().unwrap();
        let (reg, _) = registry(dir.path());
        let mut with_id = input("dev-1");
        with_id.user_id = Some("10".into());
        let acc = reg.add(with_id).unwrap();
        assert_eq!(reg.update(acc.id, keep).unwrap().user_id.as_deref(), Some("10"));
        assert_eq!(reg.update(acc.id, clear).unwrap().user_id, None);
    }

    struct FailingSet(Arc<MemoryStore>);
    impl SecretStore for FailingSet {
        fn set(&self, k: &str, s: &str) -> Result<()> {
            if s == "fail" { Err(AccountError::Secret("locked".into())) } else { self.0.set(k, s) }
        }
        fn delete(&self, _: &str) -> Result<()> { Err(AccountError::Secret("locked".into())) }
    }

    #[test]
    fn keychain_failures_keep_state_consistent() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(MemoryStore::default());
        let reg = AccountRegistry::open(dir.path(), Box::new(FailingSet(store.clone()))).unwrap();
        let acc = reg.add(input("dev-1")).unwrap();

        // sid write fails -> old sid and metadata both unchanged, on disk too.
        let patch = AccountPatch { label: Some("New".into()), user_id: None, version: None, sid: Some("fail".into()) };
        assert!(reg.update(acc.id, patch).is_err());
        assert_eq!(reg.list(), vec![acc.clone()]);
        assert_eq!(store.0.lock().unwrap().get(&acc.id.to_string()).unwrap(), "secret-sid");
        let (reopened, _) = registry(dir.path());
        assert_eq!(reopened.list(), vec![acc.clone()]);

        // keychain delete fails -> removal still reported as success.
        reg.remove(acc.id).unwrap();
        assert!(reg.list().is_empty());
    }
}
