import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Boxes,
  Droplets,
  MapPin,
  CalendarClock,
  Wallet,
  LayoutGrid,
  FileCheck2,
  CheckCircle2,
  ClipboardList,
} from "lucide-react";
import type { GroupKind, MembershipRole, RegistrationStatus } from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { DisabledHintTile } from "@quagga/ui/components/disabled-hint-tile";
import { PinnedBulletinBanner } from "@quagga/ui/components/pinned-bulletin-banner";
import { getAuthenticatedUser } from "@/lib/auth";
import { getCurrentCampUser, enforceGate } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getCampBySlug } from "@/lib/groups-store";
import { getPinnedBulletinsForCurrentUser } from "@/lib/bulletins";
import { listInvites } from "@/lib/invites-store";
import {
  listRoles,
  getRoleAssignments,
  getOfficerStatus,
  getMemberPermissions,
  pendingOfficerConsents,
} from "@/lib/roles-store";
import { hasProjectPermission } from "@quagga/core";
import { listPendingQuestionnaires } from "@/lib/questionnaire-store";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { CampInvites } from "@/components/camp-invites";
import { CampMembers } from "@/components/camp-members";
import { OfficerConsentBanner } from "@/components/roles/officer-consent-banner";
import { PendingQuestionnaires } from "@/components/questionnaire/pending-questionnaires";
import { LeaveCampButton } from "@/components/leave-camp-button";
import { MemberRefCode } from "@/components/member-ref-code";
import {
  createInviteAction,
  leaveCampAction,
  revokeInviteAction,
  setMemberRolesAction,
  respondToOfficerAction,
} from "./actions";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<GroupKind, string> = {
  org: "AfrikaBurn",
  theme_camp: "Theme camp",
  artwork: "Artwork",
  mutant_vehicle: "Mutant vehicle",
};

const ROLE_LABEL: Record<MembershipRole, string> = {
  god: "God",
  org_staff: "Org staff",
  lead: "Lead",
  admin: "Co-lead",
  member: "Member",
};

const STATUS_LABEL: Record<RegistrationStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  changes_requested: "Changes requested",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export default async function CampPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (!isDatabaseConfigured()) {
    return (
      <AppShell>
        <PreviewNotice feature="Camp dashboards" />
      </AppShell>
    );
  }

  const authUser = await getAuthenticatedUser();
  const campUser = authUser ? await getCurrentCampUser() : null;
  const edition = await getActiveEdition();
  if (!edition) {
    return (
      <AppShell>
        <PreviewNotice feature="Camp dashboards" />
      </AppShell>
    );
  }

  const camp = await getCampBySlug(slug, edition.id, campUser?.id ?? null);
  if (!camp) notFound();

  // Free (unregistered) camps are members-only.
  if (!camp.registered && !camp.viewerRole) {
    if (!authUser) redirect("/auth/sign-in");
    notFound();
  }

  // Signed-in members are subject to the hard gate — a pending blocking action
  // (Burner Bio or a required questionnaire) sends them to fill it first.
  if (campUser) await enforceGate(campUser.id);

  const isAdmin = camp.viewerRole === "lead" || camp.viewerRole === "admin";
  const isMember = camp.viewerRole !== null;
  const invites = isAdmin ? await listInvites(camp.id) : [];

  // Custom project roles + assignments (chips + quick-assign).
  const roles = isMember ? await listRoles(camp.id) : [];
  const assignments = isMember
    ? await getRoleAssignments(camp.id)
    : new Map<string, Awaited<ReturnType<typeof getRoleAssignments>> extends Map<string, infer V> ? V : never>();
  const baselineRole = roles.find((r) => r.kind === "baseline");
  const memberVMs = camp.members.map((m) => {
    // Chips: baseline (everyone) + accepted non-officer assignments.
    const accepted = (assignments.get(m.membershipId) ?? [])
      .filter((a) => a.consent === "accepted")
      .map((a) => a.projectRoleId);
    const chipIds = baselineRole ? [baselineRole.id, ...accepted] : accepted;
    return {
      membershipId: m.membershipId,
      userId: m.userId,
      displayName: m.displayName,
      role: m.role,
      refCode: m.refCode,
      isViewer: m.isViewer,
      roleIds: [...new Set(chipIds)],
    };
  });

  // Assignable roles for quick-assign: not baseline (derived), not officer.
  const assignableRoles = roles.filter(
    (r) => r.kind !== "baseline" && r.kind !== "officer",
  );

  // Permission-gated management (lead/admin OR permission holders).
  const viewerPerms = campUser
    ? await getMemberPermissions(camp.id, campUser.id)
    : null;
  const canAssignRoles =
    !!viewerPerms && hasProjectPermission(viewerPerms, "assign_roles");
  const canManageRoles =
    !!viewerPerms && hasProjectPermission(viewerPerms, "manage_roles");
  const canViewDetails =
    !!viewerPerms && hasProjectPermission(viewerPerms, "view_member_details");

  // Officer status → settings-link badge; pending officer consents → banner.
  const officerStatus = isMember
    ? await getOfficerStatus(camp.id, edition.id)
    : null;
  const myPendingOfficers = campUser
    ? (await pendingOfficerConsents(campUser.id)).filter(
        (p) => p.groupId === camp.id,
      )
    : [];

  // Pending questionnaires for the viewer (non-blocking card; org + project).
  const pending = campUser
    ? await listPendingQuestionnaires(campUser.id)
    : [];

  const statusLabel = camp.registrationStatus
    ? STATUS_LABEL[camp.registrationStatus as RegistrationStatus]
    : "Not started";

  const myRefCode = camp.members.find((m) => m.isViewer)?.refCode ?? null;

  // Pinned-bulletin banner (canvas RGcNS `adNWQ`). Only pinned, PUBLISHED
  // bulletins this viewer was actually targeted by resolve — the query joins
  // through their own notification rows, so an untargeted (or org-internal)
  // broadcast can never light this banner. Newest wins; no pin, no banner.
  const pinnedBulletins = campUser
    ? await getPinnedBulletinsForCurrentUser()
    : [];
  const pinnedBulletin = pinnedBulletins[0]
    ? {
        title: pinnedBulletins[0].title,
        href: `/bulletins/${pinnedBulletins[0].id}`,
      }
    : null;

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {KIND_LABEL[camp.kind]}
              </p>
              {camp.registered ? (
                <Badge variant="success">Registered</Badge>
              ) : (
                <Badge variant="outline">Free camp</Badge>
              )}
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              {camp.name}
            </h1>
            {camp.description && (
              <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                {camp.description}
              </p>
            )}
          </div>
          {camp.viewerRole && (
            <LeaveCampButton slug={camp.slug} action={leaveCampAction} />
          )}
        </header>

        {pinnedBulletin && (
          <PinnedBulletinBanner
            title={pinnedBulletin.title}
            href={pinnedBulletin.href}
          />
        )}

        {myRefCode && <MemberRefCode code={myRefCode} prominent />}

        {myPendingOfficers.length > 0 && (
          <OfficerConsentBanner
            slug={camp.slug}
            invitations={myPendingOfficers.map((p) => ({
              roleId: p.roleId,
              officerName: p.officerName,
              emoji: p.emoji,
            }))}
            respondAction={respondToOfficerAction}
          />
        )}

        {pending.length > 0 && <PendingQuestionnaires items={pending} />}

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Members */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">
                Members ({camp.members.length})
              </CardTitle>
              <CardDescription>
                {camp.joinability === "open"
                  ? "Accepting new members via invite link."
                  : "Invite-only — members join through a one-time link."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isMember ? (
                <CampMembers
                  slug={camp.slug}
                  canAssignRoles={canAssignRoles}
                  canManageRoles={canManageRoles}
                  showRefCodes={canViewDetails}
                  officersOutstanding={
                    officerStatus?.outstanding.outstanding.length ?? 0
                  }
                  roles={roles.map((r) => ({
                    id: r.id,
                    name: r.name,
                    kind: r.kind,
                    color: r.color,
                    emoji: r.emoji,
                  }))}
                  assignableRoleIds={assignableRoles.map((r) => r.id)}
                  members={memberVMs}
                  setMemberRolesAction={setMemberRolesAction}
                />
              ) : (
                <>
                  <ul className="flex flex-col divide-y divide-border">
                    {camp.members.map((m) => (
                      <li
                        key={m.userId}
                        className="flex items-center justify-between gap-3 py-2.5"
                      >
                        <span className="min-w-0 truncate text-sm">
                          <Link
                            href={`/burners/${m.userId}`}
                            className="rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {m.displayName}
                          </Link>
                        </span>
                        <Badge
                          variant={
                            m.role === "lead"
                              ? "default"
                              : m.role === "admin"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {ROLE_LABEL[m.role]}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                    Ask a camp lead for an invite link to join.
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Registration status tile */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileCheck2 className="h-4 w-4 text-accent" aria-hidden />
                Registration
              </CardTitle>
              <CardDescription>
                Approval earns entitlements for {edition.name}.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant={camp.registered ? "success" : "secondary"}>
                  {statusLabel}
                </Badge>
              </div>
              {camp.registered ? (
                <>
                  {/* Approved-note (canvas RGcNS `xPpft`): registered camps read
                      the confirmation + a link to the locked submission, not a
                      "begin/continue" CTA. */}
                  <div className="flex items-start gap-2 rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-success"
                      aria-hidden
                    />
                    <span className="text-foreground">
                      Registered for {edition.name} — your entitlements are live.
                    </span>
                  </div>
                  {isAdmin && (
                    <Link
                      href={`/camps/${camp.slug}/registration`}
                      className="inline-flex items-center gap-1 text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      View submission
                    </Link>
                  )}
                </>
              ) : (
                isAdmin &&
                // The six-section wizard at /camps/[slug]/registration is
                // CAMP-shaped: its section predicates, labels and stored columns
                // all assume a theme camp. Mutant vehicles and artworks register
                // through their own forms (/vehicles/new, /artworks/new) and
                // must never be sent here — following this CTA would let camp
                // answers overwrite their sound/LNT/dimension fields.
                (camp.kind === "theme_camp" ? (
                  <Button asChild size="sm" className="w-full">
                    <Link href={`/camps/${camp.slug}/registration`}>
                      {camp.registrationStatus
                        ? "Continue registration"
                        : "Begin registration"}
                    </Link>
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {KIND_LABEL[camp.kind]} projects register through their own
                    form — ask AfrikaBurn if you need to change a submission.
                  </p>
                ))
              )}
            </CardContent>
          </Card>

          {/* Questionnaires — lead/admin only */}
          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardList className="h-4 w-4 text-accent" aria-hidden />
                  Questionnaires
                </CardTitle>
                <CardDescription>
                  Ask your members what you need — target by role, track who
                  has answered.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild size="sm" variant="secondary" className="w-full">
                  <Link href={`/camps/${camp.slug}/questionnaires`}>
                    Manage questionnaires
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Invites — lead/admin only */}
        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Invite links</CardTitle>
              <CardDescription>
                One-time links. A member link adds a member; a lead-transfer link
                hands over the lead role to whoever redeems it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CampInvites
                slug={camp.slug}
                initialInvites={invites}
                canLeadTransfer={camp.viewerRole === "lead"}
                createAction={createInviteAction}
                revokeAction={revokeInviteAction}
              />
            </CardContent>
          </Card>
        )}

        {/* Entitlements + parked capabilities */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Entitlements & tools
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <DisabledHintTile
              title="Placement & art grants"
              hint={
                camp.registered
                  ? "Entitlement unlocked — placement application opens once AfrikaBurn confirms the process."
                  : "Unlocks once your registration is approved."
              }
              tag="Entitlement"
              icon={<MapPin className="h-4 w-4" />}
            />
            <DisabledHintTile
              title="Water / Ice / Gas"
              hint="Pending AfrikaBurn input — separate delivery apps."
              tag="Pending AB"
              icon={<Droplets className="h-4 w-4" />}
            />
            <DisabledHintTile
              title="Containers"
              hint="Separate app — for the large camps that use them."
              tag="Separate app"
              icon={<Boxes className="h-4 w-4" />}
            />
            <DisabledHintTile
              title="Shifts"
              hint="Topic under exploration with camp leads."
              tag="Exploring"
              icon={<CalendarClock className="h-4 w-4" />}
            />
            {/*
              PENDING RYAN'S RULING: the "Budget" capability sits in tension with
              the product law that AfrikaBurn never runs camp treasuries/dues
              (AGENTS.md §Product laws — "camp treasuries/dues" are out of scope
              "permanently unless Ryan says otherwise"). It is rendered here only
              as a disabled "topic under exploration" hint tile — no budgeting UI,
              no money handling. Do NOT build any budget/treasury feature behind
              this tile until Ryan explicitly reverses the no-treasuries stance.
            */}
            <DisabledHintTile
              title="Budget"
              hint="Topic under exploration with camp leads."
              tag="Exploring"
              icon={<Wallet className="h-4 w-4" />}
            />
            <DisabledHintTile
              title="Layout"
              hint="Topic under exploration with camp leads."
              tag="Exploring"
              icon={<LayoutGrid className="h-4 w-4" />}
            />
          </div>
        </section>
      </div>
    </AppShell>
  );
}
