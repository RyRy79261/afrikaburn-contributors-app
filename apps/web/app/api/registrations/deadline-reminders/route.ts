import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

import {
  runDeadlineReminders,
  type DeadlineReminderOutcome,
} from "@/lib/deadline-reminders";

// Registration deadline reminders (roadmap R1: "reminder/deadline jobs").
//
// Once a day, this asks one question: is today exactly 21, 7 or 1 days before
// the active edition's registration close date? On the other days it does
// nothing and says so. When it is, every camp still holding an unsubmitted
// registration hears about it once.
//
// THIS FILE ONLY AUTHORISES. The job itself — and the reason the claim and the
// send share one transaction — is `lib/deadline-reminders.ts`.
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

const JOB = "registration.deadline_reminders" as const;

type RunSummary = {
  ok: boolean;
  job: typeof JOB;
  status: DeadlineReminderOutcome["status"] | "unauthorised";
} & Omit<DeadlineReminderOutcome, "status">;

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

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorised(request)) {
    return NextResponse.json<RunSummary>(
      { ok: false, job: JOB, status: "unauthorised" },
      { status: 401 },
    );
  }

  const outcome = await runDeadlineReminders(new Date());
  if (outcome.status === "no_database") {
    return NextResponse.json<RunSummary>(
      { ok: false, job: JOB, ...outcome },
      { status: 503 },
    );
  }
  return NextResponse.json<RunSummary>({ ok: true, job: JOB, ...outcome });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return GET(request);
}
