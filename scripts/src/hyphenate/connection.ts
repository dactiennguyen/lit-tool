import net from 'node:net';
import { MAX_FRAME_BYTES } from '../core/constants.ts';
import { FOLLOWUP_FRAME, readResponse, readSendResponse, type HandshakeStep, type SendResult, type TextMessage } from './message.ts';
import { buildLoginFrame, type LoginTemplate } from './template.ts';

export type HxEvent = { event: string } & Record<string, unknown>;
export type EventSink = (event: HxEvent) => void;

export interface HandshakeResponse {
  step: HandshakeStep;
  type: string;
  code: string;
  accepted: boolean;
}

export interface ConnectResult {
  connected: true;
  peer: string;
  responses: HandshakeResponse[];
  sendResult: SendResult | null;
}

export interface ConnectOptions {
  template: LoginTemplate;
  accessToken: string;
  timeoutMs?: number;
  message?: TextMessage | undefined;
  onEvent?: EventSink;
}

export function connectAndCheck({ template, accessToken, timeoutMs = 8000, message, onEvent = () => {} }: ConnectOptions): Promise<ConnectResult> {
  const loginFrame = buildLoginFrame(template, accessToken);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw Error('Invalid timeout');
  if (message && (message.from !== template.username || !Buffer.isBuffer(message.frame) ||
      !/^[1-9][0-9]*$/.test(message.localId))) throw Error('Invalid message or sender does not match login');

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const responses: HandshakeResponse[] = [];
    let incoming = Buffer.alloc(0);
    let step: HandshakeStep | 'send' = 'login';
    let settled = false;
    let sendAttempted = false;
    let sendResult: SendResult | null = null;
    let deadline: NodeJS.Timeout | undefined;

    const finish = (error?: Error): void => {
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
    };
    const fail = (error: unknown): void => finish(error instanceof Error ? error : Error(String(error)));

    deadline = setTimeout(() => finish(Error('Handshake timed out')), timeoutMs);
    socket.once('error', (error: NodeJS.ErrnoException) => finish(Error(`TCP connection failed: ${error.code || 'socket error'}`)));
    socket.once('close', () => finish(Error('Socket closed before operation completed')));
    socket.once('connect', () => {
      try {
        onEvent({ event: 'tcp_connected', peer: template.host, port: template.port });
        socket.write(loginFrame);
      } catch (error) { fail(error); }
    });

    socket.on('data', (chunk: Buffer) => {
      if (settled) return;
      try {
        incoming = Buffer.concat([incoming, chunk]);
        while (incoming.length >= 4) {
          const length = incoming.readUInt32BE(0);
          if (!length || length > MAX_FRAME_BYTES) throw Error('Invalid response frame length');
          if (incoming.length < length + 4) return;
          const payload = incoming.subarray(4, length + 4);
          incoming = incoming.subarray(length + 4);

          if (step === 'send') {
            const response = readSendResponse(payload, message!.localId);
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
      } catch (error) { fail(error); }
    });
    socket.connect({ host: template.host, port: template.port });
  });
}
