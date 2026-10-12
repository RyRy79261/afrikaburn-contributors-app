"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, History, ShieldAlert, Undo2 } from "lucide-react";
import { WAP_RETURN_NOTE_MAX } from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { Textarea } from "@quagga/ui/components/textarea";
import { toast } from "@quagga/ui/components/toast";
import { approveWapList, returnWapList } from "@/lib/actions/wap";

// Approve the whole list, or return it with a note (frame W2). Only a
// SUBMITTED list can be decided; the note is required to return. The server
// re-decides both (@quagga/core `decideWapApprove` / `decideWapReturn`).

export function ListDecision({
  registrationId,
  canDecide,
  waitingCopy,
  refusal,
  subjectNoun,
}: {
  registrationId: string;
  /** The list is submitted. */
  canDecide: boolean;
  /** Why there is nothing to decide (shown when `canDecide` is false). */
  waitingCopy: string;
  /** Why this viewer may not decide, or null when they may. */
  refusal: string | null;
  subjectNoun: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const disabled = !canDecide || Boolean(refusal) || pending;

  function approve() {
    startTransition(async () => {
      const result = await approveWapList({ registrationId });
      if (result.ok) {
        toast.success("List approved.");
        router.refresh();
      } else {
        toast.error("Could not approve", { description: result.error });
      }
    });
  }

  function sendBack() {
    startTransition(async () => {
      const result = await returnWapList({ registrationId, note });
      if (result.ok) {
        toast.success("List returned with your note.");
        setNote("");
        router.refresh();
      } else {
        toast.error("Could not return", { description: result.error });
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {!canDecide && (
        <p className="text-sm text-muted-foreground">{waitingCopy}</p>
      )}
      <Button onClick={approve} disabled={disabled}>
        <CircleCheck aria-hidden />
        Approve list
      </Button>
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <label htmlFor="wap-return-note" className="text-sm font-medium">
          Note to the {subjectNoun} (needed to return)
        </label>
        <Textarea
          id="wap-return-note"
          rows={4}
          maxLength={WAP_RETURN_NOTE_MAX}
          placeholder="e.g. Two people haven't finished their bio — ask them to, or swap them out."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={disabled}
        />
        <Button
          variant="secondary"
          onClick={sendBack}
          disabled={disabled || note.trim() === ""}
        >
          <Undo2 aria-hidden />
          Return with note
        </Button>
      </div>
      {refusal && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{refusal}</span>
        </p>
      )}
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <History className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Every decision is logged to the audit trail.
      </p>
    </div>
  );
}
