# Workflow — Danh mục API (catalog)

> **ĐÍNH CHÍNH:** endpoint **KHÔNG mã hoá**. Path nằm plaintext trong annotation Retrofit (`@f("api/sns/v1/lit/...")`) nên grep tĩnh ra hết. (Ghi chú cũ "endpoint mã hoá, giải runtime qua `b0.p`" là **sai** — `b0.p` thực ra chỉ là hàm **nối chuỗi**, và các path đều đọc được trực tiếp.)
>
> Toàn bộ **713 endpoint** (sorted): [../data/endpoints.txt](../data/endpoints.txt). Cách gọi: [03-goi-api.md](03-goi-api.md).

## Trích lại danh sách
```bash
grep -rhoE '"/?api/(sns|ms)/v[0-9]+/[A-Za-z0-9_./{}?=-]+"' base-decompiled/sources \
  | tr -d '"' | sed 's#^/##' | sort -u          # → 713 endpoint
```

## Phân bố theo nhóm (713 endpoint)

| # | Nhóm | Chức năng |
|---:|---|---|
| 143 | `party/*` | Phòng voice (lên/xuống mic, bài hát, PK, layout, background, game…) |
| 82 | `user/*` | Hồ sơ, accost, login, settings, milestones, tag… |
| 39 | `feed/*` | Bảng tin/moments (đăng, comment, like, visibility) |
| 35 | `family/*` | Gia tộc (tạo, donate, clock-in, group msg) |
| 34 | `account/*` | Ví/thanh toán (products, buy_*, account_info, subs) |
| 27 | `home/*` | Trang chủ/khám phá |
| 18 | `propose/*` | Cầu hôn/CP |
| 15 | `gift/*` | Quà tặng |
| 14 | `lit_pass/*` | Battle-pass |
| 11 | `upcoming_activity/*`, `fan_club/*`, `anoy_match/*` | Sự kiện, fan club, match ẩn danh |
| 10 | `api/ms/v1/feedback/*` | CSKH (route `/api/ms` → prod.litmatchs.com) |
| 9 | `shop/*`, `intimate_friend/*` | Cửa hàng, bạn thân |
| 6–8 | `headline, crystal_park, chat, vip, follow, ad, meet_bell, light…` | tính năng phụ |

> Nhóm nhỏ còn lại: `gift_collector, cloud_music, avatar, user_tag, privacy, cp_star_picking, activity, user_visit, toy_gift, feed_exposure, feed_growth, user_milestones, resources, party_challenge, headline`… — xem file đầy đủ.

## Ví dụ mỗi nhóm lớn

**user** — `user/info`, `user/get_info/{id}`, `user/accost_others`, `user/accost_templates`, `user/device_login_accounts`, `user/recommended_info_v2`, `user/about_me/{target_user_id}`
**party** — `party/accept_invite_mic`, `party/apply_waiting`, `party/approve_waiting`, `party/add_song`, `party/pks`, `party/party_layouts`, `party/change_party_background`, `party/game/check_mic`
**account** — `account/account_info`, `account/products`, `account/buy_product`, `account/buy_party_background`, `account/android_subs_status`
**feed** — `feed/certify`, `feed/comment/{id}`, `feed/comment/like/{comment_id}`, `feed/change_visibility/{id}`, `feed/comment_page/{id}`
**family** — `family/create_family`, `family/assets/donate`, `family/clock_in`, `family/ban_group_msg`
**gift** — `gift/gift_bag`, `gift/bonus_history`, `gift/detail_info_by_type_and_id`, `gift/bag_management_rule`
**chat** — `chat/get_chat_token`, `chat/get_icebreakers`, `chat/default_backgrounds`, `chat/banner_settings`
**follow** — `follow/{user}`, `follow/star`, `follow/cancel_star`, `follow/star_conf/{other_user_id}`
**vip** — `vip/home`, `vip/privilege`, `vip/barrage/send`, `vip/barrage/status`
**shop** — `shop/banner_info`, `shop/buy_resource_product`, `shop/resource_product/{tab}`, `shop/latest_resources`

## Lưu ý gọi
- Mọi endpoint đi qua **cùng chuỗi 4 interceptor** (ký giống nhau) — xem [03-goi-api.md](03-goi-api.md) §3. Khác nhau chỉ là path + body/query + có cần `sid`/`lit-user-id` (sau login) hay không.
- `{…}` trong path = `@Path` (Retrofit thay runtime). `?class=v2` = query cứng trong annotation.
- Nhóm `api/ms/*` đi host route `/api/ms` (prod.litmatchs.com), khác base `www.litatom.com`.
