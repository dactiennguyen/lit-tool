import net from 'node:net';
import { MAX_FRAME_BYTES } from '../core/constants.ts';
import { bytesField, bytesValue, frame, getField, readFields, uintField, writeFields } from './fields.ts';
import { FOLLOWUP_FRAME } from './message.ts';
import { buildLoginFrame, type LoginTemplate } from './template.ts';
import { decodeTcpFrame } from './msync.ts';
import type { EventSink } from './connection.ts';

export interface ListenOptions {
  template: LoginTemplate;
  accessToken: string;
  durationMs?: number;
  heartbeatMs?: number;
  timeoutMs?: number;
  showContent?: boolean;
  signal?: AbortSignal;
  onEvent?: EventSink;
}

export interface ListenSummary {
  reason: 'duration' | 'aborted' | 'error';
  startedAt: string | null;
  finishedAt: string;
  elapsedSeconds: number;
  framesSent: number;
  framesReceived: number;
  bytesSent: number;
  bytesReceived: number;
  messagesReceived: number;
  chatMessagesReceived: number;
  duplicateMessages: number;
  chatMessagesSent: 0;
  kinds: Record<string, number>;
}

export class ListenError extends Error {
  readonly summary: ListenSummary;
  constructor(message: string, summary: ListenSummary) { super(message); this.name = 'ListenError'; this.summary = summary; }
}

export function buildSyncFrame(queue: Buffer, key?: string): Buffer {
  if (!queueId(queue)) throw Error('Invalid sync queue');
  if (key !== undefined && (!/^(0|[1-9][0-9]{0,19})$/.test(key) || BigInt(key) > 0xffffffffffffffffn)) {
    throw Error('Invalid sync cursor');
  }
  return frame(writeFields([uintField(1, 0), uintField(8, 0),
    bytesValue(9, writeFields([bytesValue(3, queue), ...(key === undefined ? [] : [uintField(2, key)])])), uintField(11, 0)]));
}

function queueId(queue: Buffer): string | null {
  const fields = readFields(queue);
  if (queue.length > 4096) throw Error('Invalid sync queue');
  const [app, name, domain, resource] = [1, 2, 3, 4].map(n => {
    const b = getField(fields, n);
    return Buffer.isBuffer(b) ? b.toString('utf8').trim() : '';
  });
  return name ? JSON.stringify(['name', name]) : domain ? JSON.stringify(['domain', domain, resource])
    : resource ? JSON.stringify(['resource', resource]) : app ? JSON.stringify(['app', app]) : null;
}

export function listenTcp({ template, accessToken, durationMs = 900_000, heartbeatMs = 30_000,
  timeoutMs = 15_000, showContent = false, signal, onEvent = () => {} }: ListenOptions): Promise<ListenSummary> {
  for (const [name, value, max] of [['duration', durationMs, 86_400_000], ['heartbeat', heartbeatMs, 300_000],
    ['timeout', timeoutMs, 60_000]] as const) {
    if (!Number.isInteger(value) || value < 1 || value > max) throw Error(`Invalid ${name}`);
  }
  const login = buildLoginFrame(template, accessToken);
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let incoming = Buffer.alloc(0);
    let phase: 'login' | 'followup' | 'listening' = 'login';
    let settled = false;
    let start = 0;
    let startedAt: string | null = null;
    let framesSent = 0, framesReceived = 0, bytesSent = 0, bytesReceived = 0;
    let messagesReceived = 0, chatMessagesReceived = 0, duplicateMessages = 0;
    const kinds: Record<string, number> = {};
    const seen = new Set<string>();
    const pending = new Map<string, Buffer>();
    let current: { id: string; queue: Buffer; cursor?: string; cursors: Set<string>; pages: number; dirty: boolean } | null = null;
    let handshakeTimer: NodeJS.Timeout | undefined, durationTimer: NodeJS.Timeout | undefined;
    let heartbeatTimer: NodeJS.Timeout | undefined, unreadTimer: NodeJS.Timeout | undefined;
    let syncTimer: NodeJS.Timeout | undefined, progressTimer: NodeJS.Timeout | undefined;
    const summary = (reason: ListenSummary['reason']): ListenSummary => ({ reason, startedAt,
      finishedAt: new Date().toISOString(), elapsedSeconds: start ? (performance.now() - start) / 1000 : 0,
      framesSent, framesReceived, bytesSent, bytesReceived, messagesReceived, chatMessagesReceived,
      duplicateMessages, chatMessagesSent: 0, kinds: { ...kinds } });
    const finish = (reason: ListenSummary['reason'], error?: Error) => {
      if (settled) return;
      settled = true;
      for (const t of [handshakeTimer, durationTimer, heartbeatTimer, unreadTimer, syncTimer, progressTimer]) clearTimeout(t);
      signal?.removeEventListener('abort', abort);
      socket.destroy();
      const result = summary(reason);
      if (error) reject(new ListenError(error.message, result));
      else resolve(result);
    };
    const fail = (error: unknown) => finish('error', error instanceof Error ? error : Error('Listener failed'));
    const emit = (value: Parameters<EventSink>[0]) => onEvent({ at: new Date().toISOString(), ...value });
    const abort = () => finish('aborted');
    const send = (bytes: Buffer, kind: string) => {
      if (settled) return;
      if (socket.writableLength > MAX_FRAME_BYTES) throw Error('TCP write buffer limit reached');
      socket.write(bytes);
      framesSent++;
      bytesSent += bytes.length;
      kinds[`sent:${kind}`] = (kinds[`sent:${kind}`] ?? 0) + 1;
      emit({ event: 'frame_sent', kind, bytes: bytes.length });
    };
    const unread = () => {
      if (unreadTimer || settled) return;
      unreadTimer = setTimeout(() => fail(Error('UNREAD response timed out')), timeoutMs);
      send(FOLLOWUP_FRAME, 'unread_request');
    };
    const sendSync = () => {
      if (!current || settled) return;
      if (++current.pages > 10000) throw Error('Sync page limit reached');
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => fail(Error('Queue sync response timed out')), timeoutMs);
      send(buildSyncFrame(current.queue, current.cursor), 'sync_request');
    };
    const nextQueue = () => {
      if (current || settled || phase !== 'listening') return;
      const item = pending.entries().next().value;
      if (!item) return;
      const [id, queue] = item;
      pending.delete(id);
      current = { id, queue, pages: 0, dirty: false, cursors: new Set() };
      sendSync();
    };
    const enqueue = (queue: Buffer, notice = false) => {
      const id = queueId(queue);
      if (!id) { emit({ event: 'queue_ignored', reason: 'empty_identity' }); return; }
      if (current?.id === id) { current.dirty ||= notice; return; }
      if (pending.size >= 1000 && !pending.has(id)) throw Error('Queue limit reached');
      pending.set(id, queue);
    };
    const handle = (payload: Buffer) => {
      const decoded = decodeTcpFrame(payload, 'received', showContent);
      framesReceived++;
      kinds[`received:${decoded.kind}`] = (kinds[`received:${decoded.kind}`] ?? 0) + 1;
      emit({ event: 'frame_received', bytes: payload.length + 4, decoded });
      if (settled) return;
      if (decoded.kind.endsWith('_unsupported') || decoded.kind === 'missing_payload') throw Error(`Unsupported IM frame: ${decoded.kind}`);
      if (decoded.kind === 'logout') throw Error('Server logged this client out');
      if (phase === 'login') {
        if (decoded.kind !== 'login_response' || decoded.status !== '0') throw Error(`Login rejected (status=${decoded.status ?? 'missing'})`);
        phase = 'followup';
        unread();
        return;
      }
      const body = readFields(bytesField(readFields(payload), 9));
      if (decoded.kind === 'unread_response') {
        if (decoded.status !== '0') throw Error(`UNREAD rejected (status=${decoded.status ?? 'missing'})`);
        clearTimeout(unreadTimer);
        unreadTimer = undefined;
        for (const f of body) if (f.number === 2 && f.wire === 2) enqueue(bytesField(readFields(f.value), 1));
        if (phase === 'followup') {
          phase = 'listening';
          clearTimeout(handshakeTimer);
          start = performance.now();
          startedAt = new Date().toISOString();
          durationTimer = setTimeout(() => finish('duration'), durationMs);
          heartbeatTimer = setInterval(() => { try { unread(); } catch (e) { fail(e); } }, heartbeatMs);
          progressTimer = setInterval(() => {
            try {
              const { reason: _reason, finishedAt: _finished, ...stats } = summary('duration');
              emit({ event: 'listen_progress', ...stats });
            } catch (e) { fail(e); }
          }, 30_000);
          emit({ event: 'listen_ready', host: template.host, port: template.port,
            username: template.username, durationMs, heartbeatMs });
        }
        nextQueue();
        return;
      }
      if (decoded.kind === 'notice') {
        enqueue(bytesField(body, 1), true);
        nextQueue();
        return;
      }
      if (phase !== 'listening') throw Error('Unexpected frame before initial UNREAD completed');
      if (decoded.kind !== 'sync_messages' && decoded.kind !== 'sync_response' && decoded.kind !== 'send_ack') return;
      if (decoded.status !== '0') throw Error(`SYNC rejected (status=${decoded.status ?? 'missing'})`);
      for (const message of decoded.messages ?? []) {
        const key = `${message.namespace}:${message.id}`;
        if (seen.has(key)) { duplicateMessages++; continue; }
        if (seen.size >= 100000) throw Error('Message deduplication limit reached');
        seen.add(key);
        messagesReceived++;
        if (message.namespace === 1 && [0, 1, 2, 3].includes(message.messageType ?? -1)) chatMessagesReceived++;
        emit({ event: 'message_received', message });
        if (settled) return;
      }
      if (decoded.kind === 'send_ack' || !current) return;
      const responseQueue = getField(body, 6);
      if (Buffer.isBuffer(responseQueue) && queueId(responseQueue) !== current.id) throw Error('SYNC queue does not match pending request');
      clearTimeout(syncTimer);
      if (decoded.isLast) {
        if (current.dirty) pending.set(current.id, current.queue);
        current = null;
        nextQueue();
      } else {
        if (!decoded.nextKey || decoded.nextKey === '0' || current.cursors.has(decoded.nextKey)) throw Error('Missing or repeated sync cursor');
        current.cursors.add(decoded.nextKey);
        current.cursor = decoded.nextKey;
        sendSync();
      }
    };
    if (signal?.aborted) { finish('aborted'); return; }
    signal?.addEventListener('abort', abort, { once: true });
    handshakeTimer = setTimeout(() => fail(Error('IM handshake timed out')), timeoutMs);
    socket.once('error', (e: NodeJS.ErrnoException) => fail(Error(`TCP connection failed (${e.code ?? 'socket error'})`)));
    socket.once('close', () => { if (!settled) fail(Error(incoming.length ? 'Socket closed with incomplete frame' : 'Socket closed before listen duration completed')); });
    socket.once('connect', () => {
      try {
        socket.setNoDelay(true);
        socket.setKeepAlive(true, 30_000);
        emit({ event: 'tcp_connected', host: template.host, port: template.port });
        send(login, 'login_request');
      } catch (e) { fail(e); }
    });
    socket.on('data', (chunk: Buffer) => {
      if (settled) return;
      try {
        bytesReceived += chunk.length;
        incoming = Buffer.concat([incoming, chunk]);
        while (!settled && incoming.length >= 4) {
          const size = incoming.readUInt32BE(0);
          if (size === 0 || size > MAX_FRAME_BYTES) throw Error('Invalid TCP frame length');
          if (incoming.length < size + 4) break;
          const payload = incoming.subarray(4, size + 4);
          incoming = incoming.subarray(size + 4);
          handle(payload);
        }
      } catch (e) { fail(e); }
    });
    socket.connect({ host: template.host, port: template.port });
  });
}
