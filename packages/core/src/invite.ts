// One-time invite redemption logic (build-spec §apps/web `/camps/[slug]`,
// §Schema `invites`). Invites are single-use links of kind `member` or
// `lead_transfer`. This module is the PURE decision layer — given an invite row
// + the current time, may it be redeemed, and by whom. apps/web performs the
// atomic DB claim (guarded by the same predicate) on top of this.

import type { InviteKind } from "@quagga/types";

/** Minimal shape the redemption check needs from an `invites` row. */
export interface InviteLike {
  kind: InviteKind;
  expiresAt: Date | null;
  usedAt: Date | null;
  usedByUserId: string | null;
}

/** Why an invite cannot be redeemed. `null` reason ⇒ it can. */
export type InviteRejection = "already_used" | "expired" | "self_member";

export interface InviteCheckResult {
  ok: boolean;
  reason: InviteRejection | null;
}

const OK: InviteCheckResult = { ok: true, reason: null };

/**
 * Whether `invite` may be redeemed at `now`. Single-use is the core rule: any
 * invite already stamped (`usedAt` set) is spent, regardless of expiry. An
 * invite with a past `expiresAt` is expired; a null `expiresAt` never expires.
 */
export function canRedeemInvite(
  invite: InviteLike,
  now: Date = new Date(),
): InviteCheckResult {
  if (invite.usedAt !== null || invite.usedByUserId !== null) {
    return { ok: false, reason: "already_used" };
  }
  if (
    invite.expiresAt !== null &&
    invite.expiresAt.getTime() <= now.getTime()
  ) {
    return { ok: false, reason: "expired" };
  }
  return OK;
}

/**
 * As {@link canRedeemInvite}, but also rejects a redeemer who is already a
 * member of the group for a plain `member` invite (a `lead_transfer` is still
 * valid for an existing member — that's how a lead hands over). `isMember`
 * reflects the redeemer's current membership in the invite's group.
 */
export function canRedeemInviteAs(
  invite: InviteLike,
  redeemer: { isMember: boolean },
  now: Date = new Date(),
): InviteCheckResult {
  const base = canRedeemInvite(invite, now);
  if (!base.ok) return base;
  if (invite.kind === "member" && redeemer.isMember) {
    return { ok: false, reason: "self_member" };
  }
  return OK;
}

/** Human-readable copy for a rejection reason. */
export function inviteRejectionMessage(reason: InviteRejection): string {
  switch (reason) {
    case "already_used":
      return "This invite link has already been used. Ask the camp for a fresh one.";
    case "expired":
      return "This invite link has expired. Ask the camp for a fresh one.";
    case "self_member":
      return "You're already a member of this camp.";
  }
}
