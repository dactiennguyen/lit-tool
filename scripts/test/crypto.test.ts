import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';
import { legacy } from './helpers.ts';
import { LITSIGN_SALT, STS_HMAC_KEY } from '../src/core/constants.ts';
import { decodeLitSign, getHMac256SignCode, litSign, md5hex, signHmacHex, stsSign } from '../src/crypto/litsign.ts';
import { decodeShadow, encodeShadow, getToken, ivOf, type ShadowMode } from '../src/crypto/shadow.ts';
import { buildPlaintext, decodeSiua, encodeSiua, SCAN_CLEAN, siua } from '../src/crypto/siua.ts';
import { decodeEye, encodeEye, parseEye } from '../src/crypto/eye.ts';

const old = {
  litsign: legacy('litsign'), shadow: legacy('shadow'), siua: legacy('siua'), eye: legacy('eye'), constants: legacy('constants'),
};
const MODES: ShadowMode[] = [1, 2, 3, 4, 5];
const TIMES = ['0', '1000000000000', '1700000000000', '1731415000000', '1731415000001', '9999999999999', String(Date.now())];

describe('constants', () => {
  test('identical to legacy constants.js', async () => {
    const ts = await import('../src/core/constants.ts');
    for (const [key, value] of Object.entries(old.constants)) {
      assert.deepStrictEqual((ts as Record<string, unknown>)[key], value, key);
    }
  });
});

describe('litSign / sts-sign', () => {
  test('prefix follows the integrity flag', () => {
    assert.ok(litSign('1731415000000', '1').startsWith('MXw'));
    assert.ok(litSign('1731415000000', '0').startsWith('MHw'));
    assert.ok(litSign('1731415000000', '2').startsWith('Mnw'));
  });

  test('matches the documented formula', () => {
    const t = '1700000000000';
    const expected = Buffer.from('1|' + createHash('md5').update(t + '1' + LITSIGN_SALT).digest('hex')).toString('base64');
    assert.equal(litSign(t), expected);
    assert.deepStrictEqual(decodeLitSign(expected), { s: '1', md5: md5hex(t + '1' + LITSIGN_SALT), raw: Buffer.from(expected, 'base64').toString() });
  });

  test('deterministic, avalanche on +1 ms, number/string/bigint agree', () => {
    assert.equal(litSign('1731415000000'), litSign('1731415000000'));
    assert.notEqual(litSign('1731415000000'), litSign('1731415000001'));
    assert.equal(litSign(1731415000000), litSign(1731415000000n));
  });

  test('sts-sign = base64(hex(HMAC-SHA256))', () => {
    const input = '1700000000_550e8400-e29b-41d4-a716-446655440000';
    const hex = createHmac('sha256', STS_HMAC_KEY).update(input).digest('hex');
    assert.equal(signHmacHex(input), hex);
    assert.equal(stsSign('1700000000', '550e8400-e29b-41d4-a716-446655440000'), Buffer.from(hex).toString('base64'));
  });

  test('parity with legacy crypto-js implementation', () => {
    for (const t of TIMES) for (const s of ['0', '1', '2'] as const) {
      assert.equal(litSign(t, s), old.litsign.litSign(t, s), `litSign ${t} ${s}`);
      assert.deepStrictEqual(decodeLitSign(litSign(t, s)), old.litsign.decodeLitSign(old.litsign.litSign(t, s)));
    }
    for (const input of ['', 'a', '1700000000_abc', 'ünïcødé_✓', 'x'.repeat(500)]) {
      assert.equal(md5hex(input), old.litsign.md5hex(input));
      assert.equal(signHmacHex(input), old.litsign.signHmacHex(input));
      assert.equal(getHMac256SignCode(input), old.litsign.getHMac256SignCode(input));
    }
    assert.equal(stsSign(1700000000, 'abc'), old.litsign.stsSign(1700000000, 'abc'));
  });
});

describe('shadow (X-Application-Info)', () => {
  const sample = 'loc=VN&uuid=966bbd0563ea67e3&version=7.77.0';

  test('round-trips every mode', () => {
    for (const m of MODES) assert.equal(decodeShadow(encodeShadow(sample, m), m), sample);
  });

  test('mode 3 appends the IV; ivOf recovers it', () => {
    const iv = randomBytes(16);
    const value = encodeShadow(sample, 3, iv);
    assert.deepStrictEqual(ivOf(value), iv);
    assert.equal(encodeShadow(sample, 3, ivOf(value)), value);
  });

  test('parity with legacy shadow.js (same IV => same bytes)', () => {
    const iv = randomBytes(16);
    for (const m of MODES) for (const text of [sample, '', '{"uuid":"x"}', 'ü✓'.repeat(40)]) {
      const mine = m === 3 ? encodeShadow(text, m, iv) : encodeShadow(text, m);
      const theirs = m === 3 ? old.shadow.encodeShadow(text, m, iv) : old.shadow.encodeShadow(text, m);
      assert.equal(mine, theirs, `mode ${m}`);
      assert.equal(decodeShadow(theirs, m), old.shadow.decodeShadow(mine, m));
    }
    const token = encodeShadow('agora-token', 2);
    assert.equal(getToken(token), old.shadow.getToken(token));
  });
});

describe('X-SIUA', () => {
  const ts = 1700000000000;
  const uuid = '00000000-0000-4000-8000-000000000000';

  test('plaintext format', () => {
    assert.equal(buildPlaintext({ ts, uuid }), `2.1}}1.9.9|${ts}|${uuid}}}${SCAN_CLEAN}}}`);
  });

  test('round-trip, fresh ts and nonce', () => {
    const token = siua();
    const m = decodeSiua(token).match(/^2\.1}}1\.9\.9\|(\d{13})\|([0-9a-f-]{36})}}/);
    assert.ok(m);
    assert.ok(Math.abs(Date.now() - Number(m[1])) < 5000);
    assert.notEqual(siua(), siua());
  });

  test('parity with legacy siua.js', () => {
    for (const parts of [{ ts, uuid }, { ts: 1, uuid: 'x', scan: '' }, {}]) {
      const plain = buildPlaintext({ ts, uuid, ...parts });
      assert.equal(plain, old.siua.buildPlaintext({ ts, uuid, ...parts }));
      assert.equal(encodeSiua(plain), old.siua.encodeSiua(plain));
      assert.equal(decodeSiua(old.siua.encodeSiua(plain)), plain);
    }
    assert.equal(SCAN_CLEAN, old.siua.SCAN_CLEAN);
  });

  const samplePath = process.env.SIUA_SAMPLE || '/Volumes/D/TEST/lite-assets/.private/eye-siua-paired-20261113.json';
  test('real native token (optional private sample)', { skip: !fs.existsSync(samplePath) && 'no private sample' }, () => {
    const real = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
    assert.equal(decodeSiua(real.token), real.plaintext);
    assert.equal(encodeSiua(real.plaintext), real.token);
  });
});

describe('eye-blob', () => {
  const syn = '2.1}}1.9.9|1700000000000|00000000-0000-4000-8000-000000000000}}||||||none|0|none||quantity:0|RWX:0|}}';

  test('round-trip and parse', () => {
    assert.equal(decodeEye(encodeEye(syn)), syn);
    const parsed = parseEye(syn);
    assert.equal(parsed.ts, '1700000000000');
    assert.equal(parsed.scan.rwx, 'quantity:0|RWX:0|');
  });

  test('parity with legacy eye.js', () => {
    for (const text of [syn, '', 'garbage', 'a}}b|c|d}}1|2|3|4|5|6|7|8|9|10|11|12|13}}']) {
      assert.equal(encodeEye(text), old.eye.encodeEye(text));
      assert.equal(decodeEye(old.eye.encodeEye(text)), old.eye.decodeEye(encodeEye(text)));
      assert.deepStrictEqual(parseEye(text), old.eye.parseEye(text));
    }
  });

  const samplePath = process.env.EYE_SAMPLE || new URL('../../.private/eye-blob-sample.txt', import.meta.url).pathname;
  test('real eye blob (optional private sample)', { skip: !fs.existsSync(samplePath) && 'no private sample' }, () => {
    const blob = fs.readFileSync(samplePath, 'utf8').trim();
    assert.equal(decodeEye(blob), old.eye.decodeEye(blob));
    assert.deepStrictEqual(parseEye(decodeEye(blob)), old.eye.parseEye(old.eye.decodeEye(blob)));
  });
});
