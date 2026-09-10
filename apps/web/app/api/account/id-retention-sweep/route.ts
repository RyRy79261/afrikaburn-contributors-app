import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { sweepExpiredIdDocuments } from "@/lib/id-retention-sweep";
import { isDatabaseConfigured } from "@/lib/config";

// The ID-retention purge (docs/accounts-security-spec.md §"ID document — lawful
// purpose + retention"). Finds every bio whose edition ended more than
// ID_RETENTION_GRACE_DAYS ago and nulls its SA ID / passport ciphertext.
//
// WHY THIS EXISTS NOW. `packages/core/src/id-retention.ts` has owned the rule
// since July and states in its header that the job applying it is "a LATER
// task"; `packages/db/src/schema.ts` repeats that above the columns. The rule
// had unit tests and no caller, while this branch adds ID fields to the
// carry-forward set — so an identity document propagates into every new edition
// and nothing ever removes it. A storage-limitation control that is written,
// tested and never invoked is not a control.
//
// SHAPE COPIED FROM `../deletion-sweep`, deliberately. That route is the house
// pattern for a destructive scheduled job: a route rather than a build step so
// it is triggered on purpose and never as a side effect of deploying; bearer
// auth compared in constant time; DISABLED when the secret is unset, because an
// unauthenticated endpoint that erases identity documents should not exist even
// briefly; GET for Vercel Cron (which can only issue GET, and injects
// CRON_SECRET), POST for an operator; an unauthenticated GET reports status and
// erases nothing; and a partial failure answers 500 so the scheduler's alerting
// sees it rather than a green cron entry hiding a fortnight of failures.
//
// IT SHARES `ACCOUNT_SWEEP_SECRET` with the deletion sweeper rather than adding
// a third secret: same blast radius, same operator, same runbook. One fewer
// value to configure is one fewer way to leave a privacy job switched off.

export const dynamic = "force-dynamic";

const JOB = "bio.id_retention_purge";

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

/** Authorised to run the purge (manual POST or Vercel cron GET). */
function authorisedToSweep(request: NextRequest): boolean {
  const presented = presentedToken(request);
  return (
    tokenMatches(presented, process.env.ACCOUNT_SWEEP_SECRET) ||
    tokenMatches(presented, process.env.CRON_SECRET)
  );
}

/** Run the purge and shape the response (shared by POST and cron GET). */
async function runPurge(): Promise<NextResponse> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, job: JOB, status: "no_database" },
      { status: 503 },
    );
  }

  const result = await sweepExpiredIdDocuments();

  // A FAILED PURGE IS NOT A SUCCESSFUL RUN — same reasoning as the deletion
  // sweeper. Identity documents that should have been erased and were not is
  // exactly the state that must not look healthy on a dashboard.
  if (result.failures.length > 0) {
    console.error(
      `[id-retention-sweep] ${result.failures.length} of ${result.identified} bios were not purged: ${result.failures[0]?.error ?? "unknown"}`,
    );
  }

  return NextResponse.json(
    {
      ok: result.failures.length === 0,
      job: JOB,
      identified: result.identified,
      purged: result.purged,
      editions: result.editionIds.length,
      failed: result.failures.length,
    },
    { status: result.failures.length > 0 ? 500 : 200 },
  );
}

const DISABLED_RESPONSE = {
  ok: false,
  job: JOB,
  status: "disabled",
  message:
    "ACCOUNT_SWEEP_SECRET is not set. The ID-retention purge refuses to run unauthenticated — nothing was erased.",
} as const;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!process.env.ACCOUNT_SWEEP_SECRET) {
    return NextResponse.json(DISABLED_RESPONSE, { status: 503 });
  }
  if (!authorisedToSweep(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorised" },
      { status: 401 },
    );
  }
  return runPurge();
}

/**
 * GET is the Vercel Cron entry point. A GET carrying a valid cron bearer runs
 * the purge exactly like POST; any other GET reports status only and erases
 * nothing. The status probe deliberately touches NO database: an endpoint that
 * anyone can call should not issue queries, and the backlog is already reported
 * as `identified` on an authorised run.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!process.env.ACCOUNT_SWEEP_SECRET) {
    return NextResponse.json({
      ok: true,
      job: JOB,
      enabled: false,
      method: "POST with `Authorization: Bearer $ACCOUNT_SWEEP_SECRET`",
    });
  }
  if (authorisedToSweep(request)) {
    return runPurge();
  }
  return NextResponse.json({
    ok: true,
    job: JOB,
    enabled: true,
    method: "POST with `Authorization: Bearer $ACCOUNT_SWEEP_SECRET`",
  });
}
