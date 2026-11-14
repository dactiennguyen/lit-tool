# Hai kho MMKV của Litmatch: dữ liệu và cách đọc

Bản chụp giá trị thực và tên khóa chính xác nằm ở phần cuối tài liệu này; dữ liệu có thể thay đổi khi ứng dụng chạy. Tài liệu chứa thông tin phiên, thông tin xác thực, định danh và vị trí. Bản chụp được đọc từ tiến trình Litmatch trên Android user 10 bằng API MMKV, không phải dữ liệu suy ra từ các chuỗi cũ còn sót trong file nhị phân.

Tại lần đọc có 17 khóa trong `mmkv.default`, một khóa trong `construct_liteye_id`. `<user_id>` dưới đây thay phần ID tài khoản trong tên khóa thực; một số tên dùng dấu cách trước ID.

## mmkv.default

| Khóa | Kiểu | Nội dung và công dụng |
| --- | --- | --- |
| `is_notifications_on <user_id>` | boolean | Cài đặt thông báo tổng của tài khoản. |
| `is_sound_on <user_id>` | boolean | Cài đặt âm thanh thông báo. |
| `is_vibration_on <user_id>` | boolean | Cài đặt rung thông báo. |
| `show_feed_ad_<user_id>` | boolean | Cấu hình hiển thị quảng cáo feed. |
| `show_feed_ad_interval_<user_id>` | long | Khoảng làm mới cấu hình quảng cáo feed, tính bằng mili giây. |
| `show_feed_tag_pages_ad_<user_id>` | long | Thời điểm cập nhật cấu hình quảng cáo feed, tính bằng mili giây. |
| `feed_growth_fcm_push_badge_data_<user_id>` | string JSON | Dữ liệu badge tăng trưởng nhận qua FCM. |
| `feed_milestone_new_reward_<user_id>` | string JSON | Dữ liệu phần thưởng milestone mới nhận qua FCM. |
| `feed_milestone_has_new_flag_<user_id>` | boolean | Cờ báo có milestone mới. |
| `lit_lbs_location` | string JSON | Vị trí được lưu gần nhất; xem các trường tọa độ và thời gian trong dữ liệu thật. |
| `device_id` | string | ID thiết bị được ứng dụng lưu. Lúc khởi tạo ứng dụng thường lấy Android ID, có các nhánh dự phòng trong mã. |
| `disk_usage_last_report_time` | long | Lần báo cáo dung lượng gần nhất, mili giây Unix. |
| `lit_new_register_tracking_start_time` | long | Thời điểm bắt đầu theo dõi đăng ký, mili giây. |
| `lit_new_register_tracking_register_type` | string | Loại đăng ký dùng trong theo dõi. |
| `lit_new_register_tracking_user_id` | string | ID tài khoản dùng trong theo dõi đăng ký. |
| `net_transfer_data` | string | Dữ liệu cấu hình chuyển dữ liệu mạng; xem giá trị để biết nội dung cụ thể. |
| `litmatch_key_info` | string JSON | Thông tin tài khoản/phiên gồm `session`, `userId`, `hxPwd`. Việc có giá trị không chứng minh phiên còn hiệu lực trên máy chủ. |

Nguồn đối chiếu: [cấu hình quảng cáo](../base-decompiled/sources/com/lit/app/model/z.java), [cài đặt thông báo](../base-decompiled/sources/o00/b.java), [FCM](../base-decompiled/sources/com/lit/app/push/FcmService.java), [vị trí](../base-decompiled/sources/kz/a.java), [device_id](../base-decompiled/sources/com/lit/app/utils/n.java), [session](../base-decompiled/sources/com/lit/app/model/b0.java), [theo dõi đăng ký](../base-decompiled/sources/ll/g.java) và [cấu hình mạng](../base-decompiled/sources/dg0/c.java).

## construct_liteye_id

| Khóa | Kiểu | Nội dung |
| --- | --- | --- |
| `eye_id` | string JSON | Bản lưu của `EyeDfpId`: `dfpId` là định danh Liteye, `ver` là phiên bản, `exp` là thời điểm hết hạn tính bằng mili giây Unix. |

[EyeConnector](../base-decompiled/sources/com/construct/liteye/EyeConnector.java) ghi đối tượng thành JSON và đọc lại cache khi `currentTimeMillis()` nhỏ hơn `exp`. [EyeDfpId](../base-decompiled/sources/com/construct/liteye/EyeDfpId.java) khai báo ba trường nói trên.

## Cách đọc

Trong tiến trình ứng dụng, sau khi MMKV được khởi tạo, có thể dùng API Java tương ứng với kiểu mà mã ứng dụng đã ghi:

```java
MMKV defaults = MMKV.defaultMMKV();
String[] keys = defaults.allKeys();
String keyInfo = defaults.getString("litmatch_key_info", "");
String deviceId = defaults.getString("device_id", "");
long lastReport = defaults.getLong("disk_usage_last_report_time", 0L);

MMKV eyeStore = MMKV.mmkvWithID("construct_liteye_id");
String eyeJson = eyeStore.getString("eye_id", "");
```

Với các khóa có ID, dùng nguyên tên khóa được liệt kê trong bản chụp; đọc cờ bằng `getBoolean`, thời gian và khoảng bằng `getLong`, chuỗi bằng `getString`. Giá trị JSON là **chuỗi** lưu trong MMKV, cần giải mã JSON thêm một lần để xem các trường bên trong. `containsKey` giúp phân biệt khóa vắng mặt với giá trị mặc định. Không thể suy ra chắc chắn kiểu của mọi giá trị chỉ từ `allKeys()`; các kiểu ở đây đã đối chiếu với lời gọi đọc/ghi trong mã ứng dụng.

Phần dữ liệu thật bên dưới hiển thị cả chuỗi nguyên gốc dưới dạng chuỗi JSON có escape và phần JSON sau giải mã khi có thể. Nó là ảnh chụp tại một thời điểm, không tự cập nhật; không cần sửa dữ liệu ứng dụng để đọc.

## Ghi chú các trường trong JSON

Các giá trị bên dưới là ảnh chụp thực tế; một số chuỗi JSON chứa số dưới dạng chuỗi. Ý nghĩa chi tiết của mã enum chưa được xác định thì ghi theo tên trường.

### Session và Liteye

- `litmatch_key_info.session`: chuỗi phiên đăng nhập được lưu; `userId`: ID tài khoản; `hxPwd`: trường mật khẩu/thông tin xác thực của tài khoản.
- `eye_id.dfpId`: định danh Liteye; `ver`: phiên bản theo đối tượng Liteye; `exp`: thời điểm hết hạn cache theo mili giây Unix.

### Vị trí và badge

- `lit_lbs_location.lat` và `lng`: vĩ độ và kinh độ; `time`: thời gian của vị trí lấy từ Android Location theo mili giây Unix.
- `feed_growth_fcm_push_badge_data.reason`: lý do; `type`: loại dữ liệu badge. Các mã cụ thể phụ thuộc payload.
- `feed_milestone_new_reward.milestone_unique_key`: khóa milestone; `milestone_category`: nhóm; `name`: tên; `description`: mô tả; `fileid`: định danh tệp liên quan; `milestone_level`: cấp; `milestone_type` và `type`: loại theo payload; `congratulation_toast`: nội dung thông báo chúc mừng; `has_sub_badge`: cờ liên quan huy hiệu phụ; `level_award_time`: thời điểm cấp phần thưởng theo payload, chưa xác định đơn vị. Các trường trong bản chụp này là chuỗi, kể cả giá trị trông như số.

### Cấu hình mạng

`net_transfer_data` là JSON chứa `service`, `web`, `cdn`, `shushu`, `track`, `liteye`, `oss`, `h5`. Trong bản chụp, `service` và `web` là danh sách quy tắc gồm `regex_pattern` và `domain`; các mục còn lại là đối tượng có `domain`. Tên `regex_pattern` và `domain` mô tả mẫu khớp và tên miền; chưa khẳng định toàn bộ cách áp dụng từng nhóm.

## Dữ liệu thực tế

### Bản chụp hai kho MMKV

Thời điểm đọc: 14/11/2026 08:43:34 GMT+7; Litmatch trên Android user 10. Đây là bản chụp tại thời điểm đọc, có thể thay đổi khi ứng dụng hoạt động.

Bản chụp chứa session, dữ liệu xác thực, ID và vị trí; cân nhắc nội dung này khi chia sẻ tài liệu hoặc commit.

Giá trị string bên dưới được biểu diễn bằng cú pháp chuỗi JSON để giữ nguyên ký tự; bỏ dấu ngoặc kép ngoài và giải mã escape để lấy chuỗi gốc. Long là số nguyên dạng thập phân; boolean là true/false.

### mmkv.default

Số khóa hiện hành: 17.

#### is_notifications_on 6af7bac9383e1fac3b02b8fa

Bật thông báo tổng của ứng dụng cho tài khoản.

Kiểu: `boolean`. Kích thước giá trị theo MMKV: 1 byte.

```json
true
```

#### show_feed_tag_pages_ad_6af7bac9383e1fac3b02b8fa

Thời điểm cập nhật cấu hình quảng cáo feed, mili giây.

Kiểu: `long`. Kích thước giá trị theo MMKV: 6 byte.

```json
"1794620154389"
```

#### show_feed_ad_interval_6af7bac9383e1fac3b02b8fa

Khoảng chờ làm mới cấu hình quảng cáo feed, mili giây.

Kiểu: `long`. Kích thước giá trị theo MMKV: 4 byte.

```json
"86400000"
```

#### show_feed_ad_6af7bac9383e1fac3b02b8fa

Cho biết cấu hình có hiển thị quảng cáo feed.

Kiểu: `boolean`. Kích thước giá trị theo MMKV: 1 byte.

```json
true
```

#### feed_growth_fcm_push_badge_data_6af7bac9383e1fac3b02b8fa

JSON dữ liệu badge tăng trưởng từ thông báo FCM.

Kiểu: `string`. Kích thước giá trị theo MMKV: 55 byte.

```json
"{\"reason\":\"['has_sign_in']\",\"type\":\"feed_growth_badge\"}"
```

Nội dung JSON sau khi giải mã:

```json
{
  "reason": "['has_sign_in']",
  "type": "feed_growth_badge"
}
```

#### feed_milestone_new_reward_6af7bac9383e1fac3b02b8fa

JSON phần thưởng milestone mới từ FCM.

Kiểu: `string`. Kích thước giá trị theo MMKV: 463 byte.

```json
"{\"milestone_level\":\"1\",\"description\":\"Ngày đầu tiên tham gia cộng đồng Litmatch!\",\"milestone_unique_key\":\"milestone_achievement_newcomer\",\"milestone_category\":\"user_milestone_category_newbie_package\",\"fileid\":\"5569e0f8-7926-11ee-9563-00163e01ff52\",\"name\":\"Chào mừng ✨\",\"type\":\"milestone_received\",\"congratulation_toast\":\"Ngày đầu tiên tham gia cộng đồng Litmatch!\",\"has_sub_badge\":\"0\",\"milestone_type\":\"0\",\"level_award_time\":\"1794620150\"}"
```

Nội dung JSON sau khi giải mã:

```json
{
  "milestone_level": "1",
  "description": "Ngày đầu tiên tham gia cộng đồng Litmatch!",
  "milestone_unique_key": "milestone_achievement_newcomer",
  "milestone_category": "user_milestone_category_newbie_package",
  "fileid": "5569e0f8-7926-11ee-9563-00163e01ff52",
  "name": "Chào mừng ✨",
  "type": "milestone_received",
  "congratulation_toast": "Ngày đầu tiên tham gia cộng đồng Litmatch!",
  "has_sub_badge": "0",
  "milestone_type": "0",
  "level_award_time": "1794620150"
}
```

#### lit_lbs_location

JSON vị trí gần nhất (tọa độ và thời điểm).

Kiểu: `string`. Kích thước giá trị theo MMKV: 72 byte.

```json
"{\"lat\":21.024529999999995,\"lng\":105.79615333333335,\"time\":1794620176542}"
```

Nội dung JSON sau khi giải mã:

```json
{
  "lat": 21.024529999999995,
  "lng": 105.79615333333335,
  "time": 1794620176542
}
```

#### device_id

ID thiết bị ứng dụng lưu; khi khởi tạo thường lấy từ Android ID.

Kiểu: `string`. Kích thước giá trị theo MMKV: 16 byte.

```json
"eab89b6de0f57db2"
```

#### disk_usage_last_report_time

Thời điểm báo cáo dung lượng gần nhất, mili giây Unix.

Kiểu: `long`. Kích thước giá trị theo MMKV: 6 byte.

```json
"1794618122361"
```

#### lit_new_register_tracking_start_time

Thời điểm bắt đầu theo dõi đăng ký, mili giây.

Kiểu: `long`. Kích thước giá trị theo MMKV: 6 byte.

```json
"1794620106273"
```

#### is_vibration_on 6af7bac9383e1fac3b02b8fa

Cài đặt rung thông báo của tài khoản.

Kiểu: `boolean`. Kích thước giá trị theo MMKV: 1 byte.

```json
true
```

#### feed_milestone_has_new_flag_6af7bac9383e1fac3b02b8fa

Cờ có milestone mới.

Kiểu: `boolean`. Kích thước giá trị theo MMKV: 1 byte.

```json
true
```

#### is_sound_on 6af7bac9383e1fac3b02b8fa

Cài đặt âm thanh thông báo của tài khoản.

Kiểu: `boolean`. Kích thước giá trị theo MMKV: 1 byte.

```json
true
```

#### lit_new_register_tracking_register_type

Loại đăng ký được theo dõi.

Kiểu: `string`. Kích thước giá trị theo MMKV: 2 byte.

```json
"GO"
```

#### net_transfer_data

Chuỗi dữ liệu cấu hình chuyển dữ liệu mạng; nội dung cụ thể theo bản lưu.

Kiểu: `string`. Kích thước giá trị theo MMKV: 615 byte.

```json
"{\"service\":[{\"regex_pattern\":\"/api/ms\",\"domain\":\"https://prod.litmatchs.com\"},{\"regex_pattern\":\"/api/sns/v1/lit/family\",\"domain\":\"https://www.litatom.com\"},{\"regex_pattern\":\"/\",\"domain\":\"https://www.litatom.com\"}],\"web\":[{\"regex_pattern\":\"/api/sns/v1/lit/activity/app\",\"domain\":\"https://www.litatom.com\"},{\"regex_pattern\":\"/activity\",\"domain\":\"https://activity.static.litatom.com\"}],\"cdn\":{\"domain\":\"https://baishan.litatom.com\"},\"shushu\":{\"domain\":\"https://ss.litatom.com\"},\"track\":{\"domain\":\"https://tracking.ksztone.com\"},\"liteye\":{\"domain\":\"https://cloud.giantargus.com\"},\"oss\":{\"domain\":\"\"},\"h5\":{\"domain\":\"\"}}"
```

Nội dung JSON sau khi giải mã:

```json
{
  "service": [
    {
      "regex_pattern": "/api/ms",
      "domain": "https://prod.litmatchs.com"
    },
    {
      "regex_pattern": "/api/sns/v1/lit/family",
      "domain": "https://www.litatom.com"
    },
    {
      "regex_pattern": "/",
      "domain": "https://www.litatom.com"
    }
  ],
  "web": [
    {
      "regex_pattern": "/api/sns/v1/lit/activity/app",
      "domain": "https://www.litatom.com"
    },
    {
      "regex_pattern": "/activity",
      "domain": "https://activity.static.litatom.com"
    }
  ],
  "cdn": {
    "domain": "https://baishan.litatom.com"
  },
  "shushu": {
    "domain": "https://ss.litatom.com"
  },
  "track": {
    "domain": "https://tracking.ksztone.com"
  },
  "liteye": {
    "domain": "https://cloud.giantargus.com"
  },
  "oss": {
    "domain": ""
  },
  "h5": {
    "domain": ""
  }
}
```

#### litmatch_key_info

JSON thông tin phiên và tài khoản: session, userId, hxPwd.

Kiểu: `string`. Kích thước giá trị theo MMKV: 123 byte.

```json
"{\"hxPwd\":\"fcdc34d02b8b2f9635dd3c86c9686708\",\"session\":\"session.v2.1479116105804267221\",\"userId\":\"6af7bac9383e1fac3b02b8fa\"}"
```

Nội dung JSON sau khi giải mã:

```json
{
  "hxPwd": "fcdc34d02b8b2f9635dd3c86c9686708",
  "session": "session.v2.1479116105804267221",
  "userId": "6af7bac9383e1fac3b02b8fa"
}
```

#### lit_new_register_tracking_user_id

ID tài khoản phục vụ theo dõi đăng ký.

Kiểu: `string`. Kích thước giá trị theo MMKV: 24 byte.

```json
"6af7bac9383e1fac3b02b8fa"
```

### construct_liteye_id

Số khóa hiện hành: 1.

#### eye_id

JSON Liteye: dfpId là định danh; ver là phiên bản; exp là hạn cache dạng mili giây Unix.

Kiểu: `string`. Kích thước giá trị theo MMKV: 144 byte.

```json
"{\"dfpId\":\"jpK8eCrdMuBIogajJKShGKOt80csYdX3PbVLFpqVF1QlbCDtbSZC+cLtFVbq7Uf0txJz7tuaGPzpD7iA5MeNuw\\u003d\\u003d\",\"exp\":1794706528044,\"ver\":\"0.0.2\"}"
```

Nội dung JSON sau khi giải mã:

```json
{
  "dfpId": "jpK8eCrdMuBIogajJKShGKOt80csYdX3PbVLFpqVF1QlbCDtbSZC+cLtFVbq7Uf0txJz7tuaGPzpD7iA5MeNuw==",
  "exp": 1794706528044,
  "ver": "0.0.2"
}
```
