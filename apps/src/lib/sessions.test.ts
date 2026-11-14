import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "./api";
import { makeProfile } from "./lit-types.test-utils";
import { getSession, isSessionExpired, login, logout, noteQueryError } from "./sessions";
import { getTcpStatus } from "./tcp-status";

const userInfoMe = vi.fn();
const settingsGet = vi.fn();
const listenStart = vi.fn();
const listenStop = vi.fn();
vi.mock("./api", () => ({
  api: {
    lit: { userInfoMe: (id: string) => userInfoMe(id) },
    settings: { get: () => settingsGet() },
    hx: { listenStart: (id: string) => listenStart(id), listenStop: (id: string) => listenStop(id) },
  },
}));

const account = (id: string, sessionSavedAt: number | null = 1) => ({ id, sessionSavedAt }) as Account;
const EXPIRED = "Server từ chối (HTTP 200, result -10): login time out, please relogin";

describe("sessions", () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient();
    userInfoMe.mockReset();
    listenStart.mockReset().mockResolvedValue({ state: "connecting" });
    listenStop.mockReset().mockResolvedValue(undefined);
    settingsGet.mockReset().mockResolvedValue({ autoConnectTcp: false, imServers: null });
  });

  it("recognises the server's expired-session answer", () => {
    expect(isSessionExpired(EXPIRED)).toBe(true);
    expect(isSessionExpired("Server từ chối (HTTP 200, result -100)")).toBe(false);
    expect(isSessionExpired("Không kết nối được server")).toBe(false);
  });

  it("starts logged out and logs in with user/get_info/me, keeping the profile cached", async () => {
    const a = account("a1");
    expect(getSession(a)).toEqual({ state: "out" });
    userInfoMe.mockResolvedValue(makeProfile({ nickname: "Mây" }));
    expect(await login(qc, a)).toBe(true);
    expect(getSession(a).state).toBe("in");
    expect(qc.getQueryData(["lit", "user_info_me", "a1"])).toMatchObject({ nickname: "Mây" });
  });

  it("reports an expired sid and a new sid makes the old state stale", async () => {
    userInfoMe.mockRejectedValue(new Error(EXPIRED));
    expect(await login(qc, account("a2"))).toBe(false);
    expect(getSession(account("a2"))).toMatchObject({ state: "error", expired: true });
    // The user saved a new sid: back to the login button.
    expect(getSession(account("a2", 2))).toEqual({ state: "out" });
  });

  it("logs out and forgets the account's cached data only", async () => {
    userInfoMe.mockResolvedValue(makeProfile());
    await login(qc, account("a3"));
    qc.setQueryData(["lit", "user_info_me", "other"], makeProfile());
    logout(qc, "a3");
    expect(listenStop).toHaveBeenCalledWith("a3");
    expect(getSession(account("a3"))).toEqual({ state: "out" });
    expect(qc.getQueryData(["lit", "user_info_me", "a3"])).toBeUndefined();
    expect(qc.getQueryData(["lit", "user_info_me", "other"])).toBeDefined();
  });

  it("moves a logged-in account to the login screen when a request finds the sid expired", async () => {
    userInfoMe.mockResolvedValue(makeProfile());
    await login(qc, account("a4"));
    noteQueryError(["lit", "account_info", "a4"], new Error("network down"));
    expect(getSession(account("a4")).state).toBe("in");
    noteQueryError(["hx", "history", "a4"], new Error(EXPIRED)); // IM errors are not about the sid
    expect(getSession(account("a4")).state).toBe("in");
    noteQueryError(["lit", "account_info", "a4"], new Error(EXPIRED));
    expect(getSession(account("a4"))).toMatchObject({ state: "error", expired: true });
  });

  it("opens the live connection after login only when auto-connect is on", async () => {
    userInfoMe.mockResolvedValue(makeProfile());
    await login(qc, account("a5"));
    expect(listenStart).not.toHaveBeenCalled();

    // No server list saved yet: the backend fetches it on this first connection.
    qc.removeQueries({ queryKey: ["settings"] });
    settingsGet.mockResolvedValue({ autoConnectTcp: true, imServers: null });
    await login(qc, account("a5"));
    expect(listenStart).toHaveBeenCalledWith("a5");
    expect(getTcpStatus("a5").state).toBe("connecting");

    // A failed connection does not fail the login.
    listenStart.mockRejectedValue(new Error("Kết nối TCP thất bại: refused"));
    expect(await login(qc, account("a6"))).toBe(true);
    expect(getTcpStatus("a6")).toMatchObject({ state: "error", message: "Kết nối TCP thất bại: refused" });
  });
});
