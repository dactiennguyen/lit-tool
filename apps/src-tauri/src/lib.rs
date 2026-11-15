mod accounts;
mod chat;
mod db;
mod dfpid;
mod http;
mod hx;
mod inspect;
mod listen;
mod lit;
mod lit_types;
mod msync;
mod settings;
mod siua;
mod store;
mod update;

use tauri::Manager;

use accounts::{AccountRegistry, KeyringStore};
use db::Db;
use settings::SettingsStore;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(update::Updates::default())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            // Everything lives in sky.db; the keychain is only read to migrate old secrets.
            let db = std::sync::Arc::new(Db::open(&dir, Some(Box::new(KeyringStore)))?);
            app.manage(AccountRegistry::open(db.clone())?);
            app.manage(SettingsStore::open(db)?);
            app.manage(chat::HxTokens::default());
            app.manage(listen::Listeners::default());
            http::init(app.handle());
            update::start(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            accounts::accounts_list,
            dfpid::device_generate,
            accounts::accounts_add,
            accounts::accounts_update,
            accounts::accounts_remove,
            chat::hx_probe_servers,
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
            chat::hx_history,
            chat::hx_send_text,
            listen::hx_listen_start,
            listen::hx_listen_stop,
            listen::hx_listen_status,
            update::update_status,
            update::update_check,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                update::install_on_quit(app);
            }
        });
}
