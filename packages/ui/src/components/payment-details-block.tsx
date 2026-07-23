import * as React from "react";
import type { PaymentStatus } from "@quagga/types";
import { cn } from "../lib/utils";
import { Badge } from "./badge";

// The standard payment DETAILS + reference + status block used wherever money
// will eventually apply (build-spec §apps/web, §Schema `payments`). The platform
// never processes money — this only surfaces a reference to reconcile against.

const STATUS_META: Record<
  PaymentStatus,
  { label: string; variant: "warning" | "success" | "secondary" }
> = {
  pending: { label: "Awaiting payment", variant: "warning" },
  reconciled: { label: "Reconciled", variant: "success" },
  waived: { label: "Waived", variant: "secondary" },
};

export interface PaymentDetailsBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Human-readable reference, e.g. `QP-2027-MAH-001`. */
  reference: string;
  /** Amount in cents. Optional — some fees are status-only until AB sets them. */
  amountCents?: number | null;
  /** ISO 4217 code. Defaults to ZAR. */
  currency?: string;
  status: PaymentStatus;
  /** Optional label for what the payment is for, e.g. "Placement fee". */
  subjectLabel?: string;
}

function formatAmount(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency,
    }).format(amountCents / 100);
  } catch {
    return `${currency} ${(amountCents / 100).toFixed(2)}`;
  }
}

export function PaymentDetailsBlock({
  reference,
  amountCents,
  currency = "ZAR",
  status,
  subjectLabel,
  className,
  ...props
}: PaymentDetailsBlockProps) {
  const meta = STATUS_META[status];
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 text-card-foreground shadow-sm",
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {subjectLabel && (
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {subjectLabel}
            </p>
          )}
          <p className="mt-0.5 font-mono text-sm font-medium">{reference}</p>
        </div>
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted-foreground">Amount</span>
        <span className="text-sm font-semibold">
          {typeof amountCents === "number"
            ? formatAmount(amountCents, currency)
            : "To be confirmed"}
        </span>
      </div>

      <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
        We track — AfrikaBurn collects. No payment is processed here; quote this
        reference when you settle directly with AfrikaBurn.
      </p>
    </div>
  );
}
