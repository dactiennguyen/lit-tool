// Response types for the Litmatch API.
//
// Derived from one real `user/get_info/me` response (see
// test/fixtures/user-info-me.example.json). Fields typed `unknown` were only
// ever seen as `null`; other responses may omit fields or add new ones, so
// treat these as a description of what we have seen, not a server contract.

/** File id on the Litmatch CDN (a UUID), not a URL. */
export type FileId = string;
/** Unix time in seconds. */
export type UnixSeconds = number;
/** 24-char hex object id, e.g. user ids. */
export type ObjectId = string;
export type Gender = 'boy' | 'girl' | (string & {});

/** Envelope shared by every Litmatch JSON response. */
export interface LitResponse<T> {
  success: boolean;
  /** 0 means accepted. */
  result: number;
  data: T;
  trace_id?: string | null;
  message?: string | null;
}

export interface LitFailure {
  success: false;
  result: number;
  data?: unknown;
  trace_id?: string | null;
  message?: string | null;
}

export type LitApiResponse<T> = (Omit<LitResponse<T>, 'success' | 'result'> & {
  success: true;
  result: 0;
}) | LitFailure;

export type UserInfo = Pick<UserInfoMe, 'user_id' | 'huanxin_id' | 'nickname' | 'avatar'> &
  Partial<Omit<UserInfoMe, 'user_id' | 'huanxin_id' | 'nickname' | 'avatar' | 'session' | 'huanxin'>> & {
    is_been_blocked?: boolean;
    accost_limit_gift_info?: unknown;
    cross_region?: boolean;
  };

export type OnlineUser = Omit<UserInfo, 'tags'> & {
  online?: boolean;
  party?: string;
  tags?: Array<Omit<UserTag, 'tag_type'> & { tag_type?: string }>;
  rec_reason?: string;
  recommend_tag?: string;
  recommend_tag_detail?: string;
  rec_debug_info?: string;
};

export interface OnlineUsersData {
  user_infos: OnlineUser[];
  has_next: boolean;
  next_start: number;
}

export interface OnlineUsersQuery {
  start_pos?: number;
  num?: number;
  from_page?: string;
}

export interface UserInfoQuery {
  from?: string;
  source?: string;
  is_zone?: number;
  is_mini_profile?: number;
}

export type UserInfoResponse = LitApiResponse<UserInfo>;
export type OnlineUsersResponse = LitApiResponse<OnlineUsersData>;
export type AccountInfoResponse = LitApiResponse<Wallet>;

// ---------- user/get_info/me ----------

export type UserInfoMeResponse = LitApiResponse<UserInfoMe>;

/** The logged-in account's own profile from `user/get_info/me?from=me&source=me`. */
export interface UserInfoMe {
  user_id: ObjectId;
  lit_id: number;
  nickname: string;
  avatar: FileId;
  gender: Gender;
  age: number;
  bio: string;
  is_default_bio: boolean;
  country: string;
  region: string;
  region_trans: string;
  ip_city: string;
  ip_country: string;
  mapping_region: MappingRegion | null;
  cover_photo: FileId | '';
  frame_fileid: FileId | '';
  frame_id: unknown;
  frame_expire_time: UnixSeconds;
  frame_bag_version: unknown;
  tag_str: string;
  tags: UserTag[];
  prefer_age_range: string;
  recommend_feed_img: string;

  birth_info: BirthInfo;
  /** YYYY-MM-DD */
  birthdate: string;
  birthdate_changed: boolean;
  /** RFC 1123 date, e.g. "Sun, 01 Jan 1989 00:00:00 GMT". */
  birthday: string;
  birthday_left_second: number;
  caled_birthdate: string;
  is_birthday: boolean;
  req_birthday_gift: boolean;
  today_birthday_gift: boolean;

  create_time: UnixSeconds;
  register_time: UnixSeconds;
  active_info: ActiveInfo;
  finished_info: boolean;
  is_first_login: boolean;
  role: number;
  admin: boolean;
  removed: boolean;
  blocked: boolean;
  starred: boolean;
  followed: boolean;
  be_followed: boolean;
  follower: number;
  following: number;
  polite_score: number;
  allow_global_match: number;
  conversation_source: string;

  /** Sensitive: the account's session token. Never log or display. */
  session: string;
  /** IM (Hyphenate) id, same as `huanxin.user_id`. */
  huanxin_id: string;
  /** Sensitive: IM login credentials (the hxPwd). Never log or display. */
  huanxin: HuanxinCredentials;
  bond_phone: boolean;
  is_email_bound: unknown;

  account_info: Wallet;
  is_vip: boolean;
  vip_time: number;
  vip_info: VipInfo;
  is_first_charge_vip: boolean;
  last_pay_ts: UnixSeconds;
  diamond_card_expiry: unknown;
  city_card_expire_time: UnixSeconds;
  nobility_info: NobilityInfo;
  is_high_value_user: boolean;

  change_nickname_count: number;
  change_nickname_normal_limit: number;
  change_nickname_vip_limit: number;

  male_accost_enabled: boolean;
  male_accost_free_num: number;
  moi_hot: boolean;
  moi_value: number;
  mood_status_info: MoodStatusInfo;

  party_name: string;
  party_member_num: number;
  party_top_three: number;
  party_level_info: PartyLevelInfo;
  is_first_create_party: boolean;
  new_party: unknown;
  on_mic: boolean;

  collector_info: CollectorInfo;
  feed_growth_level_info: FeedGrowthLevelInfo;
  inspiration_banner: InspirationBanner;
  intimate_friend_info: IntimateFriendInfo;
  family_info: Record<string, unknown>;
  lover_info: Record<string, unknown>;
  material_sentence: Record<string, unknown>;
  precious_no_info: Record<string, unknown>;
  resource_info: ResourceInfo;
  toys: Toys;
  wearing_toy: Record<string, unknown>;
  ext_info: ExtInfo;

  is_chat_bot: boolean;
  is_feedback_bot: boolean;
  is_official_push_account: boolean;
  is_digital_avatar: boolean;
  is_toy_avatar: boolean;
  is_got_regulation: boolean;
}

export interface MappingRegion {
  id: string;
  name: string;
}

export interface UserTag {
  tag_id: ObjectId;
  tag_name: string;
  tag_type?: string;
}

export interface BirthInfo {
  year: number;
  month: number;
  day: number;
}

export interface ActiveInfo {
  time: UnixSeconds;
  time_desc: string;
  show_light: boolean;
}

export interface HuanxinCredentials {
  user_id: string;
  password: string;
}

/** `account_info` inside the profile: balances, not the `account/account_info` endpoint. */
export interface Wallet {
  diamonds: number;
  stars: number;
  frozen_diamonds: number;
  amethysts: number;
  video_member_time: number;
  match_membership_time: number;
  is_first_charge_diamonds: boolean;
}

export interface VipInfo {
  level: number;
  expire_time: UnixSeconds;
  expire_time_checkpoint: UnixSeconds;
  level_maintain_review_time: UnixSeconds;
  show_vip_status: number;
  init_flag: boolean;
}

export interface NobilityInfo {
  max_nobility: unknown;
  nobility_icon: FileId | '';
  number: number;
}

export interface MoodStatusInfo {
  name: string;
  mood_name: string;
  icon: FileId;
  expire_time: UnixSeconds;
  is_show: boolean;
}

export interface PartyLevelInfo {
  sent: PartyLevelSide;
  received: PartyLevelSide;
}

export interface PartyLevelSide {
  diamonds: number;
  level: number;
  avatar: FileId;
  new_diamonds: number;
  accelerate_diamonds?: number;
}

/** Compact user card embedded in other objects. */
export interface UserBrief {
  user_id: ObjectId;
  lit_id: number;
  nickname: string;
  avatar: FileId;
  real_avatar: FileId;
  gender: Gender;
  age: number;
  bio: string | null;
  country: string;
  ip_country: string;
  huanxin_id: string;
  frame_fileid: FileId | '';
  is_adult: boolean;
  vip: boolean;
}

export interface CollectorInfo {
  collection_points: number;
  collection_rank: number;
  collector_level: number;
  collector_level_bkg: FileId;
  collector_level_icon: FileId;
  collector_level_trans: string;
  light_up_catalog_number: number;
  whole_catalog_number: number;
  user_info: UserBrief;
}

export interface FeedGrowthLevelInfo {
  level: number;
  /** CSS hex color, e.g. "#959CB1". */
  level_color: string;
}

export interface InspirationBanner {
  id: ObjectId;
  activity_name: string;
  banner_url: string;
  region: string;
  title: string;
  sub_title: string;
  btn_text: string;
  /** App deep link (litmatch://...). */
  jump_url: string;
  start_time: UnixSeconds;
  end_time: UnixSeconds;
  post_count: string;
  post_count_text: string;
}

export interface IntimateFriendInfo {
  /** Only seen empty. */
  friends: unknown[];
}

export interface ResourceInfo {
  chat_bubble_info: Record<string, unknown>;
  profile_card_info: Record<string, unknown>;
  super_avatar_info: Record<string, unknown>;
  zone_effect_info: Record<string, unknown>;
}

export interface Toys {
  gifts: ToyGift[];
  total_count: number;
  unlock_count: number;
}

export interface ResourceLevelInfo {
  level: number;
  /** Rarity label, e.g. "SSR", "SSSR". */
  name: string;
  icon: string;
  icon_v2: FileId;
  background: string;
  foreground: unknown[];
}

export interface ToyGift {
  id: ObjectId;
  resource_id: ObjectId;
  resource_short_id: string;
  resource_type: string;
  resource_type_name: string;
  resource_sub_type: unknown;
  resource_style: number;
  resource_level: number;
  resource_level_info: ResourceLevelInfo;
  related_resource_name: string;
  name: string;
  name_tag: string;
  title: string;
  title_user_id: string;
  title_user_info: Record<string, unknown>;
  desc: string;
  description: string;
  description_tag: string;
  intro_info: { desc: string };
  banner_name: string;
  remark: unknown;

  fileid: FileId;
  thumbnail: FileId;
  toy_card_fileid: FileId;
  background_frame_fileid: FileId;
  digital_avatar_fileid: FileId;
  vap_fileid: FileId;
  vap_file_md5: string;
  zone_accompany_entry_fileid: FileId;
  zone_accompany_standby_fileid: FileId;

  price: number;
  price_unit: string;
  toy_level: number;
  vip_level_required: number;
  collection_threshold: number;
  digital_avatar_level: number;
  digital_avatar_threshold: number;
  zone_accompany_level: number;
  zone_accompany_threshold: number;
  min_threshold: unknown;
  current_attraction_value: number;
  max_attraction_value: number;
  receive_gift_attraction_value: number;
  current_heart: number;
  max_heart: number;
  recycle_probability: number;
  recycle_probability_key: unknown;

  in_collection: boolean;
  is_unlock: boolean;
  is_show: boolean;
  is_permanent: boolean;
  is_whole_region: boolean;
  is_bag_valid_enabled: boolean;
  is_separate_bag_expire_time: boolean;
  is_exchange_for_amethyst: boolean;
  is_show_time_enable: boolean;
  is_sync_to_online: boolean;
  is_synced_to_online: boolean;
  bag_valid_day: number;
  acquire_limit: string;
  acquire_limit_desc: string;
  customized_gift_sign: string;
  show_time: Record<string, unknown>;
  offline: unknown;

  suit_id: ObjectId;
  theme: string;
  theme_element: string;
  theme_style: string;
  theme_tags: string[];
  style_tags: string[];
  top_region: string[];
  using_region: string[];
  android_version: string;
  ios_version: string;

  /** "YYYY-MM-DD HH:MM:SS.ffffff" (server local time). */
  create_time: string;
  create_ts: UnixSeconds;
  last_modify_time: UnixSeconds;
  last_top_time: UnixSeconds;
}

export interface GameRecord {
  claw_carnival: boolean;
  diamond_slot_v2_ext: boolean;
  dice_war: boolean;
  fishing_kitten: boolean;
  fortune_football: boolean;
  lion_tiger: boolean;
  sky_wheel: boolean;
  texas_cowboy: boolean;
}

export interface ExtInfo {
  last_light_id: unknown;
  last_light_expired_ts: UnixSeconds;
  choose_loc_source: number;
  modify_loc_source: number;
  change_loc_siua_status: number;
  cca_id: unknown;
  feedback_bot_tag: string;
  /** Capital B as sent by the server. */
  feedBack_bot_nickname: string;
  memory: string;
  underage_ad_policy: number;
  game_record: GameRecord;
}
