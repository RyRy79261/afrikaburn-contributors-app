import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import {
  canAuthorOnboarding,
  canAuthorProjectQuestionnaire,
} from "@quagga/core";
import type { ProjectAudience, ProjectStructuralRole } from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { getAuthenticatedUser } from "@/lib/auth";
import { requireCampUser, enforceGate } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getCampBySlug } from "@/lib/groups-store";
import { db, schema } from "@/lib/db";
import {
  getBaselineRoleId,
  getMemberPermissions,
  getRoleAssignments,
  listRoles,
} from "@/lib/roles-store";
import { loadCampTenure } from "@/lib/camp-tenure";
import { getActivation } from "@/lib/questionnaire-store";
import {
  findOnboardingCarrySource,
  getOnboardingDraft,
} from "@/lib/onboarding-store";
import { PreviewNotice } from "@/components/preview-notice";
import { OnboardingBuilder } from "@/components/questionnaire/onboarding-builder";
import { sectionsFromDefinition } from "@/components/questionnaire/onboarding-model";
import {
  discardOnboardingDraftAction,
  saveOnboardingDraftAction,
  sendOnboardingAction,
} from "../../onboarding-actions";

export const dynamic = "force-dynamic";

const STRUCTURAL: readonly string[] = ["lead", "admin", "member"];

/**
 * The onboarding builder for one DRAFT (canvas A2). Reached by starting from
 * the preset or by carrying last edition's forward. A sent onboarding is not
 * editable — its URL forwards to the completion view.
 */
export default async function OnboardingBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; activationId: string }>;
  searchParams: Promise<{ carried?: string }>;
}) {
  const { slug, activationId } = await params;
  const { carried } = await searchParams;

  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");
  if (!isDatabaseConfigured()) return <PreviewNotice feature="Onboarding" />;

  const user = await requireCampUser();
  await enforceGate(user.id);
  const edition = await getActiveEdition();
  if (!edition) return <PreviewNotice feature="Onboarding" />;

  const camp = await getCampBySlug(slug, edition.id, user.id);
  if (!camp || camp.kind !== "theme_camp") notFound();
  const base = `/camps/${slug}/questionnaires`;

  const uuidLike = /^[0-9a-f-]{36}$/i.test(activationId);
  if (!uuidLike) notFound();

  const draft = await getOnboardingDraft(activationId, camp.id);
  if (!draft) {
    // Sent already → its completion view (which runs its own gate).
    const sent = await getActivation(activationId);
    if (sent && sent.groupId === camp.id && sent.status !== "draft") {
      redirect(`${base}/${activationId}`);
    }
    notFound();
  }
  const audience = draft.audience as ProjectAudience;

  const [perms, baselineRoleId] = await Promise.all([
    getMemberPermissions(camp.id, user.id),
    getBaselineRoleId(camp.id),
  ]);
  if (
    !canAuthorOnboarding(
      perms,
      camp.kind,
      audience,
      draft.blocking,
      baselineRoleId,
    )
  ) {
    notFound();
  }

  const roles = (await listRoles(camp.id)).filter((r) => r.kind !== "officer");
  const assignments = await getRoleAssignments(camp.id);
  const tenure = await loadCampTenure(camp.id, draft.editionId ?? edition.id);
  // Counts-only facts for the live reach line — no names, no ids.
  const members = camp.members.map((m) => ({
    role: (STRUCTURAL.includes(m.role) ? m.role : "other") as
      | ProjectStructuralRole
      | "other",
    tenure: tenure.get(m.membershipId) ?? ("new" as const),
    roleIds: (assignments.get(m.membershipId) ?? [])
      .filter((a) => a.consent === "accepted")
      .map((a) => a.projectRoleId),
  }));

  // What this author may target, through the predicate the server enforces.
  const probe = (spec: Partial<ProjectAudience>, blocking: boolean) =>
    perms !== null &&
    canAuthorProjectQuestionnaire(
      perms,
      {
        kind: "project",
        groupId: camp.id,
        mode: "everyone",
        roleIds: [],
        ...spec,
      },
      blocking,
      baselineRoleId,
    );
  const customRoles = roles.filter((r) => r.kind !== "baseline");
  const scope = {
    canTargetEveryone: probe({}, false),
    roleIds: customRoles
      .filter((r) => probe({ mode: "roles", roleIds: [r.id] }, false))
      .map((r) => r.id),
    mayBlock: probe(audience, true),
  };

  const [draftEdition] = draft.editionId
    ? await db()
        .select({ name: schema.editions.name })
        .from(schema.editions)
        .where(eq(schema.editions.id, draft.editionId))
        .limit(1)
    : [];
  const carriedFrom =
    carried === "1"
      ? ((await findOnboardingCarrySource(camp.id, edition.year))
          ?.editionName ?? null)
      : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={base}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Questionnaires
          </Link>
        </Button>
      </div>
      <OnboardingBuilder
        slug={slug}
        activationId={activationId}
        campName={camp.name}
        editionName={draftEdition?.name ?? edition.name}
        returnHref={base}
        completionHref={`${base}/${activationId}`}
        carriedFrom={carriedFrom}
        initial={{
          title: draft.title,
          sections: sectionsFromDefinition(draft.definition),
          audience: {
            mode: audience.mode,
            roleIds: audience.roleIds,
            tenure: audience.tenure ?? ["new", "returning"],
            structuralRoles: audience.structuralRoles ?? [
              "lead",
              "admin",
              "member",
            ],
          },
          blocking: draft.blocking,
          dueAt: draft.dueAt ? draft.dueAt.toISOString().slice(0, 10) : null,
        }}
        roles={roles.map((r) => ({ id: r.id, name: r.name, kind: r.kind }))}
        members={members}
        scope={scope}
        actions={{
          save: saveOnboardingDraftAction,
          send: sendOnboardingAction,
          discard: discardOnboardingDraftAction,
        }}
      />
    </div>
  );
}
