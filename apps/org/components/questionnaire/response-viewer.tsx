"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import {
  flattenQuestions,
  type Questionnaire,
  type QuestionnaireResponses,
  type QuestionnaireResponseValue,
} from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@quagga/ui/components/dialog";

function formatValue(
  value: QuestionnaireResponseValue | undefined,
  labels: Map<string, string>,
): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    return value.map((v) => labels.get(v) ?? v).join(", ") || "—";
  }
  return labels.get(String(value)) ?? String(value);
}

/** Read one respondent's answers, mapped from stored ids back to prompts +
 * option labels. Console-only; scope already enforced by the results query. */
export function ResponseViewer({
  questionnaire,
  responses,
  respondent,
}: {
  questionnaire: Questionnaire;
  responses: QuestionnaireResponses;
  respondent: string;
}) {
  const [open, setOpen] = useState(false);
  const questions = flattenQuestions(questionnaire);

  // Value → label lookup for select-style answers.
  const optionLabels = new Map<string, string>();
  for (const q of questions) {
    if (q.kind === "single_select" || q.kind === "multi_select") {
      for (const o of q.options) optionLabels.set(o.value, o.label);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Eye aria-hidden />
        View
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Response</DialogTitle>
          <DialogDescription>{respondent}</DialogDescription>
        </DialogHeader>
        <dl className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          {questions.map((q) => (
            <div key={q.id} className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium text-muted-foreground">
                {q.prompt}
              </dt>
              <dd className="text-sm">
                {formatValue(responses[q.id], optionLabels)}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
