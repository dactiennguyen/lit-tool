use std::io::Write;
use std::time::Duration;

use aes::cipher::{BlockModeEncrypt, KeyIvInit, block_padding::Pkcs7};
use base64::{Engine, engine::general_purpose::STANDARD};
use flate2::{Compression, write::ZlibEncoder};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::Manager;
use uuid::Uuid;

use crate::{
    accounts::{Account, AccountRegistry},
    http,
    store::now_ms,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct DeviceRefresh {
    slots: Mutex<HashMap<Uuid, Arc<tokio::sync::Mutex<Option<RefreshFailure>>>>>,
}

struct RefreshFailure {
    identity: (String, String, Option<u64>),
    retry_at: u64,
    message: String,
}

impl DeviceRefresh {
    async fn ensure_with<F, Fut>(
        &self,
        registry: &AccountRegistry,
        id: Uuid,
        fetch: F,
    ) -> Result<(Account, String), String>
    where
        F: FnOnce(Fields, String, String, Uuid) -> Fut,
        Fut: std::future::Future<Output = Result<DeviceSetup, String>>,
    {
        let slot = self.slots.lock().unwrap().entry(id).or_default().clone();
        let mut failure = slot.lock().await;
        let (account, sid) = registry.with_session(id).map_err(|e| e.to_string())?;
        let Some(device) = account.active_device() else {
            return Ok((account, sid));
        };
        if device.device_uuid != account.device_uuid {
            return Err("JSON thiết bị khác UUID phiên; hãy làm mới DFPID trước khi bật thiết bị".into());
        }
        if device.exp > now_ms() {
            *failure = None;
            return Ok((account, sid));
        }
        let identity = (
            account.request_uuid().to_owned(),
            account.version.clone(),
            account.session_saved_at,
        );
        if let Some(previous) = failure
            .as_ref()
            .filter(|f| f.identity == identity && f.retry_at > now_ms())
        {
            return Err(previous.message.clone());
        }
        match fetch(
            device.fields.clone(),
            account.version.clone(),
            sid.clone(),
            id,
        )
        .await
        {
            Ok(device) => {
                *failure = None;
                registry
                    .save_refreshed_device(&account, &sid, device)
                    .map_err(|e| e.to_string())?;
                let current = registry.with_session(id).map_err(|e| e.to_string())?;
                if current.0.active_device().is_some_and(|d| d.exp <= now_ms()) {
                    return Err(
                        "Thiết bị/session đã thay đổi trong lúc làm mới DFPID; hãy thử lại".into(),
                    );
                }
                Ok(current)
            }
            Err(message) => {
                let message =
                    format!("Chưa làm mới được DFPID: {message}. Tự thử lại sau 30 giây.");
                *failure = Some(RefreshFailure {
                    identity,
                    retry_at: now_ms() + 30_000,
                    message: message.clone(),
                });
                Err(message)
            }
        }
    }
}

pub async fn ensure(app: &tauri::AppHandle, id: Uuid) -> Result<(Account, String), String> {
    let registry = app.state::<AccountRegistry>();
    let result = app
        .state::<DeviceRefresh>()
        .ensure_with(&registry, id, |fields, version, sid, id| async move {
            let device = fetch_device(fields, version, &sid, Some(id)).await?;
            Ok(device)
        })
        .await?;
    Ok(result)
}

pub fn start(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(30));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            timer.tick().await;
            let accounts = app.state::<AccountRegistry>().list();
            app.state::<DeviceRefresh>()
                .slots
                .lock()
                .unwrap()
                .retain(|id, _| accounts.iter().any(|a| a.id == *id));
            for account in accounts {
                if account.active_device().is_some_and(|d| d.exp <= now_ms()) {
                    let _ = ensure(&app, account.id).await;
                }
            }
        }
    });
}

pub async fn generate_new(version: String, sid: &str, uuid: Option<&str>) -> Result<DeviceSetup, String> {
    let fields = prepare_device_fields(None, true, uuid)?;
    fetch_device(fields, version, sid, None).await
}

pub type Fields = Map<String, Value>;
const TEMPLATE: &str = include_str!("../../../scripts/devices_info.json");
const KEY: [u8; 16] = [
    0x43, 0x8e, 0x0c, 0xba, 0xc6, 0x83, 0x5d, 0x0b, 0x4e, 0xc0, 0x86, 0x2e, 0xa6, 0x7d, 0x53, 0x7b,
];
const IV: [u8; 16] = [
    0xcc, 0x1c, 0x11, 0x8e, 0xde, 0xfc, 0xdb, 0xc6, 0x46, 0xf6, 0x3f, 0x58, 0x28, 0x8c, 0x2b, 0xe6,
];
const MODELS: [[&str; 3]; 11] = [
    ["google", "Google", "Pixel 7"],
    ["google", "Google", "Pixel 6a"],
    ["google", "Google", "Pixel 8 Pro"],
    ["samsung", "samsung", "SM-S918B"],
    ["samsung", "samsung", "SM-A546B"],
    ["samsung", "samsung", "SM-G991B"],
    ["OnePlus", "OnePlus", "CPH2449"],
    ["Xiaomi", "Xiaomi", "2201123G"],
    ["Redmi", "Xiaomi", "23021RAAEG"],
    ["motorola", "motorola", "moto g84 5G"],
    ["Nokia", "HMD Global", "Nokia G42 5G"],
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSetup {
    pub device_uuid: String,
    pub dfp_id: String,
    pub version: String,
    pub exp: u64,
    pub ver: String,
    pub fields: Fields,
}

impl DeviceSetup {
    pub fn validate(&self, fresh: bool) -> Result<(), String> {
        validate_fields(&self.fields)?;
        if text(&self.fields, "android_id_secure")? != self.device_uuid
            || self.dfp_id.is_empty()
            || self.dfp_id.len() > 512
            || !self
                .dfp_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"+/=_-".contains(&b))
            || self.ver.trim().is_empty()
            || self.exp > 9_007_199_254_740_991
            || (fresh && self.exp <= now_ms())
        {
            return Err("Thông tin thiết bị hoặc DFPID không hợp lệ / đã hết hạn".into());
        }
        Ok(())
    }

    pub fn model(&self) -> &str {
        self.fields
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or("Pixel 8 Pro")
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceRequest {
    pub account_id: Option<Uuid>,
    pub device_uuid: Option<String>,
    pub sid: Option<String>,
    pub version: String,
    pub fields: Option<Fields>,
    pub random: bool,
}

fn text<'a>(fields: &'a Fields, key: &str) -> Result<&'a str, String> {
    fields
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| format!("JSON thiết bị thiếu {key}"))
}

fn validate_fields(fields: &Fields) -> Result<(), String> {
    if fields.is_empty()
        || serde_json::to_vec(fields)
            .map_err(|_| "JSON thiết bị không hợp lệ")?
            .len()
            > 1024 * 1024
        || fields
            .values()
            .any(|v| !v.is_string() && !v.is_number() && !v.is_boolean())
    {
        return Err("JSON thiết bị phải là object phẳng, tối đa 1 MiB".into());
    }
    for key in ["model", "android_id_secure", "cpu_abi"] {
        text(fields, key)?;
    }
    if !crate::lit::is_id(text(fields, "android_id_secure")?) {
        return Err("Android ID không hợp lệ".into());
    }
    Ok(())
}

fn bytes<const N: usize>() -> Result<[u8; N], String> {
    let mut out = [0; N];
    getrandom::fill(&mut out).map_err(|_| "Không tạo được số ngẫu nhiên")?;
    Ok(out)
}

fn choice(length: usize) -> Result<usize, String> {
    let limit = 256 - 256 % length;
    loop {
        let n = bytes::<1>()?[0] as usize;
        if n < limit {
            return Ok(n % length);
        }
    }
}

pub fn randomize(mut fields: Fields, uuid: Option<&str>) -> Result<Fields, String> {
    fields.remove("_meta");
    validate_fields(&fields)?;
    let [brand, manufacturer, model] = MODELS[choice(MODELS.len())?];
    let android_id = match uuid {
        Some(id) if crate::lit::is_id(id) && id.len() <= 128 => id.to_owned(),
        Some(_) => return Err("UUID thiết bị không hợp lệ".into()),
        None => bytes::<8>()?.iter().map(|b| format!("{b:02x}")).collect(),
    };
    let alphabet = b"0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let serial: String = (0..12)
        .map(|_| choice(alphabet.len()).map(|i| alphabet[i] as char))
        .collect::<Result<_, _>>()?;
    let mut bt = bytes::<6>()?;
    bt[0] &= 0xfc;
    let bluetooth = bt
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":");
    let drm = STANDARD.encode(bytes::<32>()?);
    for (key, value) in [
        ("brand", brand.to_owned()),
        ("manufacturer", manufacturer.to_owned()),
        ("model", model.to_owned()),
        ("android_id_secure", android_id),
        ("ad_aaid", Uuid::new_v4().to_string()),
        ("serialno", serial),
        ("bluetooth_address", bluetooth),
        ("drmId", drm.clone()),
        ("drmId_native", drm),
    ] {
        if let Some(old) = fields.get_mut(key) {
            if !old.is_string() {
                return Err(format!("Trường {key} phải là chuỗi"));
            }
            *old = Value::String(value);
        }
    }
    Ok(fields)
}

fn encode(fields: &Fields) -> Result<String, String> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::best());
    encoder
        .write_all(&serde_json::to_vec(fields).map_err(|_| "JSON thiết bị không hợp lệ")?)
        .map_err(|_| "Không nén được JSON thiết bị")?;
    let compressed = encoder
        .finish()
        .map_err(|_| "Không nén được JSON thiết bị")?;
    Ok(STANDARD.encode(
        cbc::Encryptor::<aes::Aes128>::new(&KEY.into(), &IV.into())
            .encrypt_padded_vec::<Pkcs7>(&compressed),
    ))
}

fn eye_url(fields: &Fields, version: &str, sid: &str) -> Result<url::Url, String> {
    let mut url =
        url::Url::parse("https://cloud.litatom.com/api/sns/v1/lit/eye?eyeversion=1.0.1").unwrap();
    url.query_pairs_mut().extend_pairs([
        ("sid", sid),
        ("loc", "US"),
        ("uuid", text(fields, "android_id_secure")?),
        ("version", version),
        ("lang", "vi"),
        ("platform", "android"),
        ("model", text(fields, "model")?),
        ("loctype", "0"),
        ("os", "33"),
        ("net_type", "wifi"),
        ("appid", "NxUUhRSQH3qPJmY2Vn/edRz4vrc="),
        ("cpu_abi", text(fields, "cpu_abi")?),
    ]);
    Ok(url)
}

fn parse_response(
    status: u16,
    body: &[u8],
    fields: Fields,
    version: String,
) -> Result<DeviceSetup, String> {
    let value: Value = serde_json::from_slice(body).map_err(|_| "Eye trả dữ liệu không hợp lệ")?;
    if !(200..300).contains(&status) || value["code"].as_i64() != Some(0) {
        return Err(format!("Eye không cấp DFPID (HTTP {status})"));
    }
    let data = &value["data"];
    let device = DeviceSetup {
        device_uuid: text(&fields, "android_id_secure")?.to_owned(),
        dfp_id: data["dfpId"].as_str().unwrap_or_default().to_owned(),
        exp: data["exp"]
            .as_u64()
            .or_else(|| data["exp"].as_str()?.parse().ok())
            .unwrap_or(0),
        ver: data["ver"].as_str().unwrap_or_default().to_owned(),
        fields,
        version,
    };
    device.validate(true)?;
    Ok(device)
}

#[tauri::command]
pub async fn device_generate(
    app: tauri::AppHandle,
    input: DeviceRequest,
) -> Result<DeviceSetup, String> {
    let version = input.version.trim().to_owned();
    if version.is_empty()
        || version.len() > 64
        || !version
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    {
        return Err("Version không hợp lệ".into());
    }
    let provided_sid = input.sid.filter(|s| !s.trim().is_empty()).map(|s| s.trim().to_owned());
    let saved = if let Some(id) = input.account_id {
        let sid = provided_sid.clone();
        Some(tauri::async_runtime::spawn_blocking(move || {
            generation_context(&app.state::<AccountRegistry>(), id, sid)
        }).await.map_err(|_| "Không đọc được account")??)
    } else { None };
    let uuid = input.device_uuid.as_deref().map(str::trim).filter(|s| !s.is_empty())
        .or_else(|| saved.as_ref().map(|(account, _)| account.device_uuid.as_str()));
    let sid = provided_sid
        .or_else(|| saved.as_ref().map(|(_, sid)| sid.clone()))
        .ok_or("Nhập session trước khi lấy DFPID")?;
    if sid.len() > 4096 || sid.chars().any(char::is_control) {
        return Err("Session không hợp lệ".into());
    }
    let fields = prepare_device_fields(input.fields, input.random, uuid)?;
    fetch_device(fields, version, &sid, input.account_id).await
}

fn generation_context(registry: &AccountRegistry, id: Uuid, sid: Option<String>) -> Result<(Account, String), String> {
    match sid {
        Some(sid) => registry.list().into_iter().find(|a| a.id == id)
            .map(|account| (account, sid)).ok_or_else(|| "Không tìm thấy account".into()),
        None => registry.with_session(id).map_err(|e| e.to_string()),
    }
}

fn prepare_device_fields(source: Option<Fields>, random: bool, uuid: Option<&str>) -> Result<Fields, String> {
    let existing = uuid.map(str::to_owned).or_else(|| {
        source.as_ref().and_then(|f| f.get("android_id_secure")).and_then(Value::as_str).map(str::to_owned)
    });
    if existing.as_deref().is_some_and(|id| !crate::lit::is_id(id) || id.len() > 128) {
        return Err("UUID thiết bị không hợp lệ".into());
    }
    let mut fields = match source {
        Some(fields) => fields,
        None if random => serde_json::from_str(TEMPLATE).map_err(|_| "Mẫu thiết bị không hợp lệ")?,
        None => return Err("Chưa có JSON thiết bị để làm mới DFPID".into()),
    };
    fields.remove("_meta");
    if random {
        fields = randomize(fields, existing.as_deref())?;
    } else if let Some(id) = existing {
        fields.insert("android_id_secure".into(), id.into());
    }
    validate_fields(&fields)?;
    Ok(fields)
}

async fn fetch_device(
    fields: Fields,
    version: String,
    sid: &str,
    account_id: Option<Uuid>,
) -> Result<DeviceSetup, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Không tạo được kết nối Eye")?;
    let request = client
        .post(eye_url(&fields, &version, sid)?)
        .header("Content-Type", "application/json; charset=UTF-8")
        .header("Accept-Encoding", "identity")
        .body(encode(&fields)?);
    let response = http::fetch_with(
        request,
        1024 * 1024,
        http::Trace {
            account_id,
            service: "DFPID",
        },
        Some("[JSON thiết bị đã mã hóa]"),
        |_| None,
    )
    .await
    .map_err(|e| match e {
        http::FetchError::Network(message) => format!("Không kết nối được Eye: {message}"),
        http::FetchError::TooLarge => "Response Eye vượt 1 MiB".into(),
    })?;
    parse_response(response.status, &response.body, fields, version)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes::cipher::BlockModeDecrypt;
    use std::io::Read;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn saved_fixture() -> (tempfile::TempDir, Arc<AccountRegistry>, Uuid) {
        let dir = tempfile::tempdir().unwrap();
        let db = crate::db::open_temp(dir.path());
        let reg = AccountRegistry::open(db.clone()).unwrap();
        let device = fresh(sample(), "7.77.0".into());
        let input = serde_json::from_value(serde_json::json!({
            "label":"Test", "deviceUuid":device.device_uuid, "version":device.version,
            "dfpid":device.dfp_id, "device":device, "deviceEnabled":true, "sid":"test-sid"
        }))
        .unwrap();
        let mut account = reg.add(input).unwrap();
        account.device.as_mut().unwrap().exp = 1;
        db.write(|tx| crate::db::update_account(tx, &account))
            .unwrap();
        (
            dir,
            Arc::new(AccountRegistry::open(db).unwrap()),
            account.id,
        )
    }

    fn fresh(fields: Fields, version: String) -> DeviceSetup {
        DeviceSetup {
            device_uuid: text(&fields, "android_id_secure").unwrap().into(),
            dfp_id: "refreshed-token".into(),
            exp: now_ms() + 60_000,
            ver: "0.0.2".into(),
            fields,
            version,
        }
    }

    #[test]
    fn generation_can_use_a_new_sid_when_the_saved_secret_is_missing() {
        let (dir, reg, id) = saved_fixture();
        let original = reg.list()[0].clone();
        drop(reg);
        let db = crate::db::open_temp(dir.path());
        db.write(|tx| crate::db::put_secret(tx, &id.to_string(), None)).unwrap();
        let registry = AccountRegistry::open(db).unwrap();
        assert!(generation_context(&registry, id, None).is_err());
        let (account, sid) = generation_context(&registry, id, Some("replacement-sid".into())).unwrap();
        assert_eq!(sid, "replacement-sid");
        assert_eq!(account, original);
        assert!(generation_context(&registry, Uuid::new_v4(), Some(sid)).is_err());
        assert!(registry.with_session(id).is_err());
    }

    #[tokio::test]
    async fn concurrent_requests_refresh_once_and_persist_before_using_the_token() {
        let (dir, reg, id) = saved_fixture();
        let before = reg.list()[0].device.clone().unwrap().fields;
        let refresh = Arc::new(DeviceRefresh::default());
        let calls = Arc::new(AtomicUsize::new(0));
        let mut tasks = tokio::task::JoinSet::new();
        for _ in 0..12 {
            let (reg, refresh, calls) = (reg.clone(), refresh.clone(), calls.clone());
            tasks.spawn(async move {
                refresh
                    .ensure_with(&reg, id, |fields, version, sid, _| async move {
                        assert_eq!(sid, "test-sid");
                        calls.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_millis(10)).await;
                        Ok(fresh(fields, version))
                    })
                    .await
                    .unwrap()
            });
        }
        while let Some(result) = tasks.join_next().await {
            let (account, _) = result.unwrap();
            assert_eq!(account.dfpid.as_deref(), Some("refreshed-token"));
            assert!(account.device.unwrap().exp > now_ms());
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let reopened = AccountRegistry::open(crate::db::open_temp(dir.path())).unwrap();
        assert_eq!(reopened.list()[0].device.as_ref().unwrap().fields, before);
        assert!(reopened.list()[0].device.as_ref().unwrap().exp > now_ms());
        assert_eq!(
            reopened.list()[0].device_uuid,
            text(&before, "android_id_secure").unwrap()
        );
    }

    #[tokio::test]
    async fn disabled_device_never_refreshes_even_when_expired() {
        let (_dir, reg, id) = saved_fixture();
        let before = reg.update(id, serde_json::from_value(serde_json::json!({"deviceEnabled":false})).unwrap()).unwrap();
        let refresh = DeviceRefresh::default();
        let (account, _) = refresh.ensure_with(&reg, id, |_, _, _, _| async {
            panic!("disabled must not call Eye")
        }).await.unwrap();
        assert_eq!(account, before);
        assert!(account.active_device().is_none());
    }

    #[tokio::test]
    async fn disabling_during_refresh_discards_the_response() {
        let (_dir, reg, id) = saved_fixture();
        let before = reg.list()[0].device.clone();
        let refresh = DeviceRefresh::default();
        let (account, _) = refresh.ensure_with(&reg, id, |fields, version, _, _| async {
            reg.update(id, serde_json::from_value(serde_json::json!({"deviceEnabled":false})).unwrap()).unwrap();
            Ok(fresh(fields, version))
        }).await.unwrap();
        assert!(!account.device_enabled);
        assert_eq!(account.device, before);
        assert!(account.request_dfpid().is_none());
    }

    #[tokio::test]
    async fn failure_preserves_device_and_uses_cooldown_then_retries() {
        let (_dir, reg, id) = saved_fixture();
        let before = reg.list()[0].clone();
        let refresh = DeviceRefresh::default();
        let calls = AtomicUsize::new(0);
        for _ in 0..3 {
            let result = refresh
                .ensure_with(&reg, id, |_, _, _, _| async {
                    calls.fetch_add(1, Ordering::SeqCst);
                    Err("offline".into())
                })
                .await;
            assert!(result.unwrap_err().contains("offline"));
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(reg.list()[0], before);
        let slot = refresh.slots.lock().unwrap()[&id].clone();
        slot.lock().await.as_mut().unwrap().retry_at = 0;
        let (account, _) = refresh
            .ensure_with(&reg, id, |f, v, _, _| async { Ok(fresh(f, v)) })
            .await
            .unwrap();
        assert!(account.device.unwrap().exp > now_ms());
    }

    #[tokio::test]
    async fn in_flight_refresh_cannot_overwrite_rotation_or_recreate_removed_account() {
        let (_dir, reg, id) = saved_fixture();
        let refresh = DeviceRefresh::default();
        let (result, _) = refresh
            .ensure_with(&reg, id, |fields, version, _, _| async {
                let mut rotated = fields.clone();
                rotated.insert("model".into(), "Rotated model".into());
                let patch = serde_json::from_value(
                    serde_json::json!({"device":fresh(rotated, version.clone())}),
                )
                .unwrap();
                reg.update(id, patch).unwrap();
                Ok(fresh(fields, version))
            })
            .await
            .unwrap();
        assert_eq!(result.device.unwrap().model(), "Rotated model");
        let (_dir2, reg2, id2) = saved_fixture();
        assert!(
            refresh
                .ensure_with(&reg2, id2, |fields, version, _, _| async {
                    reg2.remove(id2).unwrap();
                    Ok(fresh(fields, version))
                })
                .await
                .is_err()
        );
        assert!(reg2.list().is_empty());
    }

    #[tokio::test]
    async fn session_change_during_refresh_rejects_the_old_response() {
        let (_dir, reg, id) = saved_fixture();
        let refresh = DeviceRefresh::default();
        assert!(
            refresh
                .ensure_with(&reg, id, |fields, version, _, _| async {
                    reg.update(
                        id,
                        serde_json::from_value(serde_json::json!({"sid":"changed-session"}))
                            .unwrap(),
                    )
                    .unwrap();
                    Ok(fresh(fields, version))
                })
                .await
                .is_err()
        );
        assert_eq!(reg.list()[0].device.as_ref().unwrap().exp, 1);
        refresh
            .ensure_with(&reg, id, |fields, version, sid, _| async move {
                assert_eq!(sid, "changed-session");
                Ok(fresh(fields, version))
            })
            .await
            .unwrap();
    }

    fn decode(token: &str) -> Value {
        let compressed = cbc::Decryptor::<aes::Aes128>::new(&KEY.into(), &IV.into())
            .decrypt_padded_vec::<Pkcs7>(&STANDARD.decode(token).unwrap())
            .unwrap();
        let mut plain = String::new();
        flate2::read::ZlibDecoder::new(compressed.as_slice())
            .read_to_string(&mut plain)
            .unwrap();
        serde_json::from_str(&plain).unwrap()
    }

    fn sample() -> Fields {
        serde_json::from_value(serde_json::json!({
            "android_id_secure": "0123456789abcdef", "model": "Pixel 7", "cpu_abi": "arm64-v8a"
        }))
        .unwrap()
    }

    #[test]
    fn creation_rotation_and_refresh_keep_existing_uuid_in_payload_and_query() {
        let id = "existing-session-uuid";
        let mut fields = prepare_device_fields(None, true, Some(id)).unwrap();
        for _ in 0..8 {
            fields = prepare_device_fields(Some(fields), true, Some(id)).unwrap();
            assert_eq!(text(&fields, "android_id_secure").unwrap(), id);
            let url = eye_url(&fields, "7.77.0", "sid").unwrap();
            assert_eq!(url.query_pairs().find(|(k, _)| k == "uuid").unwrap().1, id);
        }
        assert_eq!(prepare_device_fields(Some(fields.clone()), false, Some(id)).unwrap(), fields);
        let repaired = prepare_device_fields(Some(sample()), false, Some(id)).unwrap();
        assert_eq!(text(&repaired, "android_id_secure").unwrap(), id);
        let first = prepare_device_fields(None, true, None).unwrap();
        let uuid = text(&first, "android_id_secure").unwrap().to_owned();
        assert_eq!(uuid.len(), 16);
        let next = prepare_device_fields(Some(first), true, None).unwrap();
        assert_eq!(text(&next, "android_id_secure").unwrap(), uuid);
        assert!(prepare_device_fields(None, true, Some("bad uuid")).is_err());
    }

    #[tokio::test]
    #[ignore = "requires LIT_DFPID_SMOKE_INPUT pointing to an authorized account config"]
    async fn live_eye_issues_token_for_rust_payload() {
        let path = std::env::var("LIT_DFPID_SMOKE_INPUT").expect("set LIT_DFPID_SMOKE_INPUT");
        let config: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let db = crate::db::open_temp(dir.path());
        let registry = AccountRegistry::open(db.clone()).unwrap();
        let input = serde_json::from_value(serde_json::json!({
            "label":"DFPID lifecycle test", "deviceEnabled":true, "version":config["query"]["version"], "sid":config["query"]["sid"]
        })).unwrap();
        let mut account = registry
            .add_prepared(input, |version, sid, uuid| async move {
                generate_new(version, &sid, uuid.as_deref()).await
            })
            .await
            .unwrap();
        let fields = account.device.as_ref().unwrap().fields.clone();
        assert_eq!(fields.len(), 198);
        account.device.as_mut().unwrap().exp = 1;
        db.write(|tx| crate::db::update_account(tx, &account))
            .unwrap();
        let registry = AccountRegistry::open(db.clone()).unwrap();
        let refresh = DeviceRefresh::default();
        let (fresh, sid) = refresh
            .ensure_with(
                &registry,
                account.id,
                |fields, version, sid, id| async move {
                    fetch_device(fields, version, &sid, Some(id)).await
                },
            )
            .await
            .unwrap();
        assert_eq!(fresh.device.as_ref().unwrap().fields, fields);
        fresh.device.as_ref().unwrap().validate(true).unwrap();
        let profile = crate::lit::LitProfile {
            sid: &sid,
            uuid: &fresh.device_uuid,
            version: &fresh.version,
            user_id: None,
            dfpid: fresh.dfpid.as_deref(),
            model: fresh.device.as_ref().map(|d| d.model()),
            base_url: "https://www.litatom.com",
        };
        let request = crate::lit::build_get(
            "user/get_info/me",
            &profile,
            &[],
            crate::lit::SignOptions::fresh().unwrap(),
        )
        .unwrap();
        assert_eq!(
            request
                .headers
                .iter()
                .find(|(k, _)| *k == "X-DFPID")
                .unwrap()
                .1,
            fresh.dfpid.clone().unwrap()
        );
        assert_eq!(
            AccountRegistry::open(db).unwrap().list()[0].device,
            fresh.device
        );
    }

    #[test]
    fn eye_encryption_decodes_node_fixture_and_round_trips() {
        let token = "Ws3ikmcPy0wS1r4qqa9qR4J6dYIPAUdBXKSVwUW/CF8g35Xb+4Vbgb9QY0OanJHZBZxAgEEtZuU5PF4kqfcX6Vm1hEl/rC9hiapiqBCK2yDH6npKffeJdJvn+cmMLm/V";
        assert_eq!(decode(token), Value::Object(sample()));
        assert_eq!(decode(&encode(&sample()).unwrap()), Value::Object(sample()));
    }

    #[test]
    fn randomization_preserves_template_and_keeps_query_and_drm_consistent() {
        let original: Fields = serde_json::from_str(TEMPLATE).unwrap();
        let changed = [
            "brand",
            "manufacturer",
            "model",
            "android_id_secure",
            "ad_aaid",
            "serialno",
            "bluetooth_address",
            "drmId",
            "drmId_native",
        ];
        for _ in 0..100 {
            let fields = randomize(original.clone(), None).unwrap();
            assert_eq!(fields.len(), 198);
            for (key, value) in &original {
                if !changed.contains(&key.as_str()) {
                    assert_eq!(&fields[key], value);
                }
            }
            assert!(MODELS.iter().any(|r| fields["brand"] == r[0]
                && fields["manufacturer"] == r[1]
                && fields["model"] == r[2]));
            assert_eq!(text(&fields, "android_id_secure").unwrap().len(), 16);
            assert_eq!(
                STANDARD
                    .decode(text(&fields, "drmId").unwrap())
                    .unwrap()
                    .len(),
                32
            );
            assert_eq!(fields["drmId"], fields["drmId_native"]);
            let first_byte =
                u8::from_str_radix(&text(&fields, "bluetooth_address").unwrap()[..2], 16).unwrap();
            assert_eq!(first_byte & 3, 0);
            let url = eye_url(&fields, "7.77.0", "sid-test").unwrap();
            let query: std::collections::HashMap<_, _> = url.query_pairs().collect();
            assert_eq!(query["model"], text(&fields, "model").unwrap());
            assert_eq!(query["uuid"], text(&fields, "android_id_secure").unwrap());
        }
    }

    #[test]
    fn responses_must_have_a_valid_unexpired_token() {
        let valid = serde_json::json!({"code":0,"data":{"dfpId":"test-token","exp":now_ms()+60_000,"ver":"0.0.2"}});
        assert!(
            parse_response(
                200,
                &serde_json::to_vec(&valid).unwrap(),
                sample(),
                "7.77.0".into()
            )
            .is_ok()
        );
        let mut string_exp = valid.clone();
        string_exp["data"]["exp"] = string_exp["data"]["exp"].to_string().into();
        assert!(
            parse_response(
                200,
                &serde_json::to_vec(&string_exp).unwrap(),
                sample(),
                "7.77.0".into()
            )
            .is_ok()
        );
        for (pointer, value) in [
            ("/code", Value::from(1)),
            ("/data/dfpId", Value::from("")),
            ("/data/exp", Value::from(1)),
        ] {
            let mut invalid = valid.clone();
            *invalid.pointer_mut(pointer).unwrap() = value;
            assert!(
                parse_response(
                    200,
                    &serde_json::to_vec(&invalid).unwrap(),
                    sample(),
                    "7.77.0".into()
                )
                .is_err()
            );
        }
        assert!(
            parse_response(
                500,
                &serde_json::to_vec(&valid).unwrap(),
                sample(),
                "7.77.0".into()
            )
            .is_err()
        );
        let mut nested = sample();
        nested.insert("bad".into(), serde_json::json!({"nested":1}));
        assert!(randomize(nested, None).is_err());
    }
}
