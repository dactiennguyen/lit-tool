import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { assertSame, legacy, litResponse, outcome, outcomeAsync, PROFILE, withFetch } from './helpers.ts';
import { decodeShadow, ivOf } from '../src/crypto/shadow.ts';
import { fetchGet, fetchPost } from '../src/lit/client.ts';
import { loadEnvProfile, loadJsonProfile, loadQuery, validateProfile } from '../src/lit/profile.ts';
import { buildGetRequest, buildPostRequest, buildUserMeRequest } from '../src/lit/request.ts';
import { decodeSiua, SCAN_CLEAN } from '../src/crypto/siua.ts';
import { buildEyeUrl, decodeDetect, encodeDetect, prepareFields } from '../src/lit/eye-device.ts';

const old = { common: legacy('common'), eyeDevice: legacy('eye-device') };

test('GET, self-profile and POST attach fresh default SIUA to outgoing requests', async () => {
  const profile = { ...PROFILE, siua: undefined };
  const before = Date.now();
  const { result, calls } = await withFetch(req => litResponse(req, { success: true, result: 0 }), async () => {
    for (let i = 0; i < 2; i++) {
      await fetchGet(buildGetRequest('home/online_users', profile));
      await fetchGet(buildUserMeRequest(profile));
      await fetchPost(buildPostRequest('user/accost_count', profile, { targetId: 'test-user' }));
    }
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 6);
  const tokens = calls.map(req => req.headers['x-siua']!);
  assert.equal(new Set(tokens).size, tokens.length);
  for (const token of tokens) {
    const parts = decodeSiua(token).split('}}');
    const [version, timestamp, uuid] = parts[1]!.split('|');
    assert.equal(parts[0], '2.1');
    assert.equal(version, '1.9.9');
    assert.ok(Number(timestamp) >= before && Number(timestamp) <= Date.now());
    assert.match(uuid!, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(parts[2], SCAN_CLEAN);
  }
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scripts-test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const writeTmp = (name: string, content: string): string => {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, content);
  return file;
};

function withEnv<T>(vars: Record<string, string>, fn: () => T): T {
  const saved = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return fn(); }
  finally { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}

const signingOf = (request: { headers: Record<string, string>; requestId: string }) => ({
  now: Number(request.headers.litTime), requestId: request.requestId, shadowIv: ivOf(request.headers['X-Application-Info']!),
});

describe('profile loading', () => {
  const envFiles = {
    basic: 'LIT_SID="s1"\nLIT_UUID="u1"\nLIT_VERSION="7.77.0"\nLIT_PLATFORM="android"\n',
    unquoted: 'LIT_SID=s1\n  LIT_UUID = u1  \nLIT_VERSION=7.77.0\nLIT_PLATFORM=android\n# LIT_USER_ID="x"\n',
    overrides: 'LIT_SID="s1"\nLIT_UUID="u1"\nLIT_VERSION="7.77.0"\nLIT_PLATFORM="android"\nLIT_USER_ID="me_1"\n' +
      'LIT_DFPID="ab+/="\nLIT_BASE_URL="https://example.com/x?y"\nLIT_LANG="en"\nLIT_MODEL="M2101K7BG"\nLIT_OS=""\n',
    escapes: 'LIT_SID="a\\u0062c"\nLIT_UUID="u1"\nLIT_VERSION="7.77.0"\nLIT_PLATFORM="android"\n',
    badJson: 'LIT_SID="unterminated\n',
    notString: 'LIT_SID="s"\nLIT_UUID="u1"\nLIT_VERSION="7"\nLIT_PLATFORM="android"\n',
    wrongPlatform: 'LIT_SID="s1"\nLIT_UUID="u1"\nLIT_VERSION="7.77.0"\nLIT_PLATFORM="ios"\n',
    badUser: 'LIT_SID="s1"\nLIT_UUID="u1"\nLIT_VERSION="7.77.0"\nLIT_PLATFORM="android"\nLIT_USER_ID="a b"\n',
    badBase: 'LIT_SID="s1"\nLIT_UUID="u1"\nLIT_VERSION="7.77.0"\nLIT_PLATFORM="android"\nLIT_BASE_URL="ftp://x"\n',
    badUrl: 'LIT_SID="s1"\nLIT_UUID="u1"\nLIT_VERSION="7.77.0"\nLIT_PLATFORM="android"\nLIT_BASE_URL="::"\n',
    badSiua: 'LIT_SID="s1"\nLIT_UUID="u1"\nLIT_VERSION="7.77.0"\nLIT_PLATFORM="android"\nLIT_SIUA="has space"\n',
    empty: '',
  };
  for (const [name, content] of Object.entries(envFiles)) {
    test(`loadEnvProfile parity: ${name}`, () => {
      const file = writeTmp(`${name}.env`, content);
      assertSame(outcome(() => loadEnvProfile(file)), outcome(() => old.common.loadEnvProfile(file)));
    });
  }

  test('loadEnvProfile parity: real environment wins over the file', () => {
    const file = writeTmp('precedence.env', envFiles.basic);
    withEnv({ LIT_SID: 'from_env', LIT_LOC: 'VN' }, () => {
      assertSame(outcome(() => loadEnvProfile(file)), outcome(() => old.common.loadEnvProfile(file)));
      assert.equal(loadEnvProfile(file).sid, 'from_env');
    });
  });

  test('loadEnvProfile parity: missing file', () => {
    assertSame(outcome(() => loadEnvProfile(path.join(tmp, 'nope.env'))), outcome(() => old.common.loadEnvProfile(path.join(tmp, 'nope.env'))));
  });

  test('validateProfile / loadJsonProfile parity', () => {
    const cases: unknown[] = [PROFILE, null, [], {}, { ...PROFILE, userId: null }, { ...PROFILE, dfpid: null },
      { ...PROFILE, uuid: 'x'.repeat(129) }, { ...PROFILE, version: 'a b' }, { ...PROFILE, siua: 5 }];
    for (const [i, c] of cases.entries()) {
      assertSame(outcome(() => validateProfile(structuredClone(c))), outcome(() => old.common.loadJsonProfile(writeTmp(`p${i}.json`, JSON.stringify(c)))));
      assertSame(outcome(() => loadJsonProfile(path.join(tmp, `p${i}.json`))), outcome(() => old.common.loadJsonProfile(path.join(tmp, `p${i}.json`))));
    }
    assertSame(outcome(() => loadJsonProfile(writeTmp('broken.json', '{'))), outcome(() => old.common.loadJsonProfile(path.join(tmp, 'broken.json'))));
  });

  test('loadQuery parity', () => {
    const cases = ['{"num":15,"from":"home","is_zone":true}', '[]', '1', '{"bogus":1}', '{"num":{}}', '{', 'null'];
    for (const [i, c] of cases.entries()) {
      const file = writeTmp(`q${i}.json`, c);
      assertSame(outcome(() => loadQuery(file)), outcome(() => old.common.loadQuery(file)), c);
    }
    assertSame(outcome(() => loadQuery()), outcome(() => old.common.loadQuery()));
  });
});

describe('request signing', () => {
  const profiles = {
    full: PROFILE,
    minimal: { sid: 's', uuid: 'u', version: '1', platform: 'android' },
    noSiua: { ...PROFILE, siua: undefined, dfpid: undefined, userId: undefined },
    otherBase: { ...PROFILE, baseUrl: 'http://127.0.0.1:8080' },
  };
  const endpoints: [string, Record<string, string | number | boolean>][] = [
    ['account/account_info', {}],
    ['home/online_users', { start_pos: '0', num: '15', from_page: 'home' }],
    ['gift/gifts_v2', {}],
    ['gift/gifts_v2', { hash_code: 'h', classify: 'x' }],
    ['user/get_info/:id', { lang: 'en', version: '9' }],
    ['user/conversations', { num: 3, is_zone: false }],
  ];

  for (const [pname, profile] of Object.entries(profiles)) for (const [endpoint, query] of endpoints) {
    test(`buildGetRequest parity: ${pname} ${endpoint} ${JSON.stringify(query)}`, () => {

      const expected = outcome(() => old.common.buildGetRequest(endpoint, profile, query));
      if (!expected.ok) {

        assertSame(outcome(() => buildGetRequest(endpoint, profile as never, query)), expected);
        return;
      }
      const theirs = expected.value as ReturnType<typeof buildGetRequest>;
      const mine = buildGetRequest(endpoint, profile as never, query, signingOf(theirs));
      if ('siua' in profile && profile.siua) {
        assert.deepStrictEqual(mine, theirs);
      } else {

        const { 'X-SIUA': a, ...restMine } = mine.headers;
        const { 'X-SIUA': b, ...restTheirs } = theirs.headers;
        assert.deepStrictEqual({ ...mine, headers: restMine }, { ...theirs, headers: restTheirs });
        assert.deepStrictEqual(Object.keys(mine.headers), Object.keys(theirs.headers));
        assert.ok(a && b);
      }
      assert.equal(decodeShadow(mine.headers['X-Application-Info']!), mine.url.search.slice(1));
    });
  }

  const posts: [string, unknown][] = [
    ['user/accost_count', { targetId: 'abc' }],
    ['user/conversation', { conversation_id: 'abc', conversation_type: 0 }],
    ['user/conversation/source', { source: 'other', target_user_id: 'abc' }],
    ['user/conversation', { conversation_id: 'abc', conversation_type: 1 }],
    ['user/conversation/source', { source: 'self', target_user_id: 'abc' }],
    ['user/accost_count', { targetId: 'a b' }],
    ['user/accost_count', { targetId: 'abc', extra: 1 }],
    ['user/accost_count', null],
    ['user/delete', { targetId: 'abc' }],
  ];
  for (const [endpoint, payload] of posts) {
    test(`buildPostRequest parity: ${endpoint} ${JSON.stringify(payload)}`, () => {
      const theirs = outcome(() => old.common.buildPostRequest(endpoint, PROFILE, payload));
      if (!theirs.ok) {
        assertSame(outcome(() => buildPostRequest(endpoint as never, PROFILE, payload as never)), theirs);
        return;
      }
      const t = theirs.value as ReturnType<typeof buildPostRequest>;
      const mine = buildPostRequest(endpoint as never, PROFILE, payload as never, {
        now: Number(t.headers.litTime), requestId: t.requestId, shadowIv: ivOf(t.headers['X-Application-Info']!),
      });
      assert.deepStrictEqual({ ...mine, body: decodeShadow(mine.body) }, { ...t, body: decodeShadow(t.body) });
    });
  }

  test('buildPostRequest parity: non-litatom base is refused', () => {
    const profile = { ...PROFILE, baseUrl: 'https://evil.example' };
    assertSame(outcome(() => buildPostRequest('user/accost_count', profile, { targetId: 'abc' })),
      outcome(() => old.common.buildPostRequest('user/accost_count', profile, { targetId: 'abc' })));
  });
});

describe('fetchGet / fetchPost against a fake server', () => {
  const scenarios: [string, Parameters<typeof litResponse>[2] & { json?: unknown; raw?: () => Response }][] = [
    ['encrypted success', { json: { success: true, result: 0, data: { a: 1 } } }],
    ['plaintext flagged', { json: { success: false, result: 7 }, encrypted: false }],
    ['http 500 not decrypted', { json: { success: false, result: 1 }, status: 500 }],
    ['non-JSON body', { raw: () => new Response('<html>', { status: 200 }) }],
    ['JSON array body', { raw: () => new Response('[1,2]', { status: 200 }) }],
    ['wrong request id', { raw: () => new Response('x', { status: 200, headers: { 'x-is-enc': 'AAAA' } }) }],
    ['too large', { raw: () => new Response(new Uint8Array(2 * 1024 * 1024 + 1)) }],
  ];
  for (const [name, s] of scenarios) {
    test(`fetchGet parity: ${name}`, async () => {
      const request = old.common.buildGetRequest('account/account_info', PROFILE, {});

      let cached: Response | undefined;
      const handler = (req: Parameters<typeof litResponse>[0]) => s.raw ? s.raw() : (cached ??= litResponse(req, s.json, s)).clone();
      const mine = await withFetch(handler, () => fetchGet(request));
      const theirs = await withFetch(handler, () => old.common.fetchGet(request));
      assert.deepStrictEqual(mine, theirs);
    });
  }

  test('fetchPost parity (same request object)', async () => {
    const request = old.common.buildPostRequest('user/conversation', PROFILE, { conversation_id: 'abc', conversation_type: 0 });
    let cached: Response | undefined;
    const handler = (req: Parameters<typeof litResponse>[0]) => (cached ??= litResponse(req, { success: true, result: 0 })).clone();
    assert.deepStrictEqual(await withFetch(handler, () => fetchPost(request)), await withFetch(handler, () => old.common.fetchPost(request)));
    assertSame(await outcomeAsync(() => fetchPost({ ...request, method: 'GET' } as never)),
      await outcomeAsync(() => old.common.fetchPost({ ...request, method: 'GET' })));
  });
});

describe('eye-device', () => {
  const snapshot = { _meta: { note: 'x' }, cpu_abi: 'arm64-v8a', model: 'Pixel', rooted: false, sdk: 33 };

  test('prepareFields parity', () => {
    const overrides: unknown[] = [{}, { model: 'X', sdk: 34, rooted: true }, { nope: 1 }, { model: 1 }, { sdk: Infinity },
      { model: null }, [], null];
    for (const o of overrides) {
      assertSame(outcome(() => prepareFields(structuredClone(snapshot), o)), outcome(() => old.eyeDevice.prepareFields(structuredClone(snapshot), o)));
    }
    assertSame(outcome(() => prepareFields(null, {})), outcome(() => old.eyeDevice.prepareFields(null, {})));
  });

  test('encode/decode/buildEyeUrl parity', () => {
    const fields = prepareFields(snapshot, {});
    assert.equal(encodeDetect(fields), old.eyeDevice.encodeDetect(fields));
    assert.deepStrictEqual(decodeDetect(encodeDetect(fields)), fields);
    for (const q of [{ loc: 'VN', uuid: 'u', sid: 's', extra: 'ignored' }, { loc: 5 }, {}]) {
      assertSame(outcome(() => buildEyeUrl(q, 'arm64-v8a')), outcome(() => old.eyeDevice.buildEyeUrl(q, 'arm64-v8a')));
    }
  });
});
