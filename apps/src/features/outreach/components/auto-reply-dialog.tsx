import { useRef, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { canSend, MAX_TEXT_BYTES, utf8Bytes } from "@/features/chat/lib/chat-view";
import { fillTemplate, SAMPLE_USER } from "@/features/outreach/lib/outreach-view";
import { patchAutoReply, useAutoReply } from "@/features/outreach/store/auto-reply-settings";
import { useAutoReplyStatus } from "@/features/outreach/store/auto-reply-status";
import { useTemplates } from "@/features/outreach/store/templates";
import { cn } from "@/lib/utils";
import { NumberField } from "./number-field";
import { TemplateVarBar } from "./template-vars";
import { TemplatesDialog } from "./templates-dialog";

/** Settings for auto-reply: one switch for all accounts, the reply content, and limits. */
export function AutoReplyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const s = useAutoReply();
  const status = useAutoReplyStatus();
  const templates = useTemplates();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [tplOpen, setTplOpen] = useState(false);

  const pool = templates.map((t) => t.trim()).filter(canSend);
  const bytes = utf8Bytes(s.text);
  const rawPreview = s.mode === "single" ? s.text.trim() : (pool[0] ?? "");
  const hasContent = s.mode === "single" ? canSend(s.text) : pool.length > 0;
  const preview = hasContent ? fillTemplate(rawPreview, SAMPLE_USER) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tự động trả lời</DialogTitle>
          <DialogDescription>Tự trả lời tin nhắn đến trên mọi nick đang đăng nhập.</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3">
            <span className="flex flex-col">
              <span className="text-sm font-medium">Bật tự động trả lời</span>
              <span className="text-xs text-muted-foreground">Áp dụng cho tất cả nick đang đăng nhập.</span>
            </span>
            <Switch checked={s.enabled} onCheckedChange={(v) => patchAutoReply({ enabled: v })} />
          </label>

          {s.enabled && (
            <p className="text-xs text-muted-foreground">
              Đã trả lời <strong className="tabular-nums text-foreground">{status.replied}</strong> tin phiên này
              {status.lastPeer ? ` · gần nhất: ${status.lastPeer}` : ""}.
              {status.lastError && <span className="text-destructive"> · Lỗi: {status.lastError}</span>}
            </p>
          )}

          {/* ---- content ---- */}
          <section className="flex flex-col gap-2">
            <span className="text-sm font-semibold">Nội dung trả lời</span>
            <div className="inline-flex self-start rounded-md border p-0.5">
              {(["single", "random"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => patchAutoReply({ mode: m })}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs",
                    s.mode === m ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m === "single" ? "Một nội dung" : `Ngẫu nhiên từ mẫu (${templates.length})`}
                </button>
              ))}
            </div>

            {s.mode === "single" ? (
              <>
                <Textarea
                  ref={textRef}
                  rows={3}
                  maxLength={4000}
                  value={s.text}
                  onChange={(e) => patchAutoReply({ text: e.target.value })}
                  placeholder="Vd: Chào {ten}, mình đang bận chút, sẽ rep sớm nha!"
                  aria-invalid={bytes > MAX_TEXT_BYTES}
                  className="resize-y"
                />
                <TemplateVarBar textareaRef={textRef} value={s.text} onChange={(t) => patchAutoReply({ text: t })} />
                {bytes > MAX_TEXT_BYTES * 0.8 && (
                  <p className={cn("text-right text-xs tabular-nums", bytes > MAX_TEXT_BYTES && "text-destructive")}>
                    {bytes}/{MAX_TEXT_BYTES} byte
                  </p>
                )}
              </>
            ) : (
              <div className="flex items-center justify-between gap-2 rounded-md border border-dashed p-3 text-sm">
                <span className="text-muted-foreground">
                  {pool.length
                    ? `Trả lời ngẫu nhiên 1 trong ${pool.length} mẫu (dùng chung “Mẫu tin”).`
                    : "Chưa có mẫu nào — thêm mẫu để dùng chế độ ngẫu nhiên."}
                </span>
                <Button size="xs" variant="outline" onClick={() => setTplOpen(true)}>
                  Sửa mẫu
                </Button>
              </div>
            )}

            {hasContent && (
              <div className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-2.5">
                <span className="text-xs text-muted-foreground">Xem trước (ví dụ)</span>
                <p className="max-w-full self-start whitespace-pre-wrap break-words rounded-lg rounded-bl-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                  {preview}
                </p>
              </div>
            )}
          </section>

          {/* ---- limits ---- */}
          <section className="flex flex-col gap-2.5">
            <span className="text-sm font-semibold">Giới hạn (chống spam)</span>
            <Row label="Trả lời mỗi người tối đa" hint="0 = không giới hạn">
              <NumberField
                value={s.maxPerPerson}
                onCommit={(n) => patchAutoReply({ maxPerPerson: Math.floor(n) })}
                className="w-20 tabular-nums"
                aria-label="Số lần trả lời tối đa mỗi người"
              />
              <span className="text-xs text-muted-foreground">lần</span>
            </Row>
            <Row label="Hai lần cách nhau ít nhất">
              <NumberField
                value={s.minGapSec}
                onCommit={(n) => patchAutoReply({ minGapSec: n })}
                className="w-20 tabular-nums"
                aria-label="Giãn cách tối thiểu giữa 2 lần trả lời cùng người (giây)"
              />
              <span className="text-xs text-muted-foreground">giây/người</span>
            </Row>
            <Row label="Mỗi nick tối đa" hint="0 = không giới hạn">
              <NumberField
                value={s.maxPerHour}
                onCommit={(n) => patchAutoReply({ maxPerHour: Math.floor(n) })}
                className="w-20 tabular-nums"
                aria-label="Số tin trả lời tối đa mỗi nick mỗi giờ"
              />
              <span className="text-xs text-muted-foreground">tin/giờ</span>
            </Row>
            <Row label="Chờ trước khi trả lời">
              <NumberField
                decimal
                value={s.delayMinSec}
                onCommit={(n) => patchAutoReply({ delayMinSec: n })}
                className="w-16 tabular-nums"
                aria-label="Thời gian chờ tối thiểu (giây)"
              />
              <span className="text-xs text-muted-foreground">–</span>
              <NumberField
                decimal
                value={s.delayMaxSec}
                onCommit={(n) => patchAutoReply({ delayMaxSec: n })}
                className="w-16 tabular-nums"
                aria-label="Thời gian chờ tối đa (giây)"
              />
              <span className="text-xs text-muted-foreground">giây (ngẫu nhiên)</span>
            </Row>
          </section>

          <p className="text-xs text-muted-foreground">
            Chỉ trả lời tin nhắn chữ đến từ người khác (bỏ qua ảnh/quà, không tự trả lời chính mình). Cần bật “tự kết nối
            TCP” để nhận được tin.
          </p>
        </div>

        <TemplatesDialog open={tplOpen} onOpenChange={setTplOpen} />
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 text-sm">
        {label}
        {hint && <span className="ml-1 text-xs text-muted-foreground">({hint})</span>}
      </span>
      {children}
    </div>
  );
}
