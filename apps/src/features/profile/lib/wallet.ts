import type { Wallet } from "@/lib/lit/lit-types";

export interface WalletItem {
  key: keyof Wallet;
  label: string;
  value: number;
}

const LABELS: [key: keyof Wallet, label: string][] = [
  ["diamonds", "Kim cương"],
  ["stars", "Sao"],
  ["amethysts", "Thạch anh tím"],
  ["frozenDiamonds", "Kim cương bị khoá"],
];

/** Known balances in a fixed order; ones the server did not send are skipped. */
export function toWallet(wallet: Wallet): WalletItem[] {
  return LABELS.flatMap(([key, label]) => {
    const value = wallet[key];
    return value === null ? [] : [{ key, label, value }];
  });
}
