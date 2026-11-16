import { describe, expect, it } from "vitest";
import { initials } from "./account-avatar";

describe("initials", () => {
  it("takes first and last word initials", () => {
    expect(initials("nguyen van an")).toBe("NA");
    expect(initials("  ")).toBe("?");
  });
  it("skips punctuation", () => {
    expect(initials("Acc chính (me)")).toBe("AM");
    expect(initials("[VIP] - Lan")).toBe("VL");
    expect(initials("(...)")).toBe("?");
  });
  it("does not split emoji surrogate pairs", () => {
    expect(initials("🌸Lan")).toBe("🌸");
    expect(initials("Lan 🌸hoa")).toBe("L🌸");
  });
});
