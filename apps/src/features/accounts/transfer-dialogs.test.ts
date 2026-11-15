import { describe, expect, it } from "vitest";
import { exportPasswordProblem, MIN_FILE_PASSWORD } from "./transfer-dialogs";

describe("export password", () => {
  it("needs the minimum length and a matching confirmation", () => {
    expect(MIN_FILE_PASSWORD).toBe(8);
    expect(exportPasswordProblem("ngan", "ngan")).toMatch(/ít nhất 8/);
    expect(exportPasswordProblem("mat-khau-dai", "mat-khau-dal")).toBe("Hai mật khẩu chưa khớp");
    expect(exportPasswordProblem("mật khẩu ✓", "mật khẩu ✓")).toBeNull();
  });
});
