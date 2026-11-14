import { DETECT_IV_HEX, DETECT_KEY_HEX, MAX_FRAME_BYTES } from '../core/constants.ts';
import { readLimited, safeFetch } from '../core/http.ts';
import { isPlainObject } from '../core/validate.ts';
import { decryptInflate, deflateEncrypt } from '../crypto/aes.ts';

const KEY = Buffer.from(DETECT_KEY_HEX, 'hex');
const IV = Buffer.from(DETECT_IV_HEX, 'hex');
const EYE_URL = 'https://cloud.litatom.com/api/sns/v1/lit/eye?eyeversion=1.0.1';
const QUERY_KEYS = ['sid', 'loc', 'uuid', 'version', 'lang', 'han', 'platform', 'model', 'loctype', 'os', 'net_type', 'appid'] as const;
export const REQUIRED_QUERY = ['loc', 'uuid', 'version', 'lang', 'platform', 'model', 'loctype', 'os', 'net_type'] as const;

export type EyeFieldValue = string | number | boolean;
export type EyeFields = Record<string, unknown>;

export interface EyePostResult {
  httpStatus: number;
  headers: Record<string, string>;
  body: unknown;
}

export function prepareFields(snapshot: unknown, overrides: unknown): EyeFields {
  if (!isPlainObject(snapshot)) throw new Error('snapshot must be an object');
  if (!isPlainObject(overrides)) throw new Error('overrides must be an object');
  const fields: EyeFields = Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== '_meta'));
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(fields, key)) throw new Error(`unknown Eye field: ${key}`);
    if (value === null || typeof value !== typeof fields[key] || !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error(`invalid type for Eye field: ${key}`);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`invalid number for Eye field: ${key}`);
    fields[key] = value;
  }
  return fields;
}

export const encodeDetect = (fields: EyeFields): string => deflateEncrypt(JSON.stringify(fields), KEY, IV);
export const decodeDetect = (blob: string): unknown => JSON.parse(decryptInflate(blob, KEY, IV));

export function buildEyeUrl(query: Record<string, unknown>, cpuAbi: string): URL {
  const url = new URL(EYE_URL);
  for (const key of QUERY_KEYS) {
    const value = query[key];
    if (value !== undefined) {
      if (typeof value !== 'string') throw new Error(`invalid query field: ${key}`);
      url.searchParams.append(key, value);
    }
  }
  url.searchParams.append('cpu_abi', cpuAbi);
  return url;
}

export async function postDetect(fields: EyeFields, query: Record<string, unknown>): Promise<EyePostResult> {
  if (typeof fields.cpu_abi !== 'string' || !fields.cpu_abi) throw new Error('snapshot must contain cpu_abi');
  const response = await safeFetch(buildEyeUrl(query, fields.cpu_abi), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Accept-Encoding': 'identity' },
    body: encodeDetect(fields), timeoutMs: 20_000,
  });
  const text = (await readLimited(response, MAX_FRAME_BYTES, 'response exceeds 1 MiB')).toString('utf8');
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { httpStatus: response.status, headers: Object.fromEntries(response.headers), body };
}
