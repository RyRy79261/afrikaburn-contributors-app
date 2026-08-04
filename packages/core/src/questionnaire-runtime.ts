// Questionnaire RUNTIME (questionnaire-spec §"Builder v2" logic + respondent
// UX). Everything the runner needs to decide *what a respondent sees next* and
// *whether they are done*, derived purely from a definition + the answers so
// far. The server re-derives the same things at submit time, so a respondent
// cannot skip a required question by posting a hand-made payload.
//
// Branch semantics (Google Forms): a section's target is chosen by the LAST
// answered single-choice question on that section whose selected option
// carries a `goTo`. Failing that, the section's own `next`. Failing that, the
// following section in document order — and past the last section, submit.
//
// Pure — no I/O, no env, no randomness that isn't seeded.

import {
  SUBMIT_TARGET,
  pageBlocks,
  pageQuestions,
  validateOne,
  type PageBlock,
  type Question,
  type QuestionOption,
  type Questionnaire,
  type QuestionnairePage,
  type QuestionnaireResponses,
} from "@quagga/types";

/** Look one page up by id. */
export function pageById(
  questionnaire: Questionnaire,
  pageId: string,
): QuestionnairePage | null {
  return questionnaire.pages.find((p) => p.id === pageId) ?? null;
}

/**
 * The next page id after `pageId` given the answers so far, or null when the
 * questionnaire ends here (submit).
 */
export function nextPageId(
  questionnaire: Questionnaire,
  pageId: string,
  responses: QuestionnaireResponses,
): string | null {
  const index = questionnaire.pages.findIndex((p) => p.id === pageId);
  const page = questionnaire.pages[index];
  if (!page) return null;

  // Last branching question on the page wins.
  let branched: string | null = null;
  for (const block of pageBlocks(page)) {
    if (block.kind !== "single_select") continue;
    const answer = responses[block.id];
    if (typeof answer !== "string") continue;
    const chosen = block.options.find((o) => o.value === answer);
    if (chosen?.goTo) branched = chosen.goTo;
  }

  const target = branched ?? page.next ?? nextInOrder(questionnaire, index);
  if (target === SUBMIT_TARGET || target === null) return null;
  return pageById(questionnaire, target) ? target : null;
}

function nextInOrder(
  questionnaire: Questionnaire,
  index: number,
): string | null {
  const following = questionnaire.pages[index + 1];
  return following ? following.id : null;
}

/**
 * The ordered page ids a respondent actually walks given their answers — the
 * branch-resolved path from the first page to submit.
 *
 * Loops are rejected at definition time (branches must move forward), but this
 * still carries a visited-set guard so a legacy or hand-edited definition
 * degrades into a truncated path instead of hanging the server.
 */
export function resolvePath(
  questionnaire: Questionnaire,
  responses: QuestionnaireResponses,
): string[] {
  const first = questionnaire.pages[0];
  if (!first) return [];
  const path: string[] = [];
  const visited = new Set<string>();
  let current: string | null = first.id;
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    path.push(current);
    current = nextPageId(questionnaire, current, responses);
  }
  return path;
}

/** The answerable questions on the branch-resolved path, in walk order. */
export function visibleQuestions(
  questionnaire: Questionnaire,
  responses: QuestionnaireResponses,
): Question[] {
  const out: Question[] = [];
  for (const pageId of resolvePath(questionnaire, responses)) {
    const page = pageById(questionnaire, pageId);
    if (page) out.push(...pageQuestions(page));
  }
  return out;
}

/** True when a question has a usable answer (present AND valid for its kind). */
export function hasAnswer(question: Question, value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  const result = validateOne(question, value);
  return result.ok && result.value !== undefined;
}

/** Progress/completeness derivation — feeds the runner's progress bar and the
 * results view's "who is actually done". Counts only questions on the
 * respondent's own branch-resolved path; a required question inside a section
 * they branched past can never block them. */
export interface QuestionnaireProgress {
  /** Branch-resolved page ids, in walk order. */
  path: string[];
  /** Index of `currentPageId` within `path`, or -1 when not on the path. */
  pageIndex: number;
  pageCount: number;
  answered: number;
  total: number;
  requiredAnswered: number;
  requiredTotal: number;
  /** 0–100, by required completion (falls back to overall when nothing is
   * required, and to 100 for an empty questionnaire). */
  percent: number;
  /** Every required question on the path has a valid answer. */
  complete: boolean;
}

export function deriveProgress(
  questionnaire: Questionnaire,
  responses: QuestionnaireResponses,
  currentPageId?: string,
): QuestionnaireProgress {
  const path = resolvePath(questionnaire, responses);
  let answered = 0;
  let total = 0;
  let requiredAnswered = 0;
  let requiredTotal = 0;

  for (const pageId of path) {
    const page = pageById(questionnaire, pageId);
    if (!page) continue;
    for (const question of pageQuestions(page)) {
      const ok = hasAnswer(question, responses[question.id]);
      total += 1;
      if (ok) answered += 1;
      if (isRequired(question)) {
        requiredTotal += 1;
        if (ok) requiredAnswered += 1;
      }
    }
  }

  const denominator = requiredTotal > 0 ? requiredTotal : total;
  const numerator = requiredTotal > 0 ? requiredAnswered : answered;
  const percent =
    denominator === 0 ? 100 : Math.round((numerator / denominator) * 100);

  return {
    path,
    pageIndex: currentPageId ? path.indexOf(currentPageId) : -1,
    pageCount: path.length,
    answered,
    total,
    requiredAnswered,
    requiredTotal,
    percent,
    complete: requiredAnswered === requiredTotal,
  };
}

function isRequired(question: Question): boolean {
  return "required" in question && question.required === true;
}

/**
 * Server-side response validation for a SUBMIT, branch-aware.
 *
 * Differs from `@quagga/types`' `validateResponses` (which validates every
 * question in the definition) in exactly one way that matters for Builder v2:
 * questions the respondent branched PAST are neither required nor kept. That
 * makes branching safe both ways — a skipped required question can't block a
 * legitimate submission, and answers to skipped questions can't be smuggled
 * into the stored response.
 */
export function validateSubmission(
  questionnaire: Questionnaire,
  raw: unknown,
):
  | {
      ok: true;
      responses: QuestionnaireResponses;
      progress: QuestionnaireProgress;
    }
  | { ok: false; errors: Record<string, string> } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: { _root: "Malformed response payload" } };
  }
  const incoming = raw as Record<string, unknown>;

  // Resolve the path against the RAW answers so branch-driving answers count,
  // then validate only what that path exposes.
  const driving: QuestionnaireResponses = {};
  for (const question of allQuestions(questionnaire)) {
    const value = incoming[question.id];
    const result = validateOne(question, value);
    if (result.ok && result.value !== undefined) {
      driving[question.id] = result.value;
    }
  }

  const responses: QuestionnaireResponses = {};
  const errors: Record<string, string> = {};
  for (const question of visibleQuestions(questionnaire, driving)) {
    const result = validateOne(question, incoming[question.id]);
    if (!result.ok) {
      errors[question.id] = result.error;
      continue;
    }
    if (result.value !== undefined) responses[question.id] = result.value;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    responses,
    progress: deriveProgress(questionnaire, responses),
  };
}

/** Every answerable question in document order, path-independent. */
export function allQuestions(questionnaire: Questionnaire): Question[] {
  const out: Question[] = [];
  for (const page of questionnaire.pages) out.push(...pageQuestions(page));
  return out;
}

// --- Shuffle -------------------------------------------------------------
// Deterministic, seeded shuffles: a respondent must see a STABLE order across
// page revisits and reloads, so the runner passes a per-response seed (e.g.
// the user id) rather than calling Math.random.

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  let state = hash(seed) || 1;
  for (let i = out.length - 1; i > 0; i--) {
    // xorshift32 — deterministic and dependency-free.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const j = state % (i + 1);
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

/** A page's blocks in presentation order — shuffled when the section asks for
 * it, document order otherwise. */
export function presentationBlocks(
  page: QuestionnairePage,
  seed: string,
): PageBlock[] {
  const blocks = pageBlocks(page);
  if (page.kind !== "questions" || !page.shuffleQuestions) return blocks;
  return seededShuffle(blocks, `${seed}:${page.id}`);
}

/** A choice question's options in presentation order — shuffled when the
 * question asks for it. Options carrying a `goTo` shuffle like any other; the
 * branch follows the VALUE, never the position. */
export function presentationOptions(
  question: Question,
  seed: string,
): QuestionOption[] {
  if (question.kind !== "single_select" && question.kind !== "multi_select") {
    return [];
  }
  if (!question.shuffleOptions) return [...question.options];
  return seededShuffle(question.options, `${seed}:${question.id}`);
}
