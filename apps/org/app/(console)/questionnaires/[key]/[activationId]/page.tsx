import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { canViewActivationResults } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { Card, CardContent } from "@quagga/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@quagga/ui/components/table";
import { guardConsole } from "@/lib/gate";
import { PageHeading } from "@/components/page-heading";
import { BlockingBadge } from "@/components/questionnaire/blocking-badge";
import { ResponseViewer } from "@/components/questionnaire/response-viewer";
import { CloseActivationButton } from "@/components/questionnaire/close-activation-button";
import { formatDate } from "@/lib/labels";
import {
  getActivationResults,
  getOrgActivation,
} from "@/lib/questionnaires/queries";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { label: string; variant: "success" | "warning" | "secondary" | "outline" }> = {
  completed: { label: "Completed", variant: "success" },
  pending: { label: "Pending", variant: "warning" },
  waived: { label: "Waived", variant: "secondary" },
  expired: { label: "Expired", variant: "outline" },
};

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
        <Badge variant="secondary">{activation.audienceLabel}</Badge>
        {activation.dueAt && (
          <span className="text-xs text-muted-foreground">
            Due {formatDate(activation.dueAt)}
          </span>
        )}
      </div>

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Completion</span>
            <span className="tabular-nums text-muted-foreground">
              {completed} of {total} · {pct}%
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-success transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {total === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No one matched this audience when it was sent. Grant-requester
            audiences stay empty until the MV/art registration flows ship.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead className="text-right">Response</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r) => {
                  const style = STATUS_LABEL[r.status] ?? STATUS_LABEL.pending!;
                  return (
                    <TableRow key={r.userId}>
                      <TableCell className="font-medium">
                        {r.email ?? "Unknown user"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={style.variant}>{style.label}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(r.completedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.responses ? (
                          <ResponseViewer
                            questionnaire={activation.definition}
                            responses={r.responses}
                            respondent={r.email ?? "Unknown user"}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
