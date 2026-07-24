import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { canViewActivationResults } from "@quagga/core";
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
import { getActivationResults } from "@/lib/questionnaire-store";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { BlockingBadge } from "@/components/questionnaire/blocking-badge";
import {
  ResponseViewer,
  type Respondent,
} from "@/components/questionnaire/response-viewer";

export const dynamic = "force-dynamic";

export default async function CampQuestionnaireResultsPage({
  params,
}: {
  params: Promise<{ slug: string; activationId: string }>;
}) {
  const { slug, activationId } = await params;

  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");
  if (!isDatabaseConfigured()) {
    return (
      <AppShell>
        <PreviewNotice feature="Camp questionnaires" />
      </AppShell>
    );
  }

  const user = await requireCampUser();
  await enforceGate(user.id);

  const edition = await getActiveEdition();
  if (!edition) {
    return (
      <AppShell>
        <PreviewNotice feature="Camp questionnaires" />
      </AppShell>
    );
  }

  const camp = await getCampBySlug(slug, edition.id, user.id);
  if (!camp) notFound();

  const results = await getActivationResults(activationId, edition.id);
  // The activation must belong to THIS camp, and the viewer must be its
  // lead/admin — the results-visibility boundary (never cross-project, never
  // org). Enforced through the core predicate.
  if (!results || results.activation.groupId !== camp.id) notFound();

  const role = await getViewerRole(user.id, camp.id);
  const memberships = role ? [{ groupId: camp.id, role }] : [];
  if (
    !canViewActivationResults(
      memberships,
      {
        authoredScope: results.activation.authoredScope,
        groupId: results.activation.groupId,
      },
      "",
    )
  ) {
    notFound();
  }

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
    <AppShell>
      <div className="flex flex-col gap-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link href={`/camps/${slug}/questionnaires`}>
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
    </AppShell>
  );
}
