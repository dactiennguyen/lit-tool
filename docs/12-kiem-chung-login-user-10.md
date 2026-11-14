# Kiểm chứng Eye và đăng nhập trên user 10

## Thu dữ liệu thực tế ngày 13/11/2026

Ở user 10, khi Vector Eye và Hide My Device bật và Frida đang gắn, gọi trực
tiếp `LitEye.detect(ctx)`. Payload thu được giải bằng AES-128-CBC với key
`438e0cbac6835d0b4ec0862ea67d537b`, IV
`cc1c118edefcdbc646f63f58288c2be6` rồi giải nén zlib cho JSON 198 trường.
Một lời gọi `LitEye.dfpToken(ctx)` riêng không giải được bằng cùng key/IV
(`BadPadding`), nên chưa xác nhận định dạng hoặc các trường của hàm đó.

Dữ liệu thực tế chứa định danh cá nhân, commit nguyên văn trong
`docs/data/device-info-example.json` theo chủ ý chủ repo (máy riêng, repo chưa
có remote). Snapshot là giá trị do app trả khi các module và Frida đang hoạt
động, không đại diện cho thiết bị chưa can thiệp. Cách thu: attach Frida gọi
`LitEye.detect()` (xem các script Frida trong `scripts/`); không gửi login. Sau
lượt thu, Frida server và ADB forward riêng của lượt này đã dừng.

## Rà soát snapshot 198 trường

Đối chiếu snapshot `detect()` thu lúc 10:58:23 ngày 13/11/2026 (UTC+7) với
thiết bị ở lần kiểm tra sau. Snapshot được lấy trong PID 32728, user 10, khi
Eye và Hide My Device bật và Frida đang gắn; không phải mẫu gốc không can thiệp.
Các điểm cần lưu ý:

| Trường | Quan sát | Giới hạn |
|---|---|---|
| `uid`, `uid_cgroup`, `cgroup` | UID `1010318` và đường cgroup có `uid_1010318`: phù hợp Android user 10. | Không chứng minh user 10 gây từ chối đăng nhập. |
| `dual_app` | `"0"`, trong khi UID vẫn thuộc user 10. | Log Eye trước đó cho biết module đổi trường này từ `"1"` sang `"0"`; một cờ không xóa các dấu hiệu profile khác. |
| `is_adb_enabled`, `init_svc_adbd` | Snapshot `"0"`, `"stopped"`; thiết bị lúc đối chiếu báo `adb_enabled=1`, `init.svc.adbd=running`. | Log Eye từng ghi thay hai trường. Trạng thái hệ thống lấy sau snapshot, không chứng minh server dùng hay đối chiếu chúng. |
| `installed_from_google` | Snapshot `"1"`; Package Manager lúc đối chiếu báo installer `null`. | Module Eye từng ghi thay trường; `null` không chứng minh cách thức cài ban đầu. |
| `magisk_frida` | `quantity:20|RWX:8` trong snapshot. | Tên và định dạng gợi ý thống kê memory; chưa xác minh chính xác cách tính. Frida đang gắn, Vector cũng được nạp. Đo `/proc/32728/maps` sau khi gỡ Frida có 23 vùng quyền `rwx`, là phép đo khác thời điểm/tiêu chí, không so sánh trực tiếp. |
| `is_emulator`, `emu_files` | `"10"`; liệt kê `/sys/bus/virtio` và `/dev/usb_accessory`, cả hai tồn tại ở thời điểm kiểm tra. | Chưa xác minh mã `10`; hai đường dẫn có thể tồn tại trên máy thật và không đủ kết luận giả lập. |
| `sus`, `suc`, `psuc` | Cả ba là `"adb"`. | Ý nghĩa cụ thể chưa trace, không khẳng định server dùng hoặc đây là kết quả lệnh su. |
| `root`, `frida`, `is_inline_hooked`, `pmsHook` | Lần lượt `"0"`, `"none"`, `"0"`, `"none"` dù môi trường lúc thu có root, Vector và Frida. | Giá trị âm tính ở các trường này không chứng minh không có root/hook. |
| `seccomp_status`, `seccomp_prctl` | Cả hai `"0"`; `/proc/32728/status` về sau báo `Seccomp: 2`. | Ý nghĩa và cách tính của hai trường chưa xác minh; khác thời điểm đo. |
| `eye_file`, `eye_mem` | `"error_path"`, `"error_addr"`. | Chỉ là chuỗi lỗi ghi nhận; chưa biết có ảnh hưởng login hay không. |

Các giá trị `boot_state=green`, `flash_locked=1`, `device_state=locked` và
`verity_mode=enforcing` khớp system properties được đọc sau đó; đây chỉ là các
giá trị OS báo, không thay thế kiểm tra attestation. `v2s_verify=1` và hai
chuỗi digest v2 trong snapshot bằng nhau, chưa xác thực độc lập chữ ký APK.
Ảnh chụp chứa 45 chuỗi rỗng, 9 chuỗi `none` và 7 chuỗi lỗi/quyền như
`no_permission`; các giá trị này có thể là bình thường theo quyền hoặc phiên
bản và không tự chứng minh bất thường. Không ghi các định danh vào tài liệu.

Không có dữ liệu server xác lập trường nào gây lỗi môi trường. Các lượt login
gần nhất với hai module bật đã hiện thông báo khóa tài khoản, không chứng minh
lỗi môi trường không thể xuất hiện ở lượt khác.

Ngày 13/11/2026, trên Litmatch 7.77.0 ở Android user 10, một lượt thử dùng
Frida sửa đồng thời các giá trị trong object do `LitEye.detect()` tạo:

| Trường | Giá trị gốc | Giá trị thử |
|---|---|---|
| `dual_app` | `"1"` | `"0"` |
| `installed_from_google` | `"0"` | `"1"` |
| `init_svc_adbd` | `"running"` | `"stopped"` |
| `is_adb_enabled` | `"1"` | `"0"` |

Đây là thay đổi trong bộ nhớ của ứng dụng, không thay cài đặt ADB hoặc nguồn
cài đặt thực tế. Gọi `EyeConnector.fetchEyeToken()` để làm mới DFP: callback
đầu nhận response rỗng; lần thử lại tự động có response và `dfPID` trong
cache thay đổi. Trong khi hook còn hoạt động, Google login trả HTTP 200,
**`success=true`, `result=0` và có session**. Không lưu giá trị session.

Trước đó, lượt chỉ thay `is_adb_enabled` và làm mới DFP vẫn trả `result=-1`.
Vì lượt thành công thay bốn trường cùng lúc và làm mới DFP, chưa thể xác định
trường nào tạo khác biệt hoặc server xử lý chúng thế nào. Việc quan sát 198
tên khóa ứng viên trong một lượt `detect()` cũng không chứng minh có 198
trường cấp cao nhất trong mọi lần chạy.

Sau khi dừng hook và Frida server, lần đăng nhập lại hiện thông báo tài khoản
bị khóa đến **20/10/2125 09:38:29**, hướng dẫn liên hệ `lit_vn@litatom.com`
với BAN_ID hiển thị trên máy. Phản hồi API thành công chưa chứng minh vào được
màn hình chính. Chưa biết thời điểm hay nguyên nhân khóa; các lượt thử có thể
đã góp phần hoặc chỉ làm hiện tình trạng có sẵn. DFP mới có thể còn trong cache.

## Vector

[Vector](https://github.com/JingMatrix/Vector) là framework hook ART/Xposed;
cần module phù hợp để thay đổi hành vi ứng dụng. Trên máy từng ghi nhận mount
`zygisk_vector`, nhưng chưa xác nhận module nào tác động đến Litmatch ở user
10. Lượt thử trên dùng Frida can thiệp object native, chưa kiểm chứng bằng
Vector. Cần xác định cách đọc từng trường; nếu đọc trực tiếp từ native thì
hook Java thông thường có thể không đủ. Chưa có bằng chứng việc thay các
trường này giải quyết trạng thái khóa tài khoản.

## Đăng nhập khi tắt các module Vector — 13/11

Trên user 10, tắt cả bốn module Xposed đang bật trong Vector, gồm module thử
Eye và HideMyDevice; dừng hẳn rồi mở lại Litmatch. Không thấy tiến trình Frida.
Trạng thái hệ thống khi thử: `development_settings_enabled=0`, `adb_enabled=1`,
`adb_wifi_enabled=0`. Đăng nhập Google hiện thông báo môi trường thiết bị bất
thường, gợi ý gỡ phần mềm không an toàn hoặc tắt chế độ nhà phát triển; mã
hiển thị bắt đầu `1113`. Ứng dụng trở lại màn hình đăng nhập.

Thông báo là gợi ý chung, không chỉ rõ tín hiệu server dùng để quyết định.
Cờ tùy chọn nhà phát triển đã bằng 0 trong lượt này; ADB vẫn bật và máy còn
root, Vector/Zygisk và các module root. Module VPN có phạm vi hệ thống đã được
tắt cấu hình, nhưng chưa khởi động lại hệ thống để loại bỏ tác động đã nạp
vào tiến trình hệ thống. Vì vậy chưa thể kết luận chính chế độ nhà phát triển,
ADB hay một tín hiệu khác là nguyên nhân. Không quan sát response API trong
lượt thử này. Bốn module Vector được giữ ở trạng thái tắt theo yêu cầu thử.
