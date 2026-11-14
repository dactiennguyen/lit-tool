# 16 — Gọi `account/account_info` chỉ bằng Node.js

**Có thể gọi chỉ bằng Node.js sau khi đã có dữ liệu phiên.** Trước đây
[`startup-api.js`](../scripts/startup-api.js) đọc lại MMKV và phiên bản app qua
ADB ở mỗi lượt. ADB phục vụ lấy đầu vào từ điện thoại; request HTTPS, tạo header
và giải mã response đều thực hiện trong Node.js.

## Cần thông tin gì?

| Thông tin | Vai trò trong request | Nguồn ở máy thử |
|---|---|---|
| `sid` | Phiên đăng nhập trong query | `session` của `litmatch_key_info` trong MMKV user 10 |
| `uuid` | Định danh thiết bị trong query | `device_id` trong MMKV của app |
| `version` | Phiên bản app trong query | `versionName` của APK, ví dụ `7.77.0` trên máy thử |
| `platform` | Nền tảng trong query | `android` |

`sid` là thông tin xác thực do server cấp; script không tự sinh một phiên đăng
nhập hợp lệ. Nếu phiên hết hạn hoặc đổi tài khoản, cần cấp/lấy phiên mới.
`uuid` và `version` là giá trị đã sử dụng trong phép thử; kết quả không chứng
minh rằng server chấp nhận mọi giá trị tùy ý. Bốn trường có thể được giữ trong
file `.env` riêng trên máy tính, nên lần gọi sau không cần kết nối điện thoại.

Node tự tạo các thành phần còn lại cho mỗi lượt gọi:

1. Đặt bốn giá trị trên vào query của GET; không có request body.
2. Mã hóa chính query bằng `encodeShadow(..., 3)` trong
   [`shadow.js`](../scripts/shadow.js) thành header `X-Application-Info`.
   Hàm dùng AES-256-CBC và IV ngẫu nhiên.
3. Tạo `X-request-Id` ngẫu nhiên để kiểm tra response. Trong phép thử trước,
   không có header này request vẫn thành công; script dùng nó để đối chiếu.
4. Gửi HTTPS tới `www.litatom.com` bằng `fetch` tích hợp của Node.
5. Giải mã `X-Is-Enc`; nếu cờ là `1`, giải mã body bằng mode 3, kiểm tra
   request ID rồi mới parse JSON.

Đối chiếu thực tế ở [tài liệu 15](15-account-info-header-va-response.md): chỉ
`sid` trả `-9` khi thiếu header; có header nhưng thiếu lần lượt `uuid`,
`platform` hoặc `version` trả `-703`. Tổ hợp bốn trường và header tự tạo đã
thành công. Không cần `litSign` hoặc `sts-sign` **trong lượt thử endpoint này**.

## File `.env`

Script mặc định đọc `.env` ở gốc project. Các biến được sử dụng:

```dotenv
LIT_SID="<session của bạn>"
LIT_UUID="<device_id của bạn>"
LIT_VERSION="7.77.0"
LIT_PLATFORM="android"
```

Xem [`.env.example`](../.env.example) để tạo file của riêng bạn. File `.env`
chứa credential, được Git bỏ qua và nên có quyền `0600`. Biến môi trường đã
đặt trong tiến trình có cùng tên sẽ được ưu tiên hơn giá trị trong file.
Không truyền `sid` qua đối số dòng lệnh hoặc ghi vào log. Nếu gọi
`user/get_info/:id`, cần thêm `LIT_USER_ID` cho ID của chính tài khoản.

## Lấy profile một lần từ điện thoại

Script không còn tự đọc store qua ADB. Lấy `sid`, `uuid`, `version`, `platform`
một lần (ví dụ đọc key `litmatch_key_info` và `device_id` trong MMKV
`/data/user/10/com.litatom.app/files/mmkv/mmkv.default` bằng adb/root, hoặc từ
nguồn khác) rồi điền vào `.env` ở gốc repo:

```sh
# .env (không commit)
LIT_SID=...
LIT_UUID=...
LIT_VERSION=7.77.0
LIT_PLATFORM=android
# tùy chọn, cho endpoint có :id
LIT_USER_ID=...
```

MMKV có thể chứa nhiều bản ghi; nếu phiên sai, đối chiếu bằng MMKV API của đúng
user. Thay cho `.env`, có thể truyền file JSON bằng `--profile`; một mẫu nằm tại
[`account-profile.example.json`](data/account-profile.example.json).

## Gọi không cần ADB

Ngắn nhất — [`account-info.js`](../scripts/account-info.js) đọc `.env`, gửi và
in luôn response đã giải mã (dùng các hàm trong [`common.js`](../scripts/common.js)):

```sh
cd /Volumes/D/TEST/lit
node scripts/account-info.js
```

Hoặc qua `startup-api.js` (có preview, `--save`):

```sh
cd /Volumes/D/TEST/lit

# Xem tên trường mà không gửi request
node scripts/startup-api.js account/account_info

# Gửi một GET, in trạng thái đã giải mã
node scripts/startup-api.js account/account_info --send

# Lưu JSON response đã giải mã vào .private/
node scripts/startup-api.js account/account_info --send --save
```

`account/account_info` tự dùng header `X-Application-Info`; không cần thêm
`--shadow`. `--profile` không thể kết hợp với `--env-file`.
Không có `--send` thì không gửi request; mỗi lần chạy với `--send` gửi tối đa một GET,
không tự retry. Response lưu bằng `--save` có quyền 0600 và có thể chứa dữ liệu
tài khoản; mặc định chỉ in trạng thái, không in body.

Có thể gọi từ một file Node.js khác:

```js
const { getAccountInfo } = require('./scripts/startup-api');

async function main() {
  const { summary, body } = await getAccountInfo();
  console.log(summary);              // trạng thái HTTP và result
  const data = JSON.parse(body);     // response đã giải mã
  // Dùng data trong ứng dụng của bạn.
}

main().catch(console.error);
```

Các hàm đọc cấu hình, tạo query/header, gọi `fetch` và giải mã response dùng
chung nằm ở [`common.js`](../scripts/common.js).

## Kiểm chứng thực tế

Trước khi chuyển cấu hình sang `.env`, ngày 13/11/2026 đã xuất profile của user 10 một lần rồi chạy chế độ `--profile`
với mọi hàm tạo tiến trình con của Node bị chặn. Request `account/account_info`
trả HTTP 200, `success=true`, `result=0`; response được giải mã và request ID
khớp. Đã thử `--save`, thu được JSON thật trong `.private/`. Kết quả này chứng
minh lượt gọi đã thử không khởi chạy ADB; không chứng minh phiên còn hiệu lực
vĩnh viễn hay mọi endpoint đều dùng cùng bộ tham số.
