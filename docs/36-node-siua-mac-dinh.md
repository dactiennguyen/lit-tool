# X-SIUA mặc định trong scripts — 15/11/2026

Các request API Litmatch qua builder dùng chung luôn gắn `X-SIUA`, gồm cả
GET hồ sơ bản thân (`user/get_info/me`) và POST metadata IM. Không cần gọi
settings_v2 hoặc đợi cờ `litEnableSIUA` để gắn header trong Node.

- Không có `profile.siua` / `LIT_SIUA`: gọi hàm dùng chung
  `scripts/src/crypto/siua.ts:siua()` ở mỗi lần build request, tạo timestamp
  hiện tại và UUID ngẫu nhiên mới.
- Có `profile.siua` / `LIT_SIUA`: ưu tiên gửi nguyên token được cấu hình.
  Trường hợp này vẫn dùng lại token, không tự xoay nó.
- CLI `login-google.ts`: `X_SIUA` không còn bắt buộc; vắng/rỗng thì tự sinh.
- CLI `build-login-curl.ts`: thêm header theo thứ tự `--siua`, `X_SIUA`,
  rồi token tự sinh. Token được tạo lúc xuất lệnh curl; chạy lại cùng lệnh
  đã xuất sẽ dùng lại header cũ.

Token tự sinh mặc định vẫn chứa `SCAN_CLEAN` cố định. Đây không phải một
phép scan Android và không đồng nghĩa server sẽ chấp nhận mọi API. Muốn dùng
scan snapshot thực, hàm `siua({scan})` hỗ trợ đầu vào đó; script kiểm chứng
`verify-eye-headers.ts` đã có luồng lấy scan từ capture. Chưa tự nạp capture
vào builder mặc định.

Phạm vi: API Litmatch nói trên. Không thêm header này vào giao thức TCP hoặc
REST riêng của Hyphenate, hay client POST `/eye` riêng (app cũng dùng client
riêng). `scripts/legacy` giữ làm nguồn đối chiếu; wrapper `.js` công khai chạy
CLI TypeScript mới. Không sửa `.env`, account JSON hoặc Rust.

Kiểm tra: `npm run check` qua typecheck và 267 tests. Test bắt request ở
transport giả lập xác nhận GET/self-profile/POST đều có token mặc định mới,
giải được timestamp/UUID/scan; CLI user-me kiểm tra qua HTTP server local;
Google login kiểm tra bằng stub HTTPS, không thực hiện đăng nhập thật.
