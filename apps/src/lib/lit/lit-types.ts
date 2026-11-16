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
  /** The green "online" light of the Litmatch app. */
  showLight: boolean | null;
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

/** One entry of `user/conversations` (lit_types.rs `Conversation`). */
export interface Conversation {
  /** The peer's IM (Hyphenate) username, or a group id. */
  conversationId: string;
  /** 0 = one-to-one, 1 = group; other values cannot be opened. */
  conversationType: number;
}

/** A conversation saved in sky.db (chat/store.rs `SavedConversation`). */
export interface SavedConversation {
  conversationId: string;
  conversationType: number;
  peerName: string | null;
  /** CDN file id of the avatar. */
  peerAvatar: string | null;
  /** The newest message known. */
  lastMessage: ChatMessage | null;
  /** When the row last changed (ms since the epoch). */
  updatedAt: number;
}

// ---------- IM (hx.rs / chat.rs) ----------

/** 0 text, 1 image, 2 video, 3 location, 4 voice, 5 file, 6 command, 7 custom, 8 combine. */
export interface MessageContent {
  type: number;
  text: string | null;
  fileName: string | null;
  address: string | null;
  /** Seconds, for voice and video. */
  duration: number | null;
  customEvent: string | null;
}

export interface ChatMessage {
  /** uint64 server id, kept as text. */
  id: string;
  from: string | null;
  to: string | null;
  /** Milliseconds since the epoch. */
  timestamp: number | null;
  contents: MessageContent[];
  /** Sender's name and avatar from the message's push payload, when present. */
  sender: MessageSender | null;
}

export interface MessageSender {
  name: string | null;
  /** CDN file id of the avatar. */
  avatar: string | null;
}

/** One `messageroaming` page, newest first. */
export interface HistoryPage {
  messages: ChatMessage[];
  /** Pass back to read older messages; null on the last page. */
  cursor: string | null;
  isLast: boolean;
}

/** Server acceptance of one sent message (not delivery or read). */
export interface SendOutcome {
  serverId: string;
  localId: string;
  /** The message was sent but a metadata write after it failed: do not resend. */
  metadataError: string | null;
}

export interface FeedTime {
  /** Unix seconds. */
  time: number | null;
  /** Server wording, e.g. "2 giờ trước". */
  timeDesc: string | null;
}

/** One post of a feed (`feed/hq`, `feed/sep_page_feeds/Associate`). */
export interface FeedItem {
  id: string | null;
  userId: string | null;
  /** The author. */
  userInfo: UserProfile | null;
  content: string | null;
  createTime: FeedTime | null;
  /** Picture file keys (CDN ids, not URLs). */
  pics: string[];
  /** Set when the post has a video. */
  video: string | null;
  tags: string[];
  location: string | null;
  likeNum: number | null;
  commentNum: number | null;
  repostNum: number | null;
  liked: boolean | null;
  /** Set on non-post entries mixed into a feed (e.g. "activity_banner"). */
  specialType: string | null;
}

export interface FeedPage {
  feeds: FeedItem[];
  hasNext: boolean | null;
  /** Server cursor for the next page. */
  nextStart: number | null;
}
