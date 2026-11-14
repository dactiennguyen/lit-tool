export const LITSIGN_SALT = 'R@s9!bu8';
export const STS_HMAC_KEY = 'I am your father';

export const EYEBLOB_KEY_HEX = '930f8b7614a9446be3b71f55713a8524';
export const EYEBLOB_IV_HEX = '28f1ebe03ccef9fca8c5c1c041e22278';
export const EYEBLOB_FORMAT_VER = '2.1';
export const EYEBLOB_EYE_VER = '1.9.9';

export const DETECT_KEY_HEX = '438e0cbac6835d0b4ec0862ea67d537b';
export const DETECT_IV_HEX = 'cc1c118edefcdbc646f63f58288c2be6';

export const SHADOW_KEYS = Object.freeze({
  1: 'CB7F786FC0E6E105E6DA03D1FFF05C0F', 2: 'EIOWUGWOERGJKNLDKGJFOI879KJNSDKJ',
  3: 'f1c9208ccd8ef6d85c44b451da593cd4', 4: 'AC0A60D491D9876D1012FB24DB61ADC6',
  5: 'LTMWUGWOBNLJKIOEKGJFOI256KIOWNKF',
} as const);
export const SHADOW_IV_FIXED = 'abcdef1234567890';

export const LIT_BASE_URL = 'https://www.litatom.com';
export const LIT_HOSTNAME = 'www.litatom.com';
export const EASEMOB_REST_BASE = 'https://a1-sgp-ga.easemob.com';
export const HTTP_TIMEOUT_MS = 12_000;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_FRAME_BYTES = 1024 * 1024;

// home/online_users paging limits; keep in sync with ONLINE_PAGE_MAX / ONLINE_START_MAX in apps/src-tauri/src/lit.rs.
export const ONLINE_PAGE_MAX = 50;
export const ONLINE_START_MAX = 10_000;
