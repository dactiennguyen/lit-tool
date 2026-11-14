#!/usr/bin/env node
'use strict';

const { parseArgs } = require('node:util');
const { parse } = require('protobufjs');
const { loadEnvProfile, buildGetRequest, fetchGet } = require('./common');
const { loadTemplate, requestUserToken } = require('./hyphenate-connect');

const schema = parse(`syntax = "proto3";
message JID { string appKey=1; string name=2; string domain=3; string clientResource=4; }
message KeyValue { string key=1; int32 type=2; int64 varintValue=3;
  float floatValue=4; double doubleValue=5; string stringValue=6; }
message Size { double width=1; double height=2; }
message Content { int32 type=1; string text=2; double latitude=3; double longitude=4;
  string address=5; string displayName=6; string remotePath=7; string secretKey=8;
  int32 fileLength=9; string action=10; repeated KeyValue params=11; int32 duration=12;
  Size size=13; string thumbnailRemotePath=14; string thumbnailSecretKey=15;
  string thumbnailDisplayName=16; int32 thumbnailFileLength=17; Size thumbnailSize=18;
  string customEvent=19; repeated KeyValue customExts=20; string buildingName=21;
  int32 subType=22; string title=23; string summary=24; int32 combineLevel=25; int32 imageType=26; }
message MessageBody { int32 type=1; JID from=2; JID to=3; repeated Content contents=4;
  repeated KeyValue ext=5; uint64 ackMessageId=6; string ackContent=8; string meta=9;
  uint64 editMessageId=11; int32 editScope=12; }
message Meta { uint64 id=1; JID from=2; JID to=3; uint64 timestamp=4; int32 ns=5;
  bytes payload=6; int32 routetype=7; repeated KeyValue ext=8; bytes meta=9;
  repeated string directedUsers=10; string env=13; }
`).root;
const Meta = schema.lookupType('Meta'), MessageBody = schema.lookupType('MessageBody');
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_RESPONSE = 2 * 1024 * 1024;

function integer(value, min, max, name) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
    throw Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return Number(value);
}

function restOrigin(value = 'https://a1-sgp-ga.easemob.com') {
  let u;
  try { u = new URL(value); } catch { throw Error('Invalid HX_REST_BASE'); }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') ||
      !(u.hostname === 'easemob.com' || u.hostname.endsWith('.easemob.com'))) {
    throw Error('HX_REST_BASE must be an HTTPS Easemob host on port 443');
  }
  return u.origin;
}

function loadHistoryConfig(env = process.env) {

  const identity = env.HX_APP_KEY ? { appKey: env.HX_APP_KEY, username: env.HX_USERNAME } : loadTemplate(env);
  if (!/^[A-Za-z0-9_-]+#[A-Za-z0-9_-]+$/.test(identity.appKey) || !ID.test(identity.username || '')) {
    throw Error('Invalid HX_APP_KEY/HX_USERNAME or template identity');
  }
  if (!env.HX_ACCESS_TOKEN && !env.HX_PASSWORD) throw Error('Set HX_PASSWORD or HX_ACCESS_TOKEN');
  return { appKey: identity.appKey, username: identity.username, restBase: restOrigin(env.HX_REST_BASE),
    accessToken: env.HX_ACCESS_TOKEN, password: env.HX_PASSWORD };
}

async function getConversations(profile = loadEnvProfile()) {
  const request = buildGetRequest('user/conversations', profile);
  if (request.url.origin !== 'https://www.litatom.com') throw Error('Conversations require https://www.litatom.com');
  let result;
  try { result = await fetchGet(request); } catch { throw Error('Conversation request failed; no retry'); }
  const { summary, body } = result;
  if (summary.http_status < 200 || summary.http_status >= 300 || summary.success !== true || summary.result !== 0) {
    throw Error(`Conversations rejected (HTTP ${summary.http_status}, result=${summary.result})`);
  }
  const conversations = JSON.parse(body.toString('utf8')).data?.conversations;
  if (!Array.isArray(conversations) || conversations.some(c => !c || typeof c.conversation_id !== 'string' || !ID.test(c.conversation_id) ||
      !Number.isInteger(c.conversation_type))) throw Error('Unexpected conversation response schema');
  return { summary, conversations };
}

function decodeMessage(encoded) {
  if (typeof encoded !== 'string' || encoded.length > MAX_RESPONSE || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw Error('Invalid history message encoding');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw Error('Non-canonical history base64');
  let meta, body = null;
  try {
    const decoded = Meta.decode(bytes);
    meta = Meta.toObject(decoded, { longs: String, bytes: String });
    if ((meta.ns ?? 0) === 1) body = MessageBody.toObject(MessageBody.decode(decoded.payload), { longs: String });
  } catch { throw Error('Invalid history message protobuf'); }
  if (!/^[1-9][0-9]*$/.test(meta.id || '')) throw Error('History message missing server ID');

  return { id: meta.id, from: body?.from?.name ?? meta.from?.name ?? null,
    to: body?.to?.name ?? meta.to?.name ?? null, timestamp: meta.timestamp ?? null,
    namespace: meta.ns ?? 0, messageType: body?.type ?? null,
    contents: (body?.contents ?? []).map(c => ({type: c.type ?? 0, ...c})), attributes: body?.ext ?? [],
    envelopeAttributes: meta.ext ?? [], rawBase64: encoded };
}

function historyRequest(config, { to, type = 0, limit = 20, cursor = '-1' }) {
  if (typeof to !== 'string' || !ID.test(to) || ![0, 1].includes(type)) throw Error('History requires an IM ID and conversation type 0 or 1');
  limit = integer(limit, 1, 50, 'limit');
  if (typeof cursor !== 'string' || !/^(?:-1|[0-9]{1,30})$/.test(cursor)) throw Error('Invalid history cursor');
  if (!/^[A-Za-z0-9_-]+#[A-Za-z0-9_-]+$/.test(config.appKey) || !ID.test(config.username || '')) throw Error('Invalid history identity');
  const url = new URL(`/${config.appKey.replace('#', '/')}/users/${config.username}/messageroaming`, restOrigin(config.restBase));
  return { url, body: { queue: to + (type === 0 ? '@easemob.com' : '@conference.easemob.com'),
    start: cursor === '-1' ? -1 : cursor, pull_number: limit, is_positive: false,
    msgType: '', end: -1, startTime: null, endTime: null, userId: null } };
}

async function fetchHistoryPage(config, options) {
  const { url, body } = historyRequest(config, options);
  if (typeof config.accessToken !== 'string' || !config.accessToken) throw Error('Missing Hyphenate user token');
  let response, raw;
  try {
    response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body) });
    const chunks = []; let size = 0;
    if (response.body) for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_RESPONSE) throw Error('Response exceeds 2 MiB');
      chunks.push(chunk);
    }
    raw = Buffer.concat(chunks).toString('utf8');
  } catch { throw Error('History network/response-size failure; no retry'); }
  if (!response.ok) throw Error(`History rejected (HTTP ${response.status}); no retry`);
  let data;
  try { data = JSON.parse(raw).data; } catch { throw Error('Invalid history JSON'); }
  if (!data || !Array.isArray(data.msgs) || typeof data.is_last !== 'boolean' ||
      data.queue !== `${config.appKey}_${body.queue}` ||
      data.user !== `${config.appKey}_${config.username}@easemob.com`) throw Error('Unexpected history response schema or identity');
  let cursor = null;
  if (!data.is_last) {
    if (typeof data.next_key === 'string' && /^[0-9]{1,30}$/.test(data.next_key)) cursor = data.next_key;
    else if (Number.isSafeInteger(data.next_key) && data.next_key >= 0) cursor = String(data.next_key);
    else throw Error('Missing or unsafe history cursor');
  }
  return { httpStatus: response.status, cursor, isLast: data.is_last, messages: data.msgs.map(m => decodeMessage(m?.msg)) };
}

async function getHistory(config, { to, type = 0, limit = 20, cursor = '-1', pages = 1 }) {
  pages = integer(pages, 1, 20, 'pages');
  historyRequest(config, {to, type, limit, cursor});
  const auth = { ...config };
  if (!auth.accessToken) {
    try { auth.accessToken = (await requestUserToken(auth)).accessToken; }
    catch { throw Error('Could not obtain Hyphenate user token'); }
  }
  const messages = [], ids = new Set(), cursors = new Set([cursor]);
  let result, pagesFetched = 0;
  do {
    result = await fetchHistoryPage(auth, {to, type, limit, cursor});
    pagesFetched++;
    for (const m of result.messages) if (!ids.has(m.id)) { ids.add(m.id); messages.push(m); }
    if (result.isLast) break;
    if (cursors.has(result.cursor)) throw Error('Server repeated history cursor; stopped');
    cursor = result.cursor; cursors.add(cursor);
  } while (pagesFetched < pages);
  return { conversationId: to, conversationType: type, pagesFetched,
    cursor: result.cursor, isLast: result.isLast, messages };
}

async function main() {
  const { values: args } = parseArgs({ options: {
    help: {type:'boolean',short:'h'}, to: {type:'string'},
    'with-messages': {type:'boolean',default:false}, 'dry-run': {type:'boolean',default:false},
    limit: {type:'string',default:'20'}, pages: {type:'string',default:'1'},
    cursor: {type:'string'}, 'max-conversations': {type:'string',default:'20'},
  }});
  if (args.help) {
    console.log('Usage: node --env-file=scripts/.env scripts/conversations.js [--to IM_ID | --with-messages]\n' +
      '--limit 20 (1..50), --pages 1 (1..20), --cursor ID (only with --to), --max-conversations 20 (1..100).\n' +
      'Default: Litmatch conversation list only. --to must be in that list. --with-messages fetches a bounded selection.\n' +
      '--dry-run validates config, no network. Reads only; never sends messages/read ACKs or updates phone cache.\n' +
      'Requires LIT_*; history also requires matching HX_* credentials. JSON stdout contains private message data.');
    return;
  }
  if (args.to !== undefined && !ID.test(args.to)) throw Error('Invalid --to IM ID');
  if (args.to && args['with-messages']) throw Error('Use --to OR --with-messages');
  if (args.cursor !== undefined && !args.to) throw Error('--cursor requires --to');
  const limit = integer(args.limit,1,50,'limit'), pages = integer(args.pages,1,20,'pages');
  const max = integer(args['max-conversations'],1,100,'max-conversations');
  const cursor = args.cursor ?? '-1';
  if (!/^(?:-1|[0-9]{1,30})$/.test(cursor)) throw Error('Invalid --cursor');
  const wantsHistory = !!args.to || args['with-messages'];
  const profile = loadEnvProfile(), config = wantsHistory ? loadHistoryConfig() : null;
  if (args['dry-run']) {
    console.log(JSON.stringify({dryRun:true,conversations:true,history:wantsHistory,to:args.to ?? null,limit,pages,maxConversations:max}));
    return;
  }
  const { summary, conversations } = await getConversations(profile);
  const output = { summary, conversations };
  if (wantsHistory) {
    const selected = args.to ? conversations.filter(c => c.conversation_id === args.to) : conversations.slice(0,max);
    if (args.to && !selected.length) throw Error('--to was not found in this Litmatch account conversation list');
    if (selected.some(c => ![0,1].includes(c.conversation_type))) throw Error('Unsupported conversation type in selected list');
    output.history = [];
    output.conversationsSkipped = conversations.length - selected.length;

    if (selected.length && !config.accessToken) {
      try { config.accessToken = (await requestUserToken(config)).accessToken; }
      catch { throw Error('Could not obtain Hyphenate user token'); }
    }
    for (const c of selected) output.history.push(await getHistory(config,
      {to:c.conversation_id,type:c.conversation_type,limit,pages,cursor}));
  }
  console.log(JSON.stringify(output,null,2));
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode=1; });
module.exports = {loadHistoryConfig,getConversations,decodeMessage,historyRequest,fetchHistoryPage,getHistory};
