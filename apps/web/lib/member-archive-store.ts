import "server-only";

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  canArchiveMember,
  canRestoreMember,
  MEMBER_ARCHIVE_AUDIT_ACTION,
  MEMBER_RESTORE_AUDIT_ACTION,
  memberArchiveRefusalMessage,
  type ArchiveTarget,
  type MemberArchiveDecision,
} from "@quagga/core";
import { db, schema, withTransaction } from "./db";
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
// deleted: project-role assignments, logistics, questionnaire responses and
// audit rows all stay as the camp's record of them.
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
 *   3. the audit row.
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

    await tx.insert(schema.auditEvents).values({
      actorId: input.actorUserId,
      action: MEMBER_ARCHIVE_AUDIT_ACTION,
      subject: target.userId,
      meta: {
        groupId: input.groupId,
        membershipId: target.id,
        role: target.role,
        waivedQuestionnaires: waived.length,
      },
    });
    return { ok: true };
  });
}

/**
 * Restore a former member to the camp — the mirror of {@link archiveMember},
 * with the same authority. The row comes back exactly as it was: same ref
 * code, same roles held, same history. Questionnaires waived at archive stay
 * waived (the camp can send them again); nothing is re-sent behind the lead's
 * back.
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
      .set({ archivedAt: null, archivedByUserId: null })
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

    await tx.insert(schema.auditEvents).values({
      actorId: input.actorUserId,
      action: MEMBER_RESTORE_AUDIT_ACTION,
      subject: target.userId,
      meta: {
        groupId: input.groupId,
        membershipId: target.id,
        role: target.role,
        via: "restore",
      },
    });
    return { ok: true };
  });
}
