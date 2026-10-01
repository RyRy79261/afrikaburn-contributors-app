import "server-only";

import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  CAMP_ROLE_ORG_AUDIENCE_KINDS,
  canArchiveMember,
  canRestoreMember,
  MEMBER_ARCHIVE_AUDIT_ACTION,
  MEMBER_RESTORE_AUDIT_ACTION,
  memberArchiveRefusalMessage,
  orgActionsLostByArchive,
  type ArchiveTarget,
  type MemberArchiveDecision,
} from "@quagga/core";
import type { OfficerKey } from "@quagga/types";
import { activeMembership } from "@quagga/db";
import { db, schema, withTransaction, type Tx } from "./db";
import { getMemberPermissions } from "./roles-store";

// Former camp members (App Spec CDB-036, epic #55). Decided 2026-09-27 (#55):
// ARCHIVING REVOKES CAMP ACCESS — the person becomes a former member and their
// history stays.
//
// The write is one column pair on the membership row (`archived_at`,
// `archived_by_user_id`); what makes it an access change is that every
// membership query that decides access filters through `activeMembership()`
// (@quagga/db — pinned for the whole monorepo by
// lib/__tests__/membership-archive-guard.test.ts). Nothing hung off the row is
// deleted at archive: project-role assignments, logistics, questionnaire
// responses and audit rows all stay as the camp's record of them. The one
// exception is camp SHIFT spots (epic #57): those are future commitments the
// camp must refill, so the archive frees them.
//
// What does NOT come back on restore (decided 2026-09-28, Ryan): their custom
// project-role assignments. A restored member returns as a plain member (or
// with exactly the structural role the invite that restored them grants), so
// neither the restorer's authority nor an old link can hand back privileges
// the camp took away. See {@link dropRoleAssignmentsOnRestore}.
//
// WHO may archive WHOM is @quagga/core `canArchiveMember` / `canRestoreMember`
// (never the lead; a co-lead only by the lead; nobody themselves). Every fact
// those predicates read is loaded HERE from the database — the request names a
// membership id and nothing else.

export type MemberArchiveResult = { ok: true } | { ok: false; error: string };

/** The membership being acted on, scoped to the camp the caller's permission
 * was resolved for, in either state — the predicate needs to see a former
 * member to refuse archiving them twice, and to restore them at all. */
async function loadTarget(
  groupId: string,
  membershipId: string,
): Promise<(ArchiveTarget & { id: string }) | null> {
  // former members: this lookup must see archived rows (restore acts on one).
  const [row] = await db()
    .select({
      id: schema.memberships.id,
      userId: schema.memberships.userId,
      role: schema.memberships.role,
      archivedAt: schema.memberships.archivedAt,
      groupKind: schema.groups.kind,
    })
    .from(schema.memberships)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.memberships.groupId))
    .where(
      and(
        eq(schema.memberships.id, membershipId),
        eq(schema.memberships.groupId, groupId),
      ),
    )
    .limit(1);
  // The org group is never archivable — its people are managed in the console.
  if (!row || row.groupKind === "org") return null;
  return {
    id: row.id,
    userId: row.userId,
    role: row.role,
    archived: row.archivedAt !== null,
  };
}

async function decide(
  kind: "archive" | "restore",
  input: { actorUserId: string; groupId: string; membershipId: string },
): Promise<
  | { ok: true; target: ArchiveTarget & { id: string } }
  | { ok: false; error: string }
> {
  const [membership, target] = await Promise.all([
    getMemberPermissions(input.groupId, input.actorUserId),
    loadTarget(input.groupId, input.membershipId),
  ]);
  const actor = { userId: input.actorUserId, membership };
  const decision: MemberArchiveDecision =
    kind === "archive"
      ? canArchiveMember(actor, target)
      : canRestoreMember(actor, target);
  if (!decision.ok) {
    return { ok: false, error: memberArchiveRefusalMessage(decision.reason) };
  }
  return { ok: true, target: target! };
}

const STALE =
  "That member changed while you were looking — refresh and try again.";

/**
 * Archive a camp member: they become a FORMER member. One transaction:
 *
 *   1. a compare-and-set on the row — still active, still the role the
 *      predicate judged (a lead transfer that landed in between would have
 *      made them the lead, and the lead is never archivable);
 *   2. their PENDING questionnaires from this camp are waived, so a camp they
 *      can no longer open cannot hold a blocking gate over their whole app;
 *   3. every unused invite to this camp THEY minted is revoked — stamped used,
 *      exactly as `revokeInvite` does it. Invites are bearer tokens: a co-lead
 *      who kept one of their own links could otherwise redeem it the moment
 *      they were archived and walk straight back in. Lead-transfer links are
 *      included. The schema records who MINTED an invite, never who it was
 *      addressed to, so the creator is the only link to them there is;
 *   4. their PENDING org questionnaires that reached them through their role
 *      in THIS camp are waived too ({@link waiveOrgActionsReachedThroughCamp});
 *   5. their camp SHIFT spots are freed, and hand-on requests made to them
 *      are cancelled (epic #57) — a spot is a commitment the camp has to
 *      refill, not history;
 *   6. the audit row.
 *
 * Nothing else is touched: roles held, logistics, answers already given and
 * the audit trail are the camp's history.
 */
export async function archiveMember(input: {
  actorUserId: string;
  groupId: string;
  membershipId: string;
}): Promise<MemberArchiveResult> {
  const decided = await decide("archive", input);
  if (!decided.ok) return decided;
  const { target } = decided;

  return withTransaction(async (tx): Promise<MemberArchiveResult> => {
    const now = new Date();
    const archived = await tx
      .update(schema.memberships)
      .set({ archivedAt: now, archivedByUserId: input.actorUserId })
      .where(
        and(
          eq(schema.memberships.id, target.id),
          eq(schema.memberships.groupId, input.groupId),
          eq(schema.memberships.role, target.role),
          isNull(schema.memberships.archivedAt),
        ),
      )
      .returning({ id: schema.memberships.id });
    if (!archived[0]) return { ok: false, error: STALE };

    const waived = await tx
      .update(schema.requiredActions)
      .set({ status: "waived" })
      .where(
        and(
          eq(schema.requiredActions.userId, target.userId),
          eq(schema.requiredActions.status, "pending"),
          inArray(
            schema.requiredActions.activationId,
            tx
              .select({ id: schema.questionnaireActivations.id })
              .from(schema.questionnaireActivations)
              .where(
                eq(schema.questionnaireActivations.groupId, input.groupId),
              ),
          ),
        ),
      )
      .returning({ id: schema.requiredActions.id });

    const revoked = await tx
      .update(schema.invites)
      .set({ usedAt: now })
      .where(
        and(
          eq(schema.invites.groupId, input.groupId),
          eq(schema.invites.createdByUserId, target.userId),
          isNull(schema.invites.usedAt),
        ),
      )
      .returning({ id: schema.invites.id });

    const waivedOrg = await waiveOrgActionsReachedThroughCamp(tx, {
      userId: target.userId,
      membershipId: target.id,
    });

    // 5. CAMP SHIFTS (epic #57). A shift spot is a future commitment, not
    //    history: a former member's spots go back to the camp, and any
    //    hand-on request made TO them is cancelled (the holder keeps it).
    const freedShifts = await tx
      .delete(schema.shiftAssignments)
      .where(eq(schema.shiftAssignments.membershipId, target.id))
      .returning({ id: schema.shiftAssignments.id });
    await tx
      .update(schema.shiftAssignments)
      .set({ handoverToMembershipId: null })
      .where(eq(schema.shiftAssignments.handoverToMembershipId, target.id));

    await tx.insert(schema.auditEvents).values({
      actorId: input.actorUserId,
      action: MEMBER_ARCHIVE_AUDIT_ACTION,
      subject: target.userId,
      meta: {
        groupId: input.groupId,
        membershipId: target.id,
        role: target.role,
        waivedQuestionnaires: waived.length,
        waivedOrgQuestionnaires: waivedOrg,
        revokedInvites: revoked.length,
        freedShiftSpots: freedShifts.length,
      },
    });
    return { ok: true };
  });
}

/**
 * Waive the archived person's PENDING org questionnaires that reached them
 * BECAUSE of their role in this camp (decided 2026-09-28). Runs inside the
 * archive transaction, after the row is archived; returns how many it waived.
 *
 * `required_actions` records the activation, not the membership an audience
 * found the person through, so the reason is re-derived: the decision is
 * @quagga/core `orgActionsLostByArchive` — resolve each camp-role audience
 * (`org_outbound`, `org_officer`) for this person with and without this
 * membership, and waive only where the archive is what took them out. Org
 * forms sent to all burners, to the org or to suppliers are never loaded; a
 * co-lead of another registered camp keeps a "registered camp leads" form.
 *
 * Only THIS person's rows are loaded — every camp-role selector is a predicate
 * over one membership (or one bio), so a context narrowed to them resolves
 * them exactly as the full edition context would.
 */
async function waiveOrgActionsReachedThroughCamp(
  tx: Tx,
  where: { userId: string; membershipId: string },
): Promise<number> {
  const pending = await tx
    .select({
      id: schema.requiredActions.id,
      editionId: schema.requiredActions.editionId,
      audience: schema.questionnaireActivations.audience,
    })
    .from(schema.requiredActions)
    .innerJoin(
      schema.questionnaireActivations,
      eq(
        schema.questionnaireActivations.id,
        schema.requiredActions.activationId,
      ),
    )
    .where(
      and(
        eq(schema.requiredActions.userId, where.userId),
        eq(schema.requiredActions.status, "pending"),
        // Org-authored: a camp's own activations carry its group id.
        isNull(schema.questionnaireActivations.groupId),
        inArray(
          sql<string>`${schema.questionnaireActivations.audience}->>'kind'`,
          [...CAMP_ROLE_ORG_AUDIENCE_KINDS],
        ),
      ),
    );
  if (pending.length === 0) return 0;

  // former members: their CURRENT memberships plus the one archived a moment
  // ago in this transaction — the "before" side of the comparison.
  const memberships = await tx
    .select({
      membershipId: schema.memberships.id,
      userId: schema.memberships.userId,
      groupId: schema.memberships.groupId,
      role: schema.memberships.role,
      kind: schema.groups.kind,
    })
    .from(schema.memberships)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.memberships.groupId))
    .where(
      and(
        eq(schema.memberships.userId, where.userId),
        or(activeMembership(), eq(schema.memberships.id, where.membershipId)),
      ),
    );
  if (memberships.length === 0) return 0;
  const groupIds = [...new Set(memberships.map((m) => m.groupId))];
  const membershipIds = memberships.map((m) => m.membershipId);

  const registrations = await tx
    .select({
      groupId: schema.registrations.groupId,
      editionId: schema.registrations.editionId,
      status: schema.registrations.status,
      grantsInterest: schema.registrations.grantsInterest,
    })
    .from(schema.registrations)
    .where(inArray(schema.registrations.groupId, groupIds));
  const bios = await tx
    .select({
      userId: schema.burnerBios.userId,
      editionId: schema.burnerBios.editionId,
    })
    .from(schema.burnerBios)
    .where(eq(schema.burnerBios.userId, where.userId));
  const roleAssignments = await tx
    .select({
      membershipId: schema.memberRoleAssignments.membershipId,
      projectRoleId: schema.memberRoleAssignments.projectRoleId,
      consent: schema.memberRoleAssignments.consentStatus,
    })
    .from(schema.memberRoleAssignments)
    .where(inArray(schema.memberRoleAssignments.membershipId, membershipIds));
  const projectRoles = await tx
    .select({
      id: schema.projectRoles.id,
      groupId: schema.projectRoles.groupId,
      kind: schema.projectRoles.kind,
      officerKey: schema.projectRoles.officerKey,
    })
    .from(schema.projectRoles)
    .where(inArray(schema.projectRoles.groupId, groupIds));

  const lost = orgActionsLostByArchive(
    where.userId,
    where.membershipId,
    pending,
    {
      // Overridden per action (each carries the edition it is owed for).
      editionId: "",
      // No camp-role audience reads the org group.
      orgGroupId: "",
      memberships: memberships.map((m) => ({
        membershipId: m.membershipId,
        userId: m.userId,
        groupId: m.groupId,
        role: m.role,
      })),
      groups: memberships.map((m) => ({ id: m.groupId, kind: m.kind })),
      registrations,
      bios,
      roleAssignments,
      projectRoles: projectRoles.map((r) => ({
        id: r.id,
        groupId: r.groupId,
        kind: r.kind,
        officerKey: (r.officerKey as OfficerKey | null) ?? null,
      })),
    },
  );
  if (lost.length === 0) return 0;

  const waived = await tx
    .update(schema.requiredActions)
    .set({ status: "waived" })
    .where(
      and(
        inArray(schema.requiredActions.id, lost),
        eq(schema.requiredActions.status, "pending"),
      ),
    )
    .returning({ id: schema.requiredActions.id });
  return waived.length;
}

/** What the restore audit keeps of each assignment once the row is gone. */
export interface DroppedRoleAssignment {
  projectRoleId: string;
  consentStatus: string;
  orgVisible: boolean;
}

/**
 * A restored member comes back WITHOUT the custom project roles they held
 * (decided 2026-09-28). Called inside BOTH restore transactions — the roster's
 * {@link restoreMember} and an invite redeemed by a former member — after the
 * row is active again.
 *
 * WHY DELETE, AND WHY AT RESTORE. `member_role_assignments` has no "no longer
 * held" state: removing a role is a DELETE everywhere else (`setMemberRoles`,
 * `unassignOfficer`). Doing it at RESTORE rather than at archive keeps the
 * roles on the "Former members" roster for as long as the person is former —
 * that list is the camp's history of them — and the rows removed are written
 * into the restore's audit row, so what they held is never lost. Officer rows
 * go with them: an officer's consent (and `org_visible`, the one channel that
 * shares a phone with the org) must be given afresh, never silently revived.
 */
export async function dropRoleAssignmentsOnRestore(
  tx: Tx,
  where: { userId: string; groupId: string },
): Promise<DroppedRoleAssignment[]> {
  return tx
    .delete(schema.memberRoleAssignments)
    .where(
      inArray(
        schema.memberRoleAssignments.membershipId,
        tx
          .select({ id: schema.memberships.id })
          .from(schema.memberships)
          .where(
            and(
              eq(schema.memberships.userId, where.userId),
              eq(schema.memberships.groupId, where.groupId),
              // Restored earlier in this same transaction, so active now.
              activeMembership(),
            ),
          ),
      ),
    )
    .returning({
      projectRoleId: schema.memberRoleAssignments.projectRoleId,
      consentStatus: schema.memberRoleAssignments.consentStatus,
      orgVisible: schema.memberRoleAssignments.orgVisible,
    });
}

/**
 * Clear any camp SHIFT state still keyed to a membership that is being
 * restored (epic #57, review M1) — {@link restoreMember} and an invite redeemed
 * by a former member, after the row is active again, in the same transaction.
 *
 * The archive already frees their spots and cancels requests made to them, so
 * normally this deletes nothing. It exists because every shift read ignores a
 * former member's rows: anything written for them around the archive (an
 * assignment that raced it, before the store locked the target) would sit
 * invisible while they were former and then come BACK on restore — a spot on
 * a shift that may have been refilled since (over capacity), or a request the
 * holder long forgot. A restored member starts with no shifts, like a new one.
 */
export async function clearShiftsOnRestore(
  tx: Tx,
  where: { userId: string; groupId: string },
): Promise<void> {
  const restored = tx
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.userId, where.userId),
        eq(schema.memberships.groupId, where.groupId),
        // Restored earlier in this same transaction, so active now.
        activeMembership(),
      ),
    );
  await tx
    .delete(schema.shiftAssignments)
    .where(inArray(schema.shiftAssignments.membershipId, restored));
  await tx
    .update(schema.shiftAssignments)
    .set({ handoverToMembershipId: null })
    .where(inArray(schema.shiftAssignments.handoverToMembershipId, restored));
}

/**
 * Restore a former member to the camp — the mirror of {@link archiveMember},
 * with the same authority. The SAME row comes back (same ref code, same
 * history) but as a plain `member` holding no custom project roles: what they
 * held before is not the restorer's to hand back (decided 2026-09-28). The
 * lead re-promotes them deliberately if that is wanted. Questionnaires waived
 * at archive stay waived (the camp can send them again); nothing is re-sent
 * behind the lead's back.
 */
export async function restoreMember(input: {
  actorUserId: string;
  groupId: string;
  membershipId: string;
}): Promise<MemberArchiveResult> {
  const decided = await decide("restore", input);
  if (!decided.ok) return decided;
  const { target } = decided;

  return withTransaction(async (tx): Promise<MemberArchiveResult> => {
    const restored = await tx
      .update(schema.memberships)
      .set({ archivedAt: null, archivedByUserId: null, role: "member" })
      .where(
        and(
          eq(schema.memberships.id, target.id),
          eq(schema.memberships.groupId, input.groupId),
          eq(schema.memberships.role, target.role),
          isNotNull(schema.memberships.archivedAt),
        ),
      )
      .returning({ id: schema.memberships.id });
    if (!restored[0]) return { ok: false, error: STALE };

    const dropped = await dropRoleAssignmentsOnRestore(tx, {
      userId: target.userId,
      groupId: input.groupId,
    });
    await clearShiftsOnRestore(tx, {
      userId: target.userId,
      groupId: input.groupId,
    });

    await tx.insert(schema.auditEvents).values({
      actorId: input.actorUserId,
      action: MEMBER_RESTORE_AUDIT_ACTION,
      subject: target.userId,
      meta: {
        groupId: input.groupId,
        membershipId: target.id,
        previousRole: target.role,
        role: "member",
        droppedRoleAssignments: dropped,
        via: "restore",
      },
    });
    return { ok: true };
  });
}
