"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
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
  presentationOptions,
  type BioPrivacyField,
} from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { cn } from "@quagga/ui/lib/utils";
import { PrivacyToggles } from "../privacy-toggles";
import { QuestionField } from "./field";
import { ContentBlockView } from "./content-block";
import {
  BurnsAndVolunteeringStep,
  type BioExtrasState,
} from "./burns-step";
import type { CampSearchResult } from "@/lib/groups-store";

// Runner v2 (questionnaire-spec §"Respondent (runner) UX"). Every navigation
// and completeness decision is delegated to the @quagga/core questionnaire
// runtime — `nextPageId` (branching), `deriveProgress` (progress + the
// branch-resolved path), `presentationBlocks`/`presentationOptions` (seeded,
// reload-stable shuffle) — so the client walks exactly the path the server
// re-derives at submit time. Content blocks (info/image) render inline but are
// never answerable and never counted.

const FORM_ERROR_KEY = "_form";
const SAVE_FAILED =
  "We couldn't save your answers just now. Please try again in a moment.";
const DRAFT_PREFIX = "quagga:questionnaire-draft:";
const AUTOSAVE_DEBOUNCE_MS = 700;

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
  /** Seed for the deterministic question/option shuffle. Stable per respondent
   * (e.g. `${activationId}:${userId}`) so the order never moves on reload. */
  shuffleSeed?: string;
  /** Enables local draft autosave under this key (survives reload/offline).
   * Answers still only reach the server on submit. */
  draftKey?: string;
}

type Step =
  | { kind: "page"; pageId: string }
  | { kind: "burns" }
  | { kind: "privacy" };

type SaveState = "idle" | "saving" | "saved" | "unsaved";

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
  shuffleSeed = "",
  draftKey,
}: RunnerProps) {
  const router = useRouter();
  const firstPageId = questionnaire.pages[0]?.id ?? null;

  // The trail is the respondent's ACTUAL walk (branching means the page after
  // this one depends on the answers) — Back pops, Next pushes.
  const [trail, setTrail] = React.useState<Step[]>(() =>
    firstPageId
      ? [{ kind: "page", pageId: firstPageId }]
      : burns
        ? [{ kind: "burns" }]
        : privacy
          ? [{ kind: "privacy" }]
          : [],
  );
  const [responses, setResponses] =
    React.useState<QuestionnaireResponses>(initialResponses);
  const [flags, setFlags] = React.useState<Record<string, boolean>>(
    privacy?.initialFlags ?? {},
  );
  const [extras, setExtras] = React.useState<BioExtrasState | null>(
    burns?.initial ?? null,
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [isPending, startTransition] = React.useTransition();

  const step = trail[trail.length - 1];
  const currentPageId = step?.kind === "page" ? step.pageId : undefined;

  // --- Local draft autosave --------------------------------------------
  // Zero-connectivity culture: a half-filled questionnaire must survive a
  // reload or a dropped signal. The draft is LOCAL only — nothing is sent to
  // the server until submit, so no half-answers land in the response store.
  const storageKey = draftKey ? `${DRAFT_PREFIX}${draftKey}` : null;
  const hydrated = React.useRef(false);

  React.useEffect(() => {
    if (!storageKey || hydrated.current) return;
    hydrated.current = true;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        setResponses((prev) => ({
          ...prev,
          ...(parsed as QuestionnaireResponses),
        }));
        setSaveState("saved");
      }
    } catch {
      // A corrupt or unavailable draft is never fatal — start clean.
    }
  }, [storageKey]);

  React.useEffect(() => {
    if (!storageKey || !hydrated.current || saveState !== "unsaved") return;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(responses));
        setSaveState("saved");
      } catch {
        setSaveState("idle");
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [responses, storageKey, saveState]);

  function clearDraft() {
    if (!storageKey) return;
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Nothing to do — the draft is a convenience, not a source of truth.
    }
  }

  // --- Progress ---------------------------------------------------------
  // deriveProgress walks the BRANCH-RESOLVED path and counts answerable
  // questions only (content blocks are excluded upstream).
  const progress = React.useMemo(
    () => deriveProgress(questionnaire, responses, currentPageId),
    [questionnaire, responses, currentPageId],
  );

  const tailSteps = (burns ? 1 : 0) + (privacy ? 1 : 0);
  const totalSteps = progress.pageCount + tailSteps;
  const stepNumber =
    step?.kind === "page"
      ? Math.max(progress.pageIndex, 0) + 1
      : step?.kind === "burns"
        ? progress.pageCount + 1
        : progress.pageCount + tailSteps;

  const percent =
    answeredProgress && progress.total > 0
      ? Math.round((progress.answered / progress.total) * 100)
      : totalSteps > 0
        ? Math.round((stepNumber / totalSteps) * 100)
        : 100;

  const nextStep = React.useMemo(
    () => resolveNextStep(questionnaire, responses, step, Boolean(burns), Boolean(privacy)),
    [questionnaire, responses, step, burns, privacy],
  );
  const isLast = nextStep === null;
  const soloSubmit = fullWidthSubmit && isLast && trail.length === 1;

  const rail = React.useMemo(
    () => buildRail(questionnaire, progress.path, Boolean(burns), Boolean(privacy)),
    [questionnaire, progress.path, burns, privacy],
  );
  const railIndex =
    step?.kind === "page"
      ? progress.pageIndex
      : step?.kind === "burns"
        ? progress.pageCount
        : rail.length - 1;

  if (!step) return null;

  function setResponse(id: string, value: QuestionnaireResponseValue) {
    setResponses((prev) => ({ ...prev, [id]: value }));
    setSaveState("unsaved");
    setErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  /** Client-side mirror of the server's per-question validation — same
   * `validateOne` the server runs inside `validateSubmission`, so what passes
   * here passes there. */
  function validatePage(page: QuestionnairePage): boolean {
    const next: Record<string, string> = {};
    for (const q of pageQuestions(page)) {
      const result = validateOne(q, responses[q.id]);
      if (!result.ok) next[q.id] = result.error;
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
          // A server error on a question the respondent can't see is a dead
          // end — jump to the page that owns the first failing question.
          const target = pageOwningError(questionnaire, result.errors);
          if (target && target !== currentPageId) jumpTo(target);
          return;
        }
        if (final) clearDraft();
        onOk();
      } catch {
        setErrors((prev) => ({ ...prev, [FORM_ERROR_KEY]: SAVE_FAILED }));
      }
    });
  }

  /** Rewind the trail to a page already walked, or start a fresh trail at it. */
  function jumpTo(pageId: string) {
    setTrail((prev) => {
      const at = prev.findIndex(
        (s) => s.kind === "page" && s.pageId === pageId,
      );
      return at >= 0 ? prev.slice(0, at + 1) : [{ kind: "page", pageId }];
    });
  }

  function handleNext() {
    const current = trail[trail.length - 1];
    if (current?.kind === "page") {
      const page = pageById(questionnaire, current.pageId);
      if (page && !validatePage(page)) return;
    }
    const target = nextStep;
    if (!target) return;
    const advance = () => setTrail((prev) => [...prev, target]);
    if (persistProgress) persist(false, advance);
    else advance();
  }

  function handleSubmit() {
    const current = trail[trail.length - 1];
    if (current?.kind === "page") {
      const page = pageById(questionnaire, current.pageId);
      if (page && !validatePage(page)) return;
    }
    persist(true, () => {
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  const page =
    step.kind === "page" ? pageById(questionnaire, step.pageId) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {rail.length > 1 && (
          <div className="flex items-center justify-between gap-3">
            <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              {rail.map((entry, i) => {
                const state =
                  i < railIndex ? "done" : i === railIndex ? "current" : "upcoming";
                return (
                  <li key={entry.key} className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                        state === "current" &&
                          "border-primary bg-primary text-primary-foreground",
                        state === "done" &&
                          "border-primary bg-primary/15 text-primary",
                        state === "upcoming" &&
                          "border-border bg-muted text-muted-foreground",
                      )}
                    >
                      {state === "done" ? (
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        i + 1
                      )}
                    </span>
                    <span
                      className={cn(
                        "hidden max-w-[12rem] truncate text-xs font-medium sm:inline",
                        state === "upcoming"
                          ? "text-muted-foreground"
                          : "text-foreground",
                      )}
                    >
                      {entry.label}
                    </span>
                  </li>
                );
              })}
            </ol>
            <span className="shrink-0 text-xs text-muted-foreground">
              Page {stepNumber} of {totalSteps}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {answeredProgress
              ? `${progress.answered} of ${progress.total} answered`
              : `Step ${stepNumber} of ${totalSteps}`}
          </span>
          <span>{percent}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${percent}%` }}
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
      ) : page && page.kind === "intro" ? (
        <div className="flex flex-col gap-3 py-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            {page.heading}
          </h2>
          <p className="text-muted-foreground">{page.body}</p>
        </div>
      ) : page && page.kind === "questions" ? (
        <div className="flex flex-col gap-5">
          <div>
            {rail.length > 1 && (
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
                Section {stepNumber} of {totalSteps}
              </p>
            )}
            <h2 className="mt-1 text-lg font-semibold">{page.title}</h2>
            {page.subtitle && (
              <p className="mt-1 text-sm text-muted-foreground">
                {page.subtitle}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-5">
            {presentationBlocks(page, shuffleSeed).map((block) =>
              isAnswerableBlock(block) ? (
                <QuestionField
                  key={block.id}
                  question={block}
                  value={responses[block.id]}
                  error={errors[block.id]}
                  options={presentationOptions(block, shuffleSeed)}
                  onChange={(value) => setResponse(block.id, value)}
                />
              ) : (
                <ContentBlockView key={block.id} block={block} />
              ),
            )}
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
            onClick={() => setTrail((prev) => prev.slice(0, -1))}
            disabled={trail.length <= 1 || isPending}
          >
            Back
          </Button>
        )}
        <div
          className={cn(
            "flex items-center gap-3",
            soloSubmit && "w-full flex-col-reverse sm:flex-row",
          )}
        >
          {draftKey && <AutosaveIndicator state={saveState} />}
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
    </div>
  );
}

function AutosaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  if (state === "saving" || state === "unsaved") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Saving…
      </span>
    );
  }
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      title="Your answers are kept on this device until you submit."
    >
      <Check className="h-3.5 w-3.5 text-success" aria-hidden />
      Saved on this device
    </span>
  );
}

/** The step after `step`, or null when the questionnaire ends here (submit). */
function resolveNextStep(
  questionnaire: Questionnaire,
  responses: QuestionnaireResponses,
  step: Step | undefined,
  hasBurns: boolean,
  hasPrivacy: boolean,
): Step | null {
  if (!step) return null;
  if (step.kind === "privacy") return null;
  if (step.kind === "burns") return hasPrivacy ? { kind: "privacy" } : null;
  const next = nextPageId(questionnaire, step.pageId, responses);
  if (next) return { kind: "page", pageId: next };
  if (hasBurns) return { kind: "burns" };
  if (hasPrivacy) return { kind: "privacy" };
  return null;
}

interface RailEntry {
  key: string;
  label: string;
}

/** Labels for the step rail: the branch-resolved pages plus any bespoke tail
 * steps. Re-derived from `progress.path`, so a branch change reshapes it. */
function buildRail(
  questionnaire: Questionnaire,
  path: readonly string[],
  hasBurns: boolean,
  hasPrivacy: boolean,
): RailEntry[] {
  const out: RailEntry[] = [];
  for (const pageId of path) {
    const page = pageById(questionnaire, pageId);
    if (!page) continue;
    out.push({
      key: pageId,
      label: page.kind === "questions" ? page.title : page.heading,
    });
  }
  if (hasBurns) out.push({ key: "__burns__", label: "Burns & volunteering" });
  if (hasPrivacy) out.push({ key: "__privacy__", label: "Privacy" });
  return out;
}

/** The page holding the first question the server rejected (so the runner can
 * surface an off-page validation error instead of silently swallowing it). */
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
