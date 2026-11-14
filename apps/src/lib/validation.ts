// Same rules as src-tauri/src/accounts.rs (which is the source of truth).
// Checked here only to show errors next to the field before submitting.
// Lengths match Rust: label counts Unicode chars, sid counts UTF-8 bytes.

const charCount = (s: string) => [...s].length;
const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;
// Rust char::is_control = Unicode Cc: C0, DEL and C1.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

const TOKEN = /^[A-Za-z0-9_-]+$/;

/** User and IM ids: same rule as `is_id` in the Rust backend. */
export const isId = (v: string) => /^[A-Za-z0-9_-]{1,128}$/.test(v);
const DEVICE_TOKEN = /^[A-Za-z0-9+/=_-]{1,512}$/;
const VERSION = /^[A-Za-z0-9._-]+$/;

/** Mirrors settings.rs: http(s) origin only, returns the normalised origin or an error message. */
export function checkBaseUrl(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Phải có dạng https://ten-mien.com" };
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname) {
    return { ok: false, error: "Chỉ hỗ trợ http:// hoặc https://" };
  }
  if (url.username || url.password) return { ok: false, error: "Không đặt tài khoản/mật khẩu trong URL" };
  return { ok: true, value: url.origin };
}

export interface AccountFormValues {
  label: string;
  userId: string;
  deviceUuid: string;
  version: string;
  siua: string;
  dfpid: string;
  sid: string;
}

export type AccountFormErrors = Partial<Record<keyof AccountFormValues, string>>;

export function validateAccountForm(v: AccountFormValues, opts: { sidRequired: boolean }): AccountFormErrors {
  const errors: AccountFormErrors = {};
  const label = v.label.trim();
  if (!label || charCount(label) > 64) errors.label = "Nhập tên từ 1 đến 64 ký tự";

  const userId = v.userId.trim();
  if (userId && (!TOKEN.test(userId) || userId.length > 128)) errors.userId = "Chỉ gồm chữ, số, _ và -";

  const device = v.deviceUuid.trim();
  if (!device) errors.deviceUuid = "Bắt buộc";
  else if (!TOKEN.test(device) || device.length > 128) errors.deviceUuid = "Chỉ gồm chữ, số, _ và - (tối đa 128)";

  const version = v.version.trim();
  if (!version || !VERSION.test(version) || version.length > 64) errors.version = "Ví dụ: 7.77.0";

  for (const key of ["siua", "dfpid"] as const) {
    const t = v[key].trim();
    if (t && !DEVICE_TOKEN.test(t)) errors[key] = "Chỉ gồm chữ, số và + / = _ - (tối đa 512)";
  }

  const sid = v.sid.trim();
  if (opts.sidRequired && !sid) errors.sid = "Bắt buộc";
  else if (sid && (utf8Bytes(sid) > 4096 || CONTROL.test(sid))) errors.sid = "Session không hợp lệ";

  return errors;
}
