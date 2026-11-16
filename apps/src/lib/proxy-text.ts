// A proxy pasted into the add and edit form, in the shapes proxy sellers hand out: a URL, ip:port:user:pass and its
// variants. Port of co-lau-loan-the's app/desktop/src/utils/proxyText.ts.
import type { ProxyKind } from "./api";

export interface ParsedProxy {
  /** Only when the text names it (a scheme); the form keeps its choice otherwise. */
  kind?: ProxyKind;
  host: string;
  port: number;
  username: string;
  password: string;
}

/** What the form says it reads, under the field. */
export const PROXY_FORMATS = [
  "http://user:pass@host:port",
  "socks5://user:pass@host:port",
  "host:port:user:pass",
  "user:pass@host:port",
  "user:pass:host:port",
  "host:port@user:pass",
  "host:port",
];

const SCHEMES: Record<string, ProxyKind> = { http: "http", https: "http", socks: "socks5", socks5: "socks5", socks5h: "socks5" };

const isPort = (s: string | undefined) => !!s && /^\d{1,5}$/.test(s) && Number(s) >= 1 && Number(s) <= 65535;
/** An IPv4 address, a name with a dot, localhost, or an IPv6 address in brackets. */
const isHost = (s: string | undefined) =>
  !!s && (/^\d{1,3}(\.\d{1,3}){3}$/.test(s) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s) || s === "localhost" || /^\[[0-9a-f:.]+\]$/i.test(s));
const bare = (host: string) => host.replace(/^\[(.*)\]$/, "$1");

function hostPort(s: string): { host: string; port: number } | null {
  const m = /^(\[[^\]]+\]|[^:\s]+):(\d{1,5})$/.exec(s);
  return m && isHost(m[1]) && isPort(m[2]) ? { host: bare(m[1]!), port: Number(m[2]) } : null;
}
function userPass(s: string): { username: string; password: string } {
  const at = s.indexOf(":");
  return at < 0 ? { username: s, password: "" } : { username: s.slice(0, at), password: s.slice(at + 1) };
}

/** `kind` only when the text named it. */
const withKind = (kind: ProxyKind | undefined, p: Omit<ParsedProxy, "kind">): ParsedProxy => (kind ? { kind, ...p } : p);

/**
 * The proxy in `text`, null when it is none of PROXY_FORMATS; a string says why it cannot be used (SOCKS4). In
 * host:port:user:pass the password may hold ":"; host:port:user:pass and user:pass:host:port are told apart by where the
 * host and the port are. Tabs or spaces between the four parts count as ":".
 */
export function parseProxyText(text: string): ParsedProxy | string | null {
  let t = text.trim();
  let kind: ProxyKind | undefined;
  const scheme = /^([a-z][a-z0-9]*):\/\//i.exec(t);
  if (scheme) {
    const name = scheme[1]!.toLowerCase();
    if (name.startsWith("socks4")) return "Chưa hỗ trợ proxy SOCKS4: dùng SOCKS5 hoặc HTTP";
    kind = SCHEMES[name];
    if (!kind) return `Không nhận ra loại proxy "${scheme[1]}": dùng http:// hoặc socks5://`;
    t = t.slice(scheme[0].length).replace(/\/+$/, "");
  }
  if (/\s/.test(t)) {
    const words = t.split(/\s+/);
    if (words.length !== 2 && words.length !== 4) return null;
    t = words.join(":");
  }

  // user:pass@host:port, or host:port@user:pass.
  const at = t.lastIndexOf("@");
  if (at >= 0) {
    const [left, right] = [t.slice(0, at), t.slice(at + 1)];
    const hp = hostPort(right);
    if (hp) {
      // A URL may percent-encode them; a bare user:pass is taken as typed.
      const { username, password } = userPass(left);
      return withKind(kind, scheme ? { ...hp, username: decode(username), password: decode(password) } : { ...hp, username, password });
    }
    const first = t.indexOf("@");
    const hp2 = hostPort(t.slice(0, first));
    if (hp2) return withKind(kind, { ...hp2, ...userPass(t.slice(first + 1)) });
    return null;
  }

  const hp = hostPort(t);
  if (hp) return withKind(kind, { ...hp, username: "", password: "" });
  const v6 = /^(\[[^\]]+\]):(\d{1,5}):([^:]*):(.*)$/.exec(t);
  if (v6 && isPort(v6[2])) return withKind(kind, { host: bare(v6[1]!), port: Number(v6[2]), username: v6[3]!, password: v6[4]! });
  const parts = t.split(":");
  if (parts.length < 4) return null;
  if (isHost(parts[0]) && isPort(parts[1])) {
    return withKind(kind, { host: parts[0]!, port: Number(parts[1]), username: parts[2]!, password: parts.slice(3).join(":") });
  }
  if (parts.length === 4 && isHost(parts[2]) && isPort(parts[3])) {
    return withKind(kind, { host: parts[2]!, port: Number(parts[3]), username: parts[0]!, password: parts[1]! });
  }
  return null;
}

function decode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
