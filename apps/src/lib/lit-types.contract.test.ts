// Keeps the hand-written TS types in lit-types.ts in sync with the Rust structs.
// The JSON files are produced by the Rust test `contract_files_match_typescript`
// from the real (anonymised) profile fixture, so they are exactly what the backend sends.
//
// Type level (`npm run typecheck`): each file must satisfy its TS type, and no
// object may carry a key the type does not declare (checked per nested object,
// since excess-property checks do not apply to imported JSON).
// Runtime (`npm test`): the key lists below must match the JSON exactly.
import { describe, expect, it } from "vitest";
import conversations from "./contract/conversations.json";
import feedPage from "./contract/feed-page.json";
import historyPage from "./contract/history-page.json";
import onlinePage from "./contract/online-users-page.json";
import savedConversations from "./contract/saved-conversations.json";
import sendOutcome from "./contract/send-outcome.json";
import profile from "./contract/user-profile.json";
import wallet from "./contract/wallet.json";
import type {
  ActiveInfo,
  ChatMessage,
  Conversation,
  FeedItem,
  FeedPage,
  FeedTime,
  HistoryPage,
  MessageContent,
  MessageSender,
  MoodStatus,
  OnlineUsersPage,
  SavedConversation,
  SendOutcome,
  UserProfile,
  UserTag,
  VipInfo,
  Wallet,
} from "./lit-types";

const typedProfile = profile satisfies UserProfile;
const typedPage = onlinePage satisfies OnlineUsersPage;
const typedWallet = wallet satisfies Wallet;
const typedConversations = conversations satisfies Conversation[];
const typedHistory = historyPage satisfies HistoryPage;
const typedSend = sendOutcome satisfies SendOutcome;
const typedFeed = feedPage satisfies FeedPage;
const typedSaved = savedConversations satisfies SavedConversation[];

type Undeclared<Json, Type> = Exclude<keyof Json, keyof Type>;
type MustBeEmpty<K extends PropertyKey> = [K] extends [never] ? true : { undeclaredKeys: K };
type Defined<T> = Exclude<T, null>;

export const noUndeclaredKeys: [
  MustBeEmpty<Undeclared<typeof profile, UserProfile>>,
  MustBeEmpty<Undeclared<(typeof profile.tags)[number], UserTag>>,
  MustBeEmpty<Undeclared<Defined<typeof profile.moodStatusInfo>, MoodStatus>>,
  MustBeEmpty<Undeclared<Defined<typeof profile.vipInfo>, VipInfo>>,
  MustBeEmpty<Undeclared<Defined<typeof profile.activeInfo>, ActiveInfo>>,
  MustBeEmpty<Undeclared<Defined<typeof profile.accountInfo>, Wallet>>,
  MustBeEmpty<Undeclared<typeof onlinePage, OnlineUsersPage>>,
  MustBeEmpty<Undeclared<(typeof onlinePage.users)[number], UserProfile>>,
  MustBeEmpty<Undeclared<typeof wallet, Wallet>>,
  MustBeEmpty<Undeclared<(typeof conversations)[number], Conversation>>,
  MustBeEmpty<Undeclared<typeof historyPage, HistoryPage>>,
  MustBeEmpty<Undeclared<(typeof historyPage.messages)[number], ChatMessage>>,
  MustBeEmpty<Undeclared<(typeof historyPage.messages)[number]["contents"][number], MessageContent>>,
  MustBeEmpty<Undeclared<typeof sendOutcome, SendOutcome>>,
  MustBeEmpty<Undeclared<typeof feedPage, FeedPage>>,
  MustBeEmpty<Undeclared<(typeof feedPage.feeds)[number], FeedItem>>,
  MustBeEmpty<Undeclared<Defined<(typeof feedPage.feeds)[number]["createTime"]>, FeedTime>>,
  MustBeEmpty<Undeclared<Defined<(typeof feedPage.feeds)[number]["userInfo"]>, UserProfile>>,
  MustBeEmpty<Undeclared<(typeof savedConversations)[number], SavedConversation>>,
  MustBeEmpty<Undeclared<Defined<(typeof savedConversations)[number]["lastMessage"]>, ChatMessage>>,
] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];

/** Exhaustive key list: a missing or extra name is a type error. */
function keysOf<T>() {
  return <const K extends readonly (keyof T)[]>(keys: K & ([keyof T] extends [K[number]] ? unknown : never)) => keys;
}

const PROFILE_KEYS = keysOf<UserProfile>()([
  "userId", "litId", "nickname", "avatar", "gender", "age", "bio", "country", "region", "ipCity", "ipCountry",
  "huanxinId", "tags", "moodStatusInfo", "follower", "following", "isVip", "vipInfo", "createTime", "activeInfo",
  "birthdate", "accountInfo", "online",
]);
const WALLET_KEYS = keysOf<Wallet>()(["diamonds", "stars", "amethysts", "frozenDiamonds"]);
const PAGE_KEYS = keysOf<OnlineUsersPage>()(["users", "hasNext", "nextStart"]);
const CONVERSATION_KEYS = keysOf<Conversation>()(["conversationId", "conversationType"]);
const HISTORY_KEYS = keysOf<HistoryPage>()(["messages", "cursor", "isLast"]);
const MESSAGE_KEYS = keysOf<ChatMessage>()(["id", "from", "to", "timestamp", "contents", "sender"]);
const SENDER_KEYS = keysOf<MessageSender>()(["name", "avatar"]);
const CONTENT_KEYS = keysOf<MessageContent>()(["type", "text", "fileName", "address", "duration", "customEvent"]);
const SEND_KEYS = keysOf<SendOutcome>()(["serverId", "localId", "metadataError"]);
const SAVED_KEYS = keysOf<SavedConversation>()([
  "conversationId", "conversationType", "peerName", "peerAvatar", "lastMessage", "updatedAt",
]);
const FEED_PAGE_KEYS = keysOf<FeedPage>()(["feeds", "hasNext", "nextStart"]);
const FEED_ITEM_KEYS = keysOf<FeedItem>()([
  "id", "userId", "userInfo", "content", "createTime", "pics", "video", "tags", "location", "likeNum", "commentNum",
  "repostNum", "liked", "specialType",
]);

describe("Rust ↔ TypeScript contract", () => {
  it("profile has exactly the declared keys, secrets excluded", () => {
    expect(Object.keys(typedProfile).sort()).toEqual([...PROFILE_KEYS].sort());
    expect(JSON.stringify(typedProfile)).not.toMatch(/"session"|"huanxin"|password/);
  });

  it("wallet and online page have exactly the declared keys", () => {
    expect(Object.keys(typedWallet).sort()).toEqual([...WALLET_KEYS].sort());
    expect(Object.keys(typedPage).sort()).toEqual([...PAGE_KEYS].sort());
    expect(Object.keys(typedPage.users[0]!).sort()).toEqual([...PROFILE_KEYS].sort());
  });

  it("chat types have exactly the declared keys", () => {
    expect(Object.keys(typedConversations[0]!).sort()).toEqual([...CONVERSATION_KEYS].sort());
    expect(Object.keys(typedHistory).sort()).toEqual([...HISTORY_KEYS].sort());
    for (const m of typedHistory.messages) {
      expect(Object.keys(m).sort()).toEqual([...MESSAGE_KEYS].sort());
      for (const c of m.contents) expect(Object.keys(c).sort()).toEqual([...CONTENT_KEYS].sort());
      if (m.sender) expect(Object.keys(m.sender).sort()).toEqual([...SENDER_KEYS].sort());
    }
    expect(typedHistory.messages.some((m) => m.sender)).toBe(true);
    expect(Object.keys(typedSend).sort()).toEqual([...SEND_KEYS].sort());
    expect(Object.keys(typedSaved[0]!).sort()).toEqual([...SAVED_KEYS].sort());
    expect(Object.keys(typedSaved[0]!.lastMessage!).sort()).toEqual([...MESSAGE_KEYS].sort());
  });

  it("feed pages have exactly the declared keys, author secrets excluded", () => {
    expect(Object.keys(typedFeed).sort()).toEqual([...FEED_PAGE_KEYS].sort());
    const item = typedFeed.feeds[0]!;
    expect(Object.keys(item).sort()).toEqual([...FEED_ITEM_KEYS].sort());
    expect(Object.keys(item.userInfo!).sort()).toEqual([...PROFILE_KEYS].sort());
    expect(JSON.stringify(typedFeed)).not.toMatch(/"session"|"huanxin"|password/);
  });
});
