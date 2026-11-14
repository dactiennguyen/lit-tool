# 99 — Phụ lục

## A. Host & endpoint hạ tầng

| Host | Vai trò |
|---|---|
| `https://www.litatom.com/` | API chính (`BASE_URL`, `ns/y1.java`) |
| `https://prod.litmatchs.com` | Route `/api/ms` (`a00/b.java`) |
| `https://baishan.litatom.com/` | Upload media: `/api/sns/v1/lit/{image,simage,audio,video,oss/zip}/` |
| `https://cloud.litatom.com` | liteye: `/api/sns/v1/lit/eye?eyeversion=1.0.1`, `/liteyelog` |
| `https://openim.litatom.com/api` | Chat REST; `wss://openim.litatom.com/msg_gateway` |
| `https://activity.static.litatom.com/` | WebView activity (H5) |
| `ksztagent.com` | Biến thể cho người dùng Philippines (PH) |

## B. Endpoint login/account tiêu biểu (`va0/a.java`, `z50/a.java`)
```
POST  api/sns/v1/lit/user/phone_login
POST  /api/sns/v1/lit/user/email_login
POST  api/sns/v1/lit/user/google_login
POST  api/sns/v1/lit/user/facebook_login
POST  api/sns/v1/lit/user/tiktok_login
POST  api/sns/v1/lit/get_sms_code
GET   api/sns/v1/lit/user/logout
GET   api/sns/v1/lit/user/get_info/{userId}
POST  api/sns/v1/lit/user/openim_login        (q00/c.java)
GET   api/sns/v1/lit/account/account_info
POST  api/sns/v1/lit/account/buy_product
GET   api/sns/v1/lit/account/products
```
> Tổng **713 endpoint** (plaintext, không mã hoá) — danh mục theo nhóm ở [workflows/04-danh-muc-api.md](workflows/04-danh-muc-api.md), danh sách đầy đủ [data/endpoints.txt](data/endpoints.txt).

## C. Địa chỉ hàm native quan trọng (`libliteye.so`, image base 0x100000)

| Hàm | vaddr | Ghi chú |
|---|---|---|
| `JNI_OnLoad` | `0x1b2cf4` | `RegisterNatives(.., 0x2a75f8, 6)` |
| `_INIT_2` (ctor dựng bảng JNI) | `0x1acc5c` | Tên method XOR |
| Bảng JNINativeMethod | `0x2a75f8` | 6 entry × 24 byte (.bss, điền runtime) |
| `detect` | `0x1adda8` | eye blob |
| `dfpToken` | `0x1adc00` → `0x1dc0e0` | Widevine |
| `siua` | `0x1ae50c` → `0x1be208` | ~60 hàm dò |
| `litSign` | `0x1ae644` | HMAC-SHA256 |
| `runtimeCheck` | `0x1aece8` | pthread `0x1aee20` |
| SHA256 init / final | `0x1bccb8` / `0x1bd188` | — |
| Collector thiết bị + blacklist | `0x1b0b54` | guard `pthread_once` `0x2a7470` |
| Khoá HMAC (rodata, XOR) | `0x11ba80` | mask `0x7d19e377ef77d117` |

## D. Khoá & hằng số đã lộ
- **Khoá HMAC-SHA256** (`litSign`): `happy0litmatch1` (ASCII).
- XOR mask khoá: `0x7d19e377ef77d117`.
- SHA-256 init H0–H7: `6a09e667 bb67ae85 3c6ef372 a54ff53a 510e527f 9b05688c 1f83d9ab 5be0cd19`.

## E. Lưu trữ cục bộ
| Nơi | Nội dung |
|---|---|
| MMKV `litmatch_key_info` | `KeyInfo{session, password(Easemob), user_id}` |
| MMKV `construct_liteye_id` key `eye_id` | `EyeDfpId{dfpId, ver, exp}` (X-DFPID cache) |
| `files/crashDump/` | Breakpad crash dump |

## F. Tệp liên quan trong repo
- [`../base-decompiled/`](../base-decompiled/) — Java decompiled + resources.
- [`../native/libliteye.so`](../native/libliteye.so) — native lib.
