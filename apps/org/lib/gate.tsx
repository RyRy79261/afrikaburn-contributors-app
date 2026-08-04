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
 *
 * AND IT ASKS THE ORG-WIDE QUESTION — `orgCan`, deliberately never
 * `orgCanInDomain`. A department does not decide which SCREENS open: any org
 * member may see any non-personal part of the console, which is transparency
 * with restrictions rather than a console that hides its own existence from
 * colleagues. What a department confines is personal information — withheld at
 * the query by `canReadPersonalInformationIn`, per screen, so a Suppliers lead
 * never receives a theme camp's medical notes — and the verbs, which every
 * server action names together with the domain it is acting on
 * (`requireOrgSession({ capability, domain })`). So this gate is "have you been
 * given anything at all?", asked once, and never "does your department own this
 * page?".
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
 * The half-finished-grant screen: they can sign in, and nothing they hold opens
 * anything. Kept inside the console chrome deliberately — they ARE staff, and
 * the header tells them who to ask. Silence here would look like a broken
 * console instead of an unfinished grant.
 *
 * TWO DIFFERENT STATES, AND TELLING THEM APART IS THE POINT. This used to say
 * "no org roles yet" to everyone it stopped — including accounts that hold
 * roles which simply do not carry `read`. The console header renders directly
 * above this card and lists those roles BY NAME (`ConsoleHeader`, for every
 * rank but god), so the screen and the chrome contradicted each other on one
 * viewport and the reader's only safe conclusion was that one of them was
 * lying. Worse, it sent them to ask for the wrong thing: another role, when
 * what they need is `read` added to one they already hold.
 *
 * The refusal sentence itself stays `orgCapabilityRefusal` — the same words the
 * server would refuse them with, rather than a second copy of the explanation
 * kept in sync by hand.
 */
function NoRolesScreen({ session }: { session: OrgSession }) {
  const held = session.actor.roles.map((r) => r.name);
  const list =
    held.length === 0
      ? ""
      : held.length === 1
        ? (held[0] as string)
        : `${held.slice(0, -1).join(", ")} and ${held[held.length - 1]}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden />
          {held.length === 0
            ? "You have console access, but no org roles yet"
            : "You have console access, and no role that opens anything yet"}
        </CardTitle>
        <CardDescription>
          {orgCapabilityRefusal(session.actor, "read")}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {held.length === 0 ? (
          <>
            Roles are what decide which parts of the console open — reviewing
            registrations, vetting suppliers, seeing members&apos; details.
            Until one is assigned there is genuinely nothing here for you, which
            is why this page is empty rather than pretending otherwise.
          </>
        ) : (
          <>
            You hold {list}, which the header above lists too —{" "}
            {held.length === 1 ? "it grants" : "between them they grant"} no
            reading of the console, so every screen would be empty. Reading is a
            right on the role itself, so what you need is that right added to{" "}
            {held.length === 1 ? "that role" : "one of those roles"} rather than
            another role on top of {held.length === 1 ? "it" : "them"}.
          </>
        )}
      </CardContent>
    </Card>
  );
}
