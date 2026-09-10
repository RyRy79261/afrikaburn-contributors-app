import type { PaymentStatus } from "@quagga/types";

// Payment TRACKING (App Spec §8, Decision 009 — resolved 12 Aug 2026).
//
// THE PLATFORM NEVER TOUCHES MONEY, AND THIS FILE IS WHERE THAT IS ENFORCED
// RATHER THAN ASSERTED. There is no gateway, no merchant account, no card
// capture, no payout, no refund, no escrow, and no camp treasury. What exists is
// two things a spreadsheet does badly:
//
//   1. a UNIQUE CODE that identifies who a payment is for — `payments.reference`
//      (`QP-2027-MAH-001`, from ./payment-reference) for an AfrikaBurn-side fee,
//      and `memberships.ref_code` (`MAH-M017`, from ./member-ref-code) for a
//      camp reconciling its own EFTs against its own bank account;
//   2. a CHECKBOX a staff member ticks once the money has arrived somewhere
//      else — the status below.
//
// The money moves through AfrikaBurn's existing channels. We record that it did.
// Any future change here that starts accepting an amount FROM a payer, rather
// than recording one an administrator observed, is out of scope by construction
// and needs Decision 009 reopened first.

/**
 * Legal status transitions.
 *
 * Everything is reversible because every one of these states is a human's
 * observation about the world, and humans tick the wrong row. An irreversible
 * "reconciled" would mean a misclick can only be fixed in the database.
 */
export const PAYMENT_TRANSITIONS: Record<
  PaymentStatus,
  readonly PaymentStatus[]
> = {
  // Recorded, not yet seen in the account.
  pending: ["reconciled", "waived"],
  // Seen in the account — undoable, because "that was a different camp" happens.
  reconciled: ["pending", "waived"],
  // AfrikaBurn decided this one is not owed. Undoable for the same reason.
  waived: ["pending", "reconciled"],
};

/** Whether `from → to` is a legal payment-status transition. */
export function canTransitionPayment(
  from: PaymentStatus,
  to: PaymentStatus,
): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

/** Throw on an illegal payment-status transition; otherwise return `to`. */
export function assertPaymentTransition(
  from: PaymentStatus,
  to: PaymentStatus,
): PaymentStatus {
  if (!canTransitionPayment(from, to)) {
    throw new Error(
      `Illegal payment transition: ${from} → ${to}. Allowed: ${
        PAYMENT_TRANSITIONS[from].join(", ") || "(none)"
      }`,
    );
  }
  return to;
}

/** Whether a status means "nothing further is owed". */
export function isSettled(status: PaymentStatus): boolean {
  return status === "reconciled" || status === "waived";
}

/** Display label for a payment status. */
export function paymentStatusLabel(status: PaymentStatus): string {
  switch (status) {
    case "pending":
      return "Awaiting payment";
    case "reconciled":
      return "Paid";
    case "waived":
      return "Waived";
  }
}

/**
 * The sentence shown wherever a payment status appears, so no screen can imply
 * the platform collected anything.
 */
export const PAYMENT_TRACKING_DISCLAIMER =
  "AfrikaBurn collects payment through its own channels. This app only records whether it arrived.";

/**
 * Guard for the one column that could drift into fund-handling: an amount is a
 * NOTE about what was invoiced elsewhere, never a sum this platform is
 * collecting. Negative amounts are refunds, and a platform that never took money
 * cannot give any back.
 */
export function assertRecordableAmount(
  amountCents: number | null | undefined,
): number | null {
  if (amountCents === null || amountCents === undefined) return null;
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error(
      "An amount is a note of what AfrikaBurn invoiced elsewhere — it must be a whole number of cents, and never negative.",
    );
  }
  return amountCents;
}
