import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fetchDfpId, parseDfpInput, parseDfpResponse, randomizeDfpInput } from '../src/lit/dfpid.ts';
import { DEVICE_PRESETS } from '../src/cli/device-random.ts';
import { decodeDetect } from '../src/lit/eye-device.ts';
import { runNode } from './helpers.ts';

const input = {
  query: { uuid: 'test-device', loc: 'VN', version: '7.77.0', lang: 'vi', platform: 'android',
    model: 'Test', loctype: '0', os: '33', net_type: 'wifi' },
  fields: { android_id_secure: 'test-device', model: 'Test', cpu_abi: 'arm64-v8a', _meta: 'ignored' },
};
const reply = (exp: unknown = 2000) => ({ httpStatus: 200, headers: {},
  body: { code: 0, data: { dfpId: 'test-token', exp, ver: '0.0.2' } } });

const deviceFields = {
  ...input.fields, brand: 'old', manufacturer: 'old', ad_aaid: 'old', serialno: 'old',
  bluetooth_address: 'old', drmId: 'old', drmId_native: 'old',
  android_id_cache: 'keep-cache', uuid: 'keep-eye-uuid', hardware: 'keep-hardware',
  board: 'keep-board', fingerprint: 'keep-fingerprint', cores_num: 8,
};

test('random DFP input maps identity fields, converts DRM bytes and preserves the rest', () => {
  const source = { query: { ...input.query }, fields: { ...deviceFields } };
  const before = structuredClone(source);
  const out = randomizeDfpInput(source);
  assert.deepEqual(source, before);
  assert.deepEqual(Object.keys(out.fields).sort(), Object.keys(deviceFields).filter(k => k !== '_meta').sort());
  assert.equal(out.query.uuid, out.fields.android_id_secure);
  assert.equal(out.query.model, out.fields.model);
  assert.match(out.query.uuid!, /^[0-9a-f]{16}$/);
  assert.ok(DEVICE_PRESETS.some(([brand, manufacturer, model]) =>
    out.fields.brand === brand && out.fields.manufacturer === manufacturer && out.fields.model === model));
  assert.match(String(out.fields.ad_aaid), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(String(out.fields.serialno), /^[0-9A-HJ-NP-Z]{12}$/);
  assert.match(String(out.fields.bluetooth_address), /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/);
  const drm = Buffer.from(String(out.fields.drmId), 'base64');
  assert.equal(drm.length, 32);
  assert.equal(drm.toString('base64'), out.fields.drmId);
  assert.equal(out.fields.drmId, out.fields.drmId_native);
  for (const key of ['android_id_cache', 'uuid', 'hardware', 'board', 'fingerprint', 'cores_num', 'cpu_abi'] as const) {
    assert.equal(out.fields[key], deviceFields[key]);
  }
  for (const [key, value] of Object.entries(source.query)) {
    if (key !== 'uuid' && key !== 'model') assert.equal(out.query[key], value);
  }
  for (const bad of [null, { query: {}, fields: {} }, { ...source, fields: { ...deviceFields, drmId: 123 } }]) {
    assert.throws(() => randomizeDfpInput(bad));
  }
});

test('DFPID validates snapshot identity before sending', () => {
  assert.equal(parseDfpInput(input).fields._meta, undefined);
  for (const value of [null, { ...input, fields: {} },
    { ...input, query: { ...input.query, uuid: 'different' } },
    { ...input, query: { ...input.query, model: 'different' } },
    { ...input, query: { ...input.query, platform: 'ios' } }]) {
    assert.throws(() => parseDfpInput(value));
  }
});

test('DFPID accepts string/number expiry and rejects failed, invalid or expired responses', () => {
  for (const exp of [2000, '2000']) assert.deepEqual(parseDfpResponse(reply(exp), 'dev', 1000), {
    dfpId: 'test-token', exp: 2000, ver: '0.0.2', fetchedAt: 1000, deviceUuid: 'dev',
  });
  for (const exp of [1000, 999, -1, null, 'bad', '', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseDfpResponse(reply(exp), 'dev', 1000));
  }
  for (const response of [{ ...reply(), httpStatus: 500 }, { ...reply(), body: 'invalid' },
    { ...reply(), body: { ...reply().body, code: 1 } },
    { ...reply(), body: { code: 0, data: { ...reply().body.data, dfpId: '' } } }]) {
    assert.throws(() => parseDfpResponse(response, 'dev', 1000));
  }
});

test('DFPID sends encrypted raw detect body through the separate Eye endpoint', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = new URL(String(url));
    assert.equal(u.origin, 'https://cloud.litatom.com');
    assert.equal(u.pathname, '/api/sns/v1/lit/eye');
    assert.equal(u.searchParams.get('eyeversion'), '1.0.1');
    assert.equal(u.searchParams.get('cpu_abi'), 'arm64-v8a');
    assert.equal(options?.method, 'POST');
    assert.equal(options?.redirect, 'error');
    assert.deepEqual(decodeDetect(String(options?.body)), parseDfpInput(input).fields);
    assert.equal(new Headers(options?.headers).has('X-SIUA'), false);
    return Response.json(reply(Date.now() + 60_000).body);
  };
  try { assert.equal((await fetchDfpId(input)).dfpId, 'test-token'); }
  finally { globalThis.fetch = original; }
});

test('DFPID CLI writes usable token JSON, preserves existing files and removes failed outputs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfpid-test-'));
  try {
    const source = path.join(dir, 'input.json');
    const output = path.join(dir, 'token.json');
    const preload = path.join(dir, 'fetch.mjs');
    fs.writeFileSync(source, JSON.stringify(input));
    fs.writeFileSync(preload, `globalThis.fetch = async () => Response.json({code: 0, data: {
      dfpId: 'test-token', exp: String(Date.now() + 60000), ver: '0.0.2'}});`);
    const args = ['--import', preload, 'src/cli/dfpid.ts', '--input', source, '--output', output];
    const success = await runNode(args);
    assert.equal(success.code, 0, success.stderr);
    const saved = fs.readFileSync(output, 'utf8');
    assert.equal(JSON.parse(saved).dfpId, 'test-token');
    assert.equal(JSON.parse(saved).deviceUuid, 'test-device');
    assert.ok(!success.stdout.includes('test-token'));
    if (process.platform !== 'win32') assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    assert.notEqual((await runNode(args)).code, 0);
    assert.equal(fs.readFileSync(output, 'utf8'), saved);
    fs.unlinkSync(output);
    fs.writeFileSync(preload, 'globalThis.fetch = async () => Response.json({code: 1});');
    assert.notEqual((await runNode(args)).code, 0);
    assert.equal(fs.existsSync(output), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('DFPID CLI uses separate device fields and rejects mismatched account identity', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfpid-device-test-'));
  try {
    const source = path.join(dir, 'config.json');
    const device = path.join(dir, 'device.json');
    const output = path.join(dir, 'token.json');
    const preload = path.join(dir, 'fetch.mjs');
    const decoder = new URL('../src/lit/eye-device.ts', import.meta.url).href;
    fs.writeFileSync(source, JSON.stringify({ query: input.query }));
    fs.writeFileSync(device, JSON.stringify({ ...input.fields, test_marker: 'separate-device' }));
    fs.writeFileSync(preload, `import {decodeDetect} from ${JSON.stringify(decoder)};
globalThis.fetch = async (_url, options) => {
  if (decodeDetect(options.body).test_marker !== 'separate-device') throw Error('wrong device file');
  return Response.json({code: 0, data: {dfpId: 'test-token', exp: Date.now()+60000, ver: '0.0.2'}});
};`);
    const args = ['--import', preload, 'src/cli/dfpid.ts', '--input', source, '--output', output, '--device', device];
    const result = await runNode(args);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).deviceUuid, input.query.uuid);
    fs.unlinkSync(output);
    fs.writeFileSync(device, JSON.stringify({ ...input.fields, android_id_secure: 'other-device' }));
    assert.notEqual((await runNode(args)).code, 0);
    assert.equal(fs.existsSync(output), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('DFPID CLI randomizes once, saves the exact sent payload and can reuse it without randomizing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfpid-random-'));
  try {
    const source = path.join(dir, 'config.json');
    const device = path.join(dir, 'device.json');
    const output = path.join(dir, 'result.json');
    const sent = path.join(dir, 'sent.json');
    const preload = path.join(dir, 'fetch.mjs');
    fs.writeFileSync(source, JSON.stringify({ query: input.query }));
    const original = JSON.stringify(deviceFields);
    fs.writeFileSync(device, original);
    const decoder = new URL('../src/lit/eye-device.ts', import.meta.url).href;
    fs.writeFileSync(preload, `import fs from 'node:fs';
import {decodeDetect} from ${JSON.stringify(decoder)};
globalThis.fetch = async (url, options) => {
  const fields = decodeDetect(options.body), query = Object.fromEntries(new URL(url).searchParams);
  if (query.uuid !== fields.android_id_secure || query.model !== fields.model) throw Error('identity mismatch');
  fs.writeFileSync(${JSON.stringify(sent)}, JSON.stringify({query, fields}));
  return Response.json({code:0, data:{dfpId:'random-test-token', exp:Date.now()+60000, ver:'0.0.2'}});
};`);
    const args = ['--import', preload, 'src/cli/dfpid.ts', '--random', '--device', device,
      '--output', output, '--input', source];
    const result = await runNode(args);
    assert.equal(result.code, 0, result.stderr);
    const savedText = fs.readFileSync(output, 'utf8');
    const saved = JSON.parse(savedText);
    const request = JSON.parse(fs.readFileSync(sent, 'utf8'));
    assert.deepEqual(saved.fields, request.fields);
    for (const [k, v] of Object.entries(saved.query)) assert.equal(request.query[k], v);
    assert.equal(saved.deviceUuid, saved.fields.android_id_secure);
    assert.equal(saved.dfpId, 'random-test-token');
    assert.ok(!result.stdout.includes(saved.deviceUuid));
    assert.ok(!result.stdout.includes(saved.dfpId));
    assert.equal(fs.readFileSync(device, 'utf8'), original);
    if (process.platform !== 'win32') assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    assert.notEqual((await runNode(args)).code, 0);
    assert.equal(fs.readFileSync(output, 'utf8'), savedText);
    const reuse = await runNode(['--import', preload, 'src/cli/dfpid.ts', '--input', output,
      '--output', path.join(dir, 'reused.json')]);
    assert.equal(reuse.code, 0, reuse.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(sent, 'utf8')).fields, saved.fields);
    const defaultRun = await runNode(['--import', preload, 'src/cli/dfpid.ts', '--random',
      '--input', source, '--output', path.join(dir, 'default.json')]);
    assert.equal(defaultRun.code, 0, defaultRun.stderr);
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(sent, 'utf8')).fields).length, 198);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
