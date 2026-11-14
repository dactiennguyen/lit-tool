# 10 — Ghi chú thu thập thông tin thiết bị (198 trường)

> **Hiệu chỉnh 13/11/2026:** lượt gọi trực tiếp mới xác nhận JSON 198 trường
> thuộc `LitEye.detect(ctx)` trong điều kiện đã ghi, chưa xác nhận thuộc
> `dfpToken`. Key/IV bên dưới không giải được `dfpToken` trong lượt mới. Các
> khẳng định cũ trong tài liệu này cần được hiểu theo giới hạn đó; xem
> [12 — Kiểm chứng Eye và đăng nhập](12-kiem-chung-login-user-10.md).

> `LitEye.dfpToken(ctx)` (native `FUN_001dc0e0`, **26 KB / 880 basic block** — quá lớn nên Ghidra treo khi decompile) tạo **device fingerprint** đồ sộ. Mình lấy **giá trị thật** bằng hook read-only lõi AES rồi **giải mã offline** → JSON **198 trường, 7245 byte**. Đây là input chính để server ra verdict (kể cả 1112 ở [09](09-luong-dang-nhap.md)).

## 1. Định dạng (giống eye nhưng khoá khác — "mode 2")
```
dfpToken = base64( AES-128-CBC( zlib.deflate( <JSON 198 trường> ) ) )
           key = 438e0cbac6835d0b4ec0862ea67d537b
           iv  = cc1c118edefcdbc646f63f58288c2be6
           (key/iv nhúng trong native, dump ground-truth từ lõi AES FUN_0025838c lúc chạy)
```
- Khác với eye (`detect`, key `930f…`/iv `28f1…`). Cùng kiểu **zlib(78da) → AES-128-CBC → base64(std)**.
- Giải: `base64 → AES-decrypt → inflate → JSON`. Verify: giải offline blob thật → JSON hợp lệ 198 key (xem `scripts/eye.js` cùng cơ chế, chỉ đổi key/iv).
- `dfpToken` chạy **1 lần lúc init** (cache `localDfpToken` trong RAM), làm fallback cho `X-DFPID` khi chưa có eye token; nội dung cũng là thứ server đối chiếu.

## 2. Thu thập cái gì — 198 trường theo nhóm
> Cột "nguồn (suy ra)" = suy từ ngữ nghĩa tên trường + đường Widevine/Build/`/proc` đã biết; **không** phải trace từng syscall (hàm 26KB treo decompiler). Giá trị định danh thật đã **che** (máy riêng của người dùng).

### 2.1. Định danh thiết bị (identifiers) — nhạy cảm
`ad_aaid`(Google Advertising ID), `android_id_secure`(SSAID = `uuid` common param), `android_id_cache`, `drmId`/`drmId_native`(**Widevine**, `MediaDrm`), `serialno`, `secure_device_serial`, `gsm_serial`/`vendor_gsm_serial`, `pps_oaid`(OAID), `mi_health_id`, `gcbooster_uuid`, `extm_uuid`, `key_mqs_uuid`, `pref_mipub_random_device_id`, `huawei_global_uuid`, `persist_sys_oppo_opmuuid`, `persist_sys_oplus_opmuuid`, `vivo_iroamingkey`, `vivo_push_clientid`, `vivo_q_zi_i`, `uuid`, `id`, `sign_serial_id`. → *nhiều ID chéo nhà sản xuất để chống reset/đổi máy.*

### 2.2. Build / phần cứng
`brand`, `model`, `manufacturer`, `board`, `hardware`, `device`, `product`, `cpu_name`, `cpu_abi`/`cpu_abi2`, `cores_num`, `baseband`, `radio`, `ril_impl`, `bootloader`, `fingerprint`, `description`, `release`, `security_patch`, `tags`, `type`, `host`, `built_date`, `git_hash`, `ddr`, `emmc`, `soc0_sn_file`/`soc0_sn_pipe`, `ro_board_platform`, `ro_hardware_egl`, `ro_sf_lcd_density`, `proc_version`, `uname_info`/`pipe_uname`, `ro_build_version_incremental`, `ro_vendor_build_date`, `version`, `sdk_init`.

### 2.3. Verified boot / toàn vẹn APK (chống repack & giả ROM)
`boot_state`, `flash_locked`, `verity_mode`, `vbmeta_digest`, `oem_unlock_allowed`/`oem_unlock_supported`, `ro_boot_selinux`, `secure`, `attr_current`/`attr_prev`(SELinux context), `apk_digest`, `cert_sig`/`cert_info`/`cert_info2`, `issuer_dn`, `sig`, `v2s_verify`/`v2s_actual_digest`/`v2s_expect_digest`/`v2s_algorithm_id`(APK signature-scheme v2), `frp`, và 7 build-fingerprint phân vùng (`ro_build_fingerprint`, `ro_system/odm/product/vendor/system_ext/bootimage_build_fingerprint`).

### 2.4. Root / hook / frida / Xposed (anti-tamper)
`root`, `magisk_mount`, `magisk_frida`, `frida`, `frida_server`, `hluda_server`, `riru`/`riru_library`, `pmsHook`, `is_inline_hooked`, `hook_class`, `sus`/`suc`/`psuc`(su), `vmos_prop`(VM), `mod`/`isModApp`, `in_sand_box`, `seccomp_status`/`seccomp_prctl`, `so_list`, và **8 trường `inst_*`** = **dump bytes prologue của libc** (`open/openat/stat/syscall/dlopen/fopen/access/readlinkat`) để tự dò **inline hook** (bytes ≠ prologue chuẩn ⇒ bị hook).

### 2.5. Giả lập (emulator)
`is_emulator`, `emu_files`(dò `/sys/bus/virtio`,`/dev/usb_accessory`…), `emu_props`.

### 2.6. Secondary-user / clone (QUAN TRỌNG cho 1112)
`dual_app`, `uid`, `uid_cgroup`, `pid_cgroup`, `cgroup`, `parent_id`, `pid`, `processName`, `application_name`, `app_path`, `loaded_apk_list`, `installed_from_google`, `extract_native_libs`, `in_sand_box`.

### 2.7. Mạng / proxy / VPN / tether
`proxy`/`proxy_url`, `vpn`/`vpn_cm`, `dns_settings`, `is_wifi_on`/`is_cell_on`, `link_wlan0`/`link_wlan1`/`link_p2p0`, `wifi_interface`/`eth_interface`/`virtual_interface`, `arp_table`, `network_config`, `mac_file`, `bluetooth_address`, `gnirehtet_ip`/`gnirehtet_socket`(dò reverse-tether USB).

### 2.8. ADB / debug / accessibility
`is_adb_enabled`, `init_svc_adbd`, `debuggable`, `accessibility_services`, `is_accessibility_enabled`.

### 2.9. Lưu trữ / thời gian / pin
- Storage: `block_size`, `total_block`, `available_block`, `free_nodes`, `total_nodes`, `file_system_id`.
- Thời gian (dò cài mới/clone): `time_android`, `time_app_install`, `time_boot_java`/`time_boot_native`, `time_dcim`/`time_pictures`/`time_sdcard`/`time_primary`/`time_local`, `time_first_install`, `installed_baseapk_time`/`installed_dir_time`.
- Pin: `battery_path`, `battery_sn`, `exist_battery_temp`, `exist_voltage_now`, `has_battery_sym`.
- Khác: `classloader`, `country`, `custom_rom`, `device_cid`, `device_state`, `devcie_id_generated`(sic), `dynamic_library`, `eye_file`/`eye_mem`(tự kiểm tra lib liteye), `fd_app_path`/`fd_invalid`/`fd_maps`/`fd_status`(dò file-descriptor lạ).

## 3. Giá trị "nóng" trên máy này (user 10) — thứ làm server nghi ngờ
| Trường | Giá trị | Ý nghĩa |
|---|---|---|
| `dual_app` | `"1"` | **app nhân bản/dual** ✱ |
| `uid` / `uid_cgroup` | `"1010318"` | uid/100000 = **user 10** (secondary user) ✱ |
| `cgroup` | `…/uid_1010318/pid_8780` | xác nhận secondary user ✱ |
| `installed_from_google` | `"0"` | **không** cài từ Play Store ✱ |
| `is_emulator` | `"10"` | điểm/giá trị bất thường (không phải "0") |
| `emu_files` | `/sys/bus/virtio,/dev/usb_accessory,` | thấy artefact ảo hoá |
| `magisk_frida` | `quantity:19\|RWX:6` | **6 vùng nhớ RWX** = dấu vết inject |
| `sus`/`suc`/`psuc` | `"adb"` | su tiếp cận được qua adb |
| `is_adb_enabled`/`init_svc_adbd` | `"1"`/`running` | ADB đang bật |
| **bị GIẤU (APatch):** `root`,`frida`,`pmsHook`,`is_inline_hooked`,`riru`,`magisk_mount` | `0`/`none`/`""` | root/frida/hook **che thành công** |
| **spoof (TrickyStore/PIF):** `boot_state`,`flash_locked`,`verity_mode`,`v2s_verify` | `green`/`1`/`enforcing`/`1` | verified-boot "đẹp" |

✱ = tín hiệu **không giấu được** → **giả thuyết hàng đầu (H1)** cho 1112. (Root/frida bị APatch giấu nên KHÔNG phải cái khác biệt.) **Chưa chứng minh**: server không trả lý do; và còn confound **H2** = thiết bị đã bị blacklist từ ban user 0 (qua `drmId`/`android_id`) → cũng ra 1112 bất kể user. Hai giả thuyết chưa phân biệt được (cần máy sạch + account mới chạy user phụ). Xem [workflows/data README](data/README.md) §6.

## 3b. GIÁ TRỊ THẬT trên máy test (ground-truth, giải từ blob thật)
> Máy: **Redmi Note 10 — M2101K7BG** (Xiaomi, MediaTek Helio G95). Định danh cá nhân đã **che** (máy riêng người dùng); build/hw/mạng/toàn vẹn để nguyên vì không định danh cá nhân.

### Build / phần cứng
| Trường | Giá trị thật |
|---|---|
| `brand` / `manufacturer` | `Redmi` / `Xiaomi` |
| `model` | `M2101K7BG` |
| `device` / `product` / `board` | `secret` / `secret_global` / `secret` |
| `hardware` / `ro_board_platform` | `mt6785` (MediaTek Helio G95) |
| `cpu_name` / `cpu_abi` / `cores_num` | `Hardware: MT6785V/CD` / `arm64-v8a` / `8` |
| `baseband` | `MOLY.LR13.R1.MP.V89.6.P77,MOLY.LR13.R1.MP.V89.6.P77` |
| `ril_impl` | `android reference-ril 1.0` |
| `release` / `sdk_init` | `13` / `33` (Android 13) |
| `fingerprint` | `Redmi/secret_global/secret:13/TP1A.220624.014/V14.0.11.0.TKLMIXM:user/release-keys` |
| `description` | `missi_phoneext4_global-user 13 TP1A.220624.014 V14.0.11.0.TKLMIXM release-keys` |
| `security_patch` / `built_date` | `2026-09-05` / `2026-06-01 15:35:40.239` |
| `tags` / `type` | `release-keys` / `user` |
| `host` | `pangu-build-component-system-115492-p5hb9-hn64f-hk4c5` |
| `ro_sf_lcd_density` | `440` |
| `bootloader` / `device_state` | `unknown` / `locked` |
| `classloader` | `java.lang.BootClassLoader` |
| `country` | `vn,vn` |
| `version` (eye lib) | `1.9.9` |

### Định danh (giá trị đã CHE — chỉ nêu định dạng)
| Trường | Nguồn (suy ra) | Dạng |
|---|---|---|
| `ad_aaid` | Google Advertising ID | UUID 36 ký tự `42f707…` |
| `android_id_secure` | `Settings.Secure.ANDROID_ID` | 16 hex `966bbd…` (= `uuid` common param) |
| `drmId` / `drmId_native` | **Widevine** `MediaDrm` | base64 44 ký tự `TMVbDe…` (32 byte) |
| `uuid` | random/internal | UUID 36 ký tự `f90c3e…` |
| `gcbooster_uuid` | MIUI | UUID 36 ký tự `75104b…` |
| `serialno`/`secure_device_serial`/`gsm_serial`/`mac_file` | — | `no_permission`/rỗng (Android 10+ chặn) |
| `android_id_cache` | — | `error_values` |

### Toàn vẹn / verified-boot
| Trường | Giá trị thật | Ghi chú |
|---|---|---|
| `apk_digest` | `DF8DB50CDD64F973267F65B298333C77` | MD5 APK |
| `v2s_verify` | `1` | chữ ký APK scheme‑v2 OK |
| `v2s_actual_digest` | `2cda33cf3b1eadaae43d5d1b4597f51ee1265e0d78…` | digest thật |
| `vbmeta_digest` | `58457e4f7bf332e5c58386a83785734e94a441cf1118489c977b467ec3cc1e27` | vbmeta |
| `attr_current` / `attr_prev` | `u:r:untrusted_app:s0:c62,c257,c522,c768` / `u:r:init:s0` | SELinux context |
| `cert_sig` | `not_found` | |
| `issuer_dn` | `CN=Android, OU=Android, O=Google Inc., L=Mountain View, ST=California…` | cert ký APK |
| `oem_unlock_allowed` | `0` | |
| `frp` | `/dev/block/platform/bootdevice/by-name/frp` | |

### Mạng / lưu trữ / thời gian
| Trường | Giá trị thật |
|---|---|
| `proxy_url` / `dns_settings` | `DIRECT` / `none` |
| `is_wifi_on` / `is_cell_on` | `1` / `1` |
| `block_size` / `total_block` / `available_block` | `4096` / `28392952` / `18828980` (~72GB, ~108GB total) |
| `file_system_id` | `06d0f9be235a981e-348616-3696` |
| `time_first_install` | `1794329020569` (epoch ms) |
| `installed_from_google` | `0` (sideload) |

## 3c. Nguồn thu thập & mức chắc chắn (verified 2026-11-13)
Java `com/construct/liteye/impls/EyeLocalApi.java` **chỉ truyền `Context`** xuống native → **toàn bộ trường thu bên trong `libliteye.so`** (không có collector Java). `strings native/libliteye.so` chỉ lộ 3 nguồn plaintext; phần còn lại XOR-obfuscate.

| Trường | Nguồn | Mức |
|---|---|---|
| `uid`/`uid_cgroup` | `getuid()` (`1010318` → user 10) | ✅ xác nhận (string `getuid`) |
| `processName` | `/proc/%d/cmdline` | ✅ xác nhận |
| `app_path`/`loaded_apk_list`/`so_list` | `/proc/self/maps` | ✅ xác nhận |
| `cgroup` | `/proc/self/cgroup` (value khớp 100%) | 🟡 suy luận mạnh (path obfuscate) |
| `installed_from_google` | JNI `getInstallerPackageName` vs `com.android.vending` | 🟡 suy luận |
| `dual_app` | heuristic userId≠0 / path `/data/user/10/` | 🟠 suy đoán |

> Builder `dfpToken()` 26KB treo Ghidra nên chưa trace tĩnh từng read-site. Nâng chắc chắn: giải XOR-string trong `.so` hoặc hook read-only `openat`/JNI lúc chạy.

## 4. Đường đi → X-DFPID → verdict
```
dfpToken() [fallback] / detect()→POST /eye [chính]  →  X-DFPID
   →  gắn mọi request (EyeInterceptor)  →  server đọc fingerprint
   →  môi trường "bất thường" (secondary-user)  →  Result{result:1112}
```
`dfpToken` là fallback; nguồn `X-DFPID` chính là `dfpId` server cấp từ blob `detect()` (POST `/eye`, [08](08-liteye-native-returns.md) §6). Cả hai đều phản ánh cùng bộ tín hiệu môi trường.

## 5. Tái lập (giải)
Cùng cơ chế `scripts/eye.js` (chỉ thay key/iv sang `438e0cba…`/`cc1c118e…`): `base64 → AES-128-CBC-decrypt → zlib.inflate → JSON`. Đã verify: giải offline blob `dfpToken` thật (4184 ký tự b64) → JSON 198 trường hợp lệ.

> Tài liệu này để **hiểu app thu thập gì & vì sao môi trường bị gắn cờ**. Không gồm cách sửa/giả mạo các tín hiệu đó.
