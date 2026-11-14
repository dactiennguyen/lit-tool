# 14 — API khi mở app, dữ liệu store và cách gọi

Phạm vi: Litmatch `com.litatom.app` **7.77.0**, tài khoản đã đăng nhập ở
Android **user 10**, ngày 13/11/2026. Khi mở app, Frida được gắn vào tiến trình
trước khi tiếp tục khởi động; cả hook request và hook response sau giải mã báo
sẵn sàng trước các request ghi được. Bộ lọc chỉ ghi `/api/` trên
`www.litatom.com` qua các interceptor OkHttp được hook. Ghi nhận **33 lượt,
30 endpoint khác nhau**, tất cả các response được ghi đều có HTTP 200,
`success=true`, `result=0`. Không suy ra danh sách này là toàn bộ traffic.

## 1. Request được xây như thế nào?

1. Interface Retrofit khai báo method, path và `@Query`, `@Path`, `@Body`;
   Retrofit dựng URL và serialize body. Base mặc định là
   `https://www.litatom.com/` ([`a00/e.java`](../base-decompiled/sources/a00/e.java)).
2. [`a00/l.java`](../base-decompiled/sources/a00/l.java) thêm `sid` từ
   `b0.b()`, `lit-user-id` nếu có, cùng `uuid`, `loc`, `version`, `lang`,
   `platform`, `model`, `loctype`, `os`, `net_type`, `app_source`, `appid`;
   một số giá trị có điều kiện. Đây là tập trường app xây, không đồng nghĩa
   server bắt buộc mọi trường cho từng endpoint.
3. Interceptor Eye thêm thông tin thiết bị tùy cấu hình. Interceptor
   [`c00/a.java`](../base-decompiled/sources/c00/a.java) tính `ts`, `litTime`,
   `litSign`, `sts-sign` nếu có `uuid`, `X-request-Id` và
   `X-Application-Info` từ phần query được `e0.h()` trả về. Điều kiện thêm
   header phụ thuộc cấu hình. Script GET tối giản chỉ tạo `X-Application-Info`
   và `X-request-Id` khi dùng `--shadow` cho `account/account_info`.
4. [`cg0/a.java`](../base-decompiled/sources/cg0/a.java) kiểm tra
   `X-Is-Enc`, đối chiếu request ID và có thể giải mã response body bằng
   `LibGuard.decodeShadowContent(..., 3)` trước khi app đọc JSON. HTTP 200
   chưa đủ chứng minh thành công; cần kiểm tra `success` và `result` sau khi
   giải mã nếu có.

**GET trong danh sách không có request body**: các giá trị là path/query. POST
dùng `@Body` theo bảng bên dưới, trừ `openim_login` không khai báo tham số
body. Một biến cấu hình trong factory có tên `REQ_BODY_ENCRYPT` được gán false,
nhưng điều đó không chứng minh mọi payload trong app luôn là JSON thuần; body
trên wire của sáu POST chưa được ghi trong lượt này.

## 2. Lấy gì từ store?

Login thành công tạo `KeyInfo{session, hxPwd, userId}` và lưu JSON dưới key
`litmatch_key_info` trong `MMKV.defaultMMKV()`; xem
[`b0.java`](../base-decompiled/sources/com/lit/app/model/b0.java),
[`a00/b.java`](../base-decompiled/sources/a00/b.java) và
[`a60/k.java`](../base-decompiled/sources/a60/k.java). `session` trở thành query
`sid`; `userId` dùng cho đường dẫn hồ sơ của chính tài khoản. `hxPwd` là thông
tin IM nhạy cảm, script không sử dụng.

Trong cấu hình máy thử, file tương ứng là
`/data/user/10/com.litatom.app/files/mmkv/mmkv.default`; Android user khác có
đường dẫn riêng. `uuid` trong common query xuất phát từ `device_id` trong
MMKV mặc định; khi key chưa có, app thử lấy Android ID rồi lưu lại, có nhánh
dự phòng khác ([`utils/n.java`](../base-decompiled/sources/com/lit/app/utils/n.java),
[`ll/g.java`](../base-decompiled/sources/ll/g.java)). Script tối giản không đọc
`device_id`. Locale, phiên bản, model, trạng thái mạng, `X-DFPID` và chữ ký
được lấy hoặc tạo bởi các thành phần khác, không suy ra chỉ từ `KeyInfo`.

Giá trị profile (`sid`, `uuid`, `version`…) được lấy một lần từ store rồi đặt
vào `.env` (hoặc file `--profile`); `startup-api.js` chỉ đọc profile đó, không
tự truy cập store qua ADB nữa. Khi lấy `sid`/`uuid` từ MMKV, lưu ý file có thể
chứa nhiều bản ghi; đối chiếu bằng MMKV API của ứng dụng nếu phiên sai.

## 3. 24 GET đã thấy

Tiền tố mọi path trong bảng là `/api/sns/v1/lit/`. Cột tham số liệt kê theo
interface Retrofit; các tham số chung tại §1 được interceptor thêm sau đó.
`—` nghĩa là không thấy tham số riêng trong interface tương ứng, không khẳng
định server không yêu cầu điều kiện khác. Kết quả gọi độc lập bên dưới được
thử ở phiên trước cùng ngày: 20 API thành công với `sid` và các tham số tối
giản; ba API cần query thực tế của app. Các API thành công đều trả HTTP 200,
`success=true`, `result=0`.

| Path | Tham số riêng được khai báo | Nguồn | Thử độc lập |
|---|---|---|---|
| `user/get_info/{userId}` | `userId`, `from`, `source`; biến thể có `is_mini_profile`, `is_zone` | [`va0/a.java`](../base-decompiled/sources/va0/a.java), [`lz/c.java`](../base-decompiled/sources/lz/c.java) | Thành công với query app và ID tài khoản hiện tại; chỉ `sid` trả `-10` |
| `home/settings_v2` | `hash_code` | [`ak/b.java`](../base-decompiled/sources/ak/b.java) | Thành công với query app; `sid` + `hash_code=` trả 500 |
| `feed/tags` | — | [`h90/c.java`](../base-decompiled/sources/h90/c.java) | `sid`; script mới đã thử lại thành công |
| `home/init_resources` | — | [`h90/c.java`](../base-decompiled/sources/h90/c.java) | `sid` |
| `feed/feed_page_structure` | — | [`i90/i.java`](../base-decompiled/sources/i90/i.java) | `sid` |
| `feed/following_feeds` | `start_ts`, `num` | [`h90/c.java`](../base-decompiled/sources/h90/c.java) | `sid` |
| `account/get_subscribe_product_ids` | — | [`z50/a.java`](../base-decompiled/sources/z50/a.java) | `sid` |
| `user/message_notifications_v3` | — | [`e00/a.java`](../base-decompiled/sources/e00/a.java) | `sid` |
| `feed/hq` | `start_pos`, `num`; có tag nội bộ | [`h90/c.java`](../base-decompiled/sources/h90/c.java) | `sid` |
| `feed/get_daily_festival_effects` | — | [`h90/c.java`](../base-decompiled/sources/h90/c.java) | `sid` |
| `home/acted_actions` | — | [`lz/b.java`](../base-decompiled/sources/lz/b.java) | Thành công với query app; chỉ `sid` trả 500 |
| `account/account_info` | — | [`z50/a.java`](../base-decompiled/sources/z50/a.java) | Thành công độc lập với `sid`, `uuid`, `platform`, `version` và `X-Application-Info`; xem [15](15-account-info-header-va-response.md) |
| `meet_bell/status` | — | [`dc0/a.java`](../base-decompiled/sources/dc0/a.java) | `sid` |
| `ad/times_left` | — | [`ba0/b.java`](../base-decompiled/sources/ba0/b.java) | `sid` |
| `user/user_contact_info` | — | [`lz/d.java`](../base-decompiled/sources/lz/d.java) | `sid` |
| `user/get_position_info` | `target_uid` | [`kb0/a.java`](../base-decompiled/sources/kb0/a.java) | `sid` |
| `gift/gifts_v2` | `hash_code`, `classify` | [`uy/a.java`](../base-decompiled/sources/uy/a.java) | `sid`, `hash_code=`, `classify=normal`; script mới đã thử lại thành công |
| `privacy/setting` | — | [`ba0/b.java`](../base-decompiled/sources/ba0/b.java) | `sid` |
| `home/check_version` | `version` | [`lz/b.java`](../base-decompiled/sources/lz/b.java) | `sid` |
| `user/self_in_app_msg` | — | [`notification/inapp/helper/b.java`](../base-decompiled/sources/com/lit/app/notification/inapp/helper/b.java) | `sid` |
| `account/new_diamonds_product` | — | [`z50/a.java`](../base-decompiled/sources/z50/a.java) | `sid` |
| `resources/prefetch` | — | [`vz/b.java`](../base-decompiled/sources/vz/b.java) | `sid` |
| `party/get_direct_enter_party_list` | — | [`ba0/b.java`](../base-decompiled/sources/ba0/b.java) | `sid` |
| `splash/load_resource` | — | [`lz/b.java`](../base-decompiled/sources/lz/b.java) | `sid` |

Đối với `account/account_info`, query app không kèm header trả HTTP 200,
`success=false`, `result=-9`. Sau đó đã xác định được header và giải mã thành
công response độc lập; chi tiết ở [tài liệu 15](15-account-info-header-va-response.md).

## 4. Sáu POST do app gọi

Những trường dưới đây trích từ mã dựng map; chưa ghi body thật trong lượt
quan sát. Tất cả response trong app đều báo thành công, không phát lại POST.

| Path | Body theo mã | Nguồn |
|---|---|---|
| `lbs/report_coordinates` | `{lat, lon, alt}`; nhánh dựa IP có thêm `ip_based`, `wait` | [`v90/r.java`](../base-decompiled/sources/v90/r.java), [`v90/i.java`](../base-decompiled/sources/v90/i.java) |
| `user/firebase_token` | `{token}` | [`lz/d.java`](../base-decompiled/sources/lz/d.java), [`com/google/android/gms/internal/ads/b.java`](../base-decompiled/sources/com/google/android/gms/internal/ads/b.java) |
| `user/firebase_token_uuid` | `{token, uuid}` | [`lz/d.java`](../base-decompiled/sources/lz/d.java), [`a00/a.java`](../base-decompiled/sources/a00/a.java) |
| `user/openim_login` | Interface không khai báo `@Body` | [`q00/c.java`](../base-decompiled/sources/q00/c.java) |
| `lbs/meet_bell/update_location_status` | `{status}`; nhánh được thấy dựng giá trị chuỗi `"1"` hoặc `"2"` | [`dc0/a.java`](../base-decompiled/sources/dc0/a.java), [`ui/me/x.java`](../base-decompiled/sources/com/lit/app/ui/me/x.java) |
| `home/app_pull_region_words` | `{region, keys, last_update_time}` | [`lz/b.java`](../base-decompiled/sources/lz/b.java), [`i18n/a.java`](../base-decompiled/sources/com/lit/app/i18n/a.java) |

## 5. Dùng script Node

Node.js 18+; máy đã đăng nhập. Profile (`LIT_SID`, `LIT_UUID`, `LIT_VERSION`,
`LIT_PLATFORM`, tùy chọn `LIT_USER_ID`) đọc từ `.env` ở gốc repo, hoặc truyền
file JSON bằng `--profile`. Script [`startup-api.js`](../scripts/startup-api.js)
chỉ cho phép 24 path GET trong bảng; mỗi lần chạy chỉ gửi tối đa một request,
không tự retry. Mặc định in preview đã ẩn giá trị; `--send` mới gửi request.

```sh
cd /Volumes/D/TEST/lit
node scripts/startup-api.js --list
node scripts/startup-api.js feed/tags                 # preview, dùng .env
node scripts/startup-api.js feed/tags --send
node scripts/startup-api.js gift/gifts_v2 --send
node scripts/startup-api.js account/account_info --send   # tự thêm X-Application-Info
```

`gift/gifts_v2` mặc định thêm `hash_code=` và `classify=normal`. Những query
khác có thể cung cấp bằng `--query-file /đường/dẫn/riêng.json`: JSON object
chỉ chứa các key được script hỗ trợ, giá trị string/number/boolean. Script tự
thêm `sid` từ đúng user, không nhận `sid` từ file. Không đưa query chứa thông
tin thiết bị hay tài khoản vào Git. Ví dụ không nhạy cảm:

```json
{"hash_code": "", "classify": "normal"}
```

Để giữ response đầy đủ của chính lượt gọi, thêm `--save`; file được tạo mới
trong `.private/` với quyền 0600. Mặc định script chỉ in HTTP status,
`success`, `result`, kích thước và trạng thái parse JSON. Cả response lưu trên
đĩa lẫn `sid` đều có thể chứa dữ liệu riêng tư. Trừ nhánh `--shadow` đã kiểm
chứng cho `account/account_info`, script chưa tự tạo header hoặc giải mã response
và không đảm bảo `sid` đủ cho mọi API. Nếu nhận `-10`, 500, `-9` hoặc response không phải JSON, cần đối chiếu
tham số và response thực tế của app; không coi HTTP 200 là thành công.

Trong các lần theo dõi, tiến trình app có SIGSEGV; log cũng ghi lỗi tương tự
trước khi gắn Frida. Chưa đủ bằng chứng xác định nguyên nhân.

## 6. Hook quan sát request/response (đã kiểm chứng)

Danh sách API ở trên bắt được bằng cách hook 2 interceptor OkHttp (tên class bị
R8 rút gọn, tên field `a/b/c/e` là tên thật trong bytecode của **đúng APK này**):

| Điểm hook | Vai trò |
|---|---|
| [`zq0/a.java`](../base-decompiled/sources/zq0/a.java) `intercept(f0 chain)` | **CallServerInterceptor** — interceptor cuối, ghi request ra socket ⇒ request đã qua toàn bộ chuỗi ký (header đầy đủ), fire đúng 1 lần/request |
| [`cg0/a.java`](../base-decompiled/sources/cg0/a.java) `intercept(f0)` | Giải mã response: đọc `X-Is-Enc` → `LibGuard.decodeShadowContent(x,3)`, đối chiếu `X-request-Id` |

Lấy request từ `chain`:
- `chain` (kiểu runtime [`zq0/e.java`](../base-decompiled/sources/zq0/e.java) = RealInterceptorChain) có field **`e`** (`f82869e`) = Request (`tq0.o0`).
- Request (`tq0.o0`): field **`a`** (`f75602a`) = HttpUrl · **`b`** (`f75603b`) = method · **`c`** = Headers (`tq0.c0`). Headers: `size()`, `d(i)` = tên header thứ i.

Cách gắn (anti-frida chặn frida-CLI attach/spawn thẳng — xem [08 §5](08-liteye-native-returns.md)):
frida-server **17.10.0** (root) + driver frida giữ kết nối thường trực bật **spawn
gating**, mở app `am start --user 10`, attach ngay lúc tiến trình sinh rồi cho
chạy tiếp. Java bridge mặc định lỗi ART trên máy thử ⇒ dùng nhánh **JNI
reflection**. Chạy đoạn hook bằng `frida` CLI thường **không ăn** trên máy này.

Phát hiện header bắt buộc của `account/account_info`: giữ nguyên query, bỏ từng
header — có `X-Application-Info` → `success=true,result=0`; bỏ nó → `result=-9`.
Lấy endpoint này **không cần hook** bằng [`account-info.js`](../scripts/account-info.js)
(§5 / [doc 16](16-nodejs-account-info-khong-adb.md)).

Lượt capture lại ngày 13/11 (hook `libssl.so!SSL_write`): Java bridge **mặc định**
không lên (anti-frida/ART) nên lúc đầu phải hook native; **core API
`www.litatom.com` đi HTTP/2** nên header bị HPACK nén (không đọc thẳng qua
SSL_write). **Sau đó đã hook được tầng Java** bằng bridge vá JNI reflection (frida
17.10) — xem [doc 17](17-hook-java-frida.md); **header request thật + response giải mã**:
[data/api-headers-response.json](data/api-headers-response.json). Host quan sát:
[observed-traffic.md](data/observed-traffic.md).
