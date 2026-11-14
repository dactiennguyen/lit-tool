// Display model for a typed feed page.

import { GENDER_LABEL, genderOf, safeImageUrl } from "@/lib/lit-format";
import type { FeedItem, FeedPage } from "@/lib/lit-types";

export interface FeedPicture {
  thumb: string;
  full: string;
}

export interface FeedPost {
  /** Stable key: the post id, or a positional fallback. */
  key: string;
  author: {
    id: string | null;
    name: string;
    avatarUrl: string | null;
    /** "Nữ · 24 tuổi". */
    meta: string | null;
    online: boolean;
  };
  /** Server wording, e.g. "2 giờ trước". */
  time: string | null;
  location: string | null;
  content: string | null;
  pictures: FeedPicture[];
  hasVideo: boolean;
  tags: string[];
  likes: number;
  comments: number;
}

export interface FeedView {
  posts: FeedPost[];
  nextStart: number | null;
  hasMore: boolean | null;
}

/** Posts only: entries such as activity banners, or without author and text, are left out. */
export function toFeedPost(item: FeedItem, fallbackKey: string): FeedPost | null {
  if (item.specialType) return null;
  const u = item.userInfo;
  const pictures = item.pics.flatMap((p) => {
    const thumb = safeImageUrl(p, "thumb");
    const full = safeImageUrl(p, "full");
    return thumb && full ? [{ thumb, full }] : [];
  });
  if (!u && !item.content && pictures.length === 0) return null;
  const gender = genderOf(u?.gender ?? null);
  const meta = [gender && GENDER_LABEL[gender], u?.age != null && `${u.age} tuổi`].filter(Boolean).join(" · ");
  return {
    key: item.id ?? fallbackKey,
    author: {
      id: u?.userId ?? item.userId,
      name: u?.nickname ?? "(không tên)",
      avatarUrl: safeImageUrl(u?.avatar ?? null),
      meta: meta || null,
      online: u?.online === true,
    },
    time: item.createTime?.timeDesc ?? null,
    location: item.location,
    content: item.content,
    pictures,
    hasVideo: item.video !== null,
    tags: item.tags.slice(0, 5),
    likes: item.likeNum ?? 0,
    comments: item.commentNum ?? 0,
  };
}

export function toFeedView(page: FeedPage, startPos: number): FeedView {
  return {
    posts: page.feeds.flatMap((f, i) => toFeedPost(f, `pos-${startPos + i}`) ?? []),
    nextStart: page.nextStart,
    hasMore: page.hasNext,
  };
}

/**
 * Next start position, or undefined when there is nothing more. A page that
 * adds no new post means the server ignored the cursor: stop instead of looping.
 */
export function nextFeedStart(page: FeedView, raw: number, seenBefore: ReadonlySet<string>): number | undefined {
  if (page.hasMore === false || page.nextStart === null) return undefined;
  if (page.posts.length > 0 && page.posts.every((p) => seenBefore.has(p.key))) return undefined;
  return page.nextStart > raw ? page.nextStart : undefined;
}
