// Questionnaire RESULTS aggregation (questionnaire-spec §"Author/admin
// features": "response summary view with per-question charts"). One aggregate
// per question, shaped for the chart the question type deserves — choice
// counts as bars, scales/ratings as histograms with an average.
//
// Deliberately chart-library agnostic: this returns numbers + labels, the
// Results v2 pages decide how to draw them.
//
// Two robustness properties matter here, because definitions are editable
// while responses already exist:
//   1. A question added AFTER some responses were collected reports honest
//      skip counts rather than pretending everyone declined.
//   2. Answers whose question was DELETED are not silently dropped —
//      `orphanAnswers` surfaces them so the author can see the data exists.
//
// Pure — no I/O, no env.

import {
  isOtherAnswer,
  otherAnswerText,
  type Question,
  type Questionnaire,
  type QuestionnaireResponses,
} from "@quagga/types";
import { allQuestions } from "./questionnaire-runtime";

/** Counts for one selectable option. `percent` is of respondents who ANSWERED
 * this question (Google Forms' denominator), not of everyone sent it. */
export interface OptionTally {
  value: string;
  label: string;
  count: number;
  percent: number;
}

/** A free-text "Other…" answer and how many people gave it. */
export interface OtherTally {
  text: string;
  count: number;
}

/** One bucket of a scale/rating histogram. */
export interface ScaleBucket {
  value: number;
  count: number;
  percent: number;
}

interface AggregateBase {
  questionId: string;
  prompt: string;
  questionKind: Question["kind"];
  /** Responses that contained a usable answer to this question. */
  responded: number;
  /** Responses that left it blank (submitted-but-skipped). */
  skipped: number;
  /** Total responses considered. */
  total: number;
}

export type QuestionAggregate =
  | (AggregateBase & {
      chart: "choice";
      options: OptionTally[];
      other: OtherTally[];
    })
  | (AggregateBase & {
      chart: "scale";
      min: number;
      max: number;
      minLabel: string | null;
      maxLabel: string | null;
      buckets: ScaleBucket[];
      average: number | null;
    })
  | (AggregateBase & {
      chart: "rating";
      steps: number;
      buckets: ScaleBucket[];
      average: number | null;
    })
  | (AggregateBase & {
      chart: "boolean";
      yes: number;
      no: number;
      percentYes: number;
    })
  | (AggregateBase & {
      chart: "text";
      /** Every answer, newest-input order preserved — the per-question
       * breakdown list. Long-text questions get no chart, just the answers. */
      answers: string[];
    })
  | (AggregateBase & {
      chart: "timeline";
      /** Sorted distinct values with counts (dates as yyyy-mm-dd, times as
       * hh:mm) — a small histogram or just a list. */
      buckets: { value: string; count: number; percent: number }[];
      earliest: string | null;
      latest: string | null;
    });

/** Answers whose question no longer exists in the definition — kept visible so
 * an author who deleted a question can still see the data was collected. */
export interface OrphanAnswers {
  questionId: string;
  count: number;
}

export interface QuestionnaireResults {
  totalResponses: number;
  questions: QuestionAggregate[];
  orphans: OrphanAnswers[];
}

function pct(count: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((count / denominator) * 1000) / 10;
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  return Array.isArray(value) && value.length === 0;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function chosenValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
  if (typeof value === "boolean") return [value ? "true" : "false"];
  return [];
}

function aggregateOne(
  question: Question,
  responses: readonly QuestionnaireResponses[],
): QuestionAggregate {
  const values = responses.map((r) => r[question.id]);
  const present = values.filter((v) => !isBlank(v));
  const base: AggregateBase = {
    questionId: question.id,
    prompt: question.prompt,
    questionKind: question.kind,
    responded: present.length,
    skipped: values.length - present.length,
    total: values.length,
  };
  const denominator = present.length;

  switch (question.kind) {
    case "single_select":
    case "multi_select": {
      const counts = new Map<string, number>();
      const others = new Map<string, number>();
      for (const value of present) {
        for (const chosen of chosenValues(value)) {
          if (isOtherAnswer(chosen)) {
            const text = otherAnswerText(chosen).trim();
            others.set(text, (others.get(text) ?? 0) + 1);
            continue;
          }
          counts.set(chosen, (counts.get(chosen) ?? 0) + 1);
        }
      }
      const options: OptionTally[] = question.options.map((o) => {
        const count = counts.get(o.value) ?? 0;
        return { value: o.value, label: o.label, count, percent: pct(count, denominator) };
      });
      // Values not in the definition any more (option deleted after answers
      // came in) still get a row, labelled by their raw value.
      for (const [value, count] of counts) {
        if (question.options.some((o) => o.value === value)) continue;
        options.push({ value, label: value, count, percent: pct(count, denominator) });
      }
      const other: OtherTally[] = [...others.entries()]
        .map(([text, count]) => ({ text, count }))
        .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
      return { ...base, chart: "choice", options, other };
    }

    case "boolean": {
      let yes = 0;
      let no = 0;
      for (const value of present) {
        if (value === true) yes += 1;
        else if (value === false) no += 1;
      }
      return {
        ...base,
        chart: "boolean",
        yes,
        no,
        percentYes: pct(yes, yes + no),
      };
    }

    case "linear_scale": {
      const { buckets, average } = numericHistogram(
        present,
        question.min,
        question.max,
        denominator,
      );
      return {
        ...base,
        chart: "scale",
        min: question.min,
        max: question.max,
        minLabel: question.minLabel ?? null,
        maxLabel: question.maxLabel ?? null,
        buckets,
        average,
      };
    }

    case "rating": {
      const { buckets, average } = numericHistogram(
        present,
        1,
        question.steps,
        denominator,
      );
      return { ...base, chart: "rating", steps: question.steps, buckets, average };
    }

    case "date":
    case "time":
    case "years": {
      const counts = new Map<string, number>();
      for (const value of present) {
        for (const v of chosenValues(value)) {
          counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      }
      const buckets = [...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([value, count]) => ({ value, count, percent: pct(count, denominator) }));
      return {
        ...base,
        chart: "timeline",
        buckets,
        earliest: buckets[0]?.value ?? null,
        latest: buckets[buckets.length - 1]?.value ?? null,
      };
    }

    case "short_text":
    case "long_text":
    case "email":
    case "phone":
    case "file_link": {
      const answers = present
        .map((v) => (typeof v === "string" ? v : String(v)))
        .filter((v) => v !== "");
      return { ...base, chart: "text", answers };
    }
  }
}

function numericHistogram(
  present: readonly unknown[],
  min: number,
  max: number,
  denominator: number,
): { buckets: ScaleBucket[]; average: number | null } {
  const counts = new Map<number, number>();
  let sum = 0;
  let n = 0;
  for (const value of present) {
    const num = asNumber(value);
    if (num === null) continue;
    counts.set(num, (counts.get(num) ?? 0) + 1);
    sum += num;
    n += 1;
  }
  const buckets: ScaleBucket[] = [];
  for (let v = min; v <= max; v++) {
    const count = counts.get(v) ?? 0;
    buckets.push({ value: v, count, percent: pct(count, denominator) });
  }
  // Out-of-range answers (a scale narrowed after collection) keep their bucket.
  for (const [value, count] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    if (value >= min && value <= max) continue;
    buckets.push({ value, count, percent: pct(count, denominator) });
  }
  return {
    buckets,
    average: n === 0 ? null : Math.round((sum / n) * 100) / 100,
  };
}

/**
 * Aggregate a set of submitted responses against the definition they answered.
 * Feeds Results v2's per-question summary; the per-user completion table stays
 * `tallyActivationCompletion`'s job.
 */
export function aggregateResponses(
  questionnaire: Questionnaire,
  responses: readonly QuestionnaireResponses[],
): QuestionnaireResults {
  const questions = allQuestions(questionnaire);
  const known = new Set(questions.map((q) => q.id));

  const orphanCounts = new Map<string, number>();
  for (const response of responses) {
    for (const [key, value] of Object.entries(response)) {
      if (known.has(key) || isBlank(value)) continue;
      orphanCounts.set(key, (orphanCounts.get(key) ?? 0) + 1);
    }
  }

  return {
    totalResponses: responses.length,
    questions: questions.map((q) => aggregateOne(q, responses)),
    orphans: [...orphanCounts.entries()]
      .map(([questionId, count]) => ({ questionId, count }))
      .sort((a, b) => a.questionId.localeCompare(b.questionId)),
  };
}

/** Aggregate a single question — the per-question breakdown drill-down. */
export function aggregateQuestion(
  question: Question,
  responses: readonly QuestionnaireResponses[],
): QuestionAggregate {
  return aggregateOne(question, responses);
}
