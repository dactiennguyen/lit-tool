import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { listenTcp, ListenError, buildSyncFrame } from '../src/hyphenate/listener.ts';
import { loadListenConfig } from '../src/hyphenate/listen-config.ts';
import { buildNodeLoginTemplate } from '../src/hyphenate/bootstrap.ts';
import { bytesField, bytesValue, frame, getField, readFields, uintField, writeFields } from '../src/hyphenate/fields.ts';
import { buildTextMessage } from '../src/hyphenate/message.ts';
import { HX_APP_KEY, HX_USERNAME, HX_ENV, loginResponse, followupResponse, withFetch } from './helpers.ts';
import type { HxEvent } from '../src/hyphenate/connection.ts';

const queue = writeFields([bytesValue(1, HX_APP_KEY), bytesValue(2, 'easemob_chat'), bytesValue(3, 'easemob.com')]);
const status = bytesValue(1, writeFields([uintField(1, 0)]));
const response = (command: number, body: Buffer) => frame(writeFields([uintField(8, command), bytesValue(9, body)]));
const unread = () => response(1, writeFields([status, bytesValue(2, writeFields([bytesValue(1, queue), uintField(2, 1)]))]));
const sync = (last = true, cursor?: string, metas: Buffer[] = []) => response(0, writeFields([status,
  bytesValue(6, queue), uintField(7, last ? 1 : 0), ...(cursor ? [uintField(5, cursor)] : []), ...metas.map(m => bytesValue(4, m))]));
const template = (port: number) => buildNodeLoginTemplate({ appKey: HX_APP_KEY, username: HX_USERNAME,
  endpoint: { host: '127.0.0.1', port } }).template;
const meta = () => bytesField(readFields(bytesField(readFields(buildTextMessage({ from: 'alice', to: HX_USERNAME,
  text: 'hello listener', localId: '18446744073709551614' }).frame.subarray(4)), 9)), 1);

async function server<T>(handler: (payload: Buffer, socket: net.Socket) => void, run: (port: number) => Promise<T>): Promise<T> {
  const clients = new Set<net.Socket>();
  let serverError: unknown;
  const srv = net.createServer(socket => {
    clients.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => clients.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const size = buffer.readUInt32BE(0);
        if (buffer.length < size + 4) break;
        const payload = buffer.subarray(4, size + 4);
        buffer = buffer.subarray(size + 4);
        try { handler(payload, socket); } catch (e) { serverError = e; socket.destroy(); }
      }
    });
  });
  await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', resolve));
  try {
    const result = await run((srv.address() as net.AddressInfo).port);
    if (serverError) throw serverError;
    return result;
  } finally {
    for (const c of clients) c.destroy();
    await new Promise<void>(resolve => srv.close(() => resolve()));
  }
}
const command = (p: Buffer) => String(getField(readFields(p), 8));

test('direct listener logs in, pulls multipart pages, deduplicates chat and polls UNREAD', async () => {
  let polls = 0, pages = 0;
  const events: HxEvent[] = [];
  const result = await server((p, s) => {
    if (command(p) === '3') {
      const login = loginResponse();
      s.write(login.subarray(0, 2));
      setTimeout(() => s.write(login.subarray(2)), 2);
    } else if (command(p) === '1') s.write(++polls === 1 ? unread() : followupResponse());
    else {
      const body = readFields(bytesField(readFields(p), 9));
      assert.deepEqual(bytesField(body, 3), queue);
      if (++pages === 1) {
        assert.equal(getField(body, 2), undefined);
        s.write(sync(false, '18446744073709551613', [meta()]));
      } else {
        assert.equal(String(getField(body, 2)), '18446744073709551613');
        s.write(sync(true, undefined, [meta()]));
      }
    }
  }, port => listenTcp({ template: template(port), accessToken: 'secret-token', durationMs: 160,
    heartbeatMs: 40, timeoutMs: 1000, showContent: true, onEvent: e => events.push(e) }));
  assert.equal(result.reason, 'duration');
  assert.equal(result.messagesReceived, 1);
  assert.equal(result.chatMessagesReceived, 1);
  assert.equal(result.duplicateMessages, 1);
  assert.equal(result.chatMessagesSent, 0);
  assert.ok(polls >= 2);
  assert.equal(pages, 2);
  assert.equal(events.filter(e => e.event === 'message_received').length, 1);
  assert.match(JSON.stringify(events), /hello listener/);
  assert.doesNotMatch(JSON.stringify(events), /secret-token/);
});

test('NOTICE during a pull requeues once and default output hides text', async () => {
  let pages = 0;
  const events: HxEvent[] = [];
  await server((p, s) => {
    if (command(p) === '3') s.write(loginResponse());
    else if (command(p) === '1') s.write(unread());
    else {
      pages++;
      if (pages === 1) s.write(Buffer.concat([response(2, writeFields([bytesValue(1, queue)])), sync(true, undefined, [meta()])]));
      else s.write(sync());
    }
  }, port => listenTcp({ template: template(port), accessToken: 'token', durationMs: 100,
    heartbeatMs: 1000, onEvent: e => events.push(e) }));
  assert.equal(pages, 2);
  assert.doesNotMatch(JSON.stringify(events), /hello listener|alice/);
});

test('login and UNREAD rejection fail with summary; no automatic reconnect', async () => {
  for (const stage of ['login', 'unread']) await server((p, s) => {
    s.write(command(p) === '3' ? loginResponse(stage === 'login' ? 2 : 0) : followupResponse(2));
  }, async port => {
    await assert.rejects(listenTcp({ template: template(port), accessToken: 'secret', durationMs: 50 }), e => {
      assert.ok(e instanceof ListenError);
      assert.equal(e.summary.reason, 'error');
      assert.equal(e.summary.chatMessagesSent, 0);
      assert.match(e.message, /rejected/);
      return true;
    });
  });
});

test('silence, remote close, malformed and partial frames fail instead of claiming success', async () => {
  for (const mode of ['silence', 'close', 'oversize', 'partial', 'malformed']) await server((_p, s) => {
    if (mode === 'close') s.end();
    if (mode === 'oversize') s.write(Buffer.from('ffffffff', 'hex'));
    if (mode === 'partial') s.end(Buffer.from('0000000808', 'hex'));
    if (mode === 'malformed') s.write(frame(Buffer.from([255])));
  }, async port => {
    await assert.rejects(listenTcp({ template: template(port), accessToken: 't', durationMs: 100, timeoutMs: 40 }), ListenError);
  });
});

test('heartbeat and sync have their own response deadlines', async () => {
  for (const mode of ['heartbeat', 'sync']) {
    let polls = 0;
    await server((p, s) => {
      if (command(p) === '3') s.write(loginResponse());
      else if (command(p) === '1' && ++polls === 1) s.write(mode === 'sync' ? unread() : followupResponse());
    }, async port => {
      await assert.rejects(listenTcp({ template: template(port), accessToken: 't', durationMs: 500,
        timeoutMs: 60, heartbeatMs: 20 }), /response timed out/);
    });
  }
});

test('repeated cursor and mismatched response queues stop the listener', async () => {
  for (const mode of ['cursor', 'queue']) await server((p, s) => {
    if (command(p) === '3') s.write(loginResponse());
    else if (command(p) === '1') s.write(unread());
    else s.write(mode === 'cursor' ? sync(false, '5') : response(0, writeFields([status,
      bytesValue(6, writeFields([bytesValue(2, 'wrong')])), uintField(7, 1)])));
  }, async port => {
    await assert.rejects(listenTcp({ template: template(port), accessToken: 't', durationMs: 200 }), /cursor|queue does not match/);
  });
});

test('nonconsecutive cursor cycle is rejected without a fourth pull', async () => {
  let pulls = 0;
  await server((p, s) => {
    if (command(p) === '3') s.write(loginResponse());
    else if (command(p) === '1') s.write(unread());
    else s.write(sync(false, ['5', '6', '5'][pulls++]));
  }, async port => assert.rejects(listenTcp({ template: template(port), accessToken: 't' }), /repeated sync cursor/));
  assert.equal(pulls, 3);
});

test('server LOGOUT and unsupported encryption are terminal', async () => {
  for (const mode of ['logout', 'encryption']) await server((p, s) => {
    if (command(p) === '3') s.write(loginResponse());
    else s.write(Buffer.concat([followupResponse(), mode === 'logout' ? response(4, Buffer.alloc(0)) :
      frame(writeFields([uintField(8, 0), uintField(11, 1), bytesValue(9, 'ciphertext')]))]));
  }, async port => {
    await assert.rejects(listenTcp({ template: template(port), accessToken: 't', durationMs: 100 }), /logged.*out|Unsupported/);
  });
});

test('AbortSignal stops an active or not-yet-started listener and clears timers', async () => {
  const controller = new AbortController();
  const result = await server((p, s) => s.write(command(p) === '3' ? loginResponse() : followupResponse()),
    port => listenTcp({ template: template(port), accessToken: 't', signal: controller.signal,
      onEvent: e => { if (e.event === 'listen_ready') controller.abort(); } }));
  assert.equal(result.reason, 'aborted');
  assert.equal((await listenTcp({ template: template(1), accessToken: 't', signal: controller.signal })).framesSent, 0);
});

test('aborting in tcp_connected sends no login and aborting in frame event emits no message', async () => {
  for (const event of ['tcp_connected', 'frame_received']) {
    const controller = new AbortController();
    let writes = 0;
    const result = await server((_p, s) => { writes++; s.write(loginResponse()); },
      port => listenTcp({ template: template(port), accessToken: 't', signal: controller.signal,
        onEvent: e => { if (e.event === event) controller.abort(); } }));
    assert.equal(result.reason, 'aborted');
    assert.equal(result.messagesReceived, 0);
    assert.equal(writes, event === 'tcp_connected' ? 0 : 1);
  }
});

test('sync frame rejects invalid cursor without numeric precision loss', () => {
  for (const key of ['-1', '1.5', '18446744073709551616', '00', 'x']) assert.throws(() => buildSyncFrame(queue, key), /cursor/);
  assert.throws(() => buildSyncFrame(Buffer.alloc(0)), /queue/);
});

test('domain-only queues are pulled and nameless unusable queues are skipped', async () => {
  const domainQueue = writeFields([bytesValue(3, 'easemob.com'), bytesValue(4, 'resource')]);
  let pulled = false;
  const events: HxEvent[] = [];
  await server((p, s) => {
    if (command(p) === '3') s.write(loginResponse());
    else if (command(p) === '1') s.write(response(1, writeFields([status,
      bytesValue(2, writeFields([bytesValue(1, domainQueue), uintField(2, 1)])),
      bytesValue(2, writeFields([bytesValue(1, Buffer.alloc(0)), uintField(2, 1)]))])));
    else {
      assert.deepEqual(bytesField(readFields(bytesField(readFields(p), 9)), 3), domainQueue);
      pulled = true;
      s.write(response(0, writeFields([status, bytesValue(6, domainQueue), uintField(7, 1)])));
    }
  }, port => listenTcp({ template: template(port), accessToken: 't', durationMs: 80, onEvent: e => events.push(e) }));
  assert.ok(pulled);
  assert.equal(events.filter(e => e.event === 'queue_ignored').length, 1);
});

test('Node config ignores captured template by default and validates identity and endpoint', async () => {
  const config = await loadListenConfig({ ...HX_ENV, HX_APP_KEY, HX_USERNAME, HX_LOGIN_TEMPLATE_B64: 'invalid' });
  assert.equal(config.source, 'node_generated');
  assert.equal(config.template.username, HX_USERNAME);
  for (const env of [{}, { HX_APP_KEY, HX_USERNAME, HX_IM_HOST: 'bad host' },
    { HX_APP_KEY, HX_USERNAME, HX_IM_HOST: '127.0.0.1', HX_IM_PORT: '0' }]) await assert.rejects(loadListenConfig(env));
  assert.equal((await loadListenConfig(HX_ENV, true)).source, 'env_template');
});

test('without host, config uses discovery with only app key and IM username', async () => {
  const { result, calls } = await withFetch(() => Response.json({
    'msync-im': { hosts: [{ ip: '127.0.0.1', port: 7777 }] },
    rest: { hosts: [{ protocol: 'https', port: 443, domain: 'a1.easemob.com' }] },
  }), async () => {
    const c = await loadListenConfig({ HX_APP_KEY, HX_USERNAME });
    assert.equal(c.source, 'node_generated');
    assert.equal(c.template.host, '127.0.0.1');
    assert.equal(c.template.port, 7777);
    assert.equal(c.restBase, 'https://a1.easemob.com');
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).searchParams.get('app_key'), HX_APP_KEY);
});

test('CLI help and invalid options do not require ADB or load credentials', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [new URL('../tcp-listen.js', import.meta.url).pathname, ...args],
    { encoding: 'utf8', env: { ...process.env, SCRIPTS_ENV_FILE: '/nonexistent/listener-test-env' } });
  assert.match(run('--help').stdout, /no ADB/);
  for (const args of [['--device', 'x'], ['--seconds', '0'], ['--heartbeat-seconds', '0']]) assert.equal(run(...args).status, 1);
});

test('CLI completes a direct TCP session with no external binaries on PATH', async () => {
  await server((p, s) => s.write(command(p) === '3' ? loginResponse() : followupResponse()), async port => {
    const { stdout, stderr } = await promisify(execFile)(process.execPath,
      [new URL('../tcp-listen.js', import.meta.url).pathname, '--seconds', '1'], {
        timeout: 5000,
        env: { ...process.env, PATH: '/nonexistent/no-external-binaries', SCRIPTS_ENV_FILE: '/nonexistent/no-env',
          HX_APP_KEY, HX_USERNAME, HX_IM_HOST: '127.0.0.1', HX_IM_PORT: String(port),
          HX_ACCESS_TOKEN: 'test-token-must-stay-private', HX_LOGIN_TEMPLATE_B64: 'unused-invalid-template' },
      });
    const events = stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events[0].templateSource, 'node_generated');
    assert.equal(events.at(-1).event, 'listen_complete');
    assert.equal(events.at(-1).reason, 'duration');
    assert.equal(events.at(-1).chatMessagesSent, 0);
    assert.equal(stderr, '');
    assert.doesNotMatch(stdout, /test-token-must-stay-private/);
  });
});
