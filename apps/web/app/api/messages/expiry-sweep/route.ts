import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { sweepExpiredMessages } from "@/lib/messages-store";
import { isDatabaseConfigured } from "@/lib/config";

// The disappearing-messages sweep (epic #69). HARD-deletes every direct
// message whose own `expires_at` has passed (the timer the participants
// chose), and every message REPORT whose fixed retention
// (@quagga/core `REPORT_COPY_RETENTION_DAYS`, 180 days) has elapsed — its
// copied messages cascade with it.
//
// The read path already filters `expires_at > now()`, so nothing expired is
// ever SHOWN between runs; this is what makes "deleted" true on disk too.
//
// SHAPE COPIED FROM `../../account/id-retention-sweep`: a route rather than a
// build step; bearer auth compared in constant time; GET for Vercel Cron
// (which injects CRON_SECRET), POST for an operator; an unauthenticated GET
// reports status and deletes nothing, and touches no database; a failure
// answers 500 so the scheduler's alerting sees it.
//
// ONE DIFFERENCE, on purpose: it runs when EITHER `ACCOUNT_SWEEP_SECRET` or
// `CRON_SECRET` is configured. The other sweeps refuse without the account
// secret because they erase things a person has not asked to lose; this one
// erases exactly what the participants asked to lose, so a deployment that
// only wired Vercel Cron should not quietly keep messages past their timer.

export const dynamic = "force-dynamic";

const JOB = "messages.expiry_sweep";

function presentedToken(request: NextRequest): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function tokenMatches(presented: string, secret: string | undefined): boolean {
  if (!secret) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function sweepEnabled(): boolean {
  return Boolean(process.env.ACCOUNT_SWEEP_SECRET || process.env.CRON_SECRET);
}

function authorisedToSweep(request: NextRequest): boolean {
  const presented = presentedToken(request);
  return (
    tokenMatches(presented, process.env.ACCOUNT_SWEEP_SECRET) ||
    tokenMatches(presented, process.env.CRON_SECRET)
  );
}

async function runSweep(): Promise<NextResponse> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, job: JOB, status: "no_database" },
      { status: 503 },
    );
  }
  try {
    const result = await sweepExpiredMessages();
    return NextResponse.json({ ok: true, job: JOB, ...result });
  } catch (err) {
    console.error(
      `[messages-expiry-sweep] failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return NextResponse.json(
      { ok: false, job: JOB, status: "failed" },
      { status: 500 },
    );
  }
}

const DISABLED_RESPONSE = {
  ok: false,
  job: JOB,
  status: "disabled",
  message:
    "Neither ACCOUNT_SWEEP_SECRET nor CRON_SECRET is set. Expired messages stay hidden from every read, but are not yet deleted from the database.",
} as const;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!sweepEnabled()) {
    return NextResponse.json(DISABLED_RESPONSE, { status: 503 });
  }
  if (!authorisedToSweep(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorised" },
      { status: 401 },
    );
  }
  return runSweep();
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (sweepEnabled() && authorisedToSweep(request)) {
    return runSweep();
  }
  return NextResponse.json({
    ok: true,
    job: JOB,
    enabled: sweepEnabled(),
    method: "POST with `Authorization: Bearer $CRON_SECRET`",
  });
}
