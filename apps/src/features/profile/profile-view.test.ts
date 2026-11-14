import { describe, expect, it } from "vitest";
import { toProfileView } from "./profile-view";

describe("toProfileView", () => {
  it("reads the profile from `data`", () => {
    const view = toProfileView({
      success: true,
      result: 0,
      data: { nickname: " Lan ", avatar: "https://cdn.example.com/a.jpg", user_id: "u1", age: 20, tags: ["x"] },
    });
    expect(view.name).toBe("Lan");
    expect(view.avatarUrl).toBe("https://cdn.example.com/a.jpg");
    expect(view.id).toBe("u1");
    expect(view.fields).toEqual([
      ["nickname", " Lan "],
      ["avatar", "https://cdn.example.com/a.jpg"],
      ["user_id", "u1"],
      ["age", 20],
    ]);
  });

  it("falls back to the root object and hides envelope fields", () => {
    const view = toProfileView({ success: true, result: 0, name: "B", id: 7 });
    expect(view.name).toBe("B");
    expect(view.id).toBe("7");
    expect(view.fields).toEqual([
      ["name", "B"],
      ["id", 7],
    ]);
  });

  it("never renders non-http avatar values as images", () => {
    expect(toProfileView({ data: { avatar: "javascript:alert(1)" } }).avatarUrl).toBeNull();
    expect(toProfileView({ data: { avatar: "avatars/123.jpg" } }).avatarUrl).toBeNull();
  });
});
