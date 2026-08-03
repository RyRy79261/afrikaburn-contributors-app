import { consumeRateLimit } from "@quagga/db";
import { createReportHandler } from "@quagga/core/report-server";

import { getCurrentCampUser } from "@/lib/session";

// The in-app reporter's filing endpoint for the participant app. The pipeline
// (validate → sanitize → structure → file as a PUBLIC GitHub issue labelled
// `needs-triage`) lives in @quagga/core/report-server; this file supplies the
// two things only this app knows — who is signed in, and the shared limiter.

export const runtime = "nodejs";

export const POST = createReportHandler({
  surface: "web",
  // `getCurrentCampUser` and NOT `pendingBlockingRoute`: unlike the upload
  // route, being stuck part-way through onboarding is not a reason to refuse a
  // bug report. It is frequently the bug. The gate still rejects an account the
  // app has deleted and sanitized.
  identify: async () => {
    const user = await getCurrentCampUser();
    return user ? { id: user.id } : null;
  },
  consumeRateLimit,
});
