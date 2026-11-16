import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownLeftIcon, ArrowUpRightIcon, CircleDotIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Account, LiveState } from "@/lib/api";
import { clearLogs, useHttpLog, useTcpLog, type HttpEntry, type TcpEntry } from "@/stores/hx-log";
import { cn } from "@/lib/utils";

type Tab = "tcp" | "http";

const timeFmt = new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
/** Time to the millisecond, then the date (dateStyle/timeStyle cannot take milliseconds). */
const preciseFmt = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
});

function stateText(s: LiveState): string {
  switch (s.state) {
    case "connecting":
      return "Đang kết nối";
    case "live":
      return "Đang nhận tin";
    case "retrying":
      return `Mất kết nối: ${s.message}`;
    case "stopped":
      return s.message ? `Dừng: ${s.message}` : "Đã ngắt kết nối";
  }
}

const httpOk = (e: HttpEntry) => e.status !== null && e.status >= 200 && e.status < 300;

function Row({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          "flex w-full items-start gap-2 px-3 py-1 text-left outline-none hover:bg-muted focus-visible:bg-muted",
          selected && "bg-accent text-accent-foreground hover:bg-accent",
        )}
      >
        {children}
      </button>
    </li>
  );
}

function TcpRow({ entry }: { entry: TcpEntry }) {
  const isState = entry.dir === "state";
  const Icon = isState ? CircleDotIcon : entry.dir === "in" ? ArrowDownLeftIcon : ArrowUpRightIcon;
  return (
    <>
      <time className="shrink-0 text-muted-foreground tabular-nums">{timeFmt.format(entry.at)}</time>
      <Icon
        className={cn("mt-0.5 size-3.5 shrink-0", isState ? "text-muted-foreground" : entry.dir === "in" ? "text-success" : "text-primary")}
        aria-label={isState ? "Trạng thái" : entry.dir === "in" ? "Vào" : "Ra"}
      />
      {isState ? (
        <span className="min-w-0 truncate text-muted-foreground">{stateText(entry.state)}</span>
      ) : (
        <span className="min-w-0 truncate">
          <span className="font-semibold uppercase">{entry.kind}</span>
          {entry.summary && <span className="text-muted-foreground"> {entry.summary}</span>}
        </span>
      )}
    </>
  );
}

function HttpRow({ entry }: { entry: HttpEntry }) {
  return (
    <>
      <time className="shrink-0 text-muted-foreground tabular-nums">{timeFmt.format(entry.at)}</time>
      <span className={cn("w-8 shrink-0 font-semibold tabular-nums", httpOk(entry) ? "text-success" : "text-destructive")}>
        {entry.status ?? "ERR"}
      </span>
      <span className="shrink-0 font-semibold">{entry.method}</span>
      <span className="min-w-0 flex-1 truncate">{entry.path}</span>
      <span className="shrink-0 text-muted-foreground tabular-nums">{entry.ms} ms</span>
    </>
  );
}

/** A block of text (a body or a frame dump), wrapped, with a copy button. */
function Block({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <section className="space-y-1">
      <div className="flex items-center justify-between gap-2 font-sans">
        <h4 className="text-[11px] font-medium text-muted-foreground uppercase">{label}</h4>
        <Button
          variant="ghost"
          size="xs"
          onClick={() =>
            void navigator.clipboard.writeText(text).then(
              () => toast.success("Đã sao chép"),
              () => toast.error("Không sao chép được"),
            )
          }
        >
          <CopyIcon aria-hidden />
          Sao chép
        </Button>
      </div>
      <pre className="max-h-72 overflow-auto rounded-md bg-muted p-2 break-all whitespace-pre-wrap">{text}</pre>
    </section>
  );
}

/** A titled group of the details, open by default. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details open className="space-y-2 border-t pt-2">
      <summary className="cursor-pointer font-sans text-xs font-semibold">{title}</summary>
      <div className="space-y-2">{children}</div>
    </details>
  );
}

/** Name and value pairs; empty values are left out. */
function Fields({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
      {rows
        .filter(([, v]) => v !== "" && v !== null && v !== undefined)
        .map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-words">{v}</dd>
          </div>
        ))}
    </dl>
  );
}

function TcpDetail({ entry }: { entry: TcpEntry }) {
  const time: [string, ReactNode] = ["Thời gian", preciseFmt.format(entry.at)];
  if (entry.dir === "state") {
    const s = entry.state;
    return (
      <Fields
        rows={[
          time,
          ["Trạng thái", stateText(s)],
          ["Lúc kết nối", s.state === "live" ? preciseFmt.format(s.since) : ""],
          ["Thử lại lúc", s.state === "retrying" ? preciseFmt.format(s.retryAt) : ""],
        ]}
      />
    );
  }
  return (
    <div className="space-y-3">
      <Fields
        rows={[
          time,
          ["Hướng", entry.dir === "in" ? "Vào (server → app)" : "Ra (app → server)"],
          ["Loại", entry.kind.toUpperCase()],
          ["Kích thước", `${entry.bytes} byte`],
          ...entry.info,
        ]}
      />
      <Block label="Dữ liệu frame (field: giá trị)" text={entry.data} />
    </div>
  );
}

function HttpDetail({ entry }: { entry: HttpEntry }) {
  return (
    <div className="space-y-3">
      <Fields
        rows={[
          ["Thời gian", preciseFmt.format(entry.at)],
          ["Dịch vụ", entry.service],
          ["Status", entry.status ?? ""],
          ["Thời gian chờ", `${entry.ms} ms`],
          ["Kích thước", entry.bytes !== null ? `${entry.bytes} byte` : ""],
          ["Lỗi", entry.error ?? ""],
        ]}
      />
      <Group title="Request">
        <Fields rows={[["URL", `${entry.method} ${entry.origin}${entry.path}`]]} />
        {entry.query.length > 0 && (
          <>
            <h4 className="font-sans text-[11px] font-medium text-muted-foreground uppercase">Tham số query</h4>
            <Fields rows={entry.query} />
          </>
        )}
        {entry.requestHeaders.length > 0 && (
          <>
            <h4 className="font-sans text-[11px] font-medium text-muted-foreground uppercase">Header</h4>
            <Fields rows={entry.requestHeaders} />
          </>
        )}
        <Block label="Body" text={entry.requestBody} />
      </Group>
      <Group title="Response">
        {entry.responseHeaders.length > 0 && (
          <>
            <h4 className="font-sans text-[11px] font-medium text-muted-foreground uppercase">Header</h4>
            <Fields rows={entry.responseHeaders} />
          </>
        )}
        <Block label="Body" text={entry.responseBody} />
        {!entry.responseBody && !entry.error && <p className="font-sans text-muted-foreground">Không có body.</p>}
      </Group>
    </div>
  );
}

/**
 * The account's connection log: frames of its live chat connection (TCP) and
 * its API requests (HTTP), newest at the bottom; a row shows its details.
 */
export function LogDialog({ account, open, onOpenChange }: { account: Account; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [tab, setTab] = useState<Tab>("tcp");
  const [selected, setSelected] = useState<number | null>(null);
  const tcp = useTcpLog(account.id);
  const http = useHttpLog(account.id);
  const entries = tab === "tcp" ? tcp : http;
  const current = entries.find((e) => e.id === selected) ?? null;
  const end = useRef<HTMLLIElement>(null);

  // Follow new entries while nothing is selected (by the last id: the length stops changing once full).
  const lastId = entries.at(-1)?.id;
  useEffect(() => {
    if (open && selected === null) end.current?.scrollIntoView({ block: "end" });
  }, [open, selected, lastId, tab]);

  const switchTo = (t: Tab) => {
    setTab(t);
    setSelected(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Log kết nối</DialogTitle>
          <DialogDescription>
            Từ lúc mở app. Sid, chữ ký, token, mật khẩu và session hiện là •••.
          </DialogDescription>
        </DialogHeader>

        <div role="group" aria-label="Loại log" className="flex gap-1">
          {(["tcp", "http"] as const).map((t) => (
            <Button key={t} size="sm" variant={tab === t ? "secondary" : "ghost"} aria-pressed={tab === t} onClick={() => switchTo(t)}>
              {t.toUpperCase()}
              <span className="text-muted-foreground tabular-nums">{(t === "tcp" ? tcp : http).length}</span>
            </Button>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {tab === "tcp" ? "Chưa có gì. Bấm Kết nối để bắt đầu." : "Chưa có request nào."}
            </p>
          ) : (
            <ol aria-label={`Log ${tab.toUpperCase()}`} className="max-h-[55vh] overflow-y-auto rounded-lg border py-1 font-mono text-xs">
              {tab === "tcp"
                ? tcp.map((e) => (
                    <Row key={e.id} selected={e.id === selected} onSelect={() => setSelected(e.id === selected ? null : e.id)}>
                      <TcpRow entry={e} />
                    </Row>
                  ))
                : http.map((e) => (
                    <Row key={e.id} selected={e.id === selected} onSelect={() => setSelected(e.id === selected ? null : e.id)}>
                      <HttpRow entry={e} />
                    </Row>
                  ))}
              <li ref={end} aria-hidden />
            </ol>
          )}
          <section aria-label="Chi tiết" className="max-h-[55vh] overflow-y-auto rounded-lg border p-3 font-mono text-xs">
            {!current ? (
              <p className="font-sans text-muted-foreground">Bấm một dòng để xem chi tiết.</p>
            ) : tab === "tcp" ? (
              <TcpDetail entry={current as TcpEntry} />
            ) : (
              <HttpDetail entry={current as HttpEntry} />
            )}
          </section>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={tcp.length === 0 && http.length === 0}
            onClick={() => {
              clearLogs(account.id);
              setSelected(null);
            }}
          >
            Xoá log
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
