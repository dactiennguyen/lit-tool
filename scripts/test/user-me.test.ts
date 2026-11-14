import assert from 'node:assert/strict';
import http from 'node:http';
import type net from 'node:net';
import { test } from 'node:test';
import { decodeShadow } from '../src/crypto/shadow.ts';
import { LIT_ENV, runNode } from './helpers.ts';

interface Seen { url: string; headers: http.IncomingHttpHeaders }

async function withServer(json: unknown, run: (base: string, seen: Seen[]) => Promise<void>): Promise<void> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(json));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`, seen); }
  finally { server.close(); }
}

test('user-me: GET user/get_info/me with from=me&source=me, no generated X-SIUA', () =>
  withServer({ success: true, result: 0, data: { nickname: 'Me' } }, async (base, seen) => {
    const out = await runNode(['src/cli/user-me.ts'], { ...LIT_ENV, LIT_BASE_URL: base, LIT_USER_ID: 'u10' });
    assert.equal(out.code, 0, out.stderr);
    assert.equal(seen.length, 1);
    const url = new URL(seen[0]!.url, base);
    assert.equal(url.pathname, '/api/sns/v1/lit/user/get_info/me');
    // Endpoint query comes first, before the common params.
    assert.deepStrictEqual([...url.searchParams.keys()].slice(0, 2), ['from', 'source']);
    assert.equal(url.searchParams.get('from'), 'me');
    assert.equal(url.searchParams.get('source'), 'me');
    const headers = seen[0]!.headers;
    assert.equal(headers['lit-user-id'], 'u10');
    assert.equal(headers['x-siua'], undefined);
    assert.equal(decodeShadow(String(headers['x-application-info'])), url.search.slice(1));
    assert.match(out.stdout, /"success": true/);
    assert.match(out.stdout, /"nickname": "Me"/);
  }));

test('user-me: sends X-SIUA only when LIT_SIUA is set', () =>
  withServer({ success: true, result: 0 }, async (base, seen) => {
    const out = await runNode(['src/cli/user-me.ts'], { ...LIT_ENV, LIT_BASE_URL: base, LIT_SIUA: 'REAL-SIUA' });
    assert.equal(out.code, 0, out.stderr);
    assert.equal(seen[0]!.headers['x-siua'], 'REAL-SIUA');
  }));

test('user-me: unsuccessful body is not printed', () =>
  withServer({ success: false, result: 9, secret_field: 'x' }, async base => {
    const out = await runNode(['src/cli/user-me.ts'], { ...LIT_ENV, LIT_BASE_URL: base });
    assert.match(out.stdout, /"success": false/);
    assert.doesNotMatch(out.stdout, /secret_field/);
  }));
