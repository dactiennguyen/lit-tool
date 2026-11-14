import { randomUUID } from 'node:crypto';
import { EYEBLOB_EYE_VER, EYEBLOB_FORMAT_VER, EYEBLOB_IV_HEX, EYEBLOB_KEY_HEX } from '../core/constants.ts';
import { decryptInflate, deflateEncrypt } from './aes.ts';

export const SIUA_KEY = Buffer.from(EYEBLOB_KEY_HEX, 'hex');
export const SIUA_IV = Buffer.from(EYEBLOB_IV_HEX, 'hex');
export const FORMAT_VER = EYEBLOB_FORMAT_VER;
export const EYE_VER = EYEBLOB_EYE_VER;

export const SCAN_CLEAN = '||||||none|0|none||quantity:4|RWX:0|';

export interface SiuaParts {
  ts?: number | string;
  uuid?: string;
  scan?: string;
}

export function buildPlaintext({ ts = Date.now(), uuid = randomUUID(), scan = SCAN_CLEAN }: SiuaParts = {}): string {
  return `${FORMAT_VER}}}${EYE_VER}|${ts}|${uuid}}}${scan}}}`;
}

export const encodeSiua = (plaintext: string): string => deflateEncrypt(plaintext, SIUA_KEY, SIUA_IV);
export const decodeSiua = (token: string): string => decryptInflate(token, SIUA_KEY, SIUA_IV);

export const siua = (parts: SiuaParts = {}): string => encodeSiua(buildPlaintext(parts));
