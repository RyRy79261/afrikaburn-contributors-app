// Camp announcements (epic #56) — the PURE half. No I/O, no env, no DB.
//
// A camp announcement is a `bulletins` row with `group_id` set: the org's
// broadcast spine, generalised so a camp can use it for its own members. The
// model is ported from Camp 404 (same author, single-camp app) and adapted to
// this codebase's permission model:
//
//   · WHO MAY SEND — `canSendCampAnnouncement`. The structural lead/admin
//     always may (the irrevocable backstop); anyone else needs the
//     `post_announcements` project permission, limited to the role audiences
//     its scope lists, and `mayRequireAck` for a must-acknowledge send. The
//     store asks this TWICE: once to answer the screen, and again INSIDE the
//     publish transaction over rows it has locked, so a sender demoted between
//     drafting and publishing is refused (Camp 404's `lockSenderReach`).
//
//   · WHO RECEIVES — `resolveCampAnnouncementRecipients`. The camp's own live
//     memberships only (the `project` branch of the one shared resolver), minus
//     the author and any sanitized account. A pending invitee has no
//     membership, so is never reached; another camp's member never is either.
//
//   · WHO MAY READ — nothing here, on purpose. The recipient's delivery row
//     (`notifications` with this `bulletin_id`) IS the permission, settled at
//     fan-out. A reader without one gets exactly the answer a reader of a
//     non-existent id gets.
//
//   · PIN ORDER — `sortPinned`: newest pin first, total and deterministic.
//
// PRIVACY LAW: an announcement's payload is the camp name + the author's own
// title. It never names, lists or describes a member.

import type {
  AnnouncementPresentation,
  NotificationPayload,
  ProjectAudience,
} from "@quagga/types";
import {
  canPostAnnouncementAudience,
  isPermissionBackstop,
  type PermissionMembership,
} from "./project-permissions";
import { projectAudienceTargetRoleIds } from "./questionnaire-authz";
import {
  resolveAudience,
  type AudienceMembership,
  type AudienceProjectRole,
  type AudienceRoleAssignment,
} from "./audience";

// --- Who may send ---------------------------------------------------------

export interface CampAnnouncementSendRequest {
  /** The camp the announcement belongs to (`bulletins.group_id`). */
  groupId: string;
  audience: ProjectAudience;
  presentation: AnnouncementPresentation;
  /** The camp's baseline role id — "everyone" is targeting the baseline. */
  baselineRoleId: string | null;
  /**
   * Every project_role id that belongs to THIS camp. A role id from another
   * camp is refused outright rather than silently resolving to nobody.
   */
  campRoleIds: ReadonlySet<string>;
}

/**
 * May this member send (or publish, or schedule) this announcement?
 *
 * Fail-closed on every shape question before the permission is consulted: the
 * audience must be a project audience for THIS camp (never another camp, never
 * an org audience), a by-role send must name at least one role, and every role
 * named must be one of this camp's. Then the backstop, then the scope.
 */
export function canSendCampAnnouncement(
  m: PermissionMembership,
  req: CampAnnouncementSendRequest,
): boolean {
  const { audience } = req;
  if (audience.kind !== "project") return false;
  if (audience.groupId !== req.groupId) return false;
  if (audience.mode === "roles") {
    if (audience.roleIds.length === 0) return false;
    if (!audience.roleIds.every((id) => req.campRoleIds.has(id))) return false;
  }
  if (isPermissionBackstop(m.structuralRole)) return true;
  if (audience.mode === "everyone" && !req.baselineRoleId) return false;
  return canPostAnnouncementAudience(m, {
    targetRoleIds: projectAudienceTargetRoleIds(audience, req.baselineRoleId),
    requireAck: req.presentation === "acknowledge",
  });
}

/**
 * May this member pin or unpin an announcement? PINNING AUTHORITY FOLLOWS
 * POSTING AUTHORITY (Camp 404, owner's ruling): if you may post to that
 * audience, you may pin what was posted to it. Presentation is irrelevant to a
 * pin — a pin is whether it stays on screen, not how loudly it landed.
 */
export function canPinCampAnnouncement(
  m: PermissionMembership,
  req: Omit<CampAnnouncementSendRequest, "presentation">,
): boolean {
  return canSendCampAnnouncement(m, { ...req, presentation: "feed" });
}

// --- Who receives ---------------------------------------------------------

export interface CampAnnouncementAudienceContext {
  groupId: string;
  /** Live memberships (already narrowed to this camp by the caller, but the
   * resolver narrows again — never trust a caller's filter for scope). */
  memberships: readonly AudienceMembership[];
  roleAssignments: readonly AudienceRoleAssignment[];
  projectRoles: readonly AudienceProjectRole[];
  /** Accounts that must never receive anything (sanitized "Departed Burner"
   * stubs keep their memberships for integrity). */
  excludedUserIds?: ReadonlySet<string>;
}

/**
 * The recipients of a camp announcement: this camp's current members in the
 * audience, never the author (they wrote it; a must-acknowledge send would
 * otherwise gate its own author), never a sanitized account. Sorted and
 * de-duplicated (the shared resolver's output shape).
 */
export function resolveCampAnnouncementRecipients(
  audience: ProjectAudience,
  ctx: CampAnnouncementAudienceContext,
  authorUserId: string | null,
): string[] {
  if (audience.groupId !== ctx.groupId) return [];
  const ids = resolveAudience(audience, {
    editionId: "",
    orgGroupId: "",
    memberships: ctx.memberships.filter((m) => m.groupId === ctx.groupId),
    groups: [],
    registrations: [],
    bios: [],
    roleAssignments: ctx.roleAssignments,
    projectRoles: ctx.projectRoles.filter((r) => r.groupId === ctx.groupId),
  });
  return ids.filter(
    (id) => id !== authorUserId && !(ctx.excludedUserIds?.has(id) ?? false),
  );
}

// --- Refusals, as the sentence the author reads ---------------------------

export const ANNOUNCEMENT_MESSAGES = {
  missing: "That announcement no longer exists. Reload the page.",
  published:
    "This announcement has already been published, so it can't be changed. Post a correction instead.",
  notAllowed:
    "You can't send to that audience — check your announcement permissions, or ask a lead.",
  notDelivered: "Only an announcement that has gone out can be pinned.",
  alreadyPinned: "It's already pinned. Reload the page.",
  alreadyUnpinned: "It isn't pinned. Reload the page.",
} as const;

/** The row facts a draft refusal is explained from. */
export interface DraftRefusalRow {
  groupId: string | null;
  createdByUserId: string | null;
  publishedAt: Date | null;
}

/**
 * Why a draft write (edit, delete, publish) claimed nothing. The writes claim
 * with one predicate — this camp, this author, still a draft — so a refusal
 * alone cannot say which part failed; this reads the row once to say.
 *
 * DRAFT PRIVACY: another member's draft answers EXACTLY as a missing one does.
 * A draft is visible to its author only, and "that is somebody else's draft"
 * would itself disclose that it exists.
 */
export function explainDraftRefusal(
  row: DraftRefusalRow | null,
  ctx: { actorId: string; groupId: string; allowed: boolean },
): string {
  if (!row || row.groupId !== ctx.groupId) return ANNOUNCEMENT_MESSAGES.missing;
  if (row.createdByUserId !== ctx.actorId) return ANNOUNCEMENT_MESSAGES.missing;
  if (row.publishedAt) return ANNOUNCEMENT_MESSAGES.published;
  if (!ctx.allowed) return ANNOUNCEMENT_MESSAGES.notAllowed;
  return ANNOUNCEMENT_MESSAGES.missing;
}

/** The row facts a pin refusal is explained from. */
export interface PinRefusalRow {
  groupId: string | null;
  dispatchedAt: Date | null;
  pinnedAt: Date | null;
}

/** Why a pin/unpin compare-and-set claimed nothing. */
export function explainPinRefusal(
  row: PinRefusalRow | null,
  ctx: { groupId: string; allowed: boolean; pinned: boolean },
): string {
  if (!row || row.groupId !== ctx.groupId) return ANNOUNCEMENT_MESSAGES.missing;
  if (!ctx.allowed) return ANNOUNCEMENT_MESSAGES.notAllowed;
  if (!row.dispatchedAt) return ANNOUNCEMENT_MESSAGES.notDelivered;
  if ((row.pinnedAt !== null) === ctx.pinned) {
    return ctx.pinned
      ? ANNOUNCEMENT_MESSAGES.alreadyPinned
      : ANNOUNCEMENT_MESSAGES.alreadyUnpinned;
  }
  return ANNOUNCEMENT_MESSAGES.missing;
}

// --- Scheduling + dispatch ------------------------------------------------

/** How far ahead a send may be scheduled. A burn is a year apart. */
export const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Validate a scheduled send time at the moment it is chosen or published.
 * Null means "send now". A time in the past (or within the next minute) is
 * refused rather than quietly treated as "now" — the author asked for later,
 * and silently sending it immediately is the surprise this avoids.
 */
export function validateSendAt(
  sendAt: Date | null,
  now: Date,
): { ok: true; sendAt: Date | null } | { ok: false; error: string } {
  if (sendAt === null) return { ok: true, sendAt: null };
  if (Number.isNaN(sendAt.getTime())) {
    return { ok: false, error: "That send time isn't a valid date." };
  }
  if (sendAt.getTime() <= now.getTime() + 60_000) {
    return {
      ok: false,
      error: "Pick a send time at least a minute from now, or send it now.",
    };
  }
  if (sendAt.getTime() - now.getTime() > MAX_SCHEDULE_AHEAD_MS) {
    return { ok: false, error: "Schedule it within the next year." };
  }
  return { ok: true, sendAt };
}

/** The row facts the dispatch job selects on. */
export interface DispatchRow {
  groupId: string | null;
  publishedAt: Date | null;
  dispatchedAt: Date | null;
  sendAt: Date | null;
}

/**
 * Is this row a scheduled camp announcement whose time has come? Only
 * SCHEDULED rows (send_at set) are the job's business — an immediate publish
 * fans out inline, and an org bulletin (group_id null) is never touched, so a
 * pre-existing published org row with a null `dispatched_at` can never be
 * re-delivered by this job.
 */
export function isDueForDispatch(row: DispatchRow, now: Date): boolean {
  return (
    row.groupId !== null &&
    row.publishedAt !== null &&
    row.dispatchedAt === null &&
    row.sendAt !== null &&
    row.sendAt.getTime() <= now.getTime()
  );
}

export type DispatchDecision =
  | { deliver: true }
  | {
      deliver: false;
      reason: "author_gone" | "sender_not_allowed" | "edition_ended";
    };

/**
 * At dispatch time, re-ask the question publish asked. The sender's permission
 * is read again (a lead demoted after scheduling must not still reach the
 * camp), and a send scheduled in one edition never fans out into the next
 * edition's roster.
 */
export function decideDispatch(input: {
  /** null = the author's account no longer exists / is no longer a member. */
  senderAllowed: boolean | null;
  editionIsActive: boolean;
}): DispatchDecision {
  if (!input.editionIsActive)
    return { deliver: false, reason: "edition_ended" };
  if (input.senderAllowed === null) {
    return { deliver: false, reason: "author_gone" };
  }
  if (!input.senderAllowed) {
    return { deliver: false, reason: "sender_not_allowed" };
  }
  return { deliver: true };
}

// --- Pinned order ---------------------------------------------------------

/** What the order needs to know about a pin. */
export interface PinnedOrder {
  /** The bulletin id — the final, total tiebreak. */
  id: string;
  /** When it was pinned. Org pins made before `pinned_at` existed fall back to
   * their publish time at the call site. */
  pinnedAt: Date;
  /** An AfrikaBurn pin sits above a camp pin on an exact tie. */
  fromOrg: boolean;
}

/**
 * Compare two pins for display order: newest PIN first (re-pinning is how an
 * author brings one back to the front, so it is the pin's own time, not the
 * publish time); on a tie AfrikaBurn above a camp; then the id. TOTAL and
 * antisymmetric — distinct pins never compare equal, so the banner order never
 * depends on the row order a query happened to return.
 */
export function comparePinned(a: PinnedOrder, b: PinnedOrder): number {
  const byTime = b.pinnedAt.getTime() - a.pinnedAt.getTime();
  if (byTime !== 0) return byTime;
  if (a.fromOrg !== b.fromOrg) return a.fromOrg ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The same pins, in banner order. */
export function sortPinned<T extends PinnedOrder>(pins: readonly T[]): T[] {
  return [...pins].sort(comparePinned);
}

// --- Payloads -------------------------------------------------------------

/** The route a recipient reads (and, when must-acknowledge, is gated to). */
export function announcementPath(bulletinId: string): string {
  return `/bulletins/${bulletinId}`;
}

/**
 * 📣 The inbox row for a camp announcement. Camp name + the author's title and
 * nothing else — never a member's name or any personal field.
 */
export function campAnnouncementNotification(input: {
  campName: string;
  title: string;
  announcementId: string;
  presentation: AnnouncementPresentation;
}): NotificationPayload {
  return {
    kind: "bulletin",
    title: `${input.campName}: ${input.title}`,
    body:
      input.presentation === "acknowledge"
        ? "Please read and acknowledge this announcement."
        : null,
    link: announcementPath(input.announcementId),
  };
}

/**
 * The immediate email a must-acknowledge announcement sends (feed ones wait
 * for the daily digest). A nudge, not the message: it names the camp and the
 * title and links to the page, so the announcement body lives in one place and
 * the gate — not the inbox — is where it is read and acknowledged.
 */
export function campAnnouncementEmail(input: {
  campName: string;
  title: string;
  announcementId: string;
}): { subject: string; text: string } {
  return {
    subject: `${input.campName}: please read and acknowledge — ${input.title}`,
    text:
      `${input.campName} has posted an announcement they need you to read and acknowledge: "${input.title}".\n\n` +
      `Open it here: ${announcementPath(input.announcementId)}\n\n` +
      `You'll see it the next time you open the Contributors portal.`,
  };
}
