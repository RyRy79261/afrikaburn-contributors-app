import "server-only";

import type { ReactNode } from "react";
import { KeyRound } from "lucide-react";
import { orgCan, orgCapabilityRefusal } from "@quagga/core";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
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
 *
 * TWO GATES, not one. Clearing the door (`memberships.role`) gets an account
 * into the console shell; holding `read` — which comes from the ORG ROLES
 * assigned to it — is what lets a page load anything. Since org roles v1 an
 * account can hold the first and not the second, and that is the correct
 * fail-closed state for a grant that is half finished.
 *
 * It is stopped HERE rather than on thirty pages for the same reason the
 * capability matrix has one home: a new console page cannot forget the check,
 * because it cannot render without calling this.
 */
export async function guardConsole(): Promise<
  { ok: true; session: OrgSession } | { ok: false; node: ReactNode }
> {
  const state = await resolveOrgSession();
  if (state.kind === "ok") {
    const { kind: _kind, ...session } = state;
    void _kind;
    if (!orgCan(session.actor, "read")) {
      return { ok: false, node: <NoRolesScreen session={session} /> };
    }
    return { ok: true, session };
  }
  return { ok: false, node: <GateScreen state={state} /> };
}

/**
 * The half-finished-grant screen: they can sign in, and nothing has been said
 * about what they may do. Kept inside the console chrome deliberately — they ARE
 * staff, they just have no roles yet, and the header tells them who to ask.
 * Silence here would look like a broken console instead of an unfinished grant.
 */
function NoRolesScreen({ session }: { session: OrgSession }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden />
          You have console access, but no org roles yet
        </CardTitle>
        <CardDescription>
          {orgCapabilityRefusal(session.actor, "read")}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Roles are what decide which parts of the console open — reviewing
        registrations, vetting suppliers, seeing members&apos; details. Until one
        is assigned there is genuinely nothing here for you, which is why this
        page is empty rather than pretending otherwise.
      </CardContent>
    </Card>
  );
}
