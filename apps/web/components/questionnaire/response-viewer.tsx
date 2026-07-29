"use client";

import * as React from "react";
import { CheckCircle2, Clock, Eye, Lock } from "lucide-react";
import {
  flattenQuestions,
  type Questionnaire,
  type QuestionnaireResponses,
  type QuestionnaireResponseValue,
} from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@quagga/ui/components/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@quagga/ui/components/dialog";

export interface Respondent {
  userId: string;
  displayName: string;
  status: string;
  completedAt: string | null;
  responses: QuestionnaireResponses | null;
}

/**
 * Author-side completion table + per-member response viewer. The privacy
 * boundary (who may load this at all) is enforced server-side; this is purely
 * presentational over data the viewer is already entitled to see.
 */
export function ResponseViewer({
  definition,
  respondents,
}: {
  definition: Questionnaire;
  respondents: Respondent[];
}) {
  const [viewing, setViewing] = React.useState<Respondent | null>(null);
  const questions = React.useMemo(
    () => flattenQuestions(definition),
    [definition],
  );

  function label(
    value: QuestionnaireResponseValue | undefined,
    qId: string,
  ): string {
    if (value === undefined || value === null || value === "") return "—";
    const q = questions.find((x) => x.id === qId);
    if (q && (q.kind === "single_select" || q.kind === "multi_select")) {
      const optMap = new Map(q.options.map((o) => [o.value, o.label]));
      if (Array.isArray(value)) {
        return value.map((v) => optMap.get(v) ?? v).join(", ") || "—";
      }
      return optMap.get(String(value)) ?? String(value);
    }
    if (
      q &&
      (q.kind === "multi_choice_grid" || q.kind === "checkbox_grid") &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      const rowMap = new Map(q.rows.map((r) => [r.id, r.label]));
      const colMap = new Map(q.columns.map((c) => [c.value, c.label]));
      const parts: string[] = [];
      for (const [rowId, picks] of Object.entries(
        value as Record<string, string[]>,
      )) {
        if (!Array.isArray(picks) || picks.length === 0) continue;
        parts.push(
          `${rowMap.get(rowId) ?? rowId}: ${picks
            .map((v) => colMap.get(v) ?? v)
            .join(", ")}`,
        );
      }
      return parts.join(" · ") || "—";
    }
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (Array.isArray(value)) return value.join(", ") || "—";
    return String(value);
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Response</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {respondents.map((r) => {
            const done = r.status === "completed";
            // Closing the questionnaire expires everyone who hadn't answered.
            // They are not "pending" — nothing is waiting on them.
            const recalled = r.status === "expired";
            return (
              <TableRow key={r.userId}>
                <TableCell className="font-medium">{r.displayName}</TableCell>
                <TableCell>
                  {done ? (
                    <Badge variant="success">
                      <CheckCircle2 className="h-3 w-3" aria-hidden />
                      Completed
                    </Badge>
                  ) : recalled ? (
                    <Badge variant="outline">
                      <Lock className="h-3 w-3" aria-hidden />
                      Recalled
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      <Clock className="h-3 w-3" aria-hidden />
                      Pending
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {done && r.responses ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewing(r)}
                    >
                      <Eye className="h-4 w-4" aria-hidden />
                      View
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Dialog
        open={viewing !== null}
        onOpenChange={(v) => !v && setViewing(null)}
      >
        {/* The dialog is centred with a translate and had no height cap, so a
            long response grew off BOTH ends of the viewport with nothing to
            scroll — Radix locks the page behind a modal, and the dialog itself
            had no overflow. A twenty-question response was therefore partly
            unreadable. Cap the dialog; the answer list below scrolls inside it
            while the title stays put. */}
        <DialogContent className="max-h-[85svh]">
          <DialogHeader>
            <DialogTitle>{viewing?.displayName}&apos;s response</DialogTitle>
            <DialogDescription>
              {viewing?.completedAt
                ? `Submitted ${viewing.completedAt}`
                : "Submitted"}
            </DialogDescription>
          </DialogHeader>
          <dl className="flex min-h-0 max-h-[60svh] flex-col gap-3 overflow-y-auto">
            {questions.map((q) => (
              <div key={q.id} className="flex flex-col gap-0.5">
                <dt className="text-sm font-medium">{q.prompt}</dt>
                <dd className="text-sm text-muted-foreground">
                  {label(viewing?.responses?.[q.id], q.id)}
                </dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
