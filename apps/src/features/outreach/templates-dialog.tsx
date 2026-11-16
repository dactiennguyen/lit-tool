import { useState } from "react";
import { CheckIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { setTemplates, useTemplates } from "./templates";

/** Add / edit / delete saved message texts (localStorage). */
export function TemplatesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const templates = useTemplates();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<number | null>(null);

  const cancelEdit = () => {
    setEditing(null);
    setDraft("");
  };
  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setTemplates(editing === null ? [...templates, text] : templates.map((t, i) => (i === editing ? text : t)));
    cancelEdit();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) cancelEdit();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tin nhắn mẫu</DialogTitle>
          <DialogDescription>Dùng cho “Ngẫu nhiên từ mẫu” khi gửi hàng loạt.</DialogDescription>
        </DialogHeader>

        {templates.length ? (
          <ol className="flex max-h-60 flex-col gap-1.5 overflow-y-auto">
            {templates.map((t, i) => (
              <li
                key={i}
                className={cn(
                  "flex items-start gap-2 rounded-md border bg-background px-3 py-2",
                  editing === i ? "border-primary" : "border-border",
                )}
              >
                <span className="mt-0.5 w-5 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{i + 1}.</span>
                <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm">{t}</p>
                <Button variant="ghost" size="icon-sm" aria-label={`Sửa mẫu ${i + 1}`} onClick={() => { setEditing(i); setDraft(t); }}>
                  <PencilIcon aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Xoá mẫu ${i + 1}`}
                  onClick={() => {
                    if (editing === i) cancelEdit();
                    setTemplates(templates.filter((_, j) => j !== i));
                  }}
                >
                  <Trash2Icon className="text-destructive" aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            Chưa có mẫu nào. Thêm các câu hay dùng để gửi ngẫu nhiên.
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tpl-draft">{editing === null ? "Thêm mẫu mới" : `Sửa mẫu ${editing + 1}`}</Label>
          <Textarea id="tpl-draft" rows={3} maxLength={4000} placeholder="Nội dung mẫu" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>

        <DialogFooter>
          {editing !== null && (
            <Button variant="ghost" onClick={cancelEdit}>
              Huỷ sửa
            </Button>
          )}
          <Button disabled={!draft.trim()} onClick={submit}>
            {editing === null ? <PlusIcon aria-hidden /> : <CheckIcon aria-hidden />}
            {editing === null ? "Thêm mẫu" : "Lưu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
