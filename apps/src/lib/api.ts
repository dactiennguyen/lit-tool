import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Conversation, HistoryPage, OnlineUsersPage, SendOutcome, UserProfile, Wallet } from "./lit-types";

export interface Account {
  id: string;
  label: string;
  userId: string | null;
  deviceUuid: string;
  version: string;
  siua: string | null;
  dfpid: string | null;
  createdAt: number;
  sessionSavedAt: number | null;
  /** IM identity saved from the profile at login; the password stays in the keychain. */
  im: ImIdentity | null;
}

export interface ImIdentity {
  username: string;
  savedAt: number;
}

export interface HxCheckResult {
  username: string;
  appKey: string;
  host: string;
  port: number;
  /** Set when a new token was requested for this check. */
  tokenExpiresIn: number | null;
  steps: { step: "login" | "followup"; type: string; code: string; accepted: boolean }[];
}

export interface NewAccount {
  label: string;
  userId: string | null;
  deviceUuid: string;
  version: string;
  siua: string | null;
  dfpid: string | null;
  sid: string;
}

export interface AccountPatch {
  label?: string;
  userId?: string | null;
  version?: string;
  siua?: string | null;
  dfpid?: string | null;
  sid?: string;
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
  accounts: {
    list: () => call<Account[]>("accounts_list"),
    add: (input: NewAccount) => call<Account>("accounts_add", { input }),
    update: (id: string, patch: AccountPatch) => call<Account>("accounts_update", { id, patch }),
    remove: (id: string) => call<void>("accounts_remove", { id }),
    recoveredBackup: () => call<string | null>("accounts_recovered_backup"),
  },
  hx: {
    /** Token + TCP login + followup, then disconnect. Sends no message. */
    checkConnection: (accountId: string) => call<HxCheckResult>("hx_check_connection", { accountId }),
    /** One `messageroaming` page (newest first). Read-only. */
    history: (accountId: string, conversationId: string, conversationType: number, cursor: string | null, limit: number) =>
      call<HistoryPage>("hx_history", { accountId, conversationId, conversationType, cursor, limit }),
    /**
     * Sends exactly one text message and waits for the server ACK. `firstContact`
     * also writes the Litmatch metadata for a new conversation. Never retried.
     */
    sendText: (accountId: string, to: string, text: string, firstContact: boolean) =>
      call<SendOutcome>("hx_send_text", { accountId, to, text, firstContact }),
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
