import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  canViewActivationResults,
  isOnboardingDefinition,
  type OnboardingNamesFilter,
} from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { getAuthenticatedUser } from "@/lib/auth";
import { requireCampUser, enforceGate } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getCampBySlug, getViewerRole } from "@/lib/groups-store";
import {
  getActivation,
  getActivationResults,
} from "@/lib/questionnaire-store";
import { getOnboardingCompletion } from "@/lib/onboarding-store";
import { OnboardingCompletion } from "./onboarding-completion";
import {
  resolveQuestionnaireRoute,
  type QuestionnaireRouteKind,
} from "./guard";

import { PreviewNotice } from "@/components/preview-notice";
import { BlockingBadge } from "@/components/questionnaire/blocking-badge";
import {
  ResponseViewer,
  type Respondent,
} from "@/components/questionnaire/response-viewer";

/** One questionnaire's results, for one group of any kind (CREATIVE-007). */
export async function ProjectQuestionnaireResults({
  slug,
  activationId,
  routeKind,
  names = null,
}: {
  slug: string;
  activationId: string;
  routeKind: QuestionnaireRouteKind;
  /** Camp onboarding only: which names to load (null = totals only). */
  names?: OnboardingNamesFilter | null;
}) {
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
  const base = resolveQuestionnaireRoute(
    camp.kind,
    routeKind,
    slug,
    `/${encodeURIComponent(activationId)}`,
  );

  // The activation alone first — no respondent is read until we know what
  // this page will show. (An onboarding's completion view loads names only on
  // demand, so loading every respondent up front would make that untrue.)
  const activation = await getActivation(activationId);
  // The activation must belong to THIS camp, and the viewer must be its
  // lead/admin — the results-visibility boundary (never cross-project, never
  // org). Enforced through the core predicate.
  if (!activation || activation.groupId !== camp.id) notFound();

  const role = await getViewerRole(user.id, camp.id);
  const memberships = role ? [{ groupId: camp.id, role }] : [];
  if (
    !canViewActivationResults(
      memberships,
      {
        authoredScope: activation.authoredScope,
        groupId: activation.groupId,
      },
      "",
    )
  ) {
    notFound();
  }

  // Camp onboarding (epic #54): an unsent draft opens in its builder; a sent
  // one gets the totals-first completion view instead of the per-person
  // response table (ONBOARD-020 — names only on demand).
  if (isOnboardingDefinition(activation.definition)) {
    if (activation.status === "draft") {
      redirect(`${base}/onboarding/${encodeURIComponent(activationId)}`);
    }
    const view = await getOnboardingCompletion({
      activationId,
      groupId: camp.id,
      names,
    });
    if (!view) notFound();
    return (
      <OnboardingCompletion
        view={view}
        slug={slug}
        base={`${base}/${encodeURIComponent(activationId)}`}
        names={names}
      />
    );
  }

  const results = await getActivationResults(activationId, edition.id);
  if (!results) notFound();

  const completed = results.respondents.filter(
    (r) => r.status === "completed",
  ).length;

  const respondents: Respondent[] = results.respondents.map((r) => ({
    userId: r.userId,
    displayName: r.displayName,
    status: r.status,
    completedAt: r.completedAt
      ? r.completedAt.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : null,
    responses: r.responses,
  }));

  return (
    <>
      <div className="flex flex-col gap-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link href={base}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Questionnaires
            </Link>
          </Button>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {results.activation.title}
              </h1>
              {results.activation.description && (
                <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                  {results.activation.description}
                </p>
              )}
            </div>
            <BlockingBadge blocking={results.activation.blocking} />
          </header>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              Completion
              <Badge variant="secondary">
                {completed}/{results.respondents.length} completed
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {results.respondents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This questionnaire wasn&apos;t sent to anyone — the audience
                resolved to nobody at send time.
              </p>
            ) : (
              <ResponseViewer
                definition={results.activation.definition}
                respondents={respondents}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
