import "server-only";

import { notFound, redirect } from "next/navigation";
import { canSendCampAnnouncement, hasProjectPermission } from "@quagga/core";
import type { ProjectAudience } from "@quagga/types";
import { getAuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition, type Edition } from "@/lib/edition";
import { getCampBySlug, type CampDetail } from "@/lib/groups-store";
import { getRoleAssignments, listRoles } from "@/lib/roles-store";
import { enforceGate, requireCampUser, type CampUser } from "@/lib/session";
import {
  getSenderContext,
  type SenderContext,
} from "@/lib/announcements-store";
import type {
  ComposerRole,
  ComposerScope,
} from "@/components/announcements/composer";

// The shared guard for every /camps/[slug]/announcements page. A viewer who
// is not a member of the camp, or a member without `post_announcements`, gets
// the camp's ordinary 404 — the same answer as a camp that does not exist, so
// a free camp's announcements surface is as undiscoverable as the camp.

export type AnnouncementsContext =
  | { kind: "preview" }
  | {
      kind: "ready";
      user: CampUser;
      edition: Edition;
      camp: CampDetail;
      sender: SenderContext;
    };

export async function loadAnnouncementsContext(
  slug: string,
): Promise<AnnouncementsContext> {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");
  if (!isDatabaseConfigured()) return { kind: "preview" };

  const user = await requireCampUser();
  await enforceGate(user.id);

  const edition = await getActiveEdition();
  if (!edition) return { kind: "preview" };

  const camp = await getCampBySlug(slug, edition.id, user.id);
  if (!camp) notFound();

  const sender = await getSenderContext(camp.id, user.id);
  if (!sender || !hasProjectPermission(sender.perms, "post_announcements")) {
    notFound();
  }
  return { kind: "ready", user, edition, camp, sender };
}

/**
 * What the composer needs: the targetable roles, each member's roles (for the
 * live count), and what this sender's scope allows — resolved through the SAME
 * predicate the server enforces, so the picker greys out what would be refused.
 */
export async function composerData(
  campId: string,
  sender: SenderContext,
  members: CampDetail["members"],
): Promise<{
  roles: ComposerRole[];
  members: { roleIds: string[] }[];
  scope: ComposerScope;
}> {
  const [allRoles, assignments] = await Promise.all([
    listRoles(campId),
    getRoleAssignments(campId),
  ]);
  // Custom/default/captain roles; "everyone" covers the baseline, and officers
  // are org-facing registrations addressed through their own consent flow.
  const roles = allRoles.filter(
    (r) => r.kind !== "officer" && r.kind !== "baseline",
  );
  const audience = (
    mode: "everyone" | "roles",
    roleIds: string[],
  ): ProjectAudience => ({ kind: "project", groupId: campId, mode, roleIds });
  const may = (spec: ProjectAudience, requireAck: boolean) =>
    canSendCampAnnouncement(sender.perms, {
      groupId: campId,
      audience: spec,
      presentation: requireAck ? "acknowledge" : "feed",
      baselineRoleId: sender.baselineRoleId,
      campRoleIds: sender.campRoleIds,
    });

  const canTargetEveryone = may(audience("everyone", []), false);
  const targetableRoleIds = roles
    .filter((r) => may(audience("roles", [r.id]), false))
    .map((r) => r.id);
  // `mayRequireAck` is a scope flag, but the predicate answers questions about
  // a whole send — probe it with an audience this sender may already target.
  const probe = canTargetEveryone
    ? audience("everyone", [])
    : targetableRoleIds[0]
      ? audience("roles", [targetableRoleIds[0]])
      : null;
  const mayRequireAck = probe ? may(probe, true) : false;

  return {
    roles: roles.map((r) => ({ id: r.id, name: r.name })),
    members: members.map((m) => ({
      roleIds: (assignments.get(m.membershipId) ?? [])
        .filter((a) => a.consent === "accepted")
        .map((a) => a.projectRoleId),
    })),
    scope: { canTargetEveryone, targetableRoleIds, mayRequireAck },
  };
}
