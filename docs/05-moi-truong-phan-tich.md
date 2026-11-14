# 05 — Môi trường & cách tái lập phân tích

## 1. Decompile Java
```bash
# jadx (APK → Java)
jadx -d base-decompiled --show-bad-code base.apk
# Kết quả: base-decompiled/sources/ (~44.6k file), resources/AndroidManifest.xml
```

## 2. Lấy native lib từ split APK
App cài trên thiết bị (user 10 "Play"), splits `[base, config.arm64_v8a]`:
```bash
adb shell pm path com.litatom.app            # tìm codePath
adb pull <codePath>/split_config.arm64_v8a.apk native/
cd native && unzip -o -j split_config.arm64_v8a.apk 'lib/arm64-v8a/libliteye.so' -d .
```

## 3. Phân tích tĩnh native bằng REA + Ghidra
`libliteye.so` stripped + obfuscate (bảng JNI điền runtime, tên XOR). REA cần backend Ghidra.

### Cài Ghidra cho REA (macOS arm64)
```bash
# 1. Tải Ghidra 12.1.4
curl -fL -o ghidra.zip https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.1.4_build/ghidra_12.1.4_PUBLIC_20260921.zip
unzip ghidra.zip -d /Volumes/D/tools/

# 2. Bản public KHÔNG kèm decompiler macOS → tự build (cần Xcode CLT, bison, flex)
cd /Volumes/D/tools/ghidra_12.1.4_PUBLIC/Ghidra/Features/Decompiler/src/decompile/cpp
make ghidra_opt  ARCH_TYPE="-arch arm64"      # build từng goal riêng!
make sleigh_opt  ARCH_TYPE="-arch arm64"
OS=../../../os/mac_arm_64; mkdir -p $OS
cp ghidra_opt $OS/decompile; cp sleigh_opt $OS/sleigh; chmod +x $OS/*

# 3. Trỏ REA (sửa mcpServers.rea.env trong ~/.claude.json)
#    GHIDRA_INSTALL_DIR=/Volumes/D/tools/ghidra_12.1.4_PUBLIC
#    JAVA_HOME=<JDK 21+>
# 4. RESTART REA MCP (thoát hẳn Claude Code rồi mở lại — /clear KHÔNG đủ)
# Kiểm tra: npx -y rea-agents@6.8.0 doctor   → mọi check ghidra PASS
```
**Gotcha**: `make ghidra_opt sleigh_opt` (2 goal cùng lúc) sẽ lỗi `bfd.h not found` — Makefile chỉ chọn danh sách object đúng khi `MAKECMDGOALS` khớp 1 goal. Build **từng cái một**.

### Các lệnh REA hữu ích đã dùng
- `binary_overview`, `search_strings`, `search_procedures`
- `procedure_pseudo_code <addr>` — giả-mã C
- `xrefs <addr>`, `resolve_containing_procedure <addr>`, `procedure_callees <addr>`
- `read_bytes <addr> <len>` — đọc byte (để giải khoá/chuỗi XOR)

## 4. Phân tích động (Frida)
Phương pháp: hook đầy đủ các hàm liteye bằng Frida, và đọc struct detect (11 trường) **đồng bộ ngay lúc load** (xem 4.2).

### 4.1. ⚠️ Khớp phiên bản client/server (quan trọng!)
Lỗi `operation was cancelled` / `timeout was reached` lúc **load script** thường do **lệch phiên bản** frida client vs server (vd client 17.10 vs server 17.23) — inject agent cần khớp. Khắc phục:
```bash
# đẩy frida-server khớp đúng client, bind LOCALHOST thiết bị + tunnel qua adb (KHÔNG mở ra mạng)
adb push frida-server-17.10.0 /data/local/tmp/fs-1710 && adb shell chmod 755 /data/local/tmp/fs-1710
adb shell "su -c 'nohup /data/local/tmp/fs-1710 -l 127.0.0.1:27043 >/dev/null 2>&1 &'"
adb forward tcp:27043 tcp:27043
frida -H 127.0.0.1:27043 -p <PID> -l <frida-script>.js -q
```

### 4.2. ⚠️ ĐÍNH CHÍNH: frida KHÔNG bị giết — chỉ do `frida -q` tự thoát
**Kết luận trước đó ("Siua gỡ agent trong <1s") là SAI.** Nguyên nhân thật: `frida -q -l script` chạy **nền/không TTY** sẽ **tự thoát ngay sau khi load script** → code đồng bộ chạy (in ra), nhưng `setInterval`/`setTimeout` không bao giờ fire vì tiến trình frida đã kết thúc. Heartbeat chết cả trên app vô hại (Chrome) ⇒ không phải anti-frida.

**Cách giữ session đúng**: giữ phiên frida sống thay vì để `frida -q` tự thoát — chạy frida CLI ở chế độ tương tác (bỏ `-q`), hoặc dùng một driver attach rồi chờ (sleep N giây) để timer VÀ Interceptor hook chạy bình thường. Lưu ý khớp phiên bản: client phải cùng version frida-server trên máy (ở đây 17.23.3).

`Siua` VẪN có `fridaThreadScan`/`fridaMapsScan`/`countFridaMaps` — nhưng tác dụng là **đưa cờ "có frida" vào token `X-SIUA`/`detect`** để **server từ chối login**, chứ không gỡ agent. (Đọc struct bằng frida bị "nhiễm" các cờ này đúng vì lý do đó.)

### 4.4. Thử bypass login — kết quả thực nghiệm
Hook libc `strstr`/`strcmp`/`fgets`/`access`/`open`... (chuỗi đặc hiệu) để che frida/su/magisk rồi login:
- Hook **fire mạnh** (chặn ~6878 lần so-chuỗi, lọc 36 dòng maps) nhưng **login VẪN bị chặn** (cùng mã 1112).
- `file`-check = 0 ⇒ `Siua::root` **không** dùng `access`/`stat`/`open` trên đường dẫn `su` → dò root bằng cách khác (đọc `/proc/mounts`/`/proc/self/maps` qua raw `read()`, hoặc đặc trưng Magisk).
- Blob/`dfpId` có thể đã **cache** (MMKV `construct_liteye_id`) với cờ cũ.

⇒ Hook string/maps ở libc **không đủ**. Bypass thật cần: hook `read`/`pread` (lọc nội dung /proc), vô hiệu trực tiếp các hàm `Siua::*` native, xoá cache `dfpId` + re-trigger, và xử lý cả **root (Magisk)** + **developer mode** (2 cờ còn lại trong thông báo lỗi). Thực tế: **ẩn root bằng Magisk DenyList/Zygisk + tắt dev mode + không attach frida** là đường đáng tin hơn hẳn.

### 4.3. Đọc memory thụ động (không inject → không bị detect)
Vì `extractNativeLibs=false`, `libliteye.so` map thẳng từ `split_config.arm64_v8a.apk` (không có tên "libliteye.so" trong `/proc/pid/maps` — phải định vị base theo offset .text). Khi có base: đọc `/proc/pid/mem` bằng root (`dd iflag=skip_bytes`) để lấy struct — cách này không kích hoạt anti-frida.

## 5. Thiết bị test đã dùng
- adb `192.168.2.1:5555`, ABI arm64-v8a, Android 13+.
- App cài ở **user 10** (profile "Play") → `frida -f com.litatom.app` spawn-by-name thất bại; khởi động bằng `monkey` rồi attach theo PID, hoặc spawn đúng user.
