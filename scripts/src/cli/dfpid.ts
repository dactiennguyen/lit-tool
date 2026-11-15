import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { printJson, readJson, runCli } from '../core/cli.ts';
import { fetchDfpId, parseDfpInput, randomizeDfpInput } from '../lit/dfpid.ts';
import { isPlainObject } from '../core/validate.ts';

const USAGE = 'Usage: npm run dfpid -- --input <config.json> --output <token.json> [--device <devices_info.json>] [--random]';

runCli(async () => {
  const { values } = parseArgs({ options: {
    input: { type: 'string' }, output: { type: 'string' }, device: { type: 'string' },
    random: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) return console.log(USAGE);
  if (!values.input || !values.output) throw Error(USAGE);
  const config = readJson(values.input, 'Cannot read device input JSON');
  if (!isPlainObject(config)) throw Error('Input JSON must be an object');
  const devicePath = values.device ?? (values.random ? fileURLToPath(new URL('../../devices_info.json', import.meta.url)) : undefined);
  const source = devicePath ? { ...config, fields: readJson(devicePath, 'Cannot read device fields JSON') } : config;
  const input = values.random ? randomizeDfpInput(source) : parseDfpInput(source);
  const output = values.output;
  const fd = fs.openSync(output, 'wx', 0o600);
  try {
    const token = await fetchDfpId(input);
    fs.writeFileSync(fd, JSON.stringify(values.random ? { ...token, ...input } : token, null, 2) + '\n');
    printJson({ accepted: true, output, randomized: !!values.random, fieldCount: Object.keys(input.fields).length,
      dfpIdLength: token.dfpId.length, exp: token.exp, expiresAt: new Date(token.exp).toISOString(), ver: token.ver }, true);
  } catch (error) {
    fs.closeSync(fd);
    fs.unlinkSync(output);
    throw error;
  }
  fs.closeSync(fd);
}, error => {
  const message = error instanceof Error ? error.message : '';
  console.error(message.startsWith('Eye ') || message === USAGE ? message :
    'DFPID request failed: check input JSON, output path (must not exist), and connection. Existing files were not overwritten.');
});
