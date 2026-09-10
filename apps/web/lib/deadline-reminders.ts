import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import {
  dueReminderMilestone,
  registrationDeadlineNotification,
  reminderMarkerSubject,
  REMINDABLE_STATUSES,
  REMINDER_AUDIT_ACTION,
  shouldSendImmediateEmail,
} from "@quagga/core";

import { db, isDatabaseConfigured, schema, withTransaction } from "./db";
import { sendEmail } from "./email";

// Registration deadline reminders — the job behind
// `/api/registrations/deadline-reminders` (roadmap R1). The route only
// authorises; everything that touches the database lives here, where it can be
// tested. Same split as the account deletion sweep (`account-sanitize.ts`).
//
// ── ONE TRANSACTION: THE CLAIM AND THE SEND COMMIT TOGETHER ────────────────
//
// Each milestone must reach each camp once, and cron delivery is
// at-least-once. Idempotence comes from a marker row in `audit_events`: a
// partial unique index lets exactly one runner insert it.
//
// An earlier version claimed the marker in its own statement, committed it,
// and only then wrote the notifications in a second transaction. Review caught
// what that does when the second write fails: the claim is already committed,
// so every retry finds the marker, returns `already_sent`, and the camps never
// hear. One transient failure became permanent silence.
//
// So the claim and the notifications now commit or roll back as ONE unit. The
// rows are built first, outside the transaction. Inside it, the marker is
// claimed, and only a runner that won the claim writes the notifications. If
// anything in there fails, the claim rolls back with it and the next run tries
// again.
//
// Concurrency still holds. A second runner's claim waits on the first runner's
// uncommitted marker; once the first commits, the second gets no row back and
// stops before writing a single notification.

export type DeadlineReminderStatus =
  | "no_database"
  | "no_active_edition"
  | "no_close_date"
  | "not_a_milestone_today"
  | "already_sent"
  | "nobody_to_remind"
  | "sent";

export interface DeadlineReminderOutcome {
  status: DeadlineReminderStatus;
  milestone?: number;
  camps?: number;
  notified?: number;
}

/** Run the reminder job once, as of `now`. Throws if the send transaction
 * fails — and when it throws, nothing was claimed, so a retry is safe. */
export async function runDeadlineReminders(
  now: Date = new Date(),
): Promise<DeadlineReminderOutcome> {
  if (!isDatabaseConfigured()) return { status: "no_database" };

  const [edition] = await db()
    .select({
      id: schema.editions.id,
      closesAt: schema.editions.registrationClosesAt,
    })
    .from(schema.editions)
    .where(eq(schema.editions.isActive, true))
    .limit(1);
  if (!edition) return { status: "no_active_edition" };

  // Null close date = "no deadline set, remind nobody". The 2027 dates are an
  // open blocker owned by AfrikaBurn; counting down to a date nobody has
  // decided would have camps planning around an invented deadline.
  const milestone = dueReminderMilestone(edition.closesAt, now);
  if (milestone === null) {
    return {
      status: edition.closesAt ? "not_a_milestone_today" : "no_close_date",
    };
  }

  // ── Build everything first. None of this writes. ──────────────────────────

  const camps = await db()
    .select({
      status: schema.registrations.status,
      groupId: schema.registrations.groupId,
      campName: schema.groups.name,
      campSlug: schema.groups.slug,
    })
    .from(schema.registrations)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.registrations.groupId))
    .where(
      and(
        eq(schema.registrations.editionId, edition.id),
        inArray(schema.registrations.status, [...REMINDABLE_STATUSES]),
      ),
    );

  // Leads and admins only — the people who can actually submit the thing.
  const leads =
    camps.length === 0
      ? []
      : await db()
          .select({
            userId: schema.memberships.userId,
            groupId: schema.memberships.groupId,
            email: schema.users.email,
          })
          .from(schema.memberships)
          .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
          .where(
            and(
              inArray(
                schema.memberships.groupId,
                camps.map((c) => c.groupId),
              ),
              inArray(schema.memberships.role, ["lead", "admin"]),
            ),
          );

  const leadsByGroup = new Map<
    string,
    { userId: string; email: string | null }[]
  >();
  for (const lead of leads) {
    const list = leadsByGroup.get(lead.groupId) ?? [];
    list.push({ userId: lead.userId, email: lead.email });
    leadsByGroup.set(lead.groupId, list);
  }

  const notificationRows: (typeof schema.notifications.$inferInsert)[] = [];
  const emails: { to: string; subject: string; text: string }[] = [];

  for (const camp of camps) {
    const payload = registrationDeadlineNotification({
      campName: camp.campName,
      campSlug: camp.campSlug,
      daysRemaining: milestone,
      changesRequested: camp.status === "changes_requested",
    });

    for (const recipient of leadsByGroup.get(camp.groupId) ?? []) {
      notificationRows.push({
        ...payload,
        userId: recipient.userId,
        origin: "org",
        linkApp: "web",
      });
      if (recipient.email && shouldSendImmediateEmail("registration")) {
        emails.push({
          to: recipient.email,
          subject: payload.title,
          text: `${payload.title}\n\n${payload.body ?? ""}\n\nOpen the Contributors app to finish it.`,
        });
      }
    }
  }

  // ── Claim and send, as one unit. ───────────────────────────────────────────

  const marker = reminderMarkerSubject(edition.id, milestone);
  const claimed = await withTransaction(async (tx) => {
    const claim = await tx
      .insert(schema.auditEvents)
      .values({
        action: REMINDER_AUDIT_ACTION,
        subject: marker,
        meta: {
          milestone,
          camps: camps.length,
          notified: notificationRows.length,
        },
      })
      // `where` is the INDEX PREDICATE. It is what lets Postgres pick the
      // partial unique index as the arbiter; without it, no unique constraint
      // covers (action, subject) and the conflict clause has nothing to infer.
      .onConflictDoNothing({
        target: [schema.auditEvents.action, schema.auditEvents.subject],
        where: eq(schema.auditEvents.action, REMINDER_AUDIT_ACTION),
      })
      .returning({ id: schema.auditEvents.id });

    // Another runner holds this milestone. Write nothing.
    if (claim.length === 0) return false;

    if (notificationRows.length > 0) {
      await tx.insert(schema.notifications).values(notificationRows);
    }
    return true;
  });

  if (!claimed) return { status: "already_sent", milestone };

  // Email is best-effort and AFTER the commit. A mail failure must not undo a
  // send the inbox already shows — that would notify every camp twice.
  //
  // `sendEmail` reports a provider failure by RETURNING `{ ok: false }`, not by
  // throwing, so the result is checked as well as the exception. Without that,
  // a full mail outage left no trace anywhere while the job said "sent".
  // (`ok: true, delivered: false` is not a failure — it is the no-key path,
  // which email.ts already logs.)
  for (const email of emails) {
    try {
      const result = await sendEmail(email);
      if (!result.ok) {
        console.error("[reminders] deadline email failed", result.error);
      }
    } catch (err) {
      console.error("[reminders] deadline email failed", err);
    }
  }

  return {
    status: camps.length === 0 ? "nobody_to_remind" : "sent",
    milestone,
    camps: camps.length,
    notified: notificationRows.length,
  };
}
