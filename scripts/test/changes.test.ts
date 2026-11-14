import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { HX_APP_KEY, HX_USERNAME, legacy, outcomeAsync, templateB64, withFetch } from './helpers.ts';
import { loadEnv, readDotEnv } from '../src/core/env.ts';
import { requestUserToken } from '../src/hyphenate/token.ts';
import { loadTemplate } from '../src/hyphenate/template.ts';

const oldHx = legacy('hyphenate-connect');

test('token request now also refuses a non-443 Easemob port (same rule as history requests)', async () => {
  const args = { appKey: HX_APP_KEY, username: HX_USERNAME, password: 'pw', restBase: 'https://a1.easemob.com:8443' };
  const handler = () => Response.json({ access_token: 'T' });
  const mine = await withFetch(handler, () => requestUserToken(args));
  const theirs = await withFetch(handler, () => oldHx.requestUserToken(args));
  assert.deepStrictEqual(mine, { result: { ok: false, error: 'REST base must be an HTTPS Easemob host' }, calls: [] });
  assert.equal(theirs.result.ok, true);
});

test('HX_* values are read from scripts/.env too (legacy needed node --env-file)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scripts-env-'));
  try {
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, `HX_LOGIN_TEMPLATE_B64="${templateB64()}"\nHX_IM_HOST=127.0.0.1\n# HX_PASSWORD="x"\nOTHER=1\n`);
    assert.deepStrictEqual(Object.keys(readDotEnv(file)), ['HX_LOGIN_TEMPLATE_B64', 'HX_IM_HOST']);
    assert.equal(loadTemplate(loadEnv(file)).username, HX_USERNAME);
    process.env.HX_IM_HOST = 'from.process.env';
    try { assert.equal(loadEnv(file).HX_IM_HOST, 'from.process.env', 'real environment wins'); }
    finally { delete process.env.HX_IM_HOST; }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid REST base URL is reported instead of a raw URL TypeError', async () => {
  const args = { appKey: HX_APP_KEY, username: HX_USERNAME, password: 'pw', restBase: 'not a url' };
  assert.deepStrictEqual(await outcomeAsync(() => requestUserToken(args)), { ok: false, error: 'REST base must be an HTTPS Easemob host' });
});
