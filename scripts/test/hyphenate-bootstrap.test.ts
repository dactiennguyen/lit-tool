import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildNodeLoginTemplate, discoverImServers, parseDiscovery } from '../src/hyphenate/bootstrap.ts';
import { buildLoginFrame, loadTemplate } from '../src/hyphenate/template.ts';
import { bytesField, getField, readFields } from '../src/hyphenate/fields.ts';
import { HX_APP_KEY, HX_USERNAME, withFetch } from './helpers.ts';
import { easemobOrigin } from '../src/core/validate.ts';
import { requestUserToken } from '../src/hyphenate/token.ts';

const uuid = '12345678-1234-4234-8234-123456789abc';
const endpoint = { host: 'im.example.com', port: 6717 };
const config = {
  cluster_name: 'sgp',
  'msync-im': { hosts: [
    { domain: 'im.example.com', port: '6717' },
    { domain: 'im.example.com', port: '6717' },
    { ip: '192.0.2.1', domain: 'im.example.com', port: '443' },
    { domain: 'invalid/host', port: '80' },
    { domain: 'im.example.com', port: 65536 },
  ] },
  rest: { hosts: [
    { domain: 'example.com', protocol: 'https', port: '443' },
    { domain: 'a1-sgp.easemob.com', protocol: 'http', port: '80' },
    { domain: 'a1-sgp.easemob.com', protocol: 'https', port: '443' },
  ] },
};

test('discovery deduplicates in server order and separates REST from TCP', () => {
  assert.deepEqual(parseDiscovery(config), {
    endpoints: [endpoint, { host: '192.0.2.1', port: 443 }],
    restBase: 'https://a1-sgp.easemob.com', cluster: 'sgp',
  });
  for (const invalid of [null, {}, { 'msync-im': { hosts: [] } }]) assert.throws(() => parseDiscovery(invalid));
});

test('easecdn REST from discovery is accepted by the token client', async () => {
  const discovery = parseDiscovery({ ...config, rest: { hosts: [
    { domain: 'a1-sgp-ga.easecdn.com', protocol: 'https', port: '443' },
  ] } });
  assert.equal(discovery.restBase, 'https://a1-sgp-ga.easecdn.com');
  const result = await withFetch(req => {
    assert.equal(new URL(req.url).origin, discovery.restBase);
    return Response.json({ access_token: 'test-token' });
  }, () => requestUserToken({ appKey: HX_APP_KEY, username: HX_USERNAME,
    password: 'test-password', restBase: discovery.restBase! }));
  assert.equal(result.result.ok, true);
  assert.equal(result.calls.length, 1);
  for (const url of ['https://easecdn.com.evil.example', 'https://fakeeasecdn.com',
    'http://a1-sgp.easecdn.com', 'https://a1-sgp.easecdn.com:8443', 'https://user@a1-sgp.easecdn.com']) {
    assert.throws(() => easemobOrigin(url));
  }
});

test('discovery sends encoded app key without credentials; rejects HTTP and JSON errors', async () => {
  const result = await withFetch(req => {
    const url = new URL(req.url);
    assert.equal(url.origin + url.pathname, 'https://rs.easemob.com/easemob/server.json');
    assert.equal(url.searchParams.get('app_key'), HX_APP_KEY);
    assert.ok(url.searchParams.get('_v'));
    assert.equal(req.headers.authorization, undefined);
    return new Response(JSON.stringify(config));
  }, () => discoverImServers(HX_APP_KEY));
  assert.equal(result.result.ok, true);
  assert.equal(result.calls.length, 1);
  for (const response of [new Response('{}', { status: 500 }), new Response('not json')]) {
    const failed = await withFetch(() => response, () => discoverImServers(HX_APP_KEY));
    assert.equal(failed.result.ok, false);
  }
});

test('fresh Node template works with existing loader and v6 token injection', () => {
  const built = buildNodeLoginTemplate({ appKey: HX_APP_KEY, username: HX_USERNAME, endpoint,
    clientUuid: uuid, platform: 'linux', now: 1700000000000 });
  const loaded = loadTemplate({ HX_LOGIN_TEMPLATE_B64: built.template.payload.toString('base64'),
    HX_IM_HOST: endpoint.host, HX_IM_PORT: String(endpoint.port), HX_USERNAME });
  assert.equal(loaded.username, HX_USERNAME);
  assert.equal(loaded.appKey, HX_APP_KEY);
  const outer = readFields(loaded.payload);
  const body = readFields(bytesField(outer, 9));
  assert.equal(String(getField(body, 1)), '2');
  assert.equal(bytesField(body, 9).toString(), uuid);
  assert.equal(bytesField(body, 13).toString(), `node_${uuid}`);
  assert.equal(bytesField(body, 17).toString(), 'v6.0');
  assert.equal(bytesField(body, 20).toString(), '1700000000000:');
  assert.deepEqual(JSON.parse(bytesField(body, 18).toString()), { token: '' });
  const framed = buildLoginFrame(loaded, 'test-token');
  assert.equal(framed.readUInt32BE(0), framed.length - 4);
  const sent = readFields(bytesField(readFields(framed.subarray(4)), 9));
  assert.deepEqual(JSON.parse(bytesField(sent, 18).toString()), { token: '$t$test-token' });
  assert.deepEqual(JSON.parse(bytesField(body, 18).toString()), { token: '' });
  assert.throws(() => buildNodeLoginTemplate({ appKey: HX_APP_KEY, username: 'invalid\nuser', endpoint }));
});
