import { CheckIcon, CircleHelpIcon, DownloadIcon, SearchIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { PersonAvatar } from "@/components/account-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GENDER_LABEL, genderOf, locationOf, safeImageUrl, tagNames } from "@/lib/lit/lit-format";
import type { UserProfile } from "@/lib/lit/lit-types";
import { cn } from "@/lib/utils";
import { userKey } from "@/features/outreach/lib/outreach-view";
import type { Contact } from "@/features/outreach/store/sent-log";

export type ExportFormat = "csv" | "json";

/** Collected people: filter, export, and tick who gets the message. */
export function RecipientList({
  found,
  shown,
  contacts,
  query,
  onQuery,
  hideContacted,
  onHideContacted,
  isPicked,
  pickedCount,
  onToggle,
  onSelectAll,
  onSelectNone,
  onExport,
  onClear,
  busy,
}: {
  found: UserProfile[];
  /** `found` after the filters below. */
  shown: UserProfile[];
  contacts: Map<string, Contact[]>;
  query: string;
  onQuery: (query: string) => void;
  hideContacted: boolean;
  onHideContacted: (hide: boolean) => void;
  isPicked: (uid: string) => boolean;
  pickedCount: number;
  onToggle: (uid: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onExport: (format: ExportFormat) => void;
  onClear: () => void;
  /** Collecting is running. */
  busy: boolean;
}) {
  const all = shown.length > 0 && pickedCount === shown.length;
  return (
    <section aria-label="Danh sách người nhận" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 p-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            className="w-full pl-8"
            placeholder={`Lọc tên, ID, nơi ở · ${shown.length}/${found.length}`}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            aria-label="Lọc danh sách người nhận"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-pressed={hideContacted}
            onClick={() => onHideContacted(!hideContacted)}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors",
              hideContacted ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-accent",
            )}
          >
            {hideContacted && <CheckIcon className="size-3" aria-hidden />}
            Ẩn đã nhắn
          </button>
          <span className="flex-1" />
          <Button size="xs" variant="outline" disabled={!shown.length} onClick={() => onExport("csv")}>
            <DownloadIcon aria-hidden />
            CSV
          </Button>
          <Button size="xs" variant="outline" disabled={!shown.length} onClick={() => onExport("json")}>
            <DownloadIcon aria-hidden />
            JSON
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="Xoá danh sách đã lấy" disabled={!found.length || busy} onClick={onClear}>
            <Trash2Icon className="text-destructive" aria-hidden />
          </Button>
        </div>
      </div>

      {shown.length > 0 && (
        <div className="flex items-center gap-2 border-y bg-muted/40 px-3 py-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={all}
              ref={(el) => {
                if (el) el.indeterminate = pickedCount > 0 && !all;
              }}
              onChange={(e) => (e.target.checked ? onSelectAll() : onSelectNone())}
            />
            Chọn tất cả
          </label>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            <strong className="font-semibold text-foreground">{pickedCount}</strong>/{shown.length} chọn
          </span>
        </div>
      )}

      {!found.length ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
          <UsersIcon className="size-6" aria-hidden />
          {busy ? "Đang lấy… người tìm thấy sẽ hiện ở đây." : "Chưa có danh sách. Nhập số và bấm “Lấy danh sách”."}
        </div>
      ) : !shown.length ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
          <SearchIcon className="size-6" aria-hidden />
          Không ai khớp bộ lọc. Đổi từ khoá hoặc tắt “Ẩn đã nhắn”.
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
          {shown.map((u) => (
            <RecipientRow key={userKey(u)} user={u} sent={contacts.get(userKey(u)) ?? []} picked={isPicked(userKey(u))} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RecipientRow({ user: u, sent, picked, onToggle }: { user: UserProfile; sent: Contact[]; picked: boolean; onToggle: (uid: string) => void }) {
  const key = userKey(u);
  const name = u.nickname || `${key.slice(0, 10)}…`;
  const g = genderOf(u.gender);
  const meta = [g && GENDER_LABEL[g], u.age ? `${u.age} tuổi` : "", locationOf(u), ...tagNames(u, 2)].filter(Boolean).join(" · ");
  const sentCount = sent.reduce((n, c) => n + c.count, 0);
  const uncertainCount = sent.reduce((n, c) => n + c.uncertain, 0);
  return (
    <li>
      <label className={cn("flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50", !picked && "opacity-60")}>
        <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={picked} onChange={() => onToggle(key)} aria-label={`Chọn ${name}`} />
        <PersonAvatar name={name} src={safeImageUrl(u.avatar)} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <span className="truncate">{name}</span>
            {u.isVip && <Badge variant="secondary" className="h-4 px-1 text-[10px]">VIP</Badge>}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{meta || "—"}</span>
        </span>
        {(sentCount > 0 || uncertainCount > 0) && (
          <Badge
            variant="outline"
            className="shrink-0 gap-1"
            title={sent.map((c) => `${c.accountLabel} (${c.count}${c.uncertain ? ` +${c.uncertain} chưa rõ` : ""})`).join(", ")}
          >
            {sentCount > 0 ? <CheckIcon className="size-3" aria-hidden /> : <CircleHelpIcon className="size-3" aria-hidden />}
            {sentCount > 0 ? sentCount : `${uncertainCount}?`}
          </Badge>
        )}
      </label>
    </li>
  );
}
