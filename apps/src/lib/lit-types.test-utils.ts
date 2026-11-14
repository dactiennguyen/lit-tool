// Builders for tests: a profile with every field null, overridable per test.
import type { OnlineUsersPage, UserProfile, Wallet } from "./lit-types";

export const EMPTY_PROFILE: UserProfile = {
  userId: null, litId: null, nickname: null, avatar: null, gender: null, age: null, bio: null, country: null,
  region: null, ipCity: null, ipCountry: null, huanxinId: null, tags: [], moodStatusInfo: null, follower: null,
  following: null, isVip: null, vipInfo: null, createTime: null, activeInfo: null, birthdate: null,
  accountInfo: null, online: null,
};

export const makeProfile = (overrides: Partial<UserProfile> = {}): UserProfile => ({ ...EMPTY_PROFILE, ...overrides });

export const makePage = (users: UserProfile[], overrides: Partial<OnlineUsersPage> = {}): OnlineUsersPage => ({
  users, hasNext: null, nextStart: null, ...overrides,
});

export const makeWallet = (overrides: Partial<Wallet> = {}): Wallet => ({
  diamonds: null, stars: null, amethysts: null, frozenDiamonds: null, ...overrides,
});
