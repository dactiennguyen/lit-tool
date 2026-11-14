# 15 — `account/account_info`: header, query và response

Kiểm chứng ngày 13/11/2026, Litmatch 7.77.0, Android user 10, phiên tài khoản
đã đăng nhập. Request quan sát từ app là `GET` tới
`https://www.litatom.com/api/sns/v1/lit/account/account_info`; interface
[`z50/a.java`](../base-decompiled/sources/z50/a.java) không khai báo body hay
tham số riêng.

## Kết quả đối chiếu

| Request thử | HTTP | Response sau giải mã nếu có |
|---|---:|---|
| Query đầy đủ của app, không có header app | 200 | `success=false`, `result=-9` |
| Query đầy đủ, chỉ thêm `X-Application-Info` lấy từ app | 200 | `success=true`, `result=0` |
| Query đầy đủ và các header app, chỉ bỏ `X-Application-Info` | 200 | `success=false`, `result=-9` |
| Bốn query `sid`, `uuid`, `platform`, `version`, tự tạo `X-Application-Info` | 200 | `success=true`, `result=0` |
| Bốn query trên nhưng bỏ `sid` và tạo lại header | 200 | `success=false`, `result=-10` |
| Bốn query trên nhưng bỏ lần lượt `uuid`, `platform` hoặc `version`, mỗi lượt tạo lại header | 200 | `success=false`, `result=-703` |

Bỏ riêng từng header còn lại trong bộ header app vẫn thành công trong các lượt
thử; gồm `litSign`, `litTime`, `sts-sign`, `ts`, `lit-user-id`, `X-DFPID`,
`X-SIUA`, `X-request-Id`, `User-Agent`, `traceparent`, `v-mode`. Đây là kết quả
của endpoint, tài khoản và thời điểm đã thử; không khẳng định server luôn bỏ
qua chúng hoặc áp dụng cho endpoint khác. Trong script, `X-request-Id` vẫn được
tạo mới để đối chiếu response.

## Request tự dựng

| Thành phần | Nguồn |
|---|---|
| `sid` | `session` trong `litmatch_key_info`, MMKV của user hiện tại |
| `uuid` | `device_id` trong MMKV mặc định của app |
| `platform` | `android`, theo interceptor app |
| `version` | `versionName` của gói `com.litatom.app` trên máy |
| `X-Application-Info` | `encodeShadow(query, 3)` từ [`shadow.js`](../scripts/shadow.js) |
| `X-request-Id` | UUID mới; dùng để đối chiếu request và response trong script |

Tạo query từ bốn trường trên, URL encode, rồi đưa chính query đó vào hàm
`encodeShadow` mode 3. Script gửi cùng query đó trong URL và giá trị trả về
trong header `X-Application-Info`. Khi giải mã header của app, các cặp key/value
trùng query trên URL; biểu diễn chuỗi URL-encoded có thể khác nhau. Vì vậy
không nên giả định byte của hai cách serialize query luôn giống nhau.

Trong lượt tối giản, không cần thêm `litSign` hay `sts-sign`. Chúng được tạo
bởi [`litsign.js`](../scripts/litsign.js), còn `X-Application-Info` được tạo
bởi `shadow.js`; đây là các header khác nhau.

## Response mã hóa

Khi request thành công, header `X-Is-Enc` của response giải mã mode 3 ra cờ
`1` theo sau là request ID. Khi cờ là `1`, body cũng cần giải mã mode 3 trước
khi parse JSON. Script so sánh request ID và ngừng xử lý nếu không khớp. Đường
đi này được đối chiếu với [`cg0/a.java`](../base-decompiled/sources/cg0/a.java).
Trường hợp server trả lỗi đã thấy cờ `0` và JSON thuần.

Cấu trúc của response đã giải mã ở lượt thử được ghi tại
[`account-info-response.example.json`](data/account-info-response.example.json).
Mọi giá trị trong `data` ở file ví dụ là placeholder, không phản ánh số dư hay
trạng thái tài khoản. Response thật lưu riêng trong `.private/` nếu dùng
`--save`; file này có dữ liệu tài khoản, quyền 0600 và được Git bỏ qua.

## Chạy script

Xem [tài liệu 16](16-nodejs-account-info-khong-adb.md) để lưu profile một lần
vào `.env` và gọi chỉ bằng Node.js. Profile (`LIT_SID`, `LIT_UUID`,
`LIT_VERSION`, `LIT_PLATFORM`) đọc từ `.env`; `account/account_info` tự thêm
`X-Application-Info` nên không cần cờ `--shadow`:

```sh
cd /Volumes/D/TEST/lit

# Xem tên query/header, không gửi request
node scripts/startup-api.js account/account_info

# Gửi một GET, giải mã và chỉ in trạng thái
node scripts/startup-api.js account/account_info --send

# Gửi một GET và lưu JSON response đã giải mã vào .private/
node scripts/startup-api.js account/account_info --send --save
```

Lấy `uuid`/`session` từ MMKV một lần rồi điền `.env`; MMKV có thể có bản ghi
không rõ ràng, kiểm tra lại với MMKV API nếu cấu trúc khác. Không in hoặc đưa `sid`,
`uuid`, header ký, response thật hay file trong `.private/` vào Git/log công khai.
