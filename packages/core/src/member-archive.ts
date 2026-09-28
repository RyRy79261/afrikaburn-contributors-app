// Former camp members (App Spec CDB-036, epic #55). PURE — no I/O.
//
// Decided 2026-09-27 (Ryan, #55): ARCHIVING REVOKES CAMP ACCESS. The person
// becomes a former member and their history stays: the membership row is
// kept, with everything hung off it (project roles held, per-edition
// logistics, questionnaire responses, audit), but every access path treats an
// archived membership as no membership. The SQL half of that is
// `activeMembership()` in @quagga/db; this module decides WHO may archive or
// restore WHOM.
//
// ── THE NO-LOCKOUT RULE ─────────────────────────────────────────────────────
//
// Structural lead/admin are the irrevocable permission backstop
// (./project-permissions). An archive must never be able to strand a camp, so:
//
//   · the LEAD is never archivable, by anyone. A camp with members always has
//     exactly one lead (a lead may not even leave while others remain —
//     `leaveCamp`), so the backstop survives every archive by construction.
//     Handing the camp on is a lead transfer, not an archive.
//   · a CO-LEAD (`admin`) is archivable only by the lead. Co-leads cannot
//     archive each other, and a custom-role holder cannot archive either.
//   · nobody archives themselves — that is "Leave camp", which deletes.
//   · org ranks that happen to hold a camp membership are not the camp's to
//     archive.
//
// Restoring is the mirror image, with the same authority: restoring a former
// co-lead is the lead's call too. A restore never hands privileges back
// (decided 2026-09-28): the person returns as a plain `member` with no custom
// project roles, whoever restores them — the lead re-promotes deliberately.
//
// The permission is `manage_members` (lead/admin always, via the backstop; a
// plain member only through a role that grants it).

import type { AudienceSpec, MembershipRole } from "@quagga/types";
import { resolveAudience, type AudienceContext } from "./audience";
import {
  hasProjectPermission,
  type PermissionMembership,
} from "./project-permissions";

/** Audit actions, written server-side in the same transaction as the change. */
export const MEMBER_ARCHIVE_AUDIT_ACTION = "camp.member.archive";
export const MEMBER_RESTORE_AUDIT_ACTION = "camp.member.restore";

/** The acting member: who they are and their permission membership OF THIS
 * GROUP (null ⇒ not an active member of it — a lead of camp A gets nothing in
 * camp B, and a former member has no authority left anywhere in it). */
export interface ArchiveActor {
  userId: string;
  membership: PermissionMembership | null;
}

/** The membership being archived or restored, as stored — `archived` read
 * from the row, never from the request. */
export interface ArchiveTarget {
  userId: string;
  role: MembershipRole;
  archived: boolean;
}

export type MemberArchiveRefusal =
  | "no_permission"
  | "not_member"
  | "self"
  | "lead"
  | "needs_lead"
  | "not_camp_role"
  | "already_archived"
  | "not_archived";

export type MemberArchiveDecision =
  { ok: true } | { ok: false; reason: MemberArchiveRefusal };

/** Structural roles a camp may archive at all. */
const ARCHIVABLE_ROLES: readonly MembershipRole[] = ["member", "admin"];

function commonChecks(
  actor: ArchiveActor,
  target: ArchiveTarget | null,
): MemberArchiveDecision {
  if (!actor.membership) return { ok: false, reason: "no_permission" };
  if (!hasProjectPermission(actor.membership, "manage_members")) {
    return { ok: false, reason: "no_permission" };
  }
  if (!target) return { ok: false, reason: "not_member" };
  if (target.userId === actor.userId) return { ok: false, reason: "self" };
  if (target.role === "lead") return { ok: false, reason: "lead" };
  if (!ARCHIVABLE_ROLES.includes(target.role)) {
    return { ok: false, reason: "not_camp_role" };
  }
  if (target.role === "admin" && actor.membership.structuralRole !== "lead") {
    return { ok: false, reason: "needs_lead" };
  }
  return { ok: true };
}

/** May `actor` archive `target` (make them a former member)? */
export function canArchiveMember(
  actor: ArchiveActor,
  target: ArchiveTarget | null,
): MemberArchiveDecision {
  const common = commonChecks(actor, target);
  if (!common.ok) return common;
  if (target!.archived) return { ok: false, reason: "already_archived" };
  return { ok: true };
}

/** May `actor` restore `target` (a former member) to the camp? */
export function canRestoreMember(
  actor: ArchiveActor,
  target: ArchiveTarget | null,
): MemberArchiveDecision {
  const common = commonChecks(actor, target);
  if (!common.ok) return common;
  if (!target!.archived) return { ok: false, reason: "not_archived" };
  return { ok: true };
}

/** What a refused archive/restore tells the person who asked. */
export function memberArchiveRefusalMessage(
  reason: MemberArchiveRefusal,
): string {
  switch (reason) {
    case "no_permission":
      return "You don't have permission to do that.";
    case "not_member":
      return "That person isn't in this camp.";
    case "self":
      return "You can't archive yourself — use Leave camp instead.";
    case "lead":
      return "The camp lead can't be archived. Transfer the lead role first.";
    case "needs_lead":
      return "Only the camp lead can archive or restore a co-lead.";
    case "not_camp_role":
      return "That account isn't one this camp can archive.";
    case "already_archived":
      return "They're already a former member.";
    case "not_archived":
      return "They're still a current member.";
  }
}

// ── ORG QUESTIONNAIRES REACHED THROUGH THE CAMP ─────────────────────────────
//
// Decided 2026-09-28 (Ryan): archiving also waives the person's pending ORG
// questionnaires that reached them BECAUSE of their role in this camp — an
// AfrikaBurn form sent to "leads of registered camps" that found them as this
// camp's co-lead, or to "all registered Safety Officers" that found them
// through an officer role here.
//
// `required_actions` does not record WHICH membership an audience reached a
// person through (the fan-out stores user ids only). So the reason is
// RE-DERIVED: resolve the activation's stored audience spec for this one
// person twice, from the same live rows — once as if this camp's membership
// were still active, once without it. Waive exactly when they were in the
// first and are not in the second: the archive is what took them out.
//
// What that rule leaves alone, by construction:
//   · org questionnaires sent to all burners, to the org, or to suppliers —
//     those audiences are not camp roles (and are not even loaded);
//   · a camp-role audience they still qualify for through ANOTHER current
//     membership (a co-lead of two registered camps keeps the form);
//   · a form they already did not qualify for before this archive — something
//     else changed, and it is not this action's business;
//   · every other camp's own questionnaires (project audiences).

/** Org audience kinds whose resolution depends on camp memberships (lead/
 * admin of a kind of camp, or an officer role in a registered camp). */
export const CAMP_ROLE_ORG_AUDIENCE_KINDS = [
  "org_outbound",
  "org_officer",
] as const satisfies readonly AudienceSpec["kind"][];

/** A pending required action from an ORG-authored activation. */
export interface PendingOrgAction {
  id: string;
  /** The edition the action is owed for (edition-relative selectors). */
  editionId: string;
  audience: AudienceSpec | null;
}

/**
 * Which of `actions` the archive of `archivedMembershipId` takes `userId` out
 * of. `ctx` holds this person's rows: their CURRENT memberships PLUS the one
 * being archived (as it was), and the groups, registrations, bio, role
 * assignments and project roles those resolve through. `ctx.editionId` is
 * overridden per action.
 */
export function orgActionsLostByArchive(
  userId: string,
  archivedMembershipId: string,
  actions: readonly PendingOrgAction[],
  ctx: AudienceContext,
): string[] {
  const own = ctx.memberships.filter((m) => m.userId === userId);
  const before = own;
  const after = own.filter((m) => m.membershipId !== archivedMembershipId);
  const kinds: readonly string[] = CAMP_ROLE_ORG_AUDIENCE_KINDS;
  const lost: string[] = [];
  for (const action of actions) {
    const spec = action.audience;
    if (!spec || !kinds.includes(spec.kind)) continue;
    const at = { ...ctx, editionId: action.editionId };
    const was = resolveAudience(spec, { ...at, memberships: before });
    if (!was.includes(userId)) continue;
    const still = resolveAudience(spec, { ...at, memberships: after });
    if (!still.includes(userId)) lost.push(action.id);
  }
  return lost;
}
