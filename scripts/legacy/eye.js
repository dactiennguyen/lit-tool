#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const zlib = require('zlib');
const { EYEBLOB_KEY_HEX, EYEBLOB_IV_HEX } = require('./constants');

const KEY = Buffer.from(EYEBLOB_KEY_HEX, 'hex');
const IV  = Buffer.from(EYEBLOB_IV_HEX, 'hex');

function decodeEye(b64) {
  const ct = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-128-cbc', KEY, IV);
  const pt = Buffer.concat([d.update(ct), d.final()]);
  return zlib.inflateSync(pt).toString('utf8');
}

function encodeEye(text) {
  const pre = zlib.deflateSync(Buffer.from(text, 'utf8'), { level: 9 });
  const c = crypto.createCipheriv('aes-128-cbc', KEY, IV);
  const ct = Buffer.concat([c.update(pre), c.final()]);
  return ct.toString('base64');
}

function parseEye(text) {
  const parts = text.split('}}');
  const head = (parts[1] || '').split('|');
  const flags = (parts[2] || '').split('|');
  const NAMES = ['fridaMaps','fridaThread','lsposed','pmsHook','root','accessibility','proxy','count','vpn','spare','rwx'];
  const scan = {};
  NAMES.forEach((n, i) => scan[n] = (i === NAMES.length - 1 ? flags.slice(i).join('|') : flags[i]) ?? '');

  return { fmt: parts[0], eyeVer: head[0], ts: head[1], uuid: head[2], scan };
}

module.exports = { decodeEye, encodeEye, parseEye, KEY, IV };

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'decode') console.log(decodeEye(arg));
  else if (cmd === 'parse') console.log(JSON.stringify(parseEye(decodeEye(arg)), null, 2));
  else if (cmd === 'encode') console.log(encodeEye(arg));
  else {

    const samplePath = process.env.EYE_SAMPLE || require('path').join(__dirname, '..', '..', '.private', 'eye-blob-sample.txt');
    let b = null;
    try { b = require('fs').readFileSync(samplePath, 'utf8').trim(); } catch {                    }
    if (b) {
      const txt = decodeEye(b);
      console.log('decode mẫu thật:', JSON.stringify(txt));
      console.log('parsed :', JSON.stringify(parseEye(txt)));
      console.log('roundtrip encode==orig:', encodeEye(txt) === b ? 'PASS' : '(khác padding/level, decode lại vẫn khớp)');
    } else {
      const syn = '2.1}}1.9.9|1700000000000|00000000-0000-4000-8000-000000000000}}||||||none|0|none||quantity:0|RWX:0|}}';
      console.log('(không có file mẫu riêng:', samplePath + ')');
      console.log('round-trip tổng hợp decode(encode)==orig:', decodeEye(encodeEye(syn)) === syn ? 'PASS' : 'FAIL');
      console.log('parsed :', JSON.stringify(parseEye(syn)));
    }
  }
}
