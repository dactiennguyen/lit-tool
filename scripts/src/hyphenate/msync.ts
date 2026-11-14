import { readFields, getField, type ProtoField } from './fields.ts';
import protobuf from 'protobufjs';
import { decodeMessage } from './history.ts';

const COMMANDS = ['SYNC', 'UNREAD', 'NOTICE', 'PROVISION', 'LOGOUT'];
const CONTENTS = ['TXT', 'IMAGE', 'VIDEO', 'LOCATION', 'VOICE', 'FILE', 'CMD', 'CUSTOM', 'COMBINE'];
const MESSAGE_TYPES = ['NORMAL', 'CHAT', 'GROUPCHAT', 'CHATROOM', 'READ_ACK', 'DELIVER_ACK', 'RECALL', 'CHANNEL_ACK', 'EDIT'];
const scalar = (fields: ProtoField[], n: number) => {
  const v = getField(fields, n);
  return v === undefined || Buffer.isBuffer(v) ? null : String(v);
};
const bytes = (fields: ProtoField[], n: number) => {
  const v = getField(fields, n);
  return Buffer.isBuffer(v) ? v : null;
};
const jid = (value: Buffer | null) => value ? bytes(readFields(value), 2)?.toString('utf8') ?? null : null;
const status = (fields: ProtoField[], n: number) => {
  const value = bytes(fields, n);
  return value ? scalar(readFields(value), 1) ?? '0' : null;
};

export interface DecodedFrame {
  command: string;
  kind: string;
  fields: number[];
  compression: string;
  encryption: string[];
  status?: string | null;
  localId?: string | null;
  serverId?: string | null;
  queue?: string | null;
  nextKey?: string | null;
  isLast?: boolean;
  unread?: Array<{ queue: string | null; count: string | null }>;
  messages?: Array<{
    id: string; namespace: number; messageType: number | null; messageTypeName: string; contentTypes: string[];
    from?: string | null; to?: string | null; texts?: string[];
  }>;
}

export function decodeTcpFrame(payload: Buffer, direction: 'sent' | 'received', showContent = false): DecodedFrame {
  const outer = readFields(payload);
  const command = scalar(outer, 8);
  if (command === null) throw Error('Missing MSync command');
  const compression = scalar(outer, 4) ?? '0';
  const encryption = outer.filter(f => f.number === 11).flatMap(f => {
    if (f.wire === 0) return [String(f.value)];
    if (f.wire === 2) {
      const reader = protobuf.Reader.create(f.value);
      const values: string[] = [];
      while (reader.pos < reader.len) values.push(String(reader.uint32()));
      return values;
    }
    return ['unknown'];
  });
  const result: DecodedFrame = { command: COMMANDS[Number(command)] ?? `UNKNOWN_${command}`,
    kind: 'unknown', fields: [...new Set(outer.map(f => f.number))], compression, encryption };
  if (compression !== '0') { result.kind = 'compressed_unsupported'; return result; }
  if ((scalar(outer, 5) ?? '0') !== '0' || encryption.some(x => x !== '0')) {
    result.kind = 'encrypted_or_negotiated_unsupported'; return result;
  }
  const bodyBytes = bytes(outer, 9);
  if (!bodyBytes) { result.kind = 'missing_payload'; return result; }
  const body = readFields(bodyBytes);
  const received = direction === 'received';
  if (command === '3') {
    result.kind = received ? 'login_response' : 'login_request';
    if (received) result.status = status(body, 8);
  } else if (command === '1') {
    result.kind = received ? 'unread_response' : 'unread_request';
    if (received) {
      result.status = status(body, 1);
      result.unread = body.filter(f => f.number === 2 && f.wire === 2).map(f => {
        const q = readFields(f.value as Buffer);
        return { queue: jid(bytes(q, 1)), count: scalar(q, 2) };
      });
    }
  } else if (command === '2') {
    result.kind = 'notice';
    result.queue = jid(bytes(body, 1));
  } else if (command === '4') result.kind = 'logout';
  else if (command === '0') {
    const metas = body.filter(f => f.number === (received ? 4 : 1) && f.wire === 2);
    result.messages = metas.map(f => {
      const m = decodeMessage((f.value as Buffer).toString('base64'));
      return { id: m.id, namespace: m.namespace, messageType: m.messageType,
        messageTypeName: m.messageType === null ? 'UNKNOWN' : MESSAGE_TYPES[m.messageType] ?? `UNKNOWN_${m.messageType}`,
        contentTypes: m.contents.map(c => CONTENTS[Number(c.type)] ?? `UNKNOWN_${c.type}`),
        ...(showContent ? { from: m.from, to: m.to,
          texts: m.contents.filter(c => typeof c.text === 'string').map(c => c.text as string) } : {}) };
    });
    result.queue = jid(bytes(body, received ? 6 : 3));
    if (received) {
      result.status = status(body, 1);
      result.localId = scalar(body, 2);
      result.serverId = scalar(body, 3);
      result.nextKey = scalar(body, 5);
      result.isLast = scalar(body, 7) === '1';
      result.kind = metas.length ? 'sync_messages' : result.localId ? 'send_ack' : 'sync_response';
    } else result.kind = metas.length ? 'send_message' : 'sync_request';
  }
  return result;
}

