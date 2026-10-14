import {
  CLAIM_STATUS_LABELS,
  DUES_STATUS_LABELS,
  type MoneyTab,
} from "@quagga/core";
import type {
  CampClaimStatus,
  DuesStatus,
  ReceiptSubjectKind,
} from "@quagga/types";

// Presentation helpers for the camp money page (docs/camp-budget-spec.md,
// frames M1–M4). Pure: no data access, no authorisation — what a viewer may
// see is decided by the store before any of this runs.

export type MoneyBadgeVariant =
  "default" | "secondary" | "outline" | "destructive" | "success" | "warning";

/** M2's status pills: Paid green, Part paid amber, Awaiting / Waived plain. */
export const DUES_STATUS_BADGE: Record<DuesStatus, MoneyBadgeVariant> = {
  paid: "success",
  part_paid: "warning",
  awaiting: "outline",
  waived: "outline",
  no_fee: "outline",
};

/** M3's status pills. */
export const CLAIM_STATUS_BADGE: Record<CampClaimStatus, MoneyBadgeVariant> = {
  submitted: "secondary",
  approved: "success",
  rejected: "destructive",
  repaid: "default",
};

export function duesStatusLabel(status: DuesStatus): string {
  return DUES_STATUS_LABELS[status];
}

export function claimStatusLabel(status: CampClaimStatus): string {
  return CLAIM_STATUS_LABELS[status];
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "9 Apr 2027". A `YYYY-MM-DD` string is a calendar day and is read as one; a
 * timestamp is shown as the day it was in South Africa (UTC+2, no DST). Done
 * by hand so server and browser render the same string.
 */
export function moneyDayLabel(value: string | Date | null): string {
  if (value === null) return "—";
  if (typeof value === "string") {
    const m = ISO_DAY.exec(value);
    if (!m) return value;
    return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""} ${m[1]}`;
  }
  const sast = new Date(value.getTime() + 2 * 60 * 60 * 1000);
  return `${sast.getUTCDate()} ${MONTHS[sast.getUTCMonth()]} ${sast.getUTCFullYear()}`;
}

/** Today's calendar day where the camp is (South Africa), `YYYY-MM-DD`. */
export function todayInSouthAfrica(now: Date = new Date()): string {
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  return sast.toISOString().slice(0, 10);
}

/** The authorised receipt route — the only URL a receipt is ever behind. */
export function receiptHref(kind: ReceiptSubjectKind, id: string): string {
  return `/api/money/receipts/${kind}/${id}`;
}

/** Which tab a `?tab=` asks for; anything else is the budget. */
export function parseMoneyTab(raw: string | string[] | undefined): MoneyTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "dues" || v === "claims" ? v : "budget";
}

export type ClaimFilter = "all" | CampClaimStatus;

export function parseClaimFilter(
  raw: string | string[] | undefined,
): ClaimFilter {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "submitted" ||
    v === "approved" ||
    v === "rejected" ||
    v === "repaid"
    ? v
    : "all";
}

/** The one-line meta under a claim on M3/M4: what happened to it, and when. */
export function claimMetaLine(
  claim: {
    status: CampClaimStatus;
    categoryName: string | null;
    createdAt: Date;
    decidedAt: Date | null;
    decidedByName: string | null;
    repaidOn: string | null;
  },
  audience: "money" | "member",
): string {
  const category = claim.categoryName ?? "No category yet";
  switch (claim.status) {
    case "submitted":
      return `${category} · Submitted ${moneyDayLabel(claim.createdAt)}`;
    case "approved":
      return audience === "member"
        ? `${category} · Approved ${moneyDayLabel(claim.decidedAt)} · the camp repays you by EFT`
        : `${category} · Approved by ${claim.decidedByName ?? "a money person"} on ${moneyDayLabel(claim.decidedAt)} · not repaid yet`;
    case "rejected":
      return audience === "member"
        ? `${category} · Rejected ${moneyDayLabel(claim.decidedAt)}`
        : `${category} · Rejected by ${claim.decidedByName ?? "a money person"} on ${moneyDayLabel(claim.decidedAt)}`;
    case "repaid":
      return `${category} · Repaid on ${moneyDayLabel(claim.repaidOn)}`;
  }
}

/** "13 of 20" paid-up line's detail: "3 part paid · 3 awaiting · 1 waived". */
export function duesBreakdown(byStatus: Record<DuesStatus, number>): string {
  const parts: string[] = [];
  if (byStatus.part_paid) parts.push(`${byStatus.part_paid} part paid`);
  if (byStatus.awaiting) parts.push(`${byStatus.awaiting} awaiting`);
  if (byStatus.waived) parts.push(`${byStatus.waived} waived`);
  if (byStatus.no_fee) parts.push(`${byStatus.no_fee} with no fee set`);
  return parts.length ? parts.join(" · ") : "Nobody owes anything";
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Can Approve go straight through with the claim's own category? Only when
 * that category is still a live spending category. A category removed after
 * the claim was filed is archived, and the server refuses it, so the approver
 * must pick another — otherwise Approve is a dead end and Reject the only way
 * out.
 */
export function approvesWithOwnCategory(
  claimCategoryId: string | null,
  liveCategories: readonly { id: string }[],
): boolean {
  return (
    claimCategoryId !== null &&
    liveCategories.some((c) => c.id === claimCategoryId)
  );
}
