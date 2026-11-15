# Vòng đời SIUA / DFPID — xác minh tĩnh 15/11/2026

Nguồn và điều kiện bật `litEnableSIUA` đã truy tiếp tới API settings_v2/cache,
kèm response xác minh: [tài liệu 35](35-litEnableSIUA-nguon-cau-hinh.md).

Đọc bản Litmatch 7.77.0 (versionCode 711) trong workspace bằng skill
android-reverse-engineering và reverse-engineer-anything. Không dùng ADB,
không chạy app, không gửi API. Source Java đã decompile; phần native đối chiếu
trực tiếp assembly ARM64 bằng radare2. REA `open_binary(provider_id=ghidra)`
trả `provider_unavailable` vì chưa cấu hình Ghidra; không coi đây là một phiên
phân tích Ghidra thành công. Java 17 và jadx 1.5.5 hiện có sẵn.

## Kết luận

| Header | Hành vi trong code gốc |
|---|---|
| `X-SIUA` | Mỗi lần chạy EyeInterceptor gọi fetchSIUA; khi bật và khởi tạo thành công, native dựng token mới từ timestamp ms, UUID ngẫu nhiên mới và trạng thái scan. Không có cache token hoàn chỉnh trên đường thành công đã đọc. |
| `X-DFPID` | Đọc dfPID đã lưu; dùng lại qua nhiều request. Fetch nền khi hết hạn, hoặc khi các caller chủ động yêu cầu. Response có dfpId sẽ thay cache và ghi MMKV. |

"SIUA tạo mới" không đồng nghĩa "quét lại mọi tín hiệu ở mỗi request".
Native đọc các trường trạng thái scan từ struct dùng chung dưới khóa; phần
timestamp/UUID được dựng mới. Chưa khảo sát chu kỳ cập nhật từng trường scan.
Không cam kết token duy nhất tuyệt đối, hay mọi lần truyền lại ở tầng transport
đều chạy lại interceptor. Đây là logic bản binary gốc; không xác nhận module
hook trên điện thoại hiện tại có thay đổi hành vi hay không.

## Đường gọi SIUA

1. [EyeInterceptor.java](../base-decompiled/sources/com/construct/liteye/EyeInterceptor.java),
   dòng 26–47: gọi getDfpId và fetchSIUA, thêm header nếu kết quả khác null.
2. [EyeConnector.java](../base-decompiled/sources/com/construct/liteye/EyeConnector.java),
   dòng 145–153: gọi implementation khi có litEyeApi và isSIUAEnable; không
   giữ một field cache SIUA. Cờ lấy từ `litEnableSIUA`, default false,
   [dt/d.java](../base-decompiled/sources/dt/d.java), dòng 401–402.
3. [EyeLocalApi.java](../base-decompiled/sources/com/construct/liteye/impls/EyeLocalApi.java),
   dòng 84–104: chờ init tối đa 2 giây rồi gọi `LitEye.siua(context)`.
   Init/context/lỗi có thể trả chuỗi rỗng; connector khi tắt trả null.
4. Native thực sự của `siua` là **ELF VA 0xadda8**. Tại `0xade98` gọi
   `gettimeofday`; `0xade9c–0xadecc` tính `tv_sec * 1000 + tv_usec / 1000`.
   Đây là wall clock hệ thống, không phải hàm Java cộng offset `lx.c.b()`.
5. `0xadf10` gọi `0x152958`, rồi `0x665b0` sinh 16 byte và đặt version/variant
   UUIDv4; `0x66774` format UUID bằng chuỗi tại `0x17a6a`:
   `%08x-%04x-%04x-%02x%02x-%02x%02x%02x%02x%02x%02x`.
   Các lời gọi này nằm trên đường tạo token mỗi lần, không lấy UUID token cũ.
   UUID trong SIUA này không phải ANDROID_ID / LIT_UUID của query.
6. `0xadf68–0xae1c0` đọc struct scan ở global `0x1a7518` với lock/unlock;
   `0xae228` và `0xae234` gọi các bước đóng gói; `0xae2d4` tạo jstring trả về.
   Guard ở đầu hàm bảo vệ bước khởi tạo, không bỏ qua tạo timestamp/token.

## DFPID: cache và các điểm làm mới

Nguồn chính: [EyeConnector.java](../base-decompiled/sources/com/construct/liteye/EyeConnector.java).

- Dòng 176–182: lúc init, nạp JSON `eye_id` từ MMKV `construct_liteye_id`
  nếu `now < exp`, gán dfPID và expired.
- Dòng 156–161: nếu dfPID có sẵn và `now > expired`, gọi fetchEyeToken nền;
  vẫn trả dfPID đang có. Nếu dfPID rỗng thì trả localDfpToken.
- Dòng 40–44: localDfpToken chỉ tạo khi cả hai token đang rỗng; đây là fallback,
  không phải DFPID do server cấp.
- Dòng 125–142: chặn fetch trùng khi isFetchingToken; tạo worker gọi detect.
- Dòng 82–88: callback có dfpId sẽ thay dfPID/expired và ghi lại MMKV.
  Không có bước so sánh token mới với token cũ, nên không khẳng định server
  luôn cấp chuỗi khác sau mỗi fetch.
- Dòng 117–122, 191–192: thời gian kiểm tra hạn đi qua timestampMs → lx.c.b(),
  tức thời gian hệ thống + offset đồng bộ. Không hardcode TTL 24 giờ.
- [MainActivity.java](../base-decompiled/sources/com/lit/app/ui/MainActivity.java),
  dòng 174: gọi fetchEyeToken trong chuỗi khởi tạo màn chính.
- [model/d0.java](../base-decompiled/sources/com/lit/app/model/d0.java), dòng 299:
  gọi fetchEyeToken trong luồng login thành công.

API liên quan: POST `https://cloud.litatom.com/api/sns/v1/lit/eye?eyeversion=1.0.1`;
host có thể do EyeContext cung cấp, query qua ParamsInterceptor, body là chuỗi
detect. Nguồn: [EyeRequest.java](../base-decompiled/sources/com/construct/liteye/EyeRequest.java),
dòng 47, 61–85, 101–122. Client `/eye` riêng không thêm EyeInterceptor;
không suy rộng hai header sang mọi HTTP client trong app.

## Đính chính bảng JNI cũ

Các tài liệu 03/04/08 trước đây gán nhầm tên ba hàm. Constructor tại 0xacc5c
giải tên rồi ghi bảng JNINativeMethod tại 0x1a75f8; JNI_OnLoad ở 0xb2cf4 đăng
ký đúng 6 entries qua RegisterNatives tại 0xb2d9c.

| Entry | Tên giải từ bytes | Hàm ELF VA | Địa chỉ với image base Ghidra cũ 0x100000 |
|---|---|---|---|
| 0 | detect | 0xadc00 → 0xdc0e0 | 0x1adc00 → 0x1dc0e0 |
| 2 | siua | 0xadda8 | 0x1adda8 |
| 3 | dfpToken | 0xae50c → 0xbe208 | 0x1ae50c → 0x1be208 |

Chuỗi tên không được đoán từ output của hàm. Tái tạo phép XOR từ lệnh
khởi tạo/giải chuỗi, chạy từ root repo:

```python
from pathlib import Path
b = Path('native/libliteye.so').read_bytes()
rows = [
    (b[0x1c560:0x1c567], b[0x1d650:0x1d658:2] + bytes([0x1b, 0xab, 0x5b]), b'detect\0'),
    (b[0x1dbc0:0x1dbc4] + b'\x33', b[0x1eb80:0x1eb88:2] + b'\x33', b'siua\0'),
    (b[0x1f560:0x1f568] + b'\xab', b[0x1e1f8:0x1e200] + b'\xab', b'dfpToken\0'),
]
for encoded, mask, expected in rows:
    name = bytes(x ^ y for x, y in zip(encoded, mask))
    assert name == expected
    print(name)
```

Lệnh ghi con trỏ tên/hàm: entry 0 tại 0xacd6c / 0xace18; entry 2 tại
0xacf74 / 0xad01c; entry 3 tại 0xad074 / 0xad118. Có thể đọc lại bằng
`radare2 -q -e scr.color=false -e bin.relocs.apply=true -c 's 0xacc5c;af;pdf;s 0xadda8;af;pdf' native/libliteye.so`.
Pseudocode `pdc` có chỗ làm mất nghĩa điều kiện; kết luận dựa vào assembly.

## Danh tính artifact và giới hạn

- base.apk SHA-256: `43f379f121f467cbb2d60d3288fe3a5d24a028942e261cf3a7c796e036dd56d3`.
- native/libliteye.so SHA-256: `25a480b123d3580f61340825f62cc762f54a5d1524e1812876862a0f4a478fc0`.
- Đã đối chiếu byte: lib trên trùng member `lib/arm64-v8a/libliteye.so` trong
  `native/split_config.arm64_v8a.apk`.
- Static analysis xác minh nhánh code, không quan sát phiên app hiện tại hoặc
  quyết định chấp nhận của server. Không xác minh TTL đang cấp hoặc khi nào
  server đổi cờ enableSIUA. Không cần ADB để kết luận logic nêu trên.
