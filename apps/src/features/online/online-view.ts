// Display rows for a typed `home/online_users` page.

import { genderOf, locationOf, moodOf, safeImageUrl, tagNames, type Gender } from "@/lib/lit-format";
import type { OnlineUsersPage } from "@/lib/lit-types";

export interface OnlineUser {
  /** Stable key: the server id, or a positional fallback when there is none. */
  key: string;
  id: string | null;
  name: string;
  avatarUrl: string | null;
  age: number | null;
  gender: Gender | null;
  bio: string | null;
  /** "City, CC" from ip_city / country, when present. */
  location: string | null;
  /** Tag names (e.g. Soulprint tags), at most 3. */
  tags: string[];
  /** Mood label, only when the server says to show it. */
  mood: string | null;
  /** `online` flag when the server sends one; null when absent. */
  online: boolean | null;
}

export interface OnlinePage {
  users: OnlineUser[];
  /** Server-provided next start position, when the response has one. */
  nextStart: number | null;
  /** Explicit "more pages" flag from the server, when present. */
  hasMore: boolean | null;
}

export function toOnlinePage(page: OnlineUsersPage, startPos: number): OnlinePage {
  return {
    users: page.users.map((u, i) => ({
      key: u.userId ?? `pos-${startPos + i}`,
      id: u.userId,
      name: u.nickname ?? "(không tên)",
      avatarUrl: safeImageUrl(u.avatar),
      age: u.age,
      gender: genderOf(u.gender),
      bio: u.bio,
      location: locationOf(u),
      tags: tagNames(u, 3),
      mood: moodOf(u),
      online: u.online,
    })),
    nextStart: page.nextStart,
    hasMore: page.hasNext,
  };
}

/**
 * Next start position, or undefined when there is nothing more to load.
 * `seenBefore` holds the keys from earlier pages: a page that adds nobody new
 * means the server ignored `start_pos`, so stop instead of paging forever.
 */
export function nextStartPos(
  page: OnlinePage,
  startPos: number,
  pageSize: number,
  seenBefore: ReadonlySet<string> = new Set(),
): number | undefined {
  if (page.hasMore === false || page.users.length === 0) return undefined;
  if (page.users.every((u) => seenBefore.has(u.key))) return undefined;
  if (page.nextStart !== null) return page.nextStart > startPos ? page.nextStart : undefined;
  return page.users.length < pageSize ? undefined : startPos + page.users.length;
}
