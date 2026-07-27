import "server-only";

import { and, eq, lte, sql } from "drizzle-orm";
import {
  buildSanitizationPlan,
  deletionCompletedEmail,
  isSanitizationDue,
} from "@quagga/core";

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

    // 6. Strip PII out of the AUDIT TRAIL without destroying it.
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
