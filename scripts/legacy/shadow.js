#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const { SHADOW_KEYS: KEYS, SHADOW_IV_FIXED: IV_FIXED } = require('./constants');
const key = (m) => Buffer.from(KEYS[m], 'utf8');

function encodeShadow(text, mode = 3, iv = mode === 3 ? crypto.randomBytes(16) : Buffer.from(IV_FIXED)) {
  const c = crypto.createCipheriv('aes-256-cbc', key(mode), iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return (mode === 3 ? Buffer.concat([ct, iv]) : ct).toString('base64url');
}
function decodeShadow(value, mode = 3) {
  const d = Buffer.from(value, 'base64url');
  const [ct, iv] = mode === 3 ? [d.subarray(0, -16), d.subarray(-16)] : [d, Buffer.from(IV_FIXED)];
  const dec = crypto.createDecipheriv('aes-256-cbc', key(mode), iv);
  return Buffer.concat([dec.update(ct), dec.final()]).toString('utf8');
}
const ivOf = (value) => Buffer.from(value, 'base64url').subarray(-16);
const getToken = (value) => decodeShadow(value, 2);

module.exports = { encodeShadow, decodeShadow, getToken, ivOf, KEYS, IV_FIXED };

if (require.main === module) {
  const [cmd, val, mode] = process.argv.slice(2);
  if (cmd === 'decode') console.log(decodeShadow(val, +(mode || 3)));
  else if (cmd === 'encode') console.log(encodeShadow(val, +(mode || 3)));
  else {
    const s = 'loc=VN&uuid=966bbd0563ea67e3&version=7.77.0';
    const ok = [1, 2, 3, 4, 5].every((m) => decodeShadow(encodeShadow(s, m), m) === s);
    console.log('round-trip tất cả mode:', ok ? 'PASS' : 'FAIL');
  }
}
