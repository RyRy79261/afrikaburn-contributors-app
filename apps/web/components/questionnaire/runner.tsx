"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type {
  Questionnaire,
  QuestionnairePage,
  QuestionnaireResponses,
  QuestionnaireResponseValue,
  SaveResult,
} from "@quagga/types";
import type { BioPrivacyField } from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { PrivacyToggles } from "../privacy-toggles";
import { QuestionField } from "./field";
import {
  BurnsAndVolunteeringStep,
  type BioExtrasState,
} from "./burns-step";
import type { CampSearchResult } from "@/lib/groups-store";

const FORM_ERROR_KEY = "_form";
const SAVE_FAILED =
  "We couldn't save your answers just now. Please try again in a moment.";

export type RunnerAction = (
  responses: QuestionnaireResponses,
  privacyFlags: Record<string, boolean> | null,
  final: boolean,
  extras?: BioExtrasState | null,
) => Promise<SaveResult>;

interface RunnerProps {
  questionnaire: Questionnaire;
  initialResponses: QuestionnaireResponses;
  action: RunnerAction;
  /** When provided, a privacy step is appended after the questionnaire pages. */
  privacy?: {
    fields: readonly BioPrivacyField[];
    initialFlags: Record<string, boolean>;
  };
  /** When provided, a bespoke "Your burns & volunteering" step is inserted after
   * the questionnaire pages and before the privacy step (build-spec v3). */
  burns?: {
    initial: BioExtrasState;
    searchCamps: (query: string) => Promise<CampSearchResult[]>;
  };
  submitLabel?: string;
  /** Persist on every Next (default false — persist only on final submit). */
  persistProgress?: boolean;
  /** Where to go after a successful final submit (default: refresh in place). */
  redirectTo?: string;
  /** Gate styling: show "N of M answered" instead of step progress. */
  answeredProgress?: boolean;
  /** Gate styling: full-width submit with no Back on a single-page form. */
  fullWidthSubmit?: boolean;
}

type Step =
  | { kind: "page"; page: QuestionnairePage }
  | { kind: "burns" }
  | { kind: "privacy" };

export function QuestionnaireRunner({
  questionnaire,
  initialResponses,
  action,
  privacy,
  burns,
  submitLabel = "Finish",
  persistProgress = false,
  redirectTo,
  answeredProgress = false,
  fullWidthSubmit = false,
}: RunnerProps) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = React.useState(0);
  const [responses, setResponses] =
    React.useState<QuestionnaireResponses>(initialResponses);
  const [flags, setFlags] = React.useState<Record<string, boolean>>(
    privacy?.initialFlags ?? {},
  );
  const [extras, setExtras] = React.useState<BioExtrasState | null>(
    burns?.initial ?? null,
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [isPending, startTransition] = React.useTransition();

  const steps: Step[] = React.useMemo(() => {
    const s: Step[] = questionnaire.pages.map((page) => ({
      kind: "page" as const,
      page,
    }));
    if (burns) s.push({ kind: "burns" });
    if (privacy) s.push({ kind: "privacy" });
    return s;
  }, [questionnaire, privacy, burns]);

  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;
  const stepProgress = Math.round(((stepIndex + 1) / steps.length) * 100);

  // Gate progress counts answered questions across all question pages ("2 of 3
  // answered"), rather than the step position.
  const answeredStats = React.useMemo(() => {
    let total = 0;
    let answered = 0;
    for (const page of questionnaire.pages) {
      if (page.kind !== "questions") continue;
      for (const q of page.questions) {
        total += 1;
        const v = responses[q.id];
        const empty =
          v === undefined ||
          v === null ||
          v === "" ||
          (Array.isArray(v) && v.length === 0);
        if (!empty) answered += 1;
      }
    }
    return { total, answered };
  }, [questionnaire, responses]);

  const progress =
    answeredProgress && answeredStats.total > 0
      ? Math.round((answeredStats.answered / answeredStats.total) * 100)
      : stepProgress;
  const soloSubmit = fullWidthSubmit && isLast && stepIndex === 0;

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
    for (const q of page.questions) {
      const v = responses[q.id];
      const missing = v === undefined || v === null || v === "";
      if (missing && "required" in q && q.required) {
        next[q.id] = "This question is required";
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function persist(final: boolean, onOk: () => void) {
    startTransition(async () => {
      try {
        const result = await action(
          responses,
          privacy ? flags : null,
          final,
          burns ? extras : undefined,
        );
        if (!result.ok) {
          setErrors(result.errors);
          return;
        }
        onOk();
      } catch {
        setErrors((prev) => ({ ...prev, [FORM_ERROR_KEY]: SAVE_FAILED }));
      }
    });
  }

  function handleNext() {
    const current = steps[stepIndex];
    if (current?.kind === "page" && !validatePage(current.page)) return;
    const advance = () =>
      setStepIndex((i) => Math.min(i + 1, steps.length - 1));
    if (persistProgress) persist(false, advance);
    else advance();
  }

  function handleSubmit() {
    const current = steps[stepIndex];
    if (current?.kind === "page" && !validatePage(current.page)) return;
    persist(true, () => {
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {answeredProgress
              ? `${answeredStats.answered} of ${answeredStats.total} answered`
              : `Step ${stepIndex + 1} of ${steps.length}`}
          </span>
          <span>{progress}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {step.kind === "burns" && burns ? (
        <BurnsAndVolunteeringStep
          value={extras ?? burns.initial}
          onChange={setExtras}
          searchCamps={burns.searchCamps}
        />
      ) : step.kind === "privacy" && privacy ? (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold">Privacy</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose what shows on your public profile. Sensitive fields are
              locked private and can never be made public.
            </p>
          </div>
          <PrivacyToggles
            fields={privacy.fields}
            flags={flags}
            onChange={(key, isPublic) =>
              setFlags((prev) => ({ ...prev, [key]: isPublic }))
            }
          />
        </div>
      ) : step.kind === "page" && step.page.kind === "intro" ? (
        <div className="flex flex-col gap-3 py-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            {step.page.heading}
          </h2>
          <p className="text-muted-foreground">{step.page.body}</p>
        </div>
      ) : step.kind === "page" && step.page.kind === "questions" ? (
        <div className="flex flex-col gap-5">
          <div>
            <h2 className="text-lg font-semibold">{step.page.title}</h2>
            {step.page.subtitle && (
              <p className="mt-1 text-sm text-muted-foreground">
                {step.page.subtitle}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-5">
            {step.page.questions.map((q) => (
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
      ) : null}

      {(errors[FORM_ERROR_KEY] || errors._root) && (
        <p role="alert" className="text-sm text-destructive">
          {errors[FORM_ERROR_KEY] ?? errors._root}
        </p>
      )}

      <div
        className={`flex items-center gap-3 border-t border-border pt-4 ${
          soloSubmit ? "" : "justify-between"
        }`}
      >
        {!soloSubmit && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            disabled={stepIndex === 0 || isPending}
          >
            Back
          </Button>
        )}
        {isLast ? (
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className={soloSubmit ? "w-full" : ""}
          >
            {isPending ? "Saving…" : submitLabel}
          </Button>
        ) : (
          <Button type="button" onClick={handleNext} disabled={isPending}>
            {isPending ? "Saving…" : "Next"}
          </Button>
        )}
      </div>
    </div>
  );
}
