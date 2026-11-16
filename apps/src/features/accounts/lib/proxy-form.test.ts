import { describe, expect, it } from "vitest";
import type { ProxyView } from "@/lib/api";
import { proxyForm, proxyIncomplete, proxyLabel, proxyPatch, testsProxy } from "./proxy-form";

const saved: ProxyView = {
  enabled: true, kind: "http", host: "198.51.100.7", port: 8080, username: "bot", hasPassword: true, label: "http 198.51.100.7:8080",
};

describe("proxy form", () => {
  it("starts from the saved proxy without its password, or a new one turned off", () => {
    expect(proxyForm(saved)).toEqual({ enabled: true, kind: "http", host: "198.51.100.7", port: 8080, username: "bot", password: "" });
    expect(proxyForm(null)).toMatchObject({ enabled: false, kind: "socks5", port: 1080, host: "" });
    expect(proxyLabel({ kind: "socks5", host: "::1", port: 1080 })).toBe("socks5 [::1]:1080");
  });

  it("tests before saving only a proxy on that is new, was off, or changed", () => {
    const form = proxyForm(saved);
    expect(testsProxy(form, saved)).toBe(false);
    expect(testsProxy({ ...form, port: 8081 }, saved)).toBe(true);
    expect(testsProxy({ ...form, password: "new" }, saved)).toBe(true);
    expect(testsProxy({ ...form, enabled: false }, saved)).toBe(false);
    expect(testsProxy(form, { ...saved, enabled: false })).toBe(true);
    expect(testsProxy({ ...proxyForm(null), enabled: true, host: "h.example" }, null)).toBe(true);
  });

  it("sends the proxy only when it changed, and null to remove one emptied", () => {
    const form = proxyForm(saved);
    expect(proxyPatch(form, saved)).toEqual({});
    expect(proxyPatch({ ...form, enabled: false }, saved)).toEqual({ proxy: { ...form, enabled: false } });
    expect(proxyPatch({ ...form, enabled: false, host: "" }, saved)).toEqual({ proxy: null });
    expect(proxyPatch(proxyForm(null), null)).toEqual({});
    expect(proxyIncomplete({ ...proxyForm(null), enabled: true })).toBe(true);
    expect(proxyIncomplete(form)).toBe(false);
  });
});
