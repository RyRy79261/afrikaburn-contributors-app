import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { hasProjectPermission } from "@quagga/core";
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
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { RolesSettings } from "@/components/roles/roles-settings";
import {
  createRoleAction,
  renameRoleAction,
  removeRoleAction,
  setRoleAppearanceAction,
  setRolePermissionsAction,
  assignOfficerAction,
  unassignOfficerAction,
} from "../../actions";

export const dynamic = "force-dynamic";

export default async function CampRolesSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (!isDatabaseConfigured()) {
    return (
      <AppShell>
        <PreviewNotice feature="Camp settings" />
      </AppShell>
    );
  }

  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");
  const campUser = await getCurrentCampUser();
  const edition = await getActiveEdition();
  if (!campUser || !edition) {
    return (
      <AppShell>
        <PreviewNotice feature="Camp settings" />
      </AppShell>
    );
  }
  await enforceGate(campUser.id);

  const camp = await getCampBySlug(slug, edition.id, campUser.id);
  if (!camp) notFound();

  const permissions = await getMemberPermissions(camp.id, campUser.id);
  const canManageRoles =
    !!permissions && hasProjectPermission(permissions, "manage_roles");
  const canAssignRoles =
    !!permissions && hasProjectPermission(permissions, "assign_roles");
  const canViewDetails =
    !!permissions && hasProjectPermission(permissions, "view_member_details");
  // Only role/officer managers reach this page.
  if (!canManageRoles && !canAssignRoles) notFound();

  const roles = await listRoles(camp.id);
  const assignments = await getRoleAssignments(camp.id);
  const officerStatus = await getOfficerStatus(camp.id, edition.id);

  const members = camp.members.map((m) => ({
    membershipId: m.membershipId,
    userId: m.userId,
    displayName: m.displayName,
  }));

  // Assignment map keyed by membershipId → accepted non-officer role ids (chips).
  const assignmentsByMember: Record<string, string[]> = {};
  for (const m of members) {
    assignmentsByMember[m.membershipId] = (
      assignments.get(m.membershipId) ?? []
    )
      .filter((a) => a.consent === "accepted")
      .map((a) => a.projectRoleId);
  }

  return (
    <AppShell>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link href={`/camps/${slug}`}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              {camp.name}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">
            Roles &amp; Officers
          </h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Define what your crew can do, colour-code your roles, and register the
            responsible people AfrikaBurn needs to reach. Set-and-forget.
          </p>
        </div>

        <RolesSettings
          slug={slug}
          canManageRoles={canManageRoles}
          canAssignRoles={canAssignRoles}
          canViewDetails={canViewDetails}
          roles={roles.map((r) => ({
            id: r.id,
            name: r.name,
            kind: r.kind,
            color: r.color,
            emoji: r.emoji,
            permissions: r.permissions,
            officerKey: r.officerKey,
          }))}
          members={members}
          assignmentsByMember={assignmentsByMember}
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
          createRoleAction={createRoleAction}
          renameRoleAction={renameRoleAction}
          removeRoleAction={removeRoleAction}
          setRoleAppearanceAction={setRoleAppearanceAction}
          setRolePermissionsAction={setRolePermissionsAction}
          assignOfficerAction={assignOfficerAction}
          unassignOfficerAction={unassignOfficerAction}
        />
      </div>
    </AppShell>
  );
}
