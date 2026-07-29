import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  canAuthorProjectQuestionnaire,
  hasProjectPermission,
} from "@quagga/core";
import type { ProjectAudience } from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { getAuthenticatedUser } from "@/lib/auth";
import { requireCampUser, enforceGate } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getCampBySlug } from "@/lib/groups-store";
import {
  listRoles,
  getRoleAssignments,
  getBaselineRoleId,
  getMemberPermissions,
} from "@/lib/roles-store";
import { PreviewNotice } from "@/components/preview-notice";
import { QuestionnaireBuilder } from "@/components/questionnaire/builder";
import { createQuestionnaireAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewCampQuestionnairePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");
  if (!isDatabaseConfigured()) {
    return <PreviewNotice feature="Camp questionnaires" />;
  }

  const user = await requireCampUser();
  await enforceGate(user.id);

  const edition = await getActiveEdition();
  if (!edition) {
    return <PreviewNotice feature="Camp questionnaires" />;
  }

  const camp = await getCampBySlug(slug, edition.id, user.id);
  if (!camp) notFound();

  // The SAME gate as the questionnaires list, which is what puts the "New
  // questionnaire" button on screen: lead/admin (the permission backstop) OR any
  // member holding `manage_questionnaires`. This page used to demand a
  // structural admin role, so a member granted `manage_questionnaires` was shown
  // the button and then handed a 404 — the permission could be granted but never
  // exercised. The SEND is still authorised server-side against the holder's
  // configured scope (`createQuestionnaireAction` → canAuthorProjectQuestionnaire).
  const viewerPerms = await getMemberPermissions(camp.id, user.id);
  if (
    !viewerPerms ||
    !hasProjectPermission(viewerPerms, "manage_questionnaires")
  ) {
    notFound();
  }

  const allRoles = await listRoles(camp.id);
  // Audience picker targets custom/default/captain roles ("everyone" covers the
  // baseline; officers are org-facing, addressed via their own consent flow).
  const roles = allRoles.filter(
    (r) => r.kind !== "officer" && r.kind !== "baseline",
  );
  const assignments = await getRoleAssignments(camp.id);
  const members = camp.members.map((m) => ({
    roleIds: (assignments.get(m.membershipId) ?? [])
      .filter((a) => a.consent === "accepted")
      .map((a) => a.projectRoleId),
  }));

  // What this author may actually send, resolved through the very predicate the
  // server enforces — so the picker greys out what would be refused instead of
  // letting someone build a whole questionnaire and discover on "Create & send"
  // that their permission doesn't cover that audience.
  const baselineRoleId = await getBaselineRoleId(camp.id);
  const audience = (
    mode: "everyone" | "roles",
    roleIds: string[],
  ): ProjectAudience => ({ kind: "project", groupId: camp.id, mode, roleIds });
  const mayAuthor = (spec: ProjectAudience, blocking: boolean) =>
    canAuthorProjectQuestionnaire(viewerPerms, spec, blocking, baselineRoleId);

  const canTargetEveryone = mayAuthor(audience("everyone", []), false);
  const targetableRoleIds = roles
    .filter((r) => mayAuthor(audience("roles", [r.id]), false))
    .map((r) => r.id);
  // `mayBlock` is a scope flag, not an audience one, but the predicate only
  // answers questions about a whole send — so probe it with an audience this
  // author is already allowed to target.
  const blockingProbe = canTargetEveryone
    ? audience("everyone", [])
    : targetableRoleIds[0]
      ? audience("roles", [targetableRoleIds[0]])
      : null;
  const mayBlock = blockingProbe ? mayAuthor(blockingProbe, true) : false;

  return (
    <>
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link href={`/camps/${slug}/questionnaires`}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Questionnaires
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">
            New questionnaire
          </h1>
        </div>
        <QuestionnaireBuilder
          slug={slug}
          roles={roles.map((r) => ({ id: r.id, name: r.name }))}
          members={members}
          scope={{ canTargetEveryone, targetableRoleIds, mayBlock }}
          action={createQuestionnaireAction}
        />
      </div>
    </>
  );
}
