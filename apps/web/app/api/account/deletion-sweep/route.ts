import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { sweepDueDeletions } from "@/lib/account-sanitize";
import { isDatabaseConfigured } from "@/lib/config";

// The deletion sweeper (docs/accounts-security-spec.md §Deletion). Finds every
// deletion request whose 14-day grace period has elapsed and SANITIZES the
// account — anonymize to a "Departed Burner" stub, preserving memberships,
// questionnaire responses and audit history.
//
// WHY A ROUTE AND NOT A BUILD STEP OR BOOT HOOK. This is the most destructive
// operation in the system. It must be triggered deliberately, by a scheduler or
// an operator, never as a side effect of deploying — the same discipline that
// keeps migrations out of the build (AGENTS.md §Hard engineering rules 1).
//
// AUTHORISATION. Requires `ACCOUNT_SWEEP_SECRET` as a bearer token. When the
// secret is UNSET the route refuses to do anything and says so: an unauthenticated
// endpoint that erases accounts is not a thing that should exist even briefly, and
// failing closed here costs nothing (nothing is erased until someone configures
// it). This keeps the env-less boot rule intact — the route exists, responds, and
// declines.
//
// HOW IT IS TRIGGERED. A Vercel Cron entry (apps/web/vercel.json) hits this path
// daily. Vercel Cron can only issue GET requests and authenticates them by
// injecting `Authorization: Bearer $CRON_SECRET` (only when CRON_SECRET is set).
// So a GET that carries a bearer matching CRON_SECRET *or* ACCOUNT_SWEEP_SECRET
// runs the sweep; every other GET stays status-only and erases nothing. POST is
// unchanged (operator/manual trigger with the ACCOUNT_SWEEP_SECRET bearer). The
// refusal behaviour is intact end-to-end: no configured secret ⇒ no sweep, and an
// unauthenticated caller (GET or POST) never erases anything.

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

/** Authorised to run the sweep (manual POST or Vercel cron GET). Accepts the
 * ACCOUNT_SWEEP_SECRET bearer, and — for cron — the CRON_SECRET bearer Vercel
 * injects. Either way ACCOUNT_SWEEP_SECRET must be configured (checked before). */
function authorisedToSweep(request: NextRequest): boolean {
  const presented = presentedToken(request);
  return (
    tokenMatches(presented, process.env.ACCOUNT_SWEEP_SECRET) ||
    tokenMatches(presented, process.env.CRON_SECRET)
  );
}

/** Run the sweep and shape the response (shared by POST and cron GET). */
async function runSweep(): Promise<NextResponse> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, job: "account.deletion_sweep", status: "no_database" },
      { status: 503 },
    );
  }
  const results = await sweepDueDeletions();
  const failed = results
    .filter((r) => !r.ok)
    .map((r) => ({ userId: r.userId, error: r.error }));

  // A FAILED ERASURE IS NOT A SUCCESSFUL RUN. This used to answer 200 `ok:true`
  // with the failures tucked in the body and nothing written to the log — so a
  // POPIA erasure that had been failing every night for a fortnight looked
  // exactly like a healthy cron entry in the Vercel dashboard. Log each failure,
  // and answer 500 so the scheduler's own alerting sees it.
  for (const f of failed) {
    console.error(
      `[deletion-sweep] sanitization FAILED for user ${f.userId}: ${f.error}`,
    );
  }
  if (failed.length > 0) {
    console.error(
      `[deletion-sweep] ${failed.length} of ${results.length} due deletions did not complete`,
    );
  }

  return NextResponse.json(
    {
      ok: failed.length === 0,
      job: "account.deletion_sweep",
      processed: results.length,
      sanitized: results.filter((r) => r.ok).length,
      failed,
    },
    { status: failed.length > 0 ? 500 : 200 },
  );
}

const DISABLED_RESPONSE = {
  ok: false,
  job: "account.deletion_sweep",
  status: "disabled",
  message:
    "ACCOUNT_SWEEP_SECRET is not set. The sweeper refuses to run unauthenticated — nothing was erased.",
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
  return runSweep();
}

/**
 * GET is the Vercel Cron entry point. A GET carrying a valid cron bearer
 * (CRON_SECRET, or ACCOUNT_SWEEP_SECRET) runs the sweep exactly like POST; any
 * other GET reports status only and never erases anything. When
 * ACCOUNT_SWEEP_SECRET is unset the sweeper stays disabled regardless.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!process.env.ACCOUNT_SWEEP_SECRET) {
    // Never sweep without the secret; report the disabled status truthfully.
    return NextResponse.json({
      ok: true,
      job: "account.deletion_sweep",
      enabled: false,
      method: "POST with `Authorization: Bearer $ACCOUNT_SWEEP_SECRET`",
    });
  }
  if (authorisedToSweep(request)) {
    return runSweep();
  }
  // Unauthenticated status probe — enabled, but nothing is erased.
  return NextResponse.json({
    ok: true,
    job: "account.deletion_sweep",
    enabled: true,
    method: "POST with `Authorization: Bearer $ACCOUNT_SWEEP_SECRET`",
  });
}
