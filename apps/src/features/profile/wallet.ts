// `account/account_info` returns wallet balances (not a profile).
import { isObject, type Json } from "@/lib/lit-json";

export interface WalletItem {
  key: string;
  label: string;
  value: number;
}

const LABELS: [key: string, label: string][] = [
  ["diamonds", "Kim cương"],
  ["stars", "Sao"],
  ["amethysts", "Thạch anh tím"],
  ["frozen_diamonds", "Kim cương bị khoá"],
];

/** Known balances in a fixed order; missing or non-numeric ones are skipped. */
export function toWallet(response: Json): WalletItem[] {
  const data = isObject(response.data) ? response.data : {};
  return LABELS.flatMap(([key, label]) => {
    const v = data[key];
    return typeof v === "number" && Number.isFinite(v) ? [{ key, label, value: v }] : [];
  });
}
