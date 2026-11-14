import { EASEMOB_REST_BASE, LIT_HOSTNAME } from './constants.ts';

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const APP_KEY_PATTERN = /^[A-Za-z0-9_-]+#[A-Za-z0-9_-]+$/;

export const CURSOR_PATTERN = /^(?:-1|[0-9]{1,30})$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export const isId = (value: unknown): value is string => typeof value === 'string' && ID_PATTERN.test(value);
export const isAppKey = (value: unknown): value is string => typeof value === 'string' && APP_KEY_PATTERN.test(value);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseIntInRange(value: unknown, min: number, max: number, name: string): number {
  const n = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(n) || n < min || n > max) {
    throw Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return n;
}

export function easemobOrigin(value: string = EASEMOB_REST_BASE,
  message = 'HX_REST_BASE must be an HTTPS Easemob host on port 443', invalidMessage = 'Invalid HX_REST_BASE'): string {
  let url: URL;
  try { url = new URL(value); } catch { throw Error(invalidMessage); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      !(url.hostname === 'easemob.com' || url.hostname.endsWith('.easemob.com'))) {
    throw Error(message);
  }
  return url.origin;
}

export function isLitatomHttps(url: URL): boolean {
  return url.protocol === 'https:' && url.hostname === LIT_HOSTNAME &&
    !url.username && !url.password && (!url.port || url.port === '443');
}

export function decodeCanonicalBase64(encoded: unknown, maxLength: number,
  messages: { invalid: string; nonCanonical: string }): Buffer {
  if (typeof encoded !== 'string' || !encoded || encoded.length > maxLength || !BASE64_PATTERN.test(encoded)) {
    throw Error(messages.invalid);
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw Error(messages.nonCanonical);
  return bytes;
}

export function requireValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || /<[^>]+>/.test(value) || /[\r\n]/.test(value)) {
    throw new Error(`${name} must be a nonempty value without placeholders or newlines`);
  }
  return value;
}
