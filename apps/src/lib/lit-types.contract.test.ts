// Keeps the hand-written TS types in lit-types.ts in sync with the Rust structs.
// The JSON files are produced by the Rust test `contract_files_match_typescript`
// from the real (anonymised) profile fixture, so they are exactly what the backend sends.
//
// Type level (`npm run typecheck`): each file must satisfy its TS type, and no
// object may carry a key the type does not declare (checked per nested object,
// since excess-property checks do not apply to imported JSON).
// Runtime (`npm test`): the key lists below must match the JSON exactly.
import { describe, expect, it } from "vitest";
import onlinePage from "./contract/online-users-page.json";
import profile from "./contract/user-profile.json";
import wallet from "./contract/wallet.json";
import type { ActiveInfo, MoodStatus, OnlineUsersPage, UserProfile, UserTag, VipInfo, Wallet } from "./lit-types";

const typedProfile = profile satisfies UserProfile;
const typedPage = onlinePage satisfies OnlineUsersPage;
const typedWallet = wallet satisfies Wallet;

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
] = [true, true, true, true, true, true, true, true, true];

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
});
