import { PersonAvatar } from "@/components/account-avatar";
import { Card, CardContent } from "@/components/ui/card";
import { toProfileView, type Scalar } from "./profile-view";

/** Renders a user/profile JSON response: header, scalar fields, raw JSON. */
export function ProfileDetails({
  data,
  fallbackName,
  updatedAt,
}: {
  data: Record<string, unknown>;
  fallbackName: string;
  updatedAt?: number;
}) {
  const view = toProfileView(data);
  const name = view.name ?? fallbackName;

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="flex items-center gap-4">
          <PersonAvatar name={name} src={view.avatarUrl} alt={`Ảnh đại diện của ${name}`} className="size-16" />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{name}</p>
            {view.id && <p className="truncate font-mono text-xs text-muted-foreground">ID {view.id}</p>}
            {updatedAt !== undefined && (
              <p className="text-xs text-muted-foreground">
                Cập nhật lúc {new Date(updatedAt).toLocaleTimeString("vi-VN")}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {view.fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">Response không có trường đơn giản nào, xem JSON bên dưới.</p>
          ) : (
            <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
              {view.fields.map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="truncate font-mono text-xs leading-5 text-muted-foreground">{key}</dt>
                  <dd className="min-w-0 break-words">
                    <FieldValue value={value} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>

      <details className="rounded-xl border bg-card text-sm">
        <summary className="cursor-pointer rounded-xl px-4 py-3 font-medium outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50">
          JSON gốc
        </summary>
        <pre className="max-h-96 overflow-auto border-t p-4 font-mono text-xs leading-relaxed">
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function FieldValue({ value }: { value: Scalar }) {
  if (typeof value === "boolean") return <span className="font-mono text-xs">{value ? "true" : "false"}</span>;
  if (typeof value === "number") return <span className="font-mono text-xs tabular-nums">{value}</span>;
  if (value === "") return <span className="text-muted-foreground">—</span>;
  return <span>{value}</span>;
}
