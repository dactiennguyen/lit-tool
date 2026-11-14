import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { HX_ENV, HX_APP_KEY, HX_USERNAME, LIT_ENV, runNode, withLitServer, type CliResult } from './helpers.ts';
import { encodeShadow } from '../src/crypto/shadow.ts';
import { encodeSiua, buildPlaintext } from '../src/crypto/siua.ts';
import { encodeEye } from '../src/crypto/eye.ts';
import { litSign } from '../src/crypto/litsign.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scripts-cli-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const CLI: Record<string, string> = {
  'conversations': 'conversations', 'hyphenate-connect': 'hyphenate-connect', 'startup-api': 'startup-api',
  'account-info': 'account-info', 'home_online': 'home-online', 'user_info': 'user-info',
  'litsign': 'litsign', 'shadow': 'shadow', 'siua': 'siua', 'eye': 'eye', 'eye-device': 'eye-device',
  'login-google': 'login-google', 'build_login_curl': 'build-login-curl',
};

const normalize = (r: CliResult, name: string): CliResult => {
  const fix = (s: string) => s
    .replaceAll(`node --env-file=scripts/.env scripts/${name}.js`, 'CMD')
    .replaceAll(`node scripts/${name}.js`, 'CMD')
    .replaceAll(`node src/cli/${CLI[name]}.ts`, 'CMD');
  return { code: r.code, stdout: fix(r.stdout), stderr: fix(r.stderr) };
};

async function both(name: string, args: string[], env: Record<string, string> = {}) {
  const [theirs, mine] = await Promise.all([
    runNode([`legacy/${name}.js`, ...args], env),
    runNode([`src/cli/${CLI[name]}.ts`, ...args], env),
  ]);
  return { mine: normalize(mine, name), theirs: normalize(theirs, name) };
}

async function expectSame(name: string, args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  const { mine, theirs } = await both(name, args, env);
  assert.deepStrictEqual(mine, theirs, `${name} ${args.join(' ')}`);
  return mine;
}

const same = async (name: string, args: string[], env: Record<string, string> = {}): Promise<void> => { await expectSame(name, args, env); };

describe('conversations CLI', () => {
  const hx = { HX_APP_KEY, HX_USERNAME, HX_PASSWORD: 'pw' };
  const cases: [string[], Record<string, string>][] = [
    [['--help'], {}],
    [['--dry-run'], LIT_ENV],
    [['--dry-run', '--to', 'abc', '--limit', '50', '--pages', '3', '--cursor', '77'], { ...LIT_ENV, ...hx }],
    [['--dry-run', '--with-messages', '--max-conversations', '100'], { ...LIT_ENV, ...hx }],
    [['--dry-run', '--to', 'abc'], { ...LIT_ENV, ...HX_ENV }],
    [['--dry-run', '--to', 'abc'], LIT_ENV],
    [['--dry-run'], {}],
    [['--to', 'bad id'], LIT_ENV],
    [['--to', 'abc', '--with-messages'], LIT_ENV],
    [['--cursor', '5'], LIT_ENV],
    [['--limit', '0'], LIT_ENV],
    [['--pages', '21'], LIT_ENV],
    [['--to', 'abc', '--cursor', 'x'], LIT_ENV],
    [['--bogus'], LIT_ENV],
  ];
  for (const [args, env] of cases) test(args.join(' ') || '(none)', () => same('conversations', args, env));
});

describe('hyphenate-connect CLI', () => {
  const cases: [string[], Record<string, string>][] = [
    [['--help'], {}],
    [['--dry-run'], HX_ENV],
    [['--dry-run'], { ...HX_ENV, HX_ACCESS_TOKEN: '', HX_PASSWORD: 'pw' }],
    [['--dry-run'], { ...HX_ENV, HX_ACCESS_TOKEN: '' }],
    [['--dry-run', '--litmatch', '--first-contact', '--to', 'love_200', '--text', 'hi'], { ...HX_ENV, ...LIT_ENV }],
    [['--dry-run', '--sync-only', '--to', 'love_200'], LIT_ENV],
    [['--dry-run', '--sync-only', '--first-contact', '--to', 'love_200'], LIT_ENV],
    [['--sync-only', '--to', 'love_200', '--text', 'x'], LIT_ENV],
    [['--to', 'love_200'], HX_ENV],
    [['--first-contact'], HX_ENV],
    [['--litmatch'], HX_ENV],
    [['--dry-run', '--to', 'bad id', '--text', 'x'], HX_ENV],
    [['--dry-run', '--sync-only', '--to', 'love_200'], {}],
    [['--dry-run'], {}],
    [[], { ...HX_ENV, HX_ACCESS_TOKEN: '' }],
  ];
  for (const [args, env] of cases) test(args.join(' ') || '(none)', () => same('hyphenate-connect', args, env));

  test('--dry-run --to --text: same preview (frame size)', async () => {
    const out = await expectSame('hyphenate-connect', ['--dry-run', '--to', 'love_200', '--text', 'Xin chào'], HX_ENV);
    assert.equal(JSON.parse(out.stdout).sendPreview.to, 'love_200');
  });
});

describe('startup-api CLI', () => {
  const queryFile = path.join(tmp, 'query.json');
  fs.writeFileSync(queryFile, JSON.stringify({ num: 5, from: 'home' }));
  const profileFile = path.join(tmp, 'profile.json');
  fs.writeFileSync(profileFile, JSON.stringify({ sid: 's', uuid: 'u', version: '1', platform: 'android', userId: 'me' }));
  const cases: [string[], Record<string, string>][] = [
    [['--help'], {}],
    [['--list'], {}],
    [['account/account_info'], LIT_ENV],
    [['gift/gifts_v2', '--query-file', queryFile], { ...LIT_ENV, LIT_DFPID: 'dfp', LIT_USER_ID: 'me' }],
    [['user/get_info/:id', '--profile', profileFile], {}],
    [['user/get_info/:id'], LIT_ENV],
    [['nope/endpoint'], LIT_ENV],
    [['account/account_info', '--save'], LIT_ENV],
    [['account/account_info', '--profile', profileFile, '--env-file', 'x'], {}],
    [['account/account_info', '--query-file'], LIT_ENV],
    [['account/account_info', 'extra'], LIT_ENV],
    [['account/account_info'], {}],
  ];
  for (const [args, env] of cases) test(args.join(' '), () => same('startup-api', args, env));

  test('--send against a local fake server', () => withLitServer({ success: true, result: 0, data: { x: 1 } },
    base => same('startup-api', ['home/settings_v2', '--send'], { ...LIT_ENV, LIT_BASE_URL: base })));
});

describe('GET helper CLIs against a local fake server', () => {
  const json = { success: true, result: 0, data: { name: 'x', list: [1, 2] } };
  for (const name of ['account-info', 'home_online', 'user_info']) {
    test(name, () => withLitServer(json, base => same(name, [], { ...LIT_ENV, LIT_BASE_URL: base })));
  }
  test('user_info with id and caller', () => withLitServer(json,
    base => same('user_info', ['someone_1'], { ...LIT_ENV, LIT_BASE_URL: base, LIT_USER_ID: 'me_1' })));
  test('user_info invalid id', () => same('user_info', ['bad id'], LIT_ENV));
  test('account-info unsuccessful body is not printed', () => withLitServer({ success: false, result: 9 },
    base => same('account-info', [], { ...LIT_ENV, LIT_BASE_URL: base })));
  test('missing credentials', () => same('account-info', [], {}));
});

describe('crypto tool CLIs', () => {
  test('litsign', async () => {
    await expectSame('litsign', ['1700000000000']);
    await expectSame('litsign', ['1700000000000', '0']);
    const out = await runNode(['src/cli/litsign.ts', '1731415000000']);
    assert.equal(out.stdout.trim(), litSign('1731415000000'));
  });

  test('shadow decode/encode (deterministic modes)', async () => {
    for (const mode of ['1', '2', '4', '5']) await expectSame('shadow', ['encode', 'loc=VN&uuid=x', mode]);
    await expectSame('shadow', ['decode', encodeShadow('hello world', 3)]);
    await expectSame('shadow', ['decode', encodeShadow('{"uuid":"x"}', 1), '1']);
  });

  test('siua decode', () => same('siua', ['decode', encodeSiua(buildPlaintext({ ts: 1700000000000, uuid: 'u' }))]));

  test('eye decode/parse/encode', async () => {
    const syn = '2.1}}1.9.9|1700000000000|00000000-0000-4000-8000-000000000000}}||||||none|0|none||quantity:0|RWX:0|}}';
    await expectSame('eye', ['decode', encodeEye(syn)]);
    await expectSame('eye', ['parse', encodeEye(syn)]);
    await expectSame('eye', ['encode', syn]);
  });

  test('eye-device usage and argument errors', async () => {
    await expectSame('eye-device', ['--help']);
    await expectSame('eye-device', ['--snapshot', 'a']);
    await expectSame('eye-device', ['--snapshot', 'a', '--snapshot', 'b', '--config', 'c', '--response-json', 'd']);
  });

  test('login-google usage and validation errors (no request sent)', async () => {
    const config = path.join(tmp, 'login.json');
    fs.writeFileSync(config, JSON.stringify({ query: { loc: 'VN', uuid: 'u', version: '7.77.0', lang: 'vi', platform: 'android',
      model: 'M', loctype: '0', os: '33', net_type: 'wifi', app_source: 'litmatch', appid: '<placeholder>' } }));
    await expectSame('login-google', ['--help']);
    await expectSame('login-google', ['--config']);
    await expectSame('login-google', ['--config', config]);
    await expectSame('login-google', ['--config', path.join(tmp, 'missing.json')].slice(0, 2));
  });

  test('build-login-curl: invalid kind', () => same('build_login_curl', ['nope']));

  test('build-login-curl: same structure; signatures valid for their own time', async () => {
    const args = ['phone', '--phone', '912345678', '--zone', '84', '--code', '123456', '--dfpid', 'DFP'];
    const { mine, theirs } = await both('build_login_curl', args);
    const mask = (s: string) => s
      .replace(/litTime=\d+|ts=\d+/g, m => m.replace(/\d+/, 'N'))
      .replace(/(litTS=|litNO=)[^&']+/g, '$1X')
      .replace(/(-H '(?:ts|litTime|litSign|sts-sign|X-request-Id|X-Application-Info): )[^']+/g, '$1X')
      .replace(/ký lúc [^ ]+/, 'ký lúc T');
    assert.equal(mine.code, 0);
    assert.equal(mask(mine.stdout), mask(theirs.stdout));
    const litTime = mine.stdout.match(/-H 'litTime: (\d+)'/)![1]!;
    assert.ok(mine.stdout.includes(`-H 'litSign: ${litSign(litTime)}'`));
  });
});
