import net from 'node:net';
import { loadEnv, type Env } from '../core/env.ts';
import { decodeCanonicalBase64 } from '../core/validate.ts';
import { bytesField, frame, getField, readFields, replaceBytes, writeFields } from './fields.ts';

export interface LoginTemplate {
  host: string;
  port: number;
  payload: Buffer;
  appKey: string;
  username: string;
}

export function loadTemplate(env: Env = loadEnv()): LoginTemplate {
  const payload = decodeCanonicalBase64(env.HX_LOGIN_TEMPLATE_B64, 65536, {
    invalid: 'Missing or invalid HX_LOGIN_TEMPLATE_B64 in .env',
    nonCanonical: 'Non-canonical template base64',
  });
  const outer = readFields(payload);
  if (String(getField(outer, 8)) !== '3') throw Error('Template is not a login frame');
  const identity = readFields(bytesField(outer, 2));
  const host = env.HX_IM_HOST;
  const port = Number(env.HX_IM_PORT || 6717);
  if (!host || (!net.isIP(host) && !/^[a-zA-Z0-9.-]+$/.test(host))) throw Error('Invalid HX_IM_HOST');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid HX_IM_PORT');
  const template: LoginTemplate = {
    host, port, payload,
    appKey: bytesField(identity, 1).toString('utf8'),
    username: bytesField(identity, 2).toString('utf8'),
  };
  if (env.HX_USERNAME && env.HX_USERNAME !== template.username) {
    throw Error('HX_USERNAME does not match the account-specific handshake template');
  }
  return template;
}

export function buildLoginFrame(template: LoginTemplate, accessToken: string): Buffer {
  if (typeof accessToken !== 'string' || !accessToken) throw Error('A Hyphenate access token is required');
  const outer = readFields(template.payload);
  const body = readFields(bytesField(outer, 9));
  const auth = JSON.parse(bytesField(body, 18).toString('utf8')) as Record<string, unknown>;
  const actionVersion = getField(body, 17);
  auth.token = Buffer.isBuffer(actionVersion) && actionVersion.toString('utf8') === 'v6.0'
    ? `$t$${accessToken}` : accessToken;
  replaceBytes(body, 18, Buffer.from(JSON.stringify(auth)));
  replaceBytes(outer, 9, writeFields(body));
  return frame(writeFields(outer));
}
