import type { ReportViewer } from "@quagga/core/report-server";

import { resolveOrgSession } from "@/lib/session";

/**
 * Who may file a report from the console, and under what id.
 *
 * Deliberately looser than the console gate itself: an account that is signed
 * in but resolves to `forbidden` or `not_ready` cannot see a single page here,
 * and "the console won't let me in" is precisely the report worth having. What
 * it is NOT is open — an unauthenticated caller gets nothing.
 *
 * The id is our `users.id` where the session got far enough to have one, and
 * the auth provider's id otherwise. It is used for the rate-limit key and the
 * audit line only; neither is published, so the two id spaces never meet on the
 * public issue.
 */
export async function reportViewer(): Promise<ReportViewer | null> {
  const state = await resolveOrgSession();
  if (state.kind === "unauthenticated") return null;
  if (state.kind === "ok") return { id: state.dbUserId };
  return { id: state.user.id };
}
