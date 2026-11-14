//! Small helpers shared by the JSON-backed stores.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde::de::DeserializeOwned;

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Write atomically: temp file + fsync + rename, so a crash never leaves half a file.
pub fn write_json_atomic<T: Serialize + ?Sized>(path: &Path, value: &T) -> io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(&serde_json::to_vec_pretty(value).map_err(io::Error::other)?)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)
}

pub enum Loaded<T> {
    Ok(T),
    Missing,
    /// The file was unreadable JSON; it has been moved aside to this path.
    Recovered(PathBuf),
}

/// Read a JSON file. A corrupt file is renamed to `<name>.corrupt-<ms>` (never
/// deleted) so the app can still start and the user can recover it by hand.
pub fn read_json_or_quarantine<T: DeserializeOwned>(path: &Path) -> io::Result<Loaded<T>> {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Loaded::Missing),
        Err(e) => return Err(e),
    };
    match serde_json::from_slice(&bytes) {
        Ok(v) => Ok(Loaded::Ok(v)),
        Err(_) => {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("data.json");
            let backup = path.with_file_name(format!("{name}.corrupt-{}", now_ms()));
            fs::rename(path, &backup)?;
            Ok(Loaded::Recovered(backup))
        }
    }
}
