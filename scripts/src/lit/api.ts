import { ONLINE_PAGE_MAX, ONLINE_START_MAX } from '../core/constants.ts';
import { isId, isPlainObject, parseIntInRange } from '../core/validate.ts';
import { fetchGet, isLitAccepted, type LitResponse as RawResponse } from './client.ts';
import { loadEnvProfile, type LitProfile } from './profile.ts';
import { buildGetRequest, buildUserInfoRequest, buildUserMeRequest, type GetRequest } from './request.ts';
import type {
  FeedListData, FeedPageStructure, FeedQuery, ForYouFeedType,
  LitApiResponse, OnlineUsersData, OnlineUsersQuery, UserInfo, UserInfoMe,
  UserInfoQuery, Wallet,
} from './types.ts';

export interface ApiResult<T> extends RawResponse {
  response: LitApiResponse<T>;
}

export interface ApiOptions {
  profile?: LitProfile;
}

/** The server sends `message` / `trace_id` as a string, as null, or not at all. */
const isOptionalText = (value: unknown): boolean => value === undefined || value === null || typeof value === 'string';

/**
 * Validate the JSON envelope. A rejection (`success: false`) is returned as a typed failure so the
 * caller keeps its `result` code. A success must pass the same rule as the rest of the client and
 * the Rust backend (`isLitAccepted`: HTTP 2xx, success, result 0) and carry data.
 */
export function decodeLitResponse<T>(body: Buffer, httpStatus = 200): LitApiResponse<T> {
  let value: unknown;
  try { value = JSON.parse(body.toString('utf8')); }
  catch { throw Error(`API response is not JSON (HTTP ${httpStatus})`); }
  if (!isPlainObject(value) || typeof value.success !== 'boolean' ||
      typeof value.result !== 'number' || !Number.isInteger(value.result) ||
      !isOptionalText(value.message) || !isOptionalText(value.trace_id)) {
    throw Error('Invalid API response envelope');
  }
  if (value.success) {
    if (!isLitAccepted({ http_status: httpStatus, success: true, result: value.result })) {
      throw Error(`API reported success with HTTP ${httpStatus}, result ${value.result}`);
    }
    if (!Object.hasOwn(value, 'data') || value.data == null) throw Error('Successful API response has no data');
  }
  return value as unknown as LitApiResponse<T>;
}

export async function fetchJsonGet<T>(request: GetRequest): Promise<ApiResult<T>> {
  const raw = await fetchGet(request);
  return { ...raw, response: decodeLitResponse<T>(raw.body, raw.summary.http_status) };
}

// The functions below are async so every failure (bad input, missing .env profile, network)
// arrives as a rejected promise, never as a synchronous throw.

export async function getUserMe({ profile = loadEnvProfile() }: ApiOptions = {}): Promise<ApiResult<UserInfoMe>> {
  return fetchJsonGet<UserInfoMe>(buildUserMeRequest(profile));
}

export async function getUserInfo(targetId: string,
  { profile = loadEnvProfile(), query = {} }: ApiOptions & { query?: UserInfoQuery } = {}): Promise<ApiResult<UserInfo>> {
  if (!isId(targetId)) throw Error('user_id không hợp lệ');
  return fetchJsonGet<UserInfo>(buildUserInfoRequest(profile, targetId, { ...query }));
}

export async function getOnlineUsers({ profile = loadEnvProfile(), query = {} }:
  ApiOptions & { query?: OnlineUsersQuery } = {}): Promise<ApiResult<OnlineUsersData>> {
  const { start_pos = 0, num = 15, from_page = 'home' } = query;
  const startPos = parseIntInRange(start_pos, 0, ONLINE_START_MAX, 'start_pos');
  const pageSize = parseIntInRange(num, 1, ONLINE_PAGE_MAX, 'num');
  if (!from_page) throw Error('from_page is required');
  return fetchJsonGet<OnlineUsersData>(buildGetRequest('home/online_users', profile,
    { start_pos: startPos, num: pageSize, from_page }));
}

export async function getAccountInfo({ profile = loadEnvProfile() }: ApiOptions = {}): Promise<ApiResult<Wallet>> {
  return fetchJsonGet<Wallet>(buildGetRequest('account/account_info', profile));
}

export async function getFeedPageStructure({ profile = loadEnvProfile() }: ApiOptions = {}): Promise<ApiResult<FeedPageStructure>> {
  return fetchJsonGet<FeedPageStructure>(buildGetRequest('feed/feed_page_structure', profile));
}

export interface FeedOptions extends ApiOptions {
  query?: FeedQuery;
}

export async function getForYouFeeds({ profile = loadEnvProfile(), type = 'Trends', query = {} }:
  FeedOptions & { type?: ForYouFeedType } = {}): Promise<ApiResult<FeedListData>> {
  if (type !== 'Trends' && type !== 'Associate') throw Error('Feed type must be Trends or Associate');
  const { start_pos = 0, num = 20 } = query;
  const startPos = parseIntInRange(start_pos, 0, 2_147_483_647, 'start_pos');
  const pageSize = parseIntInRange(num, 1, 50, 'num');
  const endpoint = type === 'Trends' ? 'feed/hq' : 'feed/sep_page_feeds/Associate';
  return fetchJsonGet<FeedListData>(buildGetRequest(endpoint, profile, { start_pos: startPos, num: pageSize }));
}

export async function getPopularFeeds(options: FeedOptions = {}): Promise<ApiResult<FeedListData>> {
  return getForYouFeeds({ ...options, type: 'Trends' });
}
