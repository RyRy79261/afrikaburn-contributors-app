import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import {
  ORG_RANK_LABELS,
  isSystemManager,
  runsDeployment,
  runsDeploymentRefusal,
} from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";

import { guardConsole } from "@/lib/gate";
import { getOrgRoleImpacts, getOrgRolesOverview } from "@/lib/queries";
import { PageHeading } from "@/components/page-heading";
import { RolesManager } from "@/components/org-roles/roles-manager";

// ROLES AND DEPARTMENTS — the screen Ryan asked for, inside the System panel.
//
// "Maybe instead of it being super strict, system admins can simply have a roles
// management section and create n sign these things instead of needing to
// hardcode them? With some set permanent ones, like team leads and team members
// for each department domain, these cant be removed but they can have the rights
// edited." (27 Jul 2026)
//
// WHERE IT LIVES, and why here rather than a top-level nav entry: this is the
// same brief as `/system` itself — "a System management panel for IT staff and
// System manager teams to manage certain IT specific settings, security
// controls, and god level account management". Editing the permission model IS
// god-level account management, and putting it beside the auth configuration and
// the org-access roster means an investigation into "why can this person do
// that?" ends on one panel instead of two.
//
// TWO GATES, on purpose, and they are not the same gate:
//
//   · READING it needs `read_system` — the panel's own capability. An engineer
//     may look at the permission model: it is this deployment's configuration,
//     the same class of fact as the auth settings and the org-access roster they
//     already read there, and no personal information is in it.
//   · CHANGING it needs the `god` ANCHOR, never a capability, because this is
//     the surface that edits capabilities and the right to use it must not be
//     something a role can grant. Every action re-checks `requireSystemManager`
//     server-side, so the missing buttons are a courtesy and not the boundary.
//
// ONE THING IS NOT MERELY HIDDEN FROM A READER: `getOrgRoleImpacts` carries the
// EMAIL ADDRESSES of the people a deletion would strip. It is not fetched at all
// unless the viewer is a System manager, so a reader's payload does not contain
// it — an absence, not a mask (@quagga/core `org-permissions`, "WHAT PERSONAL
// INFORMATION MEANS HERE").
//
// THE FRAME EXISTS NOW: `IXwNt` (desktop) + `gsiE0` (mobile 360) in
// design/ab-initial-app.pen. Like `/system` itself this screen shipped ahead of
// its frame — a recorded exception to AGENTS.md's design-before-build rule — and
// the frame was drawn afterwards to document what shipped. It carries the states
// that are the whole point of this screen: a permanent role whose delete control
// is replaced by the REASON it is permanent, the rights checklist written as
// consequences, the department-deletion dialog naming the people it strips and
// counting the ones left with nothing, and the read-only view an engineer gets.

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;
  const { session } = guard;

  if (!runsDeployment(session.actor)) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeading
          eyebrow="Console / System / Roles"
          title="Roles and departments"
          description="Who may do what in this console."
        />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="h-4 w-4 text-muted-foreground" aria-hidden />
              Not your screen
            </CardTitle>
            <CardDescription>{runsDeploymentRefusal()}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Only a {ORG_RANK_LABELS.god.toLowerCase()} can create departments,
            edit roles or decide who holds them — that one is deliberately not
            grantable, and it is what keeps every other permission safe to edit.
            If a role of yours is missing something you need, ask one of them:
            the change lands here and is written to the audit trail.
          </CardContent>
        </Card>
      </div>
    );
  }

  // The anchor decides whether anything on this page can be CHANGED, and
  // therefore whether the people-affected data is read at all.
  // MANAGING is the System manager ANCHOR, not panel access. An engineer runs
  // the deployment and READS this panel; editing who has access and what roles
  // may do stays with the System manager, or the rail that keeps every other
  // permission safe to edit would last exactly one edit.
  const canManage = isSystemManager(session.actor);
  const [overview, impacts] = await Promise.all([
    getOrgRolesOverview(session.orgGroupId),
    canManage
      ? getOrgRoleImpacts(session.orgGroupId, session.actor)
      : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href="/system">
            <ArrowLeft aria-hidden />
            System management
          </Link>
        </Button>
        <PageHeading
          eyebrow="Console / System / Roles"
          title="Roles and departments"
          description={
            canManage
              ? "Departments are yours to create. Each arrives with a permanent lead and member role you can re-right but not remove; everything else is a role you create, name and delete freely. Who holds them is set on the Accounts screen."
              : "How this console decides what each account may do. Reading it is part of the system panel; changing it is the System manager's alone."
          }
        />
      </div>
      <RolesManager
        overview={overview}
        impacts={impacts}
        canManage={canManage}
      />
      <p className="text-sm text-muted-foreground">
        Roles are given and taken on{" "}
        <Link
          href="/accounts"
          className="font-medium text-accent underline-offset-4 hover:underline"
        >
          Accounts
        </Link>
        , which shows what each person can actually do once their roles resolve
        together.
      </p>
    </div>
  );
}
