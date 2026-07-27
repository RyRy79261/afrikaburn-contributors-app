"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, RotateCcw, MessageSquarePlus } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { Textarea } from "@quagga/ui/components/textarea";
import { Badge } from "@quagga/ui/components/badge";
import { toast } from "@quagga/ui/components/toast";
import type { SectionKey } from "@quagga/types";
import {
  addSectionReview,
  setSectionReviewStatus,
} from "@/lib/actions/registrations";
import { formatDate } from "@/lib/labels";

export interface ThreadReply {
  id: string;
  authorName: string;
  isOrg: boolean;
  body: string;
  createdAt: Date;
}

export interface ThreadComment {
  id: string;
  status: "open" | "resolved";
  comment: string;
  reviewerEmail: string | null;
  createdAt: Date;
  /** The camp/AB reply conversation under this review (read-only here). */
  replies: ThreadReply[];
}

/** Per-section comment thread: existing comments + open/resolve + add form. */
export function SectionReviewThread({
  registrationId,
  sectionKey,
  comments,
}: {
  registrationId: string;
  sectionKey: SectionKey;
  comments: ThreadComment[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);

  function submit() {
    startTransition(async () => {
      const result = await addSectionReview({
        registrationId,
        sectionKey,
        comment: draft,
      });
      if (result.ok) {
        toast.success("Comment added.");
        setDraft("");
        setOpen(false);
        router.refresh();
      } else {
        toast.error("Could not add comment", { description: result.error });
      }
    });
  }

  function toggle(id: string, next: "open" | "resolved") {
    startTransition(async () => {
      const result = await setSectionReviewStatus({
        reviewId: id,
        registrationId,
        status: next,
      });
      if (result.ok) {
        toast.success(next === "resolved" ? "Resolved." : "Re-opened.");
        router.refresh();
      } else {
        toast.error("Could not update comment", {
          description: result.error,
        });
      }
    });
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {comments.filter((c) => c.status === "open").length > 0 && (
            <Badge variant="warning">Open</Badge>
          )}
          Section review
        </p>
        {!open && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            <MessageSquarePlus aria-hidden />
            Add comment
          </Button>
        )}
      </div>

      {comments.length > 0 && (
        <ul className="mb-3 flex flex-col gap-2">
          {comments.map((c) => (
            <li
              key={c.id}
              className="rounded-lg border border-border bg-secondary/40 p-3 text-sm"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {c.reviewerEmail ?? "Reviewer"} · {formatDate(c.createdAt)}
                </span>
                <div className="flex items-center gap-2">
                  <Badge variant={c.status === "open" ? "warning" : "success"}>
                    {c.status === "open" ? "Open" : "Resolved"}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      toggle(c.id, c.status === "open" ? "resolved" : "open")
                    }
                  >
                    {c.status === "open" ? (
                      <>
                        <Check aria-hidden />
                        Resolve
                      </>
                    ) : (
                      <>
                        <RotateCcw aria-hidden />
                        Re-open
                      </>
                    )}
                  </Button>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-foreground">{c.comment}</p>

              {c.replies.length > 0 && (
                <ul className="mt-3 flex flex-col gap-2 border-l-2 border-border pl-3">
                  {c.replies.map((reply) => (
                    <li key={reply.id}>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-xs font-medium text-foreground">
                          {reply.authorName}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(reply.createdAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap text-foreground">
                        {reply.body}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="flex flex-col gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Leave section-specific feedback for the camp…"
          />
          <div className="flex justify-end gap-2">
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
              {pending ? "Saving…" : "Post comment"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
