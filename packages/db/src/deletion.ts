// The sign-in cancellation of a pending account deletion.
//
// WHY THIS LIVES IN @quagga/db AND NOT IN AN APP: the promise the product makes
// is "you have 14 days to change your mind — just sign in". A sign-in can happen
// in ANY of the three apps, so the cancellation has to hang off the one thing
// they share: the Better Auth session-create hook, which is configured in
// @quagga/auth. That package cannot import from apps/web, so the logic sits
// here, one level below both, and apps/web's server action delegates to it. One
// implementation, one behaviour, no way for the two to drift.
//
// HISTORY (audit B1, 27 Jul 2026): this promise was false for the entire life of
// the feature. `cancelDeletionOnSignInFor` existed in apps/web, documented
// itself as "the sign-in hook: coming back cancels a running deletion", and had
// exactly ONE caller — the explicit Cancel button, on a page reachable only by
// typing the URL. Nothing ran on sign-in. A burner who did exactly what four
// separate strings told them to do was irreversibly erased on day 14.

import { and, desc, eq } from "drizzle-orm";
import {
  canCancelDeletion,
  deletionCancelledNotification,
} from "@quagga/core";
import { createHttpDb, createPooledDb } from "./index";
import * as schema from "./schema";

export interface CancelDeletionResult {
  /** True only when a pending request actually moved to `cancelled`. */
  cancelled: boolean;
  /** The account's email, so the caller can send the confirmation mail. */
  email: string | null;
}

const NOT_CANCELLED: CancelDeletionResult = { cancelled: false, email: null };

/**
 * Cancel a pending deletion for `userId`. Safe to call on EVERY sign-in: it
 * no-ops when there is nothing pending, and it never throws — a failure here
 * must never block someone signing in.
 *
 * A request whose grace has ALREADY elapsed is deliberately not rescued:
 * `canCancelDeletion` refuses it, so a late login cannot race the sanitization
 * sweeper into an ambiguous half-deleted state.
 *
 * @param via  Recorded in the audit row: how the cancellation was triggered.
 */
export async function cancelPendingDeletion(input: {
  userId: string;
  via: "sign_in" | "explicit";
  now?: Date;
  /** Request context for the security_events row, when the caller has it. */
  context?: { ip: string | null; userAgent: string | null };
}): Promise<CancelDeletionResult> {
  const { userId, via, context } = input;
  const now = input.now ?? new Date();
  if (!process.env.DATABASE_URL) return NOT_CANCELLED;

  try {
    const db = createHttpDb();

    const [request] = await db
      .select({
        id: schema.accountDeletionRequests.id,
        status: schema.accountDeletionRequests.status,
        requestedAt: schema.accountDeletionRequests.requestedAt,
        graceEndsAt: schema.accountDeletionRequests.graceEndsAt,
        cancelledAt: schema.accountDeletionRequests.cancelledAt,
        completedAt: schema.accountDeletionRequests.completedAt,
      })
      .from(schema.accountDeletionRequests)
      .where(
        and(
          eq(schema.accountDeletionRequests.userId, userId),
          eq(schema.accountDeletionRequests.status, "pending"),
        ),
      )
      .orderBy(desc(schema.accountDeletionRequests.requestedAt))
      .limit(1);

    if (!request || !canCancelDeletion(request, now)) return NOT_CANCELLED;

    // Cancel + audit atomically: a cancelled deletion must never exist without
    // the record of it, and an audit line must never claim a cancel that did
    // not persist. The status predicate in the WHERE makes the update itself
    // the concurrency guard — two simultaneous sign-ins cannot double-cancel.
    const { db: pooled, pool } = createPooledDb();
    let applied = false;
    try {
      applied = await pooled.transaction(async (tx) => {
        const updated = await tx
          .update(schema.accountDeletionRequests)
          .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
          .where(
            and(
              eq(schema.accountDeletionRequests.id, request.id),
              eq(schema.accountDeletionRequests.status, "pending"),
            ),
          )
          .returning({ id: schema.accountDeletionRequests.id });

        if (updated.length === 0) return false;

        await tx.insert(schema.auditEvents).values({
          actorId: userId,
          action: "account.deletion_cancelled",
          subject: userId,
          meta: { via },
        });
        return true;
      });
    } finally {
      await pool.end();
    }

    if (!applied) return NOT_CANCELLED;

    const [account] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    // Inbox row + security-event row are both best-effort: the cancellation has
    // already committed and must not be rolled back over a log write.
    const payload = deletionCancelledNotification();
    try {
      await db.insert(schema.notifications).values({
        userId,
        kind: payload.kind,
        title: payload.title,
        body: payload.body ?? null,
        link: payload.link ?? null,
      });
    } catch {
      // The change happened; the inbox row is a courtesy.
    }
    try {
      await db.insert(schema.securityEvents).values({
        userId,
        kind: "deletion_cancelled",
        ip: context?.ip ?? null,
        userAgent: context?.userAgent ?? null,
      });
    } catch {
      // Same: a record, never a gate.
    }

    return { cancelled: true, email: account?.email ?? null };
  } catch (err) {
    // Never break a sign-in over this. Loud, because a burner who believed the
    // promise and was not rescued is a data-loss event, not a warning.
    console.error("[deletion] sign-in cancellation failed", err);
    return NOT_CANCELLED;
  }
}
