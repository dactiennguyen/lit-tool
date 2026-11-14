# Home: API danh sách người dùng trực tuyến

## `online_users` dùng để làm gì?

`GET /api/sns/v1/lit/home/online_users` lấy danh sách hồ sơ hiển thị bên dưới
ô OnlineMatch trên tab Home đầu tiên. Ứng dụng có thể gọi lại API này khi người
dùng làm mới danh sách hoặc tải thêm. Tên endpoint không cho biết toàn bộ thuật
toán chọn và sắp xếp hồ sơ ở server.

Đừng nhầm với `GET /api/sns/v1/lit/home/refresh_nums`: API đó trả các số đếm
được dùng ở khu vực Nhắn tin, Gọi điện và Ghép Phòng trên Home.

## Đã quan sát trên máy

Ngày 13/11/2026, Litmatch 7.77.0 trên Android user 10 đang ở Home. Observer tại
lớp gửi HTTP của app ghi được:

| Thao tác | Request | Kết quả HTTP |
|---|---|---|
| Bấm lại tab Home đang mở | `GET home/online_users?start_pos=0&num=15&from_page=home` | 200 |
| Kéo danh sách xuống làm mới | `GET home/online_users?start_pos=0&num=15&from_page=home` | 200 |
| Đưa app xuống nền rồi mở lại Home | `GET home/refresh_nums` | 200 |

Lượt này chỉ ghi metadata request và HTTP status, không đọc body response; HTTP
200 chưa xác nhận `success` hay `result`. Kết quả là của phiên, cấu hình và thời
điểm quan sát; không kết luận đây là toàn bộ API chạy khi khởi động lạnh.

## Request danh sách

```http
GET /api/sns/v1/lit/home/online_users?start_pos=0&num=15&from_page=home&sid=<sid>&loc=<loc>&uuid=<uuid>&version=<version>&lang=<lang>&platform=<platform>&model=<model>&loctype=<loctype>&os=<os>&net_type=<net_type>&app_source=<app_source>&appid=<appid> HTTP/1.1
Host: www.litatom.com
```

| Tham số riêng | Ý nghĩa |
|---|---|
| `start_pos` | Vị trí bắt đầu. Khi làm mới trong lượt trên là `0`; lúc tải thêm app dùng `data.next_start` từ response trước. |
| `num` | Số hồ sơ yêu cầu, `15` trong lượt quan sát. Số hồ sơ trả về có thể ít hơn. |
| `from_page` | Nguồn gọi, `home` trong lượt quan sát. |

Các tham số còn lại do lớp tham số chung của app thêm vào. `sid` là thông tin
phiên; `uuid` là định danh app sử dụng; các trường còn lại mô tả ứng dụng,
ngôn ngữ, vùng và thiết bị. Giá trị thực tế phụ thuộc phiên và cấu hình.
Request là GET và **không có body**. `ad_mediation` có trong interface nhưng
không xuất hiện trong URL ở lượt quan sát trước khi giá trị được truyền là null.
Nguồn: [interface Home](../base-decompiled/sources/com/lit/app/ui/me/recommend/logic/RecommendUserModel.java).

## Header quan sát được

```http
traceparent: <trace>
lit-user-id: <user-id>
v-mode: <value>
X-DFPID: <dfpid>
X-SIUA: <siua>
ts: <timestamp-seconds>
litTime: <timestamp-milliseconds>
litSign: <signature>
X-request-Id: <request-id>
sts-sign: <signature>
X-Application-Info: <encoded-query>
User-Agent: <user-agent>
Host: www.litatom.com
Connection: <value>
Accept-Encoding: <value>
```

`litSign` và `sts-sign` được app tạo qua LibGuard; `X-Application-Info` được tạo
từ query của request. `X-DFPID` và `X-SIUA` đến từ Eye SDK. Các header trong
bảng là những gì có mặt ở hai request Home đã quan sát, chưa chứng minh header
nào là bắt buộc với server trong mọi trường hợp. SIUA phụ thuộc cấu hình app.
Không sửa query của request cũ rồi dùng lại nguyên chữ ký của request đó.

## Response và phân trang

Một response đã giải mã trong lượt quan sát trước có cấu trúc rút gọn sau; các
giá trị hồ sơ được thay bằng placeholder:

```json
{
  "success": true,
  "result": 0,
  "data": {
    "has_next": true,
    "next_start": 0,
    "user_infos": [
      { "user_id": "<redacted>", "nickname": "<redacted>", "avatar": "<redacted>" }
    ]
  }
}
```

`user_infos` chứa hồ sơ; `has_next` và `next_start` hỗ trợ tải tiếp. Một lượt
thử trước trả `next_start=0`, vì vậy không nên tự giả định cursor tăng thêm 15.
Schema trên là minh họa từ lượt trước, không phải body đã ghi của ba request
ngày 13/11.

## API số đếm

`GET /api/sns/v1/lit/home/refresh_nums` không có tham số riêng trong lượt bắt;
nó dùng cùng các tham số chung và nhóm header như trên. Theo response và mã đã
phân tích trước đó, `data` có các trường như `count`, `voice_match_count`,
`party_online_users_num` và `party_game_online_users_num`.

## Một request thật: 13/11/2026

Request dưới đây được lấy tại `CallServerInterceptor` khi kéo làm mới Home lúc
2026-11-13T22:19:46+07:00. Mẫu giữ nguyên URL và mọi giá trị header app tạo ở
lớp OkHttp. Đây là biểu diễn của đối tượng request trước bước truyền, không phải
capture byte của HTTP/2 trên đường mạng. Lượt này có response HTTP 200; không
đọc response body, nên chưa xác nhận `success` hoặc `result`.

```text
GET https://www.litatom.com/api/sns/v1/lit/home/online_users?start_pos=0&num=15&from_page=home&sid=session.v2.1479063690442816636&loc=US&uuid=db0f2c89ad93b337&version=7.77.0&lang=vi&platform=android&model=Pixel%208%20Pro&loctype=0&os=33&net_type=wifi&app_source=litmatch&appid=NxUUhRSQH3qPJmY2Vn%2FedRz4vrc%3D
traceparent: 00-d2e7c67969189d8252a5c22487c8e373-273a69cec844f749-00
lit-user-id: 6af6e3f053b879a10e0af4f3
v-mode: 0
X-DFPID: gj1kmvMQZ+HnzjiG9XnjI3HUTZ5zPJA4KaOMJs6Fti9WBAVRlfW/JVCCXTy9ikUFv79IFLhb7rziWwC5XEn5mg==
X-SIUA: y00bqh+lwZd2hC/rWcN84Pn86ZmzCngi2wAe4Vrazf0QjKc8C9DPolZFQQxk6pTtiXSPHhW89yHIxsSTn3jsXbIVbqxMupxVBDH0caueY1ra1/WQDRuYJ1B/MA03nIQmnBVcujT/QSqRfhE35dzI/RyQDVMwOEogad5LMb039q4=
ts: 1794583186
litTime: 1794583186849
litSign: MXw4YzM0MTE1OGJjZDhmYWI2N2ViYzQzOGU0ZDM5NTA0MQ==
X-request-Id: 5e2cbb03-6901-4e99-ad2e-9e4eedf70576
sts-sign: OWMyZmIxMTNmNzc3ZjY4MTY4Yzc3Mzc1MDkzZGQ1Yzc3NzEwOGQ2MTE4MWNmMmMzYjRmMDMzM2RhZDA3YmJlNw==
X-Application-Info: hJB_WhsAgIGKTNGL5pZiBW84CMGt-kdpEXm9r_HugxPvl48FGOmmdIDthRbKrGJ3ALSxAjhBnHvFE68sThrrsZNkkKJgfJg0aTZyfVBfAt9ZKhWjJBeL3o5Cfp6DtE0U__w9-w05r5NK8ZgNUflWQTzD2QAZ1_ikbu1aSlaildn3sKrfgNlTJIYUPxrj0LJlCCUcKEIAtLL9sfYrrNtw1S-ua_0Uw8Jsrs74wMBfSJUvVdisq-u7S-cjXs5CahJzFHFjf3_1vlD85Q3g2diHcun60pdmzECPKShkFpnvulhOHgaLGnoywdn6hIe2b4e_-Nhd6BZJ7SzX_x1e1WL2BGr3KpJoNFBUUERxUUtEZGY.
User-Agent: Dalvik/2.1.0 (Linux; U; Android 13; M2101K7BG Build/TP1A.220624.014)
Host: www.litatom.com
Connection: Keep-Alive
Accept-Encoding: gzip
```

Body: không có. Bản dữ liệu gốc của cùng request: [home-online-users-request-20261113.json](../.private/home-online-users-request-20261113.json).
Timestamp, chữ ký và dữ liệu phiên phản ánh thời điểm thu mẫu; chưa xác định
được khả năng dùng lại request này ở thời điểm khác.

## Nguồn tạo các tham số query

| Query | App lấy hoặc tạo như thế nào |
|---|---|
| `start_pos`, `num`, `from_page` | Tham số Retrofit do luồng Home truyền vào; mẫu trên là `0`, `15`, `home`. Tải thêm dùng `next_start` đã nhận. |
| `sid` | `com.lit.app.model.b0.b()` lấy `session` từ `KeyInfo`; `KeyInfo` được nạp từ MMKV `litmatch_key_info`. Chỉ thêm nếu không rỗng. |
| `uuid` | `ll.g.A()` lấy `device_id` đã lưu trong MMKV; nếu chưa có, `com.lit.app.utils.n` đọc `Settings.Secure.ANDROID_ID` và lưu lại. Code có nhánh dự phòng cho Android ID đặc biệt. |
| `loc`, `loctype` | `ll.g.r()` và `ll.g.y()` dùng dữ liệu vùng cache; `ll.g.F()` lấy mã quốc gia từ SIM hoặc locale. Code gán nguồn SIM là `0`, nhánh locale là `1`. |
| `version` | `ll.g.C()` lấy `PackageInfo.versionName`. |
| `lang` | `ll.g.v()` lấy mã ngôn ngữ từ locale ứng dụng. |
| `platform` | Chuỗi cố định `android` trong interceptor. |
| `model` | `ll.g.z()` lấy và cache `android.os.Build.MODEL` trong tiến trình app. |
| `os` | `Build.VERSION.SDK_INT`, chuyển thành chuỗi. |
| `net_type` | Lớp trạng thái mạng trả nhãn như `wifi`, `4g`, `5g`, `none` hoặc `unknown`. |
| `app_source` | Resource `R.string.app_source` nếu không rỗng. |
| `appid` | `ll.g.w()` đọc resource `R.string.liteye_app_id` nếu không rỗng. |

Các tham số chung được thêm trong [a00/l.java](../base-decompiled/sources/a00/l.java).
`han=s` có thể được thêm theo locale, nhưng không xuất hiện ở mẫu này.

## Nguồn tạo các header

| Header | Nguồn trong app |
|---|---|
| `lit-user-id` | `a00/l.java` lấy ID từ `androidx.work.z.J()` và thêm khi không rỗng. |
| `v-mode` | `a00/l.java` đọc trạng thái loại kết nối qua `ConnectivityManager`; biểu thức trong bản decompile có cảnh báo nên cần đối chiếu runtime khi diễn giải đầy đủ. |
| `X-DFPID` | `EyeInterceptor` gọi `EyeConnector.getDfpId()`: ưu tiên `dfPID` đã cache từ response Eye, fallback `localDfpToken`; khi hết hạn có thể làm mới bất đồng bộ. |
| `X-SIUA` | `EyeInterceptor` gọi `fetchSIUA()`; Eye chỉ gọi native `LitEye.siua(context)` nếu tính năng được bật. |
| `ts`, `litTime` | `lx.c.a()` tính giây và `lx.c.b()` tính mili giây từ đồng hồ hệ thống cộng offset của app. |
| `litSign` | `LibGuard.getSignCode(context, litTime)`. |
| `X-request-Id` | `UUID.randomUUID()` cho request. |
| `sts-sign` | `LibGuard.getHMac256SignCode(ts + "_" + uuid)` khi query có UUID. |
| `X-Application-Info` | `LibGuard.encodeShadowContent(query, 3)` trên chuỗi query do OkHttp dựng. Query cũng xuất hiện trên URL. |
| `traceparent` | Header theo dõi request; chưa xác định callsite cụ thể trong lượt này. |
| `User-Agent`, `Host`, `Connection`, `Accept-Encoding` | Header hiện ở lớp request được quan sát. Nguồn gán từng giá trị vận chuyển chưa được kiểm chứng riêng trong lượt này. |

Nguồn: [c00/a.java](../base-decompiled/sources/c00/a.java),
[EyeInterceptor.java](../base-decompiled/sources/com/construct/liteye/EyeInterceptor.java),
[EyeConnector.java](../base-decompiled/sources/com/construct/liteye/EyeConnector.java),
[ll/g.java](../base-decompiled/sources/ll/g.java),
[utils/n.java](../base-decompiled/sources/com/lit/app/utils/n.java),
[model/b0.java](../base-decompiled/sources/com/lit/app/model/b0.java) và
[lx/c.java](../base-decompiled/sources/lx/c.java).

## Request và response thật cùng một lượt

Lượt kéo làm mới lúc 2026-11-13T22:32:27+07:00 trên user 10; request tại lớp gửi
và response sau interceptor giải mã có cùng `X-request-Id`. Đây là một lượt
mới, riêng với request lúc 22:19 ở mục trên. HTTP 200, `success=true`,
`result=0`; `data.user_infos` có 15 hồ sơ. Response body được đọc
bằng bản sao, không tiêu thụ body gốc của app.

**Request thực tế:**

```text
GET https://www.litatom.com/api/sns/v1/lit/home/online_users?start_pos=0&num=15&from_page=home&sid=session.v2.1479063690442816636&loc=US&uuid=db0f2c89ad93b337&version=7.77.0&lang=vi&platform=android&model=Pixel%208%20Pro&loctype=0&os=33&net_type=wifi&app_source=litmatch&appid=NxUUhRSQH3qPJmY2Vn%2FedRz4vrc%3D
lit-user-id: 6af6e3f053b879a10e0af4f3
v-mode: 0
X-DFPID: nNBS+Lerk3w6trTYEzq3j3DxvWd+nIZ9av6v3S8Ip9sCpTd3JVQHZ6381XbYJuavvX6UfnTYKPy51n6osyr+Vw==
X-SIUA: OeR4p+rxldNS8ddUjsh55yQPsmgAimAMl7jal2nHlNM4FTlbheFLHW8ekwojl3Ug4PxtthNAJ0LYJk6DepUJQmUYnL/WAoX1HOZPi3BSXwuAtD6E9u2W3KSlpG0tRBv6NtY73oWdjDVxFFp5V9L7e8b24L8KApfD2nmccJJg4d4=
ts: 1794583947
litTime: 1794583947189
litSign: MXwzYjZiNDdkNmVjMmM2ZmFiNDBiYTcyMGI1OTVkZDM0Yg==
X-request-Id: 4ec4f6c5-c231-44fd-9395-2663798bb79c
sts-sign: ODRiNGIyNWI4NjQyY2U3MDUwOWI4Y2FmY2FkMTNlMWRlYmIzMGI3MjgxNjFiZWI0ZWZhMTg4ZDFmNWUwYjI2NQ==
X-Application-Info: yvH9OAIfh6pXAHRuwviYiIaBmCPwpC3EK5tTmEtlWU5cojJYRO9TkzfF8pqskHPyxUhnsDU9SN2ufyjx3XermrL8JfpDttHTaBYqajncTYaBExp6QUCuTjR3x0s5A2P2ZLQGJ31MZAEiEg6TaGmSRAIDaaFoEdtK4U1H587a-_kJKAsOPvF4qbWmPManl-VF5dfGfvGH1Fjc9XuGXQWE3VFEup6rS2PIApaPhlktKnjXGlp4siwwEI0RaIMaKTNpJBikxsJA7GZWU0b1RTAcg8IsT61L2dWTKwDVHkBLsBmKxmHSn5jKXYFIFepl45G97hDnVfLGjW5ZqE3DOC0ErWr3LYt3eWh3ZzBUMUdRNHo.
User-Agent: Dalvik/2.1.0 (Linux; U; Android 13; M2101K7BG Build/TP1A.220624.014)
Host: www.litatom.com
Connection: Keep-Alive
Accept-Encoding: gzip
```

**Response header quan sát được:**

```text
HTTP status: 200
server: istio-envoy
content-type: application/json; charset=utf-8
access-control-allow-origin: *
access-control-allow-methods: GET, POST, DELETE, OPTIONS
access-control-allow-headers: *
x-request-id: 4ec4f6c5-c231-44fd-9395-2663798bb79c
x-response-sign: 1a6e8fbd1ca51aa17d1e2881695bf373e6e15c23
x-is-enc: Z8c3PKNjc4T6RXf37lA_YlA5cmcTNLHmqx5nJvGcAy8ArUsX1OkTNYHt-4ktYMkgavcti75u-7pzU-kQTHOwLg==
lit-x-response-id: py3:4ec4f6c5-c231-44fd-9395-2663798bb79c
x-route-pattern: /api/sns/v1/lit/home/online_users
req-cost-time: 220
req-arrive-time: 1794583947319
resp-start-time: 1794583947539
x-envoy-upstream-service-time: 220
vary: Accept-Encoding
date: Fri, 13 Nov 2026 15:32:27 GMT
eo-log-uuid: 2732596579220303640
eo-cache-status: MISS
```

**Response body đầy đủ:** [home-online-users-response-20261113.json](data/home-online-users-response-20261113.json).
File chứa nguyên body sau khi app xử lý giải mã, gồm đầy đủ dữ liệu hồ sơ và
`trace_id` của response thực tế. Đây là dữ liệu của lượt mới, không phải body
của request 22:19. Bản ghép request/response ban đầu nằm ở
[home-online-users-pair-20261113.json](../.private/home-online-users-pair-20261113.json).

## Nguồn

- [Interface `online_users`](../base-decompiled/sources/com/lit/app/ui/me/recommend/logic/RecommendUserModel.java)
- [Interface `refresh_nums`](../base-decompiled/sources/ba0/b.java)
- [Header và cách ký request](06-api-va-ky-request.md)
