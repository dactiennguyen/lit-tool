# Hàm API có type

`scripts/src/lit/api.ts` cung cấp `getUserMe`, `getUserInfo`, `getOnlineUsers`
và `getAccountInfo`. Các hàm đọc cấu hình `.env` mặc định hoặc nhận `profile`.
Chúng trả `{ summary, body, response }`: `body` giữ tương thích CLI cũ,
`response` là JSON có type.

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
trong URL. Dùng `getUserMe()` để lấy profile bản thân mà không cần biết ID.
Hàm self profile giữ hành vi CLI: chỉ gửi X-SIUA khi có giá trị cấu hình.

`LitApiResponse<T>` phân biệt nhánh thành công (`success: true`, `result: 0`,
`data: T`) với nhánh lỗi (`success: false`, `data?: unknown`). Chỉ truy cập
payload theo type sau khi kiểm tra `response.success`; kiểm tra thêm HTTP qua
`summary` khi quyết định thao tác tiếp theo.

`decodeLitResponse<T>` kiểm tra envelope, không xác thực toàn bộ schema T
ở runtime. Type payload dựa trên các mẫu đã quan sát, không phải hợp đồng server.
`UserInfoMe` mô tả snapshot self đã lưu trong fixture; profile người khác và
Home sử dụng type riêng với các trường bổ sung optional. Giá trị chưa biết
schema vẫn là `unknown`. Trường vắng mặt không được suy thành false.

Profile bản thân có session và credential IM: tránh in toàn bộ response khi
chạy thử. Các test dùng fixture ẩn danh và mock network; CLI hiện có vẫn giữ
cách in body nên cần chú ý nơi lưu output.
