"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Info, Plus, Send } from "lucide-react";
import { WAP_REASON_MAX, WAP_REQUEST_MAX } from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import { Textarea } from "@quagga/ui/components/textarea";
import { toast } from "@quagga/ui/components/toast";
import { requestPassesAction } from "@/app/(app)/_project-passes/actions";

// The "Passes from AfrikaBurn" card (canvas W1): the window chip, the ask
// button, and the ask form behind it. The stats and the request history are
// server-rendered and passed in as children. The server decides whether an
// ask is allowed (`requestBlocked`, from the same @quagga/core rule the action
// enforces); this only hides the form when it would be refused.

export function RequestBlock({
  slug,
  noun,
  windowState,
  totalGranted,
  isFirst,
  requestBlocked,
  children,
}: {
  slug: string;
  noun: string;
  windowState: "not_opened" | "open" | "closed";
  totalGranted: number;
  /** No request has been made yet: the form asks "How many passes?". */
  isFirst: boolean;
  /** Why an ask would be refused, or null when it would not. */
  requestBlocked: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const canAsk = requestBlocked === null;
  // The very first ask starts open — there is nothing else to show.
  const [open, setOpen] = React.useState(isFirst && canAsk);
  const [count, setCount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const requested = Number(count);
    if (!Number.isInteger(requested) || requested < 1) {
      setError("Ask for at least one pass, as a whole number.");
      return;
    }
    startTransition(async () => {
      const result = await requestPassesAction({
        slug,
        requested,
        reason: reason.trim() || null,
      });
      if (!result.ok) {
        setError(result.error);
        router.refresh();
        return;
      }
      toast.success("Request sent to AfrikaBurn.");
      setOpen(false);
      setCount("");
      setReason("");
      router.refresh();
    });
  }

  const askLabel = isFirst ? "Ask for passes" : "Ask for more";
  const askButton = (className: string) =>
    windowState === "open" && !open ? (
      <Button
        type="button"
        variant="outline"
        className={className}
        disabled={!canAsk}
        onClick={() => setOpen(true)}
      >
        <Plus className="h-4 w-4" aria-hidden />
        {askLabel}
      </Button>
    ) : null;

  return (
    <section
      aria-labelledby="wap-from-ab"
      className="flex flex-col gap-5 rounded-xl border border-border bg-card p-4 text-card-foreground sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-2xl flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="wap-from-ab" className="text-lg font-semibold">
              Passes from AfrikaBurn
            </h2>
            {windowState === "open" && (
              <Badge variant="success">Requests open</Badge>
            )}
            {windowState === "closed" && (
              <Badge variant="secondary">Requests closed</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {windowState === "closed"
              ? `AfrikaBurn has closed requests. You can still hand out the passes the ${noun} was granted.`
              : `Ask for the number of passes the ${noun} needs. While requests are open you can ask for more.`}
          </p>
        </div>
        {askButton("hidden sm:inline-flex")}
      </div>

      {open && (
        <form
          onSubmit={send}
          className="flex flex-col gap-4 rounded-lg border border-border bg-background/40 p-4"
          aria-label={askLabel}
        >
          <Field
            label={isFirst ? "How many passes?" : "How many more passes?"}
            htmlFor="wap-count"
            help={
              isFirst
                ? "AfrikaBurn may grant fewer than you ask for, never more."
                : `On top of the ${totalGranted} already granted.`
            }
          >
            <Input
              id="wap-count"
              type="number"
              inputMode="numeric"
              min={1}
              max={WAP_REQUEST_MAX}
              step={1}
              required
              value={count}
              onChange={(e) => setCount(e.target.value)}
              aria-describedby="wap-count-help"
            />
          </Field>
          <Field
            label={`Why does the ${noun} need them? (optional)`}
            htmlFor="wap-reason"
          >
            <Textarea
              id="wap-reason"
              rows={3}
              maxLength={WAP_REASON_MAX}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending}>
              <Send className="h-4 w-4" aria-hidden />
              {pending ? "Sending…" : "Send request"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {children}

      {/* Why "Ask for more" is disabled — the pending ask, an unsubmitted
          registration — in the words of the rule the action enforces. */}
      {windowState === "open" && requestBlocked && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {requestBlocked}
        </p>
      )}

      {askButton("w-full sm:hidden")}
    </section>
  );
}
