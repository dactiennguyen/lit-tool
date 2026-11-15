import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPlaintext, decodeSiua, SCAN_CLEAN } from '../../../scripts/src/crypto/siua.ts';
import { litSign, stsSign } from '../../../scripts/src/crypto/litsign.ts';
import { decodeShadow } from '../../../scripts/src/crypto/shadow.ts';

const { fresh, samples } = JSON.parse(readFileSync(0, 'utf8'));
assert.ok(Math.abs(Date.now() - fresh) < 60_000, 'Rust clock must use current Unix milliseconds');
assert.equal(samples.length, 10);
const tokens = new Set();
const uuids = new Set();
for (const { nowMs, method, url, headers, body, plainBody } of samples) {
  const h = Object.fromEntries(headers);
  assert.equal(headers.filter(([key]) => key === 'X-SIUA').length, 1);
  assert.equal(h.litTime, String(nowMs));
  assert.equal(h.ts, String(Math.floor(nowMs / 1000)));
  assert.equal(h.litSign, litSign(nowMs));
  assert.equal(h['sts-sign'], stsSign(h.ts, 'synthetic-device'));
  assert.equal(h['X-DFPID'], 'synthetic-dfpid');
  assert.equal(decodeShadow(h['X-Application-Info']), new URL(url).search.slice(1));
  const plaintext = decodeSiua(h['X-SIUA']);
  const parts = plaintext.split('}}');
  const [eye, timestamp, uuid] = parts[1].split('|');
  assert.equal(eye, '1.9.9');
  assert.equal(timestamp, String(nowMs));
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(uuid, h['X-request-Id']);
  assert.equal(plaintext, buildPlaintext({ ts: nowMs, uuid, scan: SCAN_CLEAN }));
  tokens.add(h['X-SIUA']);
  uuids.add(uuid);
  if (method === 'POST') assert.equal(decodeShadow(body), plainBody);
  else assert.equal(body, null);
}
assert.equal(tokens.size, samples.length);
assert.equal(uuids.size, samples.length);
console.log(`Verified ${samples.length} Rust GET/POST samples in Node: SIUA, UUIDv4, timestamps, litSign, sts-sign, Shadow and DFPID.`);
