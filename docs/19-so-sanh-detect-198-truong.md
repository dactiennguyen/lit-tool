# So sánh 198 trường LitEye.detect() — 14/11/2026

## Cách so sánh

- Mẫu A: `.private/detect-20261114-model-sync2.json`, model `23021RAAEG`.
- Mẫu B: `.private/detect-20261114-build-compare.json`, model `Pixel 6a`. Mẫu B và `Build` được đọc cùng một lượt Frida trong tiến trình Litmatch user 10.
- Cả hai được giải mã AES có kiểm tra padding. Các module Eye và Hide My Device bật; Frida đang gắn. Không thử đăng nhập.
- So sánh giá trị JSON chính xác, không in định danh. Hai mẫu lấy ở hai tiến trình và thời điểm khác nhau: chênh lệch không chứng minh nguyên nhân.

Cùng 198 khóa: **190 giá trị giống**, **8 giá trị khác**. Không có khóa chỉ xuất hiện ở một mẫu.

## So sánh `Build` với `detect()` trong mẫu B

| Trường Java | Trường detect | Kết quả |
|---|---|---|
| `MODEL` | `model` | Giống |
| `BRAND` | `brand` | Khác |
| `MANUFACTURER` | `manufacturer` | Khác |
| `DEVICE` | `device` | Giống |
| `PRODUCT` | `product` | Giống |
| `BOARD` | `board` | Giống |
| `HARDWARE` | `hardware` | Giống |
| `FINGERPRINT` | `fingerprint` | Giống |
| `BOOTLOADER` | `bootloader` | Giống |
| `HOST` | `host` | Giống |
| `TAGS` | `tags` | Giống |
| `TYPE` | `type` | Giống |
| `RELEASE` | `release` | Giống |
| `SDK_INT` | `sdk_init` | Giống |
| `SECURITY_PATCH` | `security_patch` | Giống |
| `INCREMENTAL` | `ro_build_version_incremental` | Giống |

`BOOTLOADER` trùng bằng `unknown`, nên không chứng minh xác định được bootloader. Trùng giá trị không đồng nghĩa đã xoay. Ở mẫu B, Java model/brand/manufacturer là `Pixel 6a`/`google`/`Google`; detect là `Pixel 6a`/`Redmi`/`Xiaomi`.

## So sánh 198 khóa giữa hai snapshot

| Trường detect | Mẫu A so với B |
|---|---|
| `accessibility_services` | Giống |
| `ad_aaid` | Giống |
| `android_id_cache` | Giống |
| `android_id_secure` | Giống |
| `apk_digest` | Giống |
| `app_path` | Giống |
| `application_name` | Giống |
| `arp_table` | Giống |
| `attr_current` | Giống |
| `attr_prev` | Giống |
| `available_block` | Khác |
| `baseband` | Giống |
| `battery_path` | Giống |
| `battery_sn` | Giống |
| `block_size` | Giống |
| `bluetooth_address` | Giống |
| `board` | Giống |
| `boot_id` | Giống |
| `boot_state` | Giống |
| `bootloader` | Giống |
| `brand` | Giống |
| `built_date` | Giống |
| `cert_info` | Giống |
| `cert_info2` | Giống |
| `cert_sig` | Giống |
| `cgroup` | Khác |
| `classloader` | Giống |
| `cores_num` | Giống |
| `country` | Giống |
| `cpu_abi` | Giống |
| `cpu_abi2` | Giống |
| `cpu_name` | Giống |
| `custom_rom` | Giống |
| `ddr` | Giống |
| `debuggable` | Giống |
| `description` | Giống |
| `devcie_id_generated` | Giống |
| `device` | Giống |
| `device_cid` | Giống |
| `device_state` | Giống |
| `dns_settings` | Giống |
| `drmId` | Giống |
| `drmId_native` | Giống |
| `dual_app` | Giống |
| `dynamic_library` | Giống |
| `emmc` | Giống |
| `emu_files` | Giống |
| `emu_props` | Giống |
| `eth_interface` | Giống |
| `exist_battery_temp` | Giống |
| `exist_voltage_now` | Giống |
| `extm_uuid` | Giống |
| `extract_native_libs` | Giống |
| `eye_file` | Giống |
| `eye_mem` | Giống |
| `fd_app_path` | Giống |
| `fd_invalid` | Giống |
| `fd_maps` | Giống |
| `fd_status` | Giống |
| `file_system_id` | Giống |
| `fingerprint` | Giống |
| `flash_locked` | Giống |
| `free_nodes` | Khác |
| `frida` | Giống |
| `frida_server` | Giống |
| `frp` | Giống |
| `gcbooster_uuid` | Giống |
| `git_hash` | Giống |
| `gnirehtet_ip` | Giống |
| `gnirehtet_socket` | Giống |
| `gsm_serial` | Giống |
| `gsm_state` | Giống |
| `gsm_state2` | Giống |
| `hardware` | Giống |
| `has_battery_sym` | Giống |
| `hluda_server` | Giống |
| `hook_class` | Giống |
| `host` | Giống |
| `huawei_global_uuid` | Giống |
| `id` | Giống |
| `in_sand_box` | Giống |
| `init_svc_adbd` | Giống |
| `inst_access` | Giống |
| `inst_dlopen` | Giống |
| `inst_fopen` | Giống |
| `inst_open` | Giống |
| `inst_openat` | Giống |
| `inst_readlinkat` | Giống |
| `inst_stat` | Giống |
| `inst_syscall` | Giống |
| `installed_baseapk_time` | Giống |
| `installed_dir_time` | Giống |
| `installed_from_google` | Giống |
| `isModApp` | Giống |
| `is_accessibility_enabled` | Giống |
| `is_adb_enabled` | Giống |
| `is_cell_on` | Giống |
| `is_emulator` | Giống |
| `is_inline_hooked` | Giống |
| `is_wifi_on` | Giống |
| `issuer_dn` | Giống |
| `key_mqs_uuid` | Giống |
| `link_p2p0` | Giống |
| `link_wlan0` | Giống |
| `link_wlan1` | Giống |
| `loaded_apk_list` | Giống |
| `mac_file` | Giống |
| `magisk_frida` | Giống |
| `magisk_mount` | Giống |
| `manufacturer` | Giống |
| `mi_health_id` | Giống |
| `mod` | Giống |
| `model` | Khác |
| `network_config` | Giống |
| `oem_unlock_allowed` | Giống |
| `oem_unlock_supported` | Giống |
| `parent_id` | Giống |
| `persist_sys_oplus_opmuuid` | Giống |
| `persist_sys_oppo_opmuuid` | Giống |
| `pid` | Khác |
| `pid_cgroup` | Khác |
| `pipe_uname` | Giống |
| `pmsHook` | Giống |
| `pps_oaid` | Giống |
| `pref_mipub_random_device_id` | Giống |
| `proc_version` | Giống |
| `processName` | Giống |
| `product` | Giống |
| `proxy` | Giống |
| `proxy_url` | Giống |
| `psuc` | Giống |
| `radio` | Giống |
| `release` | Giống |
| `ril_impl` | Giống |
| `riru` | Giống |
| `riru_library` | Giống |
| `ro_board_platform` | Giống |
| `ro_boot_selinux` | Giống |
| `ro_bootimage_build_fingerprint` | Giống |
| `ro_build_build_fingerprint` | Giống |
| `ro_build_fingerprint` | Giống |
| `ro_build_version_incremental` | Giống |
| `ro_hardware_egl` | Giống |
| `ro_odm_build_fingerprint` | Giống |
| `ro_product_build_fingerprint` | Giống |
| `ro_sf_lcd_density` | Giống |
| `ro_system_build_fingerprint` | Giống |
| `ro_system_ext_build_fingerprint` | Giống |
| `ro_vendor_build_date` | Giống |
| `root` | Giống |
| `sdk_init` | Giống |
| `seccomp_prctl` | Giống |
| `seccomp_status` | Giống |
| `secure` | Giống |
| `secure_device_serial` | Giống |
| `security_patch` | Giống |
| `serialno` | Giống |
| `sig` | Giống |
| `sign_serial_id` | Giống |
| `so_list` | Giống |
| `soc0_sn_file` | Giống |
| `soc0_sn_pipe` | Giống |
| `suc` | Giống |
| `sus` | Giống |
| `tags` | Giống |
| `time_android` | Giống |
| `time_app_install` | Giống |
| `time_boot_java` | Giống |
| `time_boot_native` | Giống |
| `time_dcim` | Giống |
| `time_first_install` | Giống |
| `time_local` | Khác |
| `time_pictures` | Giống |
| `time_primary` | Giống |
| `time_sdcard` | Giống |
| `total_block` | Giống |
| `total_nodes` | Giống |
| `type` | Giống |
| `uid` | Giống |
| `uid_cgroup` | Giống |
| `uname_info` | Giống |
| `uuid` | Khác |
| `v2s_actual_digest` | Giống |
| `v2s_algorithm_id` | Giống |
| `v2s_expect_digest` | Giống |
| `v2s_verify` | Giống |
| `vbmeta_digest` | Giống |
| `vendor_gsm_serial` | Giống |
| `verity_mode` | Giống |
| `version` | Giống |
| `virtual_interface` | Giống |
| `vivo_iroamingkey` | Giống |
| `vivo_push_clientid` | Giống |
| `vivo_q_zi_i` | Giống |
| `vmos_prop` | Giống |
| `vpn` | Giống |
| `vpn_cm` | Giống |
| `wifi_interface` | Giống |

## Đối chiếu cấu hình Hide My Device

**Đính chính cùng ngày:** so sánh trước đó với file `ids.xml` đọc bằng ADB
không phản ánh đúng cấu hình Hide My Device đang sử dụng trong bộ nhớ. Đo
`SharedPreferences` trong chính tiến trình Hide My Device cho thấy Android ID,
Bluetooth và DRM ID trong bộ nhớ khác file mà ADB đọc được; chưa xác định
nguyên nhân sự khác biệt này hoặc khẳng định cấu hình được lưu bền vững.

Khi so với cấu hình **trong bộ nhớ**, `android_id_secure`, `bluetooth_address`
và `drmId` đã trùng trong cùng thời điểm; DRM cấu hình là hex, payload là
Base64 nên phải chuyển đổi byte trước khi so sánh. `drmId_native` ban đầu
khác; sau khi bổ sung hook trong module Eye, cả hai trường DRM trùng Java
`MediaDrm` trong hai tiến trình liên tiếp. Xem
[kết quả và giới hạn](../vector-eye/README.md#đồng-bộ-drm-native--14112026).
Các kết luận này không áp dụng cho toàn bộ 198 trường.
