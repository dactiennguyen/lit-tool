//! Account registry for Sky Manager.
//!
//! Accounts live in the `accounts` table of sky.db (see db.rs). The session
//! token (`sid`) is in the `secrets` table and is never sent back to the webview. So is the IM password (hxPwd), which is
//! taken from the account's own profile when it logs in.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Deserializer, Serialize};
use uuid::Uuid;

use crate::db::{self, Db, DbError, put_secret};
use crate::store::now_ms;

const KEYRING_SERVICE: &str = "sky-manager.session";

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
    #[error(transparent)]
    Db(#[from] DbError),
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
    /// Legacy saved token, retained for storage compatibility; requests generate fresh SIUA.
    #[serde(default)]
    pub siua: Option<String>,
    /// Server-issued device token, sent as X-DFPID when present.
    #[serde(default)]
    pub dfpid: Option<String>,
    #[serde(default)]
    pub device: Option<crate::dfpid::DeviceSetup>,
    #[serde(default)]
    pub device_enabled: bool,
    pub created_at: u64,
    /// Session/device revision time (ms since epoch), invalidates the UI login state.
    pub session_saved_at: Option<u64>,
    /// IM (Hyphenate) identity from the last login; the password lives in the secret store.
    /// (Older files have a per-account `hx` object instead; it is ignored.)
    #[serde(default)]
    pub im: Option<ImIdentity>,
    /// This account's own Easemob client id (login frame resource), made on its
    /// first chat connection and kept. Not sent to the webview.
    #[serde(skip)]
    pub im_client: Option<Uuid>,
}

impl Account {
    pub fn active_device(&self) -> Option<&crate::dfpid::DeviceSetup> {
        self.device.as_ref().filter(|_| self.device_enabled)
    }

    pub fn request_uuid(&self) -> &str {
        &self.device_uuid
    }

    pub fn request_dfpid(&self) -> Option<&str> {
        if self.device_enabled { self.dfpid.as_deref() } else { None }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImIdentity {
    /// `huanxin.user_id` from `user/get_info/me`.
    pub username: String,
    /// When the credentials were last saved (ms since epoch).
    pub saved_at: u64,
}

fn im_key(id: Uuid) -> String {
    format!("{id}.im")
}

/// Key of the per-account IM settings of earlier versions, only deleted now.
fn legacy_hx_key(id: Uuid) -> String {
    format!("{id}.hx")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAccount {
    pub label: String,
    pub user_id: Option<String>,
    #[serde(default)]
    pub device_uuid: String,
    pub version: String,
    #[serde(default)]
    pub siua: Option<String>,
    #[serde(default)]
    pub dfpid: Option<String>,
    #[serde(default)]
    pub device: Option<crate::dfpid::DeviceSetup>,
    #[serde(default)]
    pub device_enabled: bool,
    pub sid: String,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountPatch {
    pub device_enabled: Option<bool>,
    pub device_uuid: Option<String>,
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
    pub device: Option<crate::dfpid::DeviceSetup>,
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

/// Read access to where secrets were kept before sky.db: the OS keychain,
/// read once per key to migrate (see db.rs).
pub trait SecretStore: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<String>>;
}

impl From<rusqlite::Error> for AccountError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Db(e.into())
    }
}

impl<T: SecretStore + ?Sized> SecretStore for Arc<T> {
    fn get(&self, key: &str) -> Result<Option<String>> {
        (**self).get(key)
    }
}

/// The OS keychain, where earlier versions kept secrets. Only read now, to
/// migrate entries into sky.db (see db.rs).
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
}

/// In-memory store used by tests.
#[cfg(test)]
#[derive(Default)]
pub struct MemoryStore(pub Mutex<HashMap<String, String>>);

#[cfg(test)]
impl MemoryStore {
    pub fn set(&self, key: &str, secret: &str) -> Result<()> {
        self.0.lock().unwrap().insert(key.to_owned(), secret.to_owned());
        Ok(())
    }
}

#[cfg(test)]
impl SecretStore for MemoryStore {
    fn get(&self, key: &str) -> Result<Option<String>> {
        Ok(self.0.lock().unwrap().get(key).cloned())
    }
}

// ---------- registry ----------

pub struct AccountRegistry {
    db: Arc<Db>,
    /// Same rows as the `accounts` table, kept in memory for `list()`.
    accounts: Mutex<Vec<Account>>,
    /// sids already read (or written) this run, so each API call doesn't query again.
    sessions: Mutex<HashMap<Uuid, String>>,
    /// Same for IM passwords.
    im_passwords: Mutex<HashMap<Uuid, String>>,
}

fn sid_key(id: Uuid) -> String {
    id.to_string()
}

impl AccountRegistry {
    pub fn open(db: Arc<Db>) -> Result<Self> {
        let accounts = db.read(db::load_accounts)?;
        Ok(Self { db, accounts: Mutex::new(accounts), sessions: Mutex::default(), im_passwords: Mutex::default() })
    }

    /// Where an unreadable database was moved on startup, if that happened.
    pub fn recovered_backup(&self) -> Option<String> {
        self.db.recovered_backup().map(|p| p.display().to_string())
    }

    pub fn list(&self) -> Vec<Account> {
        self.accounts.lock().unwrap().clone()
    }

    pub async fn add_prepared<F, Fut>(&self, mut input: NewAccount, generate: F) -> Result<Account>
    where
        F: FnOnce(String, String, Option<String>) -> Fut,
        Fut: std::future::Future<Output = std::result::Result<crate::dfpid::DeviceSetup, String>>,
    {
        input.label = clean_label(&input.label)?;
        input.user_id = clean_user_id(input.user_id)?;
        input.version = clean_version(&input.version)?;
        input.sid = clean_sid(&input.sid)?;
        let existing_uuid = if input.device_uuid.trim().is_empty() {
            None
        } else {
            Some(clean_device_uuid(&input.device_uuid)?)
        };
        if input.device_enabled && input.device.is_none() {
            input.device = Some(generate(input.version.clone(), input.sid.clone(), existing_uuid).await.map_err(AccountError::Invalid)?);
        }
        if let Some(device) = &input.device {
            if input.device_uuid.trim().is_empty() && input.device_enabled {
                input.device_uuid = device.device_uuid.clone();
            }
            input.dfpid = Some(device.dfp_id.clone());
        }
        self.add(input)
    }

    pub fn save_refreshed_device(&self, expected: &Account, sid: &str, device: crate::dfpid::DeviceSetup) -> Result<bool> {
        device.validate(true).map_err(AccountError::Invalid)?;
        if device.device_uuid != expected.request_uuid() || device.version != expected.version
            || expected.device.as_ref().is_none_or(|old| old.fields != device.fields) {
            return Err(AccountError::Invalid("Làm mới DFPID không được đổi thông tin thiết bị".into()));
        }
        let mut accounts = self.accounts.lock().unwrap();
        let Some(index) = accounts.iter().position(|a| a.id == expected.id) else { return Ok(false); };
        let current = &accounts[index];
        if !current.device_enabled || current.device_enabled != expected.device_enabled
            || current.device != expected.device || current.version != expected.version
            || current.device_uuid != expected.device_uuid || current.session_saved_at != expected.session_saved_at
            || self.sessions.lock().unwrap().get(&expected.id).is_none_or(|s| s != sid) {
            return Ok(false);
        }
        let mut account = current.clone();
        account.dfpid = Some(device.dfp_id.clone());
        account.device = Some(device);
        self.db.write(|tx| db::update_account(tx, &account))?;
        accounts[index] = account;
        Ok(true)
    }

    pub fn add(&self, input: NewAccount) -> Result<Account> {
        let label = clean_label(&input.label)?;
        let user_id = clean_user_id(input.user_id)?;
        let device_uuid = clean_device_uuid(&input.device_uuid)?;
        let version = clean_version(&input.version)?;
        let siua = clean_device_token(input.siua, "SIUA")?;
        let dfpid = clean_device_token(input.dfpid, "DFPID")?;
        let sid = clean_sid(&input.sid)?;
        if let Some(device) = &input.device {
            device.validate(true).map_err(AccountError::Invalid)?;
            if (input.device_enabled && (device.version != version || device.device_uuid != device_uuid)) || Some(&device.dfp_id) != dfpid.as_ref() {
                return Err(AccountError::Invalid("UUID, version và DFPID phải khớp JSON thiết bị".into()));
            }
        }

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
            device: input.device,
            device_enabled: input.device_enabled,
            created_at: now,
            session_saved_at: Some(now),
            im: None,
            im_client: None,
        };
        // Account and sid together, or neither.
        self.db.write(|tx| -> Result<()> {
            db::insert_account(tx, &account)?;
            put_secret(tx, &sid_key(account.id), Some(&sid))?;
            Ok(())
        })?;
        accounts.push(account.clone());
        self.sessions.lock().unwrap().insert(account.id, sid);
        Ok(account)
    }

    pub fn update(&self, id: Uuid, patch: AccountPatch) -> Result<Account> {
        let mut accounts = self.accounts.lock().unwrap();
        let index = accounts.iter().position(|a| a.id == id).ok_or(AccountError::NotFound)?;
        let mut account = accounts[index].clone();
        let version_changed = patch.version.is_some();
        let token_changed = patch.dfpid.is_some();
        if let Some(enabled) = patch.device_enabled {
            account.device_enabled = enabled;
        }
        if let Some(uuid) = patch.device_uuid {
            account.device_uuid = clean_device_uuid(&uuid)?;
        }

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
        if let Some(device) = patch.device {
            device.validate(true).map_err(AccountError::Invalid)?;
            if device.device_uuid != account.device_uuid
                || (version_changed && account.version != device.version)
                || (token_changed && account.dfpid.as_ref() != Some(&device.dfp_id)) {
                return Err(AccountError::Invalid("UUID, version và DFPID phải khớp JSON thiết bị".into()));
            }
            account.dfpid = Some(device.dfp_id.clone());
            account.version = clean_version(&device.version)?;
            account.device = Some(device);
        }
        if accounts.iter().any(|a| a.id != id && a.device_uuid == account.device_uuid) {
            return Err(AccountError::Duplicate);
        }
        if let Some(device) = &account.device {
            if (account.device_enabled && (device.version != account.version || device.device_uuid != account.device_uuid)) || Some(&device.dfp_id) != account.dfpid.as_ref() {
                return Err(AccountError::Invalid("Hãy làm mới DFPID để JSON khớp UUID và version của account".into()));
            }
        }
        let sid = patch.sid.as_deref().map(clean_sid).transpose()?;
        if sid.is_some() || account.device_uuid != accounts[index].device_uuid
            || account.device_enabled != accounts[index].device_enabled {
            account.session_saved_at = Some(now_ms().max(accounts[index].session_saved_at.unwrap_or(0).saturating_add(1)));
        }

        self.db.write(|tx| -> Result<()> {
            db::update_account(tx, &account)?;
            if let Some(sid) = &sid {
                put_secret(tx, &sid_key(id), Some(sid))?;
            }
            Ok(())
        })?;
        accounts[index] = account.clone();
        if let Some(sid) = sid {
            self.sessions.lock().unwrap().insert(id, sid);
        }
        Ok(account)
    }

    /// Account plus its sid, for signing requests inside the backend only.
    pub fn with_session(&self, id: Uuid) -> Result<(Account, String)> {
        let accounts = self.accounts.lock().unwrap();
        let account = accounts.iter().find(|a| a.id == id).cloned().ok_or(AccountError::NotFound)?;
        if let Some(sid) = self.sessions.lock().unwrap().get(&id) {
            return Ok((account, sid.clone()));
        }
        // Touches the disk (and once the old keychain): callers run this off the async runtime.
        let sid = self
            .db
            .secret(&sid_key(id))?
            .ok_or_else(|| AccountError::Invalid("Account chưa có session đã lưu, hãy nhập lại sid".into()))?;
        self.sessions.lock().unwrap().insert(id, sid.clone());
        Ok((account, sid))
    }

    /// Stores the IM credentials found in the account's profile. Nothing is
    /// written when they are unchanged; returns the account when they changed.
    pub fn save_im_credentials(&self, id: Uuid, username: &str, password: &str) -> Result<Option<Account>> {
        if !is_token(username, 128, &[]) {
            return Err(AccountError::Invalid("IM username trong hồ sơ không hợp lệ".into()));
        }
        if password.is_empty() || password.len() > 4096 || password.chars().any(char::is_control) {
            return Err(AccountError::Invalid("Mật khẩu chat trong hồ sơ không hợp lệ".into()));
        }
        let current = self.list().into_iter().find(|a| a.id == id).ok_or(AccountError::NotFound)?;
        let same_user = current.im.as_ref().is_some_and(|im| im.username == username);
        if same_user && self.im_password(id).ok().as_deref() == Some(password) {
            return Ok(None);
        }

        let mut accounts = self.accounts.lock().unwrap();
        let index = accounts.iter().position(|a| a.id == id).ok_or(AccountError::NotFound)?;
        let mut account = accounts[index].clone();
        account.im = Some(ImIdentity { username: username.to_owned(), saved_at: now_ms() });
        self.db.write(|tx| -> Result<()> {
            db::update_account(tx, &account)?;
            put_secret(tx, &im_key(id), Some(password))?;
            // Per-account IM settings of earlier versions are superseded.
            put_secret(tx, &legacy_hx_key(id), None)?;
            Ok(())
        })?;
        accounts[index] = account.clone();
        self.im_passwords.lock().unwrap().insert(id, password.to_owned());
        Ok(Some(account))
    }

    fn im_password(&self, id: Uuid) -> Result<String> {
        if let Some(pw) = self.im_passwords.lock().unwrap().get(&id) {
            return Ok(pw.clone());
        }
        let missing = || AccountError::Invalid("Chưa có mật khẩu chat, hãy đăng nhập lại account".into());
        let pw = self.db.secret(&im_key(id))?.ok_or_else(missing)?;
        self.im_passwords.lock().unwrap().insert(id, pw.clone());
        Ok(pw)
    }

    /// IM username and password, for the backend only.
    pub fn im_material(&self, id: Uuid) -> Result<(String, String)> {
        let account = self.list().into_iter().find(|a| a.id == id).ok_or(AccountError::NotFound)?;
        let im = account
            .im
            .ok_or_else(|| AccountError::Invalid("Chưa có thông tin chat: hãy đăng nhập account để lấy".into()))?;
        Ok((im.username, self.im_password(id)?))
    }

    /// The account's Easemob client id; made and saved on first use.
    pub fn im_client(&self, id: Uuid) -> Result<Uuid> {
        let mut accounts = self.accounts.lock().unwrap();
        let index = accounts.iter().position(|a| a.id == id).ok_or(AccountError::NotFound)?;
        if let Some(client) = accounts[index].im_client {
            return Ok(client);
        }
        let mut account = accounts[index].clone();
        let client = Uuid::new_v4();
        account.im_client = Some(client);
        self.db.write(|tx| db::update_account(tx, &account))?;
        accounts[index] = account;
        Ok(client)
    }

    /// Removes the account and its secrets in one transaction.
    pub fn remove(&self, id: Uuid) -> Result<()> {
        let mut accounts = self.accounts.lock().unwrap();
        self.db.write(|tx| -> Result<()> {
            if !db::delete_account(tx, id)? {
                return Err(AccountError::NotFound);
            }
            for key in [sid_key(id), im_key(id), legacy_hx_key(id)] {
                put_secret(tx, &key, None)?;
            }
            Ok(())
        })?;
        accounts.retain(|a| a.id != id);
        self.sessions.lock().unwrap().remove(&id);
        self.im_passwords.lock().unwrap().remove(&id);
        Ok(())
    }
}

// ---------- tauri commands ----------

type State<'a> = tauri::State<'a, AccountRegistry>;

#[tauri::command(async)]
pub fn accounts_list(registry: State<'_>) -> Vec<Account> {
    registry.list()
}

#[tauri::command]
pub async fn accounts_add(registry: State<'_>, input: NewAccount) -> Result<Account> {
    registry.add_prepared(input, |version, sid, uuid| async move {
        crate::dfpid::generate_new(version, &sid, uuid.as_deref()).await
    }).await
}

#[tauri::command(async)]
pub fn accounts_update(app: tauri::AppHandle, registry: State<'_>, id: Uuid, patch: AccountPatch) -> Result<Account> {
    let before = registry.list().into_iter().find(|a| a.id == id).ok_or(AccountError::NotFound)?;
    let account = registry.update(id, patch)?;
    if before.session_saved_at != account.session_saved_at { crate::listen::stop(&app, id); }
    Ok(account)
}

#[tauri::command]
pub fn accounts_recovered_backup(registry: State<'_>) -> Option<String> {
    registry.recovered_backup()
}

#[tauri::command(async)]
pub fn accounts_remove(app: tauri::AppHandle, registry: State<'_>, id: Uuid) -> Result<()> {
    registry.remove(id)?;
    crate::listen::stop(&app, id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(device: &str) -> NewAccount {
        NewAccount {
            label: "  Acc 1 ".into(),
            user_id: Some("".into()),
            device_uuid: device.into(),
            version: "7.77.0".into(),
            siua: None,
            dfpid: Some(" DFP1 ".into()),
            device: None,
            device_enabled: false,
            sid: "secret-sid".into(),
        }
    }

    fn registry(dir: &std::path::Path) -> (AccountRegistry, Arc<Db>) {
        let db = db::open_temp(dir);
        (AccountRegistry::open(db.clone()).unwrap(), db)
    }

    fn secret(db: &Db, key: &str) -> Option<String> {
        db.secret(key).unwrap()
    }

    #[tokio::test]
    async fn default_add_never_generates_a_device_and_keeps_the_session_uuid() {
        let dir = tempfile::tempdir().unwrap();
        let (reg, _) = registry(dir.path());
        let input = serde_json::from_value(serde_json::json!({
            "label":"Default", "deviceUuid":"original-uuid", "version":"7.77.0", "sid":"original-sid"
        })).unwrap();
        let account = reg.add_prepared(input, |_, _, _| async { panic!("disabled must not call Eye") }).await.unwrap();
        assert!(!account.device_enabled);
        assert!(account.device.is_none());
        assert_eq!(account.request_uuid(), "original-uuid");
        assert!(account.request_dfpid().is_none());
        let (fresh, _) = registry(dir.path());
        assert_eq!(fresh.list(), vec![account]);
    }

    #[test]
    fn toggle_preserves_saved_device_and_restores_session_identity() {
        let dir = tempfile::tempdir().unwrap();
        let (reg, _) = registry(dir.path());
        let account = reg.add(input("original-uuid")).unwrap();
        let patch = |value| serde_json::from_value::<AccountPatch>(value).unwrap();
        let active = reg.update(account.id, patch(serde_json::json!({
            "deviceEnabled":true, "device":{
                "deviceUuid":"original-uuid", "dfpId":"generated-token", "exp":now_ms()+60_000,
                "version":"7.77.0", "ver":"0.0.2", "fields":{
                    "model":"Pixel 7", "cpu_abi":"arm64-v8a", "android_id_secure":"original-uuid"
                }
            }
        }))).unwrap();
        assert_eq!(active.device_uuid, "original-uuid");
        assert_eq!(active.request_uuid(), "original-uuid");
        assert!(active.session_saved_at > account.session_saved_at);
        let disabled = reg.update(account.id, patch(serde_json::json!({"deviceEnabled":false}))).unwrap();
        assert_eq!(disabled.request_uuid(), "original-uuid");
        assert_eq!(disabled.request_dfpid(), None);
        assert_eq!(disabled.device, active.device);
        assert_eq!(disabled.dfpid, active.dfpid);
        assert!(disabled.session_saved_at > active.session_saved_at);
        assert_eq!(registry(dir.path()).0.list(), vec![disabled.clone()]);
        let restored = reg.update(account.id, patch(serde_json::json!({"deviceEnabled":true}))).unwrap();
        assert_eq!(restored.request_uuid(), "original-uuid");
        assert_eq!(restored.device, active.device);
        let corrected = reg.update(account.id, patch(serde_json::json!({
            "deviceEnabled":false, "deviceUuid":"correct-session-uuid", "sid":"new-sid", "version":"7.78.0"
        }))).unwrap();
        assert_eq!(corrected.request_uuid(), "correct-session-uuid");
        assert_eq!(corrected.device, active.device);
        assert_eq!(reg.with_session(account.id).unwrap().1, "new-sid");
        assert!(reg.update(account.id, patch(serde_json::json!({"deviceEnabled":true}))).is_err());
    }

    #[tokio::test]
    async fn add_with_existing_uuid_passes_it_to_generator_and_rejects_a_different_device() {
        let dir = tempfile::tempdir().unwrap();
        let (reg, _) = registry(dir.path());
        let mut new = input("existing-uuid");
        new.device_enabled = true;
        let account = reg.add_prepared(new, |version, _, uuid| async move {
            assert_eq!(uuid.as_deref(), Some("existing-uuid"));
            Ok(serde_json::from_value(serde_json::json!({
                "deviceUuid":uuid,"dfpId":"token","exp":now_ms()+60_000,"ver":"0.0.2","version":version,
                "fields":{"android_id_secure":"existing-uuid","model":"Pixel 7","cpu_abi":"arm64-v8a"}
            })).unwrap())
        }).await.unwrap();
        assert_eq!(account.request_uuid(), "existing-uuid");
        assert_eq!(account.device.as_ref().unwrap().device_uuid, "existing-uuid");
        let mut wrong = input("another-uuid");
        wrong.device_enabled = true;
        let device = account.device.clone().unwrap();
        assert!(reg.add_prepared(wrong, |_, _, _| async { Ok(device) }).await.is_err());
        assert_eq!(reg.list().len(), 1);
        assert_eq!(registry(dir.path()).0.list(), vec![account]);
    }

    #[tokio::test]
    async fn automatic_add_generates_once_and_never_saves_half_an_account() {
        let dir = tempfile::tempdir().unwrap();
        let (reg, _) = registry(dir.path());
        let mut new = input("");
        new.dfpid = None;
        new.device_enabled = true;
        let account = reg.add_prepared(new, |version, sid, uuid| async move {
            assert_eq!(sid, "secret-sid");
            assert!(uuid.is_none());
            Ok(serde_json::from_value(serde_json::json!({
                "deviceUuid":"automatic-device", "dfpId":"automatic-token", "exp":now_ms()+60_000,
                "version":version, "ver":"0.0.2", "fields":{
                    "android_id_secure":"automatic-device","model":"Pixel 7","cpu_abi":"arm64-v8a"
                }
            })).unwrap())
        }).await.unwrap();
        assert_eq!(account.device_uuid, "automatic-device");
        assert_eq!(account.dfpid.as_deref(), Some("automatic-token"));
        assert_eq!(reg.with_session(account.id).unwrap().1, "secret-sid");
        let (reopened, _) = registry(dir.path());
        assert_eq!(reopened.list(), vec![account]);
        let mut failed = input("");
        failed.device_enabled = true;
        assert!(reg.add_prepared(failed, |_, _, _| async { Err("Eye unavailable".into()) }).await.is_err());
        assert_eq!(reg.list().len(), 1);
        let mut bad = input("");
        bad.sid = "".into();
        assert!(reg.add_prepared(bad, |_, _, _| async { panic!("invalid form must not call Eye") }).await.is_err());
    }

    #[test]
    fn device_payload_and_token_persist_together_and_rotation_is_atomic() {
        let dir = tempfile::tempdir().unwrap();
        let (reg, db) = registry(dir.path());
        let device: crate::dfpid::DeviceSetup = serde_json::from_value(serde_json::json!({
            "deviceUuid":"device-a", "dfpId":"token-a", "exp":now_ms()+60_000, "ver":"0.0.2", "version":"7.77.0",
            "fields":{"android_id_secure":"device-a","model":"Pixel 7","cpu_abi":"arm64-v8a"}
        })).unwrap();
        let mut new = input("device-a");
        new.dfpid = Some(device.dfp_id.clone());
        new.device = Some(device.clone());
        new.device_enabled = true;
        let first = reg.add(new).unwrap();
        let second = reg.add(input("device-b")).unwrap();
        drop((reg, db));
        let (reg, _) = registry(dir.path());
        assert_eq!(reg.list()[0].device.as_ref(), Some(&device));
        let mut rotated = device.clone();
        rotated.device_uuid = "device-b".into();
        rotated.fields.insert("android_id_secure".into(), "device-b".into());
        let patch = |d: &crate::dfpid::DeviceSetup| serde_json::from_value::<AccountPatch>(serde_json::json!({"device":d})).unwrap();
        assert!(matches!(reg.update(first.id, patch(&rotated)), Err(AccountError::Invalid(_))));
        assert_eq!(reg.list()[0], first);
        reg.remove(second.id).unwrap();
        assert!(reg.update(first.id, patch(&rotated)).is_err());
        rotated.device_uuid = "device-a".into();
        rotated.fields.insert("android_id_secure".into(), "device-a".into());
        rotated.fields.insert("model".into(), "Pixel 8 Pro".into());
        rotated.dfp_id = "rotated-token".into();
        let updated = reg.update(first.id, patch(&rotated)).unwrap();
        assert_eq!(updated.device_uuid, "device-a");
        assert_eq!(updated.request_uuid(), "device-a");
        assert_eq!(updated.device.as_ref(), Some(&rotated));
        let bad: AccountPatch = serde_json::from_value(serde_json::json!({"dfpid":"mismatched-token"})).unwrap();
        assert!(reg.update(first.id, bad).is_err());
        let conflict: AccountPatch = serde_json::from_value(serde_json::json!({"device":rotated,"version":"99"})).unwrap();
        assert!(reg.update(first.id, conflict).is_err());
        assert_eq!(reg.list()[0], updated);
        let (fresh, _) = registry(dir.path());
        assert_eq!(fresh.list()[0], updated);
    }

    #[test]
    fn add_persists_the_account_and_its_sid_together() {
        let dir = tempfile::tempdir().unwrap();
        let (reg, db) = registry(dir.path());
        let acc = reg.add(input("dev-1")).unwrap();
        assert_eq!(acc.label, "Acc 1");
        assert_eq!(acc.dfpid.as_deref(), Some("DFP1"));
        assert_eq!(acc.user_id, None);
        assert_eq!(secret(&db, &acc.id.to_string()).as_deref(), Some("secret-sid"));
        drop((reg, db));

        let (reopened, _) = registry(dir.path());
        assert_eq!(reopened.list(), vec![acc.clone()]);
        assert_eq!(reopened.with_session(acc.id).unwrap().1, "secret-sid");
    }

    #[test]
    fn keeps_the_order_accounts_were_added() {
        let dir = tempfile::tempdir().unwrap();
        let (reg, _db) = registry(dir.path());
        let ids: Vec<_> = ["d1", "d2", "d3"].map(|d| reg.add(input(d)).unwrap().id).into();
        reg.remove(ids[1]).unwrap();
        let d4 = reg.add(input("d4")).unwrap().id;
        let (reopened, _) = registry(dir.path());
        assert_eq!(reopened.list().iter().map(|a| a.id).collect::<Vec<_>>(), [ids[0], ids[2], d4]);
    }

    #[test]
    fn rejects_duplicate_device_and_bad_fields() {
        let dir = tempfile::tempdir().unwrap();
        let (reg, _db) = registry(dir.path());
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
    }

    #[test]
    fn update_and_remove() {
        let dir = tempfile::tempdir().unwrap();
        let (reg, db) = registry(dir.path());
        let acc = reg.add(input("dev-1")).unwrap();
        let updated = reg
            .update(acc.id, AccountPatch {
                device_enabled: None,
                device_uuid: None,
                label: Some("Renamed".into()),
                user_id: Some(Some("10".into())),
                version: None,
                siua: Some(Some("a+b/c=".into())),
                dfpid: Some(None),
                device: None,
                sid: Some("new-sid".into()),
            })
            .unwrap();
        assert_eq!(updated.label, "Renamed");
        assert_eq!(updated.user_id.as_deref(), Some("10"));
        assert_eq!(updated.siua.as_deref(), Some("a+b/c="));
        assert_eq!(updated.dfpid, None);
        assert_eq!(reg.with_session(acc.id).unwrap().1, "new-sid");
        assert_eq!(secret(&db, &acc.id.to_string()).as_deref(), Some("new-sid"));

        let bad = AccountPatch { device_enabled: None, device_uuid: None, label: Some("".into()), user_id: None, version: None, siua: None, dfpid: None, sid: None, device: None };
        assert!(reg.update(acc.id, bad).is_err());
        assert_eq!(reg.list()[0].label, "Renamed");

        reg.remove(acc.id).unwrap();
        assert!(reg.list().is_empty());
        assert_eq!(secret(&db, &acc.id.to_string()), None);
        assert!(matches!(reg.remove(acc.id), Err(AccountError::NotFound)));
        let (reopened, _) = registry(dir.path());
        assert!(reopened.list().is_empty());
    }

    #[test]
    fn im_credentials_from_the_profile_are_stored_with_the_account() {
        let dir = tempfile::tempdir().unwrap();
        let (reg, db) = registry(dir.path());
        let acc = reg.add(input("dev-1")).unwrap();
        assert!(reg.im_material(acc.id).is_err());
        db.write(|tx| put_secret(tx, &legacy_hx_key(acc.id), Some("{old settings}"))).unwrap();

        let saved = reg.save_im_credentials(acc.id, "love_100", "hx-pw").unwrap().expect("first save");
        assert_eq!(saved.im.unwrap().username, "love_100");
        assert_eq!(reg.im_material(acc.id).unwrap(), ("love_100".into(), "hx-pw".into()));
        assert_eq!(secret(&db, &legacy_hx_key(acc.id)), None, "old settings cleaned up");

        // Same credentials again: nothing written. A new password is.
        assert!(reg.save_im_credentials(acc.id, "love_100", "hx-pw").unwrap().is_none());
        assert!(reg.save_im_credentials(acc.id, "love_100", "hx-pw2").unwrap().is_some());
        drop((reg, db));

        let (fresh, db) = registry(dir.path());
        assert_eq!(fresh.im_material(acc.id).unwrap(), ("love_100".into(), "hx-pw2".into()));
        for (user, pw) in [("bad name", "pw"), ("love_1", ""), ("love_1", "a\nb")] {
            assert!(fresh.save_im_credentials(acc.id, user, pw).is_err());
        }
        fresh.remove(acc.id).unwrap();
        assert_eq!(secret(&db, &im_key(acc.id)), None);
    }

    #[test]
    fn each_account_keeps_its_own_im_client_id() {
        let dir = tempfile::tempdir().unwrap();
        let (reg, db) = registry(dir.path());
        let (a, b) = (reg.add(input("dev-1")).unwrap(), reg.add(input("dev-2")).unwrap());
        let client = reg.im_client(a.id).unwrap();
        assert_eq!(reg.im_client(a.id).unwrap(), client);
        assert_ne!(reg.im_client(b.id).unwrap(), client);
        // Saved, and never sent to the webview.
        assert_eq!(AccountRegistry::open(db).unwrap().im_client(a.id).unwrap(), client);
        let json = serde_json::to_string(&reg.list()).unwrap();
        assert!(!json.contains(&client.to_string()), "{json}");
        assert!(reg.im_client(Uuid::new_v4()).is_err());
    }

    #[test]
    fn session_is_cached_after_first_read() {
        let dir = tempfile::tempdir().unwrap();
        let (reg, db) = registry(dir.path());
        let acc = reg.add(input("dev-1")).unwrap();
        db.write(|tx| put_secret(tx, &acc.id.to_string(), Some("changed behind our back"))).unwrap();
        assert_eq!(reg.with_session(acc.id).unwrap().1, "secret-sid");

        let (fresh, _) = registry(dir.path()); // new run: cache empty, reads the database
        assert_eq!(fresh.with_session(acc.id).unwrap().1, "changed behind our back");
    }

    #[test]
    fn patch_distinguishes_null_from_missing_user_id() {
        let clear: AccountPatch = serde_json::from_str(r#"{"userId":null}"#).unwrap();
        assert_eq!(clear.user_id, Some(None));
        let keep: AccountPatch = serde_json::from_str("{}").unwrap();
        assert_eq!(keep.user_id, None);

        let dir = tempfile::tempdir().unwrap();
        let (reg, _db) = registry(dir.path());
        let mut with_id = input("dev-1");
        with_id.user_id = Some("10".into());
        let acc = reg.add(with_id).unwrap();
        assert_eq!(reg.update(acc.id, keep).unwrap().user_id.as_deref(), Some("10"));
        assert_eq!(reg.update(acc.id, clear).unwrap().user_id, None);
    }
}
