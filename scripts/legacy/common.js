'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { encodeShadow, decodeShadow } = require('./shadow');
const { litSign, stsSign } = require('./litsign');
const { siua } = require('./siua');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_ENV_FILE = () => process.env.SCRIPTS_ENV_FILE || path.join(__dirname, '..', '.env');
const BASE_URL = 'https://www.litatom.com';

const COMMON_QUERY_DEFAULTS = Object.freeze({
  app_source: 'litmatch', appid: 'NxUUhRSQH3qPJmY2Vn/edRz4vrc=',
  lang: 'vi', loc: 'US', loctype: '0', model: 'Pixel 8 Pro', net_type: 'wifi', os: '33',
});
const QUERY_KEYS = new Set([
  'hash_code', 'classify', 'from', 'source', 'is_mini_profile', 'is_zone',
  'start_pos', 'start_ts', 'num', 'target_uid', 'version', 'app_source',
  'appid', 'lang', 'loc', 'loctype', 'model', 'net_type', 'os', 'platform', 'uuid', 'han'
]);

function loadEnvProfile(file = DEFAULT_ENV_FILE()) {
  let content = '';
  try { content = fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw Error('Không đọc được .env'); }
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(LIT_[A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"')) {
      try { value = JSON.parse(value); }
      catch (_) { throw Error('Giá trị trong .env không hợp lệ'); }
    }
    if (typeof value !== 'string') throw Error('Giá trị trong .env phải là chuỗi');
    values[match[1]] = value;
  }
  const get = name => process.env[name] ?? values[name];
  const profile = validateProfile({
    sid: get('LIT_SID'), uuid: get('LIT_UUID'), version: get('LIT_VERSION'),
    platform: get('LIT_PLATFORM'), userId: get('LIT_USER_ID'),

    dfpid: get('LIT_DFPID'), siua: get('LIT_SIUA')
  });

  const rawBase = get('LIT_BASE_URL');
  if (rawBase) {
    let u;
    try { u = new URL(rawBase); } catch (_) { throw Error('LIT_BASE_URL không hợp lệ'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw Error('LIT_BASE_URL phải là http(s)');
    profile.baseUrl = u.origin;
  } else profile.baseUrl = BASE_URL;

  const cq = { ...COMMON_QUERY_DEFAULTS };
  for (const k of Object.keys(cq)) {
    const v = get('LIT_' + k.toUpperCase());
    if (typeof v === 'string' && v) cq[k] = v;
  }
  profile.commonQuery = cq;
  return profile;
}

function validateProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) ||
      typeof profile.sid !== 'string' || !profile.sid ||
      typeof profile.uuid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(profile.uuid) ||
      typeof profile.version !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(profile.version) ||
      profile.platform !== 'android') throw Error('Thiếu hoặc sai LIT_SID, LIT_UUID, LIT_VERSION, LIT_PLATFORM');
  if (profile.userId !== undefined && (typeof profile.userId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(profile.userId)))
    throw Error('userId không hợp lệ');
  for (const k of ['dfpid', 'siua'])
    if (profile[k] !== undefined && profile[k] !== null && (typeof profile[k] !== 'string' || !/^[A-Za-z0-9+/=_-]{1,512}$/.test(profile[k])))
      throw Error(`${k} không hợp lệ`);
  return profile;
}

function loadJsonProfile(file) {
  let profile;
  try { profile = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { throw Error('Không đọc được profile JSON'); }
  return validateProfile(profile);
}

function loadQuery(file) {
  if (!file) return {};
  let query;
  try { query = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { throw Error('Không đọc được query JSON'); }
  if (!query || Array.isArray(query) || typeof query !== 'object') throw Error('Query JSON phải là object');
  for (const [key, value] of Object.entries(query)) {
    if (!QUERY_KEYS.has(key) || !['string', 'number', 'boolean'].includes(typeof value))
      throw Error('Query có tên hoặc kiểu không được hỗ trợ');
  }
  return query;
}

function buildGetRequest(endpoint, profile, query = {}) {
  const params = { ...query };
  if (endpoint === 'gift/gifts_v2') {
    params.hash_code ??= '';
    params.classify ??= 'normal';
  }

  const common = profile.commonQuery || COMMON_QUERY_DEFAULTS;
  for (const [k, v] of Object.entries(common)) params[k] ??= v;
  params.uuid ??= profile.uuid;
  params.version ??= profile.version;
  params.platform ??= profile.platform;
  let requestPath = endpoint;
  if (requestPath.includes(':id')) {
    if (!profile.userId || !/^[A-Za-z0-9_-]+$/.test(profile.userId)) throw Error('Thiếu userId của tài khoản');
    requestPath = requestPath.replace(':id', encodeURIComponent(profile.userId));
  }
  const url = new URL('/api/sns/v1/lit/' + requestPath, profile.baseUrl || BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  url.searchParams.set('sid', profile.sid);

  const requestId = crypto.randomUUID();
  const time = Date.now();
  const ts = String(Math.floor(time / 1000));
  const headers = {
    accept: 'application/json',
    'v-mode': '0',
    ts,
    litTime: String(time),
    litSign: litSign(time, '1'),
    'X-request-Id': requestId,
    'sts-sign': stsSign(ts, profile.uuid),
    'X-Application-Info': encodeShadow(url.search.slice(1), 3),
  };
  if (profile.userId) headers['lit-user-id'] = profile.userId;

  if (profile.dfpid) headers['X-DFPID'] = profile.dfpid;

  headers['X-SIUA'] = profile.siua || siua();
  return { endpoint, url, headers, requestId, shadow: true };
}

async function fetchGet(request) {
  return fetchRequest(request, 'GET');
}

function buildPostRequest(endpoint, profile, payload) {
  const keys = {
    'user/accost_count': ['targetId'],
    'user/conversation': ['conversation_id', 'conversation_type'],
    'user/conversation/source': ['source', 'target_user_id'],
  }[endpoint];
  if (!Array.isArray(keys) || !payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).length !== keys.length || !keys.every(k => Object.hasOwn(payload, k))) {
    throw Error('Unsupported IM POST endpoint or payload');
  }
  const target = payload.targetId ?? payload.conversation_id ?? payload.target_user_id;
  if (typeof target !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(target) ||
      (endpoint === 'user/conversation' && payload.conversation_type !== 0) ||
      (endpoint === 'user/conversation/source' && payload.source !== 'other')) {
    throw Error('Invalid IM metadata payload');
  }
  const request = buildGetRequest(endpoint, profile);
  if (request.url.protocol !== 'https:' || request.url.hostname !== 'www.litatom.com' ||
      request.url.username || request.url.password || (request.url.port && request.url.port !== '443')) {
    throw Error('IM metadata requires https://www.litatom.com');
  }
  request.headers['Content-Type'] = 'application/x-litatom-json; charset=UTF-8';
  request.method = 'POST';
  request.body = encodeShadow(JSON.stringify(payload), 3);
  return request;
}

async function fetchPost(request) {
  if (request.method !== 'POST' || typeof request.body !== 'string') throw Error('Expected encoded POST request');
  return fetchRequest(request, 'POST');
}

async function fetchRequest(request, method) {
  const response = await fetch(request.url, {
    method, headers: request.headers, ...(method === 'POST' ? { body: request.body } : {}),
    redirect: 'error', signal: AbortSignal.timeout(12000)
  });
  const chunks = [];
  let length = 0;
  if (response.body) for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 2 * 1024 * 1024) throw Error('Response vượt giới hạn 2 MiB');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  let body = raw, encrypted = null, idMatches = null;

  const encryptedFlag = response.ok ? response.headers.get('x-is-enc') : null;
  if (encryptedFlag) {
    try {
      const flag = decodeShadow(encryptedFlag, 3);
      idMatches = flag.slice(1) === request.requestId;
      if (!idMatches || !['0', '1'].includes(flag[0])) throw Error('invalid response');
      encrypted = flag[0] === '1';
      if (encrypted) body = Buffer.from(decodeShadow(raw.toString('utf8'), 3), 'utf8');
    } catch (_) { throw Error('Không giải mã được response hoặc request ID không khớp'); }
  }
  let json;
  try { json = JSON.parse(body.toString('utf8')); } catch (_) { json = null; }
  const summary = {
    method, endpoint: request.endpoint, http_status: response.status,
    success: typeof json?.success === 'boolean' ? json.success : null,
    result: typeof json?.result === 'number' ? json.result : null,
    bytes: raw.length, json: !!json && typeof json === 'object'
  };
  if (request.shadow) Object.assign(summary, { response_encrypted: encrypted, request_id_matches: idMatches });
  return { summary, body };
}

function savePrivateResponse(body) {
  const dir = path.join(ROOT, '.private');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `startup-api-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.response`);
  fs.writeFileSync(file, body, { flag: 'wx', mode: 0o600 });
  return file;
}

module.exports = { loadEnvProfile, loadJsonProfile, loadQuery, buildGetRequest, fetchGet, buildPostRequest, fetchPost, savePrivateResponse };
