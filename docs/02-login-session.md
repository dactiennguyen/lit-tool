# 02 — Luồng Login & Session

## 1. Các phương thức đăng nhập
Định nghĩa trong interface Retrofit [`va0/a.java`](../base-decompiled/sources/va0/a.java) (`is0.o`=`@POST`, `is0.f`=`@GET`, `is0.a`=`@Body`). Mọi hàm login gắn annotation marker `@com.litmatch.network.c`.

| Phương thức | Endpoint | Body |
|---|---|---|
| Điện thoại | `POST api/sns/v1/lit/user/phone_login` | `Map<String,String>` (zone, phone, code...) |
| Email | `POST /api/sns/v1/lit/user/email_login` | `Map<String,String>` |
| Google | `POST api/sns/v1/lit/user/google_login` | `Map` (idToken) |
| Facebook | `POST api/sns/v1/lit/user/facebook_login` | `Map` |
| TikTok | `POST api/sns/v1/lit/user/tiktok_login` | `Map` |
| Gửi SMS OTP | `POST api/sns/v1/lit/get_sms_code` | `GetSmsCode{zone, phone, login}` |
| Đăng xuất | `GET api/sns/v1/lit/user/logout` | — |
| Thiết bị đã login | `GET /api/sns/v1/lit/user/device_login_accounts` | — |

**Luồng OTP điện thoại** ([`VerifyCodeActivity.java:210`](../base-decompiled/sources/com/lit/app/ui/login/VerifyCodeActivity.java#L210)):
```
PhoneLoginActivity → get_sms_code → nhập mã → phone_login → UserInfo
```

## 2. Tạo & lưu session
Login thành công trả về `UserInfo` chứa field `session`. Xử lý tại [`com/lit/app/model/b0.java`](../base-decompiled/sources/com/lit/app/model/b0.java):

```java
// b0.d(UserInfo) — gọi sau khi login OK
session  = info.getSession();
password = info.getHuanxin().getPassword();   // mật khẩu Easemob/Huanxin
user_id  = info.getUser_id();
f30018a  = new KeyInfo(session, password, user_id);   // cache tĩnh
// lưu JSON vào MMKV, key "litmatch_key_info"
```

- `b0.b()` → trả `session` (chính là **`sid`**).
- `b0.c()` → trả `userId`.
- Sau khi tách, code set `session=""` trên object gốc để dọn bộ nhớ tạm.
- **Không dùng JWT** — `sid` là session token server cấp, gửi kèm mọi request.

## 3. Tham số chung mỗi request
Tiêm bởi SDK liteye qua `EyeContext.httpParams()` tại [`dt/d.java:422`](../base-decompiled/sources/dt/d.java#L422):

| Key | Nguồn |
|---|---|
| `sid` | `b0.b()` (session) |
| `uuid` | `ll.g.A()` |
| `loc` | vị trí |
| `version` | app version |
| `lang` | ngôn ngữ |
| `platform` | `"android"` |
| `model` | model máy |
| `os` | `Build.VERSION.SDK_INT` |
| `nettype` | wifi/4g/5g... |
| `appid` | app id |
| `han` | tuỳ điều kiện |

## 4. Header chống gian lận (liteye)
Interceptor [`com/construct/liteye/EyeInterceptor.java`](../base-decompiled/sources/com/construct/liteye/EyeInterceptor.java) tự thêm vào **mọi request**:

| Header | Nguồn | Chi tiết |
|---|---|---|
| `X-DFPID` | `EyeConnector.getDfpId()` | Device fingerprint id (server cấp) |
| `X-SIUA` | `EyeConnector.fetchSIUA()` | Token toàn vẹn/chống gian lận |

→ Cơ chế sinh 2 token này nằm trong native `libliteye.so`, xem [03-liteye-native.md](03-liteye-native.md).

## Sơ đồ
```
PhoneLoginActivity ──get_sms_code──► server
     │ nhập OTP
     ▼
VerifyCodeActivity ──phone_login──► server ──► UserInfo{session,user_id,huanxin.password}
     │
     ▼
b0.d() → KeyInfo → MMKV "litmatch_key_info"
     │
     ▼ mỗi request sau đó:
liteye httpParams(): sid, uuid, loc, version, ...
EyeInterceptor headers: X-DFPID, X-SIUA
(riêng request được ký: litSign — xem doc 03)
```
