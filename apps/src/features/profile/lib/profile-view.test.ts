import { describe, expect, it } from "vitest";
import profile from "@/lib/lit/contract/user-profile.json";
import { makeProfile } from "@/lib/lit/lit-types.test-utils";
import { formatDate, toProfileView } from "./profile-view";

describe("toProfileView", () => {
  it("shows the backend's typed own profile in a fixed order", () => {
    const view = toProfileView(profile);
    expect(view.name).toBe("test_user");
    expect(view.id).toBe("000000000000000000000001");
    // The avatar is a CDN file id, rendered through the image endpoint.
    expect(view.avatarUrl).toBe("https://www.litatom.com/api/sns/v1/lit/simage/00000000-0000-0000-0000-000000000001");
    expect(view.rows).toEqual([
      { label: "Lit ID", value: "1000000001" },
      { label: "Giới tính", value: "Nam" },
      { label: "Tuổi", value: "25" },
      { label: "Ngày sinh", value: "2000-01-01" },
      { label: "Giới thiệu", value: "Test bio" },
      { label: "Vị trí", value: "Test City, VN" },
      { label: "Ngôn ngữ / vùng", value: "vi" },
      { label: "Sở thích", value: "Thể thao" },
      { label: "Tâm trạng", value: "Muốn chat" },
      { label: "Người theo dõi", value: "0" },
      { label: "Đang theo dõi", value: "0" },
      { label: "VIP", value: "Không" },
      { label: "Hoạt động", value: "Hoạt động" },
      { label: "Ngày tạo", value: formatDate(1700000000) },
      { label: "IM ID", value: "love000000000000000001" },
    ]);
  });

  it("leaves out fields the server did not send", () => {
    const view = toProfileView(makeProfile({ nickname: "Lan", age: 20 }));
    expect(view.name).toBe("Lan");
    expect(view.id).toBeNull();
    expect(view.rows).toEqual([{ label: "Tuổi", value: "20" }]);
    expect(toProfileView(makeProfile()).rows).toEqual([]);
  });

  it("describes VIP level, hides a hidden mood and formats large counts", () => {
    const view = toProfileView(
      makeProfile({
        isVip: true,
        vipInfo: { level: 3, expireTime: 0 },
        moodStatusInfo: { moodName: "Ẩn", isShow: false },
        follower: 12345,
      }),
    );
    expect(view.rows).toEqual([
      { label: "Người theo dõi", value: (12345).toLocaleString("vi-VN") },
      { label: "VIP", value: "Có, cấp 3" },
    ]);
  });

  it("renders https avatar URLs and drops other values", () => {
    expect(toProfileView(makeProfile({ avatar: "https://cdn.example.com/a.jpg" })).avatarUrl).toBe(
      "https://cdn.example.com/a.jpg",
    );
    for (const avatar of [null, "javascript:alert(1)", "avatars/123.jpg", "http://cdn.example.com/a.jpg"]) {
      expect(toProfileView(makeProfile({ avatar })).avatarUrl).toBeNull();
    }
  });
});
