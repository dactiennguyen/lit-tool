import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  ChatMessage,
  Conversation,
  FeedPage,
  HistoryPage,
  OnlineUsersPage,
  SavedConversation,
  SendOutcome,
  UserProfile,
  Wallet,
} from "./lit-types";

export interface Account {
  id: string;
  label: string;
  userId: string | null;
  deviceUuid: string;
  version: string;
  dfpid: string | null;
  device?: DeviceSetup | null;
  deviceEnabled: boolean;
  createdAt: number;
  sessionSavedAt: number | null;
  /** IM identity saved from the profile at login; the password stays in the keychain. */
  im: ImIdentity | null;
}

export interface ImIdentity {
  username: string;
  savedAt: number;
}

/** Where the live chat connection of an account stands (listen.rs `LiveState`). Times in ms since the epoch. */
export type LiveState =
  | { state: "connecting" }
  | { state: "live"; since: number }
  | { state: "retrying"; at: number; message: string; retryAt: number }
  /** `message` null: stopped by the user. */
  | { state: "stopped"; at: number; message: string | null };

/** `accounts_export`: accounts written to the file, and those left out for lack of a sid. */
export interface ExportReport {
  exported: number;
  skipped: string[];
}

/** `accounts_import`: labels added, skipped (device UUID already here) and failed with the reason. */
export interface ImportReport {
  added: string[];
  skipped: string[];
  failed: [string, string][];
}

/** "hx-status" event payload. */
export type LiveStatusEvent = { accountId: string } & LiveState;

/** "hx-log" event payload: one frame in or out of the live connection (never a token or message text). */
export interface LiveLogEvent {
  accountId: string;
  at: number;
  dir: "in" | "out";
  /** Frame size, length prefix included. */
  bytes: number;
  /** login, unread, notice, sync, send, ack, logout, unsupported, unknown. */
  kind: string;
  summary: string;
  /** Name and value pairs for the details. */
  info: [string, string][];
  /** The whole frame as a field tree, secrets masked. */
  data: string;
}

/** "http-log" event payload (http.rs): one HTTP request and its response, every secret shown as "•••". */
export interface HttpLogEvent {
  /** Null for requests of no account (the server list). */
  accountId: string | null;
  at: number;
  service: string;
  method: string;
  origin: string;
  path: string;
  query: [string, string][];
  requestHeaders: [string, string][];
  /** JSON pretty-printed; Litmatch bodies decrypted. Empty when there is none. */
  requestBody: string;
  status: number | null;
  ms: number;
  bytes: number | null;
  responseHeaders: [string, string][];
  responseBody: string;
  error: string | null;
}

/** "hx-message" event payload: a new chat message heard on the live connection. */
export interface LiveMessageEvent {
  accountId: string;
  /** The peer's IM ID (one-to-one) or the group ID. */
  conversationId: string;
  /** 0 one-to-one, 1 group. */
  conversationType: 0 | 1;
  message: ChatMessage;
}

/** `hx_probe_servers`: each saved server and whether a TCP connection to it opens (no login). */
export interface ServersReport {
  appKey: string;
  restBase: string;
  cluster: string | null;
  fetchedAt: number | null;
  servers: {
    host: string;
    port: number;
    /** The server chat connects to (the first of the list). */
    inUse: boolean;
    reachable: boolean;
    ms: number | null;
    error: string | null;
  }[];
}

export interface NewAccount {
  label: string;
  deviceUuid?: string;
  version: string;
  dfpid?: string | null;
  sid: string;
  device?: DeviceSetup;
  deviceEnabled?: boolean;
}

export interface AccountPatch {
  deviceUuid?: string;
  label?: string;
  version?: string;
  dfpid?: string | null;
  sid?: string;
  device?: DeviceSetup;
  deviceEnabled?: boolean;
}

export interface DeviceSetup {
  deviceUuid: string;
  dfpId: string;
  version: string;
  exp: number;
  ver: string;
  fields: Record<string, string | number | boolean>;
}

export interface DeviceRequest {
  deviceUuid?: string;
  accountId?: string;
  sid?: string;
  version: string;
  fields?: DeviceSetup["fields"];
  random: boolean;
}

export interface AppSettings {
  apiBaseUrl: string;
  /** Easemob app key (org#app) of the chat server, shared by every account. */
  imAppKey: string;
  /** Connect to the chat server right after an account logs in. */
  autoConnectTcp: boolean;
  /** Server list fetched for the app key on first use and reused; null until then. */
  imServers: SavedImServers | null;
}

export interface SavedImServers {
  appKey: string;
  /** TCP endpoints; the first one is used. */
  endpoints: { host: string; port: number }[];
  restBase: string | null;
  cluster: string | null;
  fetchedAt: number;
}

export type SettingsPatch = Partial<Pick<AppSettings, "apiBaseUrl" | "imAppKey" | "autoConnectTcp">>;

export const DEFAULT_API_BASE_URL = "https://www.litatom.com";
export const DEFAULT_IM_APP_KEY = "1102190223222824#lit";
/** REST base when the server list names none (hx::DEFAULT_REST_BASE). */
export const DEFAULT_IM_REST_BASE = "https://a1-sgp-ga.easecdn.com";

/** The saved server list, when it belongs to the current app key. */
export function chatServer(settings: AppSettings): SavedImServers | null {
  return settings.imServers && settings.imServers.appKey === settings.imAppKey ? settings.imServers : null;
}

/** The feeds the app shows (lit.rs `FeedKind`). */
export type FeedKind = "Trends" | "Associate";

export class ApiError extends Error {}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new ApiError("Đang chạy trong trình duyệt. Mở bằng `npm run tauri dev` để dùng dữ liệu thật.");
  }
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new ApiError(typeof e === "string" ? e : e instanceof Error ? e.message : "Lỗi không xác định");
  }
}

export const api = {
  device: {
    generate: (input: DeviceRequest) => call<DeviceSetup>("device_generate", { input }),
  },
  accounts: {
    list: () => call<Account[]>("accounts_list"),
    add: (input: NewAccount) => call<Account>("accounts_add", { input }),
    update: (id: string, patch: AccountPatch) => call<Account>("accounts_update", { id, patch }),
    remove: (id: string) => call<void>("accounts_remove", { id }),
    recoveredBackup: () => call<string | null>("accounts_recovered_backup"),
    /** Writes every account with its sid and IM login to `path`, encrypted with `password`. */
    export: (path: string, password: string) => call<ExportReport>("accounts_export", { path, password }),
    /** Adds the accounts of the file at `path` whose device UUID is new here. */
    import: (path: string, password: string) => call<ImportReport>("accounts_import", { path, password }),
  },
  hx: {
    /**
     * Opens the account's live connection (kept until stopped). Its progress
     * comes as "hx-status" events, new messages as "hx-message" events.
     */
    listenStart: (accountId: string) => call<LiveState>("hx_listen_start", { accountId }),
    listenStop: (accountId: string) => call<void>("hx_listen_stop", { accountId }),
    /** The running live connections, by account. */
    listenStatus: () => call<Record<string, LiveState>>("hx_listen_status"),
    /** Opens and closes a TCP connection to each saved server. No login, nothing sent. */
    probeServers: () => call<ServersReport>("hx_probe_servers"),
    /** One `messageroaming` page (newest first). Read-only. */
    history: (accountId: string, conversationId: string, conversationType: number, cursor: string | null, limit: number) =>
      call<HistoryPage>("hx_history", { accountId, conversationId, conversationType, cursor, limit }),
    /**
     * Sends exactly one text message and waits for the server ACK (through the
     * live connection when one is open). `firstContact`
     * also writes the Litmatch metadata for a new conversation. Never retried.
     */
    sendText: (accountId: string, to: string, text: string, firstContact: boolean) =>
      call<SendOutcome>("hx_send_text", { accountId, to, text, firstContact }),
  },
  chat: {
    /** The conversations saved in sky.db for the account, newest message first. No network. */
    savedConversations: (accountId: string) => call<SavedConversation[]>("chat_saved_conversations", { accountId }),
  },
  lit: {
    /**
     * `user/get_info/me` for a stored account (the login check). The IM username
     * and password in it are saved for chat by the backend; neither they nor the
     * session ever reach the webview.
     */
    userInfoMe: (accountId: string) => call<UserProfile>("lit_user_info_me", { accountId }),
    /** `account/account_info`: wallet balances for a stored account. */
    accountInfo: (accountId: string) => call<Wallet>("lit_account_info", { accountId }),
    /** `user/get_info/:id` for another user. */
    userInfo: (accountId: string, targetId: string) => call<UserProfile>("lit_user_info", { accountId, targetId }),
    /** `home/online_users`, one page. */
    onlineUsers: (accountId: string, startPos: number, num: number) =>
      call<OnlineUsersPage>("lit_online_users", { accountId, startPos, num }),
    /** One page of a feed: "Trends" (Phổ biến, `feed/hq`) or "Associate" (Kết bạn). */
    feeds: (accountId: string, kind: FeedKind, startPos: number, num: number) =>
      call<FeedPage>("lit_feeds", { accountId, kind, startPos, num }),
    /** `user/conversations`: the account's conversation list. */
    conversations: (accountId: string) => call<Conversation[]>("lit_conversations", { accountId }),
  },
  settings: {
    get: () => call<AppSettings>("settings_get"),
    update: (patch: SettingsPatch) => call<AppSettings>("settings_update", { patch }),
    /** Fetches Easemob's server list for the app key again and saves it. */
    refreshImServers: () => call<AppSettings>("settings_refresh_im_servers"),
  },
};
