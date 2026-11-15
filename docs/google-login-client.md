# Client Google login thử nghiệm

`scripts/login-google.js` tạo request theo luồng Litmatch 7.77.0 đã phân tích:
body là JSON chứa Google ID token được mã hóa mode 3, còn
`X-Application-Info` chứa query đã mã hóa. Các chữ ký và hàm mã hóa dùng lại
những script trong repo. Một lượt Node.js đã gửi được request đến server và
nhận lỗi môi trường; chưa xác nhận đăng nhập thành công. Các giá trị Eye còn
hạn và giờ đồng bộ có thể cần thiết.

Các JSON trong `docs/data`:

- [Cấu hình request](data/google-login-request.example.json) và
  [response báo môi trường](data/google-login-response-environment.example.json)
  chứa dữ liệu thật của lượt thử ngày 13/11/2026.
- [Request đầy đủ](data/google-login-request.actual.json) chứa URL, header và
  body đã giải mã, bao gồm Google ID token thật và thông tin thiết bị. File này
  được Git bỏ qua; cân nhắc kỹ trước khi chia sẻ.
- [Response báo khóa tài khoản](data/google-login-response-ban.example.json):
  message rút gọn, `forbidden_session` được che. Response môi trường là dữ liệu
  Node đã xử lý, còn response khóa là dữ liệu app đã xử lý; cả hai không nhất
  thiết là body thô trên mạng.

Cần Node.js 22.18 trở lên và cài dependency trong `scripts` bằng `npm install`.
Sao chép cấu hình đến một file riêng ngoài Git và cập nhật theo phiên thực tế,
rồi cung cấp `GOOGLE_ID_TOKEN`, `X_DFPID` bằng biến môi trường.
`X_SIUA` là tùy chọn: nếu không có hoặc rỗng, script gọi hàm `siua()` dùng
chung để tạo token mới và gắn header. Token mặc định chứa timestamp hiện tại,
UUID ngẫu nhiên và `SCAN_CLEAN` cố định, không phải scan thiết bị thực.
Nếu cung cấp `X_SIUA`, script gửi nguyên giá trị đó. Các giá trị này là
thông tin nhạy cảm và có trong request đầy đủ đã
lưu. Sau đó chạy:

```sh
node scripts/login-google.js --config /duong-dan/cau-hinh-rieng.json
```

Thêm `--response-json /duong-dan/file-moi.json` để lưu nguyên response JSON
đã giải mã và header, không che dữ liệu, với quyền file 0600. File phải chưa
tồn tại. File có thể rỗng nếu kết nối hoặc giải mã lỗi. Lưu ở nơi riêng tư vì
response thành công có thể chứa session.

`clockOffsetMs` là chênh lệch so với giờ máy, mặc định 0; app dùng giờ đã đồng
bộ server. `litSignFlag` mặc định `1` và cần phù hợp với trạng thái app thực.
Có thể thêm `userAgent` vào config khi biết giá trị của app. Script không sinh
`X-DFPID`, không tự lấy Google ID token; trên terminal nó chỉ in
một số trường kết quả. HTTP 200 không đồng nghĩa đăng nhập
thành công. Tài liệu chi tiết về hai response nằm ở
[13-google-login-hai-truong-hop.md](13-google-login-hai-truong-hop.md).

## Đối chiếu ngày 13/11/2026

Trên user 10, đã chặn request của app tại interceptor ngay trước khi gửi và
lưu request, header cùng body thật vào `.private/google-login/` (được Git bỏ
qua). Body giải mã chứa Google ID token do app vừa lấy; hai lần gửi đến Litmatch
đều do Node.js thực hiện. Lần đầu dựng lại các chữ ký và mã hóa từ request
app; lần thứ hai dùng chính `scripts/login-google.js`. Cả hai trả HTTP 200,
`success=false`, `result=-1`, thông báo môi trường mã 1113. Hai response có
cùng các trường và nội dung thông báo giống nhau sau phần mã 1113; định danh
sau 1113 khác nhau. Lượt app đã chặn không có response để so sánh trực tiếp;
kết quả cùng loại với lượt app trước đó trong tài liệu 13.

Đối chiếu request cho thấy `litSign` và `sts-sign` tính lại khớp app; query
đưa vào `X-Application-Info` là query đã giải mã ký tự, còn URL chứa ký tự
được percent-encode. `fingerprint` dùng Base64 URL-safe có padding. Client đã
được sửa theo dữ liệu của lượt này; chưa khẳng định khớp mọi giá trị query hay
môi trường khác. Các file riêng gồm request đã giải mã, token, config và hai
response thật; token có thời hạn và các file chứa thông tin đăng nhập.

`scripts/build_login_curl.js` là công cụ cũ, dùng body và query khác với request
Google đã quan sát ngày 13/11; không coi output của nó là request đã xác nhận.

Thử thay trường Eye và gửi tới endpoint Eye: xem [eye-device.md](eye-device.md).
