import "server-only";

import type { ReactNode } from "react";
import { resolveSupplierSession, type SupplierSession } from "@/lib/session";
import { GateScreen } from "@/components/gate-screen";

/**
 * Page-level guard. Resolves the portal session and, when the caller has not
 * resolved into a supplier, returns a ready-to-render gate node so the page can
 * short-circuit BEFORE fetching any data. Every gated page starts with:
 *
 *   const guard = await guardPortal();
 *   if (!guard.ok) return guard.node;
 *   const { session } = guard;
 */
export async function guardPortal(): Promise<
  { ok: true; session: SupplierSession } | { ok: false; node: ReactNode }
> {
  const state = await resolveSupplierSession();
  if (state.kind === "ok") {
    const { kind: _kind, ...session } = state;
    void _kind;
    return { ok: true, session };
  }
  return { ok: false, node: <GateScreen state={state} /> };
}
