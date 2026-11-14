# Bắt và đọc TCP IM bằng TypeScript

## Những phần đã có

| Phần | File | Khả năng |
|---|---|---|
| TCP chủ động | `scripts/src/hyphenate/connection.ts` | Login, followup, gửi thử tùy chọn, đọc ACK; đóng sau tác vụ |
| Protobuf | `scripts/src/hyphenate/fields.ts`, `message.ts` | Đọc/ghi field, dựng TXT, kiểm tra login/send ACK |
| History | `scripts/src/hyphenate/history.ts` | Đọc REST history và giải protobuf `Meta → MessageBody → Content` |
| Workflow cũ | [22](22-nodejs-hyphenate-connect.md), [23](23-full-workflow-gui-tin.md), [24](24-nodejs-conversations.md) | Capture/hook và bằng chứng gửi, lịch sử |
| Capture mới | `scripts/src/cli/tcp-listen.ts` | Gọi tcpdump trên Android qua ADB trong thời gian định trước |
| Decoder mới | `scripts/src/hyphenate/pcap.ts`, `tcp-decode.ts` | Đọc PCAP, ghép TCP, tách frame, phân loại MSync |
| Socket inventory | `scripts/src/hyphenate/sockets.ts` | Tổng hợp snapshot TCP theo UID Android |

Công cụ mới bắt thụ động phiên đang chạy trên điện thoại; không đăng nhập Node,
không gửi tin hay tự sửa `.env`. Đây chưa phải client Node nhận chat liên tục,
tự ACK, heartbeat và reconnect.

## Cách chạy

Cần Node >=22.18, `npm ci` trong `scripts`, ADB được cấp quyền, Android có `su`,
`tcpdump`, `timeout`, `base64`. Xác minh PID/UID và IP IM hiện tại trước khi chạy;
các số dưới đây là phiên đã kiểm tra, không phải mặc định cố định.

```sh
node scripts/tcp-listen.js --device 192.168.2.1:5555 --host 128.1.26.67 --pid 25462 --seconds 900
```

Chờ `capture_ready`, rồi `capture_complete`. CLI tạo thư mục `.private/tcp-.../`:

- `manifest.json`: host, PID, thời gian thực, trạng thái transfer/exit.
- `capture.pcap`: dữ liệu TCP gốc.
- `tcpdump.log`: thống kê packet/drop của tcpdump.
- `sockets.jsonl`: snapshot mỗi 30 giây, lọc theo UID của PID (khi có `--pid`).

Sau khi hoàn tất, thay đường dẫn ví dụ bằng đường dẫn CLI in ra:

```sh
node scripts/tcp-decode.js --file .private/tcp-RUN/capture.pcap --host 128.1.26.67 --sockets .private/tcp-RUN/sockets.jsonl
node scripts/tcp-decode.js --file .private/tcp-RUN/capture.pcap --host 128.1.26.67 --show-content
```

Hoặc dùng `npm run im:listen -- ...` / `npm run im:decode -- ...` trong `scripts`.
Mặc định decoder chỉ in metadata, loại nội dung và ID tin. `--show-content` thêm
người gửi/nhận và text; không dump token, password, login template hoặc attachment key.
Raw PCAP vẫn có thể chứa credential; `.private` được gitignore.

Capture dùng filter `tcp and host IP` trên `any`, **không lọc theo UID trong PCAP**.
Đối chiếu tuple local/remote với `sockets.jsonl` để quy thuộc app; app khác cùng
truy cập IP cũng có thể lọt vào capture. Nếu IM đổi IP, cần capture mới cho IP mới.
`--pid` chỉ phục vụ inventory, không thay đổi filter. Nếu PID mất, snapshot có thể thất bại.
Không kết luận mọi traffic của app đã được bắt.

File được chuyển qua base64 vì `adb shell su` trên máy này có thể biến đổi newline
nếu chuyển nhị phân trực tiếp. Capture dừng bằng timeout; Ctrl-C chỉ dừng tiến trình
ADB cục bộ, remote có thể tiếp tục đến timeout. Khi bị ngắt, kiểm tra file remote
ghi trong manifest. Script giữ file remote để có thể phục hồi.

## Tầng TCP và protobuf

```text
PCAP → Ethernet / Linux SLL / SLL2 / raw IP
     → IPv4/IPv6 TCP → ghép theo tuple + sequence mỗi chiều
     → 4 byte length big endian → protobuf MSync
     → command body → Meta → MessageBody → Content
```

Ghép các phần bị chia packet, loại byte retransmit trùng, ghi nhận byte xung đột,
tách segment khi mất byte. Chỉ hỗ trợ classic PCAP, không PCAPNG; bỏ IP fragment,
không ghép fragment. Giới hạn file 128 MiB, frame 2 MiB. Sequence được so sánh trong
cửa sổ dưới 2 GiB; SYN dùng phân biệt các phiên tái sử dụng tuple. Capture bắt giữa
frame có thể không xác định được ranh giới: báo byte chưa đọc, không dò bừa payload.

`completedAt` là thời điểm capture đã thấy đủ byte của frame theo luồng ghép,
không phải timestamp tạo tin ở server. Khi mất byte, chỉ đọc từng segment còn nguyên.

Mapping đối chiếu capture Android thực tế và định nghĩa protocol trong bản phân phối
[easemob-websdk 5.2.0](https://www.npmjs.com/package/easemob-websdk/v/5.2.0),
`package/index.js` (`MSync`, `CommSyncUL/DL`, `CommUnreadDL`, `Meta`).
Schema Web SDK được dùng làm bằng chứng tham chiếu, không thêm SDK làm dependency.

| Field | Ý nghĩa |
|---|---|
| MSync `8` | command: `0 SYNC`, `1 UNREAD`, `2 NOTICE`, `3 PROVISION`, `4 LOGOUT` |
| MSync `9` | body theo command |
| MSync `4`, `5`, `11` | compression, crypto, encryptType; field 11 **không phải compression** |
| SYNC gửi `9.1` | một Meta được gửi |
| SYNC nhận `9.4` lặp | danh sách Meta nhận được |
| SYNC nhận `9.1.1` | status code |
| SYNC nhận `9.2`, `9.3` | local meta ID và server ID của ACK |
| UNREAD nhận `9.2` lặp | queue và số lượng báo bởi server |
| PROVISION nhận `9.8.1` | login status code |

`Content.type` phân biệt TXT/IMAGE/VIDEO/LOCATION/VOICE/FILE/CMD/CUSTOM/COMBINE.
`MessageBody.type` phân biệt CHAT/GROUPCHAT/CHATROOM/READ_ACK/DELIVER_ACK/RECALL/EDIT…
`uniqueChatMetasSent/Received` đếm ID duy nhất namespace CHAT, **có thể bao gồm receipt**;
xem `messageTypeName` và `contentTypes` để biết có nội dung người dùng hay chỉ điều khiển.
Không cộng ACK TCP hoặc UNREAD vào số tin nhắn. Số unread không bằng số Meta thực nhận.

Decoder hiện đọc các frame protobuf không nén/không mã hóa đã kiểm chứng. Các frame
đánh dấu nén, mã hóa hoặc đàm phán mã hóa được gắn `compressed_unsupported` /
`encrypted_or_negotiated_unsupported`; chưa có bằng chứng/key để giải các dạng đó.
Không hỗ trợ TLS/WebSocket framing. Port 443 chỉ là số cổng, không đủ để xác nhận WSS.

## Đọc kết quả

`summary` có số packet, connection, application frame, loại sự kiện, Chat Meta,
byte thiếu/lỗi. `streams` tách hai chiều; packet không payload vẫn được đếm ở TCP,
nhưng không tạo application frame. `events` chứa dữ liệu đã giải theo thứ tự thời gian.

`socketInventory.maxEstablished` là số socket ESTABLISHED lớn nhất trong các snapshot;
`observedSocketIdentities` gồm cả SYN_SENT/CLOSE_WAIT và không phải số kết nối thành công.
Sampling mỗi 30 giây có thể bỏ sót socket ngắn. State Linux: `01=ESTABLISHED`,
`02=SYN_SENT`, `08=CLOSE_WAIT`. Chỉ thống kê TCP theo UID, không UDP/QUIC, không
phân loại HTTPS hay WebSocket chỉ dựa vào cổng.

Kiểm chứng decoder với capture cũ: một file có 1 TXT gửi/1 send ACK; file khác có
2 login request/response, 3 UNREAD request/response và 3 SYNC request/response.
Không có malformed frame/gap/byte chưa đọc trong hai mẫu. Đây là kiểm thử file cũ,
không phải gửi tin mới trong lần nghe 15 phút.

Kiểm thử tự động: `npm run check` trong `scripts`. Fixture tổng hợp bao phủ
PCAP endian/link type, sequence wrap, out-of-order/retransmit, gap/conflict,
frame chia/gộp, receive Meta, ACK uint64, che credential và unsupported payload.

## Kết quả nghe thật 15 phút, ngày 15/11/2026

- Giờ Việt Nam: **02:55:34.099–03:10:34.110**, đủ 900 giây từ capture-ready.
- Tiến trình `25462`, UID `1010318` (Litmatch user 10).
- Tuple IM: `192.168.2.1:60334 → 128.1.26.67:6717`; khớp socket app trong các snapshot.
- File `.private/tcp-2026-11-14T19-55-33-725Z-4628732e/capture.pcap`, 11.528 byte.
- Báo cáo cùng thư mục: `decoded.json`, `manifest.json`, `tcpdump.log`, `sockets.jsonl`.
- Capture exit `124` do timeout như dự kiến, không bị ngắt, transfer hoàn tất.

| Chỉ số | Gửi | Nhận |
|---|---:|---:|
| Packet TCP | 66 | 62 |
| Packet có payload | 4 | 4 |
| Byte payload TCP | 80 | 160 |
| Frame UNREAD | 2 request | 2 response |
| Frame SYNC | 2 request | 2 response |
| Chat Meta / tin chat | **0** | **0** |

Tổng **1 kết nối IM, 128 packet, 8 application frame**. Không có login mới,
send ACK, FIN/RST trong cửa sổ này. Hai vòng UNREAD/SYNC lúc 02:56:55 và 03:04:49:
UNREAD trả `easemob_chat`, `n=1`, nhưng SYNC trả `status=0`, `isLast=true`, không có
Meta. Vì vậy không diễn giải `n=1` thành một tin chat nhận được.

Decoder báo 0 gap, conflict, malformed frame, truncated record, incomplete/undecoded byte.
Tcpdump báo `128 packets captured`, `130 packets received by filter`, `0 packets dropped by kernel`.
Thống kê phân tích chỉ tính 128 packet có trong PCAP; số filter cao hơn 2 không chứng minh
hai packet đó chứa gì. Không khẳng định capture ghi mọi packet mà filter đã nhận.

31 snapshot TCP của UID app thấy **70 remote endpoint**, **239 socket identity**
(gồm cả các lần SYN_SENT), tối đa **15 ESTABLISHED** trong một snapshot; 47 endpoint
từng được thấy ở trạng thái ESTABLISHED. Đây không phải 239 kết nối đang mở đồng thời.
68 endpoint dùng port 443; còn `128.1.26.67:6717` (ESTABLISHED) và
`114.114.114.114:9377` (chỉ SYN_SENT). Không suy luận tên dịch vụ/WSS từ IP hay port.
Chi tiết từng endpoint có trong `decoded.json → socketInventory.endpoints`.

Không có tin chat mới trong capture này nên khả năng đọc TXT/ACK được đối chứng thêm
bằng capture cũ, còn receive Meta được kiểm thử bằng fixture tổng hợp. Không tuyên bố
đã quan sát tin chat đến trực tiếp trong 15 phút này. Không gửi tin thử để tạo traffic.

Validation cuối: `npm run check` — typecheck thành công, **260 test pass**.
