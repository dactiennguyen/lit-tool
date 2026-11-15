import { isPlainObject } from '../core/validate.ts';
import { randomizeAll } from '../cli/device-random.ts';
import { postDetect, prepareFields, REQUIRED_QUERY, type EyeFields, type EyePostResult } from './eye-device.ts';

export interface DfpInput {
  query: Record<string, string>;
  fields: EyeFields;
}

export interface DfpToken {
  dfpId: string;
  exp: number;
  ver: string;
  fetchedAt: number;
  deviceUuid: string;
}

export function parseDfpInput(value: unknown): DfpInput {
  if (!isPlainObject(value) || !isPlainObject(value.query)) throw Error('Expected { query, fields } in input JSON');
  const query: Record<string, string> = {};
  for (const [key, v] of Object.entries(value.query)) {
    if (typeof v !== 'string') throw Error(`query.${key} must be a string`);
    query[key] = v;
  }
  for (const key of REQUIRED_QUERY) if (!query[key]?.trim()) throw Error(`Missing query.${key}`);
  if (query.platform !== 'android') throw Error('query.platform must be android');
  const fields = prepareFields(value.fields, {});
  if (typeof fields.cpu_abi !== 'string' || !fields.cpu_abi.trim()) throw Error('Missing fields.cpu_abi');
  if (fields.android_id_secure !== query.uuid || fields.model !== query.model) {
    throw Error('Snapshot identity/model does not match query');
  }
  return { query, fields };
}

export function randomizeDfpInput(value: unknown): DfpInput {
  if (!isPlainObject(value) || !isPlainObject(value.query)) throw Error('Expected { query, fields } in input JSON');
  const fields = prepareFields(value.fields, {});
  const existingUuid = value.query.uuid;
  if (existingUuid !== undefined && (typeof existingUuid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(existingUuid))) {
    throw Error('Invalid query.uuid');
  }
  const device = randomizeAll(existingUuid as string | undefined);
  const drm = Buffer.from(device.media_drm, 'hex').toString('base64');
  const replacements: Record<string, string> = {
    brand: device.brand, manufacturer: device.manufacturer, model: device.model,
    android_id_secure: device.android_id, ad_aaid: device.advertising_id,
    serialno: device.serial, bluetooth_address: device.bt_mac, drmId: drm, drmId_native: drm,
  };
  const overrides = Object.fromEntries(Object.entries(replacements).filter(([key]) => Object.hasOwn(fields, key)));
  return parseDfpInput({
    query: { ...value.query, uuid: device.android_id, model: device.model },
    fields: prepareFields(fields, overrides),
  });
}

export function parseDfpResponse(response: EyePostResult, deviceUuid: string, now = Date.now()): DfpToken {
  const body = isPlainObject(response.body) ? response.body : null;
  const data = body && isPlainObject(body.data) ? body.data : null;
  if (response.httpStatus < 200 || response.httpStatus >= 300 || body?.code !== 0 || !data) {
    throw Error(`Eye did not issue a token (HTTP ${response.httpStatus})`);
  }
  const exp = typeof data.exp === 'string' && /^\d+$/.test(data.exp) ? Number(data.exp) : data.exp;
  if (typeof data.dfpId !== 'string' || !/^[A-Za-z0-9+/=_-]{1,512}$/.test(data.dfpId) ||
      typeof data.ver !== 'string' || !data.ver.trim() || typeof exp !== 'number' ||
      !Number.isSafeInteger(exp) || exp <= now) throw Error('Eye returned an invalid or expired token');
  return { dfpId: data.dfpId, exp, ver: data.ver, fetchedAt: now, deviceUuid };
}

export async function fetchDfpId(value: unknown): Promise<DfpToken> {
  const input = parseDfpInput(value);
  return parseDfpResponse(await postDetect(input.fields, input.query), input.query.uuid!);
}
