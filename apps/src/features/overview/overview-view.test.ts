import { describe, expect, it } from "vitest";
import { makeProfile, makeWallet } from "@/lib/lit-types.test-utils";
import { summarize, type QueryState } from "./overview-view";

const q = <T,>(o: Partial<QueryState<T>> = {}): QueryState<T> => ({
  data: undefined, error: null, isFetching: false, dataUpdatedAt: 0, errorUpdatedAt: 0, ...o,
});

describe("overview summary", () => {
  it("is unknown before any check", () => {
    const s = summarize(q(), q(), q());
    expect(s.session).toEqual({ state: "unknown" });
    expect([s.diamonds, s.conversations, s.walletError]).toEqual([null, null, null]);
  });

  it("reads profile, wallet and conversation count", () => {
    const s = summarize(
      q({ data: makeProfile({ nickname: "Mây" }), dataUpdatedAt: 5 }),
      q({ data: makeWallet({ diamonds: 120 }), dataUpdatedAt: 5 }),
      q({ data: [{ conversationId: "a", conversationType: 0 }], dataUpdatedAt: 5 }),
    );
    expect(s).toMatchObject({ nickname: "Mây", session: { state: "ok", at: 5 }, diamonds: 120, conversations: 1 });
  });

  it("shows the newer of data and error", () => {
    const old = makeProfile({ nickname: "Mây" });
    const failedLater = summarize(q({ data: old, dataUpdatedAt: 1, error: new Error("sid expired"), errorUpdatedAt: 2 }), q(), q());
    expect(failedLater.session).toEqual({ state: "error", message: "sid expired" });
    const recovered = summarize(q({ data: old, dataUpdatedAt: 3, error: new Error("x"), errorUpdatedAt: 2 }), q(), q());
    expect(recovered.session).toEqual({ state: "ok", at: 3 });
    expect(summarize(q({ isFetching: true }), q(), q()).session).toEqual({ state: "loading" });
    expect(summarize(q(), q({ error: new Error("bad"), errorUpdatedAt: 1 }), q()).walletError).toBe("bad");
  });
});
