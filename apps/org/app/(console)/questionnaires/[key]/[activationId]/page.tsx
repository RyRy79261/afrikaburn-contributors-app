import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import {
  aggregateResponses,
  canViewActivationResults,
  orgCapabilityRefusal,
} from "@quagga/core";
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
  canReadActivationResults,
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

  // Personal-information boundary, separate from the scope one above. Results
  // are named people's answers — a respondent list is a list of email addresses,
  // and free-text answers carry whatever the respondent wrote about themselves —
  // so a rank that may not read personal information is REFUSED here, honestly,
  // rather than 404'd or shown a table with the names filed off. The query
  // itself never runs.
  if (!canReadActivationResults(session.actor)) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeading
          eyebrow="Questionnaires / Results"
          title={activation.title}
          description={activation.description ?? undefined}
        />
        <Card>
          <CardContent className="flex flex-col gap-2 p-6">
            <p className="flex items-start gap-2 text-sm font-medium">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {orgCapabilityRefusal(session.actor, "read_personal_information")}
            </p>
            <p className="text-sm text-muted-foreground">
              Responses are people&apos;s answers under their own names, so the
              whole results table sits behind that line — including the export.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const results = await getActivationResults(
    activation.id,
    activation.questionnaireKey,
    session.actor,
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
