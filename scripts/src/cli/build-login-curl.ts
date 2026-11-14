import { randomUUID } from 'node:crypto';
import { litSign, md5hex, stsSign } from '../crypto/litsign.ts';
import { encodeShadow } from '../crypto/shadow.ts';

const KINDS = ['google', 'facebook', 'tiktok', 'sms', 'phone', 'email'] as const;
type Kind = typeof KINDS[number];

const ENDPOINTS: Record<Kind, string> = {
  google: 'api/sns/v1/lit/user/google_login',
  facebook: 'api/sns/v1/lit/user/facebook_login',
  tiktok: 'api/sns/v1/lit/user/tiktok_login',
  phone: 'api/sns/v1/lit/user/phone_login',
  email: 'api/sns/v1/lit/user/email_login',
  sms: 'api/sns/v1/lit/get_sms_code',
};

const argv = process.argv.slice(2);
const kind = argv[0];
const opt: Record<string, string | undefined> = {};
for (let i = 1; i < argv.length; i++) {
  if (argv[i]!.startsWith('--')) opt[argv[i]!.slice(2)] = argv[i + 1], i++;
}
if (!(KINDS as readonly (string | undefined)[]).includes(kind)) {
  console.error('kind phải là: google | facebook | tiktok | sms | phone | email');
  process.exit(1);
}
const loginKind = kind as Kind;

const UA = opt.ua || 'okhttp/4.12.0';
const uuid = opt.uuid || '966bbd0563ea67e3';
const model = opt.model || 'M2101K7BG';
const ver = opt.ver || '7.77.0';
const os = opt.os || '33';
const loc = opt.loc || 'VN';
const lang = opt.lang || 'vi';
const nettype = opt.nettype || 'wifi';
const host = opt.host || 'www.litatom.com';
const DFPID = opt.dfpid || process.env.X_DFPID || '$X_DFPID';
const sid = opt.sid || '';

const bodies: Record<Kind, () => Record<string, string | undefined>> = {
  google: () => ({ token: opt.token || '<PASTE_TOKEN_JWT>' }),
  facebook: () => ({ token: opt.token || '<PASTE_TOKEN_JWT>' }),
  tiktok: () => ({ token: opt.token || '<PASTE_AUTHCODE>' }),
  phone: () => ({ phone: opt.phone, zone: opt.zone, code: opt.code }),
  email: () => ({ email: opt.email, code: opt.code }),
  sms: () => ({ phone: opt.phone, zone: opt.zone, source: opt.source || 'login' }),
};
const body = bodies[loginKind]();
const bodyStr = JSON.stringify(body);

const litTime = Date.now();
const ts = Math.floor(litTime / 1000);

const q: [string, string][] = [];
if (sid) q.push(['sid', sid]);
q.push(['loc', loc], ['uuid', uuid], ['version', ver], ['lang', lang],
  ['platform', 'android'], ['model', model], ['loctype', '0'],
  ['os', os], ['net_type', nettype]);

q.push(['litTS', String(litTime)], ['litUA', md5hex(UA)], ['litNO', randomUUID()], ['litVS', '1.0.5'], ['litCK', '']);
const queryStr = q.map(([k, v]) => `${k}=${v}`).join('&');

const sigLitSign = litSign(litTime, '1');
const sigSts = stsSign(ts, uuid);
const xAppInfo = encodeShadow(queryStr, 3);
const fingerprint = encodeShadow(JSON.stringify({ uuid }), 1);
const xReqId = randomUUID();

const url = `https://${host}/${ENDPOINTS[loginKind]}?${queryStr}`;
const H = (k: string, v: string) => `  -H '${k}: ${v}' \\`;
const lines = [
  `curl -sS -X POST '${url}' \\`,
  H('User-Agent', UA),
  H('Content-Type', 'application/json; charset=UTF-8'),
  H('ts', String(ts)),
  H('litTime', String(litTime)),
  H('litSign', sigLitSign),
  H('sts-sign', sigSts),
  H('X-request-Id', xReqId),
  H('X-Application-Info', xAppInfo),
  H('X-DFPID', DFPID),
  H('fingerprint', fingerprint),
  H('v-mode', '0'),
  `  --data '${bodyStr}'`,
];

console.log('# ===== Litmatch ' + loginKind + '_login curl (ký lúc ' + new Date(litTime).toISOString() + ') =====');
console.log('# litTime=' + litTime + '  ts=' + ts + '  uuid=' + uuid);
if (DFPID === '$X_DFPID') console.log('# !! THIEU X-DFPID: export X_DFPID=... (server cap, con han) hoac --dfpid ...');
if (loginKind === 'google' && body.token?.startsWith('<')) console.log('# !! THIEU Google ID token (JWT): --token ...');
console.log(lines.join('\n'));
