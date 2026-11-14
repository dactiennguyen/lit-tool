import { randomBytes } from 'node:crypto';
import { SHADOW_IV_FIXED, SHADOW_KEYS } from '../core/constants.ts';
import { aesCbcDecrypt, aesCbcEncrypt } from './aes.ts';

export type ShadowMode = keyof typeof SHADOW_KEYS;
export const isShadowMode = (value: unknown): value is ShadowMode => Object.hasOwn(SHADOW_KEYS, String(value));

const key = (mode: ShadowMode): Buffer => Buffer.from(SHADOW_KEYS[mode], 'utf8');
const fixedIv = (): Buffer => Buffer.from(SHADOW_IV_FIXED, 'utf8');

export function encodeShadow(text: string, mode: ShadowMode = 3, iv: Buffer = mode === 3 ? randomBytes(16) : fixedIv()): string {
  const ct = aesCbcEncrypt('aes-256-cbc', key(mode), iv, text);
  return (mode === 3 ? Buffer.concat([ct, iv]) : ct).toString('base64url');
}

export function decodeShadow(value: string, mode: ShadowMode = 3): string {
  const data = Buffer.from(value, 'base64url');
  const [ct, iv] = mode === 3 ? [data.subarray(0, -16), data.subarray(-16)] : [data, fixedIv()];
  return aesCbcDecrypt('aes-256-cbc', key(mode), iv, ct).toString('utf8');
}

export const ivOf = (value: string): Buffer => Buffer.from(value, 'base64url').subarray(-16);

export const getToken = (value: string): string => decodeShadow(value, 2);
