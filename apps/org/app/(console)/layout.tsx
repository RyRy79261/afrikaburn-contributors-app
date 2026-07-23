import { resolveOrgSession } from "@/lib/session";
import { GateScreen } from "@/components/gate-screen";
import { ConsoleHeader } from "@/components/console-header";

// Reads the session cookie on every request; cannot be statically prerendered.
export const dynamic = "force-dynamic";

/**
 * The gated console shell. When the visitor has not cleared the gate we render
 * the full-screen gate (no chrome); otherwise the ochre-accented header wraps
 * every console page. Individual pages re-guard before fetching data, so a
 * forbidden request never triggers a query.
 */
export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const state = await resolveOrgSession();
  if (state.kind !== "ok") return <GateScreen state={state} />;

  const { kind: _kind, ...session } = state;
  void _kind;

  return (
    <div className="min-h-svh">
      <ConsoleHeader session={session} />
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        {children}
      </div>
    </div>
  );
}
