"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  isAnswerableBlock,
  pageQuestions,
  validateOne,
  type Questionnaire,
  type QuestionnairePage,
  type QuestionnaireResponses,
  type QuestionnaireResponseValue,
  type SaveResult,
} from "@quagga/types";
import {
  deriveProgress,
  nextPageId,
  pageById,
  presentationBlocks,
} from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { QuestionField } from "./field";
import { ContentBlockView } from "./content-block";

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
  /** Seed for the deterministic block shuffle. Must be STABLE for a given
   *  respondent+questionnaire so the order never moves on reload. */
  shuffleSeed?: string;
}

/**
 * Console questionnaire runner — the org-internal blocking gate's fill view and
 * any console-side answering.
 *
 * Navigation and completeness are delegated to the @quagga/core questionnaire
 * runtime, exactly as the participant runner (apps/web) and the author preview
 * (components/questionnaires/questionnaire-preview.tsx) do: `nextPageId` for
 * branching, `deriveProgress` for the branch-resolved path, `presentationBlocks`
 * for content blocks + the seeded shuffle.
 *
 * It used to walk `questionnaire.pages` by index and render `pageQuestions()`,
 * which meant this app ignored two things the SAME app authors and previews:
 *   · BRANCHING — every section was shown in document order, so an option whose
 *     `goTo` skips a section didn't skip it, and a "not applicable to you"
 *     branch was demanded of everyone before the console would unlock;
 *   · CONTENT BLOCKS — `pageQuestions()` drops info panels and images, so the
 *     explanatory panel above a question simply wasn't there.
 * The privacy step is still absent (console questionnaires never carry
 * Burner-Bio privacy flags), which is the only intended difference.
 */
export function QuestionnaireRunner({
  questionnaire,
  initialResponses,
  action,
  submitLabel = "Finish",
  redirectTo,
  shuffleSeed = "",
}: RunnerProps) {
  const router = useRouter();
  const firstPageId = questionnaire.pages[0]?.id ?? null;

  // The trail is the respondent's ACTUAL walk — with branching, the page after
  // this one depends on the answers, so Back pops rather than decrementing.
  const [trail, setTrail] = React.useState<string[]>(() =>
    firstPageId ? [firstPageId] : [],
  );
  const [responses, setResponses] =
    React.useState<QuestionnaireResponses>(initialResponses);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [isPending, startTransition] = React.useTransition();

  const currentPageId = trail[trail.length - 1];

  const progress = React.useMemo(
    () => deriveProgress(questionnaire, responses, currentPageId),
    [questionnaire, responses, currentPageId],
  );
  const nextId = React.useMemo(
    () =>
      currentPageId
        ? nextPageId(questionnaire, currentPageId, responses)
        : null,
    [questionnaire, currentPageId, responses],
  );

  const step = currentPageId ? pageById(questionnaire, currentPageId) : null;
  if (!step || !currentPageId) return null;

  const isLast = nextId === null;
  // Steps are counted along the BRANCH-RESOLVED path, so the total shrinks or
  // grows as an answer changes which sections lie ahead.
  const stepNumber = Math.max(progress.pageIndex, 0) + 1;
  const percent =
    progress.pageCount > 0
      ? Math.round((stepNumber / progress.pageCount) * 100)
      : 100;

  function setResponse(id: string, value: QuestionnaireResponseValue) {
    setResponses((prev) => ({ ...prev, [id]: value }));
    setErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  /** Client-side mirror of the server's per-question validation — the same
   * `validateOne` the submit action runs, so what passes here passes there. */
  function validatePage(page: QuestionnairePage): boolean {
    const next: Record<string, string> = {};
    for (const q of pageQuestions(page)) {
      const result = validateOne(q, responses[q.id]);
      if (!result.ok) next[q.id] = result.error;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function currentPageValid(): boolean {
    const page = currentPageId ? pageById(questionnaire, currentPageId) : null;
    return page ? validatePage(page) : true;
  }

  function handleNext() {
    if (!currentPageValid()) return;
    if (nextId === null) return;
    setTrail((prev) => [...prev, nextId]);
  }

  function handleSubmit() {
    if (!currentPageValid()) return;
    startTransition(async () => {
      try {
        const result = await action(responses);
        if (!result.ok) {
          setErrors(result.errors);
          // A rejection naming a question that isn't on this page is otherwise a
          // dead end — the message would be set on a field nobody can see, and
          // the gate would sit there doing nothing on every press of Submit.
          // Jump to the page that owns the first failing question instead.
          const target = pageOwningError(questionnaire, result.errors);
          if (target && target !== currentPageId) jumpTo(target);
          return;
        }
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } catch {
        setErrors((prev) => ({ ...prev, [FORM_ERROR_KEY]: SAVE_FAILED }));
      }
    });
  }

  /** Rewind the trail to a page already walked, or start a fresh trail at it. */
  function jumpTo(pageId: string) {
    setTrail((prev) => {
      const at = prev.indexOf(pageId);
      return at >= 0 ? prev.slice(0, at + 1) : [pageId];
    });
  }

  // A server error keyed to a question that is not on the page now showing.
  // `pageOwningError` normally walks to it; this covers the case where the
  // question belongs to no reachable page at all (a definition edited under a
  // live activation), which would otherwise render nothing at all.
  const currentIds = new Set(pageQuestions(step).map((q) => q.id));
  const offPageError = Object.keys(errors).some(
    (k) => !k.startsWith("_") && !currentIds.has(k),
  );

  return (
    <div className="flex flex-col gap-6">
      {progress.pageCount > 1 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Step {stepNumber} of {progress.pageCount}
            </span>
            <span>{percent}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${percent}%` }}
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
            {presentationBlocks(step, shuffleSeed).map((block) =>
              isAnswerableBlock(block) ? (
                <QuestionField
                  key={block.id}
                  question={block}
                  value={responses[block.id]}
                  error={errors[block.id]}
                  onChange={(value) => setResponse(block.id, value)}
                />
              ) : (
                <ContentBlockView key={block.id} block={block} />
              ),
            )}
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
          onClick={() => setTrail((prev) => prev.slice(0, -1))}
          disabled={trail.length <= 1 || isPending}
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

/** The page holding the first question the server rejected, so an off-page
 * rejection can be surfaced instead of silently swallowed. */
function pageOwningError(
  questionnaire: Questionnaire,
  errors: Record<string, string>,
): string | null {
  const ids = new Set(
    Object.keys(errors).filter((k) => k !== FORM_ERROR_KEY && k !== "_root"),
  );
  if (ids.size === 0) return null;
  for (const page of questionnaire.pages) {
    for (const q of pageQuestions(page)) {
      if (ids.has(q.id)) return page.id;
    }
  }
  return null;
}
