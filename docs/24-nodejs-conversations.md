# Node.js: danh sách cuộc trò chuyện và lịch sử tin nhắn

File chạy: [scripts/src/cli/conversations.ts](../scripts/src/cli/conversations.ts), Node 22.18+ (chạy thẳng `.ts`). Dùng lại các module trong `scripts/src/` và dependency `protobufjs` có sẵn. Không cần cài SDK Web, ADB, Frida, Python hoặc mở app điện thoại. CLI tự đọc `scripts/.env` nên **không cần** `--env-file` (hoặc dùng `npm run im:history -- <args>`).

## Cách chạy

Từ thư mục gốc project, lấy danh sách conversation:

```sh
node scripts/src/cli/conversations.ts
```

Lấy thêm tin nhắn của một conversation trong danh sách đó:

```sh
node scripts/src/cli/conversations.ts --to IM_ID_NGUOI_NHAN
```

Lấy danh sách và một trang tin của từng conversation, tối đa 20 conversation mặc định:

```sh
node scripts/src/cli/conversations.ts --with-messages
```

Điều chỉnh giới hạn và đọc tiếp bằng cursor:

```sh
node scripts/src/cli/conversations.ts --to IM_ID_NGUOI_NHAN --limit 20 --pages 3
node scripts/src/cli/conversations.ts --to IM_ID_NGUOI_NHAN --cursor CURSOR_TRA_VE
node scripts/src/cli/conversations.ts --with-messages --max-conversations 5
node scripts/src/cli/conversations.ts --dry-run --with-messages
```

- `--limit`: 1–50 tin/trang, mặc định 20. `--pages`: 1–20 trang/conversation, mặc định 1.
- `--max-conversations`: 1–100, mặc định 20; chỉ giới hạn số conversation đọc history trong `--with-messages`, không cắt danh sách conversation trả về.
- `--cursor`: chuỗi ID từ kết quả trước, chỉ dùng với `--to`. Không chuyển ID/cursor 64-bit sang JS Number.
- `--to` và `--with-messages` loại trừ nhau. `--to` phải tồn tại trong danh sách của session Litmatch; không tự tìm người nhận mới.
- `--dry-run`: kiểm tra tham số/cấu hình cơ bản, không gọi mạng; không chứng minh session/token hợp lệ hoặc `--to` tồn tại trên server.
- CLI in một JSON hoàn chỉnh ra stdout; lỗi trả exit 1, không in response lỗi thô. Nếu lỗi giữa nhiều trang/conversation, kết quả đã đọc chưa được in; chạy lại chỉ đọc, không gửi thêm tin.

JSON chứa **nội dung hội thoại riêng tư** và có thể chứa khóa tải attachment trong body protobuf. Không đưa output lên Git hoặc chia sẻ công khai. `rawBase64` là dữ liệu gốc, không phải mã hóa bảo mật. Script không tự tạo file JSON, không tải attachment.

## Cấu hình

Danh sách cần `LIT_SID`, `LIT_UUID`, `LIT_VERSION`, `LIT_PLATFORM` như các script API khác. History cần thêm:

- `HX_PASSWORD` hoặc `HX_ACCESS_TOKEN` (token được ưu tiên).
- `HX_APP_KEY` dạng `org#app` và `HX_USERNAME`; hoặc dùng lại `HX_LOGIN_TEMPLATE_B64` / `HX_IM_HOST` hiện có để đọc app key và username qua helper. Template/host chỉ là fallback cấu hình, **không mở TCP**.
- `HX_REST_BASE` tùy chọn, mặc định `https://a1-sgp-ga.easemob.com`. Chỉ cho HTTPS miền Easemob, cổng 443, không URL credential/redirect.

`LIT_*` và `HX_*` phải thuộc cùng tài khoản. Script kiểm tra user và queue trong response history khớp request; chưa có phép đối chiếu tự động danh tính giữa hai hệ Litmatch/Hyphenate. Không cần và không dùng admin/app token.

Lệnh npm `im:history` (trong `scripts/`: `npm run im:history -- --dry-run`) gọi cùng file TS và cũng tự đọc `scripts/.env`. Không ghi đè `.env` hiện tại bằng file mẫu.

## Hai API khác nhau

| Chức năng | Request | Credential |
| --- | --- | --- |
| Danh sách Litmatch | GET `https://www.litatom.com/api/sns/v1/lit/user/conversations` | Session và header ký qua `scripts/src/lit/request.ts` |
| Lịch sử Hyphenate | POST `https://a1-sgp-ga.easemob.com/{org}/{app}/users/{username}/messageroaming` | `Authorization: Bearer <user token>` |

`messageroaming` dùng POST để **truy vấn**, không phải gửi chat. Body cho tin một-một:

```json
{
  "queue": "IM_ID_NGUOI_NHAN@easemob.com",
  "start": -1,
  "pull_number": 20,
  "is_positive": false,
  "msgType": "",
  "end": -1,
  "startTime": null,
  "endTime": null,
  "userId": null
}
```

Nhóm (`conversation_type=1`) dùng hậu tố `@conference.easemob.com`; một-một là type 0. Các type khác dừng với lỗi. Nhánh group được kiểm tra bằng mock/schema, chưa test live.

Response history có `data.msgs[].msg` là protobuf `Meta` dạng base64; `Meta.payload` chứa `MessageBody` khi namespace là CHAT. Script giải mã ID, người gửi/nhận, timestamp, loại tin, contents và attributes; giữ `rawBase64` để không làm mất field chưa hỗ trợ. Attributes giữ dạng mảng KeyValue có type, không tự biến mọi giá trị thành chuỗi hay giả định JSON. Content type: 0 text, 1 image, 2 video, 3 location, 4 voice, 5 file, 6 command, 7 custom, 8 combine. Không dựng lại đầy đủ model/UI SDK.

Output `history[]` có `conversationId`, `conversationType`, `pagesFetched`, `cursor`, `isLast`, `messages`. Nếu `isLast=false`, còn dữ liệu; dùng cursor để đọc tiếp. Cursor cuối có thể là chuỗi `"undefined"` từ server khi `is_last=true`; script chuẩn hóa thành `null`. Dừng nếu cursor thiếu/sai/lặp; loại trùng tin theo ID giữa các trang. Không sắp xếp lại thứ tự server.

Mỗi request giới hạn 12 giây và response 2 MiB. Không retry tự động, không gửi tin/ACK đã đọc, không POST metadata conversation, không cập nhật/xóa cache điện thoại, không đăng nhập socket. Việc tìm thấy tin trong history **không tự chứng minh thiết bị người nhận nhận/đọc**.

## Nguồn và kiểm chứng

- Khai báo endpoint Litmatch: [im/sdk/f.java](../base-decompiled/sources/com/lit/app/im/sdk/f.java); response: [ConversationList.java](../base-decompiled/sources/com/lit/app/bean/response/ConversationList.java).
- [Tài liệu chính thức về history](https://doc.easemob.com/document/web/message_retrieve.html) và [API SDK 4.x](https://doc.easemob.com/apidoc/web/modules/Contact.html). Đây là tài liệu phương thức SDK; đường HTTP cụ thể bên trên được đối chiếu từ gói `easemob-websdk@4.24.1` và test thật, không coi là hợp đồng REST công khai ổn định.
- Gói npm: `contact/contact.js`, hàm `Q` (`getHistoryMessages`), xây POST `messageroaming`; schema `Meta` / `MessageBody` / `Content` / `KeyValue` / `JID` trong `Easemob-chat.js`. Chỉ đọc gói, không chạy bootstrap hoặc thêm nó làm dependency. REA Evidence của phân tích chọn riêng module contact: `ev_999a2723f396bf5da8dca1b867eadbe13693184de5a9e86dc422d4db4a3bc786`; graph có coverage partial, không phải bằng chứng runtime.
- Test thật 14/11/2026: GET Litmatch HTTP 200, `success=true,result=0`, trả 4 conversations. CLI `--to love147707828357186 --limit 1 --pages 5` đọc 3 trang, 3 tin, `isLast=true,cursor=null`. ID `1619473608067779152` và nội dung khớp tin Node đã gửi trước đó; hai ID còn lại `1619470936963025480` và `1619467109815818896`. Không gửi thêm tin để test.
- CLI `--with-messages --limit 20 --max-conversations 4` cũng đã chạy thật: đọc cả 4 conversation, lần lượt 3/4/5/2 tin (tổng 14), đều `isLast=true`, không bỏ qua conversation nào trong danh sách trả về.
- Test offline: fixture protobuf thực, ID uint64 chính xác, phân trang/giới hạn/cursor lặp, response sai user/queue, HTTP lỗi/JSON lỗi/response lớn, không retry, giữ kín credential, giải mã response Litmatch, CLI list không cần HX, history một/nhiều conversation và dry-run không network. Tests và output thật private ở `/tmp/lit-history-sdk-7TZFK7`; không phải dependency chạy và có thể bị hệ thống dọn.

Giới hạn: danh sách nguồn là Litmatch, không phải phép liệt kê toàn bộ conversation của Hyphenate. Lịch sử phụ thuộc quyền và thời gian lưu của server. Không khẳng định có thể khôi phục tin đã bị xóa/hết hạn, hoặc thấy trạng thái nhận/đọc chỉ vì tải được nội dung.
