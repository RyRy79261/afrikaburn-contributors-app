"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { Checkbox } from "@quagga/ui/components/checkbox";
import { toast } from "@quagga/ui/components/toast";
import {
  paymentStatusLabel,
  PAYMENT_TRACKING_DISCLAIMER,
} from "@quagga/core";
import type { PaymentStatus } from "@quagga/types";
import { recordRegistrationPayment } from "@/lib/actions/payments";

/**
 * The paid checkbox (App Spec §8; Decision 009 — tracking only).
 *
 * A CHECKBOX, NOT A CHECKOUT. AfrikaBurn collects through its own channels; this
 * records whether the money arrived. The disclaimer is printed rather than
 * implied, because a screen with the word "payment" on it and no such sentence
 * is a screen someone will eventually read as a way to pay.
 *
 * "Waived" is a third state rather than a second checkbox: AfrikaBurn deciding
 * nothing is owed is a different fact from AfrikaBurn having been paid, and
 * collapsing them would lose the distinction in the audit trail.
 */
export function PaymentPanel({
  registrationId,
  reference,
  status,
  canRecord,
}: {
  registrationId: string;
  /** Null until the first status is recorded and the reference is minted. */
  reference: string | null;
  status: PaymentStatus | null;
  /**
   * Whether this viewer may record a status. A boolean rather than the refusal
   * prose: the rail states the department sentence ONCE, in the Decision or
   * Wrangler card — see the note in `placement-panel.tsx`.
   */
  canRecord: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const blocked = !canRecord;
  const current = status ?? "pending";
  const paid = current === "reconciled";

  function record(next: PaymentStatus) {
    startTransition(async () => {
      const result = await recordRegistrationPayment({
        registrationId,
        status: next,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Marked ${paymentStatusLabel(next).toLowerCase()}.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {reference ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Reference
          </span>
          <code className="rounded bg-muted px-2 py-1 font-mono text-sm">
            {reference}
          </code>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          A reference is generated the first time you record a status.
        </p>
      )}

      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Status</span>
        <Badge variant={paid ? "success" : "warning"}>
          {paymentStatusLabel(current)}
        </Badge>
      </div>

      {blocked ? (
        <p className="text-xs text-muted-foreground">
          Recording payment needs the same access as deciding this registration.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={paid}
              disabled={pending}
              onChange={(e) =>
                record(e.target.checked ? "reconciled" : "pending")
              }
              aria-label="Payment received"
            />
            Payment received
          </label>
          {current !== "waived" ? (
            <Button
              size="sm"
              variant="ghost"
              className="w-fit"
              disabled={pending}
              onClick={() => record("waived")}
            >
              <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Waive this fee
            </Button>
          ) : null}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {PAYMENT_TRACKING_DISCLAIMER}
      </p>
    </div>
  );
}
