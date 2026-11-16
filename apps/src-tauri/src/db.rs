//! SQLite storage: `sky.db` in the app data dir, readable by the current user
//! only (mode 600 on Unix). Not encrypted.
//!
//! Tables: `accounts` (metadata, the proxy without its password), `secrets` (sid, IM passwords, proxy passwords, saved login
//! template; a NULL value means deleted or known-absent) and `settings`
//! (key -> JSON value), and `conversations` (the chat list of each account,
//! chat_store.rs). Writes that belong together go in one transaction.
//!
//! Earlier versions used `accounts.json`, `settings.json`, `secrets.json` and,
//! before that, the OS keychain. On first open the JSON files are imported and
//! renamed to `*.migrated`; a secret still missing is looked up in the keychain
//! once and the outcome recorded, so the keychain is never asked twice.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, Transaction, params};

use crate::accounts::{Account, SecretStore};
use crate::proxy::Proxy;
use crate::settings::AppSettings;
use crate::store::now_ms;

const FILE_NAME: &str = "sky.db";
const SCHEMA_VERSION: i64 = 6;

/// Version 1.
const SCHEMA: &str = "
CREATE TABLE accounts (
    id               TEXT PRIMARY KEY,
    position         INTEGER NOT NULL,
    label            TEXT NOT NULL,
    user_id          TEXT,
    device_uuid      TEXT NOT NULL UNIQUE,
    version          TEXT NOT NULL,
    siua             TEXT,
    dfpid            TEXT,
    created_at       INTEGER NOT NULL,
    session_saved_at INTEGER,
    im_username      TEXT,
    im_saved_at      INTEGER
);
CREATE TABLE secrets (
    key   TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
";

/// Version 2: each account's own Easemob client id; the shared chat server
/// settings and saved login template of version 1 are gone (the server is
/// found from the app key, settings.rs).
const MIGRATE_V2: &str = "
ALTER TABLE accounts ADD COLUMN im_client TEXT;
DELETE FROM settings WHERE key IN ('imHost', 'imPort', 'imRestBase');
INSERT OR REPLACE INTO secrets (key, value) VALUES ('global.im_template', NULL);
";

/// Version 5: the conversations each account has chatted in (chat_store.rs).
const MIGRATE_V5: &str = "
CREATE TABLE conversations (
    account_id        TEXT NOT NULL,
    conversation_id   TEXT NOT NULL,
    conversation_type INTEGER NOT NULL,
    peer_name         TEXT,
    peer_avatar       TEXT,
    last_message      TEXT,
    last_at           INTEGER,
    last_id           TEXT,
    updated_at        INTEGER NOT NULL,
    PRIMARY KEY (account_id, conversation_id)
);
";

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("Lỗi cơ sở dữ liệu: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Lỗi đọc/ghi dữ liệu: {0}")]
    Io(#[from] std::io::Error),
}

impl serde::Serialize for DbError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, DbError>;

pub struct Db {
    conn: Mutex<Connection>,
    /// The OS keychain of earlier versions, read once per missing secret.
    legacy: Option<Box<dyn SecretStore>>,
    /// Held while asking the keychain, so one key never prompts twice.
    migrating: Mutex<()>,
    /// Set when the database file was unreadable and moved aside on startup.
    recovered: Option<PathBuf>,
}

impl Db {
    pub fn open(dir: &Path, legacy: Option<Box<dyn SecretStore>>) -> Result<Self> {
        fs::create_dir_all(dir)?;
        let path = dir.join(FILE_NAME);
        let (conn, recovered) = match open_checked(&path) {
            Ok(conn) => (conn, None),
            // Not a database (or damaged): keep the file aside, never delete it.
            Err(DbError::Sqlite(e)) if is_corrupt(&e) => {
                let backup = dir.join(format!("{FILE_NAME}.corrupt-{}", now_ms()));
                fs::rename(&path, &backup)?;
                eprintln!("{FILE_NAME} was unreadable, moved to {}", backup.display());
                (open_checked(&path)?, Some(backup))
            }
            Err(e) => return Err(e),
        };
        let db = Self { conn: Mutex::new(conn), legacy, migrating: Mutex::new(()), recovered };
        db.migrate(dir)?;
        Ok(db)
    }

    pub fn recovered_backup(&self) -> Option<&Path> {
        self.recovered.as_deref()
    }

    /// Runs `f` on the connection (reads).
    pub fn read<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T> {
        Ok(f(&self.conn.lock().unwrap())?)
    }

    /// Runs `f` in a transaction: committed when it returns Ok, rolled back otherwise.
    pub fn write<T, E: From<rusqlite::Error>>(&self, f: impl FnOnce(&Transaction) -> std::result::Result<T, E>) -> std::result::Result<T, E> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let out = f(&tx)?;
        tx.commit()?;
        Ok(out)
    }

    /// A secret, or `None`. Missing keys are looked up once in the old keychain.
    pub fn secret(&self, key: &str) -> Result<Option<String>> {
        if let Some(row) = self.read(|c| stored_secret(c, key))? {
            return Ok(row);
        }
        let Some(legacy) = &self.legacy else { return Ok(None) };
        let _one_at_a_time = self.migrating.lock().unwrap();
        // Another caller may have migrated this key while this one waited.
        if let Some(row) = self.read(|c| stored_secret(c, key))? {
            return Ok(row);
        }
        // A denied or failing keychain read counts as "not there": the user re-enters it.
        let found = legacy.get(key).unwrap_or_else(|e| {
            eprintln!("old keychain not readable for {key}: {e}");
            None
        });
        self.write(|tx| put_secret(tx, key, found.as_deref()))?;
        Ok(found)
    }

    /// Creates or upgrades the schema, and imports the JSON files of earlier versions once.
    fn migrate(&self, dir: &Path) -> Result<()> {
        let version: i64 = self.read(|c| c.query_row("PRAGMA user_version", [], |r| r.get(0)))?;
        if version >= SCHEMA_VERSION {
            return Ok(());
        }
        let imported = self.write(|tx| -> Result<Vec<PathBuf>> {
            if version < 1 {
                tx.execute_batch(SCHEMA)?;
            }
            if version < 2 {
                tx.execute_batch(MIGRATE_V2)?;
            }
            if version < 3 {
                tx.execute_batch("ALTER TABLE accounts ADD COLUMN device TEXT;")?;
            }
            if version < 4 {
                tx.execute_batch("ALTER TABLE accounts ADD COLUMN device_enabled INTEGER NOT NULL DEFAULT 0;")?;
            }
            if version < 5 {
                tx.execute_batch(MIGRATE_V5)?;
            }
            if version < 6 {
                // The account's proxy (proxy.rs) without its password, which is the secret `<id>.proxy`.
                tx.execute_batch("ALTER TABLE accounts ADD COLUMN proxy TEXT;")?;
            }
            // Into the current schema: the JSON files predate the database.
            let imported = if version < 1 { import_json_files(tx, dir)? } else { Vec::new() };
            tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
            Ok(imported)
        })?;
        for path in imported {
            let done = path.with_extension("json.migrated");
            if let Err(e) = fs::rename(&path, &done) {
                eprintln!("imported {} but could not rename it: {e}", path.display());
            }
        }
        Ok(())
    }
}

fn open_checked(path: &Path) -> Result<Connection> {
    create_private(path)?;
    let conn = Connection::open(path)?;
    // Fails on a file that is not a SQLite database.
    conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(conn)
}

/// Creates an empty file with mode 600 so SQLite never creates it world-readable.
fn create_private(path: &Path) -> std::io::Result<()> {
    if path.exists() {
        return Ok(());
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(path).map(drop)
}

fn is_corrupt(e: &rusqlite::Error) -> bool {
    matches!(
        e.sqlite_error_code(),
        Some(rusqlite::ErrorCode::NotADatabase | rusqlite::ErrorCode::DatabaseCorrupt)
    )
}

// ---------- secrets ----------

/// `Some(row)` when the key has a row (a NULL value = deleted or known-absent).
fn stored_secret(c: &Connection, key: &str) -> rusqlite::Result<Option<Option<String>>> {
    c.query_row("SELECT value FROM secrets WHERE key = ?1", [key], |r| r.get(0)).optional()
}

/// Sets a secret; `None` records it as deleted.
pub fn put_secret(c: &Connection, key: &str, value: Option<&str>) -> rusqlite::Result<()> {
    c.execute("INSERT OR REPLACE INTO secrets (key, value) VALUES (?1, ?2)", params![key, value]).map(drop)
}

// ---------- accounts ----------

const ACCOUNT_COLUMNS: &str =
    "id, label, user_id, device_uuid, version, siua, dfpid, created_at, session_saved_at, im_username, im_saved_at, im_client, device, device_enabled";

fn account_from_row(r: &rusqlite::Row) -> rusqlite::Result<Account> {
    let id: String = r.get(0)?;
    let id = uuid::Uuid::parse_str(&id)
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?;
    let im = match (r.get::<_, Option<String>>(9)?, r.get::<_, Option<i64>>(10)?) {
        (Some(username), Some(saved_at)) => Some(crate::accounts::ImIdentity { username, saved_at: saved_at as u64 }),
        _ => None,
    };
    // An unreadable client id is made again on the next connect.
    let im_client = r.get::<_, Option<String>>(11)?.and_then(|v| uuid::Uuid::parse_str(&v).ok());
    Ok(Account {
        id,
        label: r.get(1)?,
        user_id: r.get(2)?,
        device_uuid: r.get(3)?,
        version: r.get(4)?,
        siua: r.get(5)?,
        dfpid: r.get(6)?,
        created_at: r.get::<_, i64>(7)? as u64,
        session_saved_at: r.get::<_, Option<i64>>(8)?.map(|v| v as u64),
        im,
        im_client,
        proxy: None,
        device_enabled: r.get(13)?,
        device: r.get::<_, Option<String>>(12)?.map(|v| serde_json::from_str(&v)
            .map_err(|e| rusqlite::Error::FromSqlConversionFailure(12, rusqlite::types::Type::Text, Box::new(e)))).transpose()?,
    })
}

/// Every account, in the order they were added.
pub fn load_accounts(c: &Connection) -> rusqlite::Result<Vec<Account>> {
    let mut stmt = c.prepare(&format!("SELECT {ACCOUNT_COLUMNS} FROM accounts ORDER BY position"))?;
    stmt.query_map([], account_from_row)?.collect()
}

/// Inserts a new account after the existing ones.
pub fn insert_account(c: &Connection, a: &Account) -> rusqlite::Result<()> {
    c.execute(
        &format!(
            "INSERT INTO accounts (position, {ACCOUNT_COLUMNS})
             VALUES ((SELECT COALESCE(MAX(position), -1) + 1 FROM accounts), ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)"
        ),
        account_params(a),
    )
    .map(drop)
}

/// Overwrites an existing account's fields (not its position).
pub fn update_account(c: &Connection, a: &Account) -> rusqlite::Result<()> {
    let changed = c.execute(
        "UPDATE accounts SET label = ?2, user_id = ?3, device_uuid = ?4, version = ?5, siua = ?6, dfpid = ?7,
         created_at = ?8, session_saved_at = ?9, im_username = ?10, im_saved_at = ?11, im_client = ?12, device = ?13, device_enabled = ?14 WHERE id = ?1",
        account_params(a),
    )?;
    if changed == 1 { Ok(()) } else { Err(rusqlite::Error::QueryReturnedNoRows) }
}

/// Deletes an account and its saved conversations.
pub fn delete_account(c: &Connection, id: uuid::Uuid) -> rusqlite::Result<bool> {
    c.execute("DELETE FROM conversations WHERE account_id = ?1", [id.to_string()])?;
    Ok(c.execute("DELETE FROM accounts WHERE id = ?1", [id.to_string()])? == 1)
}

/// Key of an account's proxy password in `secrets`.
pub fn proxy_key(id: uuid::Uuid) -> String {
    format!("{id}.proxy")
}

/// Every saved proxy (on or off) with its password, by account.
pub fn load_proxies(c: &Connection) -> rusqlite::Result<HashMap<uuid::Uuid, Proxy>> {
    let mut stmt = c.prepare(
        "SELECT a.id, a.proxy, s.value FROM accounts a
         LEFT JOIN secrets s ON s.key = a.id || '.proxy'
         WHERE a.proxy IS NOT NULL",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?)))?;
    let mut proxies = HashMap::new();
    for row in rows {
        let (id, json, password) = row?;
        // A row we wrote ourselves; an unreadable one only loses its proxy.
        let (Ok(id), Ok(mut proxy)) = (uuid::Uuid::parse_str(&id), serde_json::from_str::<Proxy>(&json)) else { continue };
        proxy.password = password.unwrap_or_default();
        proxies.insert(id, proxy);
    }
    Ok(proxies)
}

/// Saves (or, with None, removes) an account's proxy: the password apart, as a secret.
pub fn put_proxy(c: &Connection, id: uuid::Uuid, proxy: Option<&Proxy>) -> rusqlite::Result<()> {
    let json = proxy.map(|p| serde_json::to_string(&Proxy { password: String::new(), ..p.clone() }).expect("a proxy serializes"));
    let changed = c.execute("UPDATE accounts SET proxy = ?2 WHERE id = ?1", params![id.to_string(), json])?;
    if changed != 1 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    let password = proxy.map(|p| p.password.as_str()).filter(|p| !p.is_empty());
    put_secret(c, &proxy_key(id), password)
}

fn account_params(a: &Account) -> impl rusqlite::Params + '_ {
    (
        a.id.to_string(),
        &a.label,
        &a.user_id,
        &a.device_uuid,
        &a.version,
        &a.siua,
        &a.dfpid,
        a.created_at as i64,
        a.session_saved_at.map(|v| v as i64),
        a.im.as_ref().map(|im| im.username.as_str()),
        a.im.as_ref().map(|im| im.saved_at as i64),
        a.im_client.map(|c| c.to_string()),
        a.device.as_ref().map(|d| serde_json::to_string(d).expect("device JSON is serializable")),
        a.device_enabled,
    )
}

// ---------- settings ----------

/// The stored settings; missing or unreadable values take their defaults.
pub fn load_settings(c: &Connection) -> rusqlite::Result<AppSettings> {
    let mut stmt = c.prepare("SELECT key, value FROM settings")?;
    let mut map = serde_json::Map::new();
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (key, value) = row?;
        if let Ok(v) = serde_json::from_str(&value) {
            map.insert(key, v);
        }
    }
    Ok(serde_json::from_value(serde_json::Value::Object(map)).unwrap_or_default())
}

/// One row per field (camelCase key, JSON value).
pub fn save_settings(c: &Connection, settings: &AppSettings) -> rusqlite::Result<()> {
    let serde_json::Value::Object(map) = serde_json::to_value(settings).expect("settings serialize") else {
        unreachable!("AppSettings is a struct")
    };
    for (key, value) in map {
        c.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)", params![key, value.to_string()])?;
    }
    Ok(())
}

// ---------- import of earlier versions ----------

/// Imports `accounts.json`, `settings.json` and `secrets.json` when present and
/// readable; returns the files imported. An unreadable file is left alone.
fn import_json_files(tx: &Transaction, dir: &Path) -> Result<Vec<PathBuf>> {
    fn read<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
        let bytes = fs::read(path).ok()?;
        serde_json::from_slice(&bytes)
            .map_err(|e| eprintln!("{} not imported (unreadable: {e}); left in place", path.display()))
            .ok()
    }
    let mut imported = Vec::new();

    let path = dir.join("accounts.json");
    if let Some(accounts) = read::<Vec<Account>>(&path) {
        for a in &accounts {
            insert_account(tx, a)?;
        }
        imported.push(path);
    }
    let path = dir.join("settings.json");
    if let Some(settings) = read::<AppSettings>(&path) {
        save_settings(tx, &settings)?;
        imported.push(path);
    }
    let path = dir.join("secrets.json");
    if let Some(secrets) = read::<BTreeMap<String, Option<String>>>(&path) {
        for (key, value) in &secrets {
            put_secret(tx, key, value.as_deref())?;
        }
        imported.push(path);
    }
    Ok(imported)
}

#[cfg(test)]
pub(crate) fn open_temp(dir: &Path) -> std::sync::Arc<Db> {
    std::sync::Arc::new(Db::open(dir, None).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::MemoryStore;
    use std::sync::Arc;

    #[test]
    fn creates_a_private_database() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path(), None).unwrap();
        assert!(db.read(load_accounts).unwrap().is_empty());
        assert_eq!(db.read(load_settings).unwrap(), AppSettings::default());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(dir.path().join(FILE_NAME)).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        // Reopening keeps the schema (no second import).
        drop(db);
        Db::open(dir.path(), None).unwrap();
    }

    #[test]
    fn version_2_migrates_without_losing_existing_accounts() {
        let dir = tempfile::tempdir().unwrap();
        {
            let c = Connection::open(dir.path().join(FILE_NAME)).unwrap();
            c.execute_batch(SCHEMA).unwrap();
            c.execute_batch(MIGRATE_V2).unwrap();
            c.execute_batch("INSERT INTO accounts (id, position, label, device_uuid, version, created_at)
                VALUES ('7f1f7c56-1b1e-4c55-9d37-0a4f1c2e9b10', 0, 'Existing', 'old-device', '7.77.0', 5);
                PRAGMA user_version = 2;").unwrap();
        }
        let db = Db::open(dir.path(), None).unwrap();
        let accounts = db.read(load_accounts).unwrap();
        assert_eq!(accounts[0].label, "Existing");
        assert!(accounts[0].device.is_none());
        assert_eq!(db.read(|c| c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))).unwrap(), SCHEMA_VERSION);
    }

    #[test]
    fn version_3_defaults_device_to_disabled_and_preserves_saved_data() {
        let dir = tempfile::tempdir().unwrap();
        let saved = serde_json::json!({
            "deviceUuid":"old-device", "dfpId":"old-token", "exp":1, "ver":"0.0.2",
            "version":"7.77.0", "fields":{"model":"Pixel 7"}
        }).to_string();
        {
            let c = Connection::open(dir.path().join(FILE_NAME)).unwrap();
            c.execute_batch(SCHEMA).unwrap();
            c.execute_batch(MIGRATE_V2).unwrap();
            c.execute_batch("ALTER TABLE accounts ADD COLUMN device TEXT; PRAGMA user_version = 3;").unwrap();
            c.execute("INSERT INTO accounts (id, position, label, device_uuid, version, dfpid, created_at, device)
                VALUES (?1, 0, 'Existing', 'old-device', '7.77.0', 'old-token', 5, ?2)",
                params![uuid::Uuid::new_v4().to_string(), saved]).unwrap();
        }
        let db = Db::open(dir.path(), None).unwrap();
        let account = db.read(load_accounts).unwrap().remove(0);
        assert!(!account.device_enabled);
        assert_eq!(account.dfpid.as_deref(), Some("old-token"));
        assert_eq!(serde_json::to_value(account.device.unwrap()).unwrap(), serde_json::from_str::<serde_json::Value>(&saved).unwrap());
    }

    #[test]
    fn imports_the_json_files_of_earlier_versions_once() {
        let dir = tempfile::tempdir().unwrap();
        let accounts = r#"[{"id":"7f1f7c56-1b1e-4c55-9d37-0a4f1c2e9b10","label":"A","userId":"10","deviceUuid":"d1",
            "version":"1","createdAt":5,"sessionSavedAt":6,"im":{"username":"love_1","savedAt":7}},
            {"id":"8f1f7c56-1b1e-4c55-9d37-0a4f1c2e9b10","label":"B","userId":null,"deviceUuid":"d2",
            "version":"2","createdAt":8,"sessionSavedAt":null,"hx":{"host":"h"}}]"#;
        fs::write(dir.path().join("accounts.json"), accounts).unwrap();
        fs::write(dir.path().join("settings.json"), r#"{"apiBaseUrl":"https://x.com","autoConnectTcp":true}"#).unwrap();
        fs::write(dir.path().join("secrets.json"), r#"{"sid-key":"s1","gone":null}"#).unwrap();

        let db = Db::open(dir.path(), None).unwrap();
        let list = db.read(load_accounts).unwrap();
        assert_eq!(list.iter().map(|a| a.label.as_str()).collect::<Vec<_>>(), ["A", "B"]);
        assert_eq!(list[0].im.as_ref().unwrap().username, "love_1");
        assert_eq!((list[0].created_at, list[0].session_saved_at, list[1].im.is_none()), (5, Some(6), true));
        let settings = db.read(load_settings).unwrap();
        assert_eq!((settings.api_base_url.as_str(), settings.auto_connect_tcp), ("https://x.com", true));
        assert_eq!(db.secret("sid-key").unwrap().as_deref(), Some("s1"));
        assert_eq!(db.secret("gone").unwrap(), None);

        for name in ["accounts", "settings", "secrets"] {
            assert!(!dir.path().join(format!("{name}.json")).exists());
            assert!(dir.path().join(format!("{name}.json.migrated")).exists());
        }
        drop(db);
        // A JSON file appearing later is not imported again.
        fs::write(dir.path().join("accounts.json"), "[]").unwrap();
        assert_eq!(Db::open(dir.path(), None).unwrap().read(load_accounts).unwrap().len(), 2);
    }

    #[test]
    fn a_version_1_database_is_upgraded() {
        let dir = tempfile::tempdir().unwrap();
        {
            let c = Connection::open(dir.path().join(FILE_NAME)).unwrap();
            c.execute_batch(SCHEMA).unwrap();
            c.execute_batch(
                "INSERT INTO accounts (id, position, label, device_uuid, version, created_at)
                   VALUES ('7f1f7c56-1b1e-4c55-9d37-0a4f1c2e9b10', 0, 'A', 'd1', '1', 5);
                 INSERT INTO settings VALUES ('imHost', '\"10.0.0.1\"'), ('autoConnectTcp', 'true');
                 INSERT INTO secrets VALUES ('global.im_template', 'T');
                 PRAGMA user_version = 1;",
            )
            .unwrap();
        }
        let db = Db::open(dir.path(), None).unwrap();
        let mut a = db.read(load_accounts).unwrap().remove(0);
        assert_eq!((a.label.as_str(), a.im_client), ("A", None));
        assert!(db.read(load_settings).unwrap().auto_connect_tcp);
        let old: i64 = db.read(|c| c.query_row("SELECT COUNT(*) FROM settings WHERE key = 'imHost'", [], |r| r.get(0))).unwrap();
        assert_eq!(old, 0);
        assert_eq!(db.secret("global.im_template").unwrap(), None);

        a.im_client = Some(uuid::Uuid::new_v4());
        db.write(|tx| update_account(tx, &a)).unwrap();
        assert_eq!(db.read(load_accounts).unwrap()[0].im_client, a.im_client);
    }

    #[test]
    fn unreadable_json_is_left_in_place() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("accounts.json"), "{oops").unwrap();
        let db = Db::open(dir.path(), None).unwrap();
        assert!(db.read(load_accounts).unwrap().is_empty());
        assert!(dir.path().join("accounts.json").exists());
    }

    #[test]
    fn corrupt_database_is_moved_aside() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(FILE_NAME), b"definitely not sqlite, just some bytes padding it out").unwrap();
        let db = Db::open(dir.path(), None).unwrap();
        let backup = db.recovered_backup().expect("backup").to_owned();
        assert!(fs::read(&backup).unwrap().starts_with(b"definitely"));
        assert!(db.read(load_accounts).unwrap().is_empty());
    }

    #[test]
    fn secrets_come_from_the_old_keychain_once_per_key() {
        let dir = tempfile::tempdir().unwrap();
        let keychain = Arc::new(MemoryStore::default());
        keychain.set("sid", "old-sid").unwrap();
        keychain.set("tpl", "old-template").unwrap();
        let db = Db::open(dir.path(), Some(Box::new(keychain.clone()))).unwrap();

        assert_eq!(db.secret("sid").unwrap().as_deref(), Some("old-sid"));
        assert_eq!(db.secret("missing").unwrap(), None);
        keychain.set("sid", "changed").unwrap();
        keychain.set("missing", "late").unwrap();
        assert_eq!(db.secret("sid").unwrap().as_deref(), Some("old-sid"));
        assert_eq!(db.secret("missing").unwrap(), None);

        // A deleted secret does not come back from the keychain.
        db.write(|tx| put_secret(tx, "tpl", None)).unwrap();
        assert_eq!(db.secret("tpl").unwrap(), None);
    }

    #[test]
    fn a_failed_transaction_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path(), None).unwrap();
        let result: rusqlite::Result<()> = db.write(|tx| {
            put_secret(tx, "k", Some("v"))?;
            Err(rusqlite::Error::QueryReturnedNoRows)
        });
        assert!(result.is_err());
        assert_eq!(db.secret("k").unwrap(), None);
    }
}
