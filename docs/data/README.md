# docs/data — Dữ liệu mẫu

> **Hiệu chỉnh ngày 13/11/2026:** lần kiểm chứng trực tiếp mới gọi
> `LitEye.detect(ctx)` và giải được JSON 198 trường bằng key/IV bên dưới.
> Một lần gọi `dfpToken(ctx)` khác **không** giải được bằng key/IV này.
> Vì vậy mô tả cũ quy JSON 198 trường cho `dfpToken` chưa được xác nhận;
> xem thêm [12 — Kiểm chứng Eye và đăng nhập](../12-kiem-chung-login-user-10.md).

File `device-info-example.json` trong Git là snapshot `LitEye.detect(ctx)` thật
thu trên thiết bị, giữ nguyên giá trị (gồm cả định danh thiết bị). Đây là máy
và dữ liệu của chủ repo nên commit nguyên văn là chủ ý; lưu ý repo chưa có
remote. Tham chiếu tài liệu lịch sử: [../10-thong-tin-thiet-bi.md](../10-thong-tin-thiet-bi.md).

| File | Nội dung |
|---|---|
| [device-info-example.json](device-info-example.json) | Snapshot `LitEye.detect(ctx)` thật (198 trường), giá trị nguyên văn |
| [observed-traffic.md](observed-traffic.md) | Traffic thật khi mở app (hook SSL_write) + header core API cần những gì |
| [api-headers-response.json](api-headers-response.json) | **Header request thật** (hook Java live) + **response đã giải mã** theo từng endpoint |
| [startup-traffic-observed.json](startup-traffic-observed.json) | Danh sách host/path quan sát lúc startup (sanitized) |
| [endpoints.txt](endpoints.txt) | 713 endpoint (grep tĩnh từ annotation Retrofit) |

---

## `device-info-example.json` — thông tin thiết bị và môi trường

### Nó là gì
Lần gọi `LitEye.detect(ctx)` trực tiếp trên Litmatch 7.77.0 ở user 10 tạo
payload giải mã được thành object JSON 198 trường. Kết quả thu được khi Frida
đang gắn và module Vector đang bật, nên phản ánh điều kiện của lượt đo đó.
Chưa xác minh server sử dụng riêng từng trường thế nào hoặc nguyên nhân 1112.

### Định dạng truyền đi
```
detect = base64( AES-128-CBC( zlib.deflate( <JSON này> ) ) )
           key = 438e0cbac6835d0b4ec0862ea67d537b
           iv  = cc1c118edefcdbc646f63f58288c2be6
```
Giải ngược: `base64 → AES-128-CBC-decrypt → zlib.inflate → JSON`. Key/IV này
đã kiểm chứng với `detect()` trong lượt trên, không phải với `dfpToken()`.

### Về định danh cá nhân

Snapshot chứa advertising ID, Android ID, định danh DRM, MAC và thông tin mạng
thật; đã commit nguyên văn theo chủ ý của chủ repo. Tên trường và định dạng có
thể thay đổi theo bản app, profile và điều kiện chạy.

---

## Giải thích các trường (theo nhóm)

### 1. Định danh thiết bị (nhạy cảm — để chống reset/đổi máy)
| Trường | Nghĩa |
|---|---|
| `ad_aaid` | Google Advertising ID (UUID, reset được trong Settings) |
| `android_id_secure` | `Settings.Secure.ANDROID_ID` (SSAID) — **bằng `uuid` trong common param** |
| `android_id_cache` | bản cache; `error_values` nếu đọc lỗi |
| `drmId` / `drmId_native` | **Widevine `MediaDrm`** device-unique ID (b64 32 byte) — khó reset nhất |
| `serialno`, `secure_device_serial`, `gsm_serial` | serial phần cứng (Android 10+ chặn → `no_permission`) |
| `pps_oaid` | OAID (ID quảng cáo của OEM TQ) |
| `gcbooster_uuid`, `extm_uuid`, `huawei_global_uuid`, `vivo_*`, `persist_sys_*_opmuuid` | UUID riêng từng hãng (MIUI/Huawei/Vivo/Oppo) — nhiều ID chéo hãng |
| `uuid`, `id`, `sign_serial_id` | ID nội bộ/random app tự sinh |

### 2. Build / phần cứng (nhận diện model + ROM)
| Trường | Nghĩa |
|---|---|
| `brand`, `manufacturer`, `model` | hãng + tên máy (`Redmi`/`Xiaomi`/`M2101K7BG`) |
| `device`, `product`, `board` | codename bo mạch |
| `hardware`, `ro_board_platform`, `cpu_name` | SoC (`mt6785` = Helio G95) |
| `cpu_abi`, `cores_num` | kiến trúc (`arm64-v8a`) + số nhân |
| `baseband`, `ril_impl` | firmware modem |
| `release`, `sdk_init` | Android version (`13`/`33`) |
| `fingerprint`, `description` | chuỗi build ROM đầy đủ |
| `security_patch`, `built_date`, `tags`, `type` | bản vá + ngày build + loại key |
| `host` | máy build ROM |
| `version` | version lib liteye (`1.9.9`) |

### 3. Verified boot / toàn vẹn APK (chống repack & giả ROM)
| Trường | Nghĩa |
|---|---|
| `boot_state` | trạng thái bootloader (`green`=khóa/sạch) |
| `flash_locked`, `verity_mode` | khóa flash + dm-verity |
| `apk_digest` | MD5 của APK (chống sửa file) |
| `v2s_verify`, `v2s_actual_digest` | chữ ký APK scheme-v2 có hợp lệ không |
| `vbmeta_digest` | digest verified-boot |
| `attr_current`, `attr_prev` | SELinux context của process |
| `cert_sig`, `issuer_dn` | cert ký APK |
| `oem_unlock_allowed`, `frp` | cờ mở khóa OEM |

### 4. Root / hook / frida / Xposed (anti-tamper)
| Trường | Nghĩa |
|---|---|
| `root` | có `su` không |
| `magisk_mount`, `magisk_frida` | dấu vết Magisk; `magisk_frida` = `quantity:N\|RWX:M` đếm vùng nhớ **RWX** (dấu inject) |
| `frida`, `frida_server`, `hluda_server` | dò frida (hluda = frida đổi tên) |
| `riru`, `pmsHook`, `is_inline_hooked`, `hook_class` | dò framework hook/Xposed |
| `sus`, `suc`, `psuc` | các cách tiếp cận `su` (`adb` = qua adb) |
| `inst_open`, `inst_openat`, `inst_access`, `inst_dlopen`… | **dump bytes prologue của libc** — nếu khác prologue chuẩn ⇒ bị **inline hook** |

### 5. Giả lập
| Trường | Nghĩa |
|---|---|
| `is_emulator` | điểm nghi ngờ emulator (`0`=thật) |
| `emu_files`, `emu_props` | file/prop đặc trưng máy ảo |

### 6. Secondary-user / clone — **giả thuyết hàng đầu cho 1112** (chưa chứng minh)
| Trường | Nghĩa |
|---|---|
| `dual_app` | app nhân bản/dual (`1`=có) |
| `uid`, `uid_cgroup` | uid; `uid/100000` = user id (`1010318` → **user 10**) |
| `cgroup`, `pid_cgroup` | đường cgroup chứa `uid_1010318` → xác nhận user phụ |
| `processName`, `application_name` | tên process |
| `installed_from_google` | có cài từ Play Store không (`0`=sideload) |
| `extract_native_libs`, `in_sand_box` | cờ đóng gói / chạy trong sandbox clone |

> Một số giá trị nhóm 6 liên quan user phụ; chưa chứng minh server dựa vào
> chúng để từ chối đăng nhập. Chưa có bằng chứng xác lập device ban ở user 0
> hay server blacklist thiết bị. Hai giả thuyết dưới đây chưa được phân biệt.
>
> | | Giả thuyết | Khớp quan sát? | Phân biệt bằng |
> |---|---|---|---|
> | **H1** | Secondary-user (dual_app/uid) → môi trường bất thường | ✓ | máy sạch + account mới, chạy user phụ → nếu vẫn 1112 ⇒ H1 đúng |
> | **H2** | Thiết bị đã bị blacklist từ ban user 0 | ✓ | máy sạch → nếu login ngon ⇒ H2 là chính |

### 7. Mạng / proxy / VPN
`proxy`/`proxy_url` (kết nối trực tiếp = `DIRECT`), `vpn`, `dns_settings`, `is_wifi_on`/`is_cell_on`, `mac_file`, `gnirehtet_ip`/`gnirehtet_socket` (dò reverse-tether USB).

### 8. ADB / debug / accessibility
`is_adb_enabled`, `init_svc_adbd`, `debuggable`, `accessibility_services`, `is_accessibility_enabled` — dò bật ADB / dịch vụ trợ năng (hay bị auto-clicker lợi dụng).

### 9. Lưu trữ / thời gian / pin
`block_size`/`total_block`/`available_block`/`file_system_id` (dung lượng + id hệ thống tệp), `time_first_install` + các mốc thời gian (dò máy mới cài/clone), `battery_sn`/`exist_battery_temp`/`has_battery_sym` (pin thật hay ảo).

---

## Các trường được THU TỪ ĐÂU (verified 2026-11-13)

Các ghi chú nguồn sau đây là phân tích lịch sử; ánh xạ từng trường và hàm
native chưa được kiểm chứng đầy đủ. Lượt mới xác nhận JSON từ `detect()`;
không chứng minh JSON này do `dfpToken()` tạo.

Kiểm bằng `strings native/libliteye.so` — chỉ 3 nguồn hiện **plaintext**, phần còn lại bị **XOR-obfuscate** (không hiện ≠ không đọc):

| Trường | Nguồn OS | Mức chắc |
|---|---|---|
| `uid` / `uid_cgroup` | `getuid()` → `1010318`; userId = uid/100000 | ✅ **xác nhận** (string `getuid`) |
| `processName` / `application_name` | `/proc/%d/cmdline` | ✅ **xác nhận** (string plaintext) |
| `app_path` / `loaded_apk_list` / `so_list` | `/proc/self/maps` | ✅ **xác nhận** (string plaintext) |
| `cgroup` / `pid_cgroup` | `/proc/self/cgroup` (giá trị `/acct/uid_1010318/pid_…` = nội dung file đó) | 🟡 suy luận mạnh (path bị obfuscate) |
| `installed_from_google` | JNI `PackageManager.getInstallerPackageName()` vs `com.android.vending` | 🟡 suy luận (không có ở Java liteye, không plaintext) |
| `dual_app` | heuristic userId≠0 / đường `/data/user/10/…` / marker MIUI | 🟠 suy đoán (read-site chưa xác minh) |

Nâng 🟡/🟠 → ✅: giải bảng XOR-string trong `.so`, hoặc hook read-only `openat()` + JNI `getInstallerPackageName` lúc `dfpToken()` chạy.

## Tự đọc giá trị thật trên máy bạn (read-only)
```bash
adb shell settings get secure android_id        # android_id_secure
# Advertising ID: Settings → Google → Quảng cáo
# drmId (Widevine) / OAID: phải đọc bằng code/hook (không có lệnh adb đơn giản)
```

Để lấy toàn bộ snapshot từ app đang chạy: attach Frida vào tiến trình app rồi
gọi `LitEye.detect(context)`, parse chuỗi trả về theo định dạng ở trên. Giữ
phiên frida sống (khớp version client/server), không gửi login. Tắt server và
ADB forward sau khi thu xong nếu không còn dùng.

> Tài liệu để **hiểu app thu thập gì & vì sao môi trường bị gắn cờ**. Không gồm cách sửa/giả mạo tín hiệu.
