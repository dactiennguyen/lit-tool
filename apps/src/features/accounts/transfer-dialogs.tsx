import { useId, useState } from "react";
import { open as openFile, save as saveFile } from "@tauri-apps/plugin-dialog";
import { CheckCircle2Icon, CopyIcon, FileDownIcon, FileUpIcon, Loader2Icon, TriangleAlertIcon, XCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, type ImportReport } from "@/lib/api";
import { useExportFile, useExportText, useImportAccounts } from "@/lib/queries";

const EXPORT_FILTERS = [{ name: "JSON", extensions: ["json"] }];
/** .skyacc: the password-protected files of earlier builds. */
const IMPORT_FILTERS = [{ name: "Export account", extensions: ["json", "txt", "skyacc"] }];

const today = () => new Date().toISOString().slice(0, 10);
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Whether the text is a password-protected .skyacc file of an earlier build (transfer.rs Envelope). */
export function isPasswordExport(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text.trim().replace(/^﻿/, ""));
    return typeof value === "object" && value !== null && !Array.isArray(value) && "kdf" in value && "data" in value;
  } catch {
    return false;
  }
}

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success("Đã sao chép"),
    () => toast.error("Không sao chép được"),
  );
}

/** Every account (sid, chat login and proxy included) as JSON text, to copy or save to a file. */
export function ExportDialog({ open, onOpenChange }: DialogProps) {
  const exported = useExportText(open);
  const saving = useExportFile();
  const text = exported.data?.text ?? "";
  const skipped = exported.data?.skipped ?? [];

  const save = async () => {
    const path = await saveFile({ defaultPath: `sky-accounts-${today()}.json`, filters: EXPORT_FILTERS });
    if (!path) return;
    saving.mutate(path, {
      onSuccess: (r) => {
        toast.success(`Đã lưu ${r.exported} account vào ${baseName(path)}`);
        onOpenChange(false);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Export account</DialogTitle>
          <DialogDescription>
            Sao chép đoạn dưới hoặc lưu thành file, rồi Import ở máy khác.
          </DialogDescription>
        </DialogHeader>
        <p className="flex gap-2 rounded-lg bg-warning/10 p-2.5 text-xs text-foreground">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
          <span>
            Có sid, mật khẩu chat và proxy của mọi account, không mã hoá. Ai có đoạn này là dùng được account, đừng gửi
            qua kênh công khai.
          </span>
        </p>

        {exported.error ? (
          <p role="alert" className="text-sm text-destructive">
            {message(exported.error)}
          </p>
        ) : exported.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="space-y-1.5">
            <Textarea
              readOnly
              value={text}
              aria-label="Nội dung export"
              spellCheck={false}
              onFocus={(e) => e.currentTarget.select()}
              className="field-sizing-fixed h-64 resize-none font-mono text-xs md:text-xs"
            />
            <p className="text-xs text-muted-foreground">
              {exported.data?.exported} account
              {skipped.length > 0 && `. Bỏ qua (chưa có sid): ${skipped.join(", ")}`}
            </p>
          </div>
        )}
        {saving.error && (
          <p role="alert" className="text-sm text-destructive">
            {message(saving.error)}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => void save()} disabled={!text || saving.isPending}>
            {saving.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <FileDownIcon aria-hidden />}
            Lưu file
          </Button>
          <Button onClick={() => copy(text)} disabled={!text}>
            <CopyIcon aria-hidden />
            Sao chép
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReportList({ title, items, tone }: { title: string; items: string[]; tone: "ok" | "muted" | "error" }) {
  if (items.length === 0) return null;
  const Icon = tone === "error" ? XCircleIcon : CheckCircle2Icon;
  return (
    <section className="space-y-1">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <Icon
          className={tone === "ok" ? "size-4 text-success" : tone === "error" ? "size-4 text-destructive" : "size-4 text-muted-foreground"}
          aria-hidden
        />
        {title} ({items.length})
      </h3>
      <ul className="max-h-32 space-y-0.5 overflow-y-auto pl-6 text-xs text-muted-foreground">
        {items.map((item, i) => (
          <li key={i} className="break-words">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Adds the accounts of a pasted export text or a picked file; those already here (same device UUID) are skipped. */
export function ImportDialog({ open, onOpenChange }: DialogProps) {
  const importing = useImportAccounts();
  const textId = useId();
  const passwordId = useId();
  const [text, setText] = useState("");
  const [password, setPassword] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const needsPassword = isPasswordExport(text);

  const edit = (value: string) => {
    setText(value);
    setFileError(null);
    importing.reset();
  };

  const pick = async () => {
    const picked = await openFile({ multiple: false, directory: false, filters: IMPORT_FILTERS });
    if (typeof picked !== "string") return;
    try {
      edit(await api.accounts.readFile(picked));
    } catch (err) {
      setFileError(message(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import account</DialogTitle>
          <DialogDescription>
            Dán nội dung đã export, hoặc chọn file. Account đã có (trùng device UUID) được giữ nguyên.
          </DialogDescription>
        </DialogHeader>
        {report ? (
          <div className="space-y-3" aria-live="polite">
            <ReportList title="Đã thêm" items={report.added} tone="ok" />
            <ReportList title="Bỏ qua, đã có" items={report.skipped} tone="muted" />
            <ReportList title="Không thêm được" items={report.failed.map(([label, why]) => `${label}: ${why}`)} tone="error" />
            {report.added.length + report.skipped.length + report.failed.length === 0 && (
              <p className="text-sm text-muted-foreground">Không có account nào.</p>
            )}
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Xong</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim() || importing.isPending) return;
              importing.mutate({ text, password: needsPassword ? password : undefined }, { onSuccess: setReport });
            }}
          >
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={textId}>Nội dung export</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => void pick()}>
                  <FileUpIcon aria-hidden />
                  Chọn file
                </Button>
              </div>
              <Textarea
                id={textId}
                autoFocus
                value={text}
                onChange={(e) => edit(e.target.value)}
                placeholder='{"format": "sky-manager-accounts", "accounts": [...]}'
                spellCheck={false}
                className="field-sizing-fixed h-56 resize-none font-mono text-xs md:text-xs"
              />
            </div>
            {needsPassword && (
              <div className="space-y-1.5">
                <Label htmlFor={passwordId}>Mật khẩu file (bản export cũ có mật khẩu)</Label>
                <Input
                  id={passwordId}
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    importing.reset();
                  }}
                />
              </div>
            )}
            {(fileError || importing.error) && (
              <p role="alert" className="text-sm text-destructive">
                {fileError ?? message(importing.error)}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={!text.trim() || (needsPassword && !password) || importing.isPending}>
                {importing.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
                Import
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
