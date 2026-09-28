"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Ban, Flag, Send, Timer } from "lucide-react";
import {
  DISAPPEARING_MESSAGES_NOTE,
  MESSAGE_MAX_LENGTH,
  MESSAGE_TIMERS,
  MESSAGE_TIMER_LABELS,
  PHONE_NUMBER_HINT,
  REPORT_COPY_NOTE,
  REPORT_MAX_MESSAGES,
  REPORT_REASON_MAX_LENGTH,
  type MessageTimer,
} from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { Checkbox } from "@quagga/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quagga/ui/components/dialog";
import { Textarea } from "@quagga/ui/components/textarea";
import { toast } from "@quagga/ui/components/toast";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@quagga/ui/components/toggle-group";
import { cn } from "@quagga/ui/lib/utils";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface ThreadMessage {
  id: string;
  kind: "text" | "system";
  body: string;
  senderName: string;
  mine: boolean;
  /** ISO string — dates do not cross the server/client boundary as Dates. */
  createdAt: string;
  expiresAt: string | null;
}

const TIME = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Johannesburg",
});

/**
 * One direct conversation (epic #69): the messages, the composer, the
 * disappearing-messages timer, block and report. Every control calls a server
 * action that re-validates with Zod and re-checks the @quagga/core predicate;
 * this component decides nothing about who may read or post.
 *
 * NEEDS DESIGN REVIEW: built from existing components without a canvas frame.
 */
export function ConversationThread({
  conversationId,
  otherUserId,
  otherName,
  timer,
  messages,
  canSend,
  blockedByViewer,
  actions,
}: {
  conversationId: string;
  otherUserId: string;
  otherName: string;
  timer: MessageTimer;
  messages: ThreadMessage[];
  canSend: boolean;
  blockedByViewer: boolean;
  actions: {
    send: (input: {
      conversationId: string;
      body: string;
    }) => Promise<Result<{ phoneHint: boolean }>>;
    setTimer: (input: {
      conversationId: string;
      timer: MessageTimer;
    }) => Promise<Result>;
    block: (input: { targetUserId: string }) => Promise<Result>;
    unblock: (input: { targetUserId: string }) => Promise<Result>;
    report: (input: {
      conversationId: string;
      messageIds: string[];
      reason: string | null;
    }) => Promise<Result<{ reportId: string }>>;
  };
}) {
  const router = useRouter();
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [phoneHint, setPhoneHint] = React.useState(false);
  const [reporting, setReporting] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [reason, setReason] = React.useState("");
  const [blockOpen, setBlockOpen] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function run<T extends object>(
    work: () => Promise<Result<T>>,
  ): Promise<Result<T> | null> {
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      if (!result.ok) {
        setError(result.error);
        return null;
      }
      return result;
    } catch {
      setError("That didn't work. Please try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    const result = await run(() => actions.send({ conversationId, body }));
    if (result?.ok) {
      setDraft("");
      setPhoneHint(result.phoneHint);
      router.refresh();
    }
  }

  async function changeTimer(next: MessageTimer) {
    if (next === timer) return;
    const result = await run(() =>
      actions.setTimer({ conversationId, timer: next }),
    );
    if (result?.ok) router.refresh();
  }

  async function block() {
    const result = await run(() =>
      actions.block({ targetUserId: otherUserId }),
    );
    setBlockOpen(false);
    if (result?.ok) {
      toast.success(`${otherName} is blocked.`);
      router.refresh();
    }
  }

  async function unblock() {
    const result = await run(() =>
      actions.unblock({ targetUserId: otherUserId }),
    );
    if (result?.ok) {
      toast.success(`${otherName} is unblocked.`);
      router.refresh();
    }
  }

  async function submitReport() {
    const result = await run(() =>
      actions.report({
        conversationId,
        messageIds: [...selected],
        reason: reason.trim() || null,
      }),
    );
    if (result?.ok) {
      setReporting(false);
      setSelected(new Set());
      setReason("");
      toast.success(
        "Report sent to AfrikaBurn's safety team. You can also block this person.",
      );
    }
  }

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby="dm-timer-label"
        className="flex flex-col gap-2 rounded-lg border border-border px-4 py-3"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p
            id="dm-timer-label"
            className="flex items-center gap-2 text-sm font-medium"
          >
            <Timer className="h-4 w-4 text-primary" aria-hidden />
            Disappearing messages
          </p>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={timer}
            disabled={busy || !canSend}
            onValueChange={(v) => {
              const next = MESSAGE_TIMERS.find((t) => t === v);
              if (next) void changeTimer(next);
            }}
            aria-labelledby="dm-timer-label"
          >
            {MESSAGE_TIMERS.map((t) => (
              <ToggleGroupItem
                key={t}
                value={t}
                aria-label={`Disappearing messages: ${MESSAGE_TIMER_LABELS[t]}`}
                className="text-xs"
              >
                {MESSAGE_TIMER_LABELS[t]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <p className="text-xs text-muted-foreground">
          Applies to messages sent after it is changed. Either of you can change
          it. {DISAPPEARING_MESSAGES_NOTE}
        </p>
      </section>

      <ol
        aria-label={`Conversation with ${otherName}`}
        className="flex flex-col gap-2"
      >
        {messages.length === 0 && (
          <li className="py-8 text-center text-sm text-muted-foreground">
            No messages yet. Say hello.
          </li>
        )}
        {messages.map((m) =>
          m.kind === "system" ? (
            <li
              key={m.id}
              className="py-1 text-center text-xs italic text-muted-foreground"
            >
              {m.mine ? "You" : m.senderName} {m.body}
            </li>
          ) : (
            <li key={m.id}>
              <ReportRow
                reporting={reporting}
                mine={m.mine}
                picked={selected.has(m.id)}
                checkbox={
                  <Checkbox
                    className="mt-3"
                    checked={selected.has(m.id)}
                    onChange={(e) => toggle(m.id, e.target.checked)}
                    aria-label={`Select message from ${m.mine ? "you" : m.senderName}: ${m.body.slice(0, 40)}`}
                  />
                }
              >
                <span
                  className={cn(
                    "block max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                    m.mine
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                    reporting &&
                      selected.has(m.id) &&
                      "ring-2 ring-primary ring-offset-2 ring-offset-background",
                  )}
                >
                  <span className="sr-only">
                    {m.mine ? "You" : m.senderName}:
                  </span>
                  <span className="block whitespace-pre-wrap break-words">
                    {m.body}
                  </span>
                  <span
                    className={cn(
                      "mt-1 block text-[11px]",
                      m.mine
                        ? "text-primary-foreground/80"
                        : "text-muted-foreground",
                    )}
                  >
                    {TIME.format(new Date(m.createdAt))}
                    {m.expiresAt && (
                      <> · disappears {TIME.format(new Date(m.expiresAt))}</>
                    )}
                  </span>
                </span>
              </ReportRow>
            </li>
          ),
        )}
      </ol>
      <div ref={endRef} />

      {phoneHint && (
        <p
          role="status"
          className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
        >
          {PHONE_NUMBER_HINT}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {reporting ? (
        <section
          aria-labelledby="dm-report-title"
          className="flex flex-col gap-3 rounded-lg border border-destructive/40 p-4"
        >
          <h2 id="dm-report-title" className="text-sm font-semibold">
            Report messages
          </h2>
          <p className="text-xs text-muted-foreground">
            Tick the messages to report (up to {REPORT_MAX_MESSAGES}).{" "}
            {REPORT_COPY_NOTE}
          </p>
          <Textarea
            value={reason}
            maxLength={REPORT_REASON_MAX_LENGTH}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Anything the safety team should know (optional)"
            aria-label="Reason for the report (optional)"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={busy || selected.size === 0}
              onClick={() => void submitReport()}
            >
              Send report ({selected.size})
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setReporting(false);
                setSelected(new Set());
              }}
            >
              Cancel
            </Button>
          </div>
        </section>
      ) : canSend ? (
        <form onSubmit={send} className="flex flex-col gap-2">
          <Textarea
            value={draft}
            maxLength={MESSAGE_MAX_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={`Message ${otherName}`}
            aria-label={`Message ${otherName}`}
            disabled={busy}
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || draft.trim().length === 0}>
              <Send className="h-4 w-4" aria-hidden />
              Send
            </Button>
          </div>
        </form>
      ) : (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {blockedByViewer
            ? `You blocked ${otherName}. Neither of you can send messages here.`
            : "You can't reply in this conversation."}
        </p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {!reporting && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || messages.every((m) => m.kind !== "text")}
            onClick={() => setReporting(true)}
          >
            <Flag className="h-4 w-4" aria-hidden />
            Report messages
          </Button>
        )}
        {blockedByViewer ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void unblock()}
          >
            Unblock {otherName}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setBlockOpen(true)}
          >
            <Ban className="h-4 w-4" aria-hidden />
            Block {otherName}
          </Button>
        )}
      </div>

      <Dialog open={blockOpen} onOpenChange={setBlockOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Block {otherName}?</DialogTitle>
            <DialogDescription>
              Neither of you will be able to message the other, and this
              conversation disappears from your inbox. You can unblock them from
              their profile later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setBlockOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void block()}
            >
              Block
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * One message row. In report mode the WHOLE row is a <label> around the tick
 * box, so tapping anywhere on the message picks it — an 18px box alone is too
 * small a target on a phone (canvas cKyLt / Nk5tw). A picked row is tinted
 * and its bubble ringed.
 */
function ReportRow({
  reporting,
  mine,
  picked,
  checkbox,
  children,
}: {
  reporting: boolean;
  mine: boolean;
  picked: boolean;
  checkbox: React.ReactNode;
  children: React.ReactNode;
}) {
  const row = cn(
    "flex items-start gap-2",
    mine ? "flex-row-reverse" : "flex-row",
  );
  if (!reporting) return <div className={row}>{children}</div>;
  // A <label> takes phrasing content only, so the bubble is built of spans.
  return (
    <label
      className={cn(
        row,
        "-mx-2 cursor-pointer rounded-xl p-2 transition-colors hover:bg-muted/40",
        picked && "bg-primary/10 hover:bg-primary/15",
      )}
    >
      {checkbox}
      {children}
    </label>
  );
}
