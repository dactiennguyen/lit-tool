# 03 — SDK chống gian lận liteye (`libliteye.so`)

Toàn bộ bảo mật mạng thật của Litmatch nằm trong thư viện native **`libliteye.so`** (ARM64, stripped, 1.7MB, clang 19 NDK), không ở tầng Java.

## 1. Kiến trúc phân tầng (Java → Native)
```
App (dt/d.java EyeContext)
 └─ EyeConnector (singleton, cache MMKV "construct_liteye_id")
     └─ EyeLocalApi (CountDownLatch chờ init 2s)
         └─ com.lit.liteye.LitEye   ◄── RANH GIỚI JNI
             └─ libliteye.so (load qua ReLinker; fail 3 lần → Process.kill)
```

Lớp Java: [`com/lit/liteye/LitEye.java`](../base-decompiled/sources/com/lit/liteye/LitEye.java) khai báo 6 native method:
`detect`, `dfpToken`, `initBreakpad`, `litSign`, `runtimeCheck`, `siua`.

## 2. Cách ẩn JNI (chống phân tích tĩnh)
6 method **không export tĩnh** (chỉ `JNI_OnLoad` xuất hiện trong dynsym). Constructor `_INIT_2` (vaddr `0x1acc5c`, chạy từ `.init_array`) dựng bảng `JNINativeMethod` tại `0x2a75f8` lúc runtime, với **tên method mã hoá XOR** (giải mã tại chỗ). `JNI_OnLoad` (`0x1b2cf4`) gọi `RegisterNatives(env, cls, 0x2a75f8, 6)`.

### Map 6 con trỏ hàm (đã giải)
| # | fnptr (vaddr) | Java method | Vai trò |
|---|---|---|---|
| 0 | `FUN_001adc00` → `FUN_001dc0e0` | `dfpToken` | Fingerprint cục bộ (Widevine) |
| 1 | `FUN_001add30` | `initBreakpad` | (stub) |
| 2 | `FUN_001adda8` | **`detect`** | Dựng "eye blob" |
| 3 | `FUN_001ae50c` → `FUN_001be208` | **`siua`** | Chạy bộ dò → token X-SIUA |
| 4 | `FUN_001ae644` | **`litSign`** | Ký request (HMAC-SHA256) |
| 5 | `FUN_001aece8` | `runtimeCheck` | Anti-tamper nền (pthread) |

> Địa chỉ theo image base Ghidra `0x100000`. File offset = vaddr − 0x100000.

## 3. `litSign` — thuật toán ký request ⭐
`FUN_001ae644`. **Đã crack hoàn toàn:**

```
litSign(message) = lowercase_hex( HMAC-SHA256(key, message) )
key = "happy0litmatch1"        (15 byte ASCII)
```

**Bằng chứng từ giả-mã C:**
1. `message = GetStringUTFChars(env, input)`.
2. Giải mã khoá nhúng: nguồn ở rodata `0x11ba80`, obfuscate bằng XOR mask `0x7d19e377ef77d117`. Giải 2 qword:
   - `7fb0079f0ed37514 ⊕ mask` → `h a p p y 0 l i`
   - `63bc169b148b287d ⊕ mask` → `t m a t c h 1 \0`
   - → **`happy0litmatch1`** (ra ASCII sạch = xác nhận đúng khoá).
3. SHA-256 **tự cài** (không dùng OpenSSL): hằng số init `6a09e667 bb67ae85 3c6ef372 a54ff53a 510e527f 9b05688c 1f83d9ab 5be0cd19` đúng H0–H7. `FUN_001bccb8`=SHA256_init, `FUN_001bd188`=SHA256_final.
4. HMAC chuẩn: `key ⊕ 0x36..` (ipad), `key ⊕ 0x5c..` (opad); `SHA256(opad ‖ SHA256(ipad ‖ message))`.
5. Hex-encode 32 byte → `NewStringUTF`.

### Tái tạo (ví dụ)
```python
import hmac, hashlib
def lit_sign(msg: str) -> str:
    return hmac.new(b"happy0litmatch1", msg.encode(), hashlib.sha256).hexdigest()
```
> Lưu ý: `litSign` **không có caller Java** trong bytecode — được gọi từ trong native hoặc qua reflection. Cần xác minh runtime nội dung `message` chính xác là gì (body request? chuỗi canonical?).

## 4. `detect` → `X-DFPID`
`FUN_001adda8`. Dựng chuỗi "eye blob":
```
"1.9.9" + timestamp(gettimeofday) + [11 trường thiết bị nối bằng separator] → mã hoá (FUN_00258dac)
```
→ POST `/api/sns/v1/lit/eye?eyeversion=1.0.1` (host `cloud.litatom.com`). Server trả `Result<EyeDfpId>{dfpId, ver, exp}` → cache MMKV `construct_liteye_id` key `eye_id`. `X-DFPID` = dfpId (hết hạn thì fetch lại). Chi tiết trường + anti-cheat: [04-chi-tiet-detect-va-chong-cheat.md](04-chi-tiet-detect-va-chong-cheat.md).

> **Lưu ý key/iv (kiểm chứng 13/11):** `detect()` runtime trả **JSON 198 trường** mã hoá
> `zlib→AES-128-CBC→base64` với key `438e0cba…`/iv `cc1c118e…`. Cặp này **KHÁC** key/iv của
> **eye-blob/`X-SIUA`** (`930f8b76…`/`28f1ebe0…`). Hai artifact, hai cặp key — chi tiết +
> phát hiện "token Node khác byte native nhưng JSON y hệt (zlib đa biểu diễn)": [08 §7](08-liteye-native-returns.md).

## 5. `siua` → `X-SIUA`
`FUN_001ae50c → FUN_001be208`. Gọi **~60 hàm con** (bộ dò `Siua::`), đóng gói kết quả scan thành token. Các kiểm tra (từ RTTI trong binary):

| Hàm `Siua::` | Phát hiện |
|---|---|
| `fridaThreadScan` / `fridaMapsScan` / `countFridaMaps` | **Frida** (quét `/proc/self/maps`, tên thread) |
| `root` | Root (dò `%s/su`) |
| `lsposedMapsDetection` | LSPosed |
| `pmsHook` | Hook PackageManager (Xposed) |
| `listDyn` | Thư viện `.so` lạ bị inject (`dl_iterate_phdr`) |
| `proxy` | HTTP proxy (**chống MITM**) |
| `vpn` | VPN |
| `accessibility` | Lạm dụng Accessibility |

→ Đây là lý do `frida-server` mặc định bị phát hiện và đẩy ra ("operation was cancelled"). Xem [05-moi-truong-phan-tich.md](05-moi-truong-phan-tich.md).

## 6. `dfpToken` & `runtimeCheck`
- `dfpToken` (`FUN_001adc00→FUN_001dc0e0`): token fingerprint cục bộ, dùng **Widevine DRM** (`AMediaDrm_createByUUID`, `AMediaDrm_getPropertyByteArray`) làm device-id phần cứng ổn định.
- `runtimeCheck` (`FUN_001aece8`): `NewGlobalRef(callback)` + `pthread_create(FUN_001aee20)` chạy kiểm tra tamper bất đồng bộ, trả kết quả qua `ResultCallback`.

## 7. Các lớp tự vệ khác
- **Bắt buộc .so**: `LitEye.ensureSoLoaded` thử nạp `libliteye.so` 3 lần (ReLinker); fail → `Process.killProcess()` + `System.exit(1)`.
- **Verify chữ ký APK**: binary chứa tên trường PKCS#7 (`signerInfos`, `signatureValue`, `signatureAlgorithm`) → tự parse khối chữ ký của chính APK để chống repackage.
- **TeeChecker** ([`TeeChecker.java`](../base-decompiled/sources/com/lit/liteye/TeeChecker.java)): tạo khoá EC trong AndroidKeyStore → phát hiện mức bảo mật phần cứng (`strongbox`/`tee`/`software`/`error`) ⇒ phát hiện emulator.
- **Breakpad**: `initBreakpad` dựng crash dump ở `files/crashDump`.
- Không import OpenSSL/BoringSSL → crypto tự cài trong .so.

## Tổng kết chuỗi header mỗi request
```
X-DFPID = dfpId (từ detect blob, neo bằng Widevine device id)
X-SIUA  = token mã hoá kết quả siua scan (root/frida/proxy/vpn/xposed/...)
Chữ ký  = litSign(x) = hex(HMAC-SHA256("happy0litmatch1", x))
```
