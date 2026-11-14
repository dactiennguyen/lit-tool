import { describe, expect, it } from "vitest";
import type { ChatMessage, MessageSender } from "./lit-types";
import { makeProfile } from "./lit-types.test-utils";
import { getPeers, rememberPeers, rememberSender } from "./peer-directory";

const AVATAR = "00000000-0000-0000-0000-000000000001";
const thumb = (id: string) => `https://www.litatom.com/api/sns/v1/lit/simage/${id}`;
const msg = (from: string, sender: MessageSender | null): ChatMessage => ({
  id: "1", from, to: null, timestamp: null, contents: [], sender,
});

describe("rememberSender", () => {
  it("names a peer from the newest message they sent, not from mine", () => {
    rememberSender("love_1", [
      msg("love_me", { name: "Tôi", avatar: null }),
      msg("love_1", { name: "Lan", avatar: AVATAR }),
      msg("love_1", { name: "Tên cũ", avatar: null }),
    ]);
    expect(getPeers().get("love_1")).toEqual({ name: "Lan", avatarUrl: thumb(AVATAR), userId: null });
  });

  it("keeps a profile entry and only fills its missing avatar", () => {
    rememberPeers([makeProfile({ huanxinId: "love_2", nickname: "Hồ sơ", userId: "u2" })]);
    rememberSender("love_2", [msg("love_2", { name: "Push", avatar: AVATAR })]);
    expect(getPeers().get("love_2")).toEqual({ name: "Hồ sơ", avatarUrl: thumb(AVATAR), userId: "u2" });
  });

  it("ignores conversations with nothing usable", () => {
    rememberSender("love_3", [msg("love_me", { name: "Tôi", avatar: AVATAR }), msg("love_3", null)]);
    rememberSender("love_4", [msg("love_4", { name: null, avatar: AVATAR })]); // avatar but no name yet
    expect(getPeers().has("love_3")).toBe(false);
    expect(getPeers().has("love_4")).toBe(false);
  });
});
