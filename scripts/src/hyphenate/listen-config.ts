import net from 'node:net';
import { loadEnv, type Env } from '../core/env.ts';
import { EASEMOB_REST_BASE } from '../core/constants.ts';
import { isAppKey, isId, easemobOrigin } from '../core/validate.ts';
import { buildNodeLoginTemplate, discoverImServers } from './bootstrap.ts';
import { loadTemplate } from './template.ts';

export async function loadListenConfig(env: Env = loadEnv(), useTemplate = false) {
  if (useTemplate) {
    const template = loadTemplate(env);
    return { template, source: 'env_template', restBase: easemobOrigin(env.HX_REST_BASE || EASEMOB_REST_BASE) };
  }
  const appKey = env.HX_APP_KEY || env.LITMATCH_HX_APP_KEY;
  const username = env.HX_USERNAME;
  if (!appKey || !isAppKey(appKey) || !username || !isId(username)) throw Error('Set HX_APP_KEY and HX_USERNAME');
  let host = env.HX_IM_HOST;
  let port = Number(env.HX_IM_PORT || 6717);
  let restBase = env.HX_REST_BASE;
  if (host) {
    if ((!net.isIP(host) && !/^[a-zA-Z0-9.-]+$/.test(host)) || !Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid HX_IM_HOST/HX_IM_PORT');
  } else {
    const discovery = await discoverImServers(appKey);
    const endpoint = discovery.endpoints[0]!;
    host = endpoint.host;
    port = endpoint.port;
    restBase ||= discovery.restBase ?? undefined;
  }
  const { template } = buildNodeLoginTemplate({ appKey, username, endpoint: { host, port }, clientUuid: env.HX_CLIENT_UUID });
  return { template, source: 'node_generated', restBase: easemobOrigin(restBase || EASEMOB_REST_BASE) };
}
