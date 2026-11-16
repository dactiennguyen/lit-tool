import { describe, expect, it } from "vitest";
import { isPasswordExport } from "./transfer-dialogs";

describe("isPasswordExport", () => {
  it("spots the password-protected files of earlier builds only", () => {
    const old = JSON.stringify({ format: "sky-manager-accounts", version: 1, kdf: "pbkdf2-sha256", data: "abc" });
    expect(isPasswordExport(old)).toBe(true);
    expect(isPasswordExport(`﻿  ${old}\n`)).toBe(true);
    expect(isPasswordExport(JSON.stringify({ format: "sky-manager-accounts", version: 2, accounts: [] }))).toBe(false);
    expect(isPasswordExport("[]")).toBe(false);
    expect(isPasswordExport("")).toBe(false);
    expect(isPasswordExport("{not json")).toBe(false);
  });
});
