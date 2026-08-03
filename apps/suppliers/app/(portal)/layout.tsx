import { ReportLauncher } from "@quagga/ui/components/report-launcher";

import { resolveSupplierSession } from "@/lib/session";
import { GateScreen } from "@/components/gate-screen";
import { PortalHeader } from "@/components/portal-header";

// Reads the session cookie on every request; cannot be statically prerendered.
export const dynamic = "force-dynamic";

/**
 * The gated portal shell. When the visitor hasn't resolved into a supplier we
 * render the full-screen gate (no chrome); otherwise the sage-accented header
 * wraps every portal page. Individual pages re-guard before fetching data, so
 * an unresolved request never triggers a query.
 */
export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const state = await resolveSupplierSession();
  if (state.kind !== "ok") {
    // Kept ON THE GATE for anyone the session could identify: "the portal
    // won't recognise my company" is a report, and the gate screen is the one
    // place it can be filed from. `lib/report-viewer.ts` accepts the same
    // states.
    return (
      <>
        <GateScreen state={state} />
        {state.kind !== "unauthenticated" && <ReportLauncher />}
      </>
    );
  }

  const { kind: _kind, ...session } = state;
  void _kind;

  return (
    <div className="min-h-svh">
      <PortalHeader session={session} />
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        {children}
      </div>
      <ReportLauncher />
    </div>
  );
}
