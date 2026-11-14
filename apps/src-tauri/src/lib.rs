mod accounts;
mod lit;
mod settings;
mod store;

use tauri::Manager;

use accounts::{AccountRegistry, KeyringStore};
use settings::SettingsStore;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let registry = AccountRegistry::open(&dir, Box::new(KeyringStore))?;
            app.manage(registry);
            app.manage(SettingsStore::open(&dir)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            accounts::accounts_list,
            accounts::accounts_add,
            accounts::accounts_update,
            accounts::accounts_remove,
            accounts::accounts_recovered_backup,
            settings::settings_get,
            settings::settings_update,
            lit::lit_account_info,
            lit::lit_online_users,
            lit::lit_user_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
