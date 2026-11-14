import fs from 'node:fs';
import { printJson, readJson, runCli } from '../core/cli.ts';
import { isPlainObject } from '../core/validate.ts';
import { postDetect, prepareFields, REQUIRED_QUERY, type EyePostResult } from '../lit/eye-device.ts';

const OPTIONS = ['--snapshot', '--overrides', '--config', '--response-json'] as const;
type Option = typeof OPTIONS[number];
const USAGE = `Usage: node src/cli/eye-device.ts ${OPTIONS.map(o => `${o} <file>`).join(' ')}`;

function parseCliArgs(argv: string[]): Record<Option, string> | null {
  if (argv.length === 1 && argv[0] === '--help') return null;
  const options: Partial<Record<Option, string>> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i]!;
    const value = argv[i + 1];
    if (!(OPTIONS as readonly string[]).includes(name) || !value || Object.hasOwn(options, name)) throw new Error(USAGE);
    options[name as Option] = value;
  }
  if (Object.keys(options).length !== OPTIONS.length) throw new Error(USAGE);
  return options as Record<Option, string>;
}

runCli(async () => {
  const options = parseCliArgs(process.argv.slice(2));
  if (!options) return console.log(USAGE);

  const snapshot = readJson(options['--snapshot']);
  const overrides = readJson(options['--overrides']);
  const config = readJson(options['--config']) as { query?: unknown };
  if (!isPlainObject(config.query)) throw new Error('config.query must be an object');
  const query = config.query;
  for (const key of REQUIRED_QUERY) {
    if (typeof query[key] !== 'string' || !query[key]) throw new Error(`missing query field: ${key}`);
  }
  const fields = prepareFields(snapshot, overrides);

  const fd = fs.openSync(options['--response-json'], 'wx', 0o600);
  let result: EyePostResult;
  try {
    result = await postDetect(fields, query);
    fs.writeSync(fd, JSON.stringify(result, null, 2) + '\n');
  } finally {
    fs.closeSync(fd);
  }
  const body = isPlainObject(result.body) ? result.body : null;
  const data = body && isPlainObject(body.data) ? body.data : null;
  printJson({
    httpStatus: result.httpStatus,
    fieldCount: Object.keys(fields).length,
    changedFields: Object.keys(overrides as object).filter(key => fields[key] !== (snapshot as Record<string, unknown>)[key]),
    result: body ? body.result ?? null : null,
    success: body ? body.success ?? null : null,
    dfpIdPresent: !!data?.dfpId,
  }, true);
});
