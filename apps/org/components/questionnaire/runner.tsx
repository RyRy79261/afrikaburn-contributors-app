"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  pageQuestions,
  type Questionnaire,
  type QuestionnairePage,
  type QuestionnaireResponses,
  type QuestionnaireResponseValue,
  type SaveResult,
} from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { QuestionField } from "./field";

const FORM_ERROR_KEY = "_form";
const SAVE_FAILED =
  "We couldn't save your answers just now. Please try again in a moment.";

export type RunnerAction = (
  responses: QuestionnaireResponses,
) => Promise<SaveResult>;

interface RunnerProps {
  questionnaire: Questionnaire;
  initialResponses: QuestionnaireResponses;
  action: RunnerAction;
  submitLabel?: string;
  /** Where to go after a successful submit (default: refresh in place). */
  redirectTo?: string;
}

/**
 * Console questionnaire runner — the participant runner pattern (apps/web),
 * ported locally and trimmed (no privacy step; console questionnaires never
 * carry Burner-Bio privacy flags). Drives the org-internal blocking gate fill
 * view and any console-side answering.
 */
export function QuestionnaireRunner({
  questionnaire,
  initialResponses,
  action,
  submitLabel = "Finish",
  redirectTo,
}: RunnerProps) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = React.useState(0);
  const [responses, setResponses] =
    React.useState<QuestionnaireResponses>(initialResponses);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [isPending, startTransition] = React.useTransition();

  const pages = questionnaire.pages;
  const step = pages[stepIndex];
  const isLast = stepIndex === pages.length - 1;
  const progress = Math.round(((stepIndex + 1) / pages.length) * 100);

  if (!step) return null;

  function setResponse(id: string, value: QuestionnaireResponseValue) {
    setResponses((prev) => ({ ...prev, [id]: value }));
    setErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function validatePage(page: QuestionnairePage): boolean {
    if (page.kind === "intro") return true;
    const next: Record<string, string> = {};
    for (const q of pageQuestions(page)) {
      const v = responses[q.id];
      const missing = v === undefined || v === null || v === "";
      if (missing && "required" in q && q.required) {
        next[q.id] = "This question is required";
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleNext() {
    const current = pages[stepIndex];
    if (current && !validatePage(current)) return;
    setStepIndex((i) => Math.min(i + 1, pages.length - 1));
  }

  function handleSubmit() {
    const current = pages[stepIndex];
    if (current && !validatePage(current)) return;
    startTransition(async () => {
      try {
        const result = await action(responses);
        if (!result.ok) {
          setErrors(result.errors);
          return;
        }
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } catch {
        setErrors((prev) => ({ ...prev, [FORM_ERROR_KEY]: SAVE_FAILED }));
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {pages.length > 1 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Step {stepIndex + 1} of {pages.length}
            </span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {step.kind === "intro" ? (
        <div className="flex flex-col gap-3 py-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            {step.heading}
          </h2>
          <p className="text-muted-foreground">{step.body}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div>
            <h2 className="text-lg font-semibold">{step.title}</h2>
            {step.subtitle && (
              <p className="mt-1 text-sm text-muted-foreground">
                {step.subtitle}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-5">
            {pageQuestions(step).map((q) => (
              <QuestionField
                key={q.id}
                question={q}
                value={responses[q.id]}
                error={errors[q.id]}
                onChange={(value) => setResponse(q.id, value)}
              />
            ))}
          </div>
        </div>
      )}

      {(errors[FORM_ERROR_KEY] || errors._root) && (
        <p role="alert" className="text-sm text-destructive">
          {errors[FORM_ERROR_KEY] ?? errors._root}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          disabled={stepIndex === 0 || isPending}
        >
          Back
        </Button>
        {isLast ? (
          <Button type="button" onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Saving…" : submitLabel}
          </Button>
        ) : (
          <Button type="button" onClick={handleNext} disabled={isPending}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
