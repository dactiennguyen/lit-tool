# Vì sao SIUA được bật — 15/11/2026

## Kết luận và bằng chứng API

`litEnableSIUA` là cờ cấu hình điều khiển đường tạo/gửi SIUA của app. Code
không hardcode true: default của getter là false. Giá trị hiệu lực được nạp
từ JSON cấu hình server hoặc bản cấu hình đã cache.

Ngày 15/11/2026 lúc 12:32:57 GMT+7, gọi đúng một GET bằng Node với session,
UUID, user ID, model và token đã lưu từ hook trước; không dùng ADB:

`GET /api/sns/v1/lit/home/settings_v2?hash_code=` (kèm common query/chữ ký).

Kết quả HTTP 200, `success=true`, `result=0`, request ID khớp,
`changed=true`, 351 trường cấu hình, có hash_code. Trường liên quan:

```json
{"data":{"litEnableSIUA":"true"}}
```

Đây là trích riêng trường đã nhận, không phải toàn bộ response. Kiểu thực là
**string**, không phải boolean JSON. Android `JSONObject.optBoolean` chuyển
chuỗi "true" (không phân biệt hoa thường) thành true. Đã đối chiếu source SDK
Android 35 local: `org/json/JSONObject.java:439` gọi `JSON.toBoolean`, và
`org/json/JSON.java:30–41` thực hiện chuyển đổi. Không áp dụng quy tắc
`Boolean("false")` của JavaScript cho cấu hình này.

Response thô và metadata được lưu riêng quyền 600:
`.private/siua-feature-flag-20261115/settings-response.json` và `summary.json`.
Không sửa cache điện thoại hoặc `.env`. Request dùng các common query default
của script ngoài identity/model/version; không coi đây là capture request của
app hay bằng chứng giá trị trong RAM điện thoại ở thời điểm kiểm tra.

## Chuỗi code đầy đủ

1. [ak/b.java](../base-decompiled/sources/ak/b.java):18–20 khai báo Retrofit GET
   `api/sns/v1/lit/home/settings_v2`, query riêng `hash_code`.
2. [ak/e.java](../base-decompiled/sources/ak/e.java):35–53 đọc hash từ MMKV,
   dùng client mạng chính của app để fetch config.
3. `ak/e.java:64–92`: khi HTTP thành công, result=0 và changed=true, lấy
   `response.data` rồi gọi `ak.c.h(data)`; lưu JSON và hash vào MMKV.
   changed=false giữ cấu hình cũ; lỗi không tự bật SIUA. Nhánh lỗi có retry
   sau 1 giây khi counter còn dưới 3 (`ak/e.java:29–32`, `ak/d.java:65–66`).
4. [ak/c.java](../base-decompiled/sources/ak/c.java):127–136 thay JSONObject
   dùng chung `f1606a` bằng data mới, không merge từng cờ. Getter boolean
   ở dòng 22–24 → 156–170 dùng `optBoolean(key, default)`.
5. [dt/d.java](../base-decompiled/sources/dt/d.java):401–402:
   `enableSIUA() = ak.c.a("litEnableSIUA", false)`.
6. [EyeConnector.java](../base-decompiled/sources/com/construct/liteye/EyeConnector.java):145–153,
   195–196: nếu có implementation và cờ true thì gọi fetchSIUA; nếu tắt trả
   null. [EyeInterceptor.java](../base-decompiled/sources/com/construct/liteye/EyeInterceptor.java):26–35
   thêm X-SIUA khi getter khác null. DFPID có getter riêng.

Cờ này không đồng nghĩa tắt/bật toàn bộ SDK Eye. Đường init, detect/DFPID
và isEnable có logic riêng. Nó cũng không bảo đảm SIUA luôn tạo thành công:
implementation có thể trả chuỗi rỗng khi init/context/lỗi.

## Cache và thời điểm cập nhật

- MMKV ID: `lit_app_default_kv`.
- JSON cache: `lit_config_mode_save_new`; version hash: `config_hash_code`.
- [ConfigModelInitTask.java](../base-decompiled/sources/com/lit/app/startup/task/ConfigModelInitTask.java):59–74
  nạp JSON cache khi khởi động và gọi ak.c.h. Vì vậy app có thể có cờ true
  ngay trước khi nhận config mới. Thiếu cache hợp lệ thì JSONObject ban đầu
  rỗng và getter trả default false.
- [model/z.java](../base-decompiled/sources/com/lit/app/model/z.java):185–190
  gọi ak.e.b để tải cấu hình. Các caller gồm MainActivity khởi tạo (dòng 176),
  onLogin (612), onLogout (633), luồng đổi/chọn region thành công
  (SelectRegionListActivity:303, ChooseCountryWindow$3$1:41).
- Cache dùng tên chung, không nối user ID trong code lưu/nạp này. Không nên
  suy ra cờ hiện có chỉ thuộc một tài khoản hoặc sẽ tự mất khi logout.
- Tham số `g(true/false)` của ConfigModel không phải giá trị litEnableSIUA:
  nó được chuyển cho callback/event (`com/google/firebase/messaging/t.java:24–36`).
- ConfigModel cũng chạy Firebase Remote Config ở `z.java:197–206`, nhưng
  đường đọc cờ này đi qua JSON settings_v2/cache, không qua getter Firebase.

## Điều đã biết và chưa biết về nguyên nhân

**Đã xác minh:** code app bật nhánh SIUA khi cấu hình hiệu lực có true;
server thực sự trả chuỗi "true" cho request kiểm tra bằng session đã lưu.
Điều này phù hợp với các lượt hook trước thấy X-SIUA.

**Chưa thể xác định:** chính sách backend chọn true dựa trên phiên bản,
người dùng, thiết bị hay áp dụng rộng. Không có thuật toán chọn cờ phía server
trong APK hoặc lý do phân nhóm trong response. Không coi việc bật cờ là bằng
chứng tài khoản bị đánh dấu hoặc điện thoại vừa bị phát hiện root/Frida.

Tìm toàn cây Java đã decompile chỉ thấy tên literal `litEnableSIUA` tại getter
dt/d.java; các writer của JSONObject cấu hình được tìm thấy là loader cache
và callback settings_v2. Đây là phạm vi tìm tĩnh, không chứng minh module
runtime bên ngoài không thể sửa cấu hình. Không cần tự sửa hoặc vô hiệu hóa cờ
để giải thích hành vi. Không có hook/ADB hoặc gửi tin nhắn trong lượt này.
