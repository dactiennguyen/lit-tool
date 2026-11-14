# Tab bài đăng: Gợi ý / Phổ biến

Tab thứ 3 sử dụng cấu hình trang do server trả về. Cấu hình quan sát được:

```text
Following — Theo dõi
Foryou — Gợi ý
  Trends — Phổ biến
  Associate — Kết bạn
Latest — Mới nhất
```

“Gợi ý” là mục cha; mở mục con mặc định `Trends` sẽ gọi API Phổ biến.
Không có một endpoint `/recommended` riêng trong luồng đã kiểm tra.

| Mục | Method / path dưới `https://www.litatom.com` | TypeScript |
|---|---|---|
| Cấu hình tab | GET `/api/sns/v1/lit/feed/feed_page_structure` | `getFeedPageStructure()` |
| Phổ biến / Trends | GET `/api/sns/v1/lit/feed/hq?start_pos=0&num=20` | `getPopularFeeds()` hoặc `getForYouFeeds()` |
| Kết bạn / Associate | GET `/api/sns/v1/lit/feed/sep_page_feeds/Associate?start_pos=0&num=20` | `getForYouFeeds({ type: 'Associate' })` |

Đối chiếu APK tại `base-decompiled/sources/i90/i.java` (cấu hình),
`h90/c.java` (Retrofit feed), `ForYouHostFragment`, `ForYouFeedFragment.lambda$loadData$3`.
Trong source UI, tên kiểu trang quyết định gọi `hq` hay `sep_page_feeds/{type}`.

## Chạy

Từ thư mục gốc repo, Node >=22.18:

```sh
node scripts/feed.js structure
node scripts/feed.js popular --num 20 --start-pos 0
node scripts/feed.js recommended --num 20
node scripts/feed.js associate --num 20
```

`recommended` là alias của `Trends`, không tạo thêm request khác.
CLI tự đọc `scripts/.env`, chỉ log JSON, không ghi đè env. Dùng session Litmatch
hiện có qua `LIT_SID`, `LIT_UUID`, `LIT_VERSION`, `LIT_PLATFORM` và các trường profile
được cấu hình (`LIT_USER_ID`, `LIT_DFPID`, `LIT_SIUA`, common query).
Không cần `HX_LOGIN_TEMPLATE_B64` hoặc đăng nhập IM để gọi feed.

```ts
import { getFeedPageStructure, getForYouFeeds } from './scripts/src/lit/api.ts';

const structure = await getFeedPageStructure();
const page = await getForYouFeeds({ type: 'Trends', query: { start_pos: 0, num: 20 } });
if (page.response.success) {
  const { feeds, has_next, next_start } = page.response.data;
  console.log({ feeds, has_next, next_start });
}
```

## Response và phân trang

`data` gồm `feeds`, `has_next`, `next_start`; từng feed có thể chứa `id`, `user_id`,
`content`, `user_info`, `create_time`, `pics`, `pics_shape`, `video`, `video_shape`,
`audios`, `tags`, `like_num`, `comment_num`, `reaction_num`, `repost_num` và trường bổ sung.
Các trường tùy loại bài có thể thiếu; types giữ nguyên dữ liệu bổ sung từ server.

Lần kiểm tra trực tiếp trước khi viết tài liệu, các API feed trả HTTP 200,
`result=0` và request ID khớp. Khi yêu cầu `num=2`, `hq` trả 10 bài,
`Associate` trả 1 bài; cả hai trả `next_start=1`.
Do đó không cắt response theo `num`, không tự tính cursor bằng số bài đã nhận:
dùng `next_start` của server khi `has_next=true`.

Chạy lại CLI ngày 15/11/2026 lúc khoảng 03:06 (GMT+7): `structure`, `popular`,
`associate` đều HTTP 200, `success=true`, `result=0`, request ID khớp. Với `num=2`,
Phổ biến lần này trả 11 bài, Kết bạn trả 1 bài, `next_start=1`.

Code tại `scripts/src/lit/api.ts`, types tại `scripts/src/lit/types.ts`, CLI tại
`scripts/src/cli/feed.ts`. Kiểm thử `scripts/test/feed.test.ts` bao phủ endpoint,
query/header, cursor, lỗi session và đầu vào sai.
