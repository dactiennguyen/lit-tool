# Thử thay trường LitEye.detect

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
