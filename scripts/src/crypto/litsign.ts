import { createHash, createHmac } from 'node:crypto';
import { LITSIGN_SALT, STS_HMAC_KEY } from '../core/constants.ts';

export const SIGN_FLAG = Object.freeze({ VALID: '1', REPACKED: '0', UNKNOWN: '2' } as const);
export type SignFlag = typeof SIGN_FLAG[keyof typeof SIGN_FLAG];
export const isSignFlag = (value: unknown): value is SignFlag => value === '0' || value === '1' || value === '2';

export const md5hex = (text: string): string => createHash('md5').update(text, 'utf8').digest('hex');
export const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');
export const unb64 = (text: string): string => Buffer.from(text, 'base64').toString('utf8');

export function litSign(litTime: number | string | bigint, s: SignFlag = SIGN_FLAG.VALID): string {
  return b64(`${s}|${md5hex(String(litTime) + s + LITSIGN_SALT)}`);
}

export function decodeLitSign(sign: string): { s: string; md5: string; raw: string } {
  const raw = unb64(sign);
  const i = raw.indexOf('|');
  return { s: raw.slice(0, i), md5: raw.slice(i + 1), raw };
}

export const signHmacHex = (message: string): string => createHmac('sha256', STS_HMAC_KEY).update(message, 'utf8').digest('hex');

export const getHMac256SignCode = (input: string): string => b64(signHmacHex(input));

export const stsSign = (ts: string | number, uuid: string): string => getHMac256SignCode(`${ts}_${uuid}`);
