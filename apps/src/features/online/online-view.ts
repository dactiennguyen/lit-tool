// Turn a `home/online_users` response into display rows without assuming an
// exact schema: find the user list under `data`, then read common field names.

import {
  AVATAR_KEYS,
  BIO_KEYS,
  ID_KEYS,
  isObject,
  NAME_KEYS,
  pickNumber,
  pickString,
  safeImageUrl,
  type Json,
} from "@/lib/lit-json";

const LIST_KEYS = ["user_infos", "users", "online_users", "user_list", "list", "items", "data"];
const NEXT_KEYS = ["next_start", "next_pos", "next_start_pos", "next"];

export interface OnlineUser {
  /** Stable key: the server id, or a positional fallback when there is none. */
  key: string;
  id: string | null;
  name: string;
  avatarUrl: string | null;
  age: number | null;
  gender: "female" | "male" | null;
  bio: string | null;
  /** "City, CC" from ip_city / country, when present. */
  location: string | null;
  /** Tag names (e.g. Soulprint tags), at most 3. */
  tags: string[];
  /** Mood label, only when the server says to show it. */
  mood: string | null;
  /** `online` flag when the server sends one; null when absent. */
  online: boolean | null;
  raw: Json;
}

export interface OnlinePage {
  users: OnlineUser[];
  /** Server-provided next start position, when the response has one. */
  nextStart: number | null;
  /** Explicit "no more" flag from the server, when present. */
  hasMore: boolean | null;
}

function parseGender(v: unknown): OnlineUser["gender"] {
  const s = String(v ?? "").toLowerCase();
  if (["girl", "female", "f", "woman"].includes(s)) return "female";
  if (["boy", "male", "m", "man"].includes(s)) return "male";
  return null;
}

function readTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((t) => (isObject(t) ? pickString(t, ["tag_name", "name"]) : null))
    .filter((t): t is string => t !== null)
    .slice(0, 3);
}

function readMood(v: unknown): string | null {
  if (!isObject(v) || v.is_show === false) return null;
  return pickString(v, ["mood_name"]);
}

const isUserArray = (v: unknown): v is unknown[] => Array.isArray(v) && v.length > 0 && v.every(isObject);

/** Find the array of user objects: known keys first, then any array of objects. */
function findList(container: unknown): unknown[] {
  if (Array.isArray(container)) return container;
  if (!isObject(container)) return [];
  for (const k of LIST_KEYS) {
    const v = container[k];
    if (Array.isArray(v)) return v;
    if (isObject(v)) {
      const nested = findList(v);
      if (nested.length) return nested;
    }
  }
  return Object.values(container).find(isUserArray) ?? [];
}

/** Some APIs wrap each entry, e.g. `{ user_info: {...}, online: true }`. */
function unwrap(entry: Json): Json {
  for (const k of ["user_info", "user", "info", "profile"]) {
    const v = entry[k];
    if (isObject(v)) return { ...entry, ...v };
  }
  return entry;
}

export function toOnlinePage(response: Json, startPos: number): OnlinePage {
  const data = response.data ?? response;
  const users = findList(data)
    .filter(isObject)
    .map((entry, i): OnlineUser => {
      const u = unwrap(entry);
      const id = pickString(u, ID_KEYS);
      return {
        key: id ?? `pos-${startPos + i}`,
        id,
        name: pickString(u, NAME_KEYS) ?? "(không tên)",
        avatarUrl: safeImageUrl(pickString(u, AVATAR_KEYS)),
        age: pickNumber(u, ["age"]),
        gender: parseGender(u.gender ?? u.sex),
        bio: pickString(u, BIO_KEYS),
        location: [pickString(u, ["ip_city"]), pickString(u, ["country", "ip_country"])].filter(Boolean).join(", ") || null,
        tags: readTags(u.tags),
        mood: readMood(u.mood_status_info),
        online: typeof u.online === "boolean" ? u.online : null,
        raw: entry,
      };
    });
  const meta = isObject(data) ? data : {};
  const hasMoreRaw = meta.has_more ?? meta.has_next ?? meta.more;
  return {
    users,
    nextStart: pickNumber(meta, NEXT_KEYS),
    hasMore: typeof hasMoreRaw === "boolean" ? hasMoreRaw : null,
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
