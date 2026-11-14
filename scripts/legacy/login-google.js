#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const https = require('node:https');
const crypto = require('node:crypto');
const { encodeShadow, decodeShadow } = require('./shadow');
const { litSign, stsSign } = require('./litsign');

const keys = ['loc', 'uuid', 'version', 'lang', 'platform', 'model', 'loctype', 'os', 'net_type', 'app_source', 'appid'];
const usage = 'Usage: GOOGLE_ID_TOKEN=... X_DFPID=... X_SIUA=... node scripts/login-google.js --config /path/to/config.json [--response-json /private/path.json]';

function required(value, name) {
  if (typeof value !== 'string' || !value.trim() || /<[^>]+>/.test(value) || /[\r\n]/.test(value)) {
    throw new Error(`${name} must be a nonempty value without placeholders or newlines`);
  }
  return value;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
  if (![2, 4].includes(args.length) || args[0] !== '--config' || (args.length === 4 && args[2] !== '--response-json')) throw new Error(usage);
  const responsePath = args.length === 4 ? args[3] : null;
  let responseFd;
  const config = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  if (!config.query || typeof config.query !== 'object' || Array.isArray(config.query)) throw new Error('config.query must be an object');
  const query = new URLSearchParams();
  for (const key of keys) query.append(key, required(config.query[key], `query.${key}`));
  const token = required(process.env.GOOGLE_ID_TOKEN, 'GOOGLE_ID_TOKEN');
  const dfpid = required(process.env.X_DFPID, 'X_DFPID');
  const siua = required(process.env.X_SIUA, 'X_SIUA');
  const flag = config.litSignFlag === undefined ? '1' : config.litSignFlag;
  if (!['0', '1', '2'].includes(flag)) throw new Error('litSignFlag must be "0", "1", or "2"');
  const offset = config.clockOffsetMs === undefined ? 0 : config.clockOffsetMs;
  if (!Number.isSafeInteger(offset)) throw new Error('clockOffsetMs must be an integer');
  const time = Date.now() + offset;
  if (!Number.isSafeInteger(time) || time < 0) throw new Error('invalid adjusted time');
  const ts = String(Math.floor(time / 1000));
  const requestId = crypto.randomUUID();

  const queryString = query.toString().replace(/\+/g, '%20');
  const infoQuery = keys.map(key => `${key}=${config.query[key]}`).join('&');
  const fingerprint = encodeShadow(JSON.stringify({ uuid: config.query.uuid }), 1);
  const headers = {
    'Content-Type': 'application/x-litatom-json; charset=UTF-8',
    'ts': ts,
    'litTime': String(time),
    'litSign': litSign(time, flag),
    'sts-sign': stsSign(ts, config.query.uuid),
    'X-request-Id': requestId,
    'X-Application-Info': encodeShadow(infoQuery, 3),
    'X-DFPID': dfpid,
    'X-SIUA': siua,
    'fingerprint': fingerprint.padEnd(Math.ceil(fingerprint.length / 4) * 4, '='),
  };
  if (config.userAgent !== undefined) headers['User-Agent'] = required(config.userAgent, 'userAgent');
  const body = encodeShadow(JSON.stringify({ token }), 3);
  headers['Content-Length'] = Buffer.byteLength(body);

  if (responsePath) responseFd = fs.openSync(responsePath, 'wx', 0o600);
  const request = https.request({ hostname: 'www.litatom.com', method: 'POST',
    path: `/api/sns/v1/lit/user/google_login?${queryString}`, headers, timeout: 20000 }, response => {
    const chunks = [];
    let length = 0;
    response.on('data', chunk => {
      length += chunk.length;
      if (length > 1024 * 1024) { response.destroy(new Error('response exceeds 1 MiB')); return; }
      chunks.push(chunk);
    });
    response.on('error', () => { console.error('Could not read response'); process.exitCode = 1; });
    response.on('end', () => {
      try {
        let text = Buffer.concat(chunks).toString('utf8');
        const enc = response.headers['x-is-enc'];
        if (response.statusCode >= 200 && response.statusCode < 300) {
          if (typeof enc !== 'string') throw new Error('missing X-Is-Enc');
          const decoded = decodeShadow(enc, 3);
          if (decoded.slice(1) !== requestId || !['0', '1'].includes(decoded[0])) throw new Error('invalid response marker or request ID');
          if (decoded[0] === '1') text = decodeShadow(text, 3);
        }
        const result = JSON.parse(text);
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('response is not a JSON object');
        if (responseFd !== undefined) {
          fs.writeFileSync(responseFd, JSON.stringify({ httpStatus: response.statusCode, headers: response.headers, body: result }, null, 2) + '\n');
          fs.closeSync(responseFd);
          responseFd = undefined;
        }

        const output = { httpStatus: response.statusCode };
        for (const key of ['success', 'result', 'unban_diamonds']) {
          if (typeof result[key] === 'boolean' || typeof result[key] === 'number') output[key] = result[key];
        }
        if (typeof result.message === 'string') output.message = result.message.replace(/1113-[\w-]+/gi, '1113-<redacted>').replace(/BAN_ID[^\s]*/gi, 'BAN_ID<redacted>');
        if (Object.hasOwn(result, 'forbidden_session')) output.forbidden_session = '<redacted>';
        console.log(JSON.stringify(output, null, 2));
      } catch (err) {
        console.error(`HTTP ${response.statusCode}: could not process response (${err.message})`);
        process.exitCode = 1;
      }
    });
  });
  request.on('timeout', () => request.destroy(new Error('request timed out')));
  request.on('error', () => { console.error('Request failed; check network and connection settings'); process.exitCode = 1; });
  request.end(body);
}

try { main(); } catch (err) { console.error(err.message); process.exitCode = 1; }
