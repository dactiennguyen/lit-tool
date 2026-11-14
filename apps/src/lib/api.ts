import { invoke, isTauri } from "@tauri-apps/api/core";

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
  },
  lit: {
    /** Raw `account/account_info` JSON for a stored account. */
    accountInfo: (accountId: string) => call<Record<string, unknown>>("lit_account_info", { accountId }),
    /** Raw `user/get_info/:id` JSON for another user. */
    userInfo: (accountId: string, targetId: string) =>
      call<Record<string, unknown>>("lit_user_info", { accountId, targetId }),
    /** Raw `home/online_users` JSON, one page. */
    onlineUsers: (accountId: string, startPos: number, num: number) =>
      call<Record<string, unknown>>("lit_online_users", { accountId, startPos, num }),
  },
  settings: {
    get: () => call<AppSettings>("settings_get"),
    update: (patch: Partial<AppSettings>) => call<AppSettings>("settings_update", { patch }),
  },
};
