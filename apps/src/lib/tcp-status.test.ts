import { describe, expect, it } from "vitest";
import { getTcpStatus, isTcpError, setTcpStatus } from "./tcp-status";

describe("tcp status", () => {
  it("starts idle and keeps the latest result per account", () => {
    expect(getTcpStatus("a")).toEqual({ state: "idle" });
    setTcpStatus("a", { state: "connecting" });
    setTcpStatus("a", { state: "ok", at: 5, via: "check" });
    expect(getTcpStatus("a")).toEqual({ state: "ok", at: 5, via: "check" });
    expect(getTcpStatus("b")).toEqual({ state: "idle" });
    setTcpStatus("a", null);
    expect(getTcpStatus("a")).toEqual({ state: "idle" });
  });

  it("tells TCP login failures from other send errors", () => {
    for (const m of [
      "Kết nối TCP thất bại: connection refused",
      "Hết thời gian chờ bắt tay với server chat",
      "Server chat từ chối bước login (type=3, code=5)",
      "Lấy token Hyphenate thất bại: HTTP 401",
    ]) {
      expect(isTcpError(m)).toBe(true);
    }
    for (const m of ["Tin nhắn phải có nội dung và tối đa 4096 byte", "Không rõ tin đã gửi được chưa (x)", "Chưa có login template"]) {
      expect(isTcpError(m)).toBe(false);
    }
  });
});
