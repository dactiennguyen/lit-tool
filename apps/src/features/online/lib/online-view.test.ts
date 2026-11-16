import { describe, expect, it } from "vitest";
import onlinePage from "@/lib/lit/contract/online-users-page.json";
import { makePage, makeProfile } from "@/lib/lit/lit-types.test-utils";
import { nextStartPos, toOnlinePage } from "./online-view";

describe("toOnlinePage", () => {
  it("maps the backend's typed page", () => {
    const page = toOnlinePage(onlinePage, 0);
    expect(page.users).toEqual([
      {
        key: "000000000000000000000001",
        id: "000000000000000000000001",
        name: "test_user",
        avatarUrl: "https://www.litatom.com/api/sns/v1/lit/simage/00000000-0000-0000-0000-000000000001",
        age: 25,
        gender: "male",
        bio: "Test bio",
        location: "Test City, VN",
        tags: ["Thể thao"],
        mood: "Muốn chat",
        online: true,
      },
    ]);
    expect(page.nextStart).toBe(15);
    expect(page.hasMore).toBe(true);
  });

  it("reads gender, location, at most 3 tags, mood and the online flag", () => {
    const tags = ["A", "B", "C", "D"].map((tagName) => ({ tagId: null, tagName }));
    const page = toOnlinePage(
      makePage([
        makeProfile({
          userId: "a1", nickname: "Lan", gender: "girl", ipCity: "Ha Noi", ipCountry: "VN", online: false,
          tags: [...tags, { tagId: "x", tagName: null }], moodStatusInfo: { moodName: "Muốn chat", isShow: true },
        }),
        makeProfile({ userId: "b2", moodStatusInfo: { moodName: "Ẩn", isShow: false } }),
      ]),
      0,
    );
    expect(page.users[0]).toMatchObject({
      gender: "female", location: "Ha Noi, VN", tags: ["A", "B", "C"], mood: "Muốn chat", online: false,
    });
    expect(page.users[1]).toMatchObject({ name: "(không tên)", location: null, tags: [], mood: null, online: null });
  });

  it("uses a positional key when the server sends no id", () => {
    const page = toOnlinePage(makePage([makeProfile({ nickname: "No id" })]), 15);
    expect(page.users[0]).toMatchObject({ id: null, key: "pos-15" });
  });

  it("keeps a server cursor of 0 and an absent has-next as null", () => {
    expect(toOnlinePage(makePage([], { nextStart: 0, hasNext: false }), 0)).toMatchObject({ nextStart: 0, hasMore: false });
    expect(toOnlinePage(makePage([]), 0)).toMatchObject({ nextStart: null, hasMore: null });
  });
});

describe("nextStartPos", () => {
  const users = (n: number) =>
    toOnlinePage(makePage(Array.from({ length: n }, (_, i) => makeProfile({ userId: `u${i}` }))), 0);

  it("advances by the page size when the page is full", () => {
    expect(nextStartPos(users(15), 0, 15)).toBe(15);
  });
  it("stops on a short page, an empty page or has_next=false", () => {
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
