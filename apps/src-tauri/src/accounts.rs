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
    /// Device tokens captured from the real device (optional request headers).
    #[serde(default)]
    pub siua: Option<String>,
    #[serde(default)]
    pub dfpid: Option<String>,
    pub created_at: u64,
    /// When the sid was last written to the credential store (ms since epoch).
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
        let account = self.list().into_iter().find(|a| a.id == id).ok_or(AccountError::NotFound)?;
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
        assert_eq!(secret(&db, &acc.id.to_string()).as_deref(), Some("new-sid"));

        let bad = AccountPatch { label: Some("".into()), user_id: None, version: None, siua: None, dfpid: None, sid: None };
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
