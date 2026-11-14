import protobuf from 'protobufjs';
import { MAX_RESPONSE_BYTES } from '../core/constants.ts';
import { loadEnv, type Env } from '../core/env.ts';
import { readLimited, safeFetch } from '../core/http.ts';
import { CURSOR_PATTERN, decodeCanonicalBase64, easemobOrigin, isAppKey, isId, isLitatomHttps, parseIntInRange } from '../core/validate.ts';
import { fetchGet, isLitAccepted, type ResponseSummary } from '../lit/client.ts';
import { loadEnvProfile, type LitProfile } from '../lit/profile.ts';
import { buildGetRequest } from '../lit/request.ts';
import { ensureAccessToken, type HxAuth } from './token.ts';
import { loadTemplate } from './template.ts';

const schema = protobuf.parse(`syntax = "proto3";
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
const Meta = schema.lookupType('Meta');
const MessageBody = schema.lookupType('MessageBody');

export type ConversationType = 0 | 1;
export interface Conversation { conversation_id: string; conversation_type: number; [key: string]: unknown }

export interface HistoryConfig extends HxAuth {
  restBase: string;
}

export interface HistoryMessage {
  id: string;
  from: string | null;
  to: string | null;
  timestamp: string | null;
  namespace: number;
  messageType: number | null;
  contents: Record<string, unknown>[];
  attributes: unknown[];
  envelopeAttributes: unknown[];
  rawBase64: string;
}

export interface HistoryQuery {
  to: string;
  type?: number;
  limit?: number;
  cursor?: string;
}

export interface HistoryPage {
  httpStatus: number;
  cursor: string | null;
  isLast: boolean;
  messages: HistoryMessage[];
}

export interface History {
  conversationId: string;
  conversationType: number;
  pagesFetched: number;
  cursor: string | null;
  isLast: boolean;
  messages: HistoryMessage[];
}

export const restOrigin = (value?: string): string => easemobOrigin(value);

export function loadHistoryConfig(env: Env = loadEnv()): HistoryConfig {

  const identity = env.HX_APP_KEY ? { appKey: env.HX_APP_KEY, username: env.HX_USERNAME } : loadTemplate(env);
  if (!isAppKey(identity.appKey) || !isId(identity.username || '')) {
    throw Error('Invalid HX_APP_KEY/HX_USERNAME or template identity');
  }
  if (!env.HX_ACCESS_TOKEN && !env.HX_PASSWORD) throw Error('Set HX_PASSWORD or HX_ACCESS_TOKEN');
  return { appKey: identity.appKey, username: identity.username!, restBase: restOrigin(env.HX_REST_BASE),
    accessToken: env.HX_ACCESS_TOKEN, password: env.HX_PASSWORD };
}

export async function getConversations(profile: LitProfile = loadEnvProfile()): Promise<{ summary: ResponseSummary; conversations: Conversation[] }> {
  const request = buildGetRequest('user/conversations', profile);
  if (!isLitatomHttps(request.url)) throw Error('Conversations require https://www.litatom.com');
  let result;
  try { result = await fetchGet(request); } catch { throw Error('Conversation request failed; no retry'); }
  const { summary, body } = result;
  if (!isLitAccepted(summary)) {
    throw Error(`Conversations rejected (HTTP ${summary.http_status}, result=${summary.result})`);
  }
  const conversations: unknown = JSON.parse(body.toString('utf8')).data?.conversations;
  if (!Array.isArray(conversations) || conversations.some(c => !c || !isId(c.conversation_id) ||
      !Number.isInteger(c.conversation_type))) throw Error('Unexpected conversation response schema');
  return { summary, conversations: conversations as Conversation[] };
}

export function decodeMessage(encoded: unknown): HistoryMessage {
  const bytes = decodeCanonicalBase64(encoded, MAX_RESPONSE_BYTES, {
    invalid: 'Invalid history message encoding', nonCanonical: 'Non-canonical history base64',
  });

  let meta: Record<string, any>;
  let body: Record<string, any> | null = null;
  try {
    const decoded = Meta.decode(bytes) as unknown as { payload: Uint8Array };
    meta = Meta.toObject(decoded as never, { longs: String, bytes: String });
    if ((meta.ns ?? 0) === 1) body = MessageBody.toObject(MessageBody.decode(decoded.payload), { longs: String });
  } catch { throw Error('Invalid history message protobuf'); }
  if (!/^[1-9][0-9]*$/.test(meta.id || '')) throw Error('History message missing server ID');

  return { id: meta.id, from: body?.from?.name ?? meta.from?.name ?? null,
    to: body?.to?.name ?? meta.to?.name ?? null, timestamp: meta.timestamp ?? null,
    namespace: meta.ns ?? 0, messageType: body?.type ?? null,
    contents: (body?.contents ?? []).map((c: Record<string, unknown>) => ({ type: c.type ?? 0, ...c })),
    attributes: body?.ext ?? [], envelopeAttributes: meta.ext ?? [], rawBase64: encoded as string };
}

export function historyRequest(config: Pick<HistoryConfig, 'appKey' | 'username' | 'restBase'>,
  { to, type = 0, limit = 20, cursor = '-1' }: HistoryQuery) {
  if (!isId(to) || (type !== 0 && type !== 1)) throw Error('History requires an IM ID and conversation type 0 or 1');
  limit = parseIntInRange(limit, 1, 50, 'limit');
  if (typeof cursor !== 'string' || !CURSOR_PATTERN.test(cursor)) throw Error('Invalid history cursor');
  if (!isAppKey(config.appKey) || !isId(config.username || '')) throw Error('Invalid history identity');
  const url = new URL(`/${config.appKey.replace('#', '/')}/users/${config.username}/messageroaming`, restOrigin(config.restBase));
  return { url, body: { queue: to + (type === 0 ? '@easemob.com' : '@conference.easemob.com'),
    start: cursor === '-1' ? -1 : cursor, pull_number: limit, is_positive: false,
    msgType: '', end: -1, startTime: null, endTime: null, userId: null } };
}

export async function fetchHistoryPage(config: HistoryConfig, options: HistoryQuery): Promise<HistoryPage> {
  const { url, body } = historyRequest(config, options);
  if (typeof config.accessToken !== 'string' || !config.accessToken) throw Error('Missing Hyphenate user token');
  let response: Response;
  let raw: string;
  try {
    response = await safeFetch(url, { method: 'POST',
      headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body) });
    raw = (await readLimited(response, MAX_RESPONSE_BYTES, 'Response exceeds 2 MiB')).toString('utf8');
  } catch { throw Error('History network/response-size failure; no retry'); }
  if (!response.ok) throw Error(`History rejected (HTTP ${response.status}); no retry`);
  let data: any;
  try { data = JSON.parse(raw).data; } catch { throw Error('Invalid history JSON'); }
  if (!data || !Array.isArray(data.msgs) || typeof data.is_last !== 'boolean' ||
      data.queue !== `${config.appKey}_${body.queue}` ||
      data.user !== `${config.appKey}_${config.username}@easemob.com`) throw Error('Unexpected history response schema or identity');
  let cursor: string | null = null;
  if (!data.is_last) {
    if (typeof data.next_key === 'string' && /^[0-9]{1,30}$/.test(data.next_key)) cursor = data.next_key;
    else if (Number.isSafeInteger(data.next_key) && data.next_key >= 0) cursor = String(data.next_key);
    else throw Error('Missing or unsafe history cursor');
  }
  return { httpStatus: response.status, cursor, isLast: data.is_last,
    messages: data.msgs.map((m: { msg?: unknown } | null) => decodeMessage(m?.msg)) };
}

export async function getHistory(config: HistoryConfig, { to, type = 0, limit = 20, cursor = '-1', pages = 1 }:
  HistoryQuery & { pages?: number }): Promise<History> {
  pages = parseIntInRange(pages, 1, 20, 'pages');
  historyRequest(config, { to, type, limit, cursor });
  const auth: HistoryConfig = { ...config, accessToken: await ensureAccessToken(config) };
  const messages: HistoryMessage[] = [];
  const ids = new Set<string>();
  const cursors = new Set([cursor]);
  let result: HistoryPage;
  let pagesFetched = 0;
  do {
    result = await fetchHistoryPage(auth, { to, type, limit, cursor });
    pagesFetched++;
    for (const m of result.messages) if (!ids.has(m.id)) { ids.add(m.id); messages.push(m); }
    if (result.isLast) break;
    if (cursors.has(result.cursor!)) throw Error('Server repeated history cursor; stopped');
    cursor = result.cursor!;
    cursors.add(cursor);
  } while (pagesFetched < pages);
  return { conversationId: to, conversationType: type, pagesFetched, cursor: result.cursor, isLast: result.isLast, messages };
}
