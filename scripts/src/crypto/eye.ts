import { EYEBLOB_IV_HEX, EYEBLOB_KEY_HEX } from '../core/constants.ts';
import { decryptInflate, deflateEncrypt } from './aes.ts';

export const EYE_KEY = Buffer.from(EYEBLOB_KEY_HEX, 'hex');
export const EYE_IV = Buffer.from(EYEBLOB_IV_HEX, 'hex');

export const decodeEye = (base64: string): string => decryptInflate(base64, EYE_KEY, EYE_IV);
export const encodeEye = (text: string): string => deflateEncrypt(text, EYE_KEY, EYE_IV);

const SCAN_NAMES = ['fridaMaps', 'fridaThread', 'lsposed', 'pmsHook', 'root', 'accessibility',
  'proxy', 'count', 'vpn', 'spare', 'rwx'] as const;
export type EyeScan = Record<typeof SCAN_NAMES[number], string>;

export interface ParsedEye {
  fmt: string | undefined;
  eyeVer: string | undefined;
  ts: string | undefined;
  uuid: string | undefined;
  scan: EyeScan;
}

export function parseEye(text: string): ParsedEye {
  const parts = text.split('}}');
  const head = (parts[1] || '').split('|');
  const flags = (parts[2] || '').split('|');
  const scan = {} as EyeScan;
  SCAN_NAMES.forEach((name, i) => {
    scan[name] = (i === SCAN_NAMES.length - 1 ? flags.slice(i).join('|') : flags[i]) ?? '';
  });
  return { fmt: parts[0], eyeVer: head[0], ts: head[1], uuid: head[2], scan };
}
