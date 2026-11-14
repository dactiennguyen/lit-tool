import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { MAX_RESPONSE_BYTES } from '../core/constants.ts';
import { REPO_ROOT } from '../core/env.ts';
import { readLimited, safeFetch } from '../core/http.ts';
import { decodeShadow } from '../crypto/shadow.ts';
import type { GetRequest, LitRequest, PostRequest } from './request.ts';

export interface ResponseSummary {
  method: 'GET' | 'POST';
  endpoint: string;
  http_status: number;
  success: boolean | null;
  result: number | null;
  bytes: number;
  json: boolean;
  response_encrypted: boolean | null;
  request_id_matches: boolean | null;
  saved_private_response?: string;
}

export interface LitResponse {
  summary: ResponseSummary;

  body: Buffer;
}

export const isLitAccepted = (s: Pick<ResponseSummary, 'http_status' | 'success' | 'result'>): boolean =>
  s.http_status >= 200 && s.http_status < 300 && s.success === true && s.result === 0;

export function fetchGet(request: GetRequest): Promise<LitResponse> {
  return fetchRequest(request, 'GET');
}

export async function fetchPost(request: PostRequest): Promise<LitResponse> {
  if (request.method !== 'POST' || typeof request.body !== 'string') throw Error('Expected encoded POST request');
  return fetchRequest(request, 'POST');
}

async function fetchRequest(request: LitRequest, method: 'GET' | 'POST'): Promise<LitResponse> {
  const response = await safeFetch(request.url, {
    method, headers: request.headers, ...(method === 'POST' ? { body: request.body } : {}),
  });
  const raw = await readLimited(response, MAX_RESPONSE_BYTES, 'Response vượt giới hạn 2 MiB');
  let body = raw;
  let encrypted: boolean | null = null;
  let idMatches: boolean | null = null;

  const encryptedFlag = response.ok ? response.headers.get('x-is-enc') : null;
  if (encryptedFlag) {
    try {
      const flag = decodeShadow(encryptedFlag, 3);
      idMatches = flag.slice(1) === request.requestId;
      if (!idMatches || !['0', '1'].includes(flag[0]!)) throw Error('invalid response');
      encrypted = flag[0] === '1';
      if (encrypted) body = Buffer.from(decodeShadow(raw.toString('utf8'), 3), 'utf8');
    } catch { throw Error('Không giải mã được response hoặc request ID không khớp'); }
  }
  let json: unknown;
  try { json = JSON.parse(body.toString('utf8')); } catch { json = null; }
  const obj = json && typeof json === 'object' ? json as Record<string, unknown> : null;
  const summary: ResponseSummary = {
    method, endpoint: request.endpoint, http_status: response.status,
    success: typeof obj?.success === 'boolean' ? obj.success : null,
    result: typeof obj?.result === 'number' ? obj.result : null,
    bytes: raw.length, json: !!obj,
    response_encrypted: encrypted, request_id_matches: idMatches,
  };
  return { summary, body };
}

export function savePrivateResponse(body: Buffer): string {
  const dir = path.join(REPO_ROOT, '.private');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `startup-api-${Date.now()}-${randomBytes(4).toString('hex')}.response`);
  fs.writeFileSync(file, body, { flag: 'wx', mode: 0o600 });
  return file;
}
