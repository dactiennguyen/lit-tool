import { useId, useState } from "react";
import { open as openFile, save as saveFile } from "@tauri-apps/plugin-dialog";
import { CheckCircle2Icon, FileUpIcon, Loader2Icon, XCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ImportReport } from "@/lib/api";
import { useExportAccounts, useImportAccounts } from "@/lib/queries";

/** Same as transfer.rs MIN_PASSWORD. */
export const MIN_FILE_PASSWORD = 8;
const FILTERS = [{ name: "Sky Manager accounts", extensions: ["skyacc"] }];

/** Why the export password cannot be used yet, or null. */
export function exportPasswordProblem(password: string, confirm: string): string | null {
  if ([...password].length < MIN_FILE_PASSWORD) return `Mật khẩu cần ít nhất ${MIN_FILE_PASSWORD} ký tự`;
  if (password !== confirm) return "Hai mật khẩu chưa khớp";
  return null;
}

const today = () => new Date().toISOString().slice(0, 10);
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

function PasswordField({ label, value, onChange, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="password" autoComplete="new-password" autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/**
 * Exports every account (sid and chat login included) to a file encrypted
 * with a password; the backend writes it, the secrets never reach this page.
 */
export function ExportDialog({ open, onOpenChange, count }: DialogProps & { count: number }) {
  const exporting = useExportAccounts();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const problem = exportPasswordProblem(password, confirm);

  const run = async () => {
    const path = await saveFile({ defaultPath: `sky-accounts-${today()}.skyacc`, filters: FILTERS });
    if (!path) return;
    exporting.mutate(
      { path, password },
      {
        onSuccess: (r) => {
          toast.success(
            `Đã export ${r.exported} account vào ${baseName(path)}` +
              (r.skipped.length ? `. Bỏ qua (chưa có sid): ${r.skipped.join(", ")}` : ""),
          );
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export account</DialogTitle>
          <DialogDescription>
            Lưu {count} account kèm sid và đăng nhập chat vào một file, mã hoá bằng mật khẩu dưới đây. Ai có file và mật
            khẩu là dùng được account, nên giữ cả hai cẩn thận. Quên mật khẩu thì không mở lại được file.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!problem && !exporting.isPending) void run();
          }}
        >
          <PasswordField label="Mật khẩu file" value={password} onChange={setPassword} autoFocus />
          <PasswordField label="Nhập lại mật khẩu" value={confirm} onChange={setConfirm} />
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {password || confirm ? (problem ?? "Mật khẩu hợp lệ") : `Ít nhất ${MIN_FILE_PASSWORD} ký tự.`}
          </p>
          {exporting.error && (
            <p role="alert" className="text-sm text-destructive">
              {exporting.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={!!problem || exporting.isPending}>
              {exporting.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
              Chọn nơi lưu và export
            </Button>
          </DialogFooter>
        </form>
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

/** Adds the accounts of an export file; those already here (same device UUID) are skipped. */
export function ImportDialog({ open, onOpenChange }: DialogProps) {
  const importing = useImportAccounts();
  const [path, setPath] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);

  const pick = async () => {
    const picked = await openFile({ multiple: false, directory: false, filters: FILTERS });
    if (typeof picked === "string") {
      setPath(picked);
      setReport(null);
      importing.reset();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import account</DialogTitle>
          <DialogDescription>
            Chọn file export (.skyacc) và nhập mật khẩu của file. Account đã có (trùng device UUID) được giữ nguyên.
          </DialogDescription>
        </DialogHeader>
        {report ? (
          <div className="space-y-3" aria-live="polite">
            <ReportList title="Đã thêm" items={report.added} tone="ok" />
            <ReportList title="Bỏ qua, đã có" items={report.skipped} tone="muted" />
            <ReportList title="Không thêm được" items={report.failed.map(([label, why]) => `${label}: ${why}`)} tone="error" />
            {report.added.length + report.skipped.length + report.failed.length === 0 && (
              <p className="text-sm text-muted-foreground">File không có account nào.</p>
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
              if (!path || !password || importing.isPending) return;
              importing.mutate({ path, password }, { onSuccess: setReport });
            }}
          >
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => void pick()}>
                <FileUpIcon aria-hidden />
                Chọn file
              </Button>
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={path ?? undefined}>
                {path ? baseName(path) : "Chưa chọn file"}
              </span>
            </div>
            <PasswordField label="Mật khẩu file" value={password} onChange={setPassword} />
            {importing.error && (
              <p role="alert" className="text-sm text-destructive">
                {importing.error.message}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={!path || !password || importing.isPending}>
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
