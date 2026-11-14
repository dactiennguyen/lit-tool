// Litmatch API responses as sent by the Tauri backend.
//
// Hand-written mirror of apps/src-tauri/src/lit_types.rs (serialized as camelCase).
// Every field is always present; `null` means the server did not send it or sent
// a value of an unexpected type. When a Rust struct changes, update this file and
// regenerate the contract JSON (`UPDATE_CONTRACT=1 cargo test contract` in
// src-tauri); lit-types.contract.test.ts then fails typecheck until both match.

/** Wallet balances (`account/account_info`, or `accountInfo` in the own profile). */
export interface Wallet {
  diamonds: number | null;
  stars: number | null;
  amethysts: number | null;
  frozenDiamonds: number | null;
}

export interface UserTag {
  tagId: string | null;
  tagName: string | null;
}

export interface MoodStatus {
  moodName: string | null;
  /** Server's "show this mood" flag. */
  isShow: boolean | null;
}

export interface ActiveInfo {
  /** Unix seconds. */
  time: number | null;
  /** Server-localised text, e.g. "Hoạt động". */
  timeDesc: string | null;
}

export interface VipInfo {
  level: number | null;
  /** Unix seconds; 0 when never VIP. */
  expireTime: number | null;
}

/** A user from `user/get_info/me`, `user/get_info/:id` or the online list. */
export interface UserProfile {
  userId: string | null;
  litId: number | null;
  nickname: string | null;
  /** CDN file id (a UUID), not a URL. */
  avatar: string | null;
  /** "girl" / "boy" as sent by the server. */
  gender: string | null;
  age: number | null;
  bio: string | null;
  country: string | null;
  region: string | null;
  ipCity: string | null;
  ipCountry: string | null;
  /** IM (Hyphenate) user id. The IM password never reaches the webview. */
  huanxinId: string | null;
  tags: UserTag[];
  moodStatusInfo: MoodStatus | null;
  follower: number | null;
  following: number | null;
  isVip: boolean | null;
  vipInfo: VipInfo | null;
  /** Unix seconds. */
  createTime: number | null;
  activeInfo: ActiveInfo | null;
  /** YYYY-MM-DD; own profile only. */
  birthdate: string | null;
  /** Own profile only. */
  accountInfo: Wallet | null;
  /** Online list only. */
  online: boolean | null;
}

/** One page of `home/online_users`. */
export interface OnlineUsersPage {
  users: UserProfile[];
  hasNext: boolean | null;
  /** Server cursor for the next page; may legitimately be 0. */
  nextStart: number | null;
}
