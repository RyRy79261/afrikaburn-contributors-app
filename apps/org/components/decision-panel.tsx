"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, MessageSquareWarning, Play, X } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { Textarea } from "@quagga/ui/components/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quagga/ui/components/dialog";
import { toast } from "@quagga/ui/components/toast";
import type { RegistrationStatus } from "@quagga/types";
import {
  availableReviewActions,
  REVIEW_ACTION_LABELS,
  type ReviewAction,
} from "@/lib/org-logic";
import { decideRegistration } from "@/lib/actions/registrations";

const ICON: Record<ReviewAction, React.ReactNode> = {
  start_review: <Play aria-hidden />,
  approve: <Check aria-hidden />,
  request_changes: <MessageSquareWarning aria-hidden />,
  reject: <X aria-hidden />,
};

const NEEDS_REASON: ReviewAction[] = ["request_changes", "reject"];

export function DecisionPanel({
  registrationId,
  status,
}: {
  registrationId: string;
  status: RegistrationStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reasonFor, setReasonFor] = useState<ReviewAction | null>(null);
  const [reason, setReason] = useState("");

  const actions = availableReviewActions(status);

  function run(action: ReviewAction, reasonText?: string) {
    startTransition(async () => {
      const result = await decideRegistration({
        registrationId,
        action,
        reason: reasonText,
      });
      if (result.ok) {
        toast.success(`${REVIEW_ACTION_LABELS[action]} applied.`);
        setReasonFor(null);
        setReason("");
        router.refresh();
      } else {
        toast.error("Could not apply decision", { description: result.error });
      }
    });
  }

  function onClick(action: ReviewAction) {
    if (NEEDS_REASON.includes(action)) {
      setReason("");
      setReasonFor(action);
    } else {
      run(action);
    }
  }

  if (actions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No reviewer actions are available for a registration in this state.
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action}
            variant={
              action === "approve"
                ? "default"
                : action === "reject"
                  ? "destructive"
                  : "outline"
            }
            disabled={pending}
            onClick={() => onClick(action)}
          >
            {ICON[action]}
            {REVIEW_ACTION_LABELS[action]}
          </Button>
        ))}
      </div>

      <Dialog
        open={reasonFor !== null}
        onOpenChange={(open) => !open && setReasonFor(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reasonFor ? REVIEW_ACTION_LABELS[reasonFor] : ""}
            </DialogTitle>
            <DialogDescription>
              {reasonFor === "reject"
                ? "Give the camp a clear reason for the rejection. They will see this."
                : "Tell the camp what needs to change before they resubmit."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={5}
            placeholder={
              reasonFor === "reject"
                ? "e.g. This registration duplicates an existing camp for 2027."
                : "e.g. Section 4 needs a layout upload, and the LNT lead contact is missing a phone number."
            }
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReasonFor(null)}>
              Cancel
            </Button>
            <Button
              variant={reasonFor === "reject" ? "destructive" : "default"}
              disabled={pending || reason.trim().length === 0}
              onClick={() => reasonFor && run(reasonFor, reason)}
            >
              {pending ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
