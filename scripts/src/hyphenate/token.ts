import { EASEMOB_REST_BASE, MAX_FRAME_BYTES } from '../core/constants.ts';
import { readLimited, safeFetch } from '../core/http.ts';
import { easemobOrigin } from '../core/validate.ts';

export interface HxCredentials {
  appKey: string;
  username: string;
  password?: string | undefined;
  restBase?: string | undefined;
}

export interface HxAuth extends HxCredentials {
  accessToken?: string | undefined;
}

export async function requestUserToken({ appKey, username, password, restBase = EASEMOB_REST_BASE }: HxCredentials):
  Promise<{ accessToken: string; expiresIn: number | null }> {
  const parts = appKey.split('#');
  if (parts.length !== 2 || parts.some(part => !/^[a-zA-Z0-9_-]+$/.test(part))) throw Error('Invalid app key');
  if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
    throw Error('A Hyphenate username and hxPwd are required to obtain a token');
  }
  const origin = easemobOrigin(restBase, 'REST base must be an HTTPS Easemob host', 'REST base must be an HTTPS Easemob host');
  const response = await safeFetch(new URL(`/${parts.join('/')}/token`, origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ grant_type: 'password', username, password }),
  });
  const raw = await readLimited(response, MAX_FRAME_BYTES, 'Token response exceeds 1 MiB');
  let data: { access_token?: unknown; expires_in?: unknown };
  try { data = JSON.parse(raw.toString('utf8')); }
  catch { throw Error(`Token endpoint returned invalid JSON (HTTP ${response.status})`); }
  if (!response.ok || typeof data.access_token !== 'string' || !data.access_token) {
    throw Error(`Token request failed (HTTP ${response.status})`);
  }
  return { accessToken: data.access_token, expiresIn: (data.expires_in as number | undefined) ?? null };
}

export async function ensureAccessToken(auth: HxAuth): Promise<string> {
  if (auth.accessToken) return auth.accessToken;
  try { return (await requestUserToken(auth)).accessToken; }
  catch { throw Error('Could not obtain Hyphenate user token'); }
}
