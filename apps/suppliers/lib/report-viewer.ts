import type { ReportViewer } from "@quagga/core/report-server";

import { resolveSupplierSession } from "@/lib/session";

/**
 * Who may file a report from the supplier portal, and under what id.
 *
 * `unlinked` counts. A supplier whose account did not match a company row sees
 * only the registration form, and "the portal doesn't recognise me" is a report
 * worth having rather than one to lock out. Only an unauthenticated caller is
 * refused.
 *
 * The id is our `users.id` where the session resolved one, and the auth
 * provider's id otherwise — for the rate-limit key and the audit line, neither
 * of which is published.
 */
export async function reportViewer(): Promise<ReportViewer | null> {
  const state = await resolveSupplierSession();
  if (state.kind === "unauthenticated") return null;
  if (state.kind === "ok" || state.kind === "unlinked") {
    return { id: state.dbUserId };
  }
  return { id: state.user.id };
}
