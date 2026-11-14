//! App settings stored as `settings.json` in the app data dir.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::store::{self, Loaded};

const FILE_NAME: &str = "settings.json";
/// Same default as `LIT_BASE_URL` in scripts/src/core/constants.ts.
pub const DEFAULT_API_BASE_URL: &str = "https://www.litatom.com";

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub api_base_url: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self { api_base_url: DEFAULT_API_BASE_URL.to_owned() }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub api_base_url: Option<String>,
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
}

impl SettingsStore {
    pub fn open(dir: &Path) -> Result<Self> {
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
        Ok(Self { path, current: Mutex::new(current) })
    }

    pub fn get(&self) -> AppSettings {
        self.current.lock().unwrap().clone()
    }

    pub fn update(&self, patch: SettingsPatch) -> Result<AppSettings> {
        let mut current = self.current.lock().unwrap();
        let mut next = current.clone();
        if let Some(url) = patch.api_base_url {
            next.api_base_url = normalize_base_url(&url)?;
        }
        self.persist(&next)?;
        *current = next.clone();
        Ok(next)
    }

    fn persist(&self, settings: &AppSettings) -> Result<()> {
        Ok(store::write_json_atomic(&self.path, settings)?)
    }
}

#[tauri::command]
pub fn settings_get(store: tauri::State<'_, SettingsStore>) -> AppSettings {
    store.get()
}

#[tauri::command(async)]
pub fn settings_update(store: tauri::State<'_, SettingsStore>, patch: SettingsPatch) -> Result<AppSettings> {
    store.update(patch)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let store = SettingsStore::open(dir.path()).unwrap();
        assert_eq!(store.get().api_base_url, DEFAULT_API_BASE_URL);

        store.update(SettingsPatch { api_base_url: Some("http://localhost:3000/".into()) }).unwrap();
        assert!(store.update(SettingsPatch { api_base_url: Some("nope".into()) }).is_err());

        let reopened = SettingsStore::open(dir.path()).unwrap();
        assert_eq!(reopened.get().api_base_url, "http://localhost:3000");
    }

    #[test]
    fn corrupt_file_falls_back_to_default() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(FILE_NAME), b"{oops").unwrap();
        assert_eq!(SettingsStore::open(dir.path()).unwrap().get(), AppSettings::default());
    }

    #[test]
    fn missing_field_falls_back_to_default() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(FILE_NAME), b"{}").unwrap();
        assert_eq!(SettingsStore::open(dir.path()).unwrap().get(), AppSettings::default());
    }
}
