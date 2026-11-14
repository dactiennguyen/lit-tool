import { HTTP_TIMEOUT_MS } from './constants.ts';

export interface SafeFetchInit extends Omit<RequestInit, 'redirect' | 'signal'> {
  timeoutMs?: number;
}

export function safeFetch(url: string | URL, { timeoutMs = HTTP_TIMEOUT_MS, ...init }: SafeFetchInit = {}): Promise<Response> {
  return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
}

export async function readLimited(response: Response, maxBytes: number, tooLargeMessage: string): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) throw Error(tooLargeMessage);
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks);
}
