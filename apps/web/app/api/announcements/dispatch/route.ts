import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { isDatabaseConfigured } from "@/lib/config";
import { dispatchDueCampAnnouncements } from "@/lib/announcements-store";

// Scheduled camp announcements (epic #56) — the dispatch step.
//
// THIS FILE ONLY AUTHORISES. The job — claim each due announcement with a
// compare-and-set on `dispatched_at IS NULL`, re-check the sender's permission
// under lock, fan out in the same transaction — is
// `dispatchDueCampAnnouncements` in lib/announcements-store.ts. Idempotent: an
// overlapping or repeated run claims nothing twice, and the partial unique
// (bulletin_id, user_id) index makes every delivery insert a no-op on retry.
//
// NOT SCHEDULED BY THIS CHANGE. Nothing in apps/web/vercel.json calls it yet —
// adding a cron entry is a deployment decision (plan limits on cron frequency,
// and the Aug 2026 "no Vercel cron jobs" note in the deadline-reminder route).
// Until something calls it, a scheduled announcement stays published-but-
// undelivered; immediate announcements are unaffected (they fan out inline).
// Wire it the same way as the deadline reminders:
//
//   · a Vercel Cron entry in `apps/web/vercel.json`, or
//   · any scheduler issuing `GET /api/announcements/dispatch` with the bearer.
//
// AUTHORISATION mirrors the other jobs: a bearer matching
// ANNOUNCEMENT_DISPATCH_SECRET or CRON_SECRET. Not destructive, but an open
// endpoint that fans messages out to camps is still not one to leave open, so
// it fails closed.

export const dynamic = "force-dynamic";

const JOB = "announcements.dispatch" as const;

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
    tokenMatches(presented, process.env.ANNOUNCEMENT_DISPATCH_SECRET) ||
    tokenMatches(presented, process.env.CRON_SECRET)
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorised(request)) {
    return NextResponse.json(
      { ok: false, job: JOB, status: "unauthorised" },
      { status: 401 },
    );
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, job: JOB, status: "no_database" },
      { status: 503 },
    );
  }
  const summary = await dispatchDueCampAnnouncements(new Date());
  // A failed delivery is not a successful run: log each one (ids only — the
  // message is the database's own words, never the query text), and answer 500
  // so the scheduler's alerting sees it. The failed ones stay due.
  for (const f of summary.failures) {
    console.error(
      `[announcements.dispatch] ${f.bulletinId} failed: ${f.error}`,
    );
  }
  const ok = summary.failures.length === 0;
  return NextResponse.json(
    { ok, job: JOB, status: "ran", ...summary },
    { status: ok ? 200 : 500 },
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return GET(request);
}
