import { describe, expect, it } from "vitest";
import feedPage from "@/lib/contract/feed-page.json";
import type { FeedItem } from "@/lib/lit-types";
import { makeProfile } from "@/lib/lit-types.test-utils";
import { nextFeedStart, toFeedPost, toFeedView } from "./feed-view";

const item = (over: Partial<FeedItem> = {}): FeedItem => ({
  id: "f1", userId: "u1", userInfo: makeProfile({ userId: "u1", nickname: "Lan" }), content: "Hi", createTime: null,
  pics: [], video: null, tags: [], location: null, likeNum: null, commentNum: null, repostNum: null, liked: null,
  specialType: null, ...over,
});

describe("feed view", () => {
  it("maps the backend's typed page", () => {
    const view = toFeedView(feedPage, 0);
    expect(view.posts).toHaveLength(1);
    const p = view.posts[0]!;
    expect(p.author).toMatchObject({ id: "000000000000000000000001", name: "test_user", meta: "Nam · 25 tuổi", online: true });
    expect(p.time).toBe("2 giờ trước");
    expect(p.pictures[0]!.thumb).toBe(
      "https://www.litatom.com/api/sns/v1/lit/simage/feed_pic_000000000000000000000001_0_1731415000000.jpg",
    );
    expect(p.pictures[0]!.full).toContain("/lit/image/");
    expect([p.likes, p.comments, p.hasVideo]).toEqual([3, 1, false]);
    expect([view.nextStart, view.hasMore]).toEqual([10, true]);
  });

  it("leaves out banners and empty entries, drops unsafe picture keys", () => {
    expect(toFeedPost(item({ specialType: "activity_banner" }), "k")).toBeNull();
    expect(toFeedPost(item({ userInfo: null, content: null }), "k")).toBeNull();
    const p = toFeedPost(item({ id: null, pics: ["ok_1.jpg", "../x", "a b"], video: "v" }), "pos-3")!;
    expect(p.key).toBe("pos-3");
    expect(p.pictures).toHaveLength(1);
    expect(p.hasVideo).toBe(true);
  });

  it("keeps paging with a repeated cursor while pages bring new posts", () => {
    // The server answers next_start 1 on every page; start_pos=1 keeps returning new posts.
    const view = toFeedView({ feeds: [item()], hasNext: true, nextStart: 1 }, 1);
    expect(nextFeedStart(view, new Set(["other"]))).toBe(1);
    expect(nextFeedStart(view, new Set(["f1"]))).toBeUndefined(); // nothing new: stop
    expect(nextFeedStart({ ...view, posts: [] }, new Set())).toBeUndefined(); // empty page: stop
    expect(nextFeedStart({ ...view, hasMore: false }, new Set())).toBeUndefined();
    expect(nextFeedStart({ ...view, nextStart: null }, new Set())).toBeUndefined();
  });
});
