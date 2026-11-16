import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AlertTriangleIcon, Loader2Icon, MessageSquareIcon, RefreshCwIcon, SendIcon, UserRoundIcon } from "lucide-react";
import { toast } from "sonner";
import { PersonAvatar } from "@/components/account-avatar";
import { EmptyState } from "@/components/empty-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { Account } from "@/lib/api";
import type { Peer } from "@/stores/peer-directory";
import { useHistory, useSendText, useUserInfo } from "@/lib/queries";
import { presenceOf } from "@/lib/lit/lit-format";
import { markRead } from "@/stores/read-markers";
import { isLive, useTcpStatus } from "@/stores/tcp-status";
import { cn } from "@/lib/utils";
import { UserInfoDialog, type UserRef } from "@/features/users/components/user-info-dialog";
import type { OpenConversation } from "./chat-tab";
import { canSend, MAX_TEXT_BYTES, shortId, toThread, utf8Bytes, type ThreadMessage } from "@/features/chat/lib/chat-view";

const timeFmt = new Intl.DateTimeFormat("vi-VN", { timeStyle: "short" });
const dateTimeFmt = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });

function formatTime(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString() ? timeFmt.format(d) : dateTimeFmt.format(d);
}

export function ThreadPane({
  account,
  me,
  conversation,
  peer,
  onFirstContact,
}: {
  account: Account;
  /** The account's IM username. */
  me: string;
  conversation: OpenConversation;
  peer: Peer | undefined;
  /** Called once a first-contact message was accepted by the server. */
  onFirstContact: () => void;
}) {
  const history = useHistory(
    account.id,
    conversation.isNew ? null : { id: conversation.id, type: conversation.type },
    { poll: true },
  );
  const [viewing, setViewing] = useState<UserRef | null>(null);
  const name = peer?.name ?? shortId(conversation.id);
  const isGroup = conversation.type === 1;
  // Online status from the person's profile, re-read every 2 minutes while the chat is open.
  // Needs their Litmatch user id, known once they were seen in a list or a profile.
  const profile = useUserInfo(account.id, isGroup ? undefined : (peer?.userId ?? undefined), { refetchInterval: 120_000 });
  const presence = profile.data ? presenceOf(profile.data) : null;

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <PersonAvatar name={name} src={peer?.avatarUrl ?? null} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-sm font-medium">
            <span className="truncate">{name}</span>
            {conversation.isNew && <Badge variant="secondary">Hội thoại mới</Badge>}
            {isGroup && <Badge variant="outline">Nhóm</Badge>}
          </p>
          {presence ? (
            <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground" title={`IM ID ${conversation.id}`}>
              <span
                className={cn("size-2 shrink-0 rounded-full", presence.online ? "bg-success" : "bg-muted-foreground/40")}
                aria-hidden
              />
              <span className={cn("truncate", presence.online && "text-success")}>{presence.text}</span>
            </p>
          ) : (
            <p className="truncate font-mono text-[11px] text-muted-foreground">{conversation.id}</p>
          )}
        </div>
        {peer?.userId && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setViewing({ id: peer.userId!, name: peer.name })}
            aria-label={`Xem hồ sơ ${peer.name}`}
          >
            <UserRoundIcon aria-hidden />
          </Button>
        )}
        {!conversation.isNew && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => history.refetch()}
            disabled={history.isFetching}
            aria-label="Tải lại tin nhắn"
          >
            <RefreshCwIcon className={cn(history.isFetching && !history.isFetchingNextPage && "animate-spin")} aria-hidden />
          </Button>
        )}
      </header>

      {conversation.isNew ? (
        <EmptyState
          icon={MessageSquareIcon}
          title={`Bắt đầu trò chuyện với ${name}`}
          description="Người này chưa có trong danh sách hội thoại của account. Tin đầu tiên sẽ được tính là một lượt bắt chuyện."
        />
      ) : (
        <MessageList
          history={history}
          me={me}
          accountId={account.id}
          conversationId={conversation.id}
          peer={isGroup ? null : { name, avatarUrl: peer?.avatarUrl ?? null }}
        />
      )}

      {isGroup ? (
        <p className="border-t p-3 text-center text-xs text-muted-foreground">Chưa hỗ trợ gửi tin vào nhóm.</p>
      ) : (
        <Composer account={account} conversation={conversation} peerName={name} onFirstContact={onFirstContact} />
      )}

      <UserInfoDialog accountId={account.id} user={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

function MessageList({
  history,
  me,
  accountId,
  conversationId,
  peer,
}: {
  history: ReturnType<typeof useHistory>;
  me: string;
  accountId: string;
  conversationId: string;
  /** The other side of a one-to-one chat, for the avatar beside their messages. */
  peer: { name: string; avatarUrl: string | null } | null;
}) {
  const thread = useMemo(() => toThread(history.data?.pages ?? [], me), [history.data, me]);
  const newestId = thread[thread.length - 1]?.id;

  // What is on screen counts as read.
  useEffect(() => {
    if (newestId) markRead(accountId, conversationId, newestId);
  }, [accountId, conversationId, newestId]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prev = useRef({ newestId: "", oldestId: "", height: 0 });

  // Stick to the bottom for new messages; keep the reading position when older ones load above.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !newestId) return;
    const oldestId = thread[0]!.id;
    const p = prev.current;
    if (p.oldestId && oldestId !== p.oldestId && newestId === p.newestId) {
      el.scrollTop += el.scrollHeight - p.height;
    } else if (newestId !== p.newestId) {
      el.scrollTop = el.scrollHeight;
    }
    prev.current = { newestId, oldestId, height: el.scrollHeight };
  }, [thread, newestId]);

  if (history.isPending) {
    return (
      <div className="flex-1 space-y-3 p-5" aria-busy="true" aria-label="Đang tải tin nhắn">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="ml-auto h-10 w-1/2" />
        <Skeleton className="h-10 w-3/5" />
      </div>
    );
  }
  if (history.isError && thread.length === 0) {
    return (
      <EmptyState
        icon={AlertTriangleIcon}
        title="Không tải được tin nhắn"
        description={history.error.message}
        action={
          <Button variant="outline" onClick={() => history.refetch()}>
            Thử lại
          </Button>
        }
      />
    );
  }

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <div className="mb-3 flex justify-center">
        {history.hasNextPage ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => history.fetchNextPage()}
            disabled={history.isFetchingNextPage}
          >
            {history.isFetchingNextPage && <Loader2Icon className="animate-spin" aria-hidden />}
            Tải tin cũ hơn
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">{thread.length ? "Đầu hội thoại" : "Chưa có tin nhắn"}</p>
        )}
      </div>
      {history.isError && <p className="mb-2 text-center text-xs text-destructive">{history.error.message}</p>}
      <ol className="space-y-1.5" aria-label="Tin nhắn" aria-live="polite">
        {thread.map((m, i) => (
          // Their avatar once per run of their messages, beside the last one.
          <Bubble key={m.id} message={m} peer={peer} showAvatar={!m.mine && thread[i + 1]?.mine !== false} />
        ))}
      </ol>
    </div>
  );
}

function Bubble({
  message: m,
  peer,
  showAvatar,
}: {
  message: ThreadMessage;
  peer: { name: string; avatarUrl: string | null } | null;
  showAvatar: boolean;
}) {
  return (
    <li className={cn("flex items-end gap-2", m.mine ? "justify-end" : "justify-start")}>
      {!m.mine && peer && (
        <span className="w-7 shrink-0">
          {showAvatar && <PersonAvatar name={peer.name} src={peer.avatarUrl} size="sm" className="size-7" />}
        </span>
      )}
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-3 py-1.5 text-sm shadow-xs",
          m.mine
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md border border-sky-500/20 bg-sky-500/10 text-foreground dark:border-sky-400/20 dark:bg-sky-400/12",
        )}
      >
        <p className="break-words whitespace-pre-wrap">{m.text}</p>
        <p className={cn("mt-0.5 text-right text-[10px] tabular-nums", m.mine ? "text-primary-foreground/70" : "text-muted-foreground")}>
          <span className="sr-only">{m.mine ? "Bạn gửi lúc " : "Nhận lúc "}</span>
          {formatTime(m.timestamp)}
        </p>
      </div>
    </li>
  );
}

function Composer({
  account,
  conversation,
  peerName,
  onFirstContact,
}: {
  account: Account;
  conversation: OpenConversation;
  peerName: string;
  onFirstContact: () => void;
}) {
  const [text, setText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const send = useSendText(account.id);
  const live = isLive(useTcpStatus(account.id));
  const bytes = utf8Bytes(text);
  const ready = canSend(text) && !send.isPending;

  async function doSend() {
    setConfirming(false);
    try {
      const outcome = await send.mutateAsync({ to: conversation.id, text, firstContact: conversation.isNew });
      setText("");
      if (conversation.isNew) onFirstContact();
      if (outcome.metadataError) {
        toast.warning("Đã gửi tin, nhưng chưa ghi được thông tin hội thoại", {
          description: `${outcome.metadataError}. Đừng gửi lại tin này.`,
        });
      }
    } catch (err) {
      // Text is kept: the user decides whether to resend after checking the history.
      toast.error(err instanceof Error ? err.message : "Không gửi được tin");
    }
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!ready) return;
    if (conversation.isNew) setConfirming(true);
    else void doSend();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
  }

  return (
    <form className="space-y-1 border-t p-3" onSubmit={submit}>
      <div className="flex items-end gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Nhập tin nhắn… (Enter để gửi, Shift+Enter xuống dòng)"
          aria-label="Nội dung tin nhắn"
          aria-invalid={bytes > MAX_TEXT_BYTES}
          rows={1}
          className="max-h-32 min-h-9 flex-1 resize-none"
          disabled={send.isPending}
        />
        <Button type="submit" size="icon-lg" aria-label="Gửi" disabled={!ready}>
          {send.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <SendIcon aria-hidden />}
        </Button>
      </div>
      <p className="flex justify-between gap-3 text-[11px] text-muted-foreground">
        <span>
          {live
            ? "Gửi qua kết nối chat đang mở."
            : "Chưa kết nối chat: mỗi lần gửi đăng nhập TCP mới rồi ngắt; app trên điện thoại có thể bị đăng xuất."}
        </span>
        {bytes > MAX_TEXT_BYTES * 0.8 && (
          <span className={cn("shrink-0 tabular-nums", bytes > MAX_TEXT_BYTES && "text-destructive")}>
            {bytes}/{MAX_TEXT_BYTES} byte
          </span>
        )}
      </p>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bắt chuyện với {peerName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Gửi từ account <strong>{account.label}</strong>. Đây là hội thoại mới nên app sẽ ghi thêm thông tin hội
              thoại lên Litmatch và tính một lượt bắt chuyện, như app điện thoại.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doSend()}>Gửi tin</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
