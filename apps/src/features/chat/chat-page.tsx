import { useReducer, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { AlertTriangleIcon, InboxIcon, MessageSquareIcon, PlugIcon, RefreshCwIcon, UsersRoundIcon } from "lucide-react";
import { PersonAvatar } from "@/components/account-avatar";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RequireAccount } from "@/components/require-account";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Account } from "@/lib/api";
import type { Conversation } from "@/lib/lit-types";
import { usePeers, type Peer } from "@/lib/peer-directory";
import { useConversations } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { shortId } from "./chat-view";
import { ConnectionPanel } from "./connection-panel";
import { HxSettingsDialog } from "./hx-settings-dialog";
import { ThreadPane } from "./thread-pane";

export function ChatPage() {
  return (
    <>
      <PageHeader title="Tin nhắn" description="Hội thoại của account đang dùng" />
      {/* key: selection, connection results and form state belong to one account */}
      <RequireAccount>{(account) => <ChatBody key={account.id} account={account} />}</RequireAccount>
    </>
  );
}

/**
 * `accountId:imId` pairs already contacted in this session. If the metadata
 * writes after a first message failed, the peer is still missing from the
 * list; this keeps the next message from counting as a first contact again.
 */
const contacted = new Set<string>();

/** What the right pane shows: a listed conversation, or a new one opened from a profile. */
export interface OpenConversation {
  id: string;
  type: number;
  /** Not in the account's conversation list: sending is a first contact. */
  isNew: boolean;
}

function ChatBody({ account }: { account: Account }) {
  const { to } = useSearch({ from: "/chat" });
  const navigate = useNavigate();
  const conversations = useConversations(account.id);
  const peers = usePeers();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsKey, setSettingsKey] = useState(0);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const openSettings = () => {
    setSettingsKey((k) => k + 1); // fresh form each time
    setSettingsOpen(true);
  };

  const listed = conversations.data?.find((c) => c.conversationId === to);
  // A conversation that is not listed is only "new" once the list has loaded:
  // otherwise a failed list would turn every send into a first contact.
  const open: OpenConversation | null = !to
    ? null
    : listed
      ? { id: listed.conversationId, type: listed.conversationType, isNew: false }
      : contacted.has(`${account.id}:${to}`)
        ? { id: to, type: 0, isNew: false }
        : conversations.isSuccess
        ? { id: to, type: 0, isNew: true }
        : null;

  const select = (id: string) => navigate({ to: "/chat", search: { to: id } });

  return (
    <div className="flex min-h-0 flex-1">
      <section aria-label="Danh sách hội thoại" className="flex w-72 shrink-0 flex-col border-r">
        {account.hx ? (
          <ConnectionPanel account={account} hx={account.hx} onConfigure={openSettings} />
        ) : (
          <div className="space-y-2 border-b p-3">
            <p className="text-xs text-muted-foreground">Chưa cấu hình chat: xem được danh sách nhưng chưa đọc/gửi tin.</p>
            <Button variant="outline" className="w-full" onClick={openSettings}>
              <PlugIcon aria-hidden />
              Cấu hình chat
            </Button>
          </div>
        )}
        <ConversationList
          query={conversations}
          peers={peers}
          selectedId={to}
          extraId={open && !listed ? open.id : null}
          extraIsNew={!!open?.isNew}
          onSelect={select}
        />
      </section>

      <section aria-label="Nội dung hội thoại" className="flex min-w-0 flex-1 flex-col">
        {!to ? (
          <EmptyState icon={MessageSquareIcon} title="Chọn một hội thoại để xem tin nhắn" />
        ) : !open ? (
          conversations.isError ? (
            <EmptyState
              icon={AlertTriangleIcon}
              title="Chưa mở được hội thoại"
              description="Cần tải được danh sách hội thoại trước để biết đây là hội thoại cũ hay mới."
            />
          ) : (
            <div className="p-5" aria-busy="true" aria-label="Đang tải">
              <Skeleton className="h-16 w-full" />
            </div>
          )
        ) : !account.hx ? (
          <EmptyState
            icon={PlugIcon}
            title="Chưa cấu hình chat"
            description={`Nhập IM host, login template và hxPwd (hoặc token) của ${account.label} để đọc và gửi tin.`}
            action={<Button onClick={openSettings}>Cấu hình chat</Button>}
          />
        ) : (
          <ThreadPane
            key={open.id}
            account={account}
            hx={account.hx}
            conversation={open}
            peer={peers.get(open.id)}
            onFirstContact={() => {
              contacted.add(`${account.id}:${open.id}`);
              rerender();
            }}
          />
        )}
      </section>

      <HxSettingsDialog key={settingsKey} account={account} open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

function ConversationList({
  query,
  peers,
  selectedId,
  extraId,
  extraIsNew,
  onSelect,
}: {
  query: ReturnType<typeof useConversations>;
  peers: ReadonlyMap<string, Peer>;
  selectedId: string | undefined;
  /** Open conversation that is not (yet) in the server list. */
  extraId: string | null;
  extraIsNew: boolean;
  onSelect: (id: string) => void;
}) {
  if (query.isPending) {
    return (
      <div className="space-y-2 p-3" aria-busy="true" aria-label="Đang tải hội thoại">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        icon={AlertTriangleIcon}
        title="Không tải được hội thoại"
        description={query.error.message}
        action={
          <Button variant="outline" onClick={() => query.refetch()}>
            Thử lại
          </Button>
        }
      />
    );
  }

  const items: (Conversation & { isNew?: boolean })[] = extraId
    ? [{ conversationId: extraId, conversationType: 0, isNew: extraIsNew }, ...query.data]
    : query.data;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <p className="text-xs font-medium text-muted-foreground">{query.data.length} hội thoại</p>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          aria-label="Tải lại danh sách hội thoại"
        >
          <RefreshCwIcon className={cn(query.isFetching && "animate-spin")} aria-hidden />
        </Button>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={InboxIcon} title="Chưa có hội thoại" description="Mở hồ sơ một người để bắt đầu nhắn tin." />
      ) : (
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {items.map((c) => (
            <li key={c.conversationId}>
              <ConversationItem
                conversation={c}
                peer={peers.get(c.conversationId)}
                selected={c.conversationId === selectedId}
                isNew={!!c.isNew}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConversationItem({
  conversation: c,
  peer,
  selected,
  isNew,
  onSelect,
}: {
  conversation: Conversation;
  peer: Peer | undefined;
  selected: boolean;
  isNew: boolean;
  onSelect: (id: string) => void;
}) {
  const supported = c.conversationType === 0 || c.conversationType === 1;
  const name = peer?.name ?? shortId(c.conversationId);
  return (
    <button
      type="button"
      onClick={() => onSelect(c.conversationId)}
      disabled={!supported}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none transition-colors duration-150",
        "hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        selected && "bg-muted",
      )}
    >
      {c.conversationType === 1 ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <UsersRoundIcon className="size-4" aria-hidden />
        </span>
      ) : (
        <PersonAvatar name={name} src={peer?.avatarUrl ?? null} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium" title={peer?.name}>
          {name}
        </span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground" title={c.conversationId}>
          {peer ? shortId(c.conversationId) : c.conversationType === 1 ? "Nhóm" : "Chưa rõ tên"}
        </span>
      </span>
      {isNew && <Badge variant="secondary">Mới</Badge>}
      {!supported && <Badge variant="outline">Không hỗ trợ</Badge>}
    </button>
  );
}
