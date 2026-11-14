import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { encodeShadow } from '../src/crypto/shadow.ts';
import { bytesValue, frame, uintField, writeFields } from '../src/hyphenate/fields.ts';

for (const key of Object.keys(process.env)) if (/^(LIT|HX)_/.test(key)) delete process.env[key];
export const MISSING_ENV_FILE = '/nonexistent/scripts-test/.env';
process.env.SCRIPTS_ENV_FILE = MISSING_ENV_FILE;

export const SCRIPTS_DIR = fileURLToPath(new URL('../', import.meta.url));
const requireCjs = createRequire(import.meta.url);

export const legacy = <T = any>(name: string): T => requireCjs(`../legacy/${name}.js`) as T;

export type Outcome = { ok: true; value: unknown } | { ok: false; error: string };

export function outcome(fn: () => unknown): Outcome {
  try { return { ok: true, value: fn() }; }
  catch (error) { return { ok: false, error: (error as Error).message }; }
}

export async function outcomeAsync(fn: () => Promise<unknown>): Promise<Outcome> {
  try { return { ok: true, value: await fn() }; }
  catch (error) { return { ok: false, error: (error as Error).message }; }
}

export function assertSame(actual: Outcome, expected: Outcome, label = ''): void {
  assert.deepStrictEqual(actual, expected, label);
}

export const PROFILE = Object.freeze({
  sid: 'SID_test_123', uuid: 'abc123def4567890', version: '7.77.0', platform: 'android' as const,
  userId: 'user_42', dfpid: 'DFPID_fixture', siua: 'SIUA_fixture_token',
  baseUrl: 'https://www.litatom.com',
  commonQuery: { app_source: 'litmatch', appid: 'NxUUhRSQH3qPJmY2Vn/edRz4vrc=', lang: 'vi', loc: 'US',
    loctype: '0', model: 'Pixel 8 Pro', net_type: 'wifi', os: '33' },
});

export const LIT_ENV = Object.freeze({
  LIT_SID: PROFILE.sid, LIT_UUID: PROFILE.uuid, LIT_VERSION: PROFILE.version, LIT_PLATFORM: 'android',
});

export const HX_APP_KEY = 'org1#app1';
export const HX_USERNAME = 'love_100';

export function templateB64(username = HX_USERNAME): string {
  const identity = writeFields([bytesValue(1, HX_APP_KEY), bytesValue(2, username), bytesValue(3, 'easemob.com')]);
  const body = writeFields([uintField(1, 5), bytesValue(18, JSON.stringify({ token: '', vid: 'v1', cid: 'c1' })),
    uintField(20, '18446744073709551615')]);
  return writeFields([bytesValue(2, identity), uintField(8, 3), bytesValue(9, body), uintField(12, 7)]).toString('base64');
}

export const HX_ENV = Object.freeze({
  HX_LOGIN_TEMPLATE_B64: templateB64(), HX_IM_HOST: '127.0.0.1', HX_IM_PORT: '6717', HX_ACCESS_TOKEN: 'hx_token_fixture',
});

export const loginResponse = (code = 0) => frame(writeFields([uintField(8, 3),
  bytesValue(9, writeFields([bytesValue(8, writeFields([uintField(1, code)]))]))]));
export const followupResponse = (code = 0) => frame(writeFields([uintField(8, 1),
  bytesValue(9, writeFields([bytesValue(1, writeFields([uintField(1, code)]))]))]));
export const sendAckPayload = (localId: string, code = 0, serverId = '1234567890123456789') => writeFields([uintField(8, 0),
  bytesValue(9, writeFields([bytesValue(1, writeFields([uintField(1, code)])), uintField(2, localId),
    ...(serverId ? [uintField(3, serverId)] : [])]))]);

export async function withImServer<T>(replies: (Buffer | null)[], run: (port: number) => Promise<T>): Promise<{ result: T; received: Buffer[] }> {
  const received: Buffer[] = [];
  const server = net.createServer(socket => {
    let pending = Buffer.alloc(0);
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4 && pending.length >= pending.readUInt32BE(0) + 4) {
        const length = pending.readUInt32BE(0);
        received.push(Buffer.from(pending.subarray(0, length + 4)));
        pending = pending.subarray(length + 4);
        const reply = replies[received.length - 1];
        if (reply) socket.write(reply);
      }
    });
    socket.on('error', () => {});
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await run((server.address() as net.AddressInfo).port);
    return { result, received };
  } finally {
    server.close();
  }
}

export interface RecordedRequest { url: string; method: string; headers: Record<string, string>; body: string | null }

export async function withFetch<T>(handler: (req: RecordedRequest) => Response | Promise<Response>,
  run: () => Promise<T>): Promise<{ result: Outcome; calls: RecordedRequest[] }> {
  const calls: RecordedRequest[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const req: RecordedRequest = {
      url: String(input), method: init.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init.headers as ConstructorParameters<typeof Headers>[0])),
      body: typeof init.body === 'string' ? init.body : null,
    };
    calls.push(req);
    return handler(req);
  }) as typeof fetch;
  try {
    return { result: await outcomeAsync(run), calls };
  } finally {
    globalThis.fetch = original;
  }
}

export function litResponse(req: RecordedRequest, json: unknown, { encrypted = true, status = 200 } = {}): Response {
  const id = req.headers['x-request-id'] ?? '';
  const text = JSON.stringify(json);
  return new Response(encrypted ? encodeShadow(text, 3) : text, {
    status, headers: { 'x-is-enc': encodeShadow((encrypted ? '1' : '0') + id, 3) },
  });
}

export async function withLitServer<T>(json: unknown, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = http.createServer((req, res) => {
    const id = String(req.headers['x-request-id'] ?? '');
    res.writeHead(200, { 'content-type': 'application/json', 'x-is-enc': encodeShadow('1' + id, 3) });
    res.end(encodeShadow(JSON.stringify({ ...(json as object), echo_path: req.url?.split('?')[0] }), 3));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await run(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`); }
  finally { server.close(); }
}

export interface CliResult { code: number | null; stdout: string; stderr: string }

export function runNode(args: string[], env: Record<string, string> = {}, cwd: string = SCRIPTS_DIR): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', SCRIPTS_ENV_FILE: MISSING_ENV_FILE, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
