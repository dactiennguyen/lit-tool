import { fetchGet, type LitResponse } from './client.ts';
import { loadEnvProfile, type LitProfile, type Query } from './profile.ts';
import { buildGetRequest } from './request.ts';

export const STARTUP_ENDPOINTS: ReadonlySet<string> = new Set([
  'user/get_info/:id', 'home/settings_v2', 'feed/tags', 'home/init_resources',
  'feed/feed_page_structure', 'feed/following_feeds', 'account/get_subscribe_product_ids',
  'user/message_notifications_v3', 'feed/hq', 'feed/get_daily_festival_effects',
  'home/acted_actions', 'account/account_info', 'meet_bell/status', 'ad/times_left',
  'user/user_contact_info', 'user/get_position_info', 'gift/gifts_v2', 'privacy/setting',
  'home/check_version', 'user/self_in_app_msg', 'account/new_diamonds_product',
  'resources/prefetch', 'party/get_direct_enter_party_list', 'splash/load_resource',
]);

export function assertStartupEndpoint(endpoint: unknown): asserts endpoint is string {
  if (typeof endpoint !== 'string' || !STARTUP_ENDPOINTS.has(endpoint)) {
    throw Error('Endpoint không nằm trong danh sách đã quan sát');
  }
}

export async function getEndpoint(endpoint: string,
  { profile = loadEnvProfile(), query = {} }: { profile?: LitProfile; query?: Query } = {}): Promise<LitResponse> {
  assertStartupEndpoint(endpoint);
  return fetchGet(buildGetRequest(endpoint, profile, query));
}

export const getAccountInfo = (options: { profile?: LitProfile; query?: Query } = {}): Promise<LitResponse> =>
  getEndpoint('account/account_info', options);
