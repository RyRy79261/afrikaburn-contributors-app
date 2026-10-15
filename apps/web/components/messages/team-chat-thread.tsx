"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Flag, Send, Timer } from "lucide-react";
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
import { Textarea } from "@quagga/ui/components/textarea";
import { toast } from "@quagga/ui/components/toast";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@quagga/ui/components/toggle-group";
import { cn } from "@quagga/ui/lib/utils";
import { AvatarImage } from "@/components/avatar-image";
import { ReportRow, type ThreadMessage } from "./conversation-thread";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** A team-chat message: a direct-chat message plus who sent it. */
export interface TeamThreadMessage extends ThreadMessage {
  senderId: string;
}

const TIME = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Johannesburg",
});

const DAY = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  timeZone: "Africa/Johannesburg",
});

/**
 * One team's chat (frame T3 qsuL0 / fyZFW): the "you joined" divider, the
 * messages with their senders' names, the composer, the timer chip (Change
 * for team leads and camp leads on the team) and report mode. The server
 * already cut the history at the viewer's join and hid anyone a block stands
 * between; every control calls a server action that re-checks the team seat.
 * This component decides nothing about who may read or post.
 */
export function TeamChatThread({
  slug,
  teamId,
  conversationId,
  teamName,
  timer,
  joinedAt,
  messages,
  canSend,
  canSetTimer,
  archived,
  actions,
}: {
  slug: string;
  teamId: string;
  conversationId: string;
  teamName: string;
  timer: MessageTimer;
  /** ISO string: the viewer's history cut. */
  joinedAt: string;
  messages: TeamThreadMessage[];
  canSend: boolean;
  canSetTimer: boolean;
  archived: boolean;
  actions: {
    send: (input: {
      conversationId: string;
      slug: string;
      teamId: string;
      body: string;
    }) => Promise<Result<{ phoneHint: boolean }>>;
    setTimer: (input: {
      conversationId: string;
      slug: string;
      teamId: string;
      timer: MessageTimer;
    }) => Promise<Result>;
    report: (input: {
      conversationId: string;
      slug: string;
      teamId: string;
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
  const [changingTimer, setChangingTimer] = React.useState(false);
  const [reporting, setReporting] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [reason, setReason] = React.useState("");
  const endRef = React.useRef<HTMLDivElement>(null);
  const target = { conversationId, slug, teamId };

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
    const result = await run(() => actions.send({ ...target, body }));
    if (result?.ok) {
      setDraft("");
      setPhoneHint(result.phoneHint);
      router.refresh();
    }
  }

  async function changeTimer(next: MessageTimer) {
    if (next === timer) return;
    const result = await run(() =>
      actions.setTimer({ ...target, timer: next }),
    );
    if (result?.ok) {
      setChangingTimer(false);
      router.refresh();
    }
  }

  async function submitReport() {
    const result = await run(() =>
      actions.report({
        ...target,
        messageIds: [...selected],
        reason: reason.trim() || null,
      }),
    );
    if (result?.ok) {
      setReporting(false);
      setSelected(new Set());
      setReason("");
      toast.success("Report sent to AfrikaBurn's safety team.");
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
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm font-medium">
          <Timer className="h-4 w-4 text-primary" aria-hidden />
          Disappearing messages · {MESSAGE_TIMER_LABELS[timer]}
        </span>
        {canSetTimer && !changingTimer && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-1"
            onClick={() => setChangingTimer(true)}
          >
            Change
          </Button>
        )}
      </div>

      {canSetTimer && changingTimer && (
        <section
          aria-labelledby="team-timer-label"
          className="flex flex-col gap-2 rounded-lg border border-border px-4 py-3"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p
              id="team-timer-label"
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
              disabled={busy}
              onValueChange={(v) => {
                const next = MESSAGE_TIMERS.find((t) => t === v);
                if (next) void changeTimer(next);
              }}
              aria-labelledby="team-timer-label"
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
            Team leads and camp leads change it; it applies to messages sent
            after the change. {DISAPPEARING_MESSAGES_NOTE}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={() => setChangingTimer(false)}
          >
            Done
          </Button>
        </section>
      )}

      <div
        className="flex items-center gap-3 text-xs text-muted-foreground"
        role="separator"
      >
        <span className="h-px flex-1 bg-border" aria-hidden />
        You joined on {DAY.format(new Date(joinedAt))} · you see messages from
        here on
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>

      <ol aria-label={`${teamName} team chat`} className="flex flex-col gap-2">
        {messages.length === 0 && (
          <li className="py-8 text-center text-sm text-muted-foreground">
            No messages yet.
            {canSend ? " Say hello to the team." : ""}
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
                {!m.mine && (
                  <AvatarImage
                    userId={m.senderId}
                    name={m.senderName}
                    showPhoto={false}
                    className="mt-1 h-7 w-7 text-[10px]"
                  />
                )}
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
                  {m.mine ? (
                    <span className="sr-only">You:</span>
                  ) : (
                    <span className="block text-xs font-medium text-primary">
                      {m.senderName}
                    </span>
                  )}
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
          aria-labelledby="team-report-title"
          className="flex flex-col gap-3 rounded-lg border border-destructive/40 p-4"
        >
          <h2 id="team-report-title" className="text-sm font-semibold">
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
          <div className="flex flex-col gap-2 sm:flex-row">
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
            placeholder={`Message ${teamName}`}
            aria-label={`Message ${teamName}`}
            disabled={busy}
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              className="w-full sm:w-auto"
              disabled={busy || draft.trim().length === 0}
            >
              <Send className="h-4 w-4" aria-hidden />
              Send
            </Button>
          </div>
        </form>
      ) : (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {archived
            ? "This team is archived. Its chat is read-only."
            : "You can't post in this chat."}
        </p>
      )}

      {!reporting && (
        <div className="border-t border-border pt-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            disabled={busy || messages.every((m) => m.kind !== "text")}
            onClick={() => setReporting(true)}
          >
            <Flag className="h-4 w-4" aria-hidden />
            Report messages
          </Button>
        </div>
      )}
    </div>
  );
}
