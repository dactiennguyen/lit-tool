import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPTS_DIR = fileURLToPath(new URL('../../', import.meta.url));

export const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..');

export type Env = Readonly<Record<string, string | undefined>>;

export function defaultEnvFile(): string {
  return process.env.SCRIPTS_ENV_FILE || path.join(SCRIPTS_DIR, '.env');
}

export function readDotEnv(file: string = defaultEnvFile()): Record<string, string> {
  let content = '';
  try { content = fs.readFileSync(file, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw Error('Không đọc được .env');
  }
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*((?:LIT|HX)_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value: unknown = match[2];
    if ((value as string).startsWith('"')) {
      try { value = JSON.parse(value as string); }
      catch { throw Error('Giá trị trong .env không hợp lệ'); }
    }
    if (typeof value !== 'string') throw Error('Giá trị trong .env phải là chuỗi');
    values[match[1]!] = value;
  }
  return values;
}

export function loadEnv(file: string = defaultEnvFile()): Env {
  return { ...readDotEnv(file), ...process.env };
}
