//! Account registry for Sky Manager.
//!
//! Non-secret metadata lives in `accounts.json` inside the app data dir.
//! The session token (`sid`) is stored in the OS credential store and is
//! never sent back to the webview.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Deserializer, Serialize};
use uuid::Uuid;

use crate::hx::{self, HxSecret};
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
    /// Device tokens captured from the real device (optional request headers).
    #[serde(default)]
    pub siua: Option<String>,
    #[serde(default)]
    pub dfpid: Option<String>,
    pub created_at: u64,
    /// When the sid was last written to the credential store (ms since epoch).
    pub session_saved_at: Option<u64>,
    /// IM (Hyphenate) login settings; the secrets live in the keychain.
    #[serde(default)]
    pub hx: Option<HxConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HxConfig {
    pub host: String,
    pub port: u16,
    pub rest_base: Option<String>,
    /// Read from the login template, shown in the UI.
    pub app_key: String,
    pub username: String,
    /// "access_token" or "password": which secret the next login will use.
    pub auth: String,
}

/// Blank secret fields keep what is already stored.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HxInput {
    pub host: String,
    pub port: Option<u16>,
    pub rest_base: Option<String>,
    pub template_b64: Option<String>,
    pub password: Option<String>,
    pub access_token: Option<String>,
}

fn hx_key(id: Uuid) -> String {
    format!("{id}.hx")
}

fn non_blank(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_owned()).filter(|s| !s.is_empty())
}

fn clean_hx_secret(v: Option<String>, name: &str) -> Result<Option<String>> {
    match non_blank(v) {
        Some(s) if s.len() > 4096 || s.chars().any(char::is_control) => {
            Err(AccountError::Invalid(format!("{name} không hợp lệ")))
        }
        other => Ok(other),
    }
}

fn hx_invalid(e: hx::HxError) -> AccountError {
    AccountError::Invalid(e.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAccount {
    pub label: String,
    pub user_id: Option<String>,
    pub device_uuid: String,
    pub version: String,
    #[serde(default)]
    pub siua: Option<String>,
    #[serde(default)]
    pub dfpid: Option<String>,
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
    #[serde(default, deserialize_with = "present")]
    pub siua: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    pub dfpid: Option<Option<String>>,
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

/// Mirrors the `dfpid`/`siua` check in scripts/src/lit/profile.ts.
fn clean_device_token(v: Option<String>, name: &str) -> Result<Option<String>> {
    match v.map(|t| t.trim().to_owned()).filter(|t| !t.is_empty()) {
        None => Ok(None),
        Some(t) if is_token(&t, 512, &['+', '/', '=']) => Ok(Some(t)),
        Some(_) => Err(AccountError::Invalid(format!("{name} chỉ gồm chữ, số và + / = _ - (tối đa 512)"))),
    }
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
    fn get(&self, key: &str) -> Result<Option<String>>;
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
    fn get(&self, key: &str) -> Result<Option<String>> {
        match Self::entry(key)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AccountError::Secret(e.to_string())),
        }
    }

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
    fn get(&self, key: &str) -> Result<Option<String>> {
        Ok(self.0.lock().unwrap().get(key).cloned())
    }
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
    /// sids already read from (or written to) the keychain this run, so each
    /// API call doesn't hit the keychain again.
    sessions: Mutex<HashMap<Uuid, String>>,
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
        Ok(Self { path, accounts: Mutex::new(accounts), secrets, recovered_backup, sessions: Mutex::default() })
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
        let siua = clean_device_token(input.siua, "SIUA")?;
        let dfpid = clean_device_token(input.dfpid, "DFPID")?;
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
            siua,
            dfpid,
            created_at: now,
            session_saved_at: Some(now),
            hx: None,
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
        self.sessions.lock().unwrap().insert(account.id, sid);
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
        if let Some(siua) = patch.siua {
            account.siua = clean_device_token(siua, "SIUA")?;
        }
        if let Some(dfpid) = patch.dfpid {
            account.dfpid = clean_device_token(dfpid, "DFPID")?;
        }
        let sid = patch.sid.as_deref().map(clean_sid).transpose()?;
        if sid.is_some() {
            account.session_saved_at = Some(now_ms());
        }
        let updated = account.clone();

        // Metadata first: if that fails nothing has changed. If the keychain
        // write then fails, roll the metadata back so the old sid stays valid.
        self.persist(&next)?;
        if let Some(sid) = sid {
            if let Err(e) = self.secrets.set(&id.to_string(), &sid) {
                let _ = self.persist(&accounts);
                return Err(e);
            }
            self.sessions.lock().unwrap().insert(id, sid);
        }
        *accounts = next;
        Ok(updated)
    }

    /// Account plus its sid, for signing requests inside the backend only.
    pub fn with_session(&self, id: Uuid) -> Result<(Account, String)> {
        let account = self.list().into_iter().find(|a| a.id == id).ok_or(AccountError::NotFound)?;
        if let Some(sid) = self.sessions.lock().unwrap().get(&id) {
            return Ok((account, sid.clone()));
        }
        // May block (keychain prompt): callers run this off the async runtime.
        let sid = self
            .secrets
            .get(&id.to_string())?
            .ok_or_else(|| AccountError::Invalid("Account chưa có session trong Keychain, hãy nhập lại sid".into()))?;
        self.sessions.lock().unwrap().insert(id, sid.clone());
        Ok((account, sid))
    }

    /// Save IM login settings. Metadata is written first and rolled back if the
    /// keychain write fails, like `update`.
    pub fn set_hx(&self, id: Uuid, input: HxInput) -> Result<Account> {
        let host = hx::validate_host(&input.host).map_err(hx_invalid)?;
        let port = input.port.unwrap_or(hx::DEFAULT_IM_PORT);
        if port == 0 {
            return Err(AccountError::Invalid("Port không hợp lệ".into()));
        }
        let rest_base = non_blank(input.rest_base).map(|r| hx::easemob_origin(&r)).transpose().map_err(hx_invalid)?;
        let password = clean_hx_secret(input.password, "hxPwd")?;
        let access_token = clean_hx_secret(input.access_token, "Access token")?;

        let key = hx_key(id);
        // An unreadable old entry is simply replaced.
        let old: HxSecret =
            self.secrets.get(&key)?.and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or_default();
        let template_b64 = non_blank(input.template_b64).unwrap_or(old.template_b64);
        if template_b64.is_empty() {
            return Err(AccountError::Invalid("Cần login template (base64)".into()));
        }
        let template = hx::parse_template(&template_b64).map_err(hx_invalid)?;
        let secret = HxSecret {
            template_b64: template_b64.trim().to_owned(),
            password: password.or(old.password),
            access_token: access_token.or(old.access_token),
        };
        if secret.password.is_none() && secret.access_token.is_none() {
            return Err(AccountError::Invalid("Cần hxPwd hoặc access token".into()));
        }
        let config = HxConfig {
            host,
            port,
            rest_base,
            app_key: template.app_key,
            username: template.username,
            auth: if secret.access_token.is_some() { "access_token" } else { "password" }.into(),
        };

        let mut accounts = self.accounts.lock().unwrap();
        let mut next = accounts.clone();
        let account = next.iter_mut().find(|a| a.id == id).ok_or(AccountError::NotFound)?;
        account.hx = Some(config);
        let updated = account.clone();
        self.persist(&next)?;
        let json = serde_json::to_string(&secret).map_err(|e| AccountError::Invalid(e.to_string()))?;
        if let Err(e) = self.secrets.set(&key, &json) {
            let _ = self.persist(&accounts);
            return Err(e);
        }
        *accounts = next;
        Ok(updated)
    }

    pub fn clear_hx(&self, id: Uuid) -> Result<Account> {
        let mut accounts = self.accounts.lock().unwrap();
        let mut next = accounts.clone();
        let account = next.iter_mut().find(|a| a.id == id).ok_or(AccountError::NotFound)?;
        account.hx = None;
        let updated = account.clone();
        self.persist(&next)?;
        *accounts = next;
        drop(accounts);
        if let Err(e) = self.secrets.delete(&hx_key(id)) {
            eprintln!("chat settings cleared but keychain cleanup failed: {e}");
        }
        Ok(updated)
    }

    /// IM settings plus secrets, for the backend only. May block on the keychain.
    pub fn hx_material(&self, id: Uuid) -> Result<(HxConfig, HxSecret)> {
        let account = self.list().into_iter().find(|a| a.id == id).ok_or(AccountError::NotFound)?;
        let config = account.hx.ok_or_else(|| AccountError::Invalid("Account chưa cấu hình chat".into()))?;
        let missing = || AccountError::Invalid("Thiếu thông tin chat trong Keychain, hãy nhập lại".into());
        let raw = self.secrets.get(&hx_key(id))?.ok_or_else(missing)?;
        let secret = serde_json::from_str(&raw).map_err(|_| missing())?;
        Ok((config, secret))
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
        self.sessions.lock().unwrap().remove(&id);
        // The account is gone either way; a leftover keychain item is harmless
        // and must not make the UI think the removal failed.
        for key in [id.to_string(), hx_key(id)] {
            if let Err(e) = self.secrets.delete(&key) {
                eprintln!("account removed but keychain cleanup failed: {e}");
            }
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
pub fn accounts_set_hx(registry: State<'_>, id: Uuid, input: HxInput) -> Result<Account> {
    registry.set_hx(id, input)
}

#[tauri::command(async)]
pub fn accounts_clear_hx(registry: State<'_>, id: Uuid) -> Result<Account> {
    registry.clear_hx(id)
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
        fn get(&self, k: &str) -> Result<Option<String>> { self.0.get(k) }
        fn set(&self, k: &str, s: &str) -> Result<()> { self.0.set(k, s) }
        fn delete(&self, k: &str) -> Result<()> { self.0.delete(k) }
    }

    fn input(device: &str) -> NewAccount {
        NewAccount {
            label: "  Acc 1 ".into(),
            user_id: Some("".into()),
            device_uuid: device.into(),
            version: "7.77.0".into(),
            siua: None,
            dfpid: Some(" DFP1 ".into()),
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
        assert_eq!(acc.dfpid.as_deref(), Some("DFP1"));
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
        let mut bad_token = input("dev-4");
        bad_token.siua = Some("has space".into());
        assert!(matches!(reg.add(bad_token), Err(AccountError::Invalid(_))));
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
                siua: Some(Some("a+b/c=".into())),
                dfpid: Some(None),
                sid: Some("new-sid".into()),
            })
            .unwrap();
        assert_eq!(updated.label, "Renamed");
        assert_eq!(updated.user_id.as_deref(), Some("10"));
        assert_eq!(updated.siua.as_deref(), Some("a+b/c="));
        assert_eq!(updated.dfpid, None);
        assert_eq!(reg.with_session(acc.id).unwrap().1, "new-sid");
        assert_eq!(store.0.lock().unwrap().get(&acc.id.to_string()).unwrap(), "new-sid");

        // A failed patch must not partially apply.
        let bad = reg.update(acc.id, AccountPatch {
            label: Some("Ok".into()),
            user_id: None,
            version: Some("bad version".into()),
            siua: None,
            dfpid: None,
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

    const HX_TEMPLATE: &str = "EiIKCW9yZzEjYXBwMRIIbG92ZV8xMDAaC2Vhc2Vtb2IuY29tQANKMwgFkgEieyJ0b2tlbiI6IiIsInZpZCI6InYxIiwiY2lkIjoiYzEifaAB////////////AWAH";

    fn hx_input() -> HxInput {
        HxInput {
            host: " 127.0.0.1 ".into(),
            port: None,
            rest_base: Some("".into()),
            template_b64: Some(HX_TEMPLATE.into()),
            password: Some("hx-pw".into()),
            access_token: None,
        }
    }

    #[test]
    fn hx_settings_keep_secrets_in_keychain() {
        let dir = tempfile::tempdir().unwrap();
        let (reg, store) = registry(dir.path());
        let acc = reg.add(input("dev-1")).unwrap();
        assert!(reg.hx_material(acc.id).is_err());

        let updated = reg.set_hx(acc.id, hx_input()).unwrap();
        let cfg = updated.hx.unwrap();
        assert_eq!((cfg.host.as_str(), cfg.port, cfg.username.as_str(), cfg.auth.as_str()), ("127.0.0.1", 6717, "love_100", "password"));
        let raw = fs::read_to_string(dir.path().join(FILE_NAME)).unwrap();
        assert!(!raw.contains("hx-pw") && !raw.contains(HX_TEMPLATE));

        // Blank fields keep stored secrets; a token switches the auth source.
        let patch = HxInput { template_b64: None, password: None, access_token: Some("tok".into()), ..hx_input() };
        assert_eq!(reg.set_hx(acc.id, patch).unwrap().hx.unwrap().auth, "access_token");
        let (_, secret) = reg.hx_material(acc.id).unwrap();
        assert_eq!((secret.password.as_deref(), secret.access_token.as_deref()), (Some("hx-pw"), Some("tok")));

        reg.clear_hx(acc.id).unwrap();
        assert!(reg.list()[0].hx.is_none());
        assert!(!store.0.lock().unwrap().contains_key(&hx_key(acc.id)));
    }

    #[test]
    fn hx_settings_validation() {
        let dir = tempfile::tempdir().unwrap();
        let (reg, _) = registry(dir.path());
        let acc = reg.add(input("dev-1")).unwrap();
        let cases = [
            HxInput { template_b64: None, ..hx_input() },
            HxInput { template_b64: Some("bad!".into()), ..hx_input() },
            HxInput { password: None, ..hx_input() },
            HxInput { host: "a b".into(), ..hx_input() },
            HxInput { rest_base: Some("https://evil.com".into()), ..hx_input() },
            HxInput { port: Some(0), ..hx_input() },
        ];
        for case in cases {
            assert!(matches!(reg.set_hx(acc.id, case), Err(AccountError::Invalid(_))));
        }
        assert!(reg.list()[0].hx.is_none());

        reg.set_hx(acc.id, hx_input()).unwrap();
        reg.remove(acc.id).unwrap();
        assert!(reg.hx_material(acc.id).is_err());
    }

    #[test]
    fn session_is_cached_after_first_keychain_read() {
        let dir = tempfile::tempdir().unwrap();
        let (reg, store) = registry(dir.path());
        let acc = reg.add(input("dev-1")).unwrap();
        store.0.lock().unwrap().clear(); // keychain emptied behind our back
        assert_eq!(reg.with_session(acc.id).unwrap().1, "secret-sid");

        let (fresh, store2) = registry(dir.path()); // new run: cache empty, reads keychain
        store2.set(&acc.id.to_string(), "from-keychain").unwrap();
        assert_eq!(fresh.with_session(acc.id).unwrap().1, "from-keychain");
        fresh.remove(acc.id).unwrap();
        assert!(fresh.with_session(acc.id).is_err());
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
        fn get(&self, k: &str) -> Result<Option<String>> { self.0.get(k) }
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
        let patch = AccountPatch { label: Some("New".into()), user_id: None, version: None, siua: None, dfpid: None, sid: Some("fail".into()) };
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
