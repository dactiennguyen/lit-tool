# Traffic quan sát khi mở app (capture thật)

Litmatch `com.litatom.app` 7.77.0, Android user 10, 2026-11-13. Thu bằng hook
**`libssl.so!SSL_write`** (đọc HTTP plaintext **trước khi mã hoá TLS**) qua Frida
race-attach (frida-server 17.23.3 + driver Python giữ kết nối, attach ngay lúc
app sinh). Dữ liệu dưới đây từ **một lượt ~22s** kể từ lúc mở app.

## Giới hạn quan trọng
- **Java bridge MẶC ĐỊNH của Frida không lên** (anti-frida/ART) → lượt này hook
  **native SSL_write**. Attach cũng **chập chờn** (có lượt `unexpected crash while
  allocating memory`), phải retry. *(Về sau đã hook được tầng Java bằng bridge vá
  JNI reflection ở frida 17.10 — xem [doc 17](../17-hook-java-frida.md) và
  [api-headers-response.json](api-headers-response.json) có header thật.)*
- **Core API `www.litatom.com` đi HTTP/2** ⇒ header bị **HPACK nén** (gói nhị
  phân, SSL_write không đọc thẳng được). Chỉ các host **HTTP/1.1** đọc được header
  đầy đủ. Vì vậy header core API bên dưới lấy từ **RE interceptor + test thật**,
  không phải đọc trực tiếp HTTP/2.

## Host quan sát lúc startup
Phần lớn traffic mở app là **SDK quảng cáo/analytics bên thứ 3**, không phải API Litmatch.

| Host | Loại | Giao thức | Ghi chú |
|---|---|---|---|
| `www.litatom.com` | **Core API** (`/api/sns/v1/lit/*`) | HTTP/2 | header HPACK (không đọc thẳng) |
| `baishan.litatom.com` | CDN media (ảnh/webp/video) | HTTP/1.1 | header `_o_data_`, **không** qua chuỗi ký |
| `ss.litatom.com` | Analytics ThinkingData (`/sync`) | HTTP/1.1 | header `TA-*` |
| `*.pangle.io` | Quảng cáo Pangle/TikTok | HTTP/1.1 | `ssdk/sd/token`, `api/ad/union/sdk/*` |
| `*.applovin.com` | Quảng cáo AppLovin | HTTP/1.1 | `/5.0/i`, `/4.0/pix`, `/2.0/device` |
| `cdn2.inner-active.mobi` | Cấu hình ad | HTTP/1.1 | `ia-sdk-config/*` |
| `googleads.g.doubleclick.net`, `cdn-f.adsmoloco.com` | Quảng cáo Google/Moloco | HTTP/1.1 | |

Danh sách host/path sanitized: [`startup-traffic-observed.json`](startup-traffic-observed.json).

## Header của core API — "cần những gì" (thực tế)

Câu hỏi "tưởng call API cần nhiều header hơn?" — phân biệt **app GẮN gì** vs
**server BẮT BUỘC gì**:

### App gắn gì (chuỗi interceptor, [doc 06](../06-api-va-ky-request.md)/[14 §1](../14-api-khoi-dong-va-script.md))
- **query**: `sid, uuid, loc, version, lang, platform, model, loctype, os, net_type, app_source, appid, han`
- **header**: `lit-user-id`, `v-mode`, `ts`, `litTime`, `litSign`, `X-request-Id`, `sts-sign`, `X-Application-Info`, `X-DFPID` (+`X-SIUA` khi server bật), `fingerprint` (endpoint auth)

### Server bắt buộc gì (kiểm chứng thật — gọi độc lập)
| Nhóm endpoint | Tối thiểu server chấp nhận | Bằng chứng |
|---|---|---|
| GET đọc thường (feed/tags, home/*, …) | chỉ **`sid`** | 20/24 API trả `success=true` chỉ với `sid` ([doc 14 §3](../14-api-khoi-dong-va-script.md)) |
| `account/account_info` | `sid` + **`X-Application-Info`** (+`X-request-Id` để giải response) | bỏ `X-Application-Info` → `result=-9`; đủ → HTTP 200 `success=true`. Chạy thật `account-info.js` |
| Login/auth (google_login…) | đủ chuỗi ký: `litSign`, `sts-sign`, `X-DFPID`, `fingerprint`, `X-Application-Info` | [doc 09](../09-luong-dang-nhap.md)/[13](../13-google-login-hai-truong-hop.md) |

→ **App gửi rất nhiều header, nhưng server chỉ bắt buộc một tập con tùy endpoint.**
API đọc thường chỉ cần `sid`; `account_info` thêm `X-Application-Info`; chỉ
login/ghi/anti-fraud mới cần đủ `litSign`/`X-DFPID`/`fingerprint`.

> ⚠️ **BẮT BUỘC thêm `litSign` + `X-DFPID` + `X-SIUA`** (cùng `ts`/`litTime`/`sts-sign`/`X-Application-Info`)
> để request **giống app thật** và cho **login + endpoint nhạy cảm/ghi**. Replay
> chỉ-`sid` chạy được cho vài GET đọc, **nhưng thiếu các header này là bất thường
> về phía server** (anti-fraud có thể gắn cờ) — **không nên bỏ** khi dựng request.
> Giá trị đổi **mỗi request**: `litSign`/`ts`/`litTime`/`X-request-Id`/`sts-sign`/`X-Application-Info`
> do `libguard.so` tạo lúc gửi; `X-DFPID`/`X-SIUA` do native Eye cấp. Xem header
> thật đầy đủ: [api-headers-response.json](api-headers-response.json).

## `account/account_info` — bộ header thật đã xác nhận
Từ [`account-info.js`](../../scripts/account-info.js) (chạy thật → HTTP 200, `success=true, result=0`):
- **query**: `uuid`, `version`, `platform`, `sid`
- **header**: `X-Application-Info` = `encodeShadowContent(query_string, 3)`, `X-request-Id` = UUID
- **response**: mã hoá (`X-Is-Enc`), giải bằng `decodeShadowContent(x,3)` + đối chiếu `X-request-Id` ([cg0/a.java](../../base-decompiled/sources/cg0/a.java))

> Danh sách đầy đủ endpoint: [endpoints.txt](endpoints.txt) (713). Endpoint startup: [doc 14](../14-api-khoi-dong-va-script.md) (30). Phương pháp hook: [doc 14 §6](../14-api-khoi-dong-va-script.md).
