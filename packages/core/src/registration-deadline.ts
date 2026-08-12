import type { NotificationPayload, RegistrationStatus } from "@quagga/types";

// Registration deadline reminders (roadmap R1: "reminder/deadline jobs").
//
// WHAT GETS REMINDED, AND WHAT DOES NOT. Only a camp that has started a
// registration and not yet put it in front of a reviewer — a `draft`, or a
// `changes_requested` row waiting on the camp. An approved camp has nothing to
// do; a rejected one has nothing it can do; nagging either is the platform
// generating administrative burden instead of removing it, which is the fewer-
// forms law read backwards.
//
// WHY THIS IS NOT INNGEST. The roadmap made the async runtime conditional on the
// workload justifying it ("introduce Inngest here if the async workload justifies
// it"). One query a day, over one table, sending at most three notifications per
// camp per season does not. This runs as a Vercel cron hitting a route, exactly
// like the account deletion sweep already does.

/**
 * Days before the close date that a camp hears from us. Three, spaced so the
 * first is actionable ("you have three weeks"), the second is a nudge, and the
 * last is a genuine final call.
 */
export const REMINDER_MILESTONES: readonly number[] = [21, 7, 1];

const MS_PER_DAY = 86_400_000;

/** Midnight UTC on the calendar day a timestamp falls in. */
function startOfUtcDay(value: Date | string): number {
  const date = value instanceof Date ? value : new Date(value);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
}

/**
 * Whole calendar days from `now` until `closesAt`, counted in UTC.
 *
 * CALENDAR DAYS, NOT ELAPSED HOURS. A deadline is a date on a poster, and a job
 * that fires at 03:00 must not decide that a deadline 23 hours away is "0 days"
 * on one run and "1 day" on the next. Truncating both ends to UTC midnight makes
 * the answer depend only on the two dates, which is what everybody means.
 */
export function daysUntil(closesAt: Date | string, now: Date | string): number {
  return Math.round((startOfUtcDay(closesAt) - startOfUtcDay(now)) / MS_PER_DAY);
}

/**
 * The milestone falling due today, or null on the other 362 days of the year.
 *
 * Exact equality rather than "at most", so a job that misses a day does not fire
 * every remaining milestone at once when it recovers. A missed reminder is a
 * missed reminder; three of them arriving together reads as a malfunction and
 * teaches people to ignore the channel.
 */
export function dueReminderMilestone(
  closesAt: Date | string | null | undefined,
  now: Date | string,
): number | null {
  if (closesAt === null || closesAt === undefined) return null;
  const remaining = daysUntil(closesAt, now);
  return REMINDER_MILESTONES.includes(remaining) ? remaining : null;
}

/**
 * Registration statuses that still need something from the camp. Typed as the
 * status union rather than `string[]` so a caller can pass it straight to a
 * Drizzle `inArray` against the enum column without a cast.
 */
export const REMINDABLE_STATUSES: readonly RegistrationStatus[] = [
  "draft",
  "changes_requested",
];

/** Whether a registration in this status should be reminded at all. */
export function isRemindable(status: string): boolean {
  return (REMINDABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * The audit subject that makes a send idempotent: one marker per (edition,
 * milestone).
 *
 * THE CRON IS AT-LEAST-ONCE. Vercel will happily invoke a scheduled route twice,
 * and a retry after a partial failure is a normal Tuesday. Writing this marker
 * inside the same transaction as the sends, with the job refusing to run when it
 * already exists, is what stops every camp being told twice that they have seven
 * days left.
 */
export function reminderMarkerSubject(
  editionId: string,
  milestone: number,
): string {
  return `${editionId}:deadline-${milestone}`;
}

/** The audit action paired with `reminderMarkerSubject`. */
export const REMINDER_AUDIT_ACTION = "registration.deadline_reminder";

/**
 * The notification a camp receives. `registration` kind on purpose — this is the
 * registration lane talking, and the inbox already groups it with the decision
 * and review messages the same camp is reading.
 */
export function registrationDeadlineNotification(input: {
  campName: string;
  campSlug: string;
  daysRemaining: number;
  changesRequested: boolean;
}): NotificationPayload {
  const { campName, campSlug, daysRemaining, changesRequested } = input;
  const when =
    daysRemaining === 1 ? "tomorrow" : `in ${daysRemaining} days`;

  const title = changesRequested
    ? `${campName}: AfrikaBurn is waiting on your changes — registration closes ${when}`
    : `${campName}: registration closes ${when}`;

  const body = changesRequested
    ? "Your registration went back to you for changes. It won't be reviewed again until you resubmit it."
    : "Your registration is still a draft. It has to be submitted before the deadline to be reviewed.";

  return {
    kind: "registration",
    title,
    body,
    link: `/camps/${campSlug}/registration`,
  };
}
