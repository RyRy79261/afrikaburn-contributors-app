import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { aggregateResponses, canViewActivationResults } from "@quagga/core";
import { flattenQuestions } from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { Card, CardContent } from "@quagga/ui/components/card";
import { guardConsole } from "@/lib/gate";
import { PageHeading } from "@/components/page-heading";
import { BlockingBadge } from "@/components/questionnaire/blocking-badge";
import { CloseActivationButton } from "@/components/questionnaire/close-activation-button";
import {
  ResultsView,
  type ResultRowView,
} from "@/components/questionnaires/results-view";
import { formatDate } from "@/lib/labels";
import {
  getActivationResults,
  getOrgActivation,
} from "@/lib/questionnaires/queries";

export const dynamic = "force-dynamic";

export default async function ActivationResultsPage({
  params,
}: {
  params: Promise<{ key: string; activationId: string }>;
}) {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;
  const { session } = guard;

  const { key, activationId } = await params;
  const activation = await getOrgActivation(activationId);
  if (!activation || activation.questionnaireKey !== key) notFound();

  // Scope boundary: results are visible only to the authoring level.
  const canView = canViewActivationResults(
    [{ groupId: session.orgGroupId, role: session.role }],
    { authoredScope: activation.authoredScope, groupId: activation.groupId },
    session.orgGroupId,
  );
  if (!canView) notFound();

  const results = await getActivationResults(
    activation.id,
    activation.questionnaireKey,
  );

  const completed = results.filter((r) => r.status === "completed").length;
  const total = results.length;
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);

  // Per-question aggregation is the engine's job (@quagga/core
  // `aggregateResponses`); this page only decides how each aggregate is drawn.
  const submitted = results
    .map((r) => r.responses)
    .filter((r): r is NonNullable<typeof r> => r !== null);
  const summary = aggregateResponses(activation.definition, submitted);
  const questions = flattenQuestions(activation.definition);

  const rows: ResultRowView[] = results.map((r) => ({
    userId: r.userId,
    email: r.email,
    status: r.status,
    completedLabel: formatDate(r.completedAt),
    responses: r.responses,
  }));

  const exportName = `${activation.questionnaireKey}-${activation.id.slice(0, 8)}`;

  return (
    <div>
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/questionnaires">
            <ArrowLeft aria-hidden />
            All questionnaires
          </Link>
        </Button>
      </div>

      <PageHeading
        eyebrow="Questionnaires / Results"
        title={activation.title}
        description={activation.description ?? undefined}
        actions={
          activation.status === "open" ? (
            <CloseActivationButton activationId={activation.id} />
          ) : undefined
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <BlockingBadge blocking={activation.blocking} />
        <Badge variant={activation.status === "open" ? "success" : "outline"}>
          {activation.status === "open" ? "Open" : "Closed"}
        </Badge>
        <Badge
          variant={
            activation.audience?.kind === "org_internal"
              ? "default"
              : "secondary"
          }
        >
          {activation.audience?.kind === "org_internal"
            ? "Internal"
            : "Outbound"}
        </Badge>
        <Badge variant="secondary">{activation.audienceLabel}</Badge>
        {activation.dueAt && (
          <span className="text-xs text-muted-foreground">
            Due {formatDate(activation.dueAt)}
          </span>
        )}
      </div>

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-6">
          <div className="flex shrink-0 flex-col">
            <span className="text-3xl font-semibold tabular-nums">{pct}%</span>
            <span className="text-xs text-muted-foreground">
              {completed} of {total} completed
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-success transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {summary.totalResponses}{" "}
              {summary.totalResponses === 1 ? "response" : "responses"}{" "}
              summarised · {questions.length}{" "}
              {questions.length === 1 ? "question" : "questions"} in the current
              definition
            </span>
          </div>
        </CardContent>
      </Card>

      <ResultsView
        summary={summary}
        rows={rows}
        questions={questions}
        questionnaire={activation.definition}
        exportName={exportName}
      />
    </div>
  );
}
