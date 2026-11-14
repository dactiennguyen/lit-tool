# Listener TCP trực tiếp bằng Node.js / TypeScript

`scripts/tcp-listen.js` tự đăng nhập Hyphenate, giữ kết nối, nhận và giải frame trực tiếp.
Không cần ADB, điện thoại, Frida, tcpdump hay PCAP. Mặc định tự dựng template Node;
không cần lấy `HX_LOGIN_TEMPLATE_B64` từ app.

## Chạy

Node >=22.18, dependency trong `scripts` đã cài bằng `npm ci`:

```sh
node scripts/tcp-listen.js --dry-run
node scripts/tcp-listen.js --seconds 900
node scripts/tcp-listen.js --seconds 900 --show-content
```

Hoặc từ `scripts`: `npm run im:listen -- --seconds 900`.
`--seconds` tính từ `listen_ready` (login + UNREAD đầu thành công), mặc định 900,
giới hạn 1–86400. `--heartbeat-seconds` mặc định 30, giới hạn 5–300.
Ctrl-C đóng socket và in summary `reason=aborted`; hết thời gian là `reason=duration`.
Socket đóng sớm/lỗi thì exit 1, event `listen_failed`, không tự chạy lại.

Input tối thiểu trong `scripts/.env`:

```dotenv
HX_APP_KEY="1102190223222824#lit"
HX_USERNAME="IM_USERNAME_CUA_BAN"
HX_PASSWORD="IM_PASSWORD_CUA_BAN"
```

Có thể dùng `HX_ACCESS_TOKEN` thay password; nếu có cả hai, token được ưu tiên.
Đây là credential IM của tài khoản, không phải email/mật khẩu Google.
`HX_APP_KEY` cũng chấp nhận tên cũ `LITMATCH_HX_APP_KEY` làm fallback.
Không cần `LIT_SID`, `LIT_UUID`, DFPID, SIUA hay JSON thiết bị cho kết nối IM.

Các tùy chọn env:

| Biến | Hành vi |
|---|---|
| `HX_IM_HOST` / `HX_IM_PORT` | Nếu có host, dùng host đó; port mặc định 6717 |
| Không có `HX_IM_HOST` | Gọi discovery, chọn endpoint TCP đầu tiên và port server trả về |
| `HX_REST_BASE` | REST lấy token; ưu tiên override, rồi discovery, rồi fallback hiện có |
| `HX_CLIENT_UUID` | Giữ identity Node giữa các lần chạy; nếu thiếu thì tạo UUID mới |
| `SCRIPTS_ENV_FILE` | Chọn file env khác; environment có độ ưu tiên cao hơn file |

Ví dụ chọn file credential khác:

```sh
SCRIPTS_ENV_FILE=.private/my-account.env node scripts/tcp-listen.js --seconds 900
```

`--dry-run` in cấu hình, không xin token/login. Nếu chưa có host, dry-run vẫn gọi
discovery để xác định endpoint. Không in password/token/login payload.
`--template` mới dùng `HX_LOGIN_TEMPLATE_B64` đã lưu, kèm `HX_IM_HOST`; kiểm tra
username phải khớp template. Mặc định bỏ qua template cũ và tạo mẫu Node v6 mới
theo [luồng bootstrap](28-node-hyphenate-bootstrap.md).

CLI chỉ log JSONL ra stdout, không sửa env, không tự tạo log file. Nếu cần lưu,
chủ động redirect stdout vào file riêng. Đăng nhập là một client thật của tài khoản;
chính sách multi-device của server có thể ảnh hưởng phiên đang mở.

## Luồng nhận

1. Xin user token qua HTTPS khi chưa có token, tạo Node `Provision`, kết nối TCP.
2. Gửi login; chỉ tiếp tục khi `PROVISION.status=0`.
3. Gửi UNREAD; khi `status=0`, bắt đầu đồng hồ nghe và đưa các queue vào hàng chờ.
4. Gửi `CommSyncUL { queue }` cho từng queue. Decode `CommSyncDL.metas` và emit
   `message_received` cho ID chưa gặp trong phiên.
5. Nếu `isLast=false`, gửi `CommSyncUL { queue, key: nextKey }`. Giữ uint64 dạng
   chuỗi, không chuyển sang JS number. Dừng khi server trả `isLast=true`.
6. `NOTICE` thêm queue cần kéo. Nếu NOTICE đến khi đang kéo queue đó, kéo lại một
   vòng sau khi kết thúc, tránh bỏ lỡ tin đến giữa hai response.
7. UNREAD mỗi 30 giây là probe ở tầng ứng dụng; bật thêm TCP keepalive của Node.

Queue nhận diện theo SDK: ưu tiên name, rồi domain/resource, rồi appKey.
Queue không có identity dùng được được log `queue_ignored`; domain-only queue vẫn
được kéo. Bảo toàn nguyên protobuf JID khi gửi, không dựng lại chỉ từ tên queue.

Việc sync/cursor có thể tiêu thụ các bản tin đang chờ giao cho client. Đây không phải
sniffer thụ động. Listener không gửi TXT/CMD/CUSTOM, không gửi receipt “đã đọc”,
không gọi API Litmatch cập nhật conversation. `READ_ACK` thấy trong log là dữ liệu
server gửi về, không phải listener tự đánh dấu đã đọc.

Luồng điều khiển được đối chiếu định nghĩa `encodeHeartbeat`, `encodeBackQueue`,
`encodeLastSession`, `handleSyncQueueState` và `getQueueId` trong gói chính thức
[`easemob-websdk@5.2.0`](https://registry.npmjs.org/easemob-websdk/-/easemob-websdk-5.2.0.tgz).
Runtime không import SDK đó; dùng `node:net`, protobuf và module nội bộ.

## Output

Các event: `listen_config`, `tcp_connected`, `frame_sent`, `frame_received`,
`listen_ready`, `message_received`, `listen_progress`, `listen_complete` hoặc `listen_failed`.

`frame_sent` chỉ gồm login, UNREAD và SYNC; không dump auth. `frame_received` cho biết
command/status, loại message, ID, cursor. `message_received` chỉ xuất một lần cho
mỗi `(namespace,id)` trong phiên; frame log vẫn có thể chứa bản trùng để phục vụ đối chiếu.
Mặc định ẩn text/người gửi/nhận. `--show-content` thêm `from`, `to`, `texts`; hiện chỉ
giải text và metadata loại nội dung, không tải file media, không dump attachment key.

Summary phân biệt:

- `framesSent/Received`, `bytesSent/Received`: frame ứng dụng và byte TCP đọc/ghi.
- `messagesReceived`: Meta duy nhất, gồm message điều khiển/receipt.
- `chatMessagesReceived`: namespace CHAT với body NORMAL/CHAT/GROUPCHAT/CHATROOM.
  CMD cũng có thể nằm trong nhóm này; không đồng nghĩa số tin văn bản từ người dùng.
- `duplicateMessages`: Meta trùng ID bị loại ở event message.
- `chatMessagesSent`: luôn 0 trong listener này.
- `kinds`: số lượng frame theo chiều và loại.

`listen_ready` chỉ chứng minh phiên đã login/UNREAD thành công. Dữ liệu kéo ngay sau
login thường là backlog; không suy ra có người vừa gửi một tin mới. ROSTER/receipt
không được coi là tin văn bản. ACK của server cũng không chứng minh UI bên kia đã hiển thị.

## Code và kiểm thử

- `scripts/src/cli/tcp-listen.ts`: CLI, env, lấy token, xử lý SIGINT/SIGTERM.
- `scripts/src/hyphenate/listen-config.ts`: tạo template Node/chọn host hoặc dùng template có sẵn.
- `scripts/src/hyphenate/listener.ts`: TCP lifecycle, frame buffer, queue/cursor, heartbeat, dedup.
- `scripts/src/hyphenate/msync.ts`: giải MSync frame trực tiếp.
- `scripts/test/listener.test.ts`: TCP server local gửi frame chia/gộp, message/receipt,
  pagination, NOTICE, duplicate, domain-only queue, timeout, lỗi login, logout, abort.

Gọi từ TypeScript khác cũng không cần subprocess:

```ts
import { loadEnv } from '../core/env.ts';
import { loadListenConfig } from '../hyphenate/listen-config.ts';
import { ensureAccessToken } from '../hyphenate/token.ts';
import { listenTcp } from '../hyphenate/listener.ts';

const env = loadEnv();
const { template, restBase } = await loadListenConfig(env);
const accessToken = await ensureAccessToken({ appKey: template.appKey, username: template.username,
  restBase, password: env.HX_PASSWORD, accessToken: env.HX_ACCESS_TOKEN });
const result = await listenTcp({ template, accessToken, durationMs: 900_000,
  onEvent: event => console.log(JSON.stringify(event)) });
console.log(result);
```

Đường dẫn import trong ví dụ tương đối với file đặt dưới `scripts/src/cli/`.

Không tự reconnect hoặc refresh token khi đang nghe. Khi server đóng/kick/từ chối,
listener dừng với summary lỗi để tránh vòng đăng nhập liên tục. Payload mã hóa/nén
chưa hỗ trợ sẽ báo lỗi thay vì tiếp tục ACK một dữ liệu chưa giải được.
Giới hạn: frame 1 MiB, 1000 queue chờ, 100.000 ID dedup, 10.000 trang mỗi lượt kéo.
Response timeout 15 giây; cursor lặp, queue trả sai, frame lỗi đều dừng phiên.
