"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, UserMinus, UserPlus } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quagga/ui/components/dialog";
import { toast } from "@quagga/ui/components/toast";
import { setOrgStaffRole } from "@/lib/actions/accounts";

/**
 * Elevate / demote controls for one account. Only rendered for god admins —
 * but rendering is never the boundary: `setOrgStaffRole` re-checks god on the
 * server, refuses self-changes and god targets, and audits every change.
 *
 * Both directions go through the Confirm Overlay the canvas draws (frame
 * `CJs0P`, node `mfJhv`): icon + "Elevate to org staff?" + the person it
 * affects + what the grant actually means. This is UX, not security — a
 * mis-click is cheap to make and expensive to undo, so it gets a second beat.
 */
export function AccountActions({
  userId,
  personLabel,
  role,
  isSelf,
}: {
  userId: string;
  /** Who this row is, named in the confirmation copy (frame node `xPit0`). */
  personLabel: string;
  role: "god" | "org_staff" | null;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<"elevate" | "demote" | null>(
    null,
  );

  if (role === "god") {
    return (
      <span className="text-xs text-muted-foreground">
        System owner — cannot change
      </span>
    );
  }
  if (isSelf) {
    return <span className="text-xs text-muted-foreground">You</span>;
  }

  function act(action: "elevate" | "demote") {
    startTransition(async () => {
      const result = await setOrgStaffRole({ userId, action });
      if (result.ok) {
        toast.success(
          action === "elevate"
            ? "Elevated to org staff."
            : "Removed org access.",
        );
        setConfirming(null);
        router.refresh();
      } else {
        toast.error("Could not update access", { description: result.error });
      }
    });
  }

  const elevating = confirming === "elevate";
  const Icon = elevating ? UserPlus : UserMinus;

  return (
    <>
      {role === "org_staff" ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setConfirming("demote")}
        >
          <UserMinus aria-hidden />
          Remove staff access
        </Button>
      ) : (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => setConfirming("elevate")}
        >
          <ArrowUp aria-hidden />
          Elevate to org staff
        </Button>
      )}

      <Dialog
        open={confirming !== null}
        // Dismissing (Esc, overlay, close button) only closes — it never acts.
        onOpenChange={(open) => {
          if (!open && !pending) setConfirming(null);
        }}
      >
        <DialogContent className="sm:max-w-[468px]">
          <DialogHeader>
            <div className="flex items-start gap-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning text-warning-foreground">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <div className="flex flex-1 flex-col gap-1 text-left">
                <DialogTitle>
                  {elevating
                    ? "Elevate to org staff?"
                    : "Remove org staff access?"}
                </DialogTitle>
                <DialogDescription className="font-mono text-[13px]">
                  {personLabel}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <p className="text-sm leading-relaxed text-card-foreground">
            {elevating
              ? "This grants full console access — reviewing registrations and vetting suppliers. This action is logged to the audit trail."
              : "They lose console access immediately — registrations, suppliers and accounts all close to them. This action is logged to the audit trail."}
          </p>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirming(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={elevating ? "default" : "destructive"}
              disabled={pending}
              onClick={() => confirming && act(confirming)}
            >
              {elevating ? "Elevate to org staff" : "Remove staff access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
