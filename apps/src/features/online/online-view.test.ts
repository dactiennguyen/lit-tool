import { describe, expect, it } from "vitest";
import { nextStartPos, toOnlinePage } from "./online-view";

describe("toOnlinePage", () => {
  it("reads users from a known list key", () => {
    const page = toOnlinePage(
      {
        success: true,
        result: 0,
        data: {
          user_infos: [
            { user_id: "a1", nickname: "Lan", avatar: "https://cdn.x/a.jpg", age: "21", gender: "girl", bio: "hi" },
            { user_id: "b2", nickname: "Nam", gender: "boy", avatar: "http://cdn.x/b.jpg" },
          ],
          has_more: true,
        },
      },
      0,
    );
    expect(page.users.map((u) => [u.id, u.name, u.age, u.gender, u.avatarUrl])).toEqual([
      ["a1", "Lan", 21, "female", "https://cdn.x/a.jpg"],
      ["b2", "Nam", null, "male", null],
    ]);
    expect(page.users[0]?.bio).toBe("hi");
    expect(page.hasMore).toBe(true);
  });

  it("finds an unknown list key and unwraps nested user objects", () => {
    const page = toOnlinePage({ data: { whatever: [{ user_info: { uid: 7, name: "X" }, online: true }] } }, 30);
    expect(page.users[0]).toMatchObject({ id: "7", name: "X", key: "7" });
  });

  it("handles data being the array itself and missing ids", () => {
    const page = toOnlinePage({ data: [{ nickname: "No id" }] }, 15);
    expect(page.users[0]).toMatchObject({ id: null, key: "pos-15" });
  });

  it("returns no users for an unexpected shape", () => {
    expect(toOnlinePage({ data: { count: 3 } }, 0).users).toEqual([]);
  });
});

describe("nextStartPos", () => {
  const users = (n: number) => toOnlinePage({ data: Array.from({ length: n }, (_, i) => ({ id: i })) }, 0);

  it("advances by the page size when the page is full", () => {
    expect(nextStartPos(users(15), 0, 15)).toBe(15);
  });
  it("stops on a short page, an empty page or has_more=false", () => {
    expect(nextStartPos(users(4), 15, 15)).toBeUndefined();
    expect(nextStartPos(users(0), 15, 15)).toBeUndefined();
    expect(nextStartPos({ ...users(15), hasMore: false }, 0, 15)).toBeUndefined();
  });
  it("stops when a page only repeats users already shown", () => {
    const page = users(15);
    expect(nextStartPos(page, 15, 15, new Set(page.users.map((u) => u.key)))).toBeUndefined();
    expect(nextStartPos(page, 15, 15, new Set(["other"]))).toBe(30);
  });
  it("prefers the server's next start and refuses to go backwards", () => {
    expect(nextStartPos({ ...users(15), nextStart: 40 }, 15, 15)).toBe(40);
    expect(nextStartPos({ ...users(15), nextStart: 15 }, 15, 15)).toBeUndefined();
  });
});
