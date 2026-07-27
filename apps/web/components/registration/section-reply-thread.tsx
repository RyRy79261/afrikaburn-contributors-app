"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MessageSquareReply } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { Textarea } from "@quagga/ui/components/textarea";
import { toast } from "@quagga/ui/components/toast";
import type { CampReviewReply } from "@/lib/registration-store";
import { replyToSectionReviewAction } from "@/app/(app)/camps/[slug]/registration/actions";

// Camp-side reply thread under a section review (design frame P0Tcl `aYBCE`
// "Reply Box"). The AB review comment is rendered by the parent; this component
// carries the two-way conversation beneath it — existing replies plus a box for
// the camp (or AB staff) to answer. Server-side authz lives in
// `replyToSectionReviewAction` → @quagga/core `canReplyToSectionReview`; this UI
// never decides who may reply, it only collects the text.

const MAX_REPLY = 2000;

/** Relative "N days ago" label, matching the summary's thread timestamps. */
function formatRelative(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

export function SectionReplyThread({
  slug,
  reviewId,
  replies,
  viewerUserId,
}: {
  slug: string;
  reviewId: string;
  replies: CampReviewReply[];
  viewerUserId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  function submit() {
    const body = draft.trim();
    if (body.length === 0) return;
    startTransition(async () => {
      const result = await replyToSectionReviewAction(slug, { reviewId, body });
      if (result.ok) {
        toast.success("Reply sent.");
        setDraft("");
        setOpen(false);
        router.refresh();
      } else {
        toast.error("Could not send reply", { description: result.error });
      }
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      {replies.length > 0 && (
        <ul className="flex flex-col gap-3 border-l-2 border-border pl-3">
          {replies.map((reply) => {
            const isSelf =
              viewerUserId !== null && reply.authorUserId === viewerUserId;
            const initials = reply.isOrg
              ? "AB"
              : (reply.authorName.trim()[0] ?? "?").toUpperCase();
            return (
              <li key={reply.id} className="flex gap-3">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
                  aria-hidden
                >
                  {initials}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium text-foreground">
                      {isSelf ? "You" : reply.authorName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatRelative(reply.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                    {reply.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {open ? (
        <div className="flex flex-col gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_REPLY))}
            rows={3}
            placeholder="Let the placement team know what you changed…"
            aria-label="Your reply"
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setDraft("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={pending || draft.trim().length === 0}
              onClick={submit}
            >
              {pending ? "Sending…" : "Send reply"}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() => setOpen(true)}
        >
          <MessageSquareReply aria-hidden />
          Reply
        </Button>
      )}
    </div>
  );
}
