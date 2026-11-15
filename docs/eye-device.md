# Thử thay trường LitEye.detect

## Sinh dữ liệu theo Hide My Device

Từ thư mục `scripts`, chạy `npm run device:random` để in JSON 18 trường;
`npm run device:random -- --field model` chỉ in bộ `brand`, `manufacturer`,
`model`. Có thể import `randomizeAll()` hoặc `randomizeField()` từ
`scripts/src/cli/device-random.ts`. Script chỉ in stdout, không gọi API,
không đổi điện thoại, `.env` hoặc snapshot Eye. Nếu cần lưu JSON riêng, dùng
`npm run --silent device:random > accounts/device-random.json` với đường dẫn
mới; dấu `>` sẽ ghi đè nếu file đã tồn tại.

Logic đối chiếu APK `io.github.imkamaran.hidemydevice` 1.0.0 đang cài:
`em.a()` random tất cả, `em.c()` random từng trường/nhóm, `em.f()` sinh định
danh, `em.g()` tính Luhn. Nhánh chọn nhà mạng cho số điện thoại được đối
chiếu smali do jadx dựng sai vòng lặp. Dùng `node:crypto` thay Java
`SecureRandom`; cùng quy tắc và tập giá trị, không cùng chuỗi byte ngẫu nhiên.

| Trường | Quy tắc trong APK |
|---|---|
| `brand`, `manufacturer`, `model` | Chọn cùng một hàng trong 11 preset |
| `imei` | `35` + 12 chữ số + 1 chữ số Luhn = 15 chữ số |
| `serial` | 12 ký tự từ `0123456789ABCDEFGHJKLMNPQRSTUVWXYZ` |
| `android_id` | 16 ký tự hex thường |
| `advertising_id` | UUID v4 |
| `media_drm` | 64 ký tự hex thường |
| `wifi_mac`, `bssid`, `bt_mac` | 6 byte ngẫu nhiên, byte đầu AND `0xFC`; Bluetooth viết hoa |
| `ssid` | Chọn một trong 8 tên Wi-Fi + `_` + 4 hex hoa |
| `sim_serial` | `89` + 16 chữ số + Luhn = 19 chữ số |
| `sim_operator`, `sim_operator_name`, `sim_country` | Chọn cùng một hàng trong 11 preset nhà mạng |
| `sub_id` | MCC/MNC 5–6 chữ số + chữ số ngẫu nhiên cho đủ 15 |
| `mobile_no` | `+` + mã gọi quốc gia + số 2–9 + 9 chữ số ngẫu nhiên |

Luhn: từ cuối phần số chưa có checksum, nhân đôi xen kẽ bắt đầu ở chữ số
cuối; kết quả lớn hơn 9 thì trừ 9; checksum bằng `(10 - tổng % 10) % 10`.
Checksum đúng không chứng minh IMEI/ICCID là định danh được cấp thật.

Random từng trường model trả cả bộ ba; từng trường nhà mạng trả cả bộ ba
nhà mạng nhưng không tự đổi IMSI/số điện thoại đã lưu. Khi sinh riêng IMSI
hoặc số điện thoại, truyền `--operator 310260` (chỉ hỗ trợ cho `sub_id` và
`mobile_no`). IMSI giữ mọi MCC/MNC có đúng 5–6 chữ số; số điện thoại cần
khớp một preset để chọn mã gọi quốc gia, nếu không thì chọn preset ngẫu nhiên.
Random toàn bộ chọn nhà mạng trước để IMSI/số điện thoại khớp preset đó.

Trong app, random ở nút ngoài dòng cập nhật cả nhóm; random bên trong hộp
sửa chỉ điền trường đang sửa. `random_each_launch` sinh bộ mới khi hook nạp
vào tiến trình, chỉ áp dụng cho các trường có giá trị đã lưu. Script sinh bộ
mới mỗi lần gọi, không mô phỏng vòng đời tiến trình hay SharedPreferences.

Đây là schema Hide My Device, không phải JSON 198 trường của Eye. APK không
có công thức cho `device`, `product`, `board`, `hardware`, fingerprint hay
toàn bộ 198 trường. Generator không tự điền chúng hoặc bảo đảm server chấp
nhận dữ liệu sinh ra. Chọn ngẫu nhiên có thể trùng mẫu vừa chọn trước đó.

## Thay trường và gửi Eye

Ghép random với DFPID (chạy trong `scripts`):

```sh
npm run dfpid -- --input accounts/dfpid-input.json --output accounts/dfpid-random.json --random
```

`--random` mặc định đọc `scripts/devices_info.json`; dùng `--device <file>`
để chọn mẫu khác. Script gọi `randomizeAll()` đúng một lần, thay các khóa
có sẵn: `brand`, `manufacturer`, `model`, `android_id_secure`, `ad_aaid`,
`serialno`, `bluetooth_address`, `drmId`, `drmId_native`. DRM được đổi từ hex
sang Base64; Android ID/model được đồng bộ vào `query.uuid`/`query.model`.
Các trường còn lại giữ theo mẫu, không thêm khóa từ schema random vào Eye.
Các trường như `android_id_cache`, `uuid` của Eye, `mac_file`, IMEI/SIM chưa
có ánh xạ được xác nhận trong luồng này nên không tự thay.

JSON được nén/mã hóa rồi gửi `/eye`; **DFPID do server cấp**, không được
tính hoàn toàn offline. Output chứa token cùng `query` và `fields` thực tế
đã gửi, quyền `0600`; có thể chứa session từ config. File output phải chưa
tồn tại. Mẫu gốc và `.env` không bị sửa. Muốn dùng lại đúng thiết bị vừa
sinh, bỏ `--random` và dùng output làm input:

```sh
npm run dfpid -- --input accounts/dfpid-random.json --output accounts/dfpid-refreshed.json
```

Không truyền `--random` thì giữ hành vi lấy DFPID từ dữ liệu có sẵn.

## Trong app Tauri

Form thêm/sửa account có **Tạo thiết bị mới** (random từ mẫu 198 trường)
và **Làm mới DFPID** (giữ JSON của thiết bị hiện tại). Rust thực hiện nén,
mã hóa và gọi `/eye` trực tiếp, không cần Node hoặc ADB trên máy chạy app.
Mẫu `scripts/devices_info.json` được nhúng lúc build; sửa mẫu thì cần build lại.

Kết quả là bản nháp tới khi bấm Lưu. JSON, UUID, model, version, DFPID và hạn
dùng được lưu cùng account trong một transaction của `sky.db` (schema v3,
tự nâng cấp từ v1/v2). Hủy hoặc lỗi API không đổi thiết bị đã lưu. Request
Litmatch dùng UUID/model/token của account; đổi UUID sẽ dừng kết nối chat
cũ. Bản này làm mới DFPID bằng nút bấm, chưa tự làm mới khi token hết hạn.

Kiểm tra gọi Eye thực tế bằng Rust (chỉ chạy khi có config được phép sử dụng):

```sh
LIT_DFPID_SMOKE_INPUT=/duong/dan/config.json cargo test --manifest-path apps/src-tauri/Cargo.toml dfpid::tests::live_eye_issues_token_for_rust_payload -- --ignored
```

## Script Eye chi tiết

`scripts/eye-device.js` đọc snapshot JSON `LitEye.detect()` của bản Litmatch
đã khảo sát, sao chép các trường rồi thay các khóa trong file overrides. Tên
khóa phải có trong snapshot và giá trị thay phải cùng kiểu với giá trị gốc;
`_meta` chỉ là metadata của file thu thập và không đưa vào payload. Hàm
`prepareFields`, `encodeDetect` và `decodeDetect` có thể dùng qua `require()`.

Script nén JSON bằng zlib, mã hóa AES-128-CBC rồi gửi Base64 tới endpoint Eye
mặc định `cloud.litatom.com`, dùng query từ config đăng nhập và `cpu_abi` từ
snapshot. Host Eye thực tế của app có thể do cấu hình từ xa quyết định. Dữ
liệu gửi có thể chứa định danh thiết bị; response có thể chứa `dfpId` và được
lưu nguyên vẹn với quyền file 0600. Script không tự đăng nhập Google hoặc thay
cache trong app.

Ví dụ thay một trường `model` trong
[eye-overrides.example.json](data/eye-overrides.example.json):

```sh
node scripts/eye-device.js \
  --snapshot docs/data/device-info-example.json \
  --overrides docs/data/eye-overrides.example.json \
  --config .private/google-login/config-real.json \
  --response-json .private/google-login/eye-response-moi.json
```

File response phải chưa tồn tại. Có thể truyền `{}` làm overrides để đối
chứng. Thay các trường Eye không tự thay query, `X-SIUA` hay các tín hiệu khác;
cần hiểu sự không nhất quán khi diễn giải kết quả.

Snapshot 198 trường được dùng trong lượt thử là thay đổi cục bộ chưa commit
của `docs/data/device-info-example.json`; phiên bản có sẵn trong Git là mẫu
cũ với ít trường hơn. Có thể dùng snapshot thật khác với `--snapshot`.

## Lượt thử ngày 13/11/2026

Snapshot có 198 trường, thu trước đó khi Vector Eye, Hide My Device và Frida
đang hoạt động. Hai lượt dùng cùng snapshot và query: lượt đầu không thay
trường, lượt thứ hai chỉ thay `model` trong Eye thành `Pixel 7`, giữ nguyên
`model` trong query. Cả hai lần gửi Eye trả HTTP 200 và đều có `dfpId`; hai
giá trị `dfpId` khác nhau. Điều này chưa chứng minh server đã dùng riêng trường
`model` khi đánh giá.

Tiếp đó, mỗi `dfpId` được dùng trong một request Google login từ Node, cùng
Google ID token, `X-SIUA` và config. Cả hai trả HTTP 200, `success=false`,
`result=-14`, có `forbidden_session`. Đây là hai lần thử tại một thời điểm,
không xác định nguyên nhân hay thời điểm khóa tài khoản. Toàn bộ response của
lượt này nằm trong `.private/google-login/eye-*-response.json` trên máy thử.

## So sánh nhiều trường ngày 13/11/2026

Dùng cùng snapshot 198 trường nói trên, cùng query, Google ID token và
`X-SIUA`. Mỗi case tạo payload Eye riêng, gọi Eye lấy `dfpId` rồi dùng chính
`dfpId` đó trong một request Google login từ Node. Các giá trị dưới đây là
giá trị thay **trong payload Eye**; các trường khác giữ theo snapshot. Eye trả
HTTP 200, `code=0`, `message="ok"`, có `data.ver`, `data.exp` và `data.dfpId`
ở cả bảy case. `dfpId` là thông tin phiên và được lưu trong file riêng.

| Case | Trường thay | Google login: HTTP, `result` |
|---|---|---|
| Đối chứng | Không thay | 200, -14 |
| ADB | `is_adb_enabled="1"`, `init_svc_adbd="running"` | 200, -14 |
| Dual app | `dual_app="1"` | 200, -1 |
| Nguồn cài | `installed_from_google="0"` | 200, -14 |
| Root / hook | `root="1"`, `is_inline_hooked="1"` | 200, -14 |
| Emulator | `is_emulator="0"` (snapshot ban đầu là `"10"`) | 200, -14 |
| Kết hợp | ADB, dual app, nguồn cài và root / hook như trên | 200, -1 |

Hai lượt lặp xen kẽ đối chứng / `dual_app="1"` tiếp tục trả tương ứng `-14`
và `-1`. Tổng cộng ba lượt cho mỗi cấu hình riêng đó. Các response `-14` có
`success=false`, `forbidden_session`, `unban_diamonds=800` và message thông
báo tài khoản bị cấm đến 20/10/2125 09:38:29. Các response `-1` có
`success=false`, message báo môi trường bất thường kèm mã `1113-...`; không có
`forbidden_session` hay `unban_diamonds` trong các response này. Giá trị 800
chỉ là dữ liệu response; chưa xác minh chính sách mở khóa.

Điều này cho thấy kết quả đi cùng giá trị `dual_app` trong các lượt thử, chưa
chứng minh server sử dụng trường đó trực tiếp hoặc xác định được nguyên nhân
khóa. Mỗi lần gửi Eye tạo `dfpId` mới, thời điểm và chữ ký request thay đổi;
snapshot vốn được thu khi Frida và module Vector hoạt động. Ý nghĩa mã `10`
của `is_emulator` chưa được xác minh. Các response nguyên vẹn cho 11 lượt nằm
ở `.private/google-login/eye-case-responses-full.json`; chúng chứa định danh và
có thể chứa thông tin phiên. Response riêng từng case, overrides và summary
nằm trong hai thư mục `.private/google-login/eye-cases-20261113/` và
`.private/google-login/eye-repeats-20261113/`.
