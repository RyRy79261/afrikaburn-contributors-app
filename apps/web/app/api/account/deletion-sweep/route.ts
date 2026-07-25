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

export const dynamic = "force-dynamic";

function authorised(request: NextRequest): boolean {
  const secret = process.env.ACCOUNT_SWEEP_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!process.env.ACCOUNT_SWEEP_SECRET) {
    return NextResponse.json(
      {
        ok: false,
        job: "account.deletion_sweep",
        status: "disabled",
        message:
          "ACCOUNT_SWEEP_SECRET is not set. The sweeper refuses to run unauthenticated — nothing was erased.",
      },
      { status: 503 },
    );
  }
  if (!authorised(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, job: "account.deletion_sweep", status: "no_database" },
      { status: 503 },
    );
  }

  const results = await sweepDueDeletions();
  return NextResponse.json({
    ok: true,
    job: "account.deletion_sweep",
    processed: results.length,
    sanitized: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).map((r) => ({ userId: r.userId, error: r.error })),
  });
}

/** GET reports status only — it never erases anything. */
export function GET(): NextResponse {
  return NextResponse.json({
    ok: true,
    job: "account.deletion_sweep",
    enabled: Boolean(process.env.ACCOUNT_SWEEP_SECRET),
    method: "POST with `Authorization: Bearer $ACCOUNT_SWEEP_SECRET`",
  });
}
