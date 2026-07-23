import "server-only";

import type { ReactNode } from "react";
import { resolveOrgSession, type OrgSession } from "@/lib/session";
import { GateScreen } from "@/components/gate-screen";

/**
 * Page-level guard. Resolves the console session and, when the caller has not
 * cleared the gate, returns a ready-to-render gate node so the page can
 * short-circuit BEFORE fetching any data. Every console page starts with:
 *
 *   const guard = await guardConsole();
 *   if (!guard.ok) return guard.node;
 *   const { session } = guard;
 */
export async function guardConsole(): Promise<
  { ok: true; session: OrgSession } | { ok: false; node: ReactNode }
> {
  const state = await resolveOrgSession();
  if (state.kind === "ok") {
    const { kind: _kind, ...session } = state;
    void _kind;
    return { ok: true, session };
  }
  return { ok: false, node: <GateScreen state={state} /> };
}
