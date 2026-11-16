// Lấy & gửi — a top-level view that collects people from "Người mới" (home/
// online_users) up to a chosen count, shows them in a pickable list, then sends
// a message (fixed or random from templates) rotating through several accounts.

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  CircleCheckIcon,
  CircleXIcon,
  DownloadIcon,
  Loader2Icon,
  LogInIcon,
  SquareIcon,
  TriangleAlertIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { GENDER_LABEL, genderOf, locationOf } from "@/lib/lit-format";
import { useAccounts } from "@/lib/queries";
import { login, useSessions } from "@/lib/sessions";
import { cn } from "@/lib/utils";
import { AutoSendPanel } from "./autosend-panel";
import { NumberField } from "./number-field";
import { patchOutreachSettings, useOutreachSettings } from "./outreach-settings";
import { useOutreachStore, type BlastSender } from "./outreach-store";
import { clampCount, downloadText, stampName, toCsv, userKey, type StatusText, type Tone } from "./outreach-view";
import { RecipientList, type ExportFormat } from "./recipient-list";
import { useSentHistory } from "./use-sent-history";

export function OutreachPage() {
  const { data: accounts = [] } = useAccounts();
  const sessionOf = useSessions();
  const online = useMemo<BlastSender[]>(
    () => accounts.filter((a) => sessionOf(a).state === "in").map((a) => ({ id: a.id, label: a.label })),
    [accounts, sessionOf],
  );
  const onlineKey = online.map((a) => a.id).join(",");

  const history = useSentHistory();
  const settings = useOutreachSettings();

  // Live tab state (collected list, selections, status) lives in a zustand store
  // so it survives leaving and returning to this tab; collecting keeps running in
  // the background and its progress is picked up where it left off.
  const found = useOutreachStore((s) => s.found);
  const collecting = useOutreachStore((s) => s.collecting);
  const collectStatus = useOutreachStore((s) => s.collectStatus);
  const query = useOutreachStore((s) => s.query);
  const setQuery = useOutreachStore((s) => s.setQuery);
  const excluded = useOutreachStore((s) => s.excluded);
  const collectIds = useOutreachStore((s) => s.collectIds);
  const setCollectIds = useOutreachStore((s) => s.setCollectIds);
  const toggleExcluded = useOutreachStore((s) => s.toggleExcluded);
  const selectAll = useOutreachStore((s) => s.selectAll);
  const selectNone = useOutreachStore((s) => s.selectNone);
  const collect = useOutreachStore((s) => s.collect);
  const stopCollect = useOutreachStore((s) => s.stopCollect);
  const clearFound = useOutreachStore((s) => s.clearFound);
  const reconcileAccounts = useOutreachStore((s) => s.reconcileAccounts);

  // Default the account picks to all online, dropping any that logged out.
  useEffect(() => {
    reconcileAccounts(onlineKey ? onlineKey.split(",") : []);
  }, [onlineKey, reconcileAccounts]);

  // Log every account in from here, so an empty screen doesn't force a trip to
  // "Quản lý account" first. One at a time, like the overview page.
  const qc = useQueryClient();
  const [loggingIn, setLoggingIn] = useState<{ done: number; total: number } | null>(null);
  async function loginAll() {
    setLoggingIn({ done: 0, total: accounts.length });
    let failed = 0;
    for (const [i, a] of accounts.entries()) {
      if (sessionOf(a).state !== "in" && !(await login(qc, a))) failed++;
      setLoggingIn({ done: i + 1, total: accounts.length });
    }
    setLoggingIn(null);
    if (failed) toast.error(`${failed} account không đăng nhập được. Mở “Quản lý account” để xem lỗi.`);
    else toast.success(`Đã đăng nhập ${accounts.length} account`);
  }

  // ---- recipient-list filters
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return found.filter(
      (u) =>
        (!settings.hideContacted || !history.contacts.has(userKey(u))) &&
        (!q ||
          (u.nickname ?? "").toLowerCase().includes(q) ||
          userKey(u).toLowerCase().includes(q) ||
          (locationOf(u) ?? "").toLowerCase().includes(q)),
    );
  }, [found, query, settings.hideContacted, history.contacts]);

  // ---- who gets the message: everyone shown, minus the unticked
  const picked = useMemo(() => shown.filter((u) => !excluded.has(userKey(u))), [shown, excluded]);

  const onExport = (format: ExportFormat) => {
    const rows = shown.map((u) => {
      const g = genderOf(u.gender);
      return {
        userId: u.userId ?? "",
        imId: u.huanxinId ?? "",
        nickname: u.nickname ?? "",
        gender: g ? GENDER_LABEL[g] : "",
        age: u.age ?? "",
        location: locationOf(u) ?? "",
        isVip: u.isVip ?? false,
        messagedBy: (history.contacts.get(userKey(u)) ?? [])
          .map((c) => `${c.accountLabel} (${c.count}${c.uncertain ? `+${c.uncertain}?` : ""})`)
          .join(", "),
      };
    });
    const content =
      format === "json"
        ? `${JSON.stringify({ exportedAt: new Date().toISOString(), users: rows }, null, 2)}\n`
        : toCsv(rows);
    downloadText(stampName("lit-users", format), content, format === "json" ? "application/json" : "text/csv");
    toast.success(`Đã xuất ${shown.length} người`);
  };

  const onClear = () => {
    const n = found.length;
    clearFound();
    toast.info(`Đã xoá danh sách ${n} người.`);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Lấy & gửi" description="Lấy người đang online rồi gửi tin bằng nhiều account (gửi lần lượt)." />

      {online.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="Chưa có account nào đăng nhập"
          description={
            accounts.length
              ? "Đăng nhập account để lấy người đang online rồi gửi tin."
              : "Chưa có account nào. Vào “Quản lý account” để thêm trước."
          }
          action={
            accounts.length ? (
              <Button onClick={() => void loginAll()} disabled={loggingIn !== null}>
                {loggingIn ? <Loader2Icon className="animate-spin" aria-hidden /> : <LogInIcon aria-hidden />}
                {loggingIn ? `Đang đăng nhập ${loggingIn.done}/${loggingIn.total}` : `Đăng nhập tất cả (${accounts.length})`}
              </Button>
            ) : (
              <Button render={<Link to="/accounts" />}>Thêm account</Button>
            )
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="flex w-[360px] shrink-0 flex-col border-r bg-card">
            {/* ---- Lấy (the only part that differs from the reference app) ---- */}
            <section className="flex flex-col gap-3 border-b p-3">
              <h2 className="text-sm font-semibold">Lấy người online</h2>
              <div className="flex items-center gap-2">
                <NumberField
                  value={settings.target}
                  disabled={collecting}
                  onCommit={(n) => patchOutreachSettings({ target: clampCount(n) })}
                  className="w-24 tabular-nums"
                  aria-label="Số người cần lấy"
                />
                <span className="text-sm text-muted-foreground">người cần lấy</span>
              </div>
              <div className="flex items-center gap-2">
                <NumberField
                  decimal
                  value={settings.collectDelaySec}
                  disabled={collecting}
                  onCommit={(n) => patchOutreachSettings({ collectDelaySec: Math.max(0, n) })}
                  className="w-24 tabular-nums"
                  aria-label="Giãn cách giữa 2 lần lấy (giây)"
                />
                <span className="text-sm text-muted-foreground">giây giữa mỗi lần lấy</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Lấy bằng account</span>
                <div className="flex flex-wrap gap-1.5">
                  {online.map((a) => (
                    <Chip
                      key={a.id}
                      label={a.label}
                      on={collectIds.includes(a.id)}
                      disabled={collecting}
                      onToggle={() =>
                        setCollectIds(collectIds.includes(a.id) ? collectIds.filter((x) => x !== a.id) : [...collectIds, a.id])
                      }
                    />
                  ))}
                </div>
              </div>
              {(collecting || found.length > 0) && (
                <Bar value={Math.min(found.length, settings.target)} max={settings.target} />
              )}
              {collecting ? (
                <Button variant="destructive" size="sm" onClick={stopCollect}>
                  <SquareIcon aria-hidden />
                  Dừng lấy
                </Button>
              ) : (
                <Button size="sm" disabled={collectIds.length === 0} onClick={() => void collect(collectIds, settings.target, settings.collectDelaySec)}>
                  <DownloadIcon aria-hidden />
                  {found.length ? "Lấy lại" : "Lấy danh sách"}
                </Button>
              )}
              {collectStatus && <StatusLine status={collectStatus} busy={collecting} />}
            </section>

            <RecipientList
              found={found}
              shown={shown}
              contacts={history.contacts}
              query={query}
              onQuery={setQuery}
              hideContacted={settings.hideContacted}
              onHideContacted={(v) => patchOutreachSettings({ hideContacted: v })}
              isPicked={(uid) => !excluded.has(uid)}
              pickedCount={picked.length}
              onToggle={toggleExcluded}
              onSelectAll={selectAll}
              onSelectNone={() => selectNone(shown.map(userKey))}
              onExport={onExport}
              onClear={onClear}
              busy={collecting}
            />
          </aside>

          <AutoSendPanel
            recipients={picked}
            listCount={shown.length}
            contacts={history.contacts}
            online={online}
            recent={history.recent}
          />
        </div>
      )}
    </div>
  );
}

function Chip({ label, on, disabled, onToggle }: { label: string; on: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={on}
      onClick={onToggle}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {on && <CheckIcon className="size-3" aria-hidden />}
      <span className="max-w-28 truncate">{label}</span>
    </button>
  );
}

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

const TONE_CLASS: Record<Tone, string> = {
  idle: "text-muted-foreground",
  ok: "text-primary",
  warn: "text-foreground",
  bad: "text-destructive",
};

function StatusLine({ status, busy }: { status: StatusText; busy: boolean }) {
  return (
    <p className={cn("flex min-w-0 items-center gap-1.5 text-xs", TONE_CLASS[status.tone])}>
      {busy ? (
        <Loader2Icon className="size-3.5 shrink-0 animate-spin" aria-hidden />
      ) : status.tone === "ok" ? (
        <CircleCheckIcon className="size-3.5 shrink-0" aria-hidden />
      ) : status.tone === "bad" ? (
        <CircleXIcon className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden />
      )}
      <span className="truncate">{status.text}</span>
    </p>
  );
}
