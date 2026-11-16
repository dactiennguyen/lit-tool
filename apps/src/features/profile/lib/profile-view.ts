// Display fields for a typed profile (own profile or another user's).

import { GENDER_LABEL, genderOf, locationOf, moodOf, presenceOf, safeImageUrl, tagNames } from "@/lib/lit/lit-format";
import type { UserProfile } from "@/lib/lit/lit-types";

export interface ProfileRow {
  label: string;
  value: string;
}

export interface ProfileView {
  name: string | null;
  avatarUrl: string | null;
  id: string | null;
  /** Fields the server sent, in a fixed order; absent ones are left out. */
  rows: ProfileRow[];
}

const numberFmt = new Intl.NumberFormat("vi-VN");
export const formatDate = (unixSeconds: number) => new Date(unixSeconds * 1000).toLocaleDateString("vi-VN");

function vipText(p: UserProfile): string | null {
  if (p.isVip === null) return null;
  if (!p.isVip) return "Không";
  return p.vipInfo?.level ? `Có, cấp ${p.vipInfo.level}` : "Có";
}

export function toProfileView(p: UserProfile): ProfileView {
  const gender = genderOf(p.gender);
  const tags = tagNames(p);
  const rows: [string, string | number | null][] = [
    ["Lit ID", p.litId === null ? null : String(p.litId)], // an id: no thousands separators
    ["Giới tính", gender && GENDER_LABEL[gender]],
    ["Tuổi", p.age],
    ["Ngày sinh", p.birthdate],
    ["Giới thiệu", p.bio],
    ["Vị trí", locationOf(p)],
    ["Ngôn ngữ / vùng", p.region],
    ["Sở thích", tags.length ? tags.join(", ") : null],
    ["Tâm trạng", moodOf(p)],
    ["Người theo dõi", p.follower],
    ["Đang theo dõi", p.following],
    ["VIP", vipText(p)],
    ["Hoạt động", presenceOf(p)?.text ?? null],
    ["Ngày tạo", p.createTime ? formatDate(p.createTime) : null],
    ["IM ID", p.huanxinId],
  ];
  return {
    name: p.nickname,
    avatarUrl: safeImageUrl(p.avatar),
    id: p.userId,
    rows: rows.flatMap(([label, v]) =>
      v === null ? [] : [{ label, value: typeof v === "number" ? numberFmt.format(v) : v }],
    ),
  };
}
