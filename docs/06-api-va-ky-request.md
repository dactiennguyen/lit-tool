# 06 — API & Ký request (bảo mật tầng mạng)

> Tài liệu hoá toàn bộ cách Litmatch dựng, trang trí và **ký** một request HTTP: endpoint, common params, và chính xác chỗ chèn `litSign` / `sts-sign` / `X-DFPID` / `X-SIUA` / `X-Application-Info`. Tất cả từ phân tích tĩnh `base-decompiled/` + 2 native lib `libguard.so`, `libliteye.so`.

## 0. TL;DR — một request "đủ giáp" gồm gì

Mỗi API call đi qua một chuỗi OkHttp `Interceptor`. Sau khi qua hết chuỗi, request mang:

| Loại | Tên | Nguồn | Mục đích |
|---|---|---|---|
| Query | `litTS` | `EyeConnector.currentTimeMillis()` | timestamp (ms) chống replay |
| Query | `litUA` | MD5(header `User-Agent`) → 32 hex | ràng buộc UA |
| Query | `litNO` | `UUID.randomUUID()` | nonce |
| Query | `litVS` | hằng `"1.0.5"` | version lược đồ |
| Query | `litCK` | `""` (để trống/ dự phòng) | — |
| Header | `X-DFPID` | `EyeConnector.getDfpId()` (**libliteye**) | device fingerprint / integrity token |
| Header | `X-SIUA` | `EyeConnector.fetchSIUA()` (**libliteye**) | token chống‑tamper (root/frida/hook…) |
| Header | `litSign` | `LibGuard.getSignCode(ctx, litTime)` (**libguard**) | **chữ ký request chính** |
| Header | `sts-sign` | `LibGuard.getHMac256SignCode(ts+"_"+uuid)` (**libguard**) | HMAC256, chỉ khi URL có query `uuid` |
| Header | `X-Application-Info` | `LibGuard.encodeShadowContent(url, 3)` (**libguard**) | URL request đã mã hoá ("shadow") |
| Header | `ts` | `lx.c.a()` = giây (server‑synced) | timestamp giây |
| Header | `litTime` | `lx.c.b()` = ms (server‑synced) | timestamp ms (đầu vào của `litSign`) |
| Header | `X-request-Id` | `UUID.randomUUID()` | trace id |

→ **Hai native lib độc lập cùng bảo vệ 1 request**: `libguard.so` lo **chữ ký** (litSign/sts-sign/shadow), `libliteye.so` lo **danh tính & độ "sạch" thiết bị** (X-DFPID/X-SIUA + 5 query `lit*`).

## 1. Host & định tuyến domain

- Host API chính: **`https://prod.litmatchs.com`**, tiền tố path `/api/ms` (bảng `TransferDomain("/api/ms", "https://prod.litmatchs.com")` trong `a00/b.java` → `TransferDomainList`).
- Hạ tầng theo vùng: `ksztagent.com`, `ksztin.com` (vd `py3-lit.ksztin.com`), `activity.static.ksztagent.com` (webview hoạt động/sự kiện).
- OpenIM (vùng PH): `https://openim.ksztagent.com/api` (`q00/e.java`).
- CDN tài nguyên (`ns/y1.java`): ảnh `.../lit/image/`, ảnh nhỏ `.../lit/simage/`, audio `.../lit/audio/`, video `.../lit/video/`, oss zip `.../lit/oss/zip/`.
- ⚠️ Phần lớn chuỗi URL hiện ra là **`"oh"`** trong code decompiled — đó là **chuỗi bị mã hoá**, chỉ **giải mã lúc runtime** qua `b0.p(<cipher>, <key>)` (xem `b00/f.java`: `y1.c = b0.p(strD, oh)`). Nên không enum tĩnh đầy đủ URL được; muốn lấy URL thật phải đọc runtime (hook `HttpUrl`/`Request.url()`).

## 2. Tầng Retrofit

Annotation Retrofit bị đổi tên (R8):

| Obfuscated | Gốc (retrofit2.http) |
|---|---|
| `is0.f("path")` | `@GET` |
| `is0.o("path")` | `@POST` |
| `is0.a` | `@Body` |
| `is0.h(method=..., path=..., hasBody=...)` | `@HTTP` (vd DELETE có body) |
| `is0.t`, `is0.s`, `is0.u`… | `@Query`, `@Path`, `@QueryMap`… |

Interface service nằm rải rác hàng chục package obfuscated (`a30/f`, `a60/r`, `b20/q`, `ba0/a`, `c10/a`, `com/lit/app/party/*`, `com/lit/app/im/sdk/*`, `com/lit/app/model/*`…). API chung dạng `/api/sns/v1/lit/...` ("sns" = social, v1).

### Endpoint đăng nhập (đọc được — `va0/a.java`)
Khớp với [02-login-session](02-login-session.md):

| Method | Path | Body |
|---|---|---|
| POST | `/api/sns/v1/lit/user/phone_login` | `Map<String,String>` |
| POST | `/api/sns/v1/lit/user/email_login` | `Map<String,String>` |
| POST | `/api/sns/v1/lit/user/google_login` | `Map<String,String>` |
| POST | `/api/sns/v1/lit/user/facebook_login` | `Map<String,String>` |
| POST | `/api/sns/v1/lit/user/tiktok_login` | `Map<String,String>` |
| POST | `/api/sns/v1/lit/get_sms_code` | `GetSmsCode` |
| GET | `/api/sns/v1/lit/user/device_login_accounts` | — |
| GET | `/api/sns/v1/lit/user/logout` | — |

(Các path login là số ít chuỗi để plaintext; đa số endpoint khác bị mã hoá → `"oh"`.)

## 3. Timestamp đồng bộ server (`lx/c.java`)

Chống replay dựa trên đồng hồ đã hiệu chỉnh theo server (offset `f63010b` cập nhật từ server):
```java
public static long b() { return System.currentTimeMillis() + f63010b; } // ms  → litTime, litTS
public static long a() { return b() / 1000L; }                           // giây → ts
```
`litSign` nhận đầu vào `litTime` (ms server‑synced) ⇒ chữ ký gắn chặt với thời điểm server.

## 4. libliteye — `X-DFPID`, `X-SIUA`, query `lit*`

### 4.1. EyeQueryInterceptor → thêm 5 query (`EyeSecureQuery.addQueryDecoration`)
`litTS` (ms) · `litUA` = MD5(User‑Agent) 32‑hex · `litNO` = UUID · `litVS` = `"1.0.5"` · `litCK` = `""`.

### 4.2. EyeInterceptor → thêm 2 header
```java
builder.a("X-DFPID", EyeConnector.getInstance().getDfpId());
builder.a("X-SIUA", EyeConnector.getInstance().fetchSIUA());
```

### 4.3. Vòng đời `X-DFPID` (`EyeConnector`)
- `getDfpId()` trả `dfPID` (server cấp) nếu còn hạn; hết hạn (`isExpired()` so với `exp`) → `fetchEyeToken()` làm mới. Nếu chưa có → fallback `localDfpToken = litEyeApi.dfpToken()` (**native dfpToken**, fingerprint cục bộ Widevine).
- `fetchEyeToken()` chạy nền: `litEyeApi.fetchEyeToken()` sinh **blob detect** (native, xem [04](04-chi-tiet-detect-va-chong-cheat.md)) → `EyeRequest.call(blob)` POST lên server (`/api/sns/v1/lit/eye`) → nhận `{data:{dfpId, ver, exp}}` (`EyeDfpId`).
- **Cache**: MMKV id **`construct_liteye_id`**, key **`eye_id`** = JSON `EyeDfpId`. Nạp lại lúc `init()` nếu `currentTimeMillis() < exp`.
- `isEnable()`: chỉ tắt khi `debug && Build.MODEL` chứa `"Android SDK built for x86"` (emulator) → tức **luôn bật trên máy thật**.
- `X-SIUA` = `litEyeApi.fetchSIUA()` (native **siua**) chỉ khi `enableSIUA()`.

## 5. libguard — ký request chính (`c00/a.java`, case mặc định)

`LibGuard` = JNI bridge của **`libguard.so`** (918 KB, nạp dưới tên `"guard"`). Native methods:
```java
native String getSignCode(Context ctx, long time);   // litSign
native String getHMac256SignCode(String s);           // sts-sign
native String encodeShadowContent(String s, int m);   // X-Application-Info
native String decodeShadowContent(String s, int m);
native String getToken(String s);
native void   initLib(Context ctx);
```

Interceptor ký (rút gọn):
```java
long jB = lx.c.b();                 // litTime (ms, server-synced)
String ts = lx.c.a() + "";          // ts (giây)
String signCode = LibGuard.b().getSignCode(k.p(), jB);   // k.p() = Application
String strH = request.url().toString();
if (!TextUtils.isEmpty(strH)) strH = LibGuard.b().encodeShadowContent(strH, 3);

builder.a("ts", ts);
builder.a("litTime", String.valueOf(jB));
builder.a("litSign", signCode);
builder.a("X-request-Id", UUID.randomUUID().toString());

String uuid = <giá trị query "uuid" nếu có>;
if (uuid != null) builder.a("sts-sign", LibGuard.b().getHMac256SignCode(ts + "_" + uuid));

if (!z.f3789a.f37115b) builder.a("X-Application-Info", strH);  // URL đã "shadow"
```

### AES helper (cùng file, `a(data, key)`)
`AES/CBC/PKCS5` với **IV cố định `"abcdef1234567890"`**, key truyền vào, output `Base64(url‑safe, no‑wrap)`. Dùng mã hoá một số payload/field phụ.

> Lưu ý: header tên `litSign` ở đây **do libguard sinh**, KHÁC với native method `LitEye.litSign` (HMAC‑SHA256 key `happy0litmatch1`) trong libliteye — cái của liteye dùng nội bộ cho chính request của liteye. Tức có **2 "litSign" khác nguồn**; header request chính = libguard.

## 6. Kho native lib liên quan bảo mật (trong APK)

| .so | Vai trò |
|---|---|
| `libguard.so` | Ký request: `getSignCode`/`getHMac256SignCode`/`encodeShadowContent` |
| `libliteye.so` | Anti‑fraud / device integrity: detect, dfpToken, siua, runtimeCheck (xem [03](03-liteye-native.md)) |
| `libpglarmor.so` + `libbuffer_pgl.so` + `libfile_lock_pgl.so` | **App armor / hardening** (packer/bảo vệ runtime) |
| `libipdetector.so` | Dò IP (proxy/VPN) |
| `libcipherdb.so` | DB mã hoá |
| `libmmkv.so` | Lưu trữ MMKV (gồm `construct_liteye_id`, `litmatch_key_info`) |
| `libagora-*`, `libliteavsdk.so`, `libtxffmpeg.so` | Voice/RTC (Agora + Tencent LiteAV) |
| `libhyphenate.so` | IM (Easemob/Hyphenate) |

## 7. Mã lỗi nghiệp vụ (`com.litmatch.network.a`)

Xử lý tập trung (`a00/i.java` case 10): `-280` (đăng xuất/`z.B()`), `-218`, `-195`/`-101` (hiện dialog `ll.m.o`). Lỗi môi trường thiết bị khi login = **1112** (kèm nonce `1112-<n>`) — server trả về sau khi đọc `X-DFPID`/`X-SIUA`/detect (xem [05](05-moi-truong-phan-tich.md)); đã xác minh nguyên nhân chặn trên máy này là **chạy ở user phụ (user 10)**, không phải root.

## 8. Cách kiểm chứng (runtime)

- Xem header/param thật: hook `okhttp3.Interceptor` hoặc `Request.Builder.build`/`HttpUrl` bằng frida, in `request.headers()` + `request.url()`.
- Xem đầu vào chữ ký: hook `com.litatom.libguard.LibGuard.getSignCode(Context,long)` và `getHMac256SignCode(String)` (Java) để log tham số + kết quả.
- Xem token liteye: hook `EyeConnector.getDfpId()` / `fetchSIUA()`.
- Giải mã URL "shadow": gọi `LibGuard.decodeShadowContent(x, 3)` (hàm ngược của encode).
- Lưu ý: hook bằng frida sẽ bị liteye/siua gắn cờ (xem [05](05-moi-truong-phan-tich.md)); để chỉ *quan sát* thì chấp nhận login fail cũng không sao.
