// Pure helpers for the "Lấy & gửi" feature (collect online users, then blast a
// message from several accounts). No React, no network — unit-testable.

import type { UserProfile } from "@/lib/lit-types";

export type Tone = "idle" | "ok" | "warn" | "bad";
export interface StatusText {
  text: string;
  tone: Tone;
}

/** Stable identity of a collected person: user id, or IM id as a fallback. */
export function userKey(u: UserProfile): string {
  return u.userId ?? u.huanxinId ?? "";
}

/** Keep a people-count within [1, max]; non-finite input falls back to 1. */
export function clampCount(n: number, max = 5000): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(max, Math.max(1, Math.floor(n)));
}

/** Typical connect + send time of one real message, for the estimate only. */
const SEND_SECONDS = 1.8;

/** Rough run time in seconds: send time per message plus the gaps between them. */
export function estimateSeconds(count: number, delaySec: number): number {
  if (count <= 0) return 0;
  return Math.round(count * SEND_SECONDS + Math.max(0, count - 1) * delaySec);
}

/** 45 → "45 giây", 125 → "2 phút 5 giây", 3720 → "1 giờ 2 phút". */
export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} giây`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s ? `${m} phút ${s} giây` : `${m} phút`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}

/** About how many messages a minute the run sends with this gap. */
export function messagesPerMinute(delaySec: number): number {
  return Math.max(1, Math.round(60 / (SEND_SECONDS + delaySec)));
}

/** CSV with a UTF-8 BOM (Excel) and leading-formula characters neutralised. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]!);
  const cell = (v: unknown) => {
    let s = String(v ?? "");
    // Names come from strangers: a leading = + - @ would run as an Excel formula.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${[headers.join(","), ...rows.map((r) => headers.map((h) => cell(r[h])).join(","))].join("\r\n")}\r\n`;
}

/** Best-effort file download from the webview (no backend save dialog needed). */
export function downloadText(filename: string, content: string, mime: string): void {
  try {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    /* download unavailable */
  }
}

/** "2026-11-16-14-30". */
export function stampName(prefix: string, ext: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${prefix}-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}-${p(now.getMinutes())}.${ext}`;
}
