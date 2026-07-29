"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  pageQuestions,
  validateOne,
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

  /**
   * THE SERVER'S VALIDATOR, not a weaker copy of it.
   *
   * This used to test emptiness only. The server runs `validateOne` over every
   * question on every page (`validateResponses`), and Builder v2 exposes rules
   * that only it enforced — `format` email/url/phone/number, `minLength`,
   * `minSelections`/`maxSelections`, and grids whose rows default to required.
   * So a page could pass here and be rejected there.
   *
   * That was survivable on an ordinary questionnaire and fatal on the console's
   * BLOCKING gate: the rejection is keyed by question id, this runner only
   * renders errors for questions on the CURRENT page, and the offending
   * question is by definition on a page the walker already left. The refusal
   * appeared nowhere, the gate never cleared, and the console stayed shut with
   * no way forward — for staff, on a screen whose only other control is sign
   * out.
   */
  function validatePage(page: QuestionnairePage): boolean {
    if (page.kind === "intro") return true;
    const next: Record<string, string> = {};
    for (const q of pageQuestions(page)) {
      const result = validateOne(q, responses[q.id]);
      if (!result.ok) next[q.id] = result.error;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  /** The page holding the first question the SERVER rejected, so an off-page
   * refusal is shown rather than swallowed. */
  function pageOwningError(errs: Record<string, string>): number | null {
    const ids = new Set(Object.keys(errs).filter((k) => !k.startsWith("_")));
    if (ids.size === 0) return null;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (!page) continue;
      for (const q of pageQuestions(page)) {
        if (ids.has(q.id)) return i;
      }
    }
    return null;
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
          // Walk to the page that owns the rejection. Without this the error is
          // keyed to a question that is not on screen, nothing renders, and the
          // gate cannot be cleared.
          const target = pageOwningError(result.errors);
          if (target !== null && target !== stepIndex) setStepIndex(target);
          return;
        }
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } catch {
        setErrors((prev) => ({ ...prev, [FORM_ERROR_KEY]: SAVE_FAILED }));
      }
    });
  }

  // A server error keyed to a question that is not on the current page. The
  // jump in handleSubmit normally moves to it; this covers the case where it
  // cannot be found at all.
  const currentIds = new Set(
    (pages[stepIndex] ? pageQuestions(pages[stepIndex]) : []).map((q) => q.id),
  );
  const offPageError = Object.keys(errors).some(
    (k) => !k.startsWith("_") && !currentIds.has(k),
  );

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

      {/* LAST-RESORT BANNER. `pageOwningError` walks to the page that owns a
          server rejection, but if the rejection names a question that is not on
          any page the walker can reach — a definition edited under a live
          activation, say — nothing above would render and the gate would look
          like it simply refused to submit. A refusal must always be visible. */}
      {offPageError && (
        <p role="alert" className="text-sm text-destructive">
          Something on an earlier page needs fixing before this can be
          submitted. Use Back to review your answers.
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
