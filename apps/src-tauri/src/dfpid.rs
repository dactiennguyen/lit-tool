use std::io::Write;
use std::time::Duration;

use aes::cipher::{BlockModeEncrypt, KeyIvInit, block_padding::Pkcs7};
use base64::{Engine, engine::general_purpose::STANDARD};
use flate2::{Compression, write::ZlibEncoder};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::Manager;
use uuid::Uuid;

use crate::{accounts::AccountRegistry, http, store::now_ms};

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

pub fn randomize(mut fields: Fields) -> Result<Fields, String> {
    fields.remove("_meta");
    validate_fields(&fields)?;
    let [brand, manufacturer, model] = MODELS[choice(MODELS.len())?];
    let android_id: String = bytes::<8>()?.iter().map(|b| format!("{b:02x}")).collect();
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
    let sid = match input.sid.filter(|s| !s.trim().is_empty()) {
        Some(s) => s.trim().to_owned(),
        None => {
            let id = input.account_id.ok_or("Nhập session trước khi lấy DFPID")?;
            tauri::async_runtime::spawn_blocking(move || {
                app.state::<AccountRegistry>().with_session(id)
            })
            .await
            .map_err(|_| "Không đọc được session")?
            .map_err(|e| e.to_string())?
            .1
        }
    };
    if sid.len() > 4096 || sid.chars().any(char::is_control) {
        return Err("Session không hợp lệ".into());
    }
    let mut fields = match input.fields {
        Some(fields) => fields,
        None if input.random => {
            serde_json::from_str(TEMPLATE).map_err(|_| "Mẫu thiết bị không hợp lệ")?
        }
        None => return Err("Chưa có JSON thiết bị để làm mới DFPID".into()),
    };
    fields.remove("_meta");
    if input.random {
        fields = randomize(fields)?;
    }
    validate_fields(&fields)?;
    fetch_device(fields, version, &sid, input.account_id).await
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

    #[tokio::test]
    #[ignore = "requires LIT_DFPID_SMOKE_INPUT pointing to an authorized account config"]
    async fn live_eye_issues_token_for_rust_payload() {
        let path = std::env::var("LIT_DFPID_SMOKE_INPUT").expect("set LIT_DFPID_SMOKE_INPUT");
        let config: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        let fields = randomize(serde_json::from_str(TEMPLATE).unwrap()).unwrap();
        let device = fetch_device(
            fields,
            config["query"]["version"].as_str().unwrap().into(),
            config["query"]["sid"].as_str().unwrap(),
            None,
        )
        .await
        .unwrap();
        device.validate(true).unwrap();
        assert_eq!(device.fields.len(), 198);
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
            let fields = randomize(original.clone()).unwrap();
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
        assert!(randomize(nested).is_err());
    }
}
