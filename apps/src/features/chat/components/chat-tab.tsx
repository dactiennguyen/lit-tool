import { useReducer, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  CornerDownRightIcon,
  InboxIcon,
  Loader2Icon,
  MessageSquareIcon,
  PlugIcon,
  RefreshCwIcon,
  UsersRoundIcon,
} from "lucide-react";
import { PersonAvatar } from "@/components/account-avatar";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Account } from "@/lib/api";
import type { ChatMessage, Conversation, SavedConversation } from "@/lib/lit/lit-types";
import { usePeers, type Peer } from "@/stores/peer-directory";
import { useConversations, useLatestMessages, useSavedConversations, useSettings } from "@/lib/queries";
import { useLogin } from "@/stores/sessions";
import { markerKey, useReadMarkers } from "@/stores/read-markers";
import { cn } from "@/lib/utils";
import { isUnread, mergeConversations, previewText, savedPeer, shortId, shortTime, sortByLatest } from "@/features/chat/lib/chat-view";
import { ConnectionPanel } from "./connection-panel";
import { ThreadPane } from "./thread-pane";

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

/** Tin nhắn tab: conversation list and the open thread of a logged-in account. */
export function ChatTab({ account }: { account: Account }) {
  const { to } = useSearch({ from: "/account/$accountId/chat" });
  const navigate = useNavigate();
  const conversations = useConversations(account.id);
  const saved = useSavedConversations(account.id);
  const savedById = new Map((saved.data ?? []).map((s) => [s.conversationId, s]));
  const directory = usePeers();
  // A peer named nowhere fresher keeps the name saved with the conversation.
  const peers = { get: (id: string) => directory.get(id) ?? savedPeer(savedById.get(id)) };
  const { data: settings } = useSettings();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  // Chat needs the account's IM identity (saved from its profile at login).
  const me = account.im ? account.im.username : null;

  // Saved conversations count as listed: they were chatted in before.
  const listed = mergeConversations(conversations.data, saved.data).find((c) => c.conversationId === to);
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

  const select = (id: string) =>
    navigate({ to: "/account/$accountId/chat", params: { accountId: account.id }, search: { to: id } });

  return (
    <div className="flex min-h-0 flex-1">
      <section aria-label="Danh sách hội thoại" className="flex w-72 shrink-0 flex-col border-r">
        {!settings ? null : me ? (
          <ConnectionPanel account={account} />
        ) : (
          <div className="border-b p-3">
            <ChatSetupHint account={account} compact />
          </div>
        )}
        <ConversationList
          accountId={account.id}
          me={me}
          query={conversations}
          saved={saved.data}
          savedById={savedById}
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
        ) : !settings ? null : !me ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <ChatSetupHint account={account} />
          </div>
        ) : (
          <ThreadPane
            key={open.id}
            account={account}
            me={me}
            conversation={open}
            peer={peers.get(open.id)}
            onFirstContact={() => {
              contacted.add(`${account.id}:${open.id}`);
              rerender();
            }}
          />
        )}
      </section>
    </div>
  );
}

/** Chat is not usable yet: the account's IM identity comes from its profile at login. */
function ChatSetupHint({ account, compact }: { account: Account; compact?: boolean }) {
  const { login } = useLogin();
  const [loading, setLoading] = useState(false);
  const title = "Chưa có thông tin chat của account";
  const description = "IM username và mật khẩu chat được lấy từ hồ sơ khi đăng nhập. Đăng nhập lại để lấy.";
  const action = (
    <Button
      variant="outline"
      size={compact ? "sm" : "default"}
      className={cn(compact && "w-full")}
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        await login(account);
        setLoading(false);
      }}
    >
      {loading ? <Loader2Icon className="animate-spin" aria-hidden /> : <RefreshCwIcon aria-hidden />}
      Đăng nhập lại
    </Button>
  );

  if (compact) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{title}: xem được danh sách nhưng chưa đọc/gửi tin.</p>
        {action}
      </div>
    );
  }
  return <EmptyState icon={PlugIcon} title={title} description={description} action={action} />;
}

function ConversationList({
  accountId,
  me,
  query,
  saved,
  savedById,
  peers,
  selectedId,
  extraId,
  extraIsNew,
  onSelect,
}: {
  accountId: string;
  /** The account's IM username; null when chat is not configured (no previews then). */
  me: string | null;
  query: ReturnType<typeof useConversations>;
  /** Conversations saved in sky.db: shown while the server list loads or when it fails. */
  saved: readonly SavedConversation[] | undefined;
  savedById: ReadonlyMap<string, SavedConversation>;
  peers: { get(id: string): Peer | undefined };
  selectedId: string | undefined;
  /** Open conversation that is not (yet) in the server list. */
  extraId: string | null;
  extraIsNew: boolean;
  onSelect: (id: string) => void;
}) {
  const conversations = mergeConversations(query.data, saved);
  const latest = useLatestMessages(accountId, conversations, me !== null, savedById);
  const markers = useReadMarkers();
  const hasSaved = (saved?.length ?? 0) > 0;

  if (query.isPending && !hasSaved) {
    return (
      <div className="space-y-2 p-3" aria-busy="true" aria-label="Đang tải hội thoại">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (query.isError && !hasSaved) {
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

  const sorted = sortByLatest(conversations, latest);
  const items: (Conversation & { isNew?: boolean })[] = extraId
    ? [{ conversationId: extraId, conversationType: 0, isNew: extraIsNew }, ...sorted]
    : sorted;
  const unreadOf = (id: string) =>
    id !== selectedId && isUnread(latest.get(id)?.message, me, markers.get(markerKey(accountId, id)));
  const unread = conversations.filter((c) => unreadOf(c.conversationId)).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <p className="text-xs font-medium text-muted-foreground">
          {conversations.length} hội thoại
          {unread > 0 && <span className="font-medium text-sky-700 dark:text-sky-300"> · {unread} chưa đọc</span>}
          {query.isPending && <span> · đang tải…</span>}
        </p>
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
      {query.isError && (
        <p role="alert" className="mx-3 mb-1 flex items-start gap-1.5 text-xs break-words text-destructive">
          <AlertTriangleIcon className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>Không tải được danh sách mới, đang hiện danh sách đã lưu. {query.error.message}</span>
        </p>
      )}
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
                latest={latest.get(c.conversationId)}
                unread={unreadOf(c.conversationId)}
                me={me}
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
  latest,
  unread,
  me,
  onSelect,
}: {
  conversation: Conversation;
  peer: Peer | undefined;
  selected: boolean;
  isNew: boolean;
  /** Undefined when no preview is fetched for this conversation. */
  latest: { message: ChatMessage | null | undefined; error: Error | null } | undefined;
  unread: boolean;
  me: string | null;
  onSelect: (id: string) => void;
}) {
  const message = latest?.message;
  const subtitle = message
    ? previewText(message, me)
    : latest?.error
      ? "Không tải được tin cuối"
      : message === null
        ? "Chưa có tin nhắn"
        : peer
          ? shortId(c.conversationId)
          : c.conversationType === 1
            ? "Nhóm"
            : "Chưa rõ tên";
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
        "relative hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        // They wrote last and it was not opened here: tinted, with an accent bar.
        unread && !selected && "bg-sky-500/8 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-sky-500 dark:bg-sky-400/10 dark:before:bg-sky-400",
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
        <span className="flex items-baseline gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", unread ? "font-semibold" : "font-medium")} title={peer?.name}>
            {name}
          </span>
          {message?.timestamp != null && (
            <time
              dateTime={new Date(message.timestamp).toISOString()}
              className={cn("shrink-0 text-[11px] tabular-nums", unread ? "font-medium text-sky-700 dark:text-sky-300" : "text-muted-foreground")}
            >
              {shortTime(message.timestamp)}
            </time>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          {message && me && message.from !== me && (
            <CornerDownRightIcon
              className={cn("size-3 shrink-0", unread ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground")}
              aria-label="Họ nhắn"
            />
          )}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-xs",
              unread ? "font-medium text-foreground" : "text-muted-foreground",
              !message && "font-mono text-[11px]",
            )}
            title={message ? undefined : c.conversationId}
          >
            {subtitle}
          </span>
          {unread && (
            <span className="size-2 shrink-0 rounded-full bg-sky-500 dark:bg-sky-400" role="img" aria-label="Chưa đọc" />
          )}
        </span>
      </span>
      {isNew && <Badge variant="secondary">Mới</Badge>}
      {!supported && <Badge variant="outline">Không hỗ trợ</Badge>}
    </button>
  );
}
