import type { ProxyForm, ProxyKind, ProxyView } from "@/lib/api";

export const PROXY_KINDS: { kind: ProxyKind; name: string; port: number }[] = [
  { kind: "socks5", name: "SOCKS5", port: 1080 },
  { kind: "http", name: "HTTP", port: 8080 },
];

/** The usual port of a kind, for a new proxy. */
export const defaultPort = (kind: ProxyKind) => PROXY_KINDS.find((k) => k.kind === kind)!.port;

/** The form's start: the saved proxy without its password (an empty one keeps it), or a new one, off. */
export const proxyForm = (p: ProxyView | null | undefined): ProxyForm =>
  p
    ? { enabled: p.enabled, kind: p.kind, host: p.host, port: p.port, username: p.username, password: "" }
    : { enabled: false, kind: "socks5", host: "", port: defaultPort("socks5"), username: "", password: "" };

export const proxyLabel = (p: Pick<ProxyForm, "kind" | "host" | "port">) =>
  `${p.kind} ${p.host.includes(":") ? `[${p.host}]` : p.host}:${p.port}`;

/** Turned on without an address or a port: Lưu waits. */
export const proxyIncomplete = (p: ProxyForm) => p.enabled && (!p.host.trim() || !p.port);

/** Lưu tests the proxy first when it is on and new, was off, or changed (proxy.rs `needs_check`). */
export function testsProxy(p: ProxyForm, saved: ProxyView | null | undefined) {
  if (!p.enabled) return false;
  if (!saved || !saved.enabled) return true;
  return (
    saved.kind !== p.kind ||
    saved.host !== p.host.trim().replace(/^\[(.*)\]$/, "$1") ||
    saved.port !== p.port ||
    saved.username !== p.username.trim() ||
    p.password !== ""
  );
}

/** What the form sends: unchanged from the saved proxy sends nothing (it is kept). */
export function proxyPatch(p: ProxyForm, saved: ProxyView | null | undefined): { proxy?: ProxyForm | null } {
  const same = JSON.stringify(proxyForm(saved)) === JSON.stringify(p);
  if (same) return {};
  if (!p.enabled && !p.host.trim()) return saved ? { proxy: null } : {};
  return { proxy: p };
}
