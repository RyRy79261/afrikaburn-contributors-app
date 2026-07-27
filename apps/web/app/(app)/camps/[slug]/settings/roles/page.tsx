import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { hasProjectPermission, isBaselineKind } from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { getAuthenticatedUser } from "@/lib/auth";
import { getCurrentCampUser, enforceGate } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getCampBySlug } from "@/lib/groups-store";
import {
  listRoles,
  getRoleAssignments,
  getOfficerStatus,
  getMemberPermissions,
} from "@/lib/roles-store";
import { PreviewNotice } from "@/components/preview-notice";
import { RolesSettings } from "@/components/roles/roles-settings";
import {
  renameRoleAction,
  removeRoleAction,
  setRoleAppearanceAction,
  setRolePermissionsAction,
  assignOfficerAction,
  unassignOfficerAction,
} from "../../actions";
import { createRoleWithSetupAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CampRolesSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (!isDatabaseConfigured()) {
    return <PreviewNotice feature="Camp settings" />;
  }

  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");
  const campUser = await getCurrentCampUser();
  const edition = await getActiveEdition();
  if (!campUser || !edition) {
    return <PreviewNotice feature="Camp settings" />;
  }
  await enforceGate(campUser.id);

  const camp = await getCampBySlug(slug, edition.id, campUser.id);
  if (!camp) notFound();

  const permissions = await getMemberPermissions(camp.id, campUser.id);
  const canManageRoles =
    !!permissions && hasProjectPermission(permissions, "manage_roles");
  const canAssignRoles =
    !!permissions && hasProjectPermission(permissions, "assign_roles");
  // Only role/officer managers reach this page (the actions re-check anyway).
  if (!canManageRoles && !canAssignRoles) notFound();

  const roles = await listRoles(camp.id);
  const assignments = await getRoleAssignments(camp.id);
  const officerStatus = await getOfficerStatus(camp.id, edition.id);

  const members = camp.members.map((m) => ({
    membershipId: m.membershipId,
    userId: m.userId,
    displayName: m.displayName,
  }));

  // How many members hold each role — the collapsed-row counts and the
  // delete-cascade confirmation. Baseline is DERIVED (everyone holds it, never
  // stored), so it counts the whole camp.
  const acceptedCounts = new Map<string, number>();
  for (const list of assignments.values()) {
    for (const a of list) {
      if (a.consent !== "accepted") continue;
      acceptedCounts.set(
        a.projectRoleId,
        (acceptedCounts.get(a.projectRoleId) ?? 0) + 1,
      );
    }
  }

  return (
    <>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link href={`/camps/${slug}`}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              {camp.name}
            </Link>
          </Button>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {camp.name} / Settings / Roles &amp; officers
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Roles &amp; officers
          </h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Set this up once — who your people are, what they can do, and which
            officers AfrikaBurn can reach.
          </p>
        </div>

        <RolesSettings
          slug={slug}
          canManageRoles={canManageRoles}
          canAssignRoles={canAssignRoles}
          roles={roles.map((r) => ({
            id: r.id,
            name: r.name,
            kind: r.kind,
            color: r.color,
            emoji: r.emoji,
            permissions: r.permissions,
            officerKey: r.officerKey,
            memberCount: isBaselineKind(r.kind)
              ? members.length
              : (acceptedCounts.get(r.id) ?? 0),
          }))}
          members={members}
          officers={officerStatus.officers.map((o) => ({
            roleId: o.roleId,
            officerKey: o.officerKey,
            name: o.name,
            emoji: o.emoji,
            color: o.color,
            requirement: o.requirement,
            assignments: o.assignments,
          }))}
          officerApplies={officerStatus.isRegisteredOrInFlight}
          outstanding={officerStatus.outstanding}
          createRoleWithSetupAction={createRoleWithSetupAction}
          renameRoleAction={renameRoleAction}
          removeRoleAction={removeRoleAction}
          setRoleAppearanceAction={setRoleAppearanceAction}
          setRolePermissionsAction={setRolePermissionsAction}
          assignOfficerAction={assignOfficerAction}
          unassignOfficerAction={unassignOfficerAction}
        />
      </div>
    </>
  );
}
