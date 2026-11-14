//! App settings stored as `settings.json` in the app data dir.
//!
//! The IM (chat) server is shared by every account: host, port and REST base
//! are plain settings, while the login template is kept with the secrets (secrets.json).
//! Each account's own IM username replaces the one inside the template.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::accounts::SecretStore;
use crate::hx;
use crate::store::{self, Loaded};

const FILE_NAME: &str = "settings.json";
/// Same default as `LIT_BASE_URL` in scripts/src/core/constants.ts.
pub const DEFAULT_API_BASE_URL: &str = "https://www.litatom.com";
pub const DEFAULT_IM_HOST: &str = "128.1.26.67";
const TEMPLATE_KEY: &str = "global.im_template";
/// Login frame captured from the real app (token left empty), used until
/// another template is saved. Each account's IM username replaces the one inside.
pub const DEFAULT_IM_TEMPLATE: &str = "CAASQAoUMTEwMjE5MDIyMzIyMjgyNCNsaXQSE2xvdmUxNDc5MTE2MTA0MjYzODEaC2Vhc2Vtb2IuY29tIgZtb2JpbGVAA0rzAQgBEgU0LjUuNCgASiRkNTVmYWNiOS1kZDdhLTQzOTctOTQ5Mi01MWVkMGIzMDgzYWRQAGIOR29vZ2xlUGl4ZWwgNmFqLGFuZHJvaWRfZDU1ZmFjYjktZGQ3YS00Mzk3LTk0OTItNTFlZDBiMzA4M2Fkeg9jb20ubGl0YXRvbS5hcHCCASRhNGE0OTMxMi0zNmE5LTRmNTUtYjg4ZC0zZDQ5NmY4ZjhjZTCKAQR2My4wkgEmeyJ2aWQiOjg1NjE0MiwiY2lkIjo2MjE5NTYsInRva2VuIjoiIn2iARcyNDAzOTM2NjEyOC4xLjI2LjY3NjcxN1gA";

#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("{0}")]
    Invalid(String),
    #[error("Lỗi đọc/ghi cài đặt: {0}")]
    Io(#[from] std::io::Error),
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

/// What `settings.json` holds. Missing fields take their defaults.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub api_base_url: String,
    pub im_host: String,
    pub im_port: u16,
    pub im_rest_base: String,
    /// Connect to the chat server right after an account logs in.
    pub auto_connect_tcp: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            api_base_url: DEFAULT_API_BASE_URL.to_owned(),
            im_host: DEFAULT_IM_HOST.to_owned(),
            im_port: hx::DEFAULT_IM_PORT,
            im_rest_base: hx::DEFAULT_REST_BASE.to_owned(),
            auto_connect_tcp: false,
        }
    }
}

/// Shown about the saved template; the template itself never leaves the backend.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInfo {
    pub app_key: String,
    /// The account the template was captured from (replaced per account at login).
    pub username: String,
    /// True while no template of the user's own is saved (the built-in one is used).
    pub is_default: bool,
}

/// Settings as sent to the webview.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    #[serde(flatten)]
    pub settings: AppSettings,
    pub im_template: Option<TemplateInfo>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub api_base_url: Option<String>,
    pub im_host: Option<String>,
    pub im_port: Option<u16>,
    pub im_rest_base: Option<String>,
    pub auto_connect_tcp: Option<bool>,
    /// Blank keeps the saved template.
    pub im_template_b64: Option<String>,
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
    path: PathBuf,
    current: Mutex<AppSettings>,
    secrets: Box<dyn SecretStore>,
    /// The template read from (or written to) the secret store this run; `None` = not read yet.
    template: Mutex<Option<Option<String>>>,
}

impl SettingsStore {
    pub fn open(dir: &Path, secrets: Box<dyn SecretStore>) -> Result<Self> {
        fs::create_dir_all(dir)?;
        let path = dir.join(FILE_NAME);
        // A corrupt settings file is moved aside and defaults are used.
        let current = match store::read_json_or_quarantine(&path)? {
            Loaded::Ok(settings) => settings,
            Loaded::Missing => AppSettings::default(),
            Loaded::Recovered(backup) => {
                eprintln!("settings.json was corrupt, moved to {}", backup.display());
                AppSettings::default()
            }
        };
        Ok(Self { path, current: Mutex::new(current), secrets, template: Mutex::new(None) })
    }

    pub fn get(&self) -> AppSettings {
        self.current.lock().unwrap().clone()
    }

    /// The saved template, if any. Reads the secret store.
    fn saved_template(&self) -> Result<Option<String>> {
        let mut cached = self.template.lock().unwrap();
        if let Some(t) = cached.as_ref() {
            return Ok(t.clone());
        }
        let t = self.secrets.get(TEMPLATE_KEY).map_err(invalid)?;
        *cached = Some(t.clone());
        Ok(t)
    }

    /// The shared login template (base64), for the backend only: the saved one,
    /// or the built-in default. Reads the secret store.
    pub fn im_template(&self) -> Result<String> {
        Ok(self.saved_template()?.unwrap_or_else(|| DEFAULT_IM_TEMPLATE.to_owned()))
    }

    pub fn view(&self) -> Result<SettingsView> {
        let saved = self.saved_template()?;
        let is_default = saved.is_none();
        // An unreadable saved template shows as missing, so it can be replaced.
        let im_template = hx::parse_template(saved.as_deref().unwrap_or(DEFAULT_IM_TEMPLATE))
            .ok()
            .map(|t| TemplateInfo { app_key: t.app_key, username: t.username, is_default });
        Ok(SettingsView { settings: self.get(), im_template })
    }

    pub fn update(&self, patch: SettingsPatch) -> Result<SettingsView> {
        // Held for the whole update, so two saves cannot overwrite each other.
        let mut current = self.current.lock().unwrap();
        let mut next = current.clone();
        if let Some(url) = patch.api_base_url {
            next.api_base_url = normalize_base_url(&url)?;
        }
        if let Some(host) = patch.im_host {
            next.im_host = hx::validate_host(&host).map_err(invalid)?;
        }
        if let Some(port) = patch.im_port {
            if port == 0 {
                return Err(SettingsError::Invalid("Port không hợp lệ".into()));
            }
            next.im_port = port;
        }
        if let Some(rest) = patch.im_rest_base {
            next.im_rest_base = hx::easemob_origin(&rest).map_err(invalid)?;
        }
        if let Some(auto) = patch.auto_connect_tcp {
            next.auto_connect_tcp = auto;
        }
        let template = patch.im_template_b64.map(|t| t.trim().to_owned()).filter(|t| !t.is_empty());
        if let Some(t) = &template {
            hx::parse_template(t).map_err(invalid)?;
        }

        // Secret first, then settings.json: a failed secret write changes nothing.
        if let Some(t) = template {
            self.secrets.set(TEMPLATE_KEY, &t).map_err(invalid)?;
            *self.template.lock().unwrap() = Some(Some(t));
        }
        store::write_json_atomic(&self.path, &next)?;
        *current = next;
        drop(current);
        self.view()
    }

    /// Back to the built-in default template.
    pub fn clear_im_template(&self) -> Result<SettingsView> {
        self.secrets.delete(TEMPLATE_KEY).map_err(invalid)?;
        *self.template.lock().unwrap() = Some(None);
        self.view()
    }
}

#[tauri::command(async)]
pub fn settings_get(store: tauri::State<'_, SettingsStore>) -> Result<SettingsView> {
    store.view()
}

#[tauri::command(async)]
pub fn settings_update(store: tauri::State<'_, SettingsStore>, patch: SettingsPatch) -> Result<SettingsView> {
    store.update(patch)
}

#[tauri::command(async)]
pub fn settings_clear_im_template(store: tauri::State<'_, SettingsStore>) -> Result<SettingsView> {
    store.clear_im_template()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::MemoryStore;

    const TEMPLATE: &str = "EiIKCW9yZzEjYXBwMRIIbG92ZV8xMDAaC2Vhc2Vtb2IuY29tQANKMwgFkgEieyJ0b2tlbiI6IiIsInZpZCI6InYxIiwiY2lkIjoiYzEifaAB////////////AWAH";

    fn open(dir: &Path) -> SettingsStore {
        SettingsStore::open(dir, Box::new(MemoryStore::default())).unwrap()
    }

    #[test]
    fn default_template_is_valid() {
        let t = hx::parse_template(DEFAULT_IM_TEMPLATE).unwrap();
        assert_eq!((t.app_key.as_str(), t.username.as_str()), ("1102190223222824#lit", "love147911610426381"));
        let other = hx::with_username(&t, "love_200").unwrap();
        hx::build_login_frame(&other, "tok").unwrap();
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
        assert_eq!((s.api_base_url.as_str(), s.im_host.as_str(), s.im_port), (DEFAULT_API_BASE_URL, DEFAULT_IM_HOST, 6717));

        let patch = SettingsPatch { api_base_url: Some("http://localhost:3000/".into()), im_host: Some(" 10.0.0.1 ".into()), ..Default::default() };
        store.update(patch).unwrap();
        assert!(store.update(SettingsPatch { api_base_url: Some("nope".into()), ..Default::default() }).is_err());
        assert!(store.update(SettingsPatch { im_port: Some(0), ..Default::default() }).is_err());
        assert!(store.update(SettingsPatch { im_rest_base: Some("https://evil.com".into()), ..Default::default() }).is_err());

        assert!(!store.get().auto_connect_tcp);
        store.update(SettingsPatch { auto_connect_tcp: Some(true), ..Default::default() }).unwrap();

        let reopened = open(dir.path());
        assert_eq!((reopened.get().api_base_url.as_str(), reopened.get().im_host.as_str()), ("http://localhost:3000", "10.0.0.1"));
        assert!(reopened.get().auto_connect_tcp);
    }

    #[test]
    fn template_lives_in_the_secret_store_and_only_its_identity_is_shown() {
        let dir = tempfile::tempdir().unwrap();
        let store = open(dir.path());
        // Built-in default until one is saved.
        let default = store.view().unwrap().im_template.unwrap();
        assert!(default.is_default);
        assert_eq!(default.app_key, "1102190223222824#lit");
        assert_eq!(store.im_template().unwrap(), DEFAULT_IM_TEMPLATE);
        assert!(store.update(SettingsPatch { im_template_b64: Some("bad!".into()), ..Default::default() }).is_err());

        let view = store.update(SettingsPatch { im_template_b64: Some(format!(" {TEMPLATE} ")), ..Default::default() }).unwrap();
        assert_eq!(view.im_template, Some(TemplateInfo { app_key: "org1#app1".into(), username: "love_100".into(), is_default: false }));
        assert_eq!(store.im_template().unwrap(), TEMPLATE);
        let json = serde_json::to_string(&view).unwrap();
        assert!(!json.contains(TEMPLATE), "{json}");
        assert!(!fs::read_to_string(dir.path().join(FILE_NAME)).unwrap().contains(TEMPLATE));

        // Blank keeps it; clearing goes back to the default.
        store.update(SettingsPatch { im_template_b64: Some(" ".into()), ..Default::default() }).unwrap();
        assert_eq!(store.im_template().unwrap(), TEMPLATE);
        assert!(store.clear_im_template().unwrap().im_template.unwrap().is_default);
        assert_eq!(store.im_template().unwrap(), DEFAULT_IM_TEMPLATE);
    }

    #[test]
    fn corrupt_or_partial_file_falls_back_to_defaults() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(FILE_NAME), b"{oops").unwrap();
        assert_eq!(open(dir.path()).get(), AppSettings::default());
        fs::write(dir.path().join(FILE_NAME), br#"{"apiBaseUrl":"https://x.com"}"#).unwrap();
        let s = open(dir.path()).get();
        assert_eq!((s.api_base_url.as_str(), s.im_host.as_str()), ("https://x.com", DEFAULT_IM_HOST));
    }
}
