import { useId, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type Account, type DeviceSetup } from "@/lib/api";
import { useAddAccount, useUpdateAccount } from "@/lib/queries";
import { validateAccountForm, type AccountFormErrors, type AccountFormValues } from "@/lib/validation";

const DEFAULT_VERSION = "7.77.0";

function initialValues(account: Account | null): AccountFormValues {
  return {
    label: account?.label ?? "",
    deviceUuid: account?.deviceUuid ?? "",
    version: account?.version ?? DEFAULT_VERSION,
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
  const [deviceEnabled, setDeviceEnabled] = useState(account?.deviceEnabled ?? false);
  const deviceSwitchId = useId();
  const [draftDevice, setDevice] = useState<DeviceSetup | null>(null);
  const device = draftDevice ?? account?.device ?? null;
  const [generating, setGenerating] = useState(false);
  const add = useAddAccount();
  const update = useUpdateAccount();
  const navigate = useNavigate();
  const pending = add.isPending || update.isPending || generating;

  const set = (key: keyof AccountFormValues) => (value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const found = validateAccountForm({ ...values, dfpid: deviceEnabled ? values.dfpid : "" }, { sidRequired: !isEdit, automaticDevice: !isEdit && deviceEnabled });
    if (deviceEnabled && device && values.deviceUuid.trim() && device.deviceUuid !== values.deviceUuid.trim()) found.dfpid = "Làm mới DFPID để JSON khớp UUID đã nhập";
    if (deviceEnabled && device && device.version !== values.version.trim()) found.version = "Làm mới DFPID sau khi đổi version";
    if (deviceEnabled && draftDevice && draftDevice.exp <= Date.now()) found.dfpid = "DFPID bản nháp đã hết hạn, hãy làm mới";
    if (isEdit && deviceEnabled && !device && !values.dfpid.trim()) found.dfpid = "Tạo thiết bị hoặc nhập DFPID trước khi bật";
    setErrors(found);
    if (Object.keys(found).length) return;

    const dfpid = values.dfpid.trim() || null;
    const sid = values.sid.trim();
    const devicePatch = !deviceEnabled ? {} : draftDevice
      ? { device: draftDevice, dfpid: draftDevice.dfpId }
      : !device ? { dfpid } : {};
    try {
      if (account) {
        await update.mutateAsync({
          id: account.id,
          patch: {
            label: values.label, version: values.version, deviceEnabled,
            ...(values.deviceUuid !== account.deviceUuid ? { deviceUuid: values.deviceUuid } : {}),
            ...(sid ? { sid } : {}),
            ...devicePatch,
          },
        });
        toast.success("Đã lưu thay đổi");
      } else {
        const created = await add.mutateAsync({
          label: values.label,
          deviceUuid: values.deviceUuid,
          version: values.version,
          deviceEnabled,
          sid,
          ...(deviceEnabled ? { dfpid, ...(draftDevice ? { device: draftDevice } : {}) } : {}),
        });
        void navigate({ to: "/account/$accountId", params: { accountId: created.id } });
        toast.success(`Đã thêm ${created.label}`);
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không lưu được account");
    }
  }

  async function generateDevice(random: boolean) {
    if (pending || !deviceEnabled) return;
    setGenerating(true);
    try {
      const result = await api.device.generate({
        accountId: account?.id, sid: values.sid.trim() || undefined, version: values.version,
        deviceUuid: values.deviceUuid.trim() || undefined, fields: device?.fields, random,
      });
      setDevice(result);
      setValues((v) => ({ ...v, deviceUuid: v.deviceUuid.trim() || result.deviceUuid, dfpid: result.dfpId, version: result.version }));
      setErrors((e) => ({ ...e, deviceUuid: undefined, dfpid: undefined, version: undefined }));
      toast.success(random ? "Đã tạo thiết bị và lấy DFPID. Bấm Lưu để áp dụng." : "Đã làm mới DFPID. Bấm Lưu để áp dụng.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không lấy được DFPID");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Sửa account" : "Thêm account"}</DialogTitle>
            <DialogDescription>
              Session (sid) được cất trong sky.db của app (chỉ user của máy đọc được) và không hiển thị lại.
            </DialogDescription>
          </DialogHeader>

          <fieldset disabled={pending} className="grid min-w-0 gap-4">
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

            <Field
              label="Device UUID của phiên đăng nhập"
              hint="Nhập UUID đi cùng sid. Khi tắt Thiết bị, request dùng UUID này."
              error={errors.deviceUuid}
            >
              {(id, describedBy) => (
                <Input
                  id={id}
                  value={values.deviceUuid}
                  onChange={(e) => set("deviceUuid")(e.target.value)}
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
              <legend className="px-1 text-xs text-muted-foreground">Thiết bị</legend>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={deviceSwitchId}>Bật thiết bị</Label>
                <Switch id={deviceSwitchId} checked={deviceEnabled} disabled={pending}
                  onCheckedChange={(checked) => { setDeviceEnabled(checked); setErrors({}); }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {!deviceEnabled
                  ? "Đang tắt: không tự tạo hoặc refresh thiết bị, không gắn X-DFPID hay UUID/model từ JSON. Dữ liệu đã lưu được giữ lại."
                  : !isEdit && !device
                  ? "Khi thêm account, app tự tạo thiết bị, lấy DFPID và lưu thông tin. Giữ UUID đã nhập; chỉ sinh UUID khi chưa có."
                  : !device ? "Tạo thiết bị hoặc nhập DFPID trước khi lưu. Tự refresh chỉ áp dụng khi có JSON thiết bị."
                  : "Tạo, xoay và refresh đều giữ UUID của account. JSON và DFPID dùng cùng UUID này; chỉ thay thông tin khác khi bạn bấm Xoay thiết bị."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" disabled={!deviceEnabled} onClick={() => void generateDevice(true)}>
                  {generating && <Loader2Icon className="animate-spin" aria-hidden />}
                  {device ? "Xoay thiết bị" : "Tạo thiết bị trước"}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={!deviceEnabled || !device} onClick={() => void generateDevice(false)}>
                  Làm mới DFPID
                </Button>
              </div>
              {device && <p className="text-xs text-muted-foreground" role="status">
                {String(device.fields.model)} · {Object.keys(device.fields).length} trường · Hết hạn {new Date(device.exp).toLocaleString("vi-VN")}
              </p>}
              {device && <details className="min-w-0 text-xs">
                <summary className="cursor-pointer">Xem thông tin thiết bị{draftDevice ? " (bản nháp)" : " đã lưu"}</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded border p-2 select-text">{JSON.stringify(device, null, 2)}</pre>
              </details>}
              {(deviceEnabled || device) && <Field label="DFPID" error={errors.dfpid}>
                {(id, describedBy) => (
                  <Input
                    id={id}
                    value={device?.dfpId ?? values.dfpid}
                    disabled={!deviceEnabled}
                    readOnly={!!device}
                    onChange={(e) => set("dfpid")(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    className="font-mono"
                    aria-invalid={!!errors.dfpid}
                    aria-describedby={describedBy}
                  />
                )}
              </Field>}
            </fieldset>
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
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: (id: string, describedBy: string | undefined) => React.ReactNode;
}) {
  const id = useId();
  const msgId = `${id}-msg`;
  const message = error ?? hint;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children(id, message ? msgId : undefined)}
      {message && (
        <p id={msgId} className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {message}
        </p>
      )}
    </div>
  );
}
