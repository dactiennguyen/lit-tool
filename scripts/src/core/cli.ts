import fs from 'node:fs';

export const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export function runCli(main: () => unknown, onError: (error: unknown) => void = error => console.error(errorMessage(error))): void {
  Promise.resolve().then(main).catch(error => {
    onError(error);
    process.exitCode = 1;
  });
}

export function printJson(value: unknown, pretty = false): void {
  console.log(pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value));
}

export function printBody(body: Buffer, rawFallback: boolean): void {
  const text = body.toString('utf8');
  try { console.log(JSON.stringify(JSON.parse(text), null, 2)); }
  catch { if (rawFallback) console.log(text); }
}

export function readJson(file: string, message?: string): unknown {
  if (message === undefined) return JSON.parse(fs.readFileSync(file, 'utf8'));
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw Error(message); }
}
