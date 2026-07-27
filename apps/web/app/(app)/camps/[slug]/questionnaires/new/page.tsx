import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PROJECT_ADMIN_ROLES } from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { getAuthenticatedUser } from "@/lib/auth";
import { requireCampUser, enforceGate } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getCampBySlug } from "@/lib/groups-store";
import { listRoles, getRoleAssignments } from "@/lib/roles-store";
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
  const isAdmin =
    camp.viewerRole !== null && PROJECT_ADMIN_ROLES.includes(camp.viewerRole);
  if (!isAdmin) notFound();

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
          action={createQuestionnaireAction}
        />
      </div>
    </>
  );
}
