# 08 — `libliteye.so`: các hàm native trả gì về (ground-truth)

> Điều tra **giá trị trả về** của 5 hàm native JNI trong `libliteye.so` (anti-fraud SDK, cầu Java `com.lit.liteye.LitEye`). Kết hợp **mổ tĩnh** (REA/Ghidra, image base `0x100000`) + **hook read-only lúc chạy** (frida 17.23.3, bắt return thật trên thiết bị, user 10). Lib này **strip + JNI đăng ký động** nên hook theo **offset** = `ghidra_addr − 0x100000`.

## 0. Khai báo JNI (kiểu trả về) — `com/lit/liteye/LitEye.java`
| Java | Native addr (ghidra) | offset | Trả về |
|---|---|---|---|
| `String detect(Context)` | `0x1adda8` | `0xadda8` | blob chống giả mạo **đã mã hoá** |
| `String dfpToken(Context)` | `0x1adc00` | `0xadc00` | device fingerprint **đã mã hoá** |
| `String siua(Context)` | `0x1ae50c` | `0xae50c` | token X-SIUA (gói ~60 kết quả detect) |
| `String litSign(String)` | `0x1ae644` | `0xae644` | `hex(HMAC-SHA256)` — **không có caller Java** |
| `void initBreakpad(String)` | — | — | (crash reporter, không trả) |
| `void runtimeCheck(Context, cb)` | `0x1aece8` | `0xaece8` | void (kết quả qua callback) |

Mapping Java→native (qua `EyeLocalApi`): `dfpToken()→LitEye.dfpToken`, `fetchSIUA()→LitEye.siua`, `watch/detect→LitEye.detect`. Nếu thiếu context → tất cả trả **`""`** (hằng `DAT_00116c41` = chuỗi rỗng).

---

## 1. `litSign(input)` → **hex HMAC-SHA256** (đọc được)
```
litSign(input) = hex( HMAC-SHA256( key = "happy0litmatch1", input ) )   // 64 ký tự hex thường
```
- Mổ tĩnh `FUN_001ae644`: lấy key tại rodata rồi **XOR `0x7d19e377ef77d117`** để lộ `happy0litmatch1`; HMAC thủ công (ipad `0x36`/opad `0x5c`, SHA-256 tự cài `FUN_001bccb8`/`FUN_001bd188`); vòng lặp 32 byte → format hex; `NewStringUTF`.
- **KHÔNG có caller Java** (toàn bộ cây Java chỉ có đúng dòng `native String litSign`). Được gọi **nội bộ trong native** — nằm trên đường `siua`/POST-eye để ký payload. ⇒ chỉ "thức dậy" khi SIUA bật (xem §3).

> **Đã giải mã hoàn toàn `detect` + endpoint `/api/sns/v1/lit/eye` — xem [§6](#6-endpoint-apisnsv1liteye--đã-giải-mã-hoàn-toàn).**

## 2. `detect(ctx)` → **blob chống giả mạo ĐÃ MÃ HOÁ** (base64 chuẩn)
Trình tự dựng (tĩnh, `FUN_001adda8`): `"1.9.9"` (phiên bản) + `ts(ms)` + **11 trường anti-tamper** đọc từ struct `DAT_002a7518` (root/frida-maps/frida-thread/lsposed/pmsHook/accessibility/proxy/vpn/RWX-count…) nối separator → rồi `FUN_00258dac` **mã hoá khối custom** (pad PKCS 16B, S-box `DAT_001294a0`, round key nhúng `93 0f 8b 76 14 a9 44 6b`…) → encode base64.

**Ground-truth (bắt lúc chạy, mỗi lần khác do ts):**
```
detect() ret = "sReEuTdeSAJodM1wk9IZzVBgfXH5JegoGjDZSnQq/QUczgBPG8t..."   (len 108)
detect() ret = "DUfjHMukyCe72G5kf4kzr+8XAX2yxpteEZMYnInkQUmmQY6S66hD..."   (len 128)
```
- Base64 **chuẩn** (có `+` `/` `=`), độ dài ~108–128 (bội số 4 ⇒ 80/96 byte ciphertext = 5–6 khối AES).
- **Gọi khá thường xuyên** (quan sát: fire nhiều lần ngay sau khởi động + khi app hoạt động). Java POST blob này lên `POST /api/sns/v1/lit/eye` → server cấp lại `X-DFPID`.
- Nội dung thật (plaintext) **không đọc được tĩnh** nếu chưa dựng lại cipher custom + key; nhưng cấu trúc đã biết (version|ts|11 cờ scan).

## 3. `dfpToken(ctx)` → **device fingerprint ĐÃ MÃ HOÁ** (base64, rất dài)
Builder `FUN_001dc0e0` (đường Widevine/`AMediaDrm`) → `NewStringUTF`.

**Ground-truth (bắt lúc chạy):**
```
dfpToken() ret len = 4184   (≈3 KB base64)
prefix (ổn định giữa các lần, = phần device-stable):
  AQJKo9sIopSYMh/HLWtdwbRMVyYRAlY+a4IMakTCTaE1njn0tU67TuUB7qTM7ukt...
sau prefix thì phân kỳ theo nonce/thời điểm.
```
- Trả về là **blob mã hoá/đóng gói** ~3KB; prefix `AQJK…` cố định (danh tính thiết bị), đuôi đổi theo mỗi lần (nonce). Đây là "dfp token cục bộ" → đưa vào `X-DFPID`/gửi kèm detect.

## 4. `siua(ctx)` → **token X-SIUA** — hiện **DORMANT** (feature-flag server OFF)
- `siua` (→ `FUN_001be208`) chạy ~60 hàm phát hiện (root/frida/proxy/vpn/lsposed/pmsHook/accessibility/listDyn) rồi **đóng gói thành token** (dùng `litSign` nội bộ để ký).
- **Không bắt được lúc chạy** vì đường gọi bị chặn ở Java:
  ```java
  // EyeInterceptor: thêm header X-SIUA mỗi request, NHƯNG:
  EyeConnector.fetchSIUA(): if (litEyeApi != null && isSIUAEnable()) return litEyeApi.fetchSIUA();
  isSIUAEnable() → eyeContext.enableSIUA();   // ← feature-flag do SERVER bật/tắt
  ```
  `enableSIUA()` **từng** trả false (lượt cũ chỉ thấy `detect`/`dfpToken` fire).
  **Đính chính 13/11/2026:** lượt hook Java mới (frida 17.10 + bridge vá, [doc 17](17-hook-java-frida.md))
  thấy `fetchSIUA()` **có trả giá trị** (len 128–172) và request thật **có header
  `X-SIUA`** ⇒ **SIUA đang BẬT** trong phiên này. Cờ `enableSIUA()` do server điều khiển nên thay đổi được.
- Khi server bật cờ: mỗi request gắn `X-SIUA = siua(ctx)` (token mã hoá chứa kết quả ~60 detect). Xem header thật: [data/api-headers-response.json](data/api-headers-response.json).
- **Tái tạo `X-SIUA` bằng Node:** [scripts/siua.js](../scripts/siua.js) — `zlib(lv9)→AES-128-CBC→base64`, key `930f8b76…`/iv `28f1ebe0…` (RE từ lib). Đã verify **bit-identical** với 3 token native thật (input ~100 B nên khớp byte). Key/iv này **khác** key của `detect()` 198-trường — xem **§7**.

---

## 5. Phương pháp hook (read-only, tái lập)
- frida-server 17.23.3 (root, `/data/local/tmp/frida-server`) ↔ client `~/.frida-venv` 17.23.3.
- **Spawn gating thất bại** (app chỉ cài user 10, frida-server tìm ở user 0 → `unable to find application`). ⇒ dùng **race-attach**: `am force-stop --user 10` → `monkey -p pkg 1` (foreground user 10) → poll `enumerate_processes` attach ngay → script tự `setInterval` poll `libliteye.so` và cài hook đúng lúc `.so` load (trước khi `LitEye.init` gọi native).
- Đọc return `jstring` qua `JNIEnv` vtable: `GetStringUTFChars` idx 169 (`0x548`), `Release` idx 170 (`0x550`). Static native ⇒ `args[0]=JNIEnv`, `args[2]=jstring/Context`.
- Driver: scratchpad `gt_liteye_race.py` (bắt init) + `gt_liteye_login.py` (drive một request). Chỉ ĐỌC, không sửa gì; frida tắt sau khi xong.

> Chốt: `detect`/`dfpToken` trả **blob base64 đã mã hoá** (tái tạo plaintext cần dựng lại cipher custom); `litSign` trả **hex HMAC-SHA256(happy0litmatch1, msg)** đọc được nhưng chỉ chạy khi `siua` chạy; `siua` trả **token X-SIUA** nhưng đang bị **feature-flag `enableSIUA()` của server tắt**.

---

## 6. Endpoint `/api/sns/v1/lit/eye` — ĐÃ GIẢI MÃ HOÀN TOÀN

Endpoint đăng ký chống gian lận: client gửi blob `detect()` → server cấp `X-DFPID`. Luồng Java: `EyeConnector.fetchEyeToken()` → `LitEye.detect(ctx)` → `watch(blob)` → `EyeRequest.call(blob)`.

### 6.1. Request
```
POST https://cloud.litatom.com/api/sns/v1/lit/eye?eyeversion=1.0.1
Content-Type: application/json; charset=UTF-8
Body: <blob detect()>            # raw string, KHÔNG bọc JSON
```
- `baseUrl` = `EyeContext.baseUrl()` hoặc mặc định `https://cloud.litatom.com` (khác host chính `prod.litmatchs.com`).
- OkHttpClient **riêng** (`EyeRequest`, chỉ có `ParamsInterceptor`) → **KHÔNG qua** chain ký chính (không `litSign`/`X-Application-Info`). `ParamsInterceptor` thêm **query**: toàn bộ `EyeContext.httpParams()` (sid/uuid/loc/version…) + `cpu_abi`.
- Endpoint log phụ: `https://cloud.litatom.com/api/sns/v1/lit/liteyelog`.

### 6.2. Cấu trúc blob = **zlib → AES-128-CBC → base64** (3 lớp)
`detect()` dựng 1 chuỗi text, rồi:
```
payload_text → zlib.deflate (header 78da) → AES-128-CBC(PKCS7) → base64(std)
```
- **AES-128-CBC** (lõi `FUN_0025838c`, S-box AES chuẩn tại `0x1294a0`, 10 vòng):
  - `key = 93 0f 8b 76 14 a9 44 6b e3 b7 1f 55 71 3a 85 24` (`930f8b7614a9446be3b71f55713a8524`)
  - `iv  = 28 f1 eb e0 3c ce f9 fc a8 c5 c1 c0 41 e2 22 78` (`28f1ebe03ccef9fca8c5c1c041e22278`)
  - (key/IV nhúng trong `FUN_00258dac`, dump ground-truth từ lõi AES lúc chạy.)
- base64 **chuẩn** (`+` `/` `=`, encoder `FUN_00258a08`).

> ⚠️ **Đính chính (xem §7):** key/iv trên là của **eye-blob (= X-SIUA)**, KHÔNG phải
> key của `detect()` **198-trường**. `LitEye.detect()` lúc chạy trả JSON 198 trường mã
> hoá bằng cặp **KHÁC**: key `438e0cbac6835d0b4ec0862ea67d537b` / iv
> `cc1c118edefcdbc646f63f58288c2be6`. Bảng đầy đủ + phát hiện zlib ở **§7**.

### 6.3. Plaintext payload (đã giải — ground-truth từ blob thật)
```
2.1}}1.9.9|<ts_ms>|<uuid>}}<f0>|<f1>|…|<f10>}}
```
Ví dụ thật (3 mẫu bắt trên máy, APatch+frida đang chạy):
```
2.1}}1.9.9|1794491625700|4762aded-b4e9-479e-bb26-9c7506a12b65}}||||||none|0|none||quantity:12|RWX:0|}}
2.1}}1.9.9|1794491505765|0b78b3ca-e517-43dc-99f2-b12b9862b2c8}}|||||||0||||}}
2.1}}1.9.9|1794491506761|5d8f232e-bc92-4eaa-85b2-765e67eb8e2c}}|||||||0|||quantity:12|RWX:0|}}
```
- `2.1` = format version, `}}` = separator khối, `1.9.9` = eye version.
- `ts_ms` = timestamp ms; `uuid` = UUID thiết bị/phiên.
- **11 trường anti-tamper** (đúng thứ tự append trong `FUN_001adda8`, đọc từ struct `DAT_002a7518`):
  `fridaMaps | fridaThread | lsposed | pmsHook | root | accessibility | proxy | count | vpn | spare | rwx`
  với `rwx = "quantity:N|RWX:M"`.
- **Phát hiện quan trọng:** root & frida (fridaMaps/fridaThread) **RỖNG** dù máy APatch root + frida-server đang chạy ⇒ native scan của detect **bị qua mặt** ở các trường này; chỉ còn `proxy`/`vpn`=`none`, `count`=`0`, `rwx=quantity:12|RWX:0`. (Cờ "môi trường bất thường" 1112 ⇒ đến từ chỗ khác — secondary-user — chứ không phải các trường này.)

### 6.4. Response (ground-truth từ cache MMKV `construct_liteye_id/eye_id`)
```json
{"dfpId":"4TdafYa7HKc7Qaao+gwWmH5YHZTrVFrAbanRgg1XwaN0BrpRdsYAb9+BQglAH7ENDKYv+/H7j9DCbO147//oug==","exp":1794578908591,"ver":"0.0.2"}
```
Server trả `Result<EyeDfpId>` = `{data:{dfpId, ver, exp}}`:
- `dfpId` = base64 64-byte → **header `X-DFPID`** cho MỌI request về `prod.litmatchs.com` (tiêm bởi `EyeInterceptor`).
- `exp` = epoch ms hết hạn (~24h); `currentTimeMillis() > exp` → `fetchEyeToken()` làm mới.
- `ver` = "0.0.2".
- Cache: MMKV `construct_liteye_id`, key `eye_id` (JSON `EyeDfpId`). Fallback khi chưa có dfPID: `dfpToken()` cục bộ.

### 6.5. Tái lập
Script [`../scripts/eye.js`](../scripts/eye.js): `decodeEye(b64)` (AES-decrypt→inflate), `parseEye()` (tách trường), `encodeEye(text)`. Verify: `decodeEye(<blob thật>)` khớp plaintext runtime byte-for-byte.
```
node eye.js parse "<blob base64>"    # -> {fmt, eyeVer, ts, uuid, scan:{...}}
```

---

## 7. Hai cặp key/IV & vì sao token Node khác byte native (kiểm chứng 13/11/2026)

Trong SDK có **hai artifact mã hoá khác nhau**, **cùng sơ đồ** `zlib.deflate → AES-128-CBC(PKCS#7) → base64(std)` nhưng **key/IV KHÁC nhau** — không dùng lẫn.

| Artifact | Nội dung | key (hex) | iv (hex) | Verify |
|---|---|---|---|---|
| **eye-blob / `X-SIUA`** | `2.1}}1.9.9\|ts\|uuid}}<11 cờ scan>}}` (~100 B) | `930f8b7614a9446be3b71f55713a8524` | `28f1ebe03ccef9fca8c5c1c041e22278` | [scripts/siua.js](../scripts/siua.js) + [eye.js](../scripts/eye.js): giải **và** tạo lại **bit-identical** token thật |
| **`detect()` 198-trường** | JSON fingerprint thiết bị ~7.4 KB (`android_id`, `drmId`, `baseband`…) | `438e0cbac6835d0b4ec0862ea67d537b` | `cc1c118edefcdbc646f63f58288c2be6` | giải token `LitEye.detect()` thật → đúng JSON 198 trường |

- **Chéo nhau KHÔNG giải được:** key eye-blob/SIUA → giải token detect 198-trường = **bad decrypt**, và ngược lại ⇒ chắc chắn **hai cặp riêng** (đã thử thật cả hai chiều).

### 7.1. Đính chính taxonomy (so với §6.2–6.3)
§6.2–6.3 gọi eye-blob (`2.1}}…`, key `930f8b76`) là "plaintext của `detect()`". Nhưng **runtime** `LitEye.detect(context)` trả **JSON 198 trường** (key `438e0cba`), không phải eye-blob; còn eye-blob dùng **chung format + key với `X-SIUA`**. Hai nguồn **chưa khớp**: phân tích tĩnh `FUN_001adda8` dựng eye-blob, nhưng capture runtime của `detect()` ra 198-trường. ⇒ **Chưa kết luận** method JNI nào phát ra eye-blob vs 198-trường, và body POST `/eye` thực chất là cái nào. Chỉ chắc hai cặp key/iv là riêng biệt (verify ở trên).

### 7.2. Token Node khác byte native nhưng JSON y hệt (detect 198-trường)
Tái tạo token `detect()` bằng Node → token **khác byte** native **dù JSON giải nén trùng từng byte**. Nguyên nhân **chỉ ở tầng nén zlib**, không phải nội dung. Đo thật (mẫu `eye-detect-…143553`, giải bằng key/iv detect ở trên):

| Bước | Native | Node (zlib 1.3.1) |
|---|---|---|
| JSON vào (sau inflate) | 7384 B | trùng từng byte |
| Luồng nén | **3193 B** | 3199 B (level 9) |
| Khác byte đầu tiên | — | **byte thứ 5** (`78 da cd 59` giống, rồi `59` vs `6b`) |
| inflate | JSON gốc | **trùng JSON gốc** |

- Quét **405 tổ hợp** Node (`level 1–9 × strategy × memLevel`) → **không** tổ hợp nào khớp byte luồng nén native. `java.util.zip.Deflater` (bọc libz hệ thống Android) level 7/8/9 thì **khớp** → app nén bằng **zlib của Android**, khác **zlib 1.3.1** nhúng tĩnh trong Node.
- **AES + padding + base64 của Node KHỚP tuyệt đối:** đưa luồng-nén-**native** qua AES Node → ra **đúng từng byte** token native (bit-identical). ⇒ chênh lệch **duy nhất** là zlib.
- **Vì sao server vẫn nhận token Node** (Eye API từng trả `code:0` + `dfpId`): server chỉ **AES-decrypt → inflate → đọc JSON**; `inflate(node) == inflate(native)` byte-exact nên JSON server thấy **y hệt**. zlib cho phép **nhiều cách mã hoá hợp lệ của cùng dữ liệu** ⇒ **token khác byte ≠ dữ liệu đổi**. (Chưa khẳng định mọi endpoint/trường hợp đều xử lý như nhau.)
- **Ngược với SIUA:** input SIUA nhỏ (~100 B) nên Node level 9 **trùng byte** native; input detect lớn (~7.4 KB) thì **không** — khác biệt chỉ lộ ở input lớn (heuristic match-finding của hai bản zlib). Không ảnh hưởng tính đúng: server luôn inflate ra JSON giống nhau.
