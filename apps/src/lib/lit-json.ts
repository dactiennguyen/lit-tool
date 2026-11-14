// Helpers for reading Litmatch JSON responses whose exact schema we don't pin
// down. Shared by the profile and online-user views so both read fields the same way.

export type Json = Record<string, unknown>;

export const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

export const ID_KEYS = ["user_id", "uid", "id", "_id"];
export const NAME_KEYS = ["nickname", "nick_name", "name", "user_name", "username"];
export const AVATAR_KEYS = ["avatar", "avatar_url", "head_img", "head_url", "icon", "photo"];
export const BIO_KEYS = ["bio", "signature", "intro", "introduction", "desc", "description"];

/** First non-empty string (or finite number, as text) among `keys`. */
export function pickString(obj: Json, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** First number (or all-digit string) among `keys`. */
export function pickNumber(obj: Json, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Only absolute https URLs are rendered as images: the CSP `img-src` allows
 * https only, and anything else (relative paths, javascript:, http:) is dropped.
 */
export function safeImageUrl(v: string | null): string | null {
  if (!v) return null;
  try {
    const url = new URL(v);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
