import { describe, expect, it } from "vitest";
import { toWallet } from "./wallet";

describe("toWallet", () => {
  it("lists known balances in a fixed order", () => {
    const items = toWallet({ data: { stars: 5, diamonds: 10, amethysts: 0, frozen_diamonds: 2, video_member_time: 0 } });
    expect(items.map((i) => [i.key, i.value])).toEqual([
      ["diamonds", 10],
      ["stars", 5],
      ["amethysts", 0],
      ["frozen_diamonds", 2],
    ]);
  });

  it("skips missing or non-numeric values", () => {
    expect(toWallet({ data: { diamonds: "10", stars: 3 } }).map((i) => i.key)).toEqual(["stars"]);
    expect(toWallet({})).toEqual([]);
  });
});
