import Link from "next/link";
import { FileText, Pencil, Plus, Send } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { Badge } from "@quagga/ui/components/badge";
import { Card, CardContent } from "@quagga/ui/components/card";
import { guardConsole } from "@/lib/gate";
import { PageHeading } from "@/components/page-heading";
import { BlockingBadge } from "@/components/questionnaire/blocking-badge";
import { formatDate } from "@/lib/labels";
import {
  listOrgQuestionnaires,
  type ActivationSummary,
} from "@/lib/questionnaires/queries";

export const dynamic = "force-dynamic";

export default async function QuestionnairesPage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  const questionnaires = await listOrgQuestionnaires();

  return (
    <div>
      <PageHeading
        eyebrow="Questionnaires"
        title="Questionnaires"
        description="Build questionnaires, send them to burners or org staff, and track who has answered. Keep them short — every question is one someone in the desert has to answer."
        actions={
          <Button asChild>
            <Link href="/questionnaires/new">
              <Plus aria-hidden />
              New questionnaire
            </Link>
          </Button>
        }
      />

      {questionnaires.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <FileText className="h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              No questionnaires yet. Build one to check in with camp leads or your
              own staff.
            </p>
            <Button asChild>
              <Link href="/questionnaires/new">
                <Plus aria-hidden />
                New questionnaire
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {questionnaires.map((q) => (
            <Card key={q.key}>
              <CardContent className="flex flex-col gap-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold">{q.title}</h2>
                      <Badge variant="secondary">
                        {q.fieldCount}{" "}
                        {q.fieldCount === 1 ? "question" : "questions"}
                      </Badge>
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">
                      {q.key} · v{q.version ?? "1"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/questionnaires/${q.key}/edit`}>
                        <Pencil aria-hidden />
                        Edit
                      </Link>
                    </Button>
                    <Button asChild size="sm">
                      <Link href={`/questionnaires/${q.key}/activate`}>
                        <Send aria-hidden />
                        Send
                      </Link>
                    </Button>
                  </div>
                </div>

                {q.activations.length > 0 && (
                  <div className="flex flex-col divide-y divide-border rounded-md border border-border">
                    {q.activations.map((a) => (
                      <ActivationRow key={a.id} activation={a} qKey={q.key} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivationRow({
  activation,
  qKey,
}: {
  activation: ActivationSummary;
  qKey: string;
}) {
  const { sent, completed } = activation.completion;
  const pct = sent === 0 ? 0 : Math.round((completed / sent) * 100);

  return (
    <Link
      href={`/questionnaires/${qKey}/${activation.id}`}
      className="flex flex-col gap-2 p-3 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <BlockingBadge blocking={activation.blocking} />
          <Badge
            variant={activation.status === "open" ? "success" : "outline"}
          >
            {activation.status === "open"
              ? "Open"
              : activation.status === "closed"
                ? "Closed"
                : "Draft"}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {activation.audienceLabel}
          </span>
        </div>
        {activation.dueAt && (
          <span className="text-xs text-muted-foreground">
            Due {formatDate(activation.dueAt)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 sm:w-56">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-success transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {completed}/{sent}
        </span>
      </div>
    </Link>
  );
}
