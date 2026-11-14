import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { LIT_ENV, runNode, type CliResult } from './helpers.ts';
import { decodeShadow } from '../src/crypto/shadow.ts';

interface RequestCapture {
  path: string;
  query: string;
  caller: string | undefined;
  siuaPresent: boolean;
  shadowMatches: boolean;
}

async function serve(body: string, status: number,
  run: (base: string, calls: RequestCapture[]) => Promise<void>): Promise<void> {
  const calls: RequestCapture[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    calls.push({ path: url.pathname, query: url.search,
      caller: req.headers['lit-user-id'] as string | undefined,
      siuaPresent: req.headers['x-siua'] !== undefined,
      shadowMatches: decodeShadow(String(req.headers['x-application-info'])) === url.search.slice(1) });
    res.writeHead(status, { 'content-type': 'text/plain' });
    res.end(body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('No server address');
    await run(`http://127.0.0.1:${address.port}`, calls);
  } finally { server.close(); }
}

const pairs = [
  ['account-info', 'account-info'], ['home-online', 'home_online'], ['user-info', 'user_info'],
] as const;

for (const [name, legacyName] of pairs) {
  for (const [label, status, body] of [
    ['html error', 503, '<html>Unavailable</html>'],
    ['missing data', 200, '{"success":true,"result":0}'],
    ['null data', 200, '{"success":true,"result":0,"data":null}'],
    ['inconsistent status', 200, '{"success":true,"result":-15,"data":{}}'],
    ['nullable message', 200, '{"success":false,"result":-15,"message":null}'],
  ] as const) {
    test(`${name}: legacy output parity for ${label}`, () => serve(body, status, async (base, calls) => {
      const env = { ...LIT_ENV, LIT_BASE_URL: base };
      const before = await runNode([`legacy/${legacyName}.js`], env);
      const after = await runNode([`src/cli/${name}.ts`], env);
      assert.deepEqual(after, before);
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[1], calls[0]);
    }));
  }
}

for (const target of ['me', 'self_1', 'a'.repeat(129)]) {
  test(`user-info: legacy request parity for ${target.slice(0, 12)}`, () =>
    serve('{"success":true,"result":0,"data":{}}', 200, async (base, calls) => {
      const env = { ...LIT_ENV, LIT_BASE_URL: base, LIT_USER_ID: 'self_1' };
      const before = await runNode(['legacy/user_info.js', target], env);
      const after = await runNode(['src/cli/user-info.ts', target], env);
      assert.deepEqual(after, before);
      assert.deepEqual(calls[1], calls[0]);
      assert.equal(calls[1]!.shadowMatches, true);
      if (target === 'self_1') assert.equal(calls[1]!.caller, undefined);
      if (target === 'me') {
        assert.equal(new URLSearchParams(calls[1]!.query).has('from'), false);
        assert.equal(calls[1]!.siuaPresent, true);
      }
    }));
}

test('user-me: preserves HTTP error summary and suppresses non-JSON body', () =>
  serve('<html>Unavailable</html>', 503, async (base, calls) => {
    const result: CliResult = await runNode(['src/cli/user-me.ts'], { ...LIT_ENV, LIT_BASE_URL: base });
    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).http_status, 503);
    assert.doesNotMatch(result.stdout, /Unavailable/);
    assert.equal(calls.length, 1);
  }));
