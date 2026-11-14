//! Self-update from the GitHub releases (tauri-plugin-updater). The installed app
//! reads `latest.json` of the latest release once when it opens, or when the
//! user asks. Every newer version is mandatory: it is downloaded at once, its
//! minisign signature checked against the public key in tauri.conf.json, then
//! installed and the app opened again; the UI covers the window meanwhile
//! (update-gate.tsx). A failed check (no network, GitHub down) blocks nothing.
//! The UI hears of each change through the "update" event.
//!
//! Only an installed app updates itself: `tauri dev` and the portable Windows
//! exe carry no bundle type.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Least time between two "update" events while downloading.
const PROGRESS: Duration = Duration::from_millis(250);
/// Longest the app waits on quit for a downloaded update to install.
const ON_QUIT: Duration = Duration::from_secs(30);

/// Where the update stands (`UpdateView` in src/lib/update.ts).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum UpdateState {
    /// This copy does not update itself, and why.
    Off { reason: String },
    /// Not checked yet.
    Idle,
    Checking,
    /// The last check found nothing newer, at `checked_at` (ms since the epoch).
    Latest { checked_at: u64 },
    Downloading { version: String, notes: String, got: u64, total: Option<u64> },
    /// Downloaded and verified; being installed.
    Ready { version: String, notes: String },
    Installing { version: String },
    Failed { message: String, checked_at: u64 },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateView {
    /// The version running.
    pub current: String,
    #[serde(flatten)]
    pub state: UpdateState,
}

#[derive(Default)]
struct Inner {
    state: Option<UpdateState>,
    /// The update downloaded and verified, with its bytes.
    ready: Option<(Update, Vec<u8>)>,
}

/// Managed state shared by the commands and the check.
#[derive(Default)]
pub struct Updates(Mutex<Inner>);

impl Updates {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

fn view<R: Runtime>(app: &AppHandle<R>) -> UpdateView {
    let state = app.state::<Updates>().lock().state.clone().unwrap_or(UpdateState::Idle);
    UpdateView { current: app.package_info().version.to_string(), state }
}

fn set<R: Runtime>(app: &AppHandle<R>, state: UpdateState) {
    app.state::<Updates>().lock().state = Some(state);
    let _ = app.emit("update", view(app));
}

/// Why this copy cannot update itself, if it cannot.
fn off_reason<R: Runtime>(app: &AppHandle<R>) -> Option<&'static str> {
    if tauri::utils::platform::bundle_type().is_none() {
        return Some("bản chạy từ mã nguồn hoặc bản portable, không phải bản cài");
    }
    match app.updater() {
        Err(tauri_plugin_updater::Error::EmptyEndpoints) => Some("bản build này không có địa chỉ cập nhật"),
        _ => None,
    }
}

/// Turns updates off for a copy that cannot update itself, else checks once in the background.
pub fn start<R: Runtime>(app: &AppHandle<R>) {
    if let Some(reason) = off_reason(app) {
        app.state::<Updates>().lock().state = Some(UpdateState::Off { reason: reason.into() });
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move { check(&app).await });
}

/// Checks for a newer version and downloads it. Does nothing while off,
/// checking, downloading, or once one is ready.
pub async fn check<R: Runtime>(app: &AppHandle<R>) {
    {
        let updates = app.state::<Updates>();
        let mut inner = updates.lock();
        match inner.state {
            None | Some(UpdateState::Idle | UpdateState::Latest { .. } | UpdateState::Failed { .. }) => {
                inner.state = Some(UpdateState::Checking)
            }
            _ => return,
        }
    }
    let _ = app.emit("update", view(app));
    let found = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(e) => Err(e),
    };
    match found {
        Ok(None) => set(app, UpdateState::Latest { checked_at: crate::store::now_ms() }),
        Ok(Some(update)) => download(app, update).await,
        Err(e) => fail(app, &e),
    }
}

async fn download<R: Runtime>(app: &AppHandle<R>, update: Update) {
    let (version, notes) = (update.version.clone(), update.body.clone().unwrap_or_default());
    let downloading =
        |got, total| UpdateState::Downloading { version: version.clone(), notes: notes.clone(), got, total };
    set(app, downloading(0, None));
    let (mut got, mut told) = (0u64, Instant::now());
    let bytes = update
        .download(
            |chunk, total| {
                got += chunk as u64;
                if told.elapsed() >= PROGRESS {
                    told = Instant::now();
                    set(app, downloading(got, total));
                }
            },
            || {},
        )
        .await;
    match bytes {
        Ok(bytes) => {
            app.state::<Updates>().lock().ready = Some((update, bytes));
            set(app, UpdateState::Ready { version, notes });
            // Mandatory: installed now. Off the async workers (macOS may ask for an
            // admin password). A failed install sets Failed, which unblocks the UI.
            let app = app.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || install_now(&app)).await;
        }
        Err(e) => fail(app, &e),
    }
}

fn fail<R: Runtime>(app: &AppHandle<R>, e: &tauri_plugin_updater::Error) {
    eprintln!("update: {e}");
    set(app, UpdateState::Failed { message: message(e), checked_at: crate::store::now_ms() });
}

/// What the UI says about an updater error.
fn message(e: &tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error as E;
    match e {
        E::ReleaseNotFound => "chưa có bản phát hành nào có latest.json".into(),
        E::Reqwest(_) | E::Network(_) => format!("không tải được từ GitHub ({e})"),
        E::Minisign(_) | E::Base64(_) | E::SignatureUtf8(_) | E::SignedVersionMismatch { .. } | E::MissingSignedVersion => {
            format!("chữ ký của bản tải về không khớp, không cài ({e})")
        }
        E::TargetNotFound(_) | E::TargetsNotFound(_) => format!("bản mới chưa có cho máy này ({e})"),
        _ => e.to_string(),
    }
}

/// Installs the downloaded update and opens the new version. On Windows the
/// installer takes over (the app exits and the installer opens it again).
fn install_now<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let Some((update, bytes)) = app.state::<Updates>().lock().ready.take() else {
        return Err("Chưa có bản cập nhật nào tải xong".into());
    };
    set(app, UpdateState::Installing { version: update.version.clone() });
    match update.install(&bytes) {
        Ok(()) => app.restart(),
        Err(e) => {
            let text = message(&e);
            set(
                app,
                UpdateState::Failed {
                    message: format!("không cài được bản {}: {text}", update.version),
                    checked_at: crate::store::now_ms(),
                },
            );
            Err(text)
        }
    }
}

/// On quit with an update still downloaded (its install did not start), installs
/// it for the next start, with a time limit: on macOS an app in a folder the
/// user cannot write asks for an admin password, which may never be answered.
pub fn install_on_quit<R: Runtime>(app: &AppHandle<R>) {
    let Some((update, bytes)) = app.state::<Updates>().lock().ready.take() else { return };
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(update.restart_after_install(false).install(&bytes));
    });
    match rx.recv_timeout(ON_QUIT) {
        Ok(Ok(())) => {}
        Ok(Err(e)) => eprintln!("update on quit: {e}"),
        Err(_) => eprintln!("update on quit: over {} s, left for next time", ON_QUIT.as_secs()),
    }
}

// ---------- tauri commands ----------

#[tauri::command]
pub fn update_status(app: AppHandle) -> UpdateView {
    view(&app)
}

/// Checks now; the "update" event tells how it went.
#[tauri::command]
pub async fn update_check(app: AppHandle) {
    check(&app).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_view_is_flat_camel_case_with_the_state_as_its_tag() {
        let view = |state| serde_json::to_value(UpdateView { current: "0.1.0".into(), state }).unwrap();
        assert_eq!(
            view(UpdateState::Downloading { version: "0.2.0".into(), notes: "Mới".into(), got: 1024, total: Some(4096) }),
            serde_json::json!({ "current": "0.1.0", "state": "downloading", "version": "0.2.0",
                "notes": "Mới", "got": 1024, "total": 4096 })
        );
        assert_eq!(
            view(UpdateState::Failed { message: "x".into(), checked_at: 5 }),
            serde_json::json!({ "current": "0.1.0", "state": "failed", "message": "x", "checkedAt": 5 })
        );
        assert_eq!(view(UpdateState::Idle), serde_json::json!({ "current": "0.1.0", "state": "idle" }));
    }
}
