#!/usr/bin/env node
'use strict';

const net = require('node:net');
const { randomInt, randomUUID } = require('node:crypto');
const { parseArgs } = require('node:util');
const { Reader, Writer } = require('protobufjs/minimal');

const DEFAULT_REST_BASE = 'https://a1-sgp-ga.easemob.com';
const MAX_FRAME_SIZE = 1024 * 1024;

function metadataPlan(to, firstContact = false) {
  if (typeof to !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(to)) throw Error('Invalid recipient IM ID');
  return [
    ...(firstContact ? [{endpoint: 'user/accost_count', payload: {targetId: to}}] : []),
    {endpoint: 'user/conversation', payload: {conversation_id: to, conversation_type: 0}},
    {endpoint: 'user/conversation/source', payload: {source: 'other', target_user_id: to}},
  ];
}

async function syncLitmatchMetadata({ profile, to, firstContact = false, onEvent = () => {} }) {
  const { buildPostRequest, fetchPost } = require('./common');
  const results = [];

  for (const {endpoint, payload} of metadataPlan(to, firstContact)) {
    onEvent({event: 'metadata_request', endpoint});
    let summary;
    try { ({summary} = await fetchPost(buildPostRequest(endpoint, profile, payload))); }
    catch (_) {
      throw Error(`Metadata outcome unknown at ${endpoint}; no automatic retry. Do not resend chat`);
    }
    const accepted = summary.http_status >= 200 && summary.http_status < 300 &&
      summary.success === true && summary.result === 0;
    results.push({...summary, accepted});
    onEvent({event: 'metadata_response', ...summary, accepted});
    if (!accepted) throw Error(`Metadata rejected at ${endpoint} (HTTP ${summary.http_status}, result=${summary.result}); do not resend chat`);
  }
  return results;
}

function loadTemplate(env = process.env) {
  const encoded = env.HX_LOGIN_TEMPLATE_B64;
  if (!encoded || encoded.length > 65536 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw Error('Missing or invalid HX_LOGIN_TEMPLATE_B64 in .env');
  }
  const payload = Buffer.from(encoded, 'base64');
  if (payload.toString('base64') !== encoded) throw Error('Non-canonical template base64');
  const outer = readFields(payload);
  if (String(getField(outer, 8)) !== '3') throw Error('Template is not a login frame');
  const identity = readFields(bytesField(outer, 2));
  const host = env.HX_IM_HOST;
  const port = Number(env.HX_IM_PORT || 6717);
  if (!host || (!net.isIP(host) && !/^[a-zA-Z0-9.-]+$/.test(host))) throw Error('Invalid HX_IM_HOST');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid HX_IM_PORT');
  const template = {
    host, port, payload,
    appKey: bytesField(identity, 1).toString('utf8'),
    username: bytesField(identity, 2).toString('utf8'),
  };
  if (env.HX_USERNAME && env.HX_USERNAME !== template.username) {
    throw Error('HX_USERNAME does not match the account-specific handshake template');
  }
  return template;
}

function readFields(buffer) {
  const reader = Reader.create(buffer);
  const fields = [];
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const number = tag >>> 3;
    const wire = tag & 7;
    if (!number) throw Error('Invalid protobuf field number');
    let value;
    switch (wire) {
      case 0: value = reader.uint64(); break;
      case 1: value = reader.fixed64(); break;
      case 2: value = Buffer.from(reader.bytes()); break;
      case 5: value = reader.fixed32(); break;
      default: throw Error(`Unsupported protobuf wire type ${wire}`);
    }
    fields.push({ number, wire, value });
  }
  return fields;
}

function writeFields(fields) {
  const writer = Writer.create();
  for (const { number, wire, value } of fields) {
    writer.uint32((number << 3) | wire);
    switch (wire) {
      case 0: writer.uint64(value); break;
      case 1: writer.fixed64(value); break;
      case 2: writer.bytes(value); break;
      case 5: writer.fixed32(value); break;
      default: throw Error(`Unsupported protobuf wire type ${wire}`);
    }
  }
  return Buffer.from(writer.finish());
}

function getField(fields, number) {
  return fields.find(field => field.number === number)?.value;
}

function bytesField(fields, number) {
  const value = getField(fields, number);
  if (!Buffer.isBuffer(value)) throw Error(`Missing bytes field ${number}`);
  return value;
}

function replaceBytes(fields, number, value) {
  const field = fields.find(item => item.number === number && item.wire === 2);
  if (!field) throw Error(`Missing bytes field ${number}`);
  field.value = value;
}

function frame(payload) {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}

function buildLoginFrame(template, accessToken) {
  if (typeof accessToken !== 'string' || !accessToken) throw Error('A Hyphenate access token is required');
  const outer = readFields(template.payload);
  const body = readFields(bytesField(outer, 9));
  const auth = JSON.parse(bytesField(body, 18).toString('utf8'));
  auth.token = accessToken;
  replaceBytes(body, 18, Buffer.from(JSON.stringify(auth)));
  replaceBytes(outer, 9, writeFields(body));
  return frame(writeFields(outer));
}

function readResponse(payload, step) {
  const outer = readFields(payload);
  const body = readFields(bytesField(outer, 9));
  const status = readFields(bytesField(body, step === 'login' ? 8 : 1));
  return {
    type: String(getField(outer, 8)),
    code: String(getField(status, 1)),
  };
}

const FOLLOWUP_FRAME = Buffer.from('00000008080040014a005800', 'hex');

function buildTextMessage({ from, to, text }) {
  for (const id of [from, to]) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw Error('Invalid IM username');
  }
  if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 4096 || text.includes('\0')) {
    throw Error('Message text must be nonempty and at most 4096 UTF-8 bytes');
  }
  const localId = (BigInt(Date.now()) * 10000n + BigInt(randomInt(10000))).toString();
  const markId = randomUUID();
  const uint = (number, value) => ({ number, wire: 0, value: String(value) });
  const bytes = (number, value) => ({ number, wire: 2, value: Buffer.isBuffer(value) ? value : Buffer.from(value) });
  const jid = user => writeFields([bytes(2, user)]);
  const body = writeFields([
    uint(1, 1), bytes(2, jid(from)), bytes(3, jid(to)),
    bytes(4, writeFields([uint(1, 0), bytes(2, text)])),
    bytes(5, writeFields([bytes(1, 'mark_msg_id'), uint(2, 7), bytes(6, markId)])),
  ]);
  const meta = writeFields([uint(1, localId), bytes(3, jid(to)), uint(5, 1), bytes(6, body)]);
  const payload = writeFields([uint(1, 0), uint(8, 0), bytes(9, writeFields([bytes(1, meta)])), uint(11, 0)]);
  return { from, to, localId, markId, frame: frame(payload) };
}

function readSendResponse(payload, localId) {
  const outer = readFields(payload);
  if (String(getField(outer, 8)) !== '0') return null;
  const body = readFields(bytesField(outer, 9));
  if (String(getField(body, 2)) !== localId) return null;
  const code = String(getField(readFields(bytesField(body, 1)), 1));
  const serverId = String(getField(body, 3) ?? '');
  if (!/^[0-9]+$/.test(code) || (code === '0' && !/^[1-9][0-9]*$/.test(serverId))) {
    throw Error('Incomplete send acknowledgement');
  }
  return { code, localId, serverId, accepted: code === '0' && /^[1-9][0-9]*$/.test(serverId) };
}

async function requestUserToken({ appKey, username, password, restBase = DEFAULT_REST_BASE }) {
  const parts = appKey.split('#');
  if (parts.length !== 2 || parts.some(part => !/^[a-zA-Z0-9_-]+$/.test(part))) throw Error('Invalid app key');
  if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
    throw Error('A Hyphenate username and hxPwd are required to obtain a token');
  }
  const base = new URL(restBase);
  if (base.protocol !== 'https:' || base.username || base.password ||
      !(base.hostname === 'easemob.com' || base.hostname.endsWith('.easemob.com'))) {
    throw Error('REST base must be an HTTPS Easemob host');
  }
  const url = new URL(`/${parts.join('/')}/token`, base);
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(12000),
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ grant_type: 'password', username, password }),
  });
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_FRAME_SIZE) throw Error('Token response exceeds 1 MiB');
    chunks.push(chunk);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (_) { throw Error(`Token endpoint returned invalid JSON (HTTP ${response.status})`); }
  if (!response.ok || typeof data.access_token !== 'string' || !data.access_token) {
    throw Error(`Token request failed (HTTP ${response.status})`);
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? null };
}

function connectAndCheck({ template, accessToken, timeoutMs = 8000, message, onEvent = () => {} }) {
  const loginFrame = buildLoginFrame(template, accessToken);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw Error('Invalid timeout');
  if (message && (message.from !== template.username || !Buffer.isBuffer(message.frame) ||
      !/^[1-9][0-9]*$/.test(message.localId))) throw Error('Invalid message or sender does not match login');

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let incoming = Buffer.alloc(0);
    let step = 'login';
    let settled = false;
    let sendAttempted = false;
    let sendResult = null;
    const responses = [];

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) {
        socket.destroy();
        if (sendAttempted && !sendResult) error.message += '; send outcome unknown, do not retry blindly';
        reject(error);
      } else {
        socket.end();

        socket.destroySoon();
        resolve({ connected: true, peer: template.host, responses, sendResult });
      }
    }

    let deadline = setTimeout(() => finish(Error('Handshake timed out')), timeoutMs);
    socket.once('error', error => finish(Error(`TCP connection failed: ${error.code || 'socket error'}`)));
    socket.once('close', () => finish(Error('Socket closed before operation completed')));
    socket.once('connect', () => {
      try {
        onEvent({ event: 'tcp_connected', peer: template.host, port: template.port });
        socket.write(loginFrame);
      } catch (error) { finish(error); }
    });

    socket.on('data', chunk => {
      if (settled) return;
      try {
        incoming = Buffer.concat([incoming, chunk]);
        while (incoming.length >= 4) {
          const length = incoming.readUInt32BE(0);
          if (!length || length > MAX_FRAME_SIZE) throw Error('Invalid response frame length');
          if (incoming.length < length + 4) return;
          const payload = incoming.subarray(4, length + 4);
          incoming = incoming.subarray(length + 4);
          if (step === 'send') {
            const response = readSendResponse(payload, message.localId);
            if (!response) continue;
            sendResult = response;
            onEvent({ event: 'send_response', ...response, deliveryConfirmed: false });
            if (!response.accepted) throw Error(`Message not accepted (code=${response.code})`);
            finish();
            return;
          }
          const response = readResponse(payload, step);
          const expectedType = step === 'login' ? '3' : '1';
          const accepted = response.type === expectedType && response.code === '0';
          responses.push({ step, ...response, accepted });
          onEvent({ event: `${step}_response`, ...response, accepted });
          if (!accepted) throw Error(`Unexpected ${step} response (type=${response.type}, code=${response.code})`);

          if (step === 'login') {
            step = 'followup';
            socket.write(FOLLOWUP_FRAME);
          } else if (message) {
            step = 'send';
            onEvent({ event: 'send_attempt', to: message.to, localId: message.localId, markId: message.markId });
            sendAttempted = true;
            socket.write(message.frame);
            clearTimeout(deadline);
            deadline = setTimeout(() => finish(Error('Send acknowledgement timed out')), timeoutMs);
          } else {
            finish();
            return;
          }
        }
      } catch (error) { finish(error); }
    });
    socket.connect({ host: template.host, port: template.port });
  });
}

async function main() {
  const { values: options } = parseArgs({ options: {
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
    to: { type: 'string' },
    text: { type: 'string' },
    litmatch: { type: 'boolean', default: false },
    'sync-only': { type: 'boolean', default: false },
    'first-contact': { type: 'boolean', default: false },
  } });
  if (options.help) {
    console.log([
      'Usage: node --env-file=scripts/.env scripts/hyphenate-connect.js [--dry-run] [--to IM_ID --text TEXT]',
      'TCP modes require HX_LOGIN_TEMPLATE_B64, HX_IM_HOST, HX_PASSWORD or HX_ACCESS_TOKEN.',
      'Optional: HX_USERNAME (must match template), HX_IM_PORT, HX_REST_BASE.',
      'Password is the IM hxPwd, not a Google password. Token overrides password.',
      'Without --to/--text: checks login + followup, then closes; no chat sent.',
      'With --to AND --text: sends exactly one experimental plain TXT, waits for matched server ACK, then closes.',
      'Add --litmatch: after TCP acceptance, POST conversation + conversation/source using LIT_* credentials.',
      'LIT_SID and LIT_UUID must come from the same account/session as the HX_* credentials.',
      '--sync-only --to IM_ID: only these HTTPS writes; no token request, TCP login or chat send.',
      '--first-contact: also POST accost_count; only for a genuine new contact, never blindly retry it.',
      'No retries. ACK means server acceptance, not delivery/read. Risk checks, push metadata and phone cache sync are not implemented.',
      'The template remains account-specific; login may disconnect the phone app.',
    ].join('\n'));
    return;
  }

  const syncOnly = options['sync-only'];
  const metadata = options.litmatch || syncOnly;
  if (syncOnly) {
    if (!options.to || options.text !== undefined) throw Error('--sync-only requires --to and forbids --text');
  } else if ((options.to !== undefined) !== (options.text !== undefined)) throw Error('Supply both --to and --text');
  if (metadata && !options.to) throw Error('Metadata mode requires --to');
  if (options['first-contact'] && !metadata) throw Error('--first-contact requires --litmatch or --sync-only');
  let profile;
  const plan = metadata ? metadataPlan(options.to, options['first-contact']) : [];
  if (metadata) {
    const {loadEnvProfile, buildPostRequest} = require('./common');
    profile = loadEnvProfile();

    for (const item of plan) buildPostRequest(item.endpoint, profile, item.payload);
  }
  const log = event => console.log(JSON.stringify(event));
  if (syncOnly) {
    if (options['dry-run']) { log({metadataPlan: plan, chatSent: false}); return; }
    await syncLitmatchMetadata({profile, to: options.to, firstContact: options['first-contact'], onEvent: log});
    log({event: 'metadata_complete', chatSent: false});
    return;
  }
  const template = loadTemplate();
  const message = options.to !== undefined ? buildTextMessage({from: template.username, to: options.to, text: options.text}) : undefined;
  let accessToken = process.env.HX_ACCESS_TOKEN;
  const password = process.env.HX_PASSWORD;
  const authSource = accessToken ? 'supplied_token' : password ? 'username_password' : 'missing';
  if (options['dry-run']) {
    console.log(JSON.stringify({appKey: template.appKey, username: template.username,
      host: template.host, port: template.port, authSource, templateSource: 'env',
      ...(metadata ? {metadataPlan: plan} : {}),
      ...(message ? {sendPreview: {to: message.to, text: options.text, bytes: message.frame.length}, chatSent: false} : {})}, null, 2));
    return;
  }
  if (authSource === 'missing') throw Error('Set HX_PASSWORD or HX_ACCESS_TOKEN');

  if (!accessToken) {
    const token = await requestUserToken({appKey: template.appKey, username: template.username,
      password, restBase: process.env.HX_REST_BASE || DEFAULT_REST_BASE});
    accessToken = token.accessToken;
    console.log(JSON.stringify({event: 'token_obtained', expiresIn: token.expiresIn}));
  }

  const result = await connectAndCheck({template, accessToken, message, onEvent: log});
  console.log(JSON.stringify(message
    ? {event: 'send_complete', serverAccepted: result.sendResult.accepted, serverId: result.sendResult.serverId, deliveryConfirmed: false}
    : {event: 'handshake_complete', chatSent: false}));
  if (metadata) {
    try {
      await syncLitmatchMetadata({profile, to: options.to, firstContact: options['first-contact'], onEvent: log});
    } catch (error) {
      log({event: 'workflow_partial', serverAccepted: true, serverId: result.sendResult.serverId,
        metadataComplete: false, retryChat: false});
      throw error;
    }
    log({event: 'workflow_complete', serverAccepted: true, serverId: result.sendResult.serverId,
      metadataComplete: true, phoneSyncConfirmed: false, deliveryConfirmed: false});
  }
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = {loadTemplate, buildLoginFrame, requestUserToken, connectAndCheck, buildTextMessage, readSendResponse, metadataPlan, syncLitmatchMetadata};
