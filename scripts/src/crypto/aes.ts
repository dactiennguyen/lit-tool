import { createCipheriv, createDecipheriv } from 'node:crypto';
import zlib from 'node:zlib';

export type AesCbcAlgorithm = 'aes-128-cbc' | 'aes-256-cbc';

export function aesCbcEncrypt(algorithm: AesCbcAlgorithm, key: Buffer, iv: Buffer, data: Buffer | string): Buffer {
  const cipher = createCipheriv(algorithm, key, iv);
  return Buffer.concat([cipher.update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data), cipher.final()]);
}

export function aesCbcDecrypt(algorithm: AesCbcAlgorithm, key: Buffer, iv: Buffer, data: Buffer): Buffer {
  const decipher = createDecipheriv(algorithm, key, iv);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export function deflateEncrypt(text: string, key: Buffer, iv: Buffer): string {
  const compressed = zlib.deflateSync(Buffer.from(text, 'utf8'), { level: 9 });
  return aesCbcEncrypt('aes-128-cbc', key, iv, compressed).toString('base64');
}

export function decryptInflate(base64: string, key: Buffer, iv: Buffer): string {
  const compressed = aesCbcDecrypt('aes-128-cbc', key, iv, Buffer.from(base64, 'base64'));
  return zlib.inflateSync(compressed).toString('utf8');
}
