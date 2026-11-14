// Display helpers shared by the profile and online-user views.

import type { UserProfile } from "./lit-types";

export type Gender = "female" | "male";

/** Server sends "girl" / "boy"; other spellings are accepted for safety. */
export function genderOf(value: string | null): Gender | null {
  const s = (value ?? "").toLowerCase();
  if (["girl", "female", "f", "woman"].includes(s)) return "female";
  if (["boy", "male", "m", "man"].includes(s)) return "male";
  return null;
}

export const GENDER_LABEL: Record<Gender, string> = { female: "Nữ", male: "Nam" };

/** "City, CC" from the IP city and country, when present. */
export function locationOf(user: Pick<UserProfile, "ipCity" | "country" | "ipCountry">): string | null {
  return [user.ipCity, user.country ?? user.ipCountry].filter(Boolean).join(", ") || null;
}

/** Mood label, only when the server does not say to hide it. */
export function moodOf(user: Pick<UserProfile, "moodStatusInfo">): string | null {
  const mood = user.moodStatusInfo;
  return mood && mood.isShow !== false ? mood.moodName : null;
}

/** Tag names, at most `limit`. */
export function tagNames(user: Pick<UserProfile, "tags">, limit = Infinity): string[] {
  return user.tags.flatMap((t) => (t.tagName ? [t.tagName] : [])).slice(0, limit);
}

/** Image endpoint on the API host; it redirects to the CDN. `simage` is the small PNG thumbnail. */
const IMAGE_BASE = "https://www.litatom.com/api/sns/v1/lit/";
const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * URL to render for an image field: the server sends CDN file ids (UUIDs), which
 * become `…/simage/<id>` (thumbnail) or `…/image/<id>` (full size). An absolute
 * https URL is passed through. Anything else (relative paths, javascript:, http:)
 * is dropped; the CSP `img-src` allows https only.
 */
export function safeImageUrl(v: string | null, size: "thumb" | "full" = "thumb"): string | null {
  if (!v) return null;
  if (FILE_ID.test(v)) return `${IMAGE_BASE}${size === "thumb" ? "simage" : "image"}/${v.toLowerCase()}`;
  try {
    const url = new URL(v);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
