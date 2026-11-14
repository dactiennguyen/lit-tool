//! Secrets (sid, IM passwords, login template) in `secrets.json` in the app data
//! dir, readable by the current user only (mode 600 on Unix). Not encrypted:
//! anyone who can read that file as this user can read the secrets.
//!
//! Earlier versions kept them in the OS keychain. A key missing from the file
//! is looked up there once and copied over; the outcome (value or "not there")
//! is recorded, so the keychain is never asked again for that key and deleted
//! secrets cannot come back from it.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::accounts::{Result, SecretStore};
use crate::store::{self, Loaded};

const FILE_NAME: &str = "secrets.json";

/// `None` = deleted, or checked in the old keychain and not found.
type Entries = BTreeMap<String, Option<String>>;

pub struct FileSecretStore {
    path: PathBuf,
    entries: Mutex<Entries>,
    /// Where secrets were kept before this file existed.
    legacy: Option<Box<dyn SecretStore>>,
    /// Held while asking the old keychain, so one key never prompts twice.
    migrating: Mutex<()>,
}

impl FileSecretStore {
    pub fn open(dir: &Path, legacy: Option<Box<dyn SecretStore>>) -> Result<Self> {
        std::fs::create_dir_all(dir)?;
        let path = dir.join(FILE_NAME);
        let entries = match store::read_json_or_quarantine(&path)? {
            Loaded::Ok(entries) => entries,
            Loaded::Missing => Entries::new(),
            Loaded::Recovered(backup) => {
                eprintln!("{FILE_NAME} was corrupt, moved to {}", backup.display());
                Entries::new()
            }
        };
        Ok(Self { path, entries: Mutex::new(entries), legacy, migrating: Mutex::new(()) })
    }

    fn save(&self, entries: &Entries) -> Result<()> {
        Ok(store::write_private_json_atomic(&self.path, entries)?)
    }

    /// Writes `entries` with `key` set; memory changes only once the file is written.
    fn put(&self, key: &str, value: Option<String>) -> Result<()> {
        let mut entries = self.entries.lock().unwrap();
        let mut next = entries.clone();
        next.insert(key.to_owned(), value);
        self.save(&next)?;
        *entries = next;
        Ok(())
    }
}

impl SecretStore for FileSecretStore {
    fn get(&self, key: &str) -> Result<Option<String>> {
        if let Some(v) = self.entries.lock().unwrap().get(key) {
            return Ok(v.clone());
        }
        let Some(legacy) = &self.legacy else { return Ok(None) };
        let _one_at_a_time = self.migrating.lock().unwrap();
        // Another caller may have migrated this key while this one waited.
        if let Some(v) = self.entries.lock().unwrap().get(key) {
            return Ok(v.clone());
        }
        // A denied or failing keychain read counts as "not there": the user re-enters it.
        let found = legacy.get(key).unwrap_or_else(|e| {
            eprintln!("old keychain not readable for {key}: {e}");
            None
        });
        self.put(key, found.clone())?;
        Ok(found)
    }

    fn set(&self, key: &str, secret: &str) -> Result<()> {
        self.put(key, Some(secret.to_owned()))
    }

    fn delete(&self, key: &str) -> Result<()> {
        self.put(key, None)
    }
}

/// One store shared by the account registry and the settings.
impl<T: SecretStore + ?Sized> SecretStore for std::sync::Arc<T> {
    fn get(&self, key: &str) -> Result<Option<String>> {
        (**self).get(key)
    }
    fn set(&self, key: &str, secret: &str) -> Result<()> {
        (**self).set(key, secret)
    }
    fn delete(&self, key: &str) -> Result<()> {
        (**self).delete(key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::MemoryStore;
    use std::sync::Arc;

    #[test]
    fn stores_in_a_private_file() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileSecretStore::open(dir.path(), None).unwrap();
        assert_eq!(store.get("a").unwrap(), None);
        store.set("a", "sid-1").unwrap();
        store.set("b", "pw").unwrap();
        store.delete("b").unwrap();

        let reopened = FileSecretStore::open(dir.path(), None).unwrap();
        assert_eq!(reopened.get("a").unwrap().as_deref(), Some("sid-1"));
        assert_eq!(reopened.get("b").unwrap(), None);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.path().join(FILE_NAME)).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn copies_from_the_old_keychain_once_per_key() {
        let dir = tempfile::tempdir().unwrap();
        let keychain = Arc::new(MemoryStore::default());
        keychain.set("sid", "old-sid").unwrap();
        keychain.set("tpl", "old-template").unwrap();
        let store = FileSecretStore::open(dir.path(), Some(Box::new(keychain.clone()))).unwrap();

        assert_eq!(store.get("sid").unwrap().as_deref(), Some("old-sid"));
        assert_eq!(store.get("missing").unwrap(), None);
        // Later keychain changes are not consulted again: the file is the source now.
        keychain.set("sid", "changed").unwrap();
        keychain.set("missing", "late").unwrap();
        assert_eq!(store.get("sid").unwrap().as_deref(), Some("old-sid"));
        assert_eq!(store.get("missing").unwrap(), None);

        // A deleted secret does not come back from the keychain.
        store.delete("tpl").unwrap();
        assert_eq!(store.get("tpl").unwrap(), None);

        // Survives a restart without the keychain.
        let reopened = FileSecretStore::open(dir.path(), None).unwrap();
        assert_eq!(reopened.get("sid").unwrap().as_deref(), Some("old-sid"));
    }
}
