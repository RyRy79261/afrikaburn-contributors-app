import { resolveOrgSession } from "@/lib/session";
import { GateScreen } from "@/components/gate-screen";
import { ConsoleHeader } from "@/components/console-header";
import { ConsoleGate } from "@/components/questionnaire/console-gate";
import { getConsoleBlockingQuestionnaire } from "@/lib/questionnaires/queries";

// Reads the session cookie on every request; cannot be statically prerendered.
export const dynamic = "force-dynamic";

/**
 * The gated console shell. When the visitor has not cleared the gate we render
 * the full-screen gate (no chrome); otherwise the ochre-accented header wraps
 * every console page. Individual pages re-guard before fetching data, so a
 * forbidden request never triggers a query.
 *
 * A pending BLOCKING org-internal questionnaire is a HARD gate: it replaces the
 * whole console (only the fill view + sign-out reachable) until the staff member
 * submits — the participant-app blocking-gate pattern, applied to the console.
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

  const gate = await getConsoleBlockingQuestionnaire(session.dbUserId);
  if (gate) {
    return (
      <ConsoleGate
        activationId={gate.activationId}
        title={gate.title}
        description={gate.description}
        questionnaire={gate.questionnaire}
        initialResponses={gate.existingResponses}
      />
    );
  }

  return (
    <div className="min-h-svh">
      <ConsoleHeader session={session} />
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        {children}
      </div>
    </div>
  );
}
