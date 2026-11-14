# Workflow — Tổng quan login + ký/gửi request

> Nguồn: `docs/09`, `docs/11`, interceptor `c00/a.java` · `a00/l.java` · `EyeSecureQuery.java`.

## 1. Luồng login tổng quan

```mermaid
flowchart TD
    A([Mở app]) --> B1[libguard.so<br/>ký request]
    A --> B2[libliteye.so<br/>anti-fraud]
    B2 --> C["detect(): zlib → AES-128-CBC → base64"]
    C -->|"POST cloud.litatom.com<br/>/api/sns/v1/lit/eye"| D{{"← X-DFPID<br/>cache MMKV ~24h"}}
    D --> E[Màn login → Google one-tap<br/>→ Google ID token JWT]
    E -->|"body {token: JWT}"| F[POST /api/sns/v1/lit/user/google_login<br/>qua 4 interceptor ký]
    B1 -.ký.-> F
    F --> G{{"SERVER chấm điểm môi trường<br/>đọc X-DFPID"}}
    G -->|sạch| H["Result{data: UserInfo{session}}<br/>→ connect IM → lưu session → vào app"]
    G -->|"môi trường bất thường"| I["result = 1112<br/>toast 'Mã 1112-&lt;nonce&gt;'"]

    style H stroke:#15855a,stroke-width:2px
    style I stroke:#c23539,stroke-width:2px
    style F stroke:#2460c4,stroke-width:2px
```

## 2. Chuỗi 4 interceptor ký mỗi request

```mermaid
flowchart LR
    R([Request<br/>/api/sns/v1/lit/…]) --> I1
    I1 --> I2 --> I3 --> I4 --> S([prod.litmatchs.com])

    I1["<b>1 · Common</b><br/>a00/l.java<br/>───<br/>query: sid, loc, uuid, version,<br/>model, os, net_type, appid…<br/>header: lit-user-id, v-mode,<br/>fingerprint*"]
    I2["<b>2 · Eye query</b><br/>EyeSecureQuery<br/>───<br/>query: litTS, litUA=MD5(UA),<br/>litNO, litVS=1.0.5, litCK"]
    I3["<b>3 · Eye header</b><br/>EyeInterceptor<br/>───<br/>header: X-DFPID<br/>(X-SIUA tắt)"]
    I4["<b>4 · Guard sign</b><br/>c00/a.java · libguard.so<br/>───<br/>header: ts, litTime, litSign,<br/>X-request-Id, sts-sign,<br/>X-Application-Info"]
```

`*fingerprint` chỉ thêm cho endpoint auth (`get_sms_code`, `*_login`, `user/info`).

## 3. Bốn chữ ký — thuật toán

| Header | Công thức | Khóa / ghi chú |
|---|---|---|
| `litSign` | `base64("1\|" + md5(litTime + "1" + "R@s9!bu8"))` | salt `R@s9!bu8`; luôn mở đầu `MXw` |
| `sts-sign` | `base64(hex(HMAC-SHA256(key, ts+"_"+uuid)))` | key = `I am your father` (16B) |
| `X-Application-Info` | `base64url(AES-256-CBC(query_string) ‖ IV)` | mode 3, key `f1c9…3cd4`, IV random nối đuôi |
| `fingerprint` | `AES-256-CBC({"uuid":…})`, IV `abcdef1234567890` | mode 1, key `CB7F…5C0F`; chỉ endpoint auth |
| `X-DFPID` | server cấp qua `POST /api/sns/v1/lit/eye` | device fingerprint 198 trường, ~24h |

**1112** = verdict của **server** (không phải client chặn — đã xác nhận: không có gate client). Server đọc `X-DFPID` rồi chấm "bất thường", **nhưng không trả lý do cụ thể**. Giả thuyết hàng đầu (H1): tín hiệu user phụ không giấu được (`dual_app=1`, `uid=1010318`, `installed_from_google=0`). Confound chưa loại (H2): thiết bị đã bị blacklist từ ban user 0. Chi tiết + cách phân biệt: [../data/README.md](../data/README.md) §6.
