# 01 — Tổng quan ứng dụng

## Định danh
| Thuộc tính | Giá trị |
|---|---|
| Package | `com.litatom.app` |
| Tên hiển thị | Litmatch / Litmatch — Live Video Chat |
| versionName | 7.77.0 |
| versionCode | 711 |
| minSdk / targetSdk | 24 / 36 |
| Application class | `com.lit.app.LitApplication` |
| Activity khởi động | `com.lit.app.ui.MainActivity` (qua `DefaultLauncherAlias`) |
| ABI | arm64-v8a (split `config.arm64_v8a`) |
| Ngôn ngữ | Kotlin, obfuscate bằng R8 (tên package 1–3 ký tự) |

APK là **split APK** (`requiredSplitTypes="base__abi"`): `base.apk` chỉ chứa Java/DEX + resources; toàn bộ thư viện native `.so` nằm trong `split_config.arm64_v8a.apk`.

## Kiến trúc & module chính
Sau decompile (`base-decompiled/sources/com/lit/app/`), số class theo module:

| Module | ~Số class | Vai trò |
|---|---|---|
| `party/` | 1.549 | Phòng voice chat + game trong phòng (lớn nhất) |
| `ui/` | 1.503 | Toàn bộ màn hình |
| `im/` | 164 | Nhắn tin (OpenIM + Easemob/Hyphenate) |
| `pay/` | 153 | Thanh toán, kim cương, VIP |
| `bean/` | 127 | Model dữ liệu |
| `match/` | 110 | Ghép voice ngẫu nhiên |
| `net/` | 3 | `Result`, `ICallback`, `LitNetError` |

## Thành phần hạ tầng
- **Mạng**: Retrofit (bị đổi tên: `is0.f`=`@GET`, `is0.o`=`@POST`, `is0.a`=`@Body`...), ~697 endpoint `api/sns/v1/lit/...`. Lớp vận chuyển thật đi qua SDK **liteye** (`com.construct.liteye`).
- **Lưu trữ**: Tencent **MMKV** (không phải SharedPreferences).
- **Voice/RTC**: Agora (`io/agora/rtc`, `rtm`). Game trong phòng: Sud (`tech/sud`).
- **Chat**: OpenIM (`openim.litatom.com`, WebSocket `wss://.../msg_gateway`) + Easemob/Hyphenate (cũ).
- **Push**: Firebase FCM + Huawei HMS + OPPO/Heytap MCS.
- **Analytics**: Firebase, AppsFlyer, ThinkingData (`cn.thinkingdata`), GA.
- **Quảng cáo**: AppLovin MAX + mediation (Pangle/bytedance, Mintegral, InMobi, Moloco, Vungle, Fyber, Maticoo).
- **Thanh toán**: Google Play Billing 8.1.0.

## Host chính (xem [99-phu-luc-endpoints.md](99-phu-luc-endpoints.md))
- `www.litatom.com` — API chính.
- `prod.litmatchs.com` — route `/api/ms`.
- `baishan.litatom.com` — upload media (image/audio/video).
- `cloud.litatom.com` — liteye (`/api/sns/v1/lit/eye`, `/liteyelog`).
- `openim.litatom.com` — chat. Người dùng Philippines (PH) chuyển sang `ksztagent.com`.

## Quyền đáng chú ý (AndroidManifest)
`RECORD_AUDIO`, `CAMERA`, `ACCESS_FINE_LOCATION`, `READ_PHONE_STATE`, `SYSTEM_ALERT_WINDOW`, `DETECT_SCREEN_CAPTURE`, `FOREGROUND_SERVICE_MICROPHONE`, `QUERY` khai báo dò các package root (Magisk, SuperSU...).

## Cấu hình bảo mật mạng (`res/xml/network_security_config.xml`)
- Tin chứng chỉ **CA hệ thống**, cho phép cleartext ở base-config.
- **Không có SSL pinning ở tầng Java** — việc chống MITM được đẩy xuống native liteye (hàm `proxy`/`vpn`). Xem [03-liteye-native.md](03-liteye-native.md).
