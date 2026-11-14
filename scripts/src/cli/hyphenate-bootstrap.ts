import { parseArgs } from 'node:util';
import { runCli, printJson } from '../core/cli.ts';
import { loadEnv } from '../core/env.ts';
import { EASEMOB_REST_BASE } from '../core/constants.ts';
import { easemobOrigin, isAppKey, isId, parseIntInRange } from '../core/validate.ts';
import { buildNodeLoginTemplate, discoverImServers } from '../hyphenate/bootstrap.ts';
import { connectAndCheck } from '../hyphenate/connection.ts';
import { requestUserToken } from '../hyphenate/token.ts';

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    help: { type: 'boolean', short: 'h' }, check: { type: 'boolean', default: false },
    index: { type: 'string', default: '0' },
  } });
  if (values.help) {
    console.log([
      'Usage: node --env-file=scripts/.env scripts/hyphenate-bootstrap.js [--check] [--index 0]',
      'Requires HX_USERNAME and HX_APP_KEY in .env or environment.',
      '--check also requires HX_PASSWORD (IM hxPwd) or HX_ACCESS_TOKEN. No chat is sent.',
      'Fetches discovery, builds a new v6 Node client template, prints HX_* values as JSON.',
      'Does not read a captured template or require Android, ADB or Frida.',
      'Optional HX_CLIENT_UUID reuses your Node client identity; otherwise creates a new UUID.',
      '--index selects the deduplicated discovery endpoint, in server order. No automatic retries.',
      'Only reads configuration; creates no files and never modifies .env. Password/token are not printed.',
    ].join('\n'));
    return;
  }
  const env = loadEnv();
  const appKey = env.HX_APP_KEY;
  const username = env.HX_USERNAME;
  if (!isAppKey(appKey)) throw Error('Set HX_APP_KEY in .env (format: org#app)');
  if (!isId(username)) throw Error('Set HX_USERNAME to your IM username');
  if (values.check && !env.HX_PASSWORD && !env.HX_ACCESS_TOKEN) throw Error('--check requires HX_PASSWORD or HX_ACCESS_TOKEN');
  const index = parseIntInRange(values.index, 0, 1000, '--index');
  const discovery = await discoverImServers(appKey);
  printJson({ event: 'discovery', ...discovery });
  const endpoint = discovery.endpoints[index];
  if (!endpoint) throw Error('--index exceeds available endpoints');
  const { template, clientUuid } = buildNodeLoginTemplate({ appKey, username, endpoint,
    ...(env.HX_CLIENT_UUID ? { clientUuid: env.HX_CLIENT_UUID } : {}) });
  const restBase = easemobOrigin(env.HX_REST_BASE || discovery.restBase || EASEMOB_REST_BASE);
  if (values.check) {
    let token = env.HX_ACCESS_TOKEN;
    if (!token) token = (await requestUserToken({ appKey, username, password: env.HX_PASSWORD, restBase })).accessToken;
    await connectAndCheck({ template, accessToken: token, onEvent: printJson });
  }
  const output = {
    HX_APP_KEY: appKey, HX_USERNAME: username, HX_IM_HOST: endpoint.host, HX_IM_PORT: String(endpoint.port),
    HX_REST_BASE: restBase, HX_CLIENT_UUID: clientUuid, HX_LOGIN_TEMPLATE_B64: template.payload.toString('base64'),
  };
  printJson({ event: 'bootstrap_complete', ...output, username, ...endpoint,
    templateBytes: template.payload.length, checked: values.check, chatSent: false });
}

runCli(main);
