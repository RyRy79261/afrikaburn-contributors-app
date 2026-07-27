import Link from "next/link";
import {
  ArrowRight,
  IdCard,
  Lock,
  ScrollText,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import {
  ORG_RANK_LABELS,
  orgCan,
  orgCapabilityRefusal,
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
import {
  getOrgAccessRoster,
  getOrgRolesOverview,
  listAssignableOrgRoles,
  type OrgAccessRoster,
  type OrgRolesOverview,
} from "@/lib/queries";
import { getSystemStatus } from "@/lib/system-probe";
import { PageHeading } from "@/components/page-heading";
import { CheckListCard } from "@/components/system/check-list";
import {
  AccountsTable,
  type AccountTableRow,
} from "@/components/accounts-table";

// THE SYSTEM PANEL — the page you open when someone says "the app is broken".
//
// Ryan, 27 Jul 2026: "There should probably be a System management panel for IT
// staff and System manager teams to manage certain IT specific settings,
// security controls, and god level account management."
//
// It INVENTS NOTHING. Every state on this page already existed somewhere in the
// codebase, already degraded honestly, and was already invisible unless you knew
// which file to read: email verification derived off because there is no Resend
// key; uploads falling back to link-paste because there is no blob token; a
// migration that would refuse to run against a pooled endpoint; a database that
// migrated but never seeded. Each was honest in its own corner. The value here
// is putting them in one place, with the REASON attached, so an investigation
// ends on this page instead of starting a code read.
//
// WHO SEES IT: `read_system` — engineer and System manager, and nobody else.
// That is the one capability org_staff does not hold and engineer does; the
// ranks are jobs, not a ladder (@quagga/core `org-permissions`). A registration
// reviewer has no use for the migration endpoint, and putting it in front of
// them makes the console noisier for everyone.
//
// WHAT IT NEVER SHOWS: a secret. Every check reports whether a value is SET and
// what follows from that. The single deliberate exception is a database
// HOSTNAME, parsed out so a password in the connection string cannot come with
// it — "which database am I actually on" is the question this page exists to
// answer. `GOD_EMAILS` is reported as a COUNT, never as addresses: they are
// people's email addresses and an engineer never receives one of those.
//
// THE FRAME EXISTS NOW: `bNbLs` (desktop) + `qhCyJ` (mobile 360) in
// design/ab-initial-app.pen. This page shipped ahead of its frame — a recorded
// exception to AGENTS.md's design-before-build rule — and the frame was drawn
// afterwards to document what shipped rather than to redesign it, from the same
// console vocabulary this page uses (PageHeading, Card, the ResponsiveDataTable
// accounts table). The frame deliberately draws the DEGRADED states, because
// those are the ones someone opens this page to see: no Resend key, no blob
// token, a migration that would refuse to run. The exception is paid off; do not
// reopen it for the next surface.

export const dynamic = "force-dynamic";

export default async function SystemPage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;
  const { session } = guard;

  // The page's own gate, from the ONE matrix the server actions also read. A
  // refusal rather than a notFound(): a console that hides things without
  // explaining teaches nobody the rule, and "this page does not exist" is a lie
  // that costs someone an afternoon.
  if (!orgCan(session.actor, "read_system")) {
    return (
      <div>
        <PageHeading
          eyebrow="Console / System"
          title="System management"
          description="The IT surface for this deployment."
        />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="h-4 w-4 text-muted-foreground" aria-hidden />
              Not your console
            </CardTitle>
            <CardDescription>
              {orgCapabilityRefusal(session.actor, "read_system")}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Nothing here changes registrations, suppliers or camps — it is how
            the deployment itself is configured. If something on the console
            looks wrong, an {ORG_RANK_LABELS.engineer.toLowerCase()} or a{" "}
            {ORG_RANK_LABELS.god.toLowerCase()} can read this page and tell you
            what it says.
          </CardContent>
        </Card>
      </div>
    );
  }

  const canManage = orgCan(session.actor, "manage_accounts");
  const seesEmail = orgCan(session.actor, "read_personal_information");

  // The roster read is allowed to fail without taking the page with it. This is
  // the page someone opens when things are already wrong, so every panel that
  // can degrade does, rather than throwing into an error boundary that shows
  // less than nothing. (The console gate itself is database-backed, so a total
  // outage lands on the gate screen before it ever reaches here — this covers
  // the partial failures, which are the common ones.)
  const [status, roster, assignableRoles, roles] = await Promise.all([
    getSystemStatus(),
    getOrgAccessRoster(session.orgGroupId, session.actor).catch(
      (): OrgAccessRoster | null => null,
    ),
    // Same table, same controls, same reason it degrades rather than throws.
    canManage
      ? listAssignableOrgRoles().catch(() => [])
      : Promise.resolve([]),
    // Counts only — the roles surface itself lives one click away. Degrades for
    // the same reason as everything else on this page.
    getOrgRolesOverview(session.orgGroupId).catch(
      (): OrgRolesOverview | null => null,
    ),
  ]);

  const rows: AccountTableRow[] =
    roster?.members.map((m) => ({
      userId: m.userId,
      email: m.email,
      username: m.username,
      role: m.role,
      roles: m.roles.map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        departmentId: r.departmentId,
        departmentName: r.departmentName,
      })),
      capabilities: m.capabilities.map((c) => ({
        capability: c.capability,
        departments: c.departments,
      })),
    })) ?? [];

  const headlineTone = status.headline.tone;

  // Real numbers or none: a placeholder count on the page people open when
  // things are already wrong would be worse than the missing card.
  const roleCounts = roles
    ? {
        departments: roles.departments.length,
        roles:
          roles.orgWideRoles.length +
          roles.departments.reduce((n, d) => n + d.roles.length, 0),
      }
    : null;
  // Accounts that cleared the door and hold nothing — a half-finished grant,
  // visible here because nobody would otherwise go looking for it.
  const withoutRoles =
    roster?.members.filter((m) => m.role !== "god" && m.roles.length === 0)
      .length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Console / System"
        title="System management"
        description="How this deployment is configured, whether its services are answering, and who holds access to this console. Read-only except for access management."
      />

      {/* The worst thing on the page, named, at the top. A reader who stops here
          should still know whether to keep reading. */}
      <div
        className={
          headlineTone === "attention"
            ? "flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
            : "flex items-start gap-3 rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm"
        }
      >
        {headlineTone === "attention" ? (
          <TriangleAlert
            className="mt-0.5 h-4 w-4 shrink-0 text-warning"
            aria-hidden
          />
        ) : (
          <ShieldAlert
            className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        )}
        <p className="text-foreground">{status.headline.summary}</p>
      </div>

      <CheckListCard
        title="System health"
        description="Probed while this page rendered — not read back off the configuration. A variable being set and the service answering are different claims."
        checks={status.health}
      />

      <CheckListCard
        title="Security controls"
        description="What the auth stack is actually enforcing right now. Every value is derived from the same resolvers the running configuration uses, so this cannot report a rule the stack is not applying."
        checks={status.security}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Org access</CardTitle>
          <CardDescription>
            {canManage
              ? "Everyone who can get into this console, and the org roles that decide what they may do once inside. Granting and removing access is audited."
              : `Everyone who can get into this console, and the org roles they hold. ${orgCapabilityRefusal(session.actor, "manage_accounts")}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {roster === null ? (
            <p className="text-sm text-muted-foreground">
              The roster could not be read — see the database check above. The
              rest of this page does not depend on it.
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody holds org access on this deployment yet. The first{" "}
              {ORG_RANK_LABELS.god.toLowerCase()} arrives by signing in with an
              address on GOD_EMAILS; every other rank is granted by one of them.
            </p>
          ) : (
            <>
              {/* The sole-System-manager warning. Core already refuses to let the
                  last one delete their own account — nobody would be left who
                  could grant the rank back — but that guard only speaks at the
                  moment of deletion, to the one person deleting. Said here, it
                  is something the org can act on before it matters. A COUNT,
                  never a name: an engineer reads this page. */}
              {roster.systemManagerCount <= 1 && (
                <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                  <TriangleAlert
                    className="mt-0.5 h-4 w-4 shrink-0 text-warning"
                    aria-hidden
                  />
                  <span className="text-foreground">
                    {roster.systemManagerCount === 1
                      ? `There is exactly one ${ORG_RANK_LABELS.god.toLowerCase()}. They cannot delete their own account while that is true — otherwise nobody would be left who could grant the rank back — and losing access to that address would mean nobody could grant it at all. Add a second address to GOD_EMAILS.`
                      : `No ${ORG_RANK_LABELS.god.toLowerCase()} holds access here. Ranks can only be granted by one, so nobody can grant anything until an address on GOD_EMAILS signs in with a verified email.`}
                  </span>
                </p>
              )}
              <div className="md:rounded-xl md:border md:bg-card md:text-card-foreground">
                <AccountsTable
                  rows={rows}
                  canManage={canManage}
                  showEmail={seesEmail}
                  selfUserId={session.dbUserId}
                  assignableRoles={assignableRoles.map((r) => ({
                    id: r.id,
                    name: r.name,
                    color: r.color,
                    departmentId: r.departmentId,
                    departmentName: r.departmentName,
                    capabilities: r.capabilities,
                  }))}
                  caption="Org access"
                />
              </div>
            </>
          )}
          <p className="text-sm text-muted-foreground">
            This list holds only people who already have access.{" "}
            <Link
              href="/accounts"
              className="font-medium text-accent underline-offset-4 hover:underline"
            >
              Accounts
            </Link>{" "}
            searches every burner, which is where a new grant starts.
          </p>
        </CardContent>
      </Card>

      {/* THE PERMISSION MODEL ITSELF, one click away. The roster above says who
          holds what; this is where what they hold is DEFINED. Reading it is part
          of this panel (`read_system`); changing it needs the System manager
          anchor, which is stated here rather than discovered on arrival. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IdCard className="h-4 w-4 text-muted-foreground" aria-hidden />
            Roles and departments
          </CardTitle>
          <CardDescription>
            {canManage
              ? "Console permissions are data, not code: departments you create, roles that carry capabilities, and the assignments that decide who resolves what. Every change is audited."
              : `Console permissions are data, not code — departments, roles and what each role may do. You can read the model. ${orgCapabilityRefusal(session.actor, "manage_accounts")}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {roleCounts === null ? (
            <p className="text-sm text-muted-foreground">
              The roles model could not be read — see the database check above.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {roleCounts.departments === 0
                ? "No departments yet, so every role is org-wide."
                : `${roleCounts.departments} department${roleCounts.departments === 1 ? "" : "s"}, each with a permanent lead and member role.`}{" "}
              {roleCounts.roles} role{roleCounts.roles === 1 ? "" : "s"} in
              total.
              {withoutRoles > 0 && (
                <>
                  {" "}
                  <span className="text-foreground">
                    {withoutRoles === 1
                      ? "One account holds console access and no role at all"
                      : `${withoutRoles} accounts hold console access and no role at all`}
                    , so the console opens empty for{" "}
                    {withoutRoles === 1 ? "them" : "each of them"}.
                  </span>
                </>
              )}
            </p>
          )}
          <div>
            <Button asChild variant="secondary" size="sm">
              <Link href="/system/roles">
                {canManage ? "Manage roles and departments" : "Read the roles model"}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="h-4 w-4 text-muted-foreground" aria-hidden />
            Audit trail
          </CardTitle>
          <CardDescription>
            Every access change on this page, every medical-notes read, every
            decision — with who, whose, and when.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            It is a record, not monitoring: there are deliberately no volume
            thresholds, no per-actor profiling and no alerting, because reading
            many members&rsquo; notes in one sitting is what safety work looks
            like. It exists so that &ldquo;who saw my medical information?&rdquo;
            has an honest answer and an incident can be reconstructed.
          </p>
          <div>
            <Button asChild variant="secondary" size="sm">
              <Link href="/audit">
                Open the audit log
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
