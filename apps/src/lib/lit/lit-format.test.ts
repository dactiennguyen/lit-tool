import { describe, expect, it } from "vitest";
import { genderOf, locationOf, moodOf, presenceOf, safeImageUrl, tagNames } from "./lit-format";
import { makeProfile } from "./lit-types.test-utils";

describe("presenceOf", () => {
  const at = (activeInfo: Parameters<typeof presenceOf>[0]["activeInfo"]) => presenceOf({ activeInfo }, 10_000_000_000);
  it("is online with the green light, else says when", () => {
    expect(at({ time: 1, timeDesc: "Hoạt động", showLight: true })).toEqual({ online: true, text: "Đang online" });
    expect(at({ time: 1, timeDesc: "2 giờ trước", showLight: false })).toEqual({ online: false, text: "2 giờ trước" });
    expect(at({ time: 10_000_000 - 3 * 3600, timeDesc: null, showLight: null })).toEqual({ online: false, text: "Hoạt động 3 giờ trước" });
    expect(at({ time: null, timeDesc: null, showLight: null })).toBeNull();
    expect(at(null)).toBeNull();
  });
});

describe("lit-format", () => {
  it("maps server genders", () => {
    expect(genderOf("girl")).toBe("female");
    expect(genderOf("BOY")).toBe("male");
    expect(genderOf("other")).toBeNull();
    expect(genderOf(null)).toBeNull();
  });

  it("prefers country over ip country in the location", () => {
    expect(locationOf(makeProfile({ ipCity: "Hue", country: "VN", ipCountry: "US" }))).toBe("Hue, VN");
    expect(locationOf(makeProfile({ ipCountry: "US" }))).toBe("US");
    expect(locationOf(makeProfile())).toBeNull();
  });

  it("shows a mood unless the server hides it", () => {
    expect(moodOf(makeProfile({ moodStatusInfo: { moodName: "A", isShow: null } }))).toBe("A");
    expect(moodOf(makeProfile({ moodStatusInfo: { moodName: "A", isShow: false } }))).toBeNull();
    expect(moodOf(makeProfile())).toBeNull();
  });

  it("skips nameless tags and applies the limit", () => {
    const tags = [{ tagId: null, tagName: "A" }, { tagId: "x", tagName: null }, { tagId: null, tagName: "B" }];
    expect(tagNames(makeProfile({ tags }))).toEqual(["A", "B"]);
    expect(tagNames(makeProfile({ tags }), 1)).toEqual(["A"]);
  });

  it("turns CDN file ids into image URLs and keeps absolute https URLs", () => {
    const id = "00000000-0000-0000-0000-00000000000A";
    expect(safeImageUrl(id)).toBe("https://www.litatom.com/api/sns/v1/lit/simage/00000000-0000-0000-0000-00000000000a");
    expect(safeImageUrl(id, "full")).toBe("https://www.litatom.com/api/sns/v1/lit/image/00000000-0000-0000-0000-00000000000a");
    expect(safeImageUrl("https://x.example/a.png")).toBe("https://x.example/a.png");
    expect(safeImageUrl("feed_pic_0a1b_0_1731415000000.jpg", "full")).toBe(
      "https://www.litatom.com/api/sns/v1/lit/image/feed_pic_0a1b_0_1731415000000.jpg",
    );
    for (const v of [null, "", "0000-../x", "a..b", "_x", "a b", "http://x/a.png", "javascript:alert(1)"]) {
      expect(safeImageUrl(v)).toBeNull();
    }
  });
});
