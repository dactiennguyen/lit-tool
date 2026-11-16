import { PersonAvatar } from "@/components/account-avatar";
import { Card, CardContent } from "@/components/ui/card";
import type { UserProfile } from "@/lib/lit/lit-types";
import { toProfileView } from "@/features/profile/lib/profile-view";

/** Renders a typed profile: header card, then the known fields the server sent. */
export function ProfileDetails({
  profile,
  fallbackName,
  updatedAt,
}: {
  profile: UserProfile;
  fallbackName: string;
  updatedAt?: number;
}) {
  const view = toProfileView(profile);
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
          {view.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Server không gửi thông tin chi tiết nào cho user này.</p>
          ) : (
            <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
              {view.rows.map((row) => (
                <div key={row.label} className="contents">
                  <dt className="truncate leading-5 text-muted-foreground">{row.label}</dt>
                  <dd className="min-w-0 break-words">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
