import { invoke, isTauri } from "@tauri-apps/api/core";

export interface Account {
  id: string;
  label: string;
  userId: string | null;
  deviceUuid: string;
  version: string;
  createdAt: number;
  sessionSavedAt: number | null;
}

export interface NewAccount {
  label: string;
  userId: string | null;
  deviceUuid: string;
  version: string;
  sid: string;
}

export interface AccountPatch {
  label?: string;
  userId?: string | null;
  version?: string;
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
  settings: {
    get: () => call<AppSettings>("settings_get"),
    update: (patch: Partial<AppSettings>) => call<AppSettings>("settings_update", { patch }),
  },
};
