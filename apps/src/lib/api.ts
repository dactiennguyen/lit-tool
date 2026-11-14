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
  hx: HxConfig | null;
}

export interface HxConfig {
  host: string;
  port: number;
  restBase: string | null;
  appKey: string;
  username: string;
  auth: "access_token" | "password";
}

/** Blank secret fields keep what is stored. */
export interface HxInput {
  host: string;
  port: number | null;
  restBase: string | null;
  templateB64: string | null;
  password: string | null;
  accessToken: string | null;
}

export interface HxCheckResult {
  username: string;
  appKey: string;
  host: string;
  port: number;
  tokenSource: "access_token" | "password";
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
}

export const DEFAULT_API_BASE_URL = "https://www.litatom.com";

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
    setHx: (id: string, input: HxInput) => call<Account>("accounts_set_hx", { id, input }),
    clearHx: (id: string) => call<Account>("accounts_clear_hx", { id }),
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
    /** `user/get_info/me` for a stored account. Session and IM credentials never leave the backend. */
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
    update: (patch: Partial<AppSettings>) => call<AppSettings>("settings_update", { patch }),
  },
};
