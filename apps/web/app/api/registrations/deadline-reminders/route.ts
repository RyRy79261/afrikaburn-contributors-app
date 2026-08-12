import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

import {
  dueReminderMilestone,
  registrationDeadlineNotification,
  reminderMarkerSubject,
  REMINDABLE_STATUSES,
  REMINDER_AUDIT_ACTION,
  shouldSendImmediateEmail,
} from "@quagga/core";

import { db, schema, withTransaction } from "@/lib/db";
import { isDatabaseConfigured } from "@/lib/config";
import { sendEmail } from "@/lib/email";

// Registration deadline reminders (roadmap R1: "reminder/deadline jobs").
//
// Once a day, this asks one question: is today exactly 21, 7 or 1 days before
// the active edition's registration close date? On the other 362 days it does
// nothing and says so. When it is, every camp still holding an unsubmitted
// registration hears about it once.
//
// NOT INNGEST. The roadmap made the async runtime conditional on the workload
// justifying it. One query a day over one table, sending at most three
// notifications per camp per season, does not.
//
// NOTHING SCHEDULES THIS YET, deliberately (Ryan, 12 Aug 2026: no Vercel cron
// jobs). The route exists, is authorised, and is idempotent — but it fires only
// when something calls it. Wire it to a scheduler when you want it live:
//
//   · a Vercel Cron entry in `apps/web/vercel.json` (daily is enough), or
//   · any external scheduler issuing
//     `GET /api/registrations/deadline-reminders` with the bearer below.
//
// Until then this is a manually-triggerable job, and camps hear nothing. That is
// the safe default: the active edition has no registration close date set yet, so
// even a scheduled run would correctly do nothing.
//
// AUTHORISATION mirrors the deletion sweep: a bearer token matching
// REGISTRATION_REMINDER_SECRET or CRON_SECRET. This job is not destructive, but
// an open endpoint that mails every camp lead is still a spam cannon, so it fails
// closed the same way.

export const dynamic = "force-dynamic";

/** The presented `Authorization: Bearer …` token, or "". */
function presentedToken(request: NextRequest): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

/** Timing-safe equality of the presented token against a configured secret. */
function tokenMatches(presented: string, secret: string | undefined): boolean {
  if (!secret) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorised(request: NextRequest): boolean {
  const presented = presentedToken(request);
  return (
    tokenMatches(presented, process.env.REGISTRATION_REMINDER_SECRET) ||
    tokenMatches(presented, process.env.CRON_SECRET)
  );
}

interface RunSummary {
  ok: boolean;
  job: "registration.deadline_reminders";
  status: string;
  milestone?: number;
  camps?: number;
  notified?: number;
}

async function runReminders(now: Date): Promise<NextResponse> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json<RunSummary>(
      {
        ok: false,
        job: "registration.deadline_reminders",
        status: "no_database",
      },
      { status: 503 },
    );
  }

  const [edition] = await db()
    .select({
      id: schema.editions.id,
      year: schema.editions.year,
      closesAt: schema.editions.registrationClosesAt,
    })
    .from(schema.editions)
    .where(eq(schema.editions.isActive, true))
    .limit(1);

  if (!edition) {
    return NextResponse.json<RunSummary>({
      ok: true,
      job: "registration.deadline_reminders",
      status: "no_active_edition",
    });
  }

  // Null close date = "no deadline set, remind nobody". The 2027 opening date is
  // still an open blocker owned by AfrikaBurn; counting down to a date nobody
  // has decided would have camps planning around an invented deadline.
  const milestone = dueReminderMilestone(edition.closesAt, now);
  if (milestone === null) {
    return NextResponse.json<RunSummary>({
      ok: true,
      job: "registration.deadline_reminders",
      status: edition.closesAt ? "not_a_milestone_today" : "no_close_date",
    });
  }

  // IDEMPOTENCE, ENFORCED BY THE DATABASE. Cron delivery is at-least-once and a
  // retry after a partial failure is normal, so "read the marker, then send"
  // is not enough: two concurrent invocations both pass that read and every camp
  // lead hears it twice.
  //
  // So the marker is CLAIMED rather than checked. The partial unique index from
  // migration 0030 makes this insert the arbiter — whoever lands it is the
  // sender, and the loser gets no row back and stops before writing a single
  // notification. Check and claim are one operation.
  const marker = reminderMarkerSubject(edition.id, milestone);
  const claim = await db()
    .insert(schema.auditEvents)
    .values({
      action: REMINDER_AUDIT_ACTION,
      subject: marker,
      meta: { milestone, claimedAt: new Date().toISOString() },
    })
    // `where` is the INDEX PREDICATE, which is what lets Postgres match the
    // partial unique index from migration 0030 as the arbiter. Without it there
    // is no unique constraint covering (action, subject) and the conflict clause
    // would have nothing to infer.
    .onConflictDoNothing({
      target: [schema.auditEvents.action, schema.auditEvents.subject],
      where: eq(schema.auditEvents.action, REMINDER_AUDIT_ACTION),
    })
    .returning({ id: schema.auditEvents.id });

  if (claim.length === 0) {
    return NextResponse.json<RunSummary>({
      ok: true,
      job: "registration.deadline_reminders",
      status: "already_sent",
      milestone,
    });
  }
  const markerId = claim[0]!.id;

  const camps = await db()
    .select({
      registrationId: schema.registrations.id,
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

  if (camps.length === 0) {
    // The marker is already claimed above, so a retry does not re-scan and
    // re-decide. Just record what the run found.
    await db()
      .update(schema.auditEvents)
      .set({ meta: { milestone, camps: 0, notified: 0 } })
      .where(eq(schema.auditEvents.id, markerId));
    return NextResponse.json<RunSummary>({
      ok: true,
      job: "registration.deadline_reminders",
      status: "nobody_to_remind",
      milestone,
      camps: 0,
      notified: 0,
    });
  }

  // Leads and admins only — the people who can actually submit the thing.
  const leads = await db()
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

  const leadsByGroup = new Map<string, { userId: string; email: string | null }[]>();
  for (const lead of leads) {
    const list = leadsByGroup.get(lead.groupId) ?? [];
    list.push({ userId: lead.userId, email: lead.email });
    leadsByGroup.set(lead.groupId, list);
  }

  const notificationRows: (typeof schema.notifications.$inferInsert)[] = [];
  const emails: { to: string; subject: string; text: string }[] = [];

  for (const camp of camps) {
    const recipients = leadsByGroup.get(camp.groupId) ?? [];
    if (recipients.length === 0) continue;

    const payload = registrationDeadlineNotification({
      campName: camp.campName,
      campSlug: camp.campSlug,
      daysRemaining: milestone,
      changesRequested: camp.status === "changes_requested",
    });

    for (const recipient of recipients) {
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

  await withTransaction(async (tx) => {
    if (notificationRows.length > 0) {
      await tx.insert(schema.notifications).values(notificationRows);
    }
    // The marker row already exists — it was the claim. Fill in what the run
    // actually did, rather than inserting a second row for the same send.
    await tx
      .update(schema.auditEvents)
      .set({
        meta: {
          milestone,
          camps: camps.length,
          notified: notificationRows.length,
        },
      })
      .where(eq(schema.auditEvents.id, markerId));
  });

  // Email is best-effort and AFTER the commit: a mail failure must not roll back
  // the marker and cause every camp to be notified twice tomorrow.
  for (const email of emails) {
    try {
      await sendEmail(email);
    } catch (err) {
      console.error("[reminders] deadline email failed", err);
    }
  }

  return NextResponse.json<RunSummary>({
    ok: true,
    job: "registration.deadline_reminders",
    status: "sent",
    milestone,
    camps: camps.length,
    notified: notificationRows.length,
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorised(request)) {
    return NextResponse.json<RunSummary>(
      {
        ok: false,
        job: "registration.deadline_reminders",
        status: "unauthorised",
      },
      { status: 401 },
    );
  }
  return runReminders(new Date());
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return GET(request);
}
