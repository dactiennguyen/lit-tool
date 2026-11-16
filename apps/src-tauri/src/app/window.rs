//! The tray icon and what the window's close button does (Settings::on_close).
//!
//! Closing the window can hide it instead of quitting: the app keeps running
//! from the tray (live chat listeners, device refresh, update checks), and the
//! tray icon or the Dock brings the window back. "Thoát" quits as before.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Window, WindowEvent};

use crate::storage::settings::{OnClose, SettingsError, SettingsPatch, SettingsStore};

/// Label of the window in tauri.conf.json.
const MAIN: &str = "main";
/// Sent to the webview when the close button is pressed and the setting is Ask.
pub const CLOSE_ASKED: &str = "close-asked";

/// Whether the tray icon exists. Without one (e.g. Linux without an
/// appindicator library) a hidden window could not be brought back, so
/// "run in the background" minimizes it instead.
pub struct Tray(pub bool);

/// Creates the tray icon; a failure is logged and never stops the app from starting.
pub fn init_tray(app: &AppHandle) {
    let ok = create_tray(app).map_err(|e| eprintln!("tray icon unavailable: {e}")).is_ok();
    app.manage(Tray(ok));
}

/// Tray icon: a left click shows the window; the menu has Mở cửa sổ and Thoát.
fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Mở cửa sổ", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Thoát", true, None::<&str>)?;
    let mut tray = TrayIconBuilder::with_id(MAIN)
        .tooltip("Sky Manager")
        .menu(&Menu::with_items(app, &[&open, &quit])?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Brings the window back from the tray, the Dock or the taskbar, in front.
pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Runs a close choice: hide to the tray, or quit. Ask does nothing.
fn close(app: &AppHandle, action: OnClose) {
    match action {
        OnClose::Ask => {}
        OnClose::Tray => {
            if let Some(window) = app.get_webview_window(MAIN) {
                let has_tray = app.try_state::<Tray>().is_some_and(|t| t.0);
                let _ = if has_tray { window.hide() } else { window.minimize() };
            }
        }
        OnClose::Quit => app.exit(0),
    }
}

/// The close button: always kept from closing the window directly, then the
/// saved choice is applied, or the webview is asked to show the dialog.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else { return };
    if window.label() != MAIN {
        return;
    }
    let on_close = window.try_state::<SettingsStore>().map(|s| s.get().on_close).unwrap_or_default();
    api.prevent_close();
    match on_close {
        OnClose::Ask => {
            // If the webview cannot be told, do not leave the user stuck with a window that won't close.
            if window.emit(CLOSE_ASKED, ()).is_err() {
                close(window.app_handle(), OnClose::Tray);
            }
        }
        action => close(window.app_handle(), action),
    }
}

/// From the "Đóng cửa sổ" dialog: run the choice, and keep it as the setting
/// when `remember` is set (it can be changed back in Cài đặt).
#[tauri::command]
pub async fn close_window(
    app: AppHandle,
    store: tauri::State<'_, SettingsStore>,
    action: OnClose,
    remember: bool,
) -> Result<(), SettingsError> {
    if action == OnClose::Ask {
        return Err(SettingsError::Invalid("Chọn chạy nền hoặc thoát".into()));
    }
    if remember {
        store.update(SettingsPatch { on_close: Some(action), ..Default::default() })?;
    }
    close(&app, action);
    Ok(())
}

/// macOS puts an app with no visible window in App Nap, where its timers may
/// run late. One activity for the whole run keeps it out of App Nap while the
/// window is in the tray; the Mac can still sleep when idle.
#[cfg(target_os = "macos")]
pub fn keep_awake() {
    use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};
    let activity = NSProcessInfo::processInfo().beginActivityWithOptions_reason(
        NSActivityOptions::UserInitiatedAllowingIdleSystemSleep,
        &NSString::from_str("Sky Manager chạy nền ở khay"),
    );
    // Never ended: it lasts as long as the app.
    std::mem::forget(activity);
}

#[cfg(not(target_os = "macos"))]
pub fn keep_awake() {}
