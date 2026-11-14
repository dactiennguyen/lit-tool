#!/usr/bin/env node

'use strict';
const CryptoJS = require('crypto-js');
const { LITSIGN_SALT: SALT, STS_HMAC_KEY: HMAC_KEY } = require('./constants');

const S = Object.freeze({ VALID: '1', REPACKED: '0', UNKNOWN: '2' });

function md5hex(str) {
  return CryptoJS.MD5(str).toString(CryptoJS.enc.Hex);
}

function b64(str) {
  return CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(str));
}

function unb64(str) {
  return CryptoJS.enc.Base64.parse(str).toString(CryptoJS.enc.Utf8);
}

function litSign(litTime, s = S.VALID) {
  const inner = String(litTime) + s + SALT;
  const out = s + '|' + md5hex(inner);
  return b64(out);
}

function decodeLitSign(sign) {
  const out = unb64(sign);
  const i = out.indexOf('|');
  return { s: out.slice(0, i), md5: out.slice(i + 1), raw: out };
}

function signHmacHex(msg) {
  return CryptoJS.HmacSHA256(msg, HMAC_KEY).toString(CryptoJS.enc.Hex);
}

function getHMac256SignCode(input) {
  return b64(signHmacHex(input));
}

function stsSign(ts, uuid) {
  return getHMac256SignCode(`${ts}_${uuid}`);
}

module.exports = {
  litSign, decodeLitSign, md5hex, b64, S, SALT,
  signHmacHex, getHMac256SignCode, stsSign, HMAC_KEY,
};

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length >= 1 && args[0] !== 'test') {
    console.log(litSign(args[0], args[1] || S.VALID));
    process.exit(0);
  }

  console.log('=== litSign (crypto-js) — self-test ===\n');
  console.log('node:', process.version, '| crypto-js:', require('crypto-js/package.json').version, '\n');

  const prefixExpect = { '1': 'MXw', '0': 'MHw', '2': 'Mnw' };
  console.log('--- (1) prefix theo cờ s ---');
  let okPrefix = true;
  for (const s of ['1', '0', '2']) {
    const sig = litSign('1731415000000', s);
    const ok = sig.startsWith(prefixExpect[s]);
    okPrefix = okPrefix && ok;
    console.log(`  s=${s}: ${sig}   prefix ${prefixExpect[s]} -> ${ok ? 'OK' : 'FAIL'}`);
  }

  console.log('\n--- (2) litSign theo litTime (s="1") ---');
  for (const t of [0, 1000000000000, 1731415000000, 1731415000001, Date.now(), '9999999999999']) {
    const sig = litSign(t);
    const dec = decodeLitSign(sig);
    console.log(`  litTime=${String(t).padEnd(14)} litSign=${sig}`);
    console.log(`      decode -> s="${dec.s}" md5=${dec.md5}`);
  }

  console.log('\n--- (3) determinism & avalanche ---');
  const a = litSign('1731415000000'), b = litSign('1731415000000'), c = litSign('1731415000001');
  console.log(`  same input equal : ${a === b ? 'OK' : 'FAIL'}`);
  console.log(`  +1ms differs     : ${a !== c ? 'OK' : 'FAIL'}`);

  console.log('\n--- (4) cross-check crypto-js vs Node crypto built-in ---');
  const nodeCrypto = require('crypto');
  const refLitSign = (litTime, s = '1') => {
    const inner = String(litTime) + s + SALT;
    const out = s + '|' + nodeCrypto.createHash('md5').update(inner).digest('hex');
    return Buffer.from(out, 'utf8').toString('base64');
  };
  let okCross = true;
  for (const t of ['0', '1700000000000', '1731415000000', String(Date.now())]) {
    for (const s of ['1', '0', '2']) {
      const same = litSign(t, s) === refLitSign(t, s);
      okCross = okCross && same;
      if (!same) console.log(`  MISMATCH t=${t} s=${s}`);
    }
  }
  console.log(`  crypto-js === built-in : ${okCross ? 'PASS (trùng khít)' : 'FAIL'}`);

  console.log('\n--- (5) fixed vector ---');
  const ft = '1700000000000';
  console.log(`  litSign("${ft}","1") = ${litSign(ft, '1')}`);
  console.log(`  md5_hex("${ft}1${SALT}") = ${md5hex(ft + '1' + SALT)}`);

  console.log('\n--- (6) sts-sign = base64(hex(HMAC-SHA256("I am your father", ts_"_"uuid))) ---');
  const exTs = '1700000000', exUuid = '550e8400-e29b-41d4-a716-446655440000';
  console.log(`  input      = "${exTs}_${exUuid}"`);
  console.log(`  hmac_hex   = ${signHmacHex(exTs + '_' + exUuid)}`);
  console.log(`  sts-sign   = ${stsSign(exTs, exUuid)}`);

  const nc = require('crypto');
  const refHmac = nc.createHmac('sha256', HMAC_KEY).update(exTs + '_' + exUuid).digest('hex');
  console.log(`  hmac == built-in : ${refHmac === signHmacHex(exTs + '_' + exUuid) ? 'OK' : 'FAIL'}`);

  console.log(`\nprefix: ${okPrefix ? 'PASS' : 'FAIL'} | cross-check: ${okCross ? 'PASS' : 'FAIL'}`);
  console.log('\nGround truth = so với native (hook com.litatom.libguard.LibGuard.getSignCode qua frida).');
}
