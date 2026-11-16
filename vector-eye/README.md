# Module Vector thử nghiệm Eye

## Eye: Litmatch user 0

Eye dùng Litmatch và Hide My Device ở Android user 0. Bật hai module trong Vector,
chọn duy nhất `com.litatom.app/0`, cấp quyền root cho Eye rồi mở lại Litmatch.
Bấm **Đọc cấu hình thiết bị** trước khi đổi; nút xóa chỉ xóa dữ liệu Litmatch
user 0 sau khi xác nhận. User 10 có dữ liệu riêng. Khi cấu hình HMD chưa có
Android ID, không thể xoay mà giữ UUID cho tới khi đã tạo ID hợp lệ.

Vector lưu cấu hình HMD user 0 tại `prefs/.../ids.xml`. Eye kiểm tra checksum,
tạo bản sao và khôi phục nếu ghi thất bại; nếu khôi phục thất bại, giữ bản sao
và khóa `/data/local/tmp/eye-device-control-0.lock` để kiểm tra thủ công.
Việc xóa dữ liệu Litmatch thành công không thể hoàn tác bằng bản sao cấu hình.

Bốn hook native inline đã tạm tắt sau khi Litmatch gặp `SIGSEGV/SEGV_ACCERR`
trong EyeConnector. Các hook property/DRM và bridge tài khoản vẫn cần kiểm tra
trên phiên bản app/thiết bị cụ thể; không suy ra server nhận dữ liệu giả.
`eye_library_selftest` xác nhận các điểm inline giữ nguyên mã gốc và thử callback
trên dữ liệu giả; kết quả đó không kiểm tra trampoline hay sửa nguyên nhân crash.

Điều tra Dobby commit `9d271803881f467aabfc24593c7dcaeb710fe861`: trong
`NearMemoryArena.cc`, nhánh tìm vùng nhớ trống cấp `alloc_size` byte cho mẫu,
nhưng trên ARM64 lại tăng độ dài tìm thêm 3 byte trước khi gọi `memmem`. CMake
vá dependency lúc cấu hình để cấp đủ bộ đệm và không thay đổi `alloc_size` qua
các vòng lặp. CMake cũng thêm kiểm tra `mprotect` đầu tiên trong `CodePatch`;
thử với địa chỉ không còn ánh xạ, tiến trình con trả lỗi thay vì `SIGSEGV`.
Cả `DobbyInstrument` và `DobbyHook` đã được vá để báo lỗi nếu bước chuyển trang
mã sang ghi được thất bại; `eye_patch_failure_selftest` ép trường hợp này và
kiểm tra thử lại thành công. Các caller vẫn chưa truyền toàn bộ lỗi tạo
trampoline hoặc khôi phục quyền bộ nhớ. Các lỗi
này là điểm thiếu kiểm tra trong dependency, chưa chứng
minh chúng gây ra trampoline không thực thi được trong tombstone. Bốn hook inline
vẫn phải tắt cho đến khi có bản sửa và kiểm chứng riêng phù hợp.

Trong bản Dobby đã vá, kết quả của lần ghi lệnh gốc được chuyển đến API cài
hook. Mã trả về và việc kiểm tra độ dài lệnh nhảy vẫn không đủ chứng minh
trampoline được tạo, ghi đúng hoặc còn nằm trong vùng có quyền thực thi. Cần
xử lý lỗi xuyên suốt đường tạo trampoline trước khi cân nhắc bật lại hook.

Các phần sau mô tả kết quả lịch sử trên user 10, không phải cấu hình hiện tại.

## Eye 0.2: ứng dụng xem và copy JSON tài khoản

Eye có biểu tượng launcher và màn hình riêng trên **Android user 10**.
Sau khi cài/cập nhật APK, giữ Eye bật cho `com.litatom.app/10` trong Vector,
đóng rồi mở lại Litmatch để nạp module mới.

1. Mở **Eye** ở user 10.
2. Bấm **Mở Litmatch**, chờ tài khoản đăng nhập xong rồi quay lại Eye.
3. Bấm **Lấy tài khoản hiện tại**. Eye hiện nickname và user ID của bản chụp.
4. Bấm **Copy JSON** để sao chép nguyên JSON. **Xem JSON / Ẩn JSON** mở/đóng nội dung.

Việc lấy/copy chạy trên điện thoại, không cần máy tính, ADB hoặc Frida mỗi lần.
Eye không gọi mạng và không đăng nhập tài khoản khác. Module đọc dữ liệu hiện có
trong tiến trình Litmatch. Nếu app đã bị đóng, mở lại Litmatch rồi thử lại.
Eye mở ở user khác sẽ hiển thị hướng dẫn dùng user 10 và không cho lấy dữ liệu.

JSON gồm:

| Nhóm | Nguồn / dữ liệu |
|---|---|
| `account` | MMKV `litmatch_key_info`: userId, session, hxPwd |
| `profile` | Hồ sơ `sp_user_info` của tài khoản; giữ nguyên các field lưu trong app |
| `env` | LIT_USER_ID, LIT_SID, LIT_PLATFORM, LIT_VERSION, LIT_UUID, HX_USERNAME, HX_PASSWORD, HX_APP_KEY khi có |
| `im` | Cấu hình host/port/REST hiện có trong EMOptions và trạng thái loggedIn |
| `missing` | Những field env chưa lấy được; không tự điền giá trị đoán |
| metadata | schemaVersion, capturedAt (Unix milliseconds), androidUser, packageName, source |

`configuredHost` / `configuredRestServer` có thể null, `configuredPort` có thể 0
khi SDK dùng discovery; đây không phải địa chỉ socket đang kết nối. Có thể dùng
`HX_APP_KEY`, `HX_USERNAME`, `HX_PASSWORD` với script Node discovery hiện có.
JSON này không bao gồm Google password/token, HX_LOGIN_TEMPLATE_B64, token IM mới,
lịch sử chat hoặc JSON detect 198 trường thiết bị. Các trường profile thay đổi theo phiên bản app.

Reader kiểm tra session/userId hiện tại khớp MMKV và profile, kiểm tra username IM
nếu SDK có giá trị, rồi đối chiếu session/userId lần nữa trước khi trả dữ liệu.
Nếu không khớp, báo cần chờ/lấy lại; không ghép credential của hai tài khoản.
Đọc thành công không chứng minh session còn được server chấp nhận.

Giao tiếp Eye → module dùng receiver động chỉ nhận sender có permission
`vn.lit.eyemodule.permission.EXPORT_ACCOUNT` cấp theo chữ ký. Phản hồi qua
`ResultReceiver` của yêu cầu, không broadcast credential cho các app khác.
JSON chỉ giữ trong bộ nhớ và clipboard khi người dùng bấm copy; không ghi file/log.
Preview mặc định ẩn, clipboard đánh dấu sensitive, cửa sổ không cho screenshot.

Build (JDK 17, Android SDK/NDK như bên dưới):

```sh
gradle :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk`.
Test: `app/src/androidTest/java/vn/lit/eyemodule/ExportInstrumentation.java`.
Test chỉ in trạng thái, số field và độ dài, không in giá trị xác thực.

```sh
adb shell am instrument --user 10 -w vn.lit.eyemodule.test/vn.lit.eyemodule.ExportInstrumentation
```

Test tự mở Litmatch và chờ module sẵn sàng. Trên MIUI, instrumentation có thể chờ
quyền mở Activity từ nền: mở Eye để test tiếp tục bấm lấy/copy.
Nếu test bị timeout do Litmatch đã đóng, mở Litmatch và chạy lại. APK test chỉ dùng
để kiểm chứng, không cần cài để sử dụng Eye.

Phần native đồng bộ thông tin thiết bị vẫn là mã trước đó. Các giới hạn/crash đã
ghi bên dưới chưa được coi là đã sửa bởi tính năng xuất JSON.

Đã kiểm chứng trên máy ngày 15/11/2026: Eye 0.2 cài cho user 10, icon launcher xuất
hiện; lấy tài khoản May troi thành công, profile 158 field, JSON khoảng 29 KB,
`missing=[]`. Instrumentation kiểm tra fetch, preview toggle, clipboard và đối chiếu
session/userId/HX username/password đều PASS; permission của Eye được cấp và shell
không có permission xuất tài khoản. Thử thủ công sau test: JSON ẩn mặc định, nút
Copy JSON/Xem JSON được bật. Build debug và lint thành công (0 lỗi; còn warning
reflection Android nội bộ, chuỗi giao diện tiếng Việt, ABI/build config).
APK test được gỡ sau kiểm chứng; chỉ app Eye ở lại trên điện thoại.

## Đồng bộ DRM native — 14/11/2026

Trong một lượt quan sát trước thay đổi, `android_id_secure` và
`bluetooth_address` của `detect()` đã khớp API Java và cấu hình Hide My Device
đang ở trong bộ nhớ. `drmId` cũng khớp byte từ Java `MediaDrm`, sau khi chuyển
hex của cấu hình thành Base64. `drmId_native` khác; quan sát runtime xác nhận
nó khớp byte được trả bởi `AMediaDrm_getPropertyByteArray`.

Module bổ sung thay thế JUMP_SLOT tại `libliteye.so + 0x18c460` cho bản arm64
đã khảo sát, sau khi kiểm tra địa chỉ import và thư viện gốc. Với property
`deviceUniqueId`, hook gọi đường Java `MediaDrm` Widevine trong cùng tiến trình
và trả bản sao byte cho lệnh gọi native; các property khác giữ kết quả gốc.
Nếu JVM chưa sẵn sàng, có exception, dữ liệu rỗng/quá dài hoặc không cài được
hook, giữ kết quả gốc. Hook không thay DRM của hệ thống hay phần cứng.

Sau khi cài, hai tiến trình Litmatch liên tiếp đều ghi log đồng bộ; các lượt
gọi `detect()` được giải mã với padding hợp lệ, cả `drmId` và `drmId_native`
khớp byte của API Java và cấu hình đang ở trong bộ nhớ Hide My Device. Android
ID và Bluetooth cũng khớp trong những lượt này. Không thử login; chưa chứng
minh kết quả trong mọi phiên hay khả năng được server chấp nhận.

Một bản thử trước dùng Dobby hook trực tiếp vào thư viện hệ thống báo cài hook
thất bại, sau đó app `SIGSEGV/SEGV_ACCERR`; chưa xác định nguyên nhân crash.
Bản đó đã được khôi phục trước khi thử JUMP_SLOT. Bản APK trước khi thêm DRM
được lưu ở `.private/vector-eye-before-drm.apk`. Module gốc có lịch sử crash;
cách mới chỉ được thử ngắn hạn và vẫn có giới hạn ổn định.

## Đồng bộ model cho `detect()` — 14/11/2026

Module bổ sung hook `__system_property_get` trong tiến trình Litmatch user 10.
Khi caller thuộc `libliteye.so` và đọc `ro.product.model`, hook lấy
`android.os.Build.MODEL` hiện tại và trả giá trị đó. Các property khác và các
caller ngoài thư viện tiếp tục dùng giá trị gốc; system property không bị sửa.
Nếu JVM chưa sẵn sàng, JNI lỗi hoặc chuỗi không vừa bộ đệm property của Android,
hook giữ giá trị gốc. Tại thời điểm kiểm tra này, hook chưa đồng bộ `brand`
và `manufacturer`.

Đã build và cài APK, so SHA-256 của APK trên máy với bản build. Với Eye và
Hide My Device cùng bật, gọi `LitEye.detect()` qua Frida 17.10.0, không login:

| Lượt | `Build.MODEL` | `detect().model` |
|---|---|---|
| Cấu hình ban đầu | `23021RAAEG` | `23021RAAEG` |
| Xoay model, khởi động lại app | `Pixel 6a` | `Pixel 6a` |

Log trong mỗi tiến trình ghi cài hook và đồng bộ model. Ở lượt Pixel, Java báo
brand/manufacturer `google`/`Google`, còn detect báo `Redmi`/`Xiaomi`: không
thể suy ra toàn bộ thông tin thiết bị đã đồng bộ. Một trong các blob detect ở
lượt đầu không có padding AES hợp lệ dù giải không kiểm tra padding và giải nén
được JSON; một lần gọi lại giải mã chuẩn thành công. Chưa xác định nguyên nhân
và chưa chứng minh mọi trường hợp hay mọi phiên bản app hoạt động ổn định.
Module từng gây crash native trước thay đổi này. Bản APK cũ được lưu tại
`.private/vector-eye-installed-before-model.apk`.

Ba lượt gọi bổ sung trong cùng tiến trình Pixel đều giải mã AES có kiểm tra
padding thành công và trả `detect().model = "Pixel 6a"`; tiến trình vẫn chạy.
Các lượt đó chưa giải thích được blob lỗi padding trước đó và không thay thế
việc kiểm tra độ ổn định lâu dài.

## Đồng bộ brand và manufacturer — 14/11/2026

Hook `__system_property_get` cũng trả `Build.BRAND` và `Build.MANUFACTURER`
khi `libliteye.so` đọc tương ứng `ro.product.brand` và
`ro.product.manufacturer`. Giới hạn caller và cách xử lý lỗi giống hook model.
Sau khi cài module và mở lại Litmatch trên user 10, một lần gọi `detect()`
giải mã thành công 198 trường: `model`, `brand`, `manufacturer` lần lượt là
`SM-S918B`, `samsung`, `samsung`, khớp ba trường `Build` trong cùng tiến trình.
Đây là kiểm tra tại thiết bị, chưa xác minh dữ liệu phía server hay độ ổn định
lâu dài; các trường khác không được kết luận là đã đồng bộ.
Bản module trước cập nhật được lưu tại
`.private/vector-eye-before-brand-manufacturer-20261114.apk`.

**Chưa ổn định:** module từng gây `SIGSEGV/SEGV_ACCERR` trong Litmatch trên
user 10. Nguyên nhân gốc chưa được sửa; có thể tắt module trong Vector nếu app
bị văng. Eye và Hide My Device đã được lưu ở trạng thái bật cho Litmatch/user
10; chưa kiểm chứng sau khi khởi động lại thiết bị.

Module Xposed thử nghiệm cho Litmatch 7.77.0, tiến trình chính trên Android
user 10 và `libliteye.so` arm64 đúng bản đã khảo sát. Bốn điểm native chỉ được
gắn khi các byte mã máy khớp mẫu. Sau khi gắn, mỗi điểm chỉ thay giá trị chuỗi
nếu kiểu, độ dài và giá trị gốc khớp; log `VectorEye` báo đã đổi hay bỏ qua.
Chức năng này thay object trong bộ nhớ, không thay cài đặt hệ thống. Không ghi
token hoặc định danh trong log.

Đây là bản thử nghiệm: cần kích hoạt module và chọn phạm vi Litmatch trong
Vector, khởi động lại tiến trình ứng dụng, rồi xác nhận log từng trường và
kiểm tra kết quả thực tế. Chưa khẳng định có tác dụng với phiên bản app khác,
thiết bị khác, hoặc trạng thái khóa tài khoản. Không cần Frida.

Build cần Android SDK, NDK 27.1.12297006, CMake 3.22.1, JDK 17 và Gradle
8.10.2. Chạy `gradle :app:assembleDebug`; CMake tải Dobby tại commit cố định.
Thư mục `stub` chỉ cung cấp khai báo Xposed lúc biên dịch, không đóng gói API.

Ngày 13/11/2026: thử một tiến trình ARM64 độc lập trên thiết bị, không dùng
Frida. Lần đầu trampoline dài ghi đè đích của nhánh `TBZ`, gây SIGILL trong
tiến trình thử. Sau khi bật trampoline gần và kiểm tra chỉ 4 byte đầu bị thay,
lượt thử lại đổi được bốn chuỗi mẫu và giữ nguyên giá trị ngoài dự kiến.
Đây là kiểm tra cơ chế trên dữ liệu giả, chưa chứng minh module được Vector
nạp hoặc Litmatch nhận các giá trị đó. Lệnh cài APK từng thất bại với
`INSTALL_FAILED_VERIFICATION_FAILURE` khi màn hình đang khóa; chưa thử login.

Lượt kiểm tra bổ sung nạp bản `libliteye.so` trích từ APK đang cài trên máy
vào một tiến trình thử riêng. Cả bốn điểm đều gắn trampoline ngắn, callback
thực tế của module đổi đúng bốn object giả, rồi mã máy gốc được khôi phục.
Lượt này không chạy `detect()` của Litmatch và không kiểm tra Vector có nạp
module, nên chưa thay thế lượt thử trong ứng dụng.

## Kết quả trên Litmatch qua Vector

Ngày 13/11, APK được cài cho user 10 và Vector được cấu hình chỉ áp dụng module
cho `com.litatom.app/10`. Để cài từ xa, tạm đặt cờ xác minh cài qua ADB rồi
khôi phục về trạng thái không có giá trị riêng (`null`) ngay sau mỗi lượt cài.
Sau khi sửa cách đóng gói thư viện native và cách đọc con trỏ chuỗi, log của
tiến trình Litmatch ghi `all four native sites instrumented` và `changed` cho
cả bốn trường trong nhiều lượt detect. Không chạy Frida trong lượt này.

Tại thời điểm đó chưa kiểm tra đăng nhập vì màn hình thiết bị đang khóa. Kết quả trên
xác nhận sửa object detect trong tiến trình ứng dụng, chưa xác nhận server
nhận hoặc chấp nhận các giá trị này. Module hiện còn bật trên user 10; có thể
tắt bằng Vector hoặc `vector-cli modules disable vn.lit.eyemodule`.

Sau đó người dùng cho phép mở khóa và thử đăng nhập Google trong cùng tiến trình
Litmatch đã ghi log bốn trường thay đổi. Ứng dụng hiện thông báo tài khoản bị
khóa đến 20/10/2125 09:38:29 và hướng dẫn liên hệ `lit_vn@litatom.com` kèm
BAN_ID trên màn hình. Không quan sát response API trong lượt này nên không kết
luận `success` hoặc DFP server; không xác định nguyên nhân hay thời điểm khóa.
Không dùng Frida. Module tiếp tục bật trên user 10 sau lượt thử.

Lượt thử lại lúc 10:11 ngày 13/11: chỉ bật module Eye trong Vector, khởi động
lại Litmatch và log ghi nhận bốn trường đã đổi. Khi tiếp tục Google sign-in,
tiến trình Litmatch thoát do `SIGSEGV` (`SEGV_ACCERR`) ở luồng EyeConnector;
địa chỉ lỗi nằm trong vùng nhớ ẩn danh. Chưa xác định chính xác nguyên nhân
crash và lượt này không hiển thị kết quả ban hay response API. Đã tắt lại module
Eye sau crash; các module Vector còn lại vẫn tắt. Module cần được sửa và kiểm
chứng ổn định trước khi dùng tiếp.

Lượt điều tra lúc 10:15 cùng ngày: bật lại chỉ module Eye và khởi động mới
Litmatch. Không có tiến trình Frida. Log trong cùng PID ghi nhận cả bốn giá trị
được thay khi khởi động và lần nữa trong lúc đăng nhập. Google sign-in hiện
hộp thoại khóa tài khoản đến 20/10/2125 09:38:29, hướng dẫn liên hệ
`lit_vn@litatom.com` và cung cấp BAN_ID trên máy. Tiến trình vẫn chạy sau lượt
này; không ghi nhận response API nên không kết luận mã `success` hay server
đã xử lý từng trường thế nào.

Phân tích tombstone của crash 10:11: luồng `EyeConnector` gặp `SIGSEGV`, mã
`SEGV_ACCERR`, khi PC trỏ vào vùng nhớ ẩn danh có quyền `---` (không thể thực
thi). Đối chiếu `memory near lr` với mã gốc cho thấy tại điểm hook `dual_app`
`libliteye.so+0xe7e6c`, lệnh `TBZ` đã được thay bằng `0x16000068`. Giải mã
lệnh nhảy ARM64 đó từ địa chỉ trong tombstone cho đích chính là địa chỉ lỗi
trong vùng `---`. Đây là bằng chứng trực tiếp hook đã cài một nhánh tới địa chỉ
không thực thi được trong lượt crash. Chưa xác định bước nào trong Dobby tạo ra
đích sai hoặc vùng đích mất quyền thực thi; đây là lỗi native, không phải thông
báo ban. Lượt 10:15 không tái hiện crash; chưa thể coi module đã ổn định.
Sau lượt 10:15 module Eye được giữ bật; ba module Vector khác vẫn tắt.
