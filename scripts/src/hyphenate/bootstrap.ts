import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { readLimited, safeFetch } from '../core/http.ts';
import { easemobOrigin, isAppKey, isId, isPlainObject } from '../core/validate.ts';
import { bytesValue, uintField, writeFields } from './fields.ts';
import type { LoginTemplate } from './template.ts';

export const HX_DISCOVERY_URL = 'https://rs.easemob.com/easemob/server.json';

export interface ImEndpoint { host: string; port: number }
export interface ImDiscovery {
  endpoints: ImEndpoint[];
  restBase: string | null;
  cluster: string | null;
}

export function parseDiscovery(value: unknown): ImDiscovery {
  if (!isPlainObject(value)) throw Error('Invalid discovery response');
  const group = value['msync-im'];
  if (!isPlainObject(group) || !Array.isArray(group.hosts)) throw Error('Discovery has no msync-im hosts');
  const endpoints: ImEndpoint[] = [];
  const seen = new Set<string>();
  for (const entry of group.hosts) {
    if (!isPlainObject(entry)) continue;
    const host = entry.ip || entry.domain;
    const port = Number(entry.port);
    if (typeof host !== 'string' || !host || (!net.isIP(host) &&
        !/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(host)) ||
        !Number.isInteger(port) || port < 1 || port > 65535) continue;
    const key = JSON.stringify([host, port]);
    if (!seen.has(key)) { endpoints.push({ host, port }); seen.add(key); }
  }
  if (!endpoints.length) throw Error('Discovery has no valid TCP endpoints');
  let restBase: string | null = null;
  if (isPlainObject(value.rest) && Array.isArray(value.rest.hosts)) {
    for (const entry of value.rest.hosts) {
      if (!isPlainObject(entry) || entry.protocol !== 'https' || Number(entry.port) !== 443 || typeof entry.domain !== 'string') continue;
      try { restBase = easemobOrigin(`https://${entry.domain}`); break; } catch { continue; }
    }
  }
  return { endpoints, restBase, cluster: typeof value.cluster_name === 'string' ? value.cluster_name : null };
}

export async function discoverImServers(appKey: string): Promise<ImDiscovery> {
  if (!isAppKey(appKey)) throw Error('Invalid HX_APP_KEY');
  const url = new URL(HX_DISCOVERY_URL);
  url.searchParams.set('app_key', appKey);
  url.searchParams.set('_v', String(Date.now()));
  const response = await safeFetch(url);
  if (!response.ok) throw Error(`IM discovery failed (HTTP ${response.status})`);
  const raw = await readLimited(response, 1024 * 1024, 'Discovery response exceeds 1 MiB');
  let value: unknown;
  try { value = JSON.parse(raw.toString('utf8')); } catch { throw Error('Invalid discovery JSON'); }
  return parseDiscovery(value);
}

export function buildNodeLoginTemplate({ appKey, username, endpoint, clientUuid = randomUUID(),
  platform = process.platform, now = Date.now() }: {
    appKey: string; username: string; endpoint: ImEndpoint; clientUuid?: string;
    platform?: NodeJS.Platform; now?: number;
  }): { template: LoginTemplate; clientUuid: string } {
  if (!isAppKey(appKey)) throw Error('Invalid HX_APP_KEY');
  if (!isId(username)) throw Error('Missing or invalid HX_USERNAME');
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(clientUuid)) throw Error('Invalid HX_CLIENT_UUID');
  if (!Number.isSafeInteger(now) || now < 0) throw Error('Invalid session timestamp');
  const resource = `node_${clientUuid}`;
  const osType = platform === 'darwin' ? 3 : platform === 'win32' ? 4 : platform === 'linux' ? 2 : 16;
  const identity = writeFields([bytesValue(1, appKey), bytesValue(2, username),
    bytesValue(3, 'easemob.com'), bytesValue(4, resource)]);
  const provision = writeFields([
    uintField(1, osType), bytesValue(2, '5.2.0'), uintField(5, 0), uintField(6, 0),
    bytesValue(9, clientUuid), bytesValue(12, 'Node.js'), bytesValue(13, resource),
    bytesValue(17, 'v6.0'), bytesValue(18, JSON.stringify({ token: '' })), bytesValue(20, `${now}:`),
  ]);
  const payload = writeFields([uintField(1, 0), bytesValue(2, identity), uintField(8, 3),
    bytesValue(9, provision), uintField(10, 0), uintField(11, 0)]);
  return { template: { appKey, username, ...endpoint, payload }, clientUuid };
}
