import "server-only";

import { and, eq, inArray, lte, sql } from "drizzle-orm";
import {
  assessDeletionEligibility,
  buildSanitizationPlan,
  deletionCompletedEmail,
  isSanitizationDue,
} from "@quagga/core";

import { buildDeletionGuardContext } from "@/lib/account";
import { db, schema, withTransaction } from "@/lib/db";
import { isDatabaseConfigured } from "@/lib/config";
import { sendEmail } from "@/lib/email";

// The sanitization runner — the business end of account deletion
// (docs/accounts-security-spec.md §Deletion, the Camp 404 "Lost Cat" precedent).
//
// This is the ONLY place application rows are erased, and it never deletes our
// own `users` row (it survives as the "Departed Burner" stub). It DOES hard-delete
// the Better Auth IDENTITY (user/account/session) — that is the POPIA erasure.
// @quagga/core `buildSanitizationPlan` decides WHAT to erase; this module applies
// it, and records that it happened.
//
// ATOMICITY: every erasure write runs inside ONE pooled transaction, so a
// partial POPIA erasure is impossible — either the identity + bios + secrets are
// all gone and the tombstone is stamped, or nothing changed and the request
// stays `pending` for the next sweep. ORDERING still matters WITHIN the
// transaction (foreign keys, and the tombstone-last invariant):
//   1. capture the address to notify + the auth_user_id BEFORE the transaction
//      (after the erasure the email is gone; the auth_user_id is needed to delete
//      the identity);
//   2. purge the secrets/context tables (profile keys, in-flight email-change
//      tokens, security events);
//   3. patch every `burner_bios` row for the account;
//   4. HARD-DELETE the Better Auth identity — sessions, then credential/OAuth
//      accounts, then the user row (email PII). This signs the account out
//      everywhere and destroys the password hash, so a "deleted" account can
//      neither sign in with its password nor ride a lingering cookie;
//   5. patch the `users` row LAST — `sanitized_at` is the tombstone, committed in
//      the same transaction as the erasure it attests to. `auth_user_id` is left
//      unchanged so the tombstone stays findable by the session resolvers. A
//      crash mid-way rolls the whole transaction back, leaving the request
//      `pending`; the sweep simply runs again (every step is also idempotent, so
//      a re-run is harmless).
//
// Note what is NOT here: no delete of memberships, questionnaire responses,
// required actions, supplier acks, or audit events. Preserving those is the
// entire point — the cascade would be the damage.
//
// What IS here, since 31 Jul 2026: the three things this account was holding ON
// BEHALF OF OTHERS are released — a claimed supplier listing, any wrangler
// assignment, and console access. Each of those foreign keys is declared
// `ON DELETE SET NULL` in the schema precisely so losing a person leaves the
// thing VACANT rather than broken, and NONE of them could ever fire, because
// keeping the `users` row is the whole design. The cascade the schema was
// relying on had to be written out by hand.

export interface SanitizationOutcome {
  ok: boolean;
  userId: string;
  bioRows: number;
  membershipsPreserved: number;
  /** Whether the farewell email was dispatched (false when Resend is unset). */
  notified: boolean;
  error?: string;
}

/**
 * Sanitize one account against its due deletion request. Re-checks that the
 * request is genuinely `due` before touching anything: a cancelled request or
 * one still inside its grace period must never be processed, whatever the caller
 * believed when it queued the work.
 */
export async function sanitizeAccount(
  userId: string,
  requestId: string,
  now: Date = new Date(),
): Promise<SanitizationOutcome> {
  const base: SanitizationOutcome = {
    ok: false,
    userId,
    bioRows: 0,
    membershipsPreserved: 0,
    notified: false,
  };
  if (!isDatabaseConfigured()) {
    return { ...base, error: "Database is not configured." };
  }

  const handle = db();

  const [request] = await handle
    .select({
      status: schema.accountDeletionRequests.status,
      requestedAt: schema.accountDeletionRequests.requestedAt,
      graceEndsAt: schema.accountDeletionRequests.graceEndsAt,
      cancelledAt: schema.accountDeletionRequests.cancelledAt,
      completedAt: schema.accountDeletionRequests.completedAt,
    })
    .from(schema.accountDeletionRequests)
    .where(
      and(
        eq(schema.accountDeletionRequests.id, requestId),
        eq(schema.accountDeletionRequests.userId, userId),
      ),
    )
    .limit(1);

  if (!request) return { ...base, error: "Deletion request not found." };
  if (!isSanitizationDue(request, now)) {
    return {
      ...base,
      error:
        "That deletion request isn't due — it's cancelled, already done, or still inside its grace period.",
    };
  }

  // 0. RE-CHECK THE ANTI-LOCKOUT GUARD, AT THE MOMENT OF ERASURE.
  //
  //    Eligibility was assessed once, when the request was CREATED
  //    (account-actions.ts), and nothing re-asked before this point. That is a
  //    hole the tombstone filters alone do not close, because the property is
  //    about the FINAL state, not about the state on the day someone clicked:
  //
  //      Two System managers, A and B. On day 0 A requests deletion — B is live,
  //      so the count is 2 and it is allowed. On day 1 B requests deletion — A
  //      is still live (the grace period has not elapsed, nothing is sanitized
  //      yet), so the count is still 2 and that is allowed too. On day 14 the
  //      sweeper erases both. Zero live System managers, and no screen can grant
  //      `god` back — the console deliberately forbids it, so the way back is an
  //      env change to GOD_EMAILS plus a fresh sign-up.
  //
  //    The same argument applies one level down to a camp's last live lead.
  //
  //    This hole predates the tombstone fix and is not caused by it; the fix
  //    narrows it (the sequential case is now blocked) but only a check HERE can
  //    close it, because only here is the outcome final.
  //
  //    A caught account is LEFT PENDING rather than failed or force-deleted: the
  //    request stays, the grace period has already elapsed so the next sweep
  //    retries, and the moment someone else is granted `god` or made a camp lead
  //    it proceeds on its own. Erasing anyway would strand the deployment;
  //    cancelling the request would silently overturn a person's erasure
  //    decision, which is theirs and not ours.
  const guard = await buildDeletionGuardContext(userId);
  const eligibility = assessDeletionEligibility({
    ...guard,
    // The sign-in-method count is irrelevant now — that guard exists so nobody
    // deletes an account they can no longer prove is theirs, and they already
    // proved it when they asked. Re-applying it here would strand every
    // request whose last social link happened to be revoked in the meantime.
    signInMethodCount: 1,
  });
  if (!eligibility.ok) {
    return {
      ...base,
      error: `Still blocked at sanitization time, so nothing was erased: ${eligibility.blocks
        .map((b) => b.message)
        .join(" ")}`,
    };
  }

  // 1. Capture what we need BEFORE erasing it.
  const [user] = await handle
    .select({
      email: schema.users.email,
      authUserId: schema.users.authUserId,
      sanitizedAt: schema.users.sanitizedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) return { ...base, error: "Account not found." };

  const farewellAddress = user.email;

  const [{ memberships } = { memberships: 0 }] = await handle
    .select({ memberships: sql<number>`count(*)::int` })
    .from(schema.memberships)
    .where(eq(schema.memberships.userId, userId));

  const [{ bios } = { bios: 0 }] = await handle
    .select({ bios: sql<number>`count(*)::int` })
    .from(schema.burnerBios)
    .where(eq(schema.burnerBios.userId, userId));

  const plan = buildSanitizationPlan({
    userId,
    at: now,
    bioCount: Number(bios),
    membershipCount: Number(memberships),
  });

  // Steps 2–5 + the request/audit writes all commit as ONE transaction, so the
  // POPIA erasure is all-or-nothing. Ordering within it still follows the notes
  // above (foreign keys; tombstone last).
  await withTransaction(async (tx) => {
    // 2. Purge the secrets-and-context tables. Nothing references these rows.
    //    `security_events` holds captured IP/user-agent (personal data), so it is
    //    erased with the account (plan.purgedTables).
    await tx
      .delete(schema.profileKeys)
      .where(eq(schema.profileKeys.userId, userId));
    await tx
      .delete(schema.emailChangeRequests)
      .where(eq(schema.emailChangeRequests.userId, userId));
    await tx
      .delete(schema.securityEvents)
      .where(eq(schema.securityEvents.userId, userId));

    // 3. Erase every bio row (one per edition). The plan's patch nulls all
    //    personal columns including the hard-locked classes, and replaces the
    //    display name with the "Departed Burner" stub.
    await tx
      .update(schema.burnerBios)
      .set(plan.bio)
      .where(eq(schema.burnerBios.userId, userId));

    // 4. HARD-DELETE the Better Auth identity (plan.identityTables): the live
    //    sessions (revokes every cookie — the account is signed out everywhere),
    //    the credential/OAuth `account` rows (the password hash goes, so the old
    //    password can never authenticate again), and finally the `user` row (its
    //    email PII). Without this the identity layer keeps the person's email,
    //    password and valid session tokens forever — the POPIA erasure failure
    //    this whole plan exists to prevent, and the door through which a "deleted"
    //    account could sign straight back in. Deleting `user` alone would cascade
    //    (FK onDelete: cascade), but we delete all three explicitly and in order
    //    so the erasure is unambiguous. This runs BEFORE the tombstone (step 5)
    //    so the tombstone only ever marks an erasure that has actually happened.
    await tx
      .delete(schema.session)
      .where(eq(schema.session.userId, user.authUserId));
    await tx
      .delete(schema.account)
      .where(eq(schema.account.userId, user.authUserId));
    await tx.delete(schema.user).where(eq(schema.user.id, user.authUserId));

    // 5. The users row LAST — the tombstone only lands once erasure is real.
    //    `authUserId` is left unchanged (plan.user does not touch it) so the row
    //    stays findable by the session resolvers' `where authUserId = …` lookup:
    //    that is what lets `assertNotSanitized` fire instead of the resolver
    //    minting a fresh account (the re-animation hole).
    await tx
      .update(schema.users)
      .set(plan.user)
      .where(eq(schema.users.id, userId));

    await tx
      .update(schema.accountDeletionRequests)
      .set({ status: "completed", completedAt: now, updatedAt: now })
      .where(eq(schema.accountDeletionRequests.id, requestId));

    // 6. RELEASE WHAT THE ACCOUNT WAS HOLDING ON BEHALF OF OTHERS.
    //
    //    Three foreign keys in this schema are declared `ON DELETE SET NULL`
    //    precisely so that losing a person leaves the thing they held VACANT
    //    rather than broken. None of them ever fired, because sanitization
    //    keeps the `users` row on purpose — so the cascade the schema was
    //    relying on is a cascade that can never happen here, and it has to be
    //    done by hand:
    //
    //      · `suppliers.user_id` — a deleted supplier contact left the listing
    //        claimed by a tombstone forever. `resolveSupplierForUser` could
    //        then neither match the same human's NEW account (different uuid)
    //        nor re-link by email overlap (the row is not unclaimed), so they
    //        landed in `kind: 'unlinked'` permanently while the org console
    //        showed the supplier as account-linked. Only a manual UPDATE fixed
    //        it. Ryan, 31 Jul 2026: release it so the business can be claimed
    //        again — the listing and its history stay, the link does not.
    //
    //      · `wrangler_assignments.wrangler_user_id` — schema.ts says "the
    //        board shows it vacant, which is a thing someone has to act on".
    //        It did not: the camp kept a non-null wrangler rendering as
    //        "Departed Burner", and the `(group, edition)` unique index still
    //        read as filled, so the board never flagged the camp as needing a
    //        new guardian angel.
    //
    //      · `org_role_assignments` — console access outliving the account.
    //        Revoked below with the membership demotion.
    const releasedSuppliers = await tx
      .update(schema.suppliers)
      .set({ userId: null, updatedAt: now })
      .where(eq(schema.suppliers.userId, userId))
      .returning({ id: schema.suppliers.id });
    const releasedSupplierIds = releasedSuppliers.map((r) => r.id);

    const vacatedWranglers = await tx
      .update(schema.wranglerAssignments)
      .set({ wranglerUserId: null, updatedAt: now })
      .where(eq(schema.wranglerAssignments.wranglerUserId, userId))
      .returning({ groupId: schema.wranglerAssignments.groupId });
    const vacatedWranglerGroupIds = vacatedWranglers.map((r) => r.groupId);

    // 7. REVOKE CONSOLE ACCESS.
    //
    //    An `org_staff` or `engineer` account could self-delete with no guard
    //    and no warning, and its org membership plus every `org_role_assignments`
    //    row survived — a live access grant pointing at a dead account. Worse,
    //    the console could not clean it up: `searchAccounts` matches on email
    //    and username, both NULL on a tombstone, so the row was findable only
    //    in the unfiltered 50-newest listing.
    //
    //    The membership row itself STAYS (like every other membership — the
    //    history is the point) but is demoted to `member`, which is the rank
    //    that grants nothing.
    //    `org_role_assignments` is keyed by MEMBERSHIP, not by user, so the
    //    memberships have to be resolved first.
    const orgMemberships = await tx
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .innerJoin(
        schema.groups,
        eq(schema.groups.id, schema.memberships.groupId),
      )
      .where(
        and(
          eq(schema.memberships.userId, userId),
          eq(schema.groups.kind, "org"),
        ),
      );
    const orgMembershipIds = orgMemberships.map((m) => m.id);
    let releasedOrgRoleIds: string[] = [];
    if (orgMembershipIds.length > 0) {
      const revoked = await tx
        .delete(schema.orgRoleAssignments)
        .where(
          inArray(schema.orgRoleAssignments.membershipId, orgMembershipIds),
        )
        .returning({ orgRoleId: schema.orgRoleAssignments.orgRoleId });
      releasedOrgRoleIds = revoked.map((r) => r.orgRoleId);
      await tx
        .update(schema.memberships)
        .set({ role: "member" })
        .where(inArray(schema.memberships.id, orgMembershipIds));
    }

    // 8. Strip PII out of the AUDIT TRAIL without destroying it.
    //
    //    The trail itself is deliberately preserved — it is the record of what
    //    this account did, keyed by our internal id, and POPIA erasure does not
    //    require forgetting that an actor existed. But some writers put the
    //    person's EMAIL ADDRESS in `meta` (the god-bootstrap rows in
    //    lib/session.ts do, and the supplier overlap rows do), and that address
    //    survived erasure verbatim — 32 such rows on the live database at the
    //    time this was found — while the farewell email told them nothing
    //    identifying remained. Drop just those keys; the row, its action, its
    //    timestamp and its internal ids all stay.
    await tx.execute(sql`
      UPDATE audit_events
         SET meta = meta - 'email' - 'contactEmail' - 'primaryEmail'
       WHERE (actor_id = ${userId} OR subject = ${userId})
         AND meta IS NOT NULL
         AND (meta ? 'email' OR meta ? 'contactEmail' OR meta ? 'primaryEmail')
    `);

    // WHAT WAS RELEASED, recorded so it can be reconstructed.
    //
    // An earlier version of this block asserted in a comment that the releases
    // above were "audited by the row written below". They were not:
    // `plan.audit.meta` is built by @quagga/core BEFORE the transaction and
    // carries only {reason, bioRows, membershipsPreserved, stub}. So a staffer's
    // org roles were hard-deleted with no record of WHICH roles, a supplier
    // listing lost the only trace it had ever been claimed, and a wrangler
    // assignment was vacated without the `wrangler.unassign` event the console's
    // own control writes for exactly that change.
    //
    // A System manager asking "who held what before they left?" deserves an
    // answer. Ids only — no email, no name — so recording it does not undo the
    // erasure it records.
    if (
      releasedOrgRoleIds.length > 0 ||
      releasedSupplierIds.length > 0 ||
      vacatedWranglerGroupIds.length > 0
    ) {
      await tx.insert(schema.auditEvents).values({
        actorId: userId,
        action: "account.released_holdings",
        subject: userId,
        meta: {
          orgRoleIds: releasedOrgRoleIds,
          supplierIds: releasedSupplierIds,
          wranglerGroupIds: vacatedWranglerGroupIds,
          reason: "account sanitization",
        },
      });
    }

    // The proof that erasure happened. Names no personal data — only our internal
    // id and counts — so recording it does not undo what it records.
    await tx.insert(schema.auditEvents).values({
      actorId: userId,
      action: plan.audit.action,
      subject: plan.audit.subject,
      meta: plan.audit.meta,
    });
  });

  // The last message this address will ever get from us.
  let notified = false;
  if (farewellAddress) {
    const mail = deletionCompletedEmail();
    const sent = await sendEmail({
      to: farewellAddress,
      subject: mail.subject,
      text: mail.text,
    });
    notified = sent.ok && sent.delivered;
  }

  return {
    ok: true,
    userId,
    bioRows: Number(bios),
    membershipsPreserved: Number(memberships),
    notified,
  };
}

/**
 * Find every deletion request whose grace period has elapsed and sanitize it.
 * Called by an operator or a scheduled route — deliberately NOT wired into a
 * build step or app boot (the no-migrate-in-build discipline applies to
 * destructive maintenance too).
 *
 * `limit` caps a single sweep so a large backlog can't blow a serverless
 * timeout; the next run picks up the rest.
 */
export async function sweepDueDeletions(
  now: Date = new Date(),
  limit = 50,
): Promise<SanitizationOutcome[]> {
  if (!isDatabaseConfigured()) return [];

  const due = await db()
    .select({
      id: schema.accountDeletionRequests.id,
      userId: schema.accountDeletionRequests.userId,
    })
    .from(schema.accountDeletionRequests)
    .where(
      and(
        eq(schema.accountDeletionRequests.status, "pending"),
        lte(schema.accountDeletionRequests.graceEndsAt, now),
      ),
    )
    .limit(limit);

  const results: SanitizationOutcome[] = [];
  for (const row of due) {
    try {
      results.push(await sanitizeAccount(row.userId, row.id, now));
    } catch (err) {
      results.push({
        ok: false,
        userId: row.userId,
        bioRows: 0,
        membershipsPreserved: 0,
        notified: false,
        error: err instanceof Error ? err.message : "Sanitization failed.",
      });
    }
  }
  return results;
}
