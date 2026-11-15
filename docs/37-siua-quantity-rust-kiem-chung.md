# SIUA: quantity và kiểm chứng Rust — 15/11/2026

## Giá trị mặc định

Giữ nguyên `SCAN_CLEAN` trong Rust và Node theo yêu cầu:

```text
||||||none|0|none||quantity:4|RWX:0|
```

Đây là dữ liệu đặt sẵn, không phải kết quả quét điện thoại hiện tại.

## quantity thực sự đếm gì

Đối chiếu assembly ARM64 của `native/libliteye.so`, SHA-256
`25a480b123d3580f61340825f62cc762f54a5d1524e1812876862a0f4a478fc0`.
REA báo không có native provider Ghidra/Hopper khả dụng. Bằng chứng dưới đây
lấy bằng radare2 và đọc byte file, không phải REA decompilation hay quan sát runtime.
Địa chỉ là ELF VA, không cộng image base 0x100000 của tài liệu Ghidra cũ.

Hàm `0x171fbc` đọc `/proc/self/maps`, phân tích từng dòng, rồi lọc pathname
chứa chuỗi truyền vào. Cả hai call site tìm được đều truyền `libc.so`:

- `0x109a0c`: chuỗi giải XOR từ bytes `0x1f660` với mask `0x1f4b8`.
- `0x17e954`: chuỗi giải XOR từ bytes `0x1c558` với mask `0x1d9e0`.
  Caller này ghi kết quả vào struct scan offset `0x190` tại `0x17e970–0x17e978`.
- Đường dẫn `/proc/self/maps` giải XOR từ 16 bytes `0x1bb50` với mask `0x1a090`;
  lệnh giải nằm ở `0x172028–0x17203c`.
- Format `sscanf` tại `0x18210` là `%lx-%lx %15s %lx %31s %lu %511[^\n]`;
  lời gọi tại `0x172198`. Dòng thiếu pathname hoặc pathname không khớp bị bỏ qua.
- `0x172314–0x172350`: tìm substring trong pathname bằng `memchr`/`memcmp`.
- `0x172410–0x172428`: tăng bộ đếm `quantity` khi pathname khớp.
- `0x17242c`, `0x172440`: tìm ký tự `w`, `x` trong permissions bằng helper
  `0x6828c`. `0x172444–0x17244c` tăng bộ đếm `RWX` khi cả hai có mặt.
  Không có điều kiện kiểm tra ký tự `r` riêng ở nhánh này.
- `0x172484–0x172518`: ghép `quantity:<bộ đếm thứ nhất>|RWX:<bộ đếm thứ hai>`.

Logic tương đương ở nhánh thành công:

```text
quantity = 0
rwx = 0
for mapping in /proc/self/maps:
    if mapping.pathname contains "libc.so":
        quantity += 1
        if "w" in mapping.permissions and "x" in mapping.permissions:
            rwx += 1
return "quantity:" + quantity + "|RWX:" + rwx
```

Vì vậy `quantity:4` mô tả 4 mapping khớp bộ lọc; không phải 4 tài khoản,
4 CPU, 4 module Frida hoặc 4 lỗi. `RWX:0` chỉ có nghĩa không mapping nào
trong nhóm đã lọc có đồng thời quyền ghi và thực thi. Không thể dùng riêng
hai con số này để kết luận thiết bị sạch hoặc có injection.

Kiểm chứng lại chuỗi từ file:

```python
from pathlib import Path
b = Path('native/libliteye.so').read_bytes()
for data, mask, size in [(0x1bb50, 0x1a090, 16), (0x1c558, 0x1d9e0, 8), (0x1f660, 0x1f4b8, 8)]:
    print(bytes(x ^ y for x, y in zip(b[data:data + size], b[mask:mask + size])))
```

## Kiểm chứng Rust với Node

Chạy từ `apps/src-tauri`:

```sh
cargo test --offline --lib
cargo test --offline --lib lit::tests::generated_headers_interoperate_with_node -- --ignored --nocapture
```

Suite thường: **82 passed, 2 ignored**. Hai test opt-in là live discovery và
interop cần Node. Test interop chạy riêng: **1 passed**, kiểm tra **10 mẫu GET/POST**.
Checker là `apps/src-tauri/tests/verify-lit-headers.mjs`, nhận dữ liệu giả lập
do Rust dựng qua stdin; không đọc account thật, không gửi API.

| Thành phần | Kết quả |
|---|---|
| SIUA | Node giải được token Rust bằng key/IV hiện có: Base64 → AES-128-CBC/PKCS7 → zlib → plaintext đúng format |
| Timestamp SIUA và `litTime` | Unix milliseconds; đồng hồ Rust đối chiếu với `Date.now()` |
| `ts` | Unix seconds, lấy phần nguyên; đúng ở ranh giới `…0999`, `…1000`, `…1001` ms |
| `litSign`, `sts-sign` | Khớp implementation Node cho mọi mẫu |
| UUID trong SIUA | UUIDv4 mới mỗi token, kể cả cùng millisecond; tách khỏi request ID |
| `X-Application-Info` và body POST | Node giải Shadow khớp query/body đầu vào |
| `X-DFPID` | Dùng nguyên giá trị account; không có hàm sinh DFPID hoặc timestamp DFPID ở Rust hiện tại |

Thời gian Rust lấy từ `SystemTime`/`UNIX_EPOCH` của máy chạy Tauri, không cộng
múi giờ và không đọc đồng hồ điện thoại. Kết quả xác minh tính tương thích dữ
liệu và chữ ký với Node; không khẳng định compressed bytes giống Android
hoặc token được server chấp nhận. Không gọi mạng hay ADB trong kiểm tra này.
