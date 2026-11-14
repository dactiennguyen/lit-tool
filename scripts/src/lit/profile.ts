import { LIT_BASE_URL } from '../core/constants.ts';
import { readJson } from '../core/cli.ts';
import { defaultEnvFile, readDotEnv } from '../core/env.ts';
import { isPlainObject } from '../core/validate.ts';

export const COMMON_QUERY_DEFAULTS = Object.freeze({
  app_source: 'litmatch', appid: 'NxUUhRSQH3qPJmY2Vn/edRz4vrc=',
  lang: 'vi', loc: 'US', loctype: '0', model: 'Pixel 8 Pro', net_type: 'wifi', os: '33',
});
export type CommonQuery = { -readonly [K in keyof typeof COMMON_QUERY_DEFAULTS]: string };

export interface LitProfile {
  sid: string;
  uuid: string;
  version: string;
  platform: 'android';
  userId?: string | undefined;

  dfpid?: string | null | undefined;

  siua?: string | null | undefined;
  baseUrl?: string;
  commonQuery?: CommonQuery;
}

export type QueryValue = string | number | boolean;
export type Query = Record<string, QueryValue>;

const QUERY_KEYS = new Set([
  'hash_code', 'classify', 'from', 'source', 'is_mini_profile', 'is_zone',
  'start_pos', 'start_ts', 'num', 'target_uid', 'version', 'app_source',
  'appid', 'lang', 'loc', 'loctype', 'model', 'net_type', 'os', 'platform', 'uuid', 'han',
]);

export function validateProfile(profile: unknown): LitProfile {
  if (!isPlainObject(profile) ||
      typeof profile.sid !== 'string' || !profile.sid ||
      typeof profile.uuid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(profile.uuid) ||
      typeof profile.version !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(profile.version) ||
      profile.platform !== 'android') throw Error('Thiếu hoặc sai LIT_SID, LIT_UUID, LIT_VERSION, LIT_PLATFORM');
  if (profile.userId !== undefined && (typeof profile.userId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(profile.userId))) {
    throw Error('userId không hợp lệ');
  }
  for (const k of ['dfpid', 'siua'] as const) {
    const v = profile[k];
    if (v !== undefined && v !== null && (typeof v !== 'string' || !/^[A-Za-z0-9+/=_-]{1,512}$/.test(v))) {
      throw Error(`${k} không hợp lệ`);
    }
  }
  return profile as unknown as LitProfile;
}

export function loadEnvProfile(file: string = defaultEnvFile()): LitProfile {
  const values = readDotEnv(file);
  const get = (name: string): string | undefined => process.env[name] ?? values[name];
  const profile = validateProfile({
    sid: get('LIT_SID'), uuid: get('LIT_UUID'), version: get('LIT_VERSION'),
    platform: get('LIT_PLATFORM'), userId: get('LIT_USER_ID'),
    dfpid: get('LIT_DFPID'), siua: get('LIT_SIUA'),
  });
  const rawBase = get('LIT_BASE_URL');
  if (rawBase) {
    let url: URL;
    try { url = new URL(rawBase); } catch { throw Error('LIT_BASE_URL không hợp lệ'); }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw Error('LIT_BASE_URL phải là http(s)');
    profile.baseUrl = url.origin;
  } else profile.baseUrl = LIT_BASE_URL;
  const commonQuery: CommonQuery = { ...COMMON_QUERY_DEFAULTS };
  for (const k of Object.keys(commonQuery) as (keyof CommonQuery)[]) {
    const v = get('LIT_' + k.toUpperCase());
    if (typeof v === 'string' && v) commonQuery[k] = v;
  }
  profile.commonQuery = commonQuery;
  return profile;
}

export function loadJsonProfile(file: string): LitProfile {
  return validateProfile(readJson(file, 'Không đọc được profile JSON'));
}

export function loadQuery(file?: string): Query {
  if (!file) return {};
  const query = readJson(file, 'Không đọc được query JSON');
  if (!isPlainObject(query)) throw Error('Query JSON phải là object');
  for (const [key, value] of Object.entries(query)) {
    if (!QUERY_KEYS.has(key) || !['string', 'number', 'boolean'].includes(typeof value)) {
      throw Error('Query có tên hoặc kiểu không được hỗ trợ');
    }
  }
  return query as Query;
}
