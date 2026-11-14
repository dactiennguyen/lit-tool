mod accounts;
mod chat;
mod hx;
mod lit;
mod lit_types;
mod secrets;
mod settings;
mod store;

use tauri::Manager;

use accounts::{AccountRegistry, KeyringStore};
use secrets::FileSecretStore;
use settings::SettingsStore;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            // Secrets live in secrets.json; the keychain is only read to migrate old entries.
            let secrets = std::sync::Arc::new(FileSecretStore::open(&dir, Some(Box::new(KeyringStore)))?);
            app.manage(AccountRegistry::open(&dir, Box::new(secrets.clone()))?);
            app.manage(SettingsStore::open(&dir, Box::new(secrets))?);
            app.manage(chat::HxTokens::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            accounts::accounts_list,
            accounts::accounts_add,
            accounts::accounts_update,
            accounts::accounts_remove,
            chat::hx_check_connection,
            accounts::accounts_recovered_backup,
            settings::settings_get,
            settings::settings_update,
            settings::settings_clear_im_template,
            lit::lit_account_info,
            lit::lit_online_users,
            lit::lit_user_info,
            lit::lit_user_info_me,
            lit::lit_conversations,
            chat::hx_history,
            chat::hx_send_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
