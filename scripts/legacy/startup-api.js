#!/usr/bin/env node
'use strict';

const {
  loadEnvProfile, loadJsonProfile, loadQuery,
  buildGetRequest, fetchGet, savePrivateResponse
} = require('./common');

const ENDPOINTS = new Set([
  'user/get_info/:id', 'home/settings_v2', 'feed/tags', 'home/init_resources',
  'feed/feed_page_structure', 'feed/following_feeds', 'account/get_subscribe_product_ids',
  'user/message_notifications_v3', 'feed/hq', 'feed/get_daily_festival_effects',
  'home/acted_actions', 'account/account_info', 'meet_bell/status', 'ad/times_left',
  'user/user_contact_info', 'user/get_position_info', 'gift/gifts_v2', 'privacy/setting',
  'home/check_version', 'user/self_in_app_msg', 'account/new_diamonds_product',
  'resources/prefetch', 'party/get_direct_enter_party_list', 'splash/load_resource'
]);

const HELP = `Usage:
  node scripts/startup-api.js --list
  node scripts/startup-api.js <endpoint> [--send] [--save] [--query-file <json>]
  node scripts/startup-api.js <endpoint> --profile <private-json> [--send] [--save]

By default reads LIT_SID, LIT_UUID, LIT_VERSION, LIT_PLATFORM from scripts/.env
(tùy chọn LIT_USER_ID, LIT_DFPID, LIT_BASE_URL). Mọi request được ký mặc định
(litSign/ts/litTime/sts-sign/X-Application-Info + X-SIUA tự tạo bằng siua();
X-DFPID chỉ gửi nếu có LIT_DFPID trong .env).
Without --send only a preview is printed; --save stores the response in .private/.`;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (['--list', '--help', '--send', '--save'].includes(arg)) {
      args[arg.slice(2)] = true;
    } else if (['--query-file', '--profile', '--env-file'].includes(arg)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw Error('Thiếu giá trị cho ' + arg);
      args[arg.slice(2)] = argv[++i];
    } else if (!arg.startsWith('-') && !args.endpoint) {
      args.endpoint = arg;
    } else throw Error('Đối số không hợp lệ');
  }
  return args;
}

async function getEndpoint(endpoint, { profile = loadEnvProfile(), query = {} } = {}) {
  if (!ENDPOINTS.has(endpoint)) throw Error('Endpoint không nằm trong danh sách đã quan sát');
  return fetchGet(buildGetRequest(endpoint, profile, query));
}

async function getAccountInfo(options = {}) {
  return getEndpoint('account/account_info', options);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(HELP);
  if (args.list) return console.log([...ENDPOINTS].join('\n'));
  if (!ENDPOINTS.has(args.endpoint)) throw Error('Endpoint không nằm trong danh sách đã quan sát');
  if (args.save && !args.send) throw Error('--save cần --send');
  if (args.profile && args['env-file']) throw Error('--profile không dùng cùng --env-file');

  const profile = args.profile ? loadJsonProfile(args.profile) : loadEnvProfile(args['env-file']);
  const request = buildGetRequest(args.endpoint, profile, loadQuery(args['query-file']));
  if (!args.send) {
    return console.log(JSON.stringify({
      mode: 'preview', method: 'GET', endpoint: args.endpoint, host: request.url.host,
      query_keys: [...request.url.searchParams.keys()], session_present: true, body: false,
      header_names: Object.keys(request.headers)
    }, null, 2));
  }

  const { summary, body } = await fetchGet(request);
  if (args.save) summary.saved_private_response = savePrivateResponse(body);
  console.log(JSON.stringify(summary, null, 2));
}

module.exports = { getAccountInfo, getEndpoint };

if (require.main === module) {
  main().catch(error => {

    console.error(JSON.stringify({ error: error instanceof TypeError ? 'network_or_response_error' :
      (error.name === 'TimeoutError' ? 'request_timeout' : error.message) }));
    process.exitCode = 1;
  });
}
