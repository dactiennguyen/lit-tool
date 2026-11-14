import { describe, expect, it } from "vitest";
import { genderOf, locationOf, moodOf, safeImageUrl, tagNames } from "./lit-format";
import { makeProfile } from "./lit-types.test-utils";

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

  it("keeps only absolute https image URLs", () => {
    expect(safeImageUrl("https://x.example/a.png")).toBe("https://x.example/a.png");
    for (const v of [null, "", "00000000-0000-0000-0000-000000000001", "http://x/a.png", "javascript:alert(1)"]) {
      expect(safeImageUrl(v)).toBeNull();
    }
  });
});
