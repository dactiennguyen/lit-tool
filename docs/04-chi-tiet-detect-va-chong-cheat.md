# 04 — Chi tiết `detect` blob & chống cheat (auto-clicker blacklist)

## 1. Cấu trúc blob `detect`
Hàm `detect` = `FUN_001adda8`. Nó đọc struct toàn cục `DAT_002a7518` và ghép chuỗi:

```
blob = "1.9.9"                         // version cứng
     + separator
     + <timestamp ms>                  // gettimeofday()/1000
     + separator
     + join( 11 string fields, separator )   // các trường thiết bị
     + separator
```
Sau đó mã hoá (`FUN_00258dac`) rồi `NewStringUTF` → gửi `/api/sns/v1/lit/eye` để đổi lấy `dfpId` (→ `X-DFPID`).

### 11 trường — ĐÃ XÁC MINH BẰNG RUNTIME ⭐ (không phải fingerprint thiết bị!)
`detect` đọc 11 `std::string` tại offset của struct `*DAT_002a7518`:
`0xa0, 0xb8, 0xd0, 0xe8, 0x100, 0x118, 0x130, 0x148, 0x160, 0x178, 0x190`.

**Giả định ban đầu (model/brand/fingerprint) là SAI.** Hook runtime (Frida, đọc struct đồng bộ ngay lúc load — xem doc 05) cho thấy đây là **kết quả bộ dò chống tamper (các hàm `Siua::*`)**, tức `detect` gửi tín hiệu toàn vẹn thiết bị lên server. Giá trị đọc được **khi có Frida attach** (frida tự làm "dính" 3 trường — chính là bằng chứng detection hoạt động):

| # | offset | Giá trị quan sát (có frida) | Ý nghĩa |
|---|---|---|---|
| 0 | `0xa0` | `""` | root path (sạch) |
| 1 | `0xb8` | `/memfd:frida-agent-64.so` | **quét maps/.so → bắt frida agent** |
| 2 | `0xd0` | `pool-frida` | **quét tên thread → bắt frida** |
| 3 | `0xe8` | `""` | LSPosed / Xposed |
| 4 | `0x100` | `""` | pmsHook |
| 5 | `0x118` | `""` | accessibility |
| 6 | `0x130` | `""` | (dự phòng) |
| 7 | `0x148` | `none` | **proxy** (chống MITM) |
| 8 | `0x160` | `0` | đếm (count) |
| 9 | `0x178` | `none` | **VPN** |
| 10 | `0x190` | `quantity:4\|RWX:0` | **đếm vùng nhớ RWX** (phát hiện code injection) |

→ Trên thiết bị sạch (không frida), các trường 1/2/10 sẽ rỗng/`0`. Struct offset `0x90`/`0x98` lưu chuỗi JNI + `NewGlobalRef(context)`.

> **Kết luận**: blob `detect` = `"1.9.9"` + timestamp + **[kết quả ~11 phép dò root/frida/proxy/vpn/xposed/RWX]**. Đây chính là dữ liệu sinh `X-DFPID` — server biết thiết bị "sạch" hay không trước khi tin request. Phần thu thập thiết bị thuần (model/brand) nếu có nằm ở nhánh khác, nhưng 11 trường detect này là **tín hiệu an ninh**.
>
> Cách đọc runtime: struct chỉ điền sau khi detect chạy (startup). Anti-frida gỡ agent trong <1s, nên phải đọc struct **đồng bộ ngay lúc script load**, không dùng `setTimeout`.

## 2. ⭐ Blacklist auto-clicker (chống tự động hoá / cheat)
Collector `FUN_001b0b54` còn nhúng một **danh sách đen app auto-clicker** (mã hoá XOR, giải mã tại runtime) để phát hiện người dùng dùng công cụ tự động bấm (cheat trong game/phòng party). Đã giải mã được **13 package**:

| # | Package | Nguồn (rodata/inline) | XOR mask |
|---|---|---|---|
| 1 | `simplehat.clicker` | rodata 0x11b863 | `0xb5e3ff6f79e787bf` |
| 2 | `com.truedevelopersstudio.automatictap.autoclicker` | inline | `0x33936bbb8fbf972b` |
| 3 | `com.rise.automatic.autoclicker.clicker` | rodata 0x11b8a7 | `0x1bb371b907c34bcd` |
| 4 | `autoclicker.clicker.autoclickerapp.autoclickerfo…` | inline | `0xedc1e78fafbbe305` |
| 5 | `com.opautoclicker.autoclicker` | rodata 0x11b905 | `0x0d53df29ffdb7137` |
| 6 | `com.autoclicker.simple.automatic.tap` | rodata 0x11b923 | `0x730b5fc175f311ed` |
| 7 | `com.tapassistant.autoclicker` | rodata 0x11b948 | `0x2b37f18be345cbf9` |
| 8 | `com.inscode.autoclicker` | rodata 0x11b965 | `0x7f0965650969d1c5` |
| 9 | `com.speed.gc.autoclicker.automatictap` | rodata 0x11b97d | `0x1ff1a10b71ffd95b` |
| 10 | `com.simple.automatic.tap.autoclicker` | rodata 0x11b9a3 | `0xbb55ff59df597b8d` |
| 11 | `uit.quocnguyen.autoclickerlite` | rodata 0x11b9c8 | `0xe1f511d51961f783` |
| 12 | `uit.quocnguyen.autoclicker` | rodata 0x11b9e7 | `0x4727c9738b41e993` |
| 13 | `com.truedevelopersstudio.automatictap.autoclicker` | inline | `0xef379d67b145a519` |

> Cơ chế giải mã: `plaintext[i] = cipher[i] XOR mask_le[i % 8]` (mask là khoá 8 byte little-endian, lặp lại). App nhiều khả năng so sánh danh sách này với các package đã cài (`listDyn`/PackageManager) và đưa kết quả vào `siua`/`detect`.

### Script giải mã (tham khảo)
```python
import struct
def deobf(cipher: bytes, mask_u64: int) -> bytes:
    mb = struct.pack('<Q', mask_u64)
    out = bytes(c ^ mb[i % 8] for i, c in enumerate(cipher))
    return out.split(b'\\0')[0]
```

## 3. Ý nghĩa
- `detect` không chỉ là fingerprint thiết bị mà còn gom **tín hiệu chống cheat** (có cài auto-clicker không).
- Kết hợp với `siua` (root/Frida/proxy/VPN) và verify chữ ký APK → server có bức tranh đầy đủ về độ "sạch" của thiết bị trước khi tin request.
