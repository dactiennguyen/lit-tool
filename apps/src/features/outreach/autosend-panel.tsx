import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CheckIcon,
  HistoryIcon,
  Loader2Icon,
  MessageSquareTextIcon,
  SendIcon,
  SquareIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { canSend, MAX_TEXT_BYTES, utf8Bytes } from "@/features/chat/chat-view";
import type { UserProfile } from "@/lib/lit-types";
import { cn } from "@/lib/utils";
import { HistoryDialog } from "./history-dialog";
import { patchOutreachSettings, useOutreachSettings } from "./outreach-settings";
import { estimateSeconds, formatDuration, messagesPerMinute, userKey } from "./outreach-view";
import { SendLog } from "./send-log";
import type { Contact, SentRow } from "./sent-log";
import { TemplatesDialog } from "./templates-dialog";
import { useTemplates } from "./templates";
import { useBlast, type BlastSender } from "./use-blast";

/** The send half: a config column (who, accounts, text, pace) and a live column (preview, progress, log, action). */
export function AutoSendPanel({
  recipients,
  listCount,
  contacts,
  online,
  recent,
}: {
  /** People ticked in the list. */
  recipients: UserProfile[];
  /** People shown in the list (after its filters). */
  listCount: number;
  contacts: Map<string, Contact[]>;
  online: BlastSender[];
  recent: SentRow[];
}) {
  const blast = useBlast();
  const templates = useTemplates();
  const settings = useOutreachSettings();
  const { skipContacted, cap, mode, text, delaySec, firstContact } = settings;
  const locked = blast.running;
  const onlineKey = online.map((a) => a.id).join(",");

  // ① recipients
  const eligible = useMemo(
    () => (skipContacted ? recipients.filter((u) => !contacts.has(userKey(u))) : recipients),
    [recipients, skipContacted, contacts],
  );
  const skippedCount = recipients.length - eligible.length;
  const sendable = useMemo(() => eligible.filter((u) => u.huanxinId), [eligible]);
  const targets = useMemo(() => (cap > 0 ? sendable.slice(0, cap) : sendable), [sendable, cap]);

  // ② sender accounts (all online by default; one that logs out drops off)
  const [senderIds, setSenderIds] = useState<string[]>([]);
  useEffect(() => {
    const ids = onlineKey ? onlineKey.split(",") : [];
    setSenderIds((prev) => {
      const kept = prev.filter((id) => ids.includes(id));
      const next = kept.length ? kept : ids;
      return next.length === prev.length && next.every((v, i) => v === prev[i]) ? prev : next;
    });
  }, [onlineKey]);
  const senders = useMemo(() => online.filter((a) => senderIds.includes(a.id)), [online, senderIds]);

  // ③ message
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  useEffect(() => setTicked(new Set(templates.map((_, i) => i))), [templates]);
  const tickedTexts = useMemo(
    () => templates.filter((_, i) => ticked.has(i)).map((t) => t.trim()).filter(Boolean),
    [templates, ticked],
  );
  // Only templates within the byte limit can actually be sent; an over-limit one
  // would be rejected by the backend (hx::validate_text), so keep it out of the pool.
  const pool = useMemo(() => tickedTexts.filter(canSend), [tickedTexts]);
  const oversized = tickedTexts.length - pool.length;
  const hasMessage = mode === "single" ? canSend(text) : pool.length > 0;
  const bytes = utf8Bytes(text);

  // ④ pace + options come from the remembered settings (destructured above).

  const [dialog, setDialog] = useState<"templates" | "history" | "confirm" | null>(null);

  const reason =
    !targets.length
      ? recipients.length
        ? skippedCount === recipients.length
          ? "Mọi người đã tick đều đã được nhắn. Tắt “Bỏ qua người đã nhắn” nếu muốn gửi lại."
          : "Những người còn lại không có IM id nên không nhắn được."
        : "Chưa có người nhận: lấy danh sách rồi tick người cần gửi ở cột trái."
      : !senders.length
        ? "Chọn ít nhất một account để gửi (bước 2)."
        : !hasMessage
          ? mode === "single"
            ? bytes > MAX_TEXT_BYTES
              ? `Nội dung quá dài (${bytes}/${MAX_TEXT_BYTES} byte).`
              : "Nhập nội dung tin nhắn (bước 3)."
            : oversized > 0
              ? `Mẫu tin đã tick đều vượt ${MAX_TEXT_BYTES} byte. Rút ngắn hoặc tick mẫu khác (bước 3).`
              : "Tick ít nhất một mẫu tin (bước 3)."
          : null;

  const plannedCount = locked ? blast.progress.total : targets.length;
  const estimate = estimateSeconds(plannedCount, delaySec);
  const previewText = blast.progress.current ? "" : mode === "single" ? text.trim() : (pool[0] ?? "");

  const run = async () => {
    setDialog(null);
    const result = await blast.start({
      senders,
      targets,
      delaySec,
      firstContact,
      pickText: mode === "single" ? () => text.trim() : () => pool[Math.floor(Math.random() * pool.length)] ?? "",
    });
    const summary = [
      result.stopped ? "Đã dừng." : "Hoàn tất.",
      `Đã gửi ${result.ok} tin`,
      result.fail ? `lỗi ${result.fail}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    if (result.fail) toast.warning(summary);
    else toast.success(summary);
  };
  const onStart = () => {
    if (reason) return;
    setDialog("confirm");
  };

  return (
    <main aria-label="Gửi tin" className="@container flex min-h-0 min-w-0 flex-1">
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto @2xl:grid-cols-[minmax(300px,1.05fr)_minmax(280px,0.95fr)] @2xl:overflow-hidden">
        {/* ---------------- Auto gửi (config) ---------------- */}
        <div className="flex min-w-0 flex-col border-r @2xl:min-h-0 @2xl:overflow-y-auto">
          <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-4 py-2.5 backdrop-blur">
            <h2 className="text-sm font-semibold">Auto gửi</h2>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => setDialog("templates")}>
              <MessageSquareTextIcon aria-hidden />
              Mẫu tin
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDialog("history")}>
              <HistoryIcon aria-hidden />
              Lịch sử
            </Button>
          </header>

          <div className="flex flex-col gap-5 p-4">
            <Step n={1} title="Người nhận" meta={`${targets.length} người`}>
              <p className="text-sm text-muted-foreground">
                Sẽ gửi tới <strong className="tabular-nums text-foreground">{targets.length}</strong> người · đã tick {recipients.length}/{listCount}
              </p>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={skipContacted} disabled={locked} onChange={(e) => patchOutreachSettings({ skipContacted: e.target.checked })} />
                Bỏ qua người đã được nhắn
                {skippedCount > 0 && <span className="text-xs text-muted-foreground">(bỏ qua {skippedCount})</span>}
              </label>
              <div className="flex items-center gap-2">
                <Label htmlFor="blast-cap" className="text-xs text-muted-foreground">
                  Gửi tối đa
                </Label>
                <Input
                  id="blast-cap"
                  type="number"
                  min={0}
                  value={cap}
                  disabled={locked}
                  onChange={(e) => patchOutreachSettings({ cap: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                  placeholder="Tất cả"
                  className="w-24 tabular-nums"
                />
                <span className="text-xs text-muted-foreground">0 = gửi hết</span>
              </div>
            </Step>

            <Step n={2} title="Gửi bằng account" meta={`${senders.length} account`}>
              {online.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {online.map((a) => (
                    <Chip key={a.id} label={a.label} on={senderIds.includes(a.id)} disabled={locked} onToggle={() => toggleId(setSenderIds, a.id)} />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Chưa có account online.</p>
              )}
              {senders.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  Gửi lần lượt: tin 1 bằng {senders[0]!.label}, tin 2 bằng {senders[1]!.label}
                  {senders.length > 2 ? ", …" : ""}
                </p>
              )}
            </Step>

            <Step n={3} title="Nội dung" meta={mode === "single" ? "1 nội dung" : `${pool.length} mẫu`}>
              <div className="inline-flex self-start rounded-md border p-0.5">
                {(["single", "random"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={locked}
                    onClick={() => patchOutreachSettings({ mode: m })}
                    className={cn("rounded px-2.5 py-1 text-xs", mode === m ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
                  >
                    {m === "single" ? "Một nội dung" : `Ngẫu nhiên từ mẫu (${templates.length})`}
                  </button>
                ))}
              </div>
              {mode === "single" ? (
                <>
                  <Textarea
                    rows={4}
                    maxLength={4000}
                    value={text}
                    disabled={locked}
                    onChange={(e) => patchOutreachSettings({ text: e.target.value })}
                    placeholder="Nội dung gửi cho mọi người"
                    aria-invalid={bytes > MAX_TEXT_BYTES}
                    className="resize-y"
                  />
                  {bytes > MAX_TEXT_BYTES * 0.8 && (
                    <p className={cn("text-right text-xs tabular-nums", bytes > MAX_TEXT_BYTES && "text-destructive")}>
                      {bytes}/{MAX_TEXT_BYTES} byte
                    </p>
                  )}
                </>
              ) : templates.length ? (
                <>
                  <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                    {templates.map((t, i) => (
                      <li key={i}>
                        <label className="flex cursor-pointer items-start gap-2 rounded-md border bg-background px-3 py-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-0.5 size-4 accent-primary"
                            checked={ticked.has(i)}
                            disabled={locked}
                            onChange={(e) =>
                              setTicked((s) => {
                                const n = new Set(s);
                                if (e.target.checked) n.add(i);
                                else n.delete(i);
                                return n;
                              })
                            }
                          />
                          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{t}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Mỗi người nhận 1 mẫu ngẫu nhiên trong {pool.length} mẫu đã tick.</p>
                    <Button size="xs" variant="outline" onClick={() => setDialog("templates")}>
                      Sửa mẫu
                    </Button>
                  </div>
                  {oversized > 0 && (
                    <p className="text-xs text-destructive">
                      {oversized} mẫu đã tick vượt {MAX_TEXT_BYTES} byte nên sẽ bị bỏ qua.
                    </p>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-start gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  Chưa có mẫu tin nào.
                  <Button size="sm" variant="outline" onClick={() => setDialog("templates")}>
                    Thêm mẫu
                  </Button>
                </div>
              )}
            </Step>

            <Step n={4} title="Giãn cách & tuỳ chọn" meta={`${delaySec} giây/tin`}>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={delaySec}
                  disabled={locked}
                  onChange={(e) => patchOutreachSettings({ delaySec: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-20 tabular-nums"
                  aria-label="Giãn cách giữa 2 tin (giây)"
                />
                <span className="text-xs text-muted-foreground">giây/tin · ~{messagesPerMinute(delaySec)} tin/phút</span>
              </div>
              <label className="flex items-center justify-between gap-3">
                <span className="flex flex-col">
                  <span className="text-sm font-medium">Bắt chuyện (ghi hội thoại mới)</span>
                  <span className="text-xs text-muted-foreground">Như app điện thoại khi nhắn người lạ lần đầu.</span>
                </span>
                <Switch checked={firstContact} disabled={locked} onCheckedChange={(v) => patchOutreachSettings({ firstContact: v })} />
              </label>
            </Step>
          </div>
        </div>

        {/* ---------------- Xem trước + nhật ký (live) ---------------- */}
        <div className="flex min-w-0 flex-col border-t @2xl:min-h-0 @2xl:border-t-0">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            {/* preview */}
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{blast.progress.current ? "Đang gửi" : "Xem trước"}</span>
              {blast.progress.current ? (
                <p className="truncate text-sm">
                  {blast.progress.current.peer} <span className="text-muted-foreground">qua {blast.progress.current.sender}</span>
                </p>
              ) : previewText ? (
                <p className="max-w-full self-end whitespace-pre-wrap break-words rounded-lg rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">{previewText}</p>
              ) : (
                <p className="py-1 text-center text-sm text-muted-foreground">{mode === "single" ? "Nhập nội dung để xem trước." : "Tick mẫu để xem trước."}</p>
              )}
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary">{plannedCount} người</Badge>
                <Badge variant="secondary">{senders.length} account</Badge>
                <Badge variant="secondary">{delaySec} giây/tin</Badge>
                {estimate > 0 && <Badge variant="outline">≈ {formatDuration(estimate)}</Badge>}
              </div>
            </div>

            {/* action */}
            {locked ? (
              <Button variant="destructive" onClick={blast.stop} disabled={blast.stopping}>
                {blast.stopping ? <Loader2Icon className="animate-spin" aria-hidden /> : <SquareIcon aria-hidden />}
                {blast.stopping ? "Đang dừng…" : `Dừng gửi · ${blast.progress.done}/${blast.progress.total}`}
              </Button>
            ) : (
              <Button disabled={Boolean(reason)} onClick={onStart}>
                <SendIcon aria-hidden />
                Gửi tới {targets.length} người
              </Button>
            )}
            {!locked && reason && <p className="text-sm text-muted-foreground">{reason}</p>}
            {!locked && !reason && (
              <p className="text-xs text-muted-foreground">
                Mỗi lần gửi account có thể đăng nhập TCP mới rồi ngắt; app điện thoại có thể bị đăng xuất.
              </p>
            )}

            {/* progress */}
            {(locked || blast.progress.total > 0) && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-semibold tabular-nums">
                    {blast.progress.done}/{blast.progress.total}
                  </span>
                  <span className="text-muted-foreground">đã xử lý</span>
                  <span className="flex-1" />
                  <Badge variant="secondary">{blast.progress.ok} ok</Badge>
                  {blast.progress.fail > 0 && <Badge variant="destructive">{blast.progress.fail} lỗi</Badge>}
                </div>
                <Bar value={blast.progress.done} max={blast.progress.total || 1} />
              </div>
            )}

            <SendLog entries={blast.log} canClear={!locked} onClear={blast.clearLog} />
          </div>
        </div>
      </div>

      <TemplatesDialog open={dialog === "templates"} onOpenChange={(o) => setDialog(o ? "templates" : null)} />
      <HistoryDialog open={dialog === "history"} onOpenChange={(o) => setDialog(o ? "history" : null)} rows={recent} />

      <AlertDialog open={dialog === "confirm"} onOpenChange={(o) => setDialog(o ? "confirm" : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gửi tin thật tới {targets.length} người?</AlertDialogTitle>
            <AlertDialogDescription>
              Gửi bằng {senders.length} account ({senders.map((s) => s.label).join(", ")}), mỗi tin cách {delaySec} giây — khoảng {formatDuration(estimateSeconds(targets.length, delaySec))}. Tin đã gửi không thu hồi được; có thể bấm “Dừng gửi” bất cứ lúc nào.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run()}>Gửi {targets.length} tin</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function toggleId(set: (fn: (ids: string[]) => string[]) => void, id: string) {
  set((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
}

function Step({ n, title, meta, children }: { n: number; title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
          {n}
        </span>
        <h3 className="flex-1 text-sm font-semibold">{title}</h3>
        {meta && <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{meta}</span>}
      </div>
      {children}
    </section>
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
      <span className="max-w-32 truncate">{label}</span>
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
