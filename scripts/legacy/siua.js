#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { EYEBLOB_KEY_HEX, EYEBLOB_IV_HEX, EYEBLOB_FORMAT_VER: FORMAT_VER, EYEBLOB_EYE_VER: EYE_VER } = require('./constants');

const KEY = Buffer.from(EYEBLOB_KEY_HEX, 'hex');
const IV  = Buffer.from(EYEBLOB_IV_HEX, 'hex');

const SCAN_CLEAN = '||||||none|0|none||quantity:4|RWX:0|';

function buildPlaintext({ ts = Date.now(), uuid = crypto.randomUUID(), scan = SCAN_CLEAN } = {}) {
  return `${FORMAT_VER}}}${EYE_VER}|${ts}|${uuid}}}${scan}}}`;
}

function encodeSiua(plaintext) {
  const comp = zlib.deflateSync(Buffer.from(plaintext, 'utf8'), { level: 9 });
  const c = crypto.createCipheriv('aes-128-cbc', KEY, IV);
  return Buffer.concat([c.update(comp), c.final()]).toString('base64');
}

function decodeSiua(token) {
  const d = crypto.createDecipheriv('aes-128-cbc', KEY, IV);
  const comp = Buffer.concat([d.update(Buffer.from(token, 'base64')), d.final()]);
  return zlib.inflateSync(comp).toString('utf8');
}

function siua(opts = {}) {
  return encodeSiua(buildPlaintext(opts));
}

module.exports = {
  siua, encodeSiua, decodeSiua, buildPlaintext,
  SCAN_CLEAN, FORMAT_VER, EYE_VER, KEY, IV,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === 'decode' && args[1]) { console.log(decodeSiua(args[1])); process.exit(0); }
  if (args[0] && args[0] !== 'test') { console.log(siua()); process.exit(0); }

  console.log('=== siua.js — self-test ===');
  console.log('node:', process.version, '\n');

  const samplePath = process.env.SIUA_SAMPLE ||
    '/Volumes/D/TEST/lite-assets/.private/eye-siua-paired-20261113.json';
  console.log('--- (1) decode/encode token THẬT (chứng minh key/iv) ---');
  let REAL = null;
  try { REAL = JSON.parse(require('node:fs').readFileSync(samplePath, 'utf8')); } catch {                    }
  if (REAL?.token && REAL?.plaintext) {
    console.log('  decode == plaintext native :', decodeSiua(REAL.token) === REAL.plaintext ? 'PASS' : 'FAIL');
    console.log('  encode == token (BIT-ID)   :', encodeSiua(REAL.plaintext) === REAL.token ? 'PASS 🎯' : 'FAIL');
  } else {
    console.log('  (bỏ qua — không có file mẫu riêng:', samplePath + ')');
  }

  const synTs = 1700000000000, synUuid = '00000000-0000-4000-8000-000000000000';
  const rebuilt = buildPlaintext({ ts: synTs, uuid: synUuid });
  const expect = `2.1}}1.9.9|${synTs}|${synUuid}}}${SCAN_CLEAN}}}`;
  console.log('\n--- (2) buildPlaintext đúng format ---');
  console.log('  rebuilt == format kỳ vọng:', rebuilt === expect ? 'PASS' : 'FAIL', '| len', rebuilt.length);

  const t = siua();
  const back = decodeSiua(t);
  console.log('\n--- (3) round-trip siua()→decode ---');
  console.log('  token mới :', t);
  console.log('  decode    :', back);
  const m = back.match(/^2\.1}}1\.9\.9\|(\d{13})\|([0-9a-f-]{36})}}/);
  console.log('  cấu trúc hợp lệ (ts 13 số + uuid):', m ? 'PASS' : 'FAIL');
  console.log('  ts ~ hiện tại:', m && Math.abs(Date.now() - Number(m[1])) < 5000 ? 'PASS' : 'FAIL');

  console.log('\n--- (4) token đổi mỗi lần (nonce) ---');
  console.log('  siua() !== siua():', siua() !== siua() ? 'PASS' : 'FAIL');
}
