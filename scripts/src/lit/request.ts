import { randomUUID } from 'node:crypto';
import { LIT_BASE_URL } from '../core/constants.ts';
import { isLitatomHttps, isPlainObject } from '../core/validate.ts';
import { litSign, stsSign } from '../crypto/litsign.ts';
import { encodeShadow } from '../crypto/shadow.ts';
import { siua } from '../crypto/siua.ts';
import { COMMON_QUERY_DEFAULTS, type LitProfile, type Query } from './profile.ts';

interface BaseRequest {
  endpoint: string;

  url: URL;

  headers: Record<string, string>;
  requestId: string;
  shadow: true;
}
export interface GetRequest extends BaseRequest { method?: undefined; body?: undefined }
export interface PostRequest extends BaseRequest { method: 'POST'; body: string }
export type LitRequest = GetRequest | PostRequest;

export interface SigningOptions {
  now?: number;
  requestId?: string;
  shadowIv?: Buffer;
}

export function buildGetRequest(endpoint: string, profile: LitProfile, query: Query = {},
  { now = Date.now(), requestId = randomUUID(), shadowIv }: SigningOptions = {}): GetRequest {
  const params: Query = { ...query };
  if (endpoint === 'gift/gifts_v2') {
    params.hash_code ??= '';
    params.classify ??= 'normal';
  }
  for (const [k, v] of Object.entries(profile.commonQuery || COMMON_QUERY_DEFAULTS)) params[k] ??= v;
  params.uuid ??= profile.uuid;
  params.version ??= profile.version;
  params.platform ??= profile.platform;

  let requestPath = endpoint;
  if (requestPath.includes(':id')) {
    if (!profile.userId || !/^[A-Za-z0-9_-]+$/.test(profile.userId)) throw Error('Thiếu userId của tài khoản');
    requestPath = requestPath.replace(':id', encodeURIComponent(profile.userId));
  }
  const url = new URL('/api/sns/v1/lit/' + requestPath, profile.baseUrl || LIT_BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  url.searchParams.set('sid', profile.sid);

  const ts = String(Math.floor(now / 1000));
  const headers: Record<string, string> = {
    accept: 'application/json',
    'v-mode': '0',
    ts,
    litTime: String(now),
    litSign: litSign(now, '1'),
    'X-request-Id': requestId,
    'sts-sign': stsSign(ts, profile.uuid),
    'X-Application-Info': encodeShadow(url.search.slice(1), 3, ...(shadowIv ? [shadowIv] : [])),
  };
  if (profile.userId) headers['lit-user-id'] = profile.userId;

  if (profile.dfpid) headers['X-DFPID'] = profile.dfpid;
  headers['X-SIUA'] = profile.siua || siua();
  return { endpoint, url, headers, requestId, shadow: true };
}

/** `user/get_info/me?from=me&source=me`: the logged-in account's own profile (shared by CLI and typed API). */
export function buildUserMeRequest(profile: LitProfile, options?: SigningOptions): GetRequest {
  return buildGetRequest('user/get_info/me', profile, { from: 'me', source: 'me' }, options);
}

/**
 * `user/get_info/:id` for `targetId` (shared by CLI and typed API). `lit-user-id` stays the CALLER:
 * sent only when known and different from the target. Validating `targetId` is the caller's job.
 */
export function buildUserInfoRequest(profile: LitProfile, targetId: string, query: Query = {},
  options?: SigningOptions): GetRequest {
  const request = buildGetRequest('user/get_info/:id', { ...profile, userId: targetId }, query, options);
  if (profile.userId && profile.userId !== targetId) request.headers['lit-user-id'] = profile.userId;
  else delete request.headers['lit-user-id'];
  return request;
}

export interface ImPostPayloads {
  'user/accost_count': { targetId: string };
  'user/conversation': { conversation_id: string; conversation_type: 0 };
  'user/conversation/source': { source: 'other'; target_user_id: string };
}
export type ImPostEndpoint = keyof ImPostPayloads;

const IM_POST_KEYS: Record<ImPostEndpoint, readonly string[]> = {
  'user/accost_count': ['targetId'],
  'user/conversation': ['conversation_id', 'conversation_type'],
  'user/conversation/source': ['source', 'target_user_id'],
};

export function buildPostRequest<E extends ImPostEndpoint>(endpoint: E, profile: LitProfile, payload: ImPostPayloads[E],
  options?: SigningOptions): PostRequest {

  const keys: readonly string[] | undefined = Object.hasOwn(IM_POST_KEYS, endpoint) ? IM_POST_KEYS[endpoint] : undefined;
  const p: unknown = payload;
  if (!keys || !isPlainObject(p) || Object.keys(p).length !== keys.length || !keys.every(k => Object.hasOwn(p, k))) {
    throw Error('Unsupported IM POST endpoint or payload');
  }
  const target = p.targetId ?? p.conversation_id ?? p.target_user_id;
  if (typeof target !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(target) ||
      (endpoint === 'user/conversation' && p.conversation_type !== 0) ||
      (endpoint === 'user/conversation/source' && p.source !== 'other')) {
    throw Error('Invalid IM metadata payload');
  }
  const request = buildGetRequest(endpoint, profile, {}, options);
  if (!isLitatomHttps(request.url)) throw Error('IM metadata requires https://www.litatom.com');
  request.headers['Content-Type'] = 'application/x-litatom-json; charset=UTF-8';
  return { ...request, method: 'POST', body: encodeShadow(JSON.stringify(payload), 3) };
}
