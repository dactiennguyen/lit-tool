# 11 — Gọi API sau khi đã đăng nhập (authenticated request)

> **Cập nhật 13/11/2026:** Đã quan sát được request sau đăng nhập và thử gọi
> thực tế các GET bằng phiên user 10. Xem [tài liệu 14](14-api-khoi-dong-va-script.md)
> để biết kết quả, tham số và giới hạn; ví dụ và kết luận chưa kiểm chứng dưới
> đây giữ lại làm lịch sử phân tích.

> Sau khi login thành công, mỗi request tới `prod.litmatchs.com` mang **session + đầy đủ chữ ký**. Tài liệu dựng từ mã interceptor (đã verify chéo 4 agent) + **giá trị ký thật** bắt được runtime. Xem thuật toán ký ở [06](06-api-va-ky-request.md)/[07](07-libguard-getsigncode.md), anti-fraud [08](08-liteye-native-returns.md).

> **Lưu ý trung thực:** login trên máy test bị chặn **1112** (user 10, xem [09](09-luong-dang-nhap.md)), nên mình **chưa bắt được response của một endpoint đã‑đăng‑nhập thật**. Phần dưới: cấu trúc request = **đã xác thực** (từ mã + các request *trước login* thật sự fire mang `litSign`/`sts-sign`/`X-DFPID`); chỉ riêng `sid` + `lit-user-id` là **minh hoạ** (giá trị thật chỉ có sau khi server cấp `session`).

## 1. Có gì KHÁC so với trước login?
Chuỗi ký/interceptor **y hệt** request login. Sau login chỉ **thêm 2 thứ** (vì đã có `session`):
- query **`sid`** = `b0.b()` (session token server cấp, lưu plaintext MMKV `litmatch_key_info`).
- header **`lit-user-id`** = user id.

Mọi thứ còn lại (`litSign`, `sts-sign`, `X-Application-Info`, `X-DFPID`, common params, `litTS/litUA/litNO/litVS/litCK`) đã có từ trước login.

## 2. Giải phẫu một request đã‑đăng‑nhập (ví dụ)
Ví dụ `GET api/sns/v1/lit/user/info` (lấy hồ sơ) — mọi GET/POST khác cùng khuôn:

```http
GET https://<domain>/api/sns/v1/lit/user/info
    ?sid=<session b0.b()>                 ← CHỈ có sau login
    &uuid=966bbd0563ea67e3                 ← android_id (ll.g.A())
    &version=7.77.0 &lang=vi &platform=android
    &model=M2101K7BG &os=33 &loctype=.. &net_type=wifi &appid=.. &app_source=..
    &litTS=1794489874820                   ← ts (EyeSecureQuery)
    &litUA=<MD5(User-Agent)>
    &litNO=<UUID nonce ngẫu nhiên>
    &litVS=1.0.5 &litCK=

Headers:
    lit-user-id: <user_id>                 ← CHỈ có sau login
    v-mode: 0                               ← cờ VPN
    ts: 1794489874                          (giây)
    litTime: 1794489874820                  (ms, lx.c.b() đồng bộ server)
    litSign: MXxjMmU2MzRmYmJhMDMyZDZmMDNkN2NmMDdhMjUzZDNhMA==
             = base64("1|" + md5(litTime + "1" + "R@s9!bu8"))
    X-request-Id: <UUID>
    sts-sign: MDBhMjFk…                     = base64(hex(HMAC-SHA256("I am your father", "1794489874_966bbd0563ea67e3")))
    X-DFPID: 4TdafYa7HKc7Qaao+gwWmH5YHZTrVFrAbanRgg1XwaN0BrpRdsYAb9+BQglAH7ENDKYv+/H7j9DCbO147//oug==
    X-Application-Info: <encodeShadowContent(query/body, mode 3)>   = base64url(AES-256-CBC(…)‖IV)
    fingerprint: <AES(mode1, {"uuid":…})>   ← chỉ các endpoint auth/guardUrls
    X-SIUA: <tắt — enableSIUA()=false>
    Content-Type: application/json; charset=UTF-8   (nếu POST)
```

Các giá trị `litSign`/`sts-sign`/`X-DFPID` ở trên là **thật** (ground-truth, JS reimpl == native byte‑for‑byte; `litSign` luôn mở đầu `MXw` = "1|" với APK gốc). `sid`/`lit-user-id` minh hoạ.

## 3. Ai tạo header nào (interceptor order)
| Interceptor | File | Thêm |
|---|---|---|
| Common params | `a00/l.java` | query `sid,uuid,version,lang,platform,model,loctype,os,net_type,appid,app_source,han` + header `lit-user-id`,`v-mode`; header `fingerprint` (chỉ endpoint auth) |
| Eye headers | `com/construct/liteye/EyeInterceptor.java` | `X-DFPID`, `X-SIUA`(off) |
| Eye query sign | `EyeQueryInterceptor`/`EyeSecureQuery` | query `litTS,litUA,litNO,litVS,litCK` |
| Guard sign | `c00/a.java` | `ts,litTime,litSign,X-request-Id,sts-sign,X-Application-Info` |

> `sid` đi ở **query** (không phải header `Authorization`). Không có Bearer/OAuth token nào; "token" của session = chuỗi `session` do server cấp.

## 4. Sequence — một API call sau login
```mermaid
sequenceDiagram
    autonumber
    participant App as App code
    participant L as a00/l.java (common)
    participant EQ as EyeQueryInterceptor
    participant E as EyeInterceptor
    participant C as c00/a.java (libguard)
    participant S as prod.litmatchs.com

    App->>L: Request(api/sns/v1/lit/...)
    L->>L: +query sid=b0.b(), uuid, model, os…<br/>+header lit-user-id, v-mode
    L->>EQ: chain
    EQ->>EQ: +query litTS, litUA=MD5(UA), litNO, litVS=1.0.5, litCK
    EQ->>E: chain
    E->>E: +header X-DFPID = getDfpId()
    E->>C: chain
    C->>C: litTime=lx.c.b(); litSign=getSignCode(ctx,litTime)
    C->>C: sts-sign=getHMac256SignCode(ts+"_"+uuid)
    C->>C: X-Application-Info=encodeShadowContent(nội dung,3)
    C->>S: GET/POST + tất cả header/query
    S-->>App: Result{success, result, data<T>}
    Note over App,S: result!=0 & !success → d30/c.java → onFail(code,msg)<br/>-210 reauth · -200 deactivate · 1112 môi trường bất thường
```

## 5. Response envelope (mọi API)
`com/litmatch/network/Result<T>`:
```json
{ "success": true, "result": 0, "message": "", "data": { … }, "diamonds": 0, "changed": false, "activity": "", "hash_code": "", "other_info": "" }
```
- `result` = mã ứng dụng (0 = OK); `!success` → `d30/c.java` ném `com.litmatch.network.a(result,message,…)` → callback `onFail(result, message)`.
- Converter `bg0/c.java`: endpoint `@c` (5 endpoint login) giữ **raw body** để parse lại; còn lại parse thẳng `data<T>`.
- Một số response có **body mã hoá** → giải bằng `decodeShadowContent(x, mode)` (mode 3/5; xem `fk/d.java`, `cg0/a.java`, [07](07-libguard-getsigncode.md) §4.2).

## 6. Vòng đời session
- Lưu: login OK → `b0.d(UserInfo)` → `KeyInfo{session,hxPwd,userId}` → Gson JSON **plaintext** MMKV `litmatch_key_info`.
- Dùng: `b0.b()`=sid (query mỗi request), `b0.c()`=userId (header `lit-user-id`).
- **Không refresh**: `session` là chuỗi dài hạn, không có endpoint renew; chỉ xoá khi logout (`GET user/logout` → remove key).
- Đổi tài khoản: re‑login account khác → server cấp `session` mới → ghi đè (chỉ 1 session active).
