# Xác minh header API bằng hook runtime

Ngày 14/11/2026, GMT+7. App `com.litatom.app`, Android user 10, PID 25459. Đây là **quan sát app hiện tại và đối chiếu code**, không sửa header, không replay request hoặc gửi tin. Các module môi trường có sẵn không bị thay đổi; không coi kết quả là hành vi của một thiết bị sạch chưa instrumentation.

## Kết quả chính

Hook chính bắt 10 request ở lớp OkHttp ngay trước khi ghi request ra mạng, gồm 6 GET và 4 POST, tất cả có response HTTP 200. Có 12 điểm hook, không có observation error trong lượt này. Theo trace/thread, giá trị trả về của hàm tạo header khớp header cuối cùng ở cả 10 request:

| Header | Nguồn trong app | Đối chiếu runtime/code Node |
| --- | --- | --- |
| `litSign` | `LibGuard.getSignCode(context, litTime)` trong interceptor `c00.a` | Output native khớp header 10/10; tính lại bằng `litSign` của TypeScript khớp 10/10, cờ nhận được là `1` |
| `litTime` | Code `lx.c.b()`: thời gian máy + offset đồng bộ | Argument truyền vào `getSignCode` bằng header 10/10. Hook getter trực tiếp không thu được giá trị tương ứng; không kết luận offset hiện tại bằng 0 |
| `ts` | Code `lx.c.a()`: giây từ thời gian đồng bộ | Trong 10 mẫu, bằng `floor(litTime/1000)`; được dùng trong input HMAC. Hai getter thời gian là hai lần gọi riêng, không bảo đảm luôn cùng giây ở ranh giới |
| `sts-sign` | `LibGuard.getHMac256SignCode(ts + "_" + uuid)` | Input, output và header khớp 10/10; tính lại bằng TypeScript khớp 10/10 |
| `X-request-Id` | `UUID.randomUUID()` | Output khớp header trong trace 10/10 |
| `X-Application-Info` | `LibGuard.encodeShadowContent(url.h(), 3)` | Input là query **đã giải mã ký tự URL**; output native bằng header 10/10. Node giải được và tái tạo đúng ciphertext+IV 10/10 khi dùng cùng plaintext/IV |
| `X-DFPID` | `EyeConnector.getDfpId()` → `EyeInterceptor` | Output getter bằng header 10/10. Code getter chọn `dfPID` cache hoặc `localDfpToken` fallback; chưa đọc được nhánh cache cụ thể của lượt này |
| `X-SIUA` | `EyeConnector.fetchSIUA()` → `EyeInterceptor` | Output bằng header 10/10; header hiện diện, không phải đang tắt. Node giải được cả 10 mẫu; khối scan không trùng snapshot mặc định |
| `lit-user-id` | Code `a00.l` lấy `androidx.work.z.J()` rồi set header | Có trong 10 request cuối. Nguồn getter được đối chiếu tĩnh, chưa có output getter độc lập từ lần đọc bổ sung |
| `v-mode` | Code `a00.l` kiểm tra trạng thái mạng/VPN | Hook thấy thêm vào builder và có giá trị `0` trong 10 request; Node hiện hardcode `0`, không phải đo runtime |
| `User-Agent` | `androidx.work.z` đọc `System.getProperty("http.agent")`, `cg0.e` thêm vào request | Hook thấy header được thêm; request cuối dùng Dalvik/Android. Không đồng nhất nó với query `model` |
| `traceparent` | Code `hm0.a` tạo chuỗi từ trace/span context | Có trong 10 request cuối; chưa hook riêng hàm tạo trace/span |
| `Content-Type`, `Content-Length`, `Host`, `Connection`, `Accept-Encoding` | HTTP client/body/transport | Có ở request cuối theo loại request; không phải toàn bộ đều là chữ ký ứng dụng |

`sid` và `uuid` nằm trong **query**; không phải `Authorization: Bearer` của Litmatch. Không trộn với API history Hyphenate trong tài liệu 24, vốn dùng user token riêng.

## Những điểm code hiện tại chưa giống app

1. **Plaintext của `X-Application-Info` khác.** [request.ts](../scripts/src/lit/request.ts) dùng `url.search.slice(1)` (URL-encoded), còn app gọi `tq0.e0.h()` dựng query từ danh sách key/value đã decode. Cả 10 mẫu khác nhau ở cách biểu diễn `model` và `appid` (space, `/`, `+`, `=`...). Khi cung cấp cùng các tham số cho builder Node, plaintext/ciphertext không khớp app. Việc một endpoint từng nhận request Node không chứng minh hai dạng tương đương cho tất cả endpoint.
2. **Biểu diễn base64 Shadow khác.** [shadow.ts](../scripts/src/crypto/shadow.ts) dùng base64url bỏ padding; native thay padding bằng dấu `.`. 8/10 mẫu cần padding nên chuỗi không trùng; 2/10 không cần padding. Decode cả hai vẫn cho cùng bytes. Khi tái tạo từ plaintext native, dùng cùng IV và bổ sung dot-padding, chuỗi khớp 10/10. Không nhầm khác biệt biểu diễn này với lỗi AES hoặc với khác biệt plaintext ở mục 1.
3. **SIUA mặc định không phản ánh trạng thái app hiện tại.** [siua.ts](../scripts/src/crypto/siua.ts) dùng khối `SCAN_CLEAN` cố định, trong khi 10 mẫu runtime đều có khối scan khác. Đây không phải bằng chứng biết ý nghĩa mọi cờ, cũng không phải chỉ dẫn thay cờ để vượt kiểm tra.
4. **Không được khẳng định SIUA luôn bit-identical.** Giải mã rồi mã hóa lại cùng plaintext của 10 token: 7 token trùng byte, 3 token không trùng. Với 3 token đó, dữ liệu zlib sau giải AES khác bytes/độ dài nhưng inflate ra cùng plaintext; cả hai có header zlib `78da`. Chưa xác định nguyên nhân khác biệt encoder chỉ từ phép so sánh này. Không thể suy ra server chấp nhận/từ chối một token chỉ từ round-trip.
5. Node dùng `Date.now()`, app có clock offset; `X-DFPID` và `lit-user-id` trong Node phụ thuộc `.env`; User-Agent/trace header mặc định cũng không giống Android. Mẫu đang quan sát có đầy đủ các header này, nhưng **không làm phép bỏ từng header** nên chưa chứng minh cái nào bắt buộc với server.

Không sửa code triển khai trong lượt xác minh này. Repo đang có thay đổi chuyển TypeScript/legacy từ công việc khác; giữ nguyên chúng.

## Request đã quan sát

| Method | Endpoint | Số request | HTTP |
| --- | --- | --- | --- |
| POST | `lbs/meet_bell/update_location_status` | 4 | 200 |
| GET | `home/polling_vids` | 1 | 200 |
| GET | `user/message_notifications_v3` | 2 | 200 |
| GET | `feed/following_feeds` | 1 | 200 |
| GET | `feed/hq` | 1 | 200 |
| GET | `huanxin/set_im_unread_count` | 1 | 200 |

App phát sinh chúng sau khi đánh thức thiết bị và đưa app đang chạy lên trước; đây không phải replay do script tự dựng. Trong đó có POST trạng thái và GET tên `set_*`, nên **không gọi toàn bộ hành vi mạng của app là read-only**. Agent không tự gọi các endpoint này, không bấm gửi chat, không sửa dữ liệu/cache. Hook không ghi body request/response: HTTP 200 không phải bằng chứng `success=true,result=0` của từng response.

## Bằng chứng và giới hạn

- Hook `/tmp/lit-header-confirm-JdYVU4/headers.js`; log thô `run01.jsonl`, quyền `600`; script so sánh `compare.mjs`; kết quả không chứa giá trị credential `comparison.json`. Không đưa log thô vào Git vì có session/query/header riêng tư. Các file `/tmp` có thể bị hệ thống dọn.
- Log chính bắt đầu 11:33:26.530, cửa sổ hook 90 giây, kết thúc `observer_snapshot` rồi detach `application-requested`. Trace theo thread nối interceptor → producer → builder → request cuối (`zq0.a`, trước `requestHeadersStart`/ghi header). Đây là quan sát ở lớp HTTP client, không phải capture TLS độc lập hay log server.
- Đọc bổ sung bằng `state.js` không thành công: process PID 25459 kết thúc lúc 11:36:01.995 với `APP CRASH(NATIVE)`, status 11 theo `dumpsys activity exit-info`. Frida trả `process-terminated` khi load script, không có snapshot state. Chưa có crash stack để kết luận nguyên nhân. Kiểm tra sau đó thấy app chạy PID 7328; không gắn lại hoặc sửa anti-tamper. Kết quả này không phủ định trace hoàn chỉnh trước đó nhưng giới hạn các kết luận về getter/cache/clock bổ sung.
- SHA-256 log chính: `e82c09b87b5c00655d14cfb3c31dfe3897b9508370ec10e9ba5e547496eae1be`.
- Source Node được so tại thời điểm kiểm tra: `request.ts` SHA-256 `c992c15e5a8f4e93d94ec94dd571549ba6d3635768256164b05a82bf0be3a4b8`; `shadow.ts` `7eb54d82aeb21486144375364b48bf1b0846f4f1cf0faecabd73552402190fe3`; `siua.ts` `de62d3804f8cb6ac6877f57717d09bb6074cb544c2700a3b19c954d5974c5614`; `litsign.ts` `321d09fc06ed8acfac6e7df9af79c6a63fd5d8ec13fea72541c213ec50cdaadc`. Thay đổi source sau đó cần so lại.

Nguồn tĩnh: [c00/a.java](../base-decompiled/sources/c00/a.java), [tq0/e0.java](../base-decompiled/sources/tq0/e0.java), [EyeInterceptor.java](../base-decompiled/sources/com/construct/liteye/EyeInterceptor.java), [EyeConnector.java](../base-decompiled/sources/com/construct/liteye/EyeConnector.java), [lx/c.java](../base-decompiled/sources/lx/c.java), [a00/l.java](../base-decompiled/sources/a00/l.java), [cg0/e.java](../base-decompiled/sources/cg0/e.java), [hm0/a.java](../base-decompiled/sources/hm0/a.java). Không suy rộng sang API login, Eye riêng, Hyphenate hoặc mọi endpoint chưa quan sát.
