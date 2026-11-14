import { describe, expect, it } from "vitest";
import { makeWallet } from "@/lib/lit-types.test-utils";
import wallet from "@/lib/contract/wallet.json";
import { toWallet } from "./wallet";

describe("toWallet", () => {
  it("lists known balances in a fixed order", () => {
    const items = toWallet(makeWallet({ stars: 5, diamonds: 10, amethysts: 0, frozenDiamonds: 2 }));
    expect(items.map((i) => [i.key, i.label, i.value])).toEqual([
      ["diamonds", "Kim cương", 10],
      ["stars", "Sao", 5],
      ["amethysts", "Thạch anh tím", 0],
      ["frozenDiamonds", "Kim cương bị khoá", 2],
    ]);
  });

  it("skips balances the server did not send (null), but keeps zero", () => {
    expect(toWallet(makeWallet({ stars: 3 })).map((i) => i.key)).toEqual(["stars"]);
    expect(toWallet(makeWallet())).toEqual([]);
  });

  it("reads the backend's typed wallet output", () => {
    expect(toWallet(wallet).map((i) => i.value)).toEqual([0, 0, 0, 0]);
  });
});
