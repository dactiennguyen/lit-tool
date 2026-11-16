//! App settings, in the `settings` table of sky.db (see db.rs).
//!
//! The chat server is shared by every account and found from the Easemob app
//! key alone: the first time an account connects, Easemob's server list for
//! the key is fetched and saved, then reused (not fetched again) until the app
//! key changes or the user asks for it again. Each account builds its own login
//! frame (chat.rs), so no frame captured from a phone is needed.

use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::storage::db::{self, Db, DbError};
use crate::chat::hx::{self, ImServers};

/// Same default as `LIT_BASE_URL` in scripts/src/core/constants.ts.
pub const DEFAULT_API_BASE_URL: &str = "https://www.litatom.com";

#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Db(#[from] DbError),
}

impl From<rusqlite::Error> for SettingsError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Db(e.into())
    }
}

impl Serialize for SettingsError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, SettingsError>;

fn invalid(e: impl std::fmt::Display) -> SettingsError {
    SettingsError::Invalid(e.to_string())
}

/// The server list saved for an app key.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedServers {
    /// The app key the list was fetched for; another key needs a new list.
    pub app_key: String,
    #[serde(flatten)]
    pub servers: ImServers,
    /// When the list was fetched (ms since the epoch).
    pub fetched_at: u64,
}

/// What the window's close button does (window.rs).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OnClose {
    /// Ask each time: run in the background (tray) or quit.
    #[default]
    Ask,
    /// Hide the window; the app keeps running from the tray.
    Tray,
    /// Quit the app.
    Quit,
}

/// The stored settings, also as sent to the webview. Missing fields take their defaults.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub api_base_url: String,
    /// Easemob app key (org#app) of the chat server.
    pub im_app_key: String,
    /// Connect to the chat server right after an account logs in (on by default;
    /// turn off in Settings if a phone app sharing the account must stay signed in).
    pub auto_connect_tcp: bool,
    /// What the window's close button does.
    pub on_close: OnClose,
    /// Server list saved on first use; not part of a patch.
    pub im_servers: Option<SavedServers>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            api_base_url: DEFAULT_API_BASE_URL.to_owned(),
            im_app_key: hx::DEFAULT_APP_KEY.to_owned(),
            auto_connect_tcp: true,
            on_close: OnClose::Ask,
            im_servers: None,
        }
    }
}

impl AppSettings {
    /// The saved server list, when it belongs to the current app key (and,
    /// read back from the database, still has an endpoint).
    pub fn servers(&self) -> Option<&ImServers> {
        self.im_servers
            .as_ref()
            .filter(|s| s.app_key == self.im_app_key && !s.servers.endpoints.is_empty())
            .map(|s| &s.servers)
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub api_base_url: Option<String>,
    pub im_app_key: Option<String>,
    pub auto_connect_tcp: Option<bool>,
    pub on_close: Option<OnClose>,
}

/// Accept only an http(s) origin; normalise to `scheme://host[:port]`
/// (path, query and trailing slash are dropped), like `new URL(x).origin`.
pub fn normalize_base_url(raw: &str) -> Result<String> {
    let invalid = || SettingsError::Invalid("Server API URL phải có dạng https://ten-mien.com".into());
    let url = url::Url::parse(raw.trim()).map_err(|_| invalid())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none_or(str::is_empty) {
        return Err(invalid());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(SettingsError::Invalid("Không đặt tài khoản/mật khẩu trong URL".into()));
    }
    Ok(url.origin().ascii_serialization())
}

pub struct SettingsStore {
    db: Arc<Db>,
    current: Mutex<AppSettings>,
    /// Held while the server list is fetched, so parallel connects fetch it once.
    discovering: tokio::sync::Mutex<()>,
}

impl SettingsStore {
    pub fn open(db: Arc<Db>) -> Result<Self> {
        let current = db.read(db::load_settings)?;
        Ok(Self { db, current: Mutex::new(current), discovering: tokio::sync::Mutex::new(()) })
    }

    pub fn get(&self) -> AppSettings {
        self.current.lock().unwrap().clone()
    }

    pub fn update(&self, patch: SettingsPatch) -> Result<AppSettings> {
        // Held for the whole update, so two saves cannot overwrite each other.
        let mut current = self.current.lock().unwrap();
        let mut next = current.clone();
        if let Some(url) = patch.api_base_url {
            next.api_base_url = normalize_base_url(&url)?;
        }
        if let Some(key) = patch.im_app_key {
            next.im_app_key = hx::validate_app_key(&key).map_err(invalid)?;
        }
        if let Some(auto) = patch.auto_connect_tcp {
            next.auto_connect_tcp = auto;
        }
        if let Some(on_close) = patch.on_close {
            next.on_close = on_close;
        }
        self.db.write(|tx| db::save_settings(tx, &next))?;
        *current = next.clone();
        Ok(next)
    }

    /// Saves a fetched list for `app_key`, unless the key changed meanwhile.
    fn save_servers(&self, app_key: &str, servers: ImServers) -> Result<AppSettings> {
        let mut current = self.current.lock().unwrap();
        let mut next = current.clone();
        if next.im_app_key == app_key {
            next.im_servers = Some(SavedServers { app_key: app_key.to_owned(), servers, fetched_at: crate::storage::store::now_ms() });
            self.db.write(|tx| db::save_settings(tx, &next))?;
            *current = next.clone();
        }
        Ok(next)
    }

    /// App key and server list for connecting: the saved list, or fetched and
    /// saved once when there is none for the current key.
    pub async fn chat_server(&self) -> std::result::Result<(String, ImServers), ServerError> {
        if let Some(found) = self.saved() {
            return Ok(found);
        }
        let _one_at_a_time = self.discovering.lock().await;
        // Another caller may have fetched it while this one waited.
        if let Some(found) = self.saved() {
            return Ok(found);
        }
        let app_key = self.get().im_app_key;
        let servers = hx::discover(&app_key).await?;
        self.save_servers(&app_key, servers.clone())?;
        Ok((app_key, servers))
    }

    /// Fetches the list again now (Cài đặt), replacing the saved one.
    pub async fn refresh_servers(&self) -> std::result::Result<AppSettings, ServerError> {
        let _one_at_a_time = self.discovering.lock().await;
        let app_key = self.get().im_app_key;
        let servers = hx::discover(&app_key).await?;
        Ok(self.save_servers(&app_key, servers)?)
    }

    fn saved(&self) -> Option<(String, ImServers)> {
        let s = self.current.lock().unwrap();
        s.servers().map(|servers| (s.im_app_key.clone(), servers.clone()))
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    #[error(transparent)]
    Hx(#[from] hx::HxError),
    #[error(transparent)]
    Settings(#[from] SettingsError),
}

impl Serialize for ServerError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

#[tauri::command(async)]
pub fn settings_get(store: tauri::State<'_, SettingsStore>) -> AppSettings {
    store.get()
}

#[tauri::command(async)]
pub fn settings_update(store: tauri::State<'_, SettingsStore>, patch: SettingsPatch) -> Result<AppSettings> {
    store.update(patch)
}

/// Fetches Easemob's server list for the app key again and saves it.
#[tauri::command]
pub async fn settings_refresh_im_servers(
    store: tauri::State<'_, SettingsStore>,
) -> std::result::Result<AppSettings, ServerError> {
    store.refresh_servers().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn on_close_defaults_to_ask_and_reads_lowercase() {
        assert_eq!(AppSettings::default().on_close, OnClose::Ask);
        let s: AppSettings = serde_json::from_value(serde_json::json!({ "onClose": "tray" })).unwrap();
        assert_eq!(s.on_close, OnClose::Tray);
        // Settings saved before this field existed still load, as Ask.
        let old: AppSettings = serde_json::from_value(serde_json::json!({ "autoConnectTcp": true })).unwrap();
        assert_eq!(old.on_close, OnClose::Ask);
        assert_eq!(serde_json::to_value(OnClose::Quit).unwrap(), "quit");
    }

    fn open(dir: &std::path::Path) -> SettingsStore {
        SettingsStore::open(Arc::new(Db::open(dir, None).unwrap())).unwrap()
    }

    fn servers(host: &str) -> ImServers {
        ImServers { endpoints: vec![hx::ImEndpoint { host: host.into(), port: 80 }], rest_base: None, cluster: None }
    }

    #[test]
    fn normalizes_to_origin() {
        assert_eq!(normalize_base_url(" https://www.litatom.com/ ").unwrap(), "https://www.litatom.com");
        assert_eq!(normalize_base_url("http://127.0.0.1:8080/api?x=1").unwrap(), "http://127.0.0.1:8080");
        assert_eq!(normalize_base_url("HTTPS://Example.COM:443").unwrap(), "https://example.com");
    }

    #[test]
    fn rejects_bad_urls() {
        for bad in ["", "litatom.com", "ftp://x.com", "file:///etc/passwd", "https://user:pw@x.com", "javascript:alert(1)"] {
            assert!(normalize_base_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn defaults_then_persists() {
        let dir = tempfile::tempdir().unwrap();
        let store = open(dir.path());
        let s = store.get();
        assert_eq!((s.api_base_url.as_str(), s.im_app_key.as_str()), (DEFAULT_API_BASE_URL, hx::DEFAULT_APP_KEY));
        assert!(s.auto_connect_tcp && s.im_servers.is_none());

        let patch = SettingsPatch { api_base_url: Some("http://localhost:3000/".into()), im_app_key: Some(" org#app ".into()), ..Default::default() };
        store.update(patch).unwrap();
        assert!(store.update(SettingsPatch { api_base_url: Some("nope".into()), ..Default::default() }).is_err());
        assert!(store.update(SettingsPatch { im_app_key: Some("no-hash".into()), ..Default::default() }).is_err());
        store.update(SettingsPatch { auto_connect_tcp: Some(true), ..Default::default() }).unwrap();

        let reopened = open(dir.path()).get();
        assert_eq!((reopened.api_base_url.as_str(), reopened.im_app_key.as_str()), ("http://localhost:3000", "org#app"));
        assert!(reopened.auto_connect_tcp);
    }

    #[test]
    fn the_server_list_is_kept_per_app_key() {
        let dir = tempfile::tempdir().unwrap();
        let store = open(dir.path());
        store.save_servers(hx::DEFAULT_APP_KEY, servers("192.0.2.1")).unwrap();
        assert_eq!(store.saved().unwrap().1.endpoint().host, "192.0.2.1");
        // Saved across restarts, so it is not fetched again.
        let reopened = open(dir.path());
        assert_eq!(reopened.saved().unwrap(), (hx::DEFAULT_APP_KEY.to_owned(), servers("192.0.2.1")));

        // Another app key does not use it; a list fetched for an old key is not saved.
        reopened.update(SettingsPatch { im_app_key: Some("org#other".into()), ..Default::default() }).unwrap();
        assert!(reopened.saved().is_none());
        reopened.save_servers(hx::DEFAULT_APP_KEY, servers("192.0.2.9")).unwrap();
        assert!(reopened.saved().is_none());
        assert_eq!(reopened.get().im_servers.unwrap().servers, servers("192.0.2.1"));

        // A list without endpoints (edited or damaged) counts as none, so it is fetched again.
        let empty = ImServers { endpoints: vec![], rest_base: None, cluster: None };
        reopened.update(SettingsPatch { im_app_key: Some(hx::DEFAULT_APP_KEY.into()), ..Default::default() }).unwrap();
        reopened.save_servers(hx::DEFAULT_APP_KEY, empty).unwrap();
        assert!(reopened.saved().is_none());
    }

    #[test]
    fn partial_settings_fall_back_to_defaults() {
        let dir = tempfile::tempdir().unwrap();
        // Settings of earlier versions (imHost, imPort, …) are ignored.
        std::fs::write(dir.path().join("settings.json"), br#"{"apiBaseUrl":"https://x.com","imHost":"10.0.0.1","imPort":6717}"#).unwrap();
        let s = open(dir.path()).get();
        assert_eq!((s.api_base_url.as_str(), s.im_app_key.as_str()), ("https://x.com", hx::DEFAULT_APP_KEY));
    }
}
