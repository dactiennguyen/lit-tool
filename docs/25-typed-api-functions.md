# Hàm API có type

`scripts/src/lit/api.ts` cung cấp `getUserMe`, `getUserInfo`, `getOnlineUsers`
và `getAccountInfo`. Các hàm đọc cấu hình `.env` mặc định hoặc nhận `profile`.
Chúng trả `{ summary, body, response }`: `body` giữ tương thích CLI cũ,
`response` là JSON có type.

Các CLI tiếp tục dùng `fetchGet` cũ để giữ nguyên cách in lỗi. Request của
`user-me`/`user-info` được dựng bằng cùng hàm với API typed
(`buildUserMeRequest`, `buildUserInfoRequest` trong `request.ts`), nên quy tắc
header chỉ nằm một chỗ. Lớp API typed có kiểm tra envelope nghiêm ngặt hơn:
HTML, JSON thiếu data khi success, hoặc status không nhất quán sẽ báo lỗi.
Việc này không thay đổi output của các CLI.

Mọi hàm đều `async`: tham số sai, thiếu profile `.env` hay lỗi mạng đều trả về
promise bị reject, không ném lỗi đồng bộ. Giới hạn đầu vào khớp backend Rust:
`targetId` tối đa 128 ký tự (`isId`), `num` 1–50, `start_pos` 0–10 000.

```ts
import { getUserMe, getOnlineUsers } from '../scripts/src/lit/api.ts';

const { response } = await getUserMe();
if (response.success) {
  const userId: string = response.data.user_id;
}

const page = await getOnlineUsers({ query: { num: 15, start_pos: 0 } });
if (page.response.success) {
  const users = page.response.data.user_infos;
  const cursor = page.response.data.next_start;
}
```

`getUserInfo(targetId)` tách ID người xem trong header khỏi ID người được xem
trong URL. Giữ quy tắc cũ: không gửi `lit-user-id` khi ID người xem bằng target.
`getUserInfo('me')` giữ query/SIUA của user-info cũ; `getUserMe()` và CLI
`user-me` có query `from=me&source=me` riêng.
Hàm self profile giữ hành vi CLI: chỉ gửi X-SIUA khi có giá trị cấu hình.

`LitApiResponse<T>` phân biệt nhánh thành công (`success: true`, `result: 0`,
`data: T`) với nhánh lỗi (`success: false`, `data?: unknown`). Chỉ truy cập
payload theo type sau khi kiểm tra `response.success`.

Nhánh thành công dùng cùng quy tắc `isLitAccepted` với phần còn lại của client
và backend Rust: HTTP 2xx, `success: true`, `result: 0`. Response non-2xx mà
body báo success sẽ báo lỗi thay vì trả về như thành công. Response từ chối
(`success: false`) luôn trả về dạng `LitFailure` để giữ mã `result`, kể cả khi
HTTP non-2xx; `message` và `trace_id` có thể là `null`.

`decodeLitResponse<T>` kiểm tra envelope, không xác thực toàn bộ schema T
ở runtime. Type payload dựa trên các mẫu đã quan sát, không phải hợp đồng server.
`UserInfoMe` mô tả snapshot self đã lưu trong fixture; profile người khác và
Home sử dụng type riêng với các trường bổ sung optional. Giá trị chưa biết
schema vẫn là `unknown`. Trường vắng mặt không được suy thành false.

Profile bản thân có session và credential IM: tránh in toàn bộ response khi
chạy thử. Các test dùng fixture ẩn danh và mock network; CLI hiện có vẫn giữ
cách in body nên cần chú ý nơi lưu output.
