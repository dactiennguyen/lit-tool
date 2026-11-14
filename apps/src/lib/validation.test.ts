import { describe, expect, it } from "vitest";
import { checkBaseUrl, validateAccountForm, type AccountFormValues } from "./validation";

describe("checkBaseUrl", () => {
  it("normalises to origin", () => {
    expect(checkBaseUrl(" https://www.litatom.com/ ")).toEqual({ ok: true, value: "https://www.litatom.com" });
    expect(checkBaseUrl("http://127.0.0.1:8080/api")).toEqual({ ok: true, value: "http://127.0.0.1:8080" });
  });

  it("rejects non-http(s) and credentials", () => {
    for (const bad of ["", "litatom.com", "ftp://x.com", "https://u:p@x.com", "javascript:alert(1)"]) {
      expect(checkBaseUrl(bad).ok, bad).toBe(false);
    }
  });
});

const valid: AccountFormValues = {
  label: "Acc chính",
  userId: "",
  deviceUuid: "abc_123-XYZ",
  version: "7.77.0",
  sid: "some-session",
};

describe("validateAccountForm", () => {
  it("accepts a valid new account", () => {
    expect(validateAccountForm(valid, { sidRequired: true })).toEqual({});
  });

  it("flags each bad field", () => {
    const errors = validateAccountForm(
      { label: "  ", userId: "a b", deviceUuid: "x/y", version: "7 7", sid: "" },
      { sidRequired: true },
    );
    expect(Object.keys(errors).sort()).toEqual(["deviceUuid", "label", "sid", "userId", "version"]);
  });

  it("allows empty sid when editing", () => {
    expect(validateAccountForm({ ...valid, sid: "" }, { sidRequired: false })).toEqual({});
  });

  it("rejects control characters in sid, including C1", () => {
    expect(validateAccountForm({ ...valid, sid: "a\nb" }, { sidRequired: false }).sid).toBeDefined();
    expect(validateAccountForm({ ...valid, sid: "a\u0085b" }, { sidRequired: false }).sid).toBeDefined();
  });

  it("measures like Rust: label in chars, sid in UTF-8 bytes", () => {
    // 40 emoji = 80 UTF-16 units but 40 chars -> allowed
    expect(validateAccountForm({ ...valid, label: "😀".repeat(40) }, { sidRequired: true }).label).toBeUndefined();
    // 2000 x \"ạ\" = 2000 UTF-16 units but 6000 bytes -> rejected
    expect(validateAccountForm({ ...valid, sid: "ạ".repeat(2000) }, { sidRequired: true }).sid).toBeDefined();
  });
});
