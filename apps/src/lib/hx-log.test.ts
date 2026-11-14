import { describe, expect, it } from "vitest";
import type { HttpLogEvent } from "./api";
import { addHttpLog, addTcpLog, clearLogs, getHttpLog, getTcpLog } from "./hx-log";

const request = (accountId: string | null, path: string): HttpLogEvent => ({
  accountId,
  at: 1,
  service: "Litmatch API",
  method: "GET",
  origin: "https://x",
  path,
  query: [],
  requestHeaders: [],
  requestBody: "",
  status: 200,
  ms: 5,
  bytes: 10,
  responseHeaders: [],
  responseBody: "",
  error: null,
});

describe("connection log", () => {
  it("keeps TCP entries per account, newest last, up to 300", () => {
    for (let i = 0; i < 305; i++) addTcpLog("a", { at: i, dir: "out", bytes: 12, kind: "unread", summary: "", info: [], data: "" });
    addTcpLog("a", { at: 999, dir: "state", state: { state: "live", since: 999 } });
    const log = getTcpLog("a");
    expect(log).toHaveLength(300);
    expect(log[0]!.at).toBe(6);
    expect(log.at(-1)).toMatchObject({ dir: "state", state: { state: "live" } });
    expect(getTcpLog("b")).toEqual([]);
  });

  it("shows requests of no account in every account's HTTP log, in order", () => {
    addHttpLog(request("h1", "/own1"));
    addHttpLog(request(null, "/server.json"));
    addHttpLog(request("h2", "/other"));
    addHttpLog(request("h1", "/own2"));
    expect(getHttpLog("h1").map((e) => e.path)).toEqual(["/own1", "/server.json", "/own2"]);
    expect(getHttpLog("h2").map((e) => e.path)).toEqual(["/server.json", "/other"]);
    clearLogs("h1");
    expect(getHttpLog("h1")).toEqual([]);
    expect(getHttpLog("h2").map((e) => e.path)).toEqual(["/other"]);
  });
});
