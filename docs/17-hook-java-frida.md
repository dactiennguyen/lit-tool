# 17 — Hook Java bằng Frida trên app chống-ART (bridge vá + JNI reflection)

Litmatch `com.litatom.app` 7.77.0, Android user 10. Tài liệu này ghi **cách hook
được tầng Java** trên máy mà bridge Java mặc định của Frida bị lỗi ART, và các
điểm hook đã kiểm chứng.

## 1. Vấn đề: bridge Java mặc định crash ART
- Dùng **frida-server 17.23.3 + bridge mặc định** (`Java.use`/`Java.perform` tự
  init): trên ART máy này **`typeof Java === 'undefined'`** — bridge không lên.
- Nguyên nhân (theo worker reflection): **JVMTI plugin init abort** ART này, và
  **raw ART class-layout probe cũng fail**. ⇒ không hook được ở tầng Java.
- (Lần trước mình né bằng hook native `libssl.so!SSL_write`, nhưng core API đi
  **HTTP/2** nên header bị HPACK nén — xem [observed-traffic](data/observed-traffic.md).)

## 2. Giải pháp: frida 17.10.0 + vá bridge → ép JNI reflection
Cố định **frida 17.10.0** (client + server) và **frida-tools 14.11.0**, rồi **vá
file bridge** `frida_tools/bridges/java.js` để **tắt 2 đường gây crash**, buộc
bridge dựng class model bằng **JNI reflection** (gọi JNI thủ công thay vì đọc nội
bộ ART). Ba phép thay (mỗi cái khớp đúng 1 lần trong bundle 17.10.0):

| Tắt gì | Thay |
|---|---|
| JVMTI getter | `...{get(){return null===f&&(f=[De(p,this.artRuntime)]),f[0]}}` → `...{get(){return null}}` |
| Nhánh ART (flavor) | `if("art"===t.flavor){let e;` → `if(false){let e;` |
| ART class-layout probe (`Dn`) | `...if("art"!==n.flavor)return $n;` → `...return $n;` |

Sau đó nạp script: **`bridge_đã_vá + "globalThis.Java=bridge;" + hook.js`**. Lúc
này `Java.available === true` và `Java.use`/`Java.perform` chạy bình thường.

> Driver tham chiếu (ngoài repo này, dạng worker Python):
> `observe_eye_login_reflection.py`. Attach bằng `device.attach(pid)` (không spawn).

## 3. Thiết lập & chạy
```sh
D=192.168.2.1:5555
# đổi frida-server sang 17.10.0 (máy test có sẵn /data/local/tmp/frida-server-1710)
adb -s $D shell "su -c 'pkill -f frida-server; nohup /data/local/tmp/frida-server-1710 >/dev/null 2>&1 &'"
# mở app user 10, lấy PID
adb -s $D shell "am start --user 10 -n com.litatom.app/.DefaultLauncherAlias"
adb -s $D shell "pidof com.litatom.app"
# chạy observer bằng python có frida==17.10.0, frida-tools==14.11.0 (bridge vá như §2)
```
Attach vẫn có thể **chập chờn** (`unexpected crash while allocating memory`) →
retry. Chỉ đọc, không sửa dữ liệu (gọi hàm gốc, trả kết quả gốc).

## 4. Điểm hook (đã kiểm chứng) + map field
| Hook | Lấy gì |
|---|---|
| `com.construct.liteye.EyeConnector.getDfpId()` | X-DFPID (độ dài/nguồn) |
| `com.construct.liteye.EyeConnector.fetchSIUA()` | X-SIUA (độ dài) |
| `zq0.a.intercept(tq0.f0)` = **CallServerInterceptor** | request đã ký (method/url/header) |
| `cg0.a.intercept(tq0.f0)` = **ResponseDecodeInterceptor** | response + ngữ cảnh giải mã |
| `com.litatom.libguard.LibGuard.decodeShadowContent(String,int)` | **response body đã giải mã** (mode 3) |

Map field (tên bytecode của APK này): `chain`(`zq0.e`) field **`e`**(`f82869e`)=Request
`tq0.o0`; Request field **`a`**=HttpUrl, **`b`**=method, **`c`**=Headers `tq0.c0`
(`size()`, `d(i)`=name, `g(i)`=value), `b("X-request-Id")`=header theo tên. Response
body mã hoá được giải ở `cg0/a.java:63` bằng `decodeShadowContent(body,3)`.

## 5. Kết quả quan sát (2026-11-13)
- `getDfpId` → **X-DFPID present, length 88**.
- `fetchSIUA` → **X-SIUA present, length 128–172** ⇒ **SIUA ĐANG BẬT** trong phiên
  này (đính chính [doc 08 §4](08-liteye-native-returns.md): `enableSIUA()=false` không còn đúng).
- Header + response body thật của từng endpoint: [data/api-headers-response.json](data/api-headers-response.json).

> Chỉ dùng để hiểu/kiểm chứng request của app; không sửa tín hiệu, không bypass.
