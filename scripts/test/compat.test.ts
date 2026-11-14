import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { legacy, runNode, SCRIPTS_DIR } from './helpers.ts';
import { REPO_ROOT } from '../src/core/env.ts';
import { savePrivateResponse } from '../src/lit/client.ts';

function capturePrivatePath(save: (body: Buffer) => string): string {
  const { mkdirSync, writeFileSync } = fs;
  let written = '';
  fs.mkdirSync = (() => undefined) as typeof fs.mkdirSync;
  fs.writeFileSync = ((file: fs.PathOrFileDescriptor) => { written = String(file); }) as typeof fs.writeFileSync;
  try { save(Buffer.from('x')); } finally { fs.mkdirSync = mkdirSync; fs.writeFileSync = writeFileSync; }
  return written;
}

test('legacy and new code both save private responses under <repo>/.private/', () => {
  const expectedDir = path.join(REPO_ROOT, '.private');
  assert.equal(path.dirname(capturePrivatePath(savePrivateResponse)), expectedDir);
  assert.equal(path.dirname(capturePrivatePath(legacy('common').savePrivateResponse)), expectedDir);
});

test('.private/ is git-ignored at the repo root and in scripts/', () => {
  for (const file of ['.private/x.response', 'scripts/.private/x.response', 'scripts/legacy/.private/x.response']) {

    execFileSync('git', ['check-ignore', '-q', file], { cwd: REPO_ROOT });
  }
});

test('legacy default .env is scripts/.env (honours SCRIPTS_ENV_FILE like src/core/env.ts)', async () => {
  const out = await runNode(['-e', `
    const fs = require('node:fs'); const seen = [];
    const read = fs.readFileSync;
    fs.readFileSync = (f, ...a) => { seen.push(String(f)); return read(f, ...a); };
    try { require('./legacy/common.js').loadEnvProfile(); } catch {}
    console.log(seen.find(f => f.endsWith('.env')));`], { SCRIPTS_ENV_FILE: '' });
  assert.equal(out.stdout.trim(), path.join(SCRIPTS_DIR, '.env'));
});

const WRAPPERS: Record<string, string> = {
  'account-info': 'account-info', 'build_login_curl': 'build-login-curl', 'conversations': 'conversations',
  'eye-device': 'eye-device', 'eye': 'eye', 'home_online': 'home-online', 'hyphenate-connect': 'hyphenate-connect',
  'litsign': 'litsign', 'login-google': 'login-google', 'shadow': 'shadow', 'siua': 'siua',
  'startup-api': 'startup-api', 'user_info': 'user-info',
};

test('every legacy CLI has a wrapper at its old path, forwarding to the TS CLI', () => {
  const legacyClis = fs.readdirSync(path.join(SCRIPTS_DIR, 'legacy'))
    .filter(f => f.endsWith('.js') && !['common.js', 'constants.js'].includes(f)).map(f => f.slice(0, -3)).sort();
  assert.deepStrictEqual(Object.keys(WRAPPERS).sort(), legacyClis);
  for (const [old, cli] of Object.entries(WRAPPERS)) {
    assert.match(fs.readFileSync(path.join(SCRIPTS_DIR, `${old}.js`), 'utf8'), new RegExp(`import '\\./src/cli/${cli}\\.ts';`));
  }
});

const DOC_COMMANDS: [string, string[]][] = [
  ['conversations', ['--help']],
  ['hyphenate-connect', ['--help']],
  ['startup-api', ['--list']],
  ['litsign', ['1700000000000']],
  ['eye-device', ['--help']],
  ['login-google', ['--help']],
];
for (const [old, args] of DOC_COMMANDS) {
  test(`old doc command works: node --env-file=scripts/.env scripts/${old}.js ${args.join(' ')}`, async () => {
    const envFile = fs.existsSync(path.join(SCRIPTS_DIR, '.env')) ? ['--env-file=scripts/.env'] : [];
    const viaWrapper = await runNode([...envFile, `scripts/${old}.js`, ...args], {}, REPO_ROOT);
    const direct = await runNode([`scripts/src/cli/${WRAPPERS[old]}.ts`, ...args], {}, REPO_ROOT);
    assert.equal(viaWrapper.code, 0, viaWrapper.stderr);
    assert.deepStrictEqual(viaWrapper, direct);
  });
}

test('old self-test invocations get a pointer to npm test instead of a wrong result', async () => {
  for (const [cli, args] of [['litsign', ['test']], ['siua', ['test']], ['shadow', []], ['eye', []]] as const) {
    const out = await runNode([`src/cli/${cli}.ts`, ...args]);
    assert.equal(out.code, 1, cli);
    assert.equal(out.stdout, '', cli);
    assert.match(out.stderr, /npm test/, cli);
  }
});
