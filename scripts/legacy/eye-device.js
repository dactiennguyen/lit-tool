#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { DETECT_KEY_HEX, DETECT_IV_HEX } = require('./constants');

const KEY = Buffer.from(DETECT_KEY_HEX, 'hex');
const IV = Buffer.from(DETECT_IV_HEX, 'hex');
const EYE_URL = 'https://cloud.litatom.com/api/sns/v1/lit/eye?eyeversion=1.0.1';
const QUERY_KEYS = ['sid', 'loc', 'uuid', 'version', 'lang', 'han', 'platform', 'model', 'loctype', 'os', 'net_type', 'appid'];
const REQUIRED_QUERY = ['loc', 'uuid', 'version', 'lang', 'platform', 'model', 'loctype', 'os', 'net_type'];
const MAX_RESPONSE = 1024 * 1024;
const OPTIONS = ['--snapshot', '--overrides', '--config', '--response-json'];
const USAGE = `Usage: node scripts/eye-device.js ${OPTIONS.map(o => `${o} <file>`).join(' ')}`;

function prepareFields(snapshot, overrides) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('snapshot must be an object');
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('overrides must be an object');
  const fields = Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== '_meta'));
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(fields, key)) throw new Error(`unknown Eye field: ${key}`);
    if (value === null || typeof value !== typeof fields[key] || !['string', 'number', 'boolean'].includes(typeof value))
      throw new Error(`invalid type for Eye field: ${key}`);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`invalid number for Eye field: ${key}`);
    fields[key] = value;
  }
  return fields;
}

const encodeDetect = (fields) => {
  const compressed = zlib.deflateSync(Buffer.from(JSON.stringify(fields)), { level: 9 });
  const cipher = crypto.createCipheriv('aes-128-cbc', KEY, IV);
  return Buffer.concat([cipher.update(compressed), cipher.final()]).toString('base64');
};

const decodeDetect = (blob) => {
  const decipher = crypto.createDecipheriv('aes-128-cbc', KEY, IV);
  return JSON.parse(zlib.inflateSync(Buffer.concat([decipher.update(Buffer.from(blob, 'base64')), decipher.final()])).toString('utf8'));
};

function buildEyeUrl(query, cpuAbi) {
  const url = new URL(EYE_URL);
  for (const key of QUERY_KEYS)
    if (query[key] !== undefined) {
      if (typeof query[key] !== 'string') throw new Error(`invalid query field: ${key}`);
      url.searchParams.append(key, query[key]);
    }
  url.searchParams.append('cpu_abi', cpuAbi);
  return url;
}

async function postDetect(fields, query) {
  if (typeof fields.cpu_abi !== 'string' || !fields.cpu_abi) throw new Error('snapshot must contain cpu_abi');
  const url = buildEyeUrl(query, fields.cpu_abi);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Accept-Encoding': 'identity' },
    body: encodeDetect(fields), redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  const chunks = [];
  let size = 0;
  if (response.body) for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_RESPONSE) throw new Error('response exceeds 1 MiB');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { httpStatus: response.status, headers: Object.fromEntries(response.headers), body };
}

function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === '--help') return null;
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!OPTIONS.includes(argv[i]) || !argv[i + 1] || Object.hasOwn(options, argv[i])) throw new Error(USAGE);
    options[argv[i]] = argv[i + 1];
  }
  if (Object.keys(options).length !== OPTIONS.length) throw new Error(USAGE);
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  if (!options) return console.log(USAGE);

  const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
  const snapshot = read(options['--snapshot']);
  const overrides = read(options['--overrides']);
  const config = read(options['--config']);
  if (!config.query || typeof config.query !== 'object' || Array.isArray(config.query)) throw new Error('config.query must be an object');
  for (const key of REQUIRED_QUERY)
    if (typeof config.query[key] !== 'string' || !config.query[key]) throw new Error(`missing query field: ${key}`);

  const fields = prepareFields(snapshot, overrides);

  const fd = fs.openSync(options['--response-json'], 'wx', 0o600);
  let result;
  try {
    result = await postDetect(fields, config.query);
    fs.writeSync(fd, JSON.stringify(result, null, 2) + '\n');
  } finally {
    fs.closeSync(fd);
  }
  const body = result.body && typeof result.body === 'object' ? result.body : null;
  console.log(JSON.stringify({
    httpStatus: result.httpStatus,
    fieldCount: Object.keys(fields).length,
    changedFields: Object.keys(overrides).filter((key) => fields[key] !== snapshot[key]),
    result: body ? body.result ?? null : null,
    success: body ? body.success ?? null : null,
    dfpIdPresent: !!(body && body.data && body.data.dfpId),
  }, null, 2));
}

module.exports = { prepareFields, encodeDetect, decodeDetect, buildEyeUrl, postDetect };

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exitCode = 1; });
}
