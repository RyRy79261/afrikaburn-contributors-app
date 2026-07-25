import { NextResponse } from "next/server";

// Unread-notification email DIGEST — DESIGN STUB (docs/notifications-spec.md
// §Email). In-app notifications are the source of truth (offline law); the
// digest is a once-a-day courtesy nudge, NOT the delivery mechanism. Immediate
// email is handled inline in the two hooks that warrant it (registration
// decisions + blocking questionnaires — see @quagga/core shouldSendImmediateEmail).
//
// INTENDED DESIGN (not wired — no cron infra yet, deliberately):
//   1. A scheduled trigger (Vercel Cron / Inngest, TBD — see docs/build-spec.md
//      "Platform/database separation") hits this route once daily with a shared
//      secret in `Authorization`.
//   2. For each user with >=1 unread notification whose last digest was >24h ago
//      (max 1/day), collect the unread set, render a single summary email, and
//      send it via the Resend seam (apps/web/lib/email.ts — a no-op that logs
//      when RESEND_API_KEY is unset, so this stays env-less-safe).
//   3. Record a per-user "last digested at" marker to enforce the 1/day cap.
//      (No column exists yet; add append-only when the cron lands.)
//
// Until the cron + secret + marker land, this route intentionally does NOTHING
// that sends mail: it returns a 200 describing its own status so a smoke test /
// future cron wiring has a live endpoint to target. It never blocks boot and
// needs no env.

export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json({
    ok: true,
    job: "notifications.digest",
    status: "stub",
    scheduled: false,
    message:
      "Digest job is a design stub — no cron infra wired yet. In-app is the source of truth; immediate email covers registration decisions + blocking questionnaires.",
  });
}
