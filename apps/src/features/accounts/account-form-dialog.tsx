import { useId, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Account } from "@/lib/api";
import { useAddAccount, useUpdateAccount } from "@/lib/queries";
import { validateAccountForm, type AccountFormErrors, type AccountFormValues } from "@/lib/validation";

const DEFAULT_VERSION = "7.77.0";

function initialValues(account: Account | null): AccountFormValues {
  return {
    label: account?.label ?? "",
    userId: account?.userId ?? "",
    deviceUuid: account?.deviceUuid ?? "",
    version: account?.version ?? DEFAULT_VERSION,
    siua: account?.siua ?? "",
    dfpid: account?.dfpid ?? "",
    sid: "",
  };
}

export function AccountFormDialog({
  open,
  onOpenChange,
  account,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = add a new account. Give the dialog a new `key` per open so its state starts fresh. */
  account: Account | null;
}) {
  const isEdit = account !== null;
  const [values, setValues] = useState(() => initialValues(account));
  const [errors, setErrors] = useState<AccountFormErrors>({});
  const [showSid, setShowSid] = useState(false);
  const add = useAddAccount();
  const update = useUpdateAccount();
  const navigate = useNavigate();
  const pending = add.isPending || update.isPending;

  const set = (key: keyof AccountFormValues) => (value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found = validateAccountForm(values, { sidRequired: !isEdit });
    setErrors(found);
    if (Object.keys(found).length) return;

    const userId = values.userId.trim() || null;
    const siua = values.siua.trim() || null;
    const dfpid = values.dfpid.trim() || null;
    const sid = values.sid.trim();
    try {
      if (account) {
        await update.mutateAsync({
          id: account.id,
          patch: { label: values.label, userId, version: values.version, siua, dfpid, ...(sid ? { sid } : {}) },
        });
        toast.success("Đã lưu thay đổi");
      } else {
        const created = await add.mutateAsync({
          label: values.label,
          userId,
          deviceUuid: values.deviceUuid,
          version: values.version,
          siua,
          dfpid,
          sid,
        });
        void navigate({ to: "/account/$accountId", params: { accountId: created.id } });
        toast.success(`Đã thêm ${created.label}`);
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không lưu được account");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Sửa account" : "Thêm account"}</DialogTitle>
            <DialogDescription>
              Session (sid) được cất trong secrets.json của app (chỉ user của máy đọc được) và không hiển thị lại.
            </DialogDescription>
          </DialogHeader>

          <Field label="Tên hiển thị" error={errors.label}>
            {(id, describedBy) => (
              <Input
                id={id}
                autoFocus
                value={values.label}
                onChange={(e) => set("label")(e.target.value)}
                placeholder="Ví dụ: Acc chính"
                aria-invalid={!!errors.label}
                aria-describedby={describedBy}
              />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="User ID" optional error={errors.userId}>
              {(id, describedBy) => (
                <Input
                  id={id}
                  value={values.userId}
                  onChange={(e) => set("userId")(e.target.value)}
                  className="font-mono"
                  aria-invalid={!!errors.userId}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
            <Field label="Version app" error={errors.version}>
              {(id, describedBy) => (
                <Input
                  id={id}
                  value={values.version}
                  onChange={(e) => set("version")(e.target.value)}
                  className="font-mono"
                  aria-invalid={!!errors.version}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
          </div>

          <Field
            label="Device UUID"
            hint={isEdit ? "Không đổi được sau khi tạo" : undefined}
            error={errors.deviceUuid}
          >
            {(id, describedBy) => (
              <Input
                id={id}
                value={values.deviceUuid}
                onChange={(e) => set("deviceUuid")(e.target.value)}
                disabled={isEdit}
                spellCheck={false}
                className="font-mono"
                aria-invalid={!!errors.deviceUuid}
                aria-describedby={describedBy}
              />
            )}
          </Field>

          <Field
            label="Session (sid)"
            hint={isEdit ? "Để trống nếu không đổi" : undefined}
            error={errors.sid}
          >
            {(id, describedBy) => (
              <div className="relative">
                <Input
                  id={id}
                  type={showSid ? "text" : "password"}
                  value={values.sid}
                  onChange={(e) => set("sid")(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="pr-9 font-mono"
                  aria-invalid={!!errors.sid}
                  aria-describedby={describedBy}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-1/2 right-0.5 -translate-y-1/2"
                  onClick={() => setShowSid((s) => !s)}
                  aria-label={showSid ? "Ẩn session" : "Hiện session"}
                  aria-pressed={showSid}
                >
                  {showSid ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
                </Button>
              </div>
            )}
          </Field>

          <fieldset className="grid gap-3 rounded-lg border p-3">
            <legend className="px-1 text-xs text-muted-foreground">Token thiết bị (không bắt buộc)</legend>
            <p className="-mt-1 text-xs text-muted-foreground">
              Giá trị thật lấy từ máy đã đăng nhập. Để trống thì app không gửi các header này.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="SIUA" error={errors.siua}>
                {(id, describedBy) => (
                  <Input
                    id={id}
                    value={values.siua}
                    onChange={(e) => set("siua")(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    className="font-mono"
                    aria-invalid={!!errors.siua}
                    aria-describedby={describedBy}
                  />
                )}
              </Field>
              <Field label="DFPID" error={errors.dfpid}>
                {(id, describedBy) => (
                  <Input
                    id={id}
                    value={values.dfpid}
                    onChange={(e) => set("dfpid")(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    className="font-mono"
                    aria-invalid={!!errors.dfpid}
                    aria-describedby={describedBy}
                  />
                )}
              </Field>
            </div>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Huỷ
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" aria-hidden />}
              {isEdit ? "Lưu" : "Thêm account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  optional = false,
  hint,
  error,
  children,
}: {
  label: string;
  optional?: boolean;
  hint?: string | undefined;
  error?: string | undefined;
  children: (id: string, describedBy: string | undefined) => React.ReactNode;
}) {
  const id = useId();
  const msgId = `${id}-msg`;
  const message = error ?? hint;
  return (
    // content-start: side-by-side fields stay aligned even when only one shows a message
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">(không bắt buộc)</span>}
      </Label>
      {children(id, message ? msgId : undefined)}
      {message && (
        <p id={msgId} className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {message}
        </p>
      )}
    </div>
  );
}
