import { describe, expect, it } from "vitest";
import { makeProfile, makeWallet } from "@/lib/lit-types.test-utils";
import { summarize, type QueryState } from "./overview-view";

const q = <T,>(o: Partial<QueryState<T>> = {}): QueryState<T> => ({
  data: undefined, error: null, isFetching: false, dataUpdatedAt: 0, errorUpdatedAt: 0, ...o,
});

describe("overview summary", () => {
  it("is empty before any request", () => {
    const s = summarize(q(), q(), q());
    expect([s.nickname, s.diamonds, s.conversations, s.walletError]).toEqual([null, null, null, null]);
  });

  it("reads profile, wallet and conversation count", () => {
    const s = summarize(
      q({ data: makeProfile({ nickname: "Mây" }), dataUpdatedAt: 5 }),
      q({ data: makeWallet({ diamonds: 120 }), dataUpdatedAt: 5 }),
      q({ data: [{ conversationId: "a", conversationType: 0 }], dataUpdatedAt: 5 }),
    );
    expect(s).toMatchObject({ nickname: "Mây", diamonds: 120, conversations: 1 });
  });

  it("shows the newer of data and error", () => {
    const wallet = makeWallet({ diamonds: 7 });
    const failedLater = summarize(q(), q({ data: wallet, dataUpdatedAt: 1, error: new Error("bad"), errorUpdatedAt: 2 }), q());
    expect([failedLater.diamonds, failedLater.walletError]).toEqual([null, "bad"]);
    const recovered = summarize(q(), q({ data: wallet, dataUpdatedAt: 3, error: new Error("x"), errorUpdatedAt: 2 }), q());
    expect([recovered.diamonds, recovered.walletError]).toEqual([7, null]);
  });
});
