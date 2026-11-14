import { randomInt, randomUUID } from 'node:crypto';
import { isId } from '../core/validate.ts';
import { bytesField, bytesValue, frame, getField, readFields, uintField, writeFields } from './fields.ts';

export type HandshakeStep = 'login' | 'followup';

export function readResponse(payload: Buffer, step: HandshakeStep): { type: string; code: string } {
  const outer = readFields(payload);
  const body = readFields(bytesField(outer, 9));
  const status = readFields(bytesField(body, step === 'login' ? 8 : 1));
  return { type: String(getField(outer, 8)), code: String(getField(status, 1)) };
}

export const FOLLOWUP_FRAME = Buffer.from('00000008080040014a005800', 'hex');

export interface TextMessage {
  from: string;
  to: string;
  localId: string;
  markId: string;
  frame: Buffer;
}

export interface TextMessageInput {
  from: string;
  to: string;
  text: string;

  localId?: string;

  markId?: string;
}

export function buildTextMessage({ from, to, text, localId, markId }: TextMessageInput): TextMessage {
  for (const id of [from, to]) if (!isId(id)) throw Error('Invalid IM username');
  if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 4096 || text.includes('\0')) {
    throw Error('Message text must be nonempty and at most 4096 UTF-8 bytes');
  }
  localId ??= (BigInt(Date.now()) * 10000n + BigInt(randomInt(10000))).toString();
  markId ??= randomUUID();
  const jid = (user: string) => writeFields([bytesValue(2, user)]);
  const body = writeFields([
    uintField(1, 1), bytesValue(2, jid(from)), bytesValue(3, jid(to)),
    bytesValue(4, writeFields([uintField(1, 0), bytesValue(2, text)])),
    bytesValue(5, writeFields([bytesValue(1, 'mark_msg_id'), uintField(2, 7), bytesValue(6, markId)])),
  ]);
  const meta = writeFields([uintField(1, localId), bytesValue(3, jid(to)), uintField(5, 1), bytesValue(6, body)]);
  const payload = writeFields([uintField(1, 0), uintField(8, 0), bytesValue(9, writeFields([bytesValue(1, meta)])), uintField(11, 0)]);
  return { from, to, localId, markId, frame: frame(payload) };
}

export interface SendResult {
  code: string;
  localId: string;
  serverId: string;

  accepted: boolean;
}

export function readSendResponse(payload: Buffer, localId: string): SendResult | null {
  const outer = readFields(payload);
  if (String(getField(outer, 8)) !== '0') return null;
  const body = readFields(bytesField(outer, 9));
  if (String(getField(body, 2)) !== localId) return null;
  const code = String(getField(readFields(bytesField(body, 1)), 1));
  const serverId = String(getField(body, 3) ?? '');
  const validServerId = /^[1-9][0-9]*$/.test(serverId);
  if (!/^[0-9]+$/.test(code) || (code === '0' && !validServerId)) throw Error('Incomplete send acknowledgement');
  return { code, localId, serverId, accepted: code === '0' && validServerId };
}
