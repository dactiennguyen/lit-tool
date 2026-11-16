import { describe, expect, it } from "vitest";
import { parseProxyText } from "./proxy-text";

const p = (kind: "http" | "socks5" | undefined, host: string, port: number, username = "", password = "") =>
  kind ? { kind, host, port, username, password } : { host, port, username, password };

describe("parseProxyText", () => {
  it("reads the shapes proxy sellers hand out into the same fields", () => {
    const full = p(undefined, "198.51.100.7", 6361, "user-US", "pa55");
    for (const text of [
      "198.51.100.7:6361:user-US:pa55",
      "user-US:pa55@198.51.100.7:6361",
      "user-US:pa55:198.51.100.7:6361",
      "198.51.100.7:6361@user-US:pa55",
      "  198.51.100.7\t6361\tuser-US\tpa55 ",
      "198.51.100.7:6361 user-US:pa55",
    ]) {
      expect(parseProxyText(text), text).toEqual(full);
    }
    expect(parseProxyText("http://user-US:pa55@198.51.100.7:6361")).toEqual({ ...full, kind: "http" });
    expect(parseProxyText("HTTPS://user-US:pa55@198.51.100.7:6361/")).toEqual({ ...full, kind: "http" });
    expect(parseProxyText("socks5://198.51.100.7:6361:user-US:pa55")).toEqual({ ...full, kind: "socks5" });
    expect(parseProxyText("socks5h://u%40x:p%3Aw@proxy.example.com:1080")).toEqual(p("socks5", "proxy.example.com", 1080, "u@x", "p:w"));
    expect(parseProxyText("proxy.example.com:3128")).toEqual(p(undefined, "proxy.example.com", 3128));
    expect(parseProxyText("[2001:db8::1]:1080:u:p")).toEqual(p(undefined, "2001:db8::1", 1080, "u", "p"));
    // A password with ":" after host:port:user.
    expect(parseProxyText("10.0.0.1:8080:bot:a:b")).toEqual(p(undefined, "10.0.0.1", 8080, "bot", "a:b"));
    // Taken as typed without a scheme: % is part of the password.
    expect((parseProxyText("bot:100%25@10.0.0.1:8080") as { password: string }).password).toBe("100%25");
  });

  it("returns null for text that is no proxy, and says why for SOCKS4 or an unknown scheme", () => {
    for (const text of ["", "hello", "10.0.0.1", "10.0.0.1:99999", "a:b:c:d", "user:pass", "one two three"]) {
      expect(parseProxyText(text), text).toBeNull();
    }
    expect(parseProxyText("socks4://10.0.0.1:1080")).toMatch(/SOCKS4/);
    expect(parseProxyText("ftp://10.0.0.1:21")).toMatch(/ftp/);
  });
});
