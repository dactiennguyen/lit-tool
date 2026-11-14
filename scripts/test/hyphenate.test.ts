import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  assertSame, followupResponse, HX_APP_KEY, HX_ENV, HX_USERNAME, legacy, litResponse, loginResponse, outcome, outcomeAsync,
  PROFILE, sendAckPayload, templateB64, withFetch, withImServer, type RecordedRequest,
} from './helpers.ts';
import { frame, bytesValue, uintField, writeFields } from '../src/hyphenate/fields.ts';
import { buildLoginFrame, loadTemplate } from '../src/hyphenate/template.ts';
import { buildTextMessage, readSendResponse } from '../src/hyphenate/message.ts';
import { connectAndCheck, type HxEvent } from '../src/hyphenate/connection.ts';
import { metadataPlan, syncLitmatchMetadata } from '../src/hyphenate/metadata.ts';
import { requestUserToken } from '../src/hyphenate/token.ts';
import {
  decodeMessage, fetchHistoryPage, getConversations, getHistory, historyRequest, loadHistoryConfig,
} from '../src/hyphenate/history.ts';

const old = { hx: legacy('hyphenate-connect'), conv: legacy('conversations') };

describe('login template', () => {
  const envs: Record<string, Record<string, string | undefined>> = {
    ok: { ...HX_ENV },
    customPort: { ...HX_ENV, HX_IM_PORT: '7000', HX_IM_HOST: 'im.example.com' },
    matchingUser: { ...HX_ENV, HX_USERNAME },
    otherUser: { ...HX_ENV, HX_USERNAME: 'love_999' },
    missing: { ...HX_ENV, HX_LOGIN_TEMPLATE_B64: undefined },
    notBase64: { ...HX_ENV, HX_LOGIN_TEMPLATE_B64: '###' },
    nonCanonical: { ...HX_ENV, HX_LOGIN_TEMPLATE_B64: 'QR==' },
    badHost: { ...HX_ENV, HX_IM_HOST: 'bad host' },
    badPort: { ...HX_ENV, HX_IM_PORT: '70000' },
    notLogin: { ...HX_ENV, HX_LOGIN_TEMPLATE_B64: writeFields([uintField(8, 1)]).toString('base64') },
  };
  for (const [name, env] of Object.entries(envs)) {
    test(`loadTemplate parity: ${name}`, () => {
      assertSame(outcome(() => loadTemplate(env)), outcome(() => old.hx.loadTemplate(env)));
    });
  }

  test('buildLoginFrame parity (unknown fields + uint64 preserved)', () => {
    const template = loadTemplate(HX_ENV);
    for (const token of ['tok', 'YWMt-long.token_with/symbols+=', '']) {
      assertSame(outcome(() => buildLoginFrame(template, token)), outcome(() => old.hx.buildLoginFrame(template, token)));
    }
    const login = buildLoginFrame(template, 'tok');
    assert.ok(login.includes(Buffer.from('"token":"tok"')));
    assert.ok(login.includes(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01])), 'uint64 max kept');
  });
});

describe('text message + ack', () => {
  const inputs = [
    { from: HX_USERNAME, to: 'love_200', text: 'Xin chào 👋' },
    { from: HX_USERNAME, to: 'love_200', text: '   ' },
    { from: HX_USERNAME, to: 'bad id', text: 'x' },
    { from: HX_USERNAME, to: 'love_200', text: 'a\0b' },
    { from: HX_USERNAME, to: 'love_200', text: 'x'.repeat(4097) },
  ];
  for (const input of inputs) {
    test(`buildTextMessage parity: ${JSON.stringify(input).slice(0, 60)}`, () => {
      const theirs = outcome(() => old.hx.buildTextMessage(input));
      if (!theirs.ok) return assertSame(outcome(() => buildTextMessage(input)), theirs);
      const t = theirs.value as ReturnType<typeof buildTextMessage>;
      assert.deepStrictEqual(buildTextMessage({ ...input, localId: t.localId, markId: t.markId }), t);
    });
  }

  test('default localId/markId shape matches legacy', () => {
    const mine = buildTextMessage(inputs[0]!);
    const theirs = old.hx.buildTextMessage(inputs[0]!);
    assert.equal(mine.localId.length, theirs.localId.length);
    assert.equal(mine.frame.length, theirs.frame.length);
    assert.match(mine.markId, /^[0-9a-f-]{36}$/);
  });

  test('readSendResponse parity', () => {
    const id = '17000000000001234';
    const payloads = [
      sendAckPayload(id), sendAckPayload(id, 503), sendAckPayload('999'), sendAckPayload(id, 0, ''),
      writeFields([uintField(8, 3), bytesValue(9, Buffer.alloc(0))]),
    ];
    for (const p of payloads) assertSame(outcome(() => readSendResponse(p, id)), outcome(() => old.hx.readSendResponse(p, id)));
  });

  test('metadataPlan parity', () => {
    for (const [to, first] of [['abc', false], ['abc', true], ['a b', false]] as const) {
      assertSame(outcome(() => metadataPlan(to, first)), outcome(() => old.hx.metadataPlan(to, first)));
    }
  });
});

describe('TCP handshake against a fake IM server', () => {
  const message = old.hx.buildTextMessage({ from: HX_USERNAME, to: 'love_200', text: 'hello' });
  const scenarios: [string, (Buffer | null)[], boolean, number?][] = [
    ['login + followup', [loginResponse(), followupResponse()], false],
    ['login rejected', [loginResponse(401)], false],
    ['followup rejected', [loginResponse(), followupResponse(9)], false],
    ['send accepted', [loginResponse(), followupResponse(), Buffer.concat([
      frame(sendAckPayload('1')), frame(sendAckPayload(message.localId))])], true],
    ['send refused', [loginResponse(), followupResponse(), frame(sendAckPayload(message.localId, 508))], true],
    ['send ack timeout', [loginResponse(), followupResponse(), null], true, 300],
    ['handshake timeout', [null], false, 300],
    ['bad frame length', [Buffer.from([0, 0, 0, 0])], false],
  ];
  for (const [name, replies, withMessage, timeoutMs] of scenarios) {
    test(`connectAndCheck parity: ${name}`, async () => {
      const run = async (impl: typeof connectAndCheck) => withImServer(replies, async port => {
        const events: HxEvent[] = [];
        const template = { ...loadTemplate(HX_ENV), port };
        const result = await outcomeAsync(() => impl({ template, accessToken: 'tok', message: withMessage ? message : undefined,
          ...(timeoutMs ? { timeoutMs } : {}), onEvent: e => events.push(e) }));
        return { result, events: events.map(e => e.event === 'tcp_connected' ? { ...e, port: 'x' } : e) };
      });
      const mine = await run(connectAndCheck);
      const theirs = await run(old.hx.connectAndCheck);
      assert.deepStrictEqual(mine.result, theirs.result);
      assert.deepStrictEqual(mine.received, theirs.received, 'client sent identical frames');
    });
  }

  test('connectAndCheck parity: refused connection and argument errors', async () => {
    const template = { ...loadTemplate(HX_ENV), port: 1 };
    assertSame(await outcomeAsync(() => connectAndCheck({ template, accessToken: 'tok' })),
      await outcomeAsync(() => old.hx.connectAndCheck({ template, accessToken: 'tok' })));
    for (const opts of [{ timeoutMs: 0 }, { message: { ...message, from: 'other' } }, { accessToken: '' }]) {
      assertSame(await outcomeAsync(async () => connectAndCheck({ template, accessToken: 'tok', ...opts })),
        await outcomeAsync(async () => old.hx.connectAndCheck({ template, accessToken: 'tok', ...opts })));
    }
  });
});

describe('Easemob REST (fake fetch)', () => {
  const tokenCases: [string, object, (req: RecordedRequest) => Response][] = [
    ['ok', {}, () => Response.json({ access_token: 'T', expires_in: 3600 })],
    ['no expiry', {}, () => Response.json({ access_token: 'T' })],
    ['401', {}, () => Response.json({ error: 'x' }, { status: 401 })],
    ['invalid json', {}, () => new Response('nope', { status: 502 })],
    ['bad app key', { appKey: 'nohash' }, () => Response.json({})],
    ['missing password', { password: '' }, () => Response.json({})],
    ['non-easemob base', { restBase: 'https://example.com' }, () => Response.json({})],
  ];
  for (const [name, overrides, handler] of tokenCases) {
    test(`requestUserToken parity: ${name}`, async () => {
      const args = { appKey: HX_APP_KEY, username: HX_USERNAME, password: 'pw', ...overrides };
      assert.deepStrictEqual(await withFetch(handler, () => requestUserToken(args)), await withFetch(handler, () => old.hx.requestUserToken(args)));
    });
  }

  test('loadHistoryConfig parity', () => {
    const envs = [
      { HX_APP_KEY, HX_USERNAME, HX_PASSWORD: 'pw' },
      { HX_APP_KEY, HX_USERNAME, HX_ACCESS_TOKEN: 't', HX_REST_BASE: 'https://a1.easemob.com' },
      { HX_APP_KEY, HX_USERNAME },
      { HX_APP_KEY: 'bad', HX_USERNAME, HX_PASSWORD: 'pw' },
      { HX_APP_KEY, HX_USERNAME, HX_PASSWORD: 'pw', HX_REST_BASE: 'https://a1.easemob.com:8443' },
      { HX_APP_KEY, HX_USERNAME, HX_PASSWORD: 'pw', HX_REST_BASE: 'not a url' },
      { ...HX_ENV },
      {},
    ];
    for (const env of envs) assertSame(outcome(() => loadHistoryConfig(env)), outcome(() => old.conv.loadHistoryConfig(env)), JSON.stringify(env));
  });

  const config = { appKey: HX_APP_KEY, username: HX_USERNAME, restBase: 'https://a1-sgp-ga.easemob.com', accessToken: 'tok', password: 'pw' };

  test('historyRequest parity', () => {
    const cases = [{ to: 'abc' }, { to: 'g1', type: 1, limit: 50, cursor: '123' }, { to: 'abc', type: 2 }, { to: 'abc', limit: 0 },
      { to: 'abc', cursor: 'x' }, { to: 'a b' }];
    for (const c of cases) assertSame(outcome(() => historyRequest(config, c)), outcome(() => old.conv.historyRequest(config, c)));
  });

  const msg = (id: string, ns = 1, text = 'hi') => {
    const jid = (name: string) => writeFields([bytesValue(1, HX_APP_KEY), bytesValue(2, name)]);
    const body = writeFields([uintField(1, 1), bytesValue(2, jid('love_200')), bytesValue(3, jid(HX_USERNAME)),
      bytesValue(4, writeFields([uintField(1, 0), bytesValue(2, text)])),
      bytesValue(5, writeFields([bytesValue(1, 'k'), uintField(2, 7), bytesValue(6, 'v')]))]);
    return writeFields([uintField(1, id), bytesValue(2, jid('love_200')), uintField(4, '1700000000000'), uintField(5, ns),
      bytesValue(6, body), bytesValue(8, writeFields([bytesValue(1, 'em_push'), uintField(2, 4), bytesValue(6, 'x')]))]).toString('base64');
  };

  test('decodeMessage parity', () => {
    for (const encoded of [msg('1234567890123456789'), msg('5', 0), msg('0'), 'QR==', '', 42, '@@@', Buffer.from([0xff, 0xff]).toString('base64')]) {
      assertSame(outcome(() => decodeMessage(encoded)), outcome(() => old.conv.decodeMessage(encoded)), String(encoded));
    }
  });

  const queue = `${HX_APP_KEY}_abc@easemob.com`;
  const user = `${HX_APP_KEY}_${HX_USERNAME}@easemob.com`;
  const pageCases: [string, (req: RecordedRequest) => Response][] = [
    ['last page', () => Response.json({ data: { msgs: [{ msg: msg('11') }], is_last: true, queue, user } })],
    ['string cursor', () => Response.json({ data: { msgs: [], is_last: false, next_key: '99', queue, user } })],
    ['number cursor', () => Response.json({ data: { msgs: [], is_last: false, next_key: 99, queue, user } })],
    ['missing cursor', () => Response.json({ data: { msgs: [], is_last: false, queue, user } })],
    ['wrong identity', () => Response.json({ data: { msgs: [], is_last: true, queue: 'x', user } })],
    ['http 403', () => Response.json({}, { status: 403 })],
    ['bad json', () => new Response('{')],
    ['bad message', () => Response.json({ data: { msgs: [{ msg: '###' }], is_last: true, queue, user } })],
  ];
  for (const [name, handler] of pageCases) {
    test(`fetchHistoryPage parity: ${name}`, async () => {
      const opts = { to: 'abc' };
      assert.deepStrictEqual(await withFetch(handler, () => fetchHistoryPage(config, opts)), await withFetch(handler, () => old.conv.fetchHistoryPage(config, opts)));
    });
  }

  const pagedHandler = (pages: { ids: string[]; next?: string }[]) => {
    let n = 0;
    const handler = (req: RecordedRequest) => {
      if (req.url.endsWith('/token')) return Response.json({ access_token: 'fresh' });
      const page = pages[Math.min(n++, pages.length - 1)]!;
      return Response.json({ data: { msgs: page.ids.map(id => ({ msg: msg(id) })), is_last: page.next === undefined,
        ...(page.next === undefined ? {} : { next_key: page.next }), queue, user } });
    };
    return { handler, reset: () => { n = 0; } };
  };

  async function historyParity(pages: { ids: string[]; next?: string }[], cfg: typeof config | Omit<typeof config, 'accessToken'>, opts: object) {
    const { handler, reset } = pagedHandler(pages);
    reset(); const mine = await withFetch(handler, () => getHistory(cfg as never, opts as never));
    reset(); const theirs = await withFetch(handler, () => old.conv.getHistory(cfg, opts));
    assert.deepStrictEqual(mine, theirs);
    return mine;
  }

  test('getHistory parity: multi-page with duplicate across pages is deduplicated', async () => {
    const pages = [{ ids: ['11', '12'], next: '50' }, { ids: ['12', '13'], next: '60' }, { ids: ['13', '14'] }];
    const mine = await historyParity(pages, { ...config, accessToken: undefined }, { to: 'abc', pages: 5 });
    assert.ok(mine.result.ok);
    const value = mine.result.value as Awaited<ReturnType<typeof getHistory>>;
    assert.deepStrictEqual(value.messages.map(m => m.id), ['11', '12', '13', '14']);
    assert.equal(value.pagesFetched, 3);
    assert.equal(mine.calls.filter(c => c.url.endsWith('/token')).length, 1, 'token fetched once');
  });

  test('getHistory parity: repeated cursor stops, page limit, invalid pages', async () => {
    const repeated = [{ ids: ['11', '12'], next: '50' }, { ids: ['12', '13'], next: '50' }];
    const stopped = await historyParity(repeated, config, { to: 'abc', pages: 5 });
    assert.deepStrictEqual(stopped.result, { ok: false, error: 'Server repeated history cursor; stopped' });
    const limited = await historyParity(repeated, config, { to: 'abc', pages: 1 });
    assert.equal((limited.result as { value: { cursor: string } }).value.cursor, '50');
    await historyParity(repeated, config, { to: 'abc', pages: 0 });
  });

  const convCases: [string, unknown, object?][] = [
    ['ok', { success: true, result: 0, data: { conversations: [{ conversation_id: 'abc', conversation_type: 0, extra: 1 }] } }],
    ['rejected', { success: false, result: 1012 }],
    ['bad schema', { success: true, result: 0, data: { conversations: [{ conversation_id: 'a b', conversation_type: 0 }] } }],
    ['missing list', { success: true, result: 0, data: {} }],
  ];
  for (const [name, json] of convCases) {
    test(`getConversations parity: ${name}`, async () => {
      const handler = (req: RecordedRequest) => litResponse(req, json);
      const mine = await withFetch(handler, () => getConversations(PROFILE));
      const theirs = await withFetch(handler, () => old.conv.getConversations(PROFILE));
      assert.deepStrictEqual(mine.result, theirs.result);
      assert.deepStrictEqual(mine.calls.map(c => [c.method, c.url.split('?')[0]]), theirs.calls.map(c => [c.method, c.url.split('?')[0]]));
    });
  }

  test('getConversations parity: non-litatom host refused before any request', async () => {
    const profile = { ...PROFILE, baseUrl: 'https://example.com' };
    const mine = await withFetch(() => Response.json({}), () => getConversations(profile));
    const theirs = await withFetch(() => Response.json({}), () => old.conv.getConversations(profile));
    assert.deepStrictEqual(mine, theirs);
  });

  test('syncLitmatchMetadata parity: success, rejection, network failure', async () => {
    const handlers: ((req: RecordedRequest) => Response | Promise<Response>)[] = [
      req => litResponse(req, { success: true, result: 0 }),
      req => litResponse(req, req.url.includes('source') ? { success: false, result: 3 } : { success: true, result: 0 }),
      () => Promise.reject(new TypeError('fetch failed')),
    ];
    for (const handler of handlers) for (const firstContact of [false, true]) {
      const strip = (r: Awaited<ReturnType<typeof withFetch>>) => ({ result: r.result, calls: r.calls.map(c => [c.method, c.url.split('?')[0]]) });
      const eventsMine: unknown[] = []; const eventsTheirs: unknown[] = [];
      const mine = await withFetch(handler, () => syncLitmatchMetadata({ profile: PROFILE, to: 'abc', firstContact, onEvent: e => eventsMine.push(e) }));
      const theirs = await withFetch(handler, () => old.hx.syncLitmatchMetadata({ profile: PROFILE, to: 'abc', firstContact, onEvent: (e: unknown) => eventsTheirs.push(e) }));
      assert.deepStrictEqual(strip(mine), strip(theirs));
      assert.deepStrictEqual(eventsMine, eventsTheirs);
    }
  });
});

test('template helper sanity', () => assert.equal(loadTemplate({ ...HX_ENV, HX_LOGIN_TEMPLATE_B64: templateB64('love_7') }).username, 'love_7'));
