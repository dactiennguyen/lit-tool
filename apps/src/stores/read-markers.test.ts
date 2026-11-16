import { describe, expect, it } from "vitest";
import { persistedMap } from "./persisted-map";
import { newestMessage } from "@/lib/queries";
import { compareIds, markRead, readMarker } from "./read-markers";

const msg = (id: string, timestamp: number | null) => ({ id, from: "x", to: null, timestamp, contents: [], sender: null });

describe("read markers and stores", () => {
  it("compares uint64 ids as numbers", () => {
    expect(compareIds("9", "10")).toBeLessThan(0);
    expect(compareIds("18446744073709551615", "18446744073709551614")).toBeGreaterThan(0);
    expect(compareIds("5", "5")).toBe(0);
  });

  it("never moves a marker backwards", () => {
    markRead("acc", "conv", "20");
    markRead("acc", "conv", "100");
    markRead("acc", "conv", "99");
    expect(readMarker("acc", "conv")).toBe("100");
    expect(readMarker("acc", "other")).toBeUndefined();
  });

  it("drops the oldest entries past the cap and skips no-op updates", () => {
    const store = persistedMap<number>("test.cap", (v): v is number => typeof v === "number", 2);
    store.update((d) => (d.set("a", 1), d.set("b", 2), d.set("c", 3), true));
    expect([...store.get().keys()]).toEqual(["b", "c"]);
    const before = store.get();
    store.update((d) => (d.set("z", 9), false)); // returned false: discarded
    expect(store.get()).toBe(before);
  });

  it("finds the newest message whatever the server order", () => {
    expect(newestMessage([])).toBeNull();
    expect(newestMessage([msg("1", 10), msg("3", 30), msg("2", 20)])?.id).toBe("3");
    expect(newestMessage([msg("9", 10), msg("10", 10)])?.id).toBe("10");
  });
});
