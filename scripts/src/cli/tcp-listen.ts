import { parseArgs } from 'node:util';
import { printJson, runCli } from '../core/cli.ts';
import { loadEnv } from '../core/env.ts';
import { parseIntInRange } from '../core/validate.ts';
import { loadListenConfig } from '../hyphenate/listen-config.ts';
import { listenTcp, ListenError } from '../hyphenate/listener.ts';
import { ensureAccessToken } from '../hyphenate/token.ts';

runCli(async () => {
  const { values } = parseArgs({ options: { seconds: { type: 'string', default: '900' },
    'heartbeat-seconds': { type: 'string', default: '30' }, 'show-content': { type: 'boolean' },
    template: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('node scripts/tcp-listen.js [--seconds 900] [--heartbeat-seconds 30] [--show-content] [--template] [--dry-run]\nDirect Node TCP listener, no ADB. Requires HX_APP_KEY, HX_USERNAME, HX_PASSWORD or HX_ACCESS_TOKEN.\nOptional HX_IM_HOST/HX_IM_PORT (otherwise discovery), HX_REST_BASE, HX_CLIENT_UUID.\n--template explicitly uses HX_LOGIN_TEMPLATE_B64 instead of generating a Node login.\nJSONL to stdout only; no env/file writes, no chat sends. Queue sync can consume pending delivery; no read receipts.');
    return;
  }
  const seconds = parseIntInRange(values.seconds, 1, 86400, 'seconds');
  const heartbeat = parseIntInRange(values['heartbeat-seconds'], 5, 300, 'heartbeat-seconds');
  const env = loadEnv();
  if (!values['dry-run'] && !env.HX_PASSWORD && !env.HX_ACCESS_TOKEN) throw Error('Set HX_PASSWORD or HX_ACCESS_TOKEN');
  const { template, source, restBase } = await loadListenConfig(env, values.template);
  printJson({ event: 'listen_config', username: template.username, host: template.host, port: template.port,
    templateSource: source, authSource: env.HX_ACCESS_TOKEN ? 'supplied_token' : env.HX_PASSWORD ? 'password' : 'missing',
    seconds, heartbeatSeconds: heartbeat });
  if (values['dry-run']) return;
  const accessToken = await ensureAccessToken({ appKey: template.appKey, username: template.username,
    restBase, password: env.HX_PASSWORD, accessToken: env.HX_ACCESS_TOKEN });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const result = await listenTcp({ template, accessToken, durationMs: seconds * 1000, heartbeatMs: heartbeat * 1000,
      showContent: values['show-content'], signal: controller.signal, onEvent: printJson });
    printJson({ event: 'listen_complete', ...result });
  } catch (e) {
    if (e instanceof ListenError) printJson({ event: 'listen_failed', error: e.message, ...e.summary });
    throw e;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
});
