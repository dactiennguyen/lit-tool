# 07 — `libguard.so`: thuật toán `getSignCode` (header `litSign`)

> Mổ tĩnh `libguard.so` (ARM64, 918 KB, trong `split_config.arm64_v8a.apk`) để dựng lại **chính xác** thuật toán sinh header `litSign` — chữ ký request chính của Litmatch (xem chuỗi interceptor ở [06](06-api-va-ky-request.md)).

## 0. Vì sao dễ hơn `libliteye`
Khác với `libliteye.so` (strip sạch, JNI đăng ký động, tên XOR), **`libguard.so` KHÔNG strip**: export đủ hàm JNI + symbol C++ demangle được. Nhờ đó đọc thẳng được cấu trúc.

| Symbol | Addr (file / ghidra) | Vai trò |
|---|---|---|
| `Java_..._getSignCode` | `0x68d50` / `0x168d50` | header `litSign` |
| `Java_..._getHMac256SignCode` | `0x692f8` / `0x1692f8` | header `sts-sign` |
| `Java_..._encodeShadowContent` | `0x697f4` | header `X-Application-Info` |
| `Java_..._getToken` | `0x69528` / `0x169528` | giải mã token Agora RTC/RTM (mode 2) |
| `lit::tools::decrypt(string,int)` | `0x1718e8` | base64url-decode → AES-CBC-decrypt |
| `getSha1(JNIEnv*, jobject)` | `0x69e30` | SHA1 chữ ký APK |
| `checkValidity(JNIEnv*, char*)` | `0x6a5b8` | so sánh sha1 ↔ `realSha1` |
| `lit::tools::sign(string,int)` | `0x71d64` | core sign |
| `lit::tools::sign_hmac(string,int)` | `0x71990` | core HMAC |
| `MD5::hexdigest()` + free `md5(string)` | `0x16b74c` / `0x16b9cc` | MD5 → hex |
| `base64_encode(string,bool)` | `0x16c9d8` | base64 chuẩn |

## 1. Thuật toán `getSignCode`

```
litSign = base64( s + "|" + md5_hex( to_string(litTime) + s + "R@s9!bu8" ) )
```

Đầu vào Java: `getSignCode(Context ctx, long litTime)` — `litTime` = epoch **ms** đã đồng bộ server (`lx.c.b() = System.currentTimeMillis() + offset`).

### Các hằng số (đọc từ `.rodata`)
| Ý nghĩa | Giá trị | Nguồn |
|---|---|---|
| salt (pepper, nối đuôi) | `R@s9!bu8` | inline trong `getSignCode` |
| separator | `\|` | `DAT_0x149790` |
| `s` = APK hợp lệ | `1` | `DAT_0x14978e` |
| `s` = APK bị sửa/repack | `0` | `DAT_0x149e29` |
| `s` = chưa tính được sha1 | `2` | `DAT_0x148bfe` (mặc định) |
| `realSha1` (SHA1 cert gốc) | `AB28CDBEEF107509F1824364C8CE2375CC922E15` | `0x149e2b` |

### `s` — cờ toàn vẹn chữ ký APK
```c
if (sha1 == 0) sha1 = getSha1(env, context);         // SHA1 của signing cert
s = "2";                                             // mặc định
if (sha1 != 0 && strlen(realSha1) != 0)
    s = checkValidity(env, sha1) ? "1" : "0";        // khớp realSha1 ? "1" : "0"
```
`getSha1` lấy chữ ký APK (qua `PackageManager`/`Signature`) rồi SHA1; `checkValidity` so với `realSha1` nhúng sẵn. ⇒ **chống repack**: sửa APK → chữ ký đổi → `s="0"`.

### Các bước (dựng lại từ pseudo-code `0x168d50`)
```c
timeStr = std::to_string(litTime);               // "1731..."
inner   = timeStr + s + "R@s9!bu8";              // FUN_001691dc = string(a+b), rồi append salt
h       = MD5(inner).hexdigest();                // 32 hex thường (impl Frank Thilo)
out     = s + "|" + h;                            // vd "1|<32hex>"
litSign = base64_encode(out, /*url=*/false);     // base64 chuẩn (impl R. Nyffenegger)
return env->NewStringUTF(litSign);               // JNI vtable off 0x538
```

## 2. Dấu hiệu quan sát được
Trên app **gốc** (`s="1"`): `out = "1|" + md5hex` ⇒ `litSign` **luôn bắt đầu `MXw`** (base64 của `"1|"` = `0x31 0x7C`).
- App bị **repack** (`s="0"`) ⇒ bắt đầu `MHw` (base64 `"0|"`) ⇒ server phát hiện ngay.
- Chưa tính sha1 (`s="2"`) ⇒ bắt đầu `Mnw`.

Đầu vào **động duy nhất** là `litTime`; server chỉ cần đọc header `litTime` nhận được, tự dựng lại `out` và so `litSign` (đồng thời kiểm cờ `s` phải = `"1"`).

## 3. Tái lập (Python tham khảo)
```python
import hashlib, base64
def lit_sign(lit_time_ms: int, s: str = "1") -> str:
    inner = f"{lit_time_ms}{s}R@s9!bu8"
    h = hashlib.md5(inner.encode()).hexdigest()      # 32 hex thường
    out = f"{s}|{h}"
    return base64.b64encode(out.encode()).decode()   # base64 chuẩn (có '=')

# ví dụ:
# lit_sign(1731415000000) -> "MXw..." (luôn mở đầu MXw trên app gốc)
```

## 4. Các header anh em (cùng `libguard`)

### 4.1. `sts-sign` — ĐÃ RE + verify ✅
```
sts-sign = getHMac256SignCode(input) = base64( hex( HMAC-SHA256(key, input) ) )
           input = ts + "_" + uuid        (ts = giây = litTime/1000; uuid = common param)
           key   = "I am your father"      (16 bytes, nhúng trong libguard.so)
```
- `lit::tools::sign_hmac @ 0x71990`: `hmac_sha256("I am your father", 16, msg, len, out, 32)` → 32 byte → in hex (64 ký tự thường) qua ostream `std::hex`/`setw(2)`/`setfill('0')`.
- `getHMac256SignCode @ 0x1692f8`: lấy input (jstring) → `sign_hmac` → **`base64` của chuỗi hex 64 ký tự** → `NewStringUTF`.
- Chỉ gắn header khi URL có query `uuid` (common param `dt/d.java`).

**Ground-truth đã verify** (hook native getHMac256SignCode):
`input="1794489874_966bbd0563ea67e3"` → native `MDBhMjFk…4ZGJj` = node `getHMac256SignCode(input)` (trùng khít); hex HMAC = `00a21dc2526c574a500904da19cc626d345cd469462c6ae7ea6a0a369c384dbc`.

### 4.2. `X-Application-Info` — ĐÃ RE + verify ✅ (AES-256-CBC)
```
encodeShadowContent(x, mode) = base64url( encrypt_aes_cbc( PKCS7(x), mode ) )     // SergeyBel AES-256
```
- Nếu chữ ký APK không hợp lệ (`checkValidity`=false) → trả **nguyên văn** x (không mã hoá).
- `base64_encode(..., url=true)` → base64 **URL-safe, không padding** (`-` `_`).
- Khoá AES-256 (32 ASCII byte) theo `mode` (lõi `lit::tools::encrypt_aes_cbc @ 0x1710e8`):

  | mode | key (ASCII) | IV | gói |
  |---|---|---|---|
  | 1 | `CB7F786FC0E6E105E6DA03D1FFF05C0F` | `abcdef1234567890` | ct |
  | 2 | `EIOWUGWOERGJKNLDKGJFOI879KJNSDKJ` | `abcdef1234567890` | ct |
  | **3** (X-App-Info) | `f1c9208ccd8ef6d85c44b451da593cd4` | **16B ngẫu nhiên** (srand(time), byte ASCII alnum) | **ct ‖ IV** (IV nối ĐUÔI) |
  | 4 | `AC0A60D491D9876D1012FB24DB61ADC6` | `abcdef1234567890` | ct |
  | 5 | `LTMWUGWOBNLJKIOEKGJFOI256KIOWNKF` | `abcdef1234567890` | ct |

- **mode 3** (header này): IV ngẫu nhiên (4 byte đầu = byteswap(time), 12 byte sau rand→ASCII), AES-256-CBC(PKCS7(x), key, IV) rồi **ct + IV** (IV 16 byte ở CUỐI), base64url. Decode: tách `IV=data[-16:]`, `ct=data[:-16]`, AES-CBC-decrypt, bỏ PKCS7.
- Nội dung được mã hoá = body hoặc query của request (vd `{"token":"<google JWT>"}`, hoặc `loc=..&uuid=..&version=..&model=..&appid=..`).

**Ground-truth đã verify** (hook native encodeShadowContent): `decodeShadow(output) == input` và `encodeShadow(input, IV-lấy-từ-output) == output` (trùng từng byte). Reimpl: [`../scripts/shadow.js`](../scripts/shadow.js) (dùng `crypto` built-in AES-256-CBC).

### 4.3. `getToken` — giải mã token Agora (AES-256-CBC **mode 2**) ✅
`LibGuard.getToken(String)` **không** sinh token — nó **giải mã**. Nó là wrapper tiện lợi của `decrypt` mode 2:
```
getToken(x) = decrypt(x, 2) = unPKCS7( AES-256-CBC-decrypt( base64url_decode(x), key=mode2, iv="abcdef1234567890" ) )
```
- `lit::tools::decrypt @ 0x1718e8`: `base64_decode(tmp, x, url=true)` → `decrypt_aes_cbc(out, tmp, mode)`.
- mode 2 key = `EIOWUGWOERGJKNLDKGJFOI879KJNSDKJ`, IV cố định `abcdef1234567890` (xem bảng §4.2) ⇒ **nghịch đảo của `encodeShadowContent(x, 2)`**.
- Gate chữ ký APK: nếu `sha1==0 || checkValidity()==false` → trả **nguyên văn** input (không giải mã); sau khi giải mã còn `checkUtfBytes()` — chỉ trả plaintext khi ra UTF-8 hợp lệ, ngược lại trả nguyên văn.

**Dùng ở đâu** (server trả token Agora dạng mã hoá, client giải ngay trước khi đưa vào SDK — giữ token voice/chat khỏi lộ plaintext trong response/log/MITM):

| Java | Token |
|---|---|
| `jz/k.java:232` → `joinChannel(a(str3), room, …)` | Agora **RTC** (voice call / voice match) |
| `ab0/f.java:604` → `JoinChannelOptions.token = a(token)` | Agora **RTM** (join channel) |
| `lg/c.java:544` → `rtmClient.renewToken(a(tokenBean.rtm_token), …)` | Agora **RTM** (gia hạn token) |

Reimpl: `getToken(value)` trong [`../scripts/shadow.js`](../scripts/shadow.js) = `decodeShadow(value, 2)` (verify round-trip `getToken(encodeShadow(x,2)) === x` ✅).

## 4b. Đã kiểm chứng ground-truth (frida, read-only) ✅
Hook export native `Java_com_litatom_libguard_LibGuard_getSignCode` + `_getHMac256SignCode`, đọc `jlong`/`jstring` qua `JNIEnv` vtable (`GetStringUTFChars` idx 169), bắt khi app gọi lúc google_login. Kết quả JS = native 100%:

| litTime | native/node litSign |
|---|---|
| `1794489514397` | `MXw3YTNiM2Q3NzU3OGQ2YzBmZmVhNTNjN2JiMWIzMWNlMQ==` |
| `1794489874820` | `MXxjMmU2MzRmYmJhMDMyZDZmMDNkN2NmMDdhMjUzZDNhMA==` |

→ Script tái lập: [`../scripts/litsign.js`](../scripts/litsign.js) (`litSign`, `getHMac256SignCode`, `stsSign`).

## 5. Kiểm chứng runtime (chỉ quan sát)
Hook Java (frida) để đối chiếu với công thức trên — chấp nhận login fail vì liteye sẽ gắn cờ frida (xem [05](05-moi-truong-phan-tich.md)):
```js
Java.perform(function () {
  var G = Java.use('com.litatom.libguard.LibGuard');
  G.getSignCode.overload('android.content.Context','long').implementation = function (c, t) {
    var r = this.getSignCode(c, t);
    console.log('[getSignCode] litTime=' + t + ' -> ' + r);   // so với lit_sign(t)
    return r;
  };
  G.getHMac256SignCode.implementation = function (s) {
    var r = this.getHMac256SignCode(s); console.log('[hmac] ' + s + ' -> ' + r); return r;
  };
});
```

> Chốt: `litSign` **không** phụ thuộc thiết bị/user — chỉ phụ thuộc `litTime` + cờ toàn vẹn APK. Nó bảo vệ **tính toàn vẹn request + chống repack**, tách biệt với `X-DFPID`/`X-SIUA` (danh tính & độ "sạch" thiết bị của liteye).
