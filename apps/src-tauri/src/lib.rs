mod api;
mod app;
mod chat;
mod net;
mod storage;

use tauri::Manager;

use api::{dfpid, lit};
use app::{update, window};
use chat::{commands, listen, store as chat_store};
use net::http;
use storage::accounts::{self, AccountRegistry, KeyringStore};
use storage::db::Db;
use storage::settings::{self, SettingsStore};
use storage::transfer;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(update::Updates::default())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            // Everything lives in sky.db; the keychain is only read to migrate old secrets.
            let db = std::sync::Arc::new(Db::open(&dir, Some(Box::new(KeyringStore)))?);
            app.manage(AccountRegistry::open(db.clone())?);
            app.manage(chat_store::ChatStore::new(db.clone()));
            app.manage(SettingsStore::open(db)?);
            app.manage(commands::HxTokens::default());
            app.manage(listen::Listeners::default());
            app.manage(dfpid::DeviceRefresh::default());
            http::init(app.handle());
            dfpid::start(app.handle());
            update::start(app.handle());
            window::init_tray(app.handle());
            window::keep_awake();
            Ok(())
        })
        .on_window_event(window::on_window_event)
        .invoke_handler(tauri::generate_handler![
            accounts::accounts_list,
            dfpid::device_generate,
            accounts::accounts_add,
            accounts::accounts_update,
            accounts::accounts_remove,
            accounts::proxy_test,
            transfer::accounts_export_text,
            transfer::accounts_export_file,
            transfer::accounts_read_file,
            transfer::accounts_import_text,
            commands::hx_probe_servers,
            accounts::accounts_recovered_backup,
            settings::settings_get,
            settings::settings_update,
            settings::settings_refresh_im_servers,
            lit::lit_account_info,
            lit::lit_online_users,
            lit::lit_user_info,
            lit::lit_user_info_me,
            lit::lit_conversations,
            lit::lit_feeds,
            commands::hx_history,
            commands::hx_send_text,
            chat_store::chat_saved_conversations,
            listen::hx_listen_start,
            listen::hx_listen_stop,
            listen::hx_listen_status,
            update::update_status,
            update::update_check,
            update::update_install,
            window::close_window,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            tauri::RunEvent::Exit => update::install_on_quit(app),
            // macOS: clicking the Dock icon while the window is hidden in the tray.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => window::show(app),
            _ => {}
        });
}
