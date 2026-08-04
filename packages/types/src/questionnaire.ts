import { z } from "zod";

// Ported from the Camp 404 questionnaire spine. The Burner Bio onboarding flow
// dispatches through this engine (a "code questionnaire" writing into the
// bespoke `burner_bios` table); future gated flows may author definitions in
// `questionnaire_definitions` and store answers in `questionnaire_responses`.
//
// Lenient formats — no extra deps. Email is RFC-lite; phone accepts +, spaces,
// dashes, parens and is digit-bounded (7–15, the E.164 range).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s().-]{7,20}$/;
const URL_RE = /^https?:\/\/[^\s/$.?#][^\s]*$/i;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ALNUM_RE = /^[a-z0-9 ]+$/i;

// --- Builder v2 (questionnaire-spec §"Builder v2 — Google Forms parity") ---
// Everything below lives INSIDE the `definition` jsonb — no schema columns.
// Every field added here is optional (or defaulted on a brand-new kind), so a
// definition written before Builder v2 still parses and renders unchanged.

/** Reserved branch target meaning "end the questionnaire here, go to submit".
 * Page ids may never equal it (enforced by validateQuestionnaireDefinition). */
export const SUBMIT_TARGET = "__submit__";

/** Encoding for an "Other…" free-text answer on a choice question: the stored
 * value is `other:<the text the respondent typed>`. Keeping it in the same
 * flat response map (rather than a companion key) means Builder v2 needs no
 * change to `questionnaire_responses.responses`. Option values may not start
 * with this prefix (enforced at definition time). */
export const OTHER_PREFIX = "other:";

/** True when a choice answer is an "Other…" free-text entry. */
export function isOtherAnswer(value: string): boolean {
  return value.startsWith(OTHER_PREFIX);
}

/** The free text out of an `other:` answer (empty string when absent). */
export function otherAnswerText(value: string): string {
  return isOtherAnswer(value) ? value.slice(OTHER_PREFIX.length) : "";
}

/** Build the stored value for an "Other…" answer. */
export function toOtherAnswer(text: string): string {
  return `${OTHER_PREFIX}${text}`;
}

/** Text-answer validation presets ("regex-lite for common cases" — a closed
 * enum rather than author-supplied regex, which would be a ReDoS surface). */
export const TextFormat = z.enum([
  "text",
  "email",
  "url",
  "phone",
  "number",
  "integer",
  "alphanumeric",
]);
export type TextFormat = z.infer<typeof TextFormat>;

/** How a choice question renders. `dropdown` is the long-option-list variant
 * of single choice; `image_grid` is multiple-choice-with-images. */
export const ChoiceDisplay = z.enum(["radio", "dropdown", "image_grid"]);
export type ChoiceDisplay = z.infer<typeof ChoiceDisplay>;

export const MultiChoiceDisplay = z.enum(["checkbox", "image_grid"]);
export type MultiChoiceDisplay = z.infer<typeof MultiChoiceDisplay>;

/** One selectable option. `imageUrl` powers multiple-choice-with-images;
 * `goTo` is the per-option branch target (single choice only). */
export const QuestionOption = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  imageUrl: z.string().min(1).optional(),
  imageAlt: z.string().optional(),
  goTo: z.string().min(1).optional(),
});
export type QuestionOption = z.infer<typeof QuestionOption>;

export const SingleSelectQuestion = z.object({
  id: z.string().min(1),
  kind: z.literal("single_select"),
  prompt: z.string().min(1),
  helper: z.string().optional(),
  options: z.array(QuestionOption).min(2),
  required: z.boolean().default(true),
  // Builder v2 additions.
  display: ChoiceDisplay.optional(),
  allowOther: z.boolean().optional(),
  otherLabel: z.string().optional(),
  shuffleOptions: z.boolean().optional(),
});
export type SingleSelectQuestion = z.infer<typeof SingleSelectQuestion>;

export const MultiSelectQuestion = z.object({
  id: z.string().min(1),
  kind: z.literal("multi_select"),
  prompt: z.string().min(1),
  helper: z.string().optional(),
  options: z.array(QuestionOption).min(2),
  required: z.boolean().default(false),
  // Builder v2 additions.
  display: MultiChoiceDisplay.optional(),
  allowOther: z.boolean().optional(),
  otherLabel: z.string().optional(),
  shuffleOptions: z.boolean().optional(),
  minSelections: z.number().int().nonnegative().optional(),
  maxSelections: z.number().int().positive().optional(),
});
export type MultiSelectQuestion = z.infer<typeof MultiSelectQuestion>;

export const ShortTextQuestion = z.object({
  id: z.string().min(1),
  kind: z.literal("short_text"),
  prompt: z.string().min(1),
  helper: z.string().optional(),
  placeholder: z.string().optional(),
  maxLength: z.number().int().positive().default(120),
  required: z.boolean().default(true),
  // Builder v2 response validation. `format` applies a preset check; `min`/
  // `max` bound the numeric value when format is number/integer.
  minLength: z.number().int().nonnegative().optional(),
  format: TextFormat.optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});
export type ShortTextQuestion = z.infer<typeof ShortTextQuestion>;

export const LongTextQuestion = z.object({
  id: z.string().min(1),
  kind: z.literal("long_text"),
  prompt: z.string().min(1),
  helper: z.string().optional(),
  placeholder: z.string().optional(),
  maxLength: z.number().int().positive().default(1000),
  required: z.boolean().default(false),
  minLength: z.number().int().nonnegative().optional(),
});
export type LongTextQuestion = z.infer<typeof LongTextQuestion>;

// ISO 8601 yyyy-mm-dd. Backed by `<input type="date">`.
export const DateQuestion = z.object({
  id: z.string().min(1),
  kind: z.literal("date"),
  prompt: z.string().min(1),
  helper: z.string().optional(),
  required: z.boolean().default(true),
});
export type DateQuestion = z.infer<typeof DateQuestion>;

// On/off boolean — rendered as a switch.
export const BooleanQuestion = z.object({
  id: z.string().min(1),
  kind: z.literal("boolean"),
  prompt: z.string().min(1),
  helper: z.string().optional(),
  required: z.boolean().default(false),
});
export type BooleanQuestion = z.infer<typeof BooleanQuestion>;

// Email address — a single-line text answer validated against EMAIL_RE.
export const EmailQuestion = z.object({
  id: z.string().min(1),
  kind: z.literal("email"),
  prompt: z.string().min(1),
  helper: z.string().optional(),
  placeholder: z.string().optional(),
  required: z.boolean().default(true),
});
export type EmailQuestion = z.infer<typeof EmailQuestion>;

// Phone number — a single-line text answer validated leniently against
// PHONE_RE (7–15 digits, optional +/spacing). No phone library.
export const PhoneQuestion = z.object({
  id: z.string().min(1),
  kind: z.literal("phone"),
  prompt: z.string().min(1),
  helper: z.string().optional(),
  placeholder: z.string().optional(),
  required: z.boolean().default(true),
});
export type PhoneQuestion = z.infer<typeof PhoneQuestion>;

// --- Attended-years (Burner Bio) ----------------------------------------
// AfrikaBurn has run every year from 2007 to 2026 EXCEPT 2020 and 2021 (no
// burn — the pandemic years). The bio's years-attended field is a multi-select
// over this range; 2020/2021 are offered disabled in the UI and REJECTED here
// at the boundary. These live in @quagga/types because the questionnaire
// validator (below) is the enforcement point; @quagga/core reuses them.
export const ATTENDED_YEAR_MIN = 2007;
export const ATTENDED_YEAR_MAX = 2026;
export const NO_BURN_YEARS: readonly number[] = [2020, 2021];

/** True when `year` is a real AfrikaBurn edition year (in range, burn held). */
export function isValidAttendedYear(year: number): boolean {
  return (
    Number.isInteger(year) &&
    year >= ATTENDED_YEAR_MIN &&
    year <= ATTENDED_YEAR_MAX &&
    !NO_BURN_YEARS.includes(year)
  );
}

/** Newest-first option list for the years-attended toggle grid. Disabled
 * entries (2020/2021) render with a "no burn" hint. */
export function attendedYearOptions(): { year: number; disabled: boolean }[] {
  const out: { year: number; disabled: boolean }[] = [];
  for (let y = ATTENDED_YEAR_MAX; y >= ATTENDED_YEAR_MIN; y--) {
    out.push({ year: y, disabled: NO_BURN_YEARS.includes(y) });
  }
  return out;
}

// Multi-select of specific AfrikaBurn years attended. The response value is an
// array of year strings (fitting QuestionnaireResponseValue's `string[]`);
// @quagga/core maps it to the integer[] `attended_years` column.
export const YearsQuestion = z.object({
  id: z.string().min(1),
  kind: z.literal("years"),
  prompt: z.string().min(1),
  helper: z.string().optional(),
  required: z.boolean().default(false),
});
export type YearsQuestion = z.infer<typeof YearsQuestion>;

// --- Builder v2 question kinds ------------------------------------------

// Linear scale — `min` is 0 or 1, `max` is 2–10, with optional end labels
// ("Not at all" … "Completely"). The response value is the chosen integer.
export const LinearScaleQuestion = z.object({
  id: z.string().min(1),
  kind: z.literal("linear_scale"),
  prompt: z.string().min(1),
  helper: z.string().optional(),
  min: z.union([z.literal(0), z.literal(1)]),
  max: z.number().int().min(2).max(10),
  minLabel: z.string().optional(),
  maxLabel: z.string().optional(),
  required: z.boolean().default(true),
});
export type LinearScaleQuestion = z.infer<typeof LinearScaleQuestion>;

// Star rating — 3–10 steps, glyph is a render hint only. The response value is
// the chosen integer, 1..steps.
export const RatingQuestion = z.object({
  id: z.string().min(1),
  kind: z.literal("rating"),
  prompt: z.string().min(1),
  helper: z.string().optional(),
  steps: z.number().int().min(3).max(10),
  glyph: z.enum(["star", "heart", "number"]).optional(),
  required: z.boolean().default(true),
});
export type RatingQuestion = z.infer<typeof RatingQuestion>;

// Time of day, 24h `HH:MM`. Backed by `<input type="time">`.
export const TimeQuestion = z.object({
  id: z.string().min(1),
  kind: z.literal("time"),
  prompt: z.string().min(1),
  helper: z.string().optional(),
  required: z.boolean().default(true),
});
export type TimeQuestion = z.infer<typeof TimeQuestion>;

// File upload rendered as a LINK. We have no blob infrastructure yet, so the
// respondent pastes a URL to a file they host (Drive, Dropbox, …) rather than
// uploading. When blob storage lands this kind keeps its id and gains an
// upload affordance — the stored value stays a URL either way.
export const FileLinkQuestion = z.object({
  id: z.string().min(1),
  kind: z.literal("file_link"),
  prompt: z.string().min(1),
  helper: z.string().optional(),
  placeholder: z.string().optional(),
  required: z.boolean().default(false),
});
export type FileLinkQuestion = z.infer<typeof FileLinkQuestion>;

// --- Grid question kinds (Google-Forms parity) ---------------------------
// A grid is ONE question with named rows and shared columns. The response value
// is a per-row map `{ [rowId]: columnValue[] }` — one entry per answered row.
// `multi_choice_grid` allows one column per row (radio); `checkbox_grid` allows
// any number of columns per row (checkboxes). Rows carry an `id` (it keys the
// response map, allocated once like a question id and never re-derived); columns
// carry a `value` (the stored answer) plus a display `label`.

export const GridRow = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});
export type GridRow = z.infer<typeof GridRow>;

export const GridColumn = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
});
export type GridColumn = z.infer<typeof GridColumn>;

// Multiple-choice grid — exactly one column may be chosen per row. `required`
// (default true, matching Google Forms) means EVERY row must be answered.
export const MultiChoiceGridQuestion = z.object({
  id: z.string().min(1),
  kind: z.literal("multi_choice_grid"),
  prompt: z.string().min(1),
  helper: z.string().optional(),
  rows: z.array(GridRow).min(1),
  columns: z.array(GridColumn).min(1),
  required: z.boolean().default(true),
});
export type MultiChoiceGridQuestion = z.infer<typeof MultiChoiceGridQuestion>;

// Checkbox grid — any number of columns may be chosen per row. `required`
// (default false) means every row must carry at least one selection.
export const CheckboxGridQuestion = z.object({
  id: z.string().min(1),
  kind: z.literal("checkbox_grid"),
  prompt: z.string().min(1),
  helper: z.string().optional(),
  rows: z.array(GridRow).min(1),
  columns: z.array(GridColumn).min(1),
  required: z.boolean().default(false),
});
export type CheckboxGridQuestion = z.infer<typeof CheckboxGridQuestion>;

export const Question = z.discriminatedUnion("kind", [
  SingleSelectQuestion,
  MultiSelectQuestion,
  ShortTextQuestion,
  LongTextQuestion,
  DateQuestion,
  BooleanQuestion,
  EmailQuestion,
  PhoneQuestion,
  YearsQuestion,
  LinearScaleQuestion,
  RatingQuestion,
  TimeQuestion,
  FileLinkQuestion,
  MultiChoiceGridQuestion,
  CheckboxGridQuestion,
]);
export type Question = z.infer<typeof Question>;

// --- Builder v2 content blocks -------------------------------------------
// Blocks sit in a page's block list alongside questions but take NO answer —
// they never appear in the response map and never gate completion.

// Section header / info text: standalone copy, "just there for information".
export const InfoBlock = z.object({
  id: z.string().min(1),
  kind: z.literal("info_block"),
  heading: z.string().optional(),
  body: z.string().min(1),
});
export type InfoBlock = z.infer<typeof InfoBlock>;

// Standalone image. `url` is a plain URL (no blob infra yet — same reasoning as
// FileLinkQuestion); `alt` is required so the runner is never inaccessible.
export const ImageBlock = z.object({
  id: z.string().min(1),
  kind: z.literal("image_block"),
  url: z.string().min(1),
  alt: z.string().min(1),
  caption: z.string().optional(),
});
export type ImageBlock = z.infer<typeof ImageBlock>;

export const ContentBlock = z.discriminatedUnion("kind", [
  InfoBlock,
  ImageBlock,
]);
export type ContentBlock = z.infer<typeof ContentBlock>;

/** Anything that can sit in a page's block list — a question or a content
 * block. Pre-Builder-v2 definitions contain only questions, so widening the
 * page's `questions` array to this union is backward compatible. */
export const PageBlock = z.union([Question, ContentBlock]);
export type PageBlock = z.infer<typeof PageBlock>;

const ANSWERABLE_KINDS: ReadonlySet<string> = new Set([
  "single_select",
  "multi_select",
  "short_text",
  "long_text",
  "date",
  "boolean",
  "email",
  "phone",
  "years",
  "linear_scale",
  "rating",
  "time",
  "file_link",
  "multi_choice_grid",
  "checkbox_grid",
]);

/** True when a block takes an answer (i.e. is a Question, not an info/image
 * block). The one place the answerable/decorative line is drawn. */
export function isAnswerableBlock(block: PageBlock): block is Question {
  return ANSWERABLE_KINDS.has(block.kind);
}

// The result every questionnaire SAVE action returns.
export type SaveResult =
  { ok: true } | { ok: false; errors: Record<string, string> };

// Standard page — ALSO the Builder v2 "section": one page per section, a page
// break between them, validated on Next. `questions` holds Builder v2 blocks
// (questions + info/image blocks); pre-v2 definitions hold questions only.
// `next` overrides the default fall-through to the following page (a page id
// or SUBMIT_TARGET); `shuffleQuestions` randomises block order for the
// respondent.
export const QuestionsPage = z.object({
  id: z.string().min(1),
  kind: z.literal("questions"),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  questions: z.array(PageBlock).min(1),
  next: z.string().min(1).optional(),
  shuffleQuestions: z.boolean().optional(),
});
export type QuestionsPage = z.infer<typeof QuestionsPage>;

// Full-screen "what's coming next" interstitial — no questions, no validation.
export const IntroPage = z.object({
  id: z.string().min(1),
  kind: z.literal("intro"),
  heading: z.string().min(1),
  body: z.string().min(1),
  next: z.string().min(1).optional(),
});
export type IntroPage = z.infer<typeof IntroPage>;

export const QuestionnairePage = z.discriminatedUnion("kind", [
  QuestionsPage,
  IntroPage,
]);
export type QuestionnairePage = z.infer<typeof QuestionnairePage>;

export const Questionnaire = z.object({
  version: z.string().min(1),
  pages: z.array(QuestionnairePage).min(1),
});
export type Questionnaire = z.infer<typeof Questionnaire>;

// A grid answer: `{ [rowId]: columnValue[] }`. Nested inside the flat response
// map (keyed by the grid question's id) so Builder v2 needs no schema change —
// it is JSONB either way. An empty map / all-empty rows means "unanswered".
export const GridAnswer = z.record(z.string(), z.array(z.string()));
export type GridAnswer = z.infer<typeof GridAnswer>;

// Responses are a flat map keyed by question id; each value's shape depends on
// the question kind. Stored as JSONB on `questionnaire_responses.responses`.
export const QuestionnaireResponseValue = z.union([
  z.number(),
  z.string(),
  z.array(z.string()),
  z.boolean(),
  GridAnswer,
  z.null(),
]);
export type QuestionnaireResponseValue = z.infer<
  typeof QuestionnaireResponseValue
>;

export const QuestionnaireResponses = z.record(
  z.string(),
  QuestionnaireResponseValue,
);
export type QuestionnaireResponses = z.infer<typeof QuestionnaireResponses>;

// One field that changed when a user replayed a completed questionnaire.
export const QuestionnaireFieldChange = z.object({
  fieldId: z.string().min(1),
  label: z.string(),
  from: z.string(),
  to: z.string(),
});
export type QuestionnaireFieldChange = z.infer<typeof QuestionnaireFieldChange>;

/** Flatten a questionnaire's pages into a single ordered list of ANSWERABLE
 * questions. Content blocks (info/image) are skipped — they take no answer, so
 * they never count towards question counts or completion. */
export function flattenQuestions(questionnaire: Questionnaire): Question[] {
  const out: Question[] = [];
  for (const page of questionnaire.pages) {
    if (page.kind === "questions") out.push(...pageQuestions(page));
  }
  return out;
}

/** The answerable questions on one page, in order. */
export function pageQuestions(page: QuestionnairePage): Question[] {
  if (page.kind !== "questions") return [];
  return page.questions.filter(isAnswerableBlock);
}

/** Every block on one page, in order (questions + info/image blocks). */
export function pageBlocks(page: QuestionnairePage): PageBlock[] {
  return page.kind === "questions" ? [...page.questions] : [];
}

/**
 * Validate a response map against a questionnaire definition. Returns the
 * normalised responses on success; per-question errors otherwise. Unknown keys
 * are dropped; missing required questions return errors.
 */
export function validateResponses(
  questionnaire: Questionnaire,
  raw: unknown,
):
  | { ok: true; responses: QuestionnaireResponses }
  | { ok: false; errors: Record<string, string> } {
  const parsed = QuestionnaireResponses.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: { _root: "Malformed response payload" } };
  }
  const responses: QuestionnaireResponses = {};
  const errors: Record<string, string> = {};

  for (const page of questionnaire.pages) {
    if (page.kind === "intro") continue;
    for (const q of pageQuestions(page)) {
      const value = parsed.data[q.id];
      const result = validateOne(q, value);
      if (!result.ok) {
        errors[q.id] = result.error;
        continue;
      }
      if (result.value !== undefined) responses[q.id] = result.value;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, responses };
}

/**
 * Apply a short-text question's `format` preset (and, for the numeric presets,
 * its `min`/`max` bounds) to an answer. Returns an error message, or null when
 * the answer passes. Presets are a CLOSED enum, deliberately: author-supplied
 * regex would be a ReDoS surface on a server-side validator.
 */
function checkTextFormat(q: ShortTextQuestion, raw: string): string | null {
  const trimmed = raw.trim();
  switch (q.format) {
    case undefined:
    case "text":
      return null;
    case "email":
      return EMAIL_RE.test(trimmed) ? null : "Enter a valid email address";
    case "url":
      return URL_RE.test(trimmed)
        ? null
        : "Enter a link starting with http:// or https://";
    case "phone": {
      const digits = trimmed.replace(/\D/g, "");
      return PHONE_RE.test(trimmed) && digits.length >= 7 && digits.length <= 15
        ? null
        : "Enter a valid phone number";
    }
    case "alphanumeric":
      return ALNUM_RE.test(trimmed) ? null : "Letters and numbers only";
    case "number":
    case "integer": {
      const n = Number(trimmed);
      if (trimmed === "" || Number.isNaN(n)) return "Enter a number";
      if (q.format === "integer" && !Number.isInteger(n))
        return "Enter a whole number";
      if (q.min != null && n < q.min) return `Must be at least ${q.min}`;
      if (q.max != null && n > q.max) return `Must be at most ${q.max}`;
      return null;
    }
  }
}

export function validateOne(
  q: Question,
  raw: unknown,
):
  | { ok: true; value: QuestionnaireResponseValue | undefined }
  | { ok: false; error: string } {
  const isMissing = raw === undefined || raw === null || raw === "";
  if (isMissing) {
    if ("required" in q && q.required) {
      return { ok: false, error: "This question is required" };
    }
    return { ok: true, value: undefined };
  }

  switch (q.kind) {
    case "boolean": {
      if (typeof raw !== "boolean")
        return { ok: false, error: "Expected yes or no" };
      return { ok: true, value: raw };
    }
    case "email": {
      if (typeof raw !== "string") return { ok: false, error: "Expected text" };
      if (!EMAIL_RE.test(raw))
        return { ok: false, error: "Enter a valid email address" };
      return { ok: true, value: raw };
    }
    case "phone": {
      if (typeof raw !== "string") return { ok: false, error: "Expected text" };
      const digits = raw.replace(/\D/g, "");
      if (!PHONE_RE.test(raw) || digits.length < 7 || digits.length > 15)
        return { ok: false, error: "Enter a valid phone number" };
      return { ok: true, value: raw };
    }
    case "single_select": {
      if (typeof raw !== "string")
        return { ok: false, error: "Expected a choice" };
      if (isOtherAnswer(raw)) {
        if (!q.allowOther) return { ok: false, error: "Not a valid option" };
        if (otherAnswerText(raw).trim() === "")
          return { ok: false, error: "Tell us what your 'other' answer is" };
        return { ok: true, value: raw };
      }
      if (!q.options.some((o) => o.value === raw))
        return { ok: false, error: "Not a valid option" };
      return { ok: true, value: raw };
    }
    case "multi_select": {
      if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string"))
        return { ok: false, error: "Expected a list of choices" };
      const allowed = new Set(q.options.map((o) => o.value));
      const filtered: string[] = [];
      for (const v of raw as string[]) {
        if (isOtherAnswer(v)) {
          if (!q.allowOther) continue;
          if (otherAnswerText(v).trim() === "")
            return { ok: false, error: "Tell us what your 'other' answer is" };
          filtered.push(v);
          continue;
        }
        if (allowed.has(v)) filtered.push(v);
      }
      if (q.required && filtered.length === 0)
        return { ok: false, error: "Pick at least one option" };
      // min/maxSelections only bind once something is picked — an empty answer
      // on an OPTIONAL question stays a valid skip.
      if (
        filtered.length > 0 &&
        q.minSelections != null &&
        filtered.length < q.minSelections
      )
        return { ok: false, error: `Pick at least ${q.minSelections} options` };
      if (q.maxSelections != null && filtered.length > q.maxSelections)
        return { ok: false, error: `Pick at most ${q.maxSelections} options` };
      return { ok: true, value: filtered };
    }
    case "linear_scale": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (typeof raw === "boolean" || !Number.isInteger(n))
        return { ok: false, error: "Pick a value on the scale" };
      if (n < q.min || n > q.max)
        return {
          ok: false,
          error: `Pick a value between ${q.min} and ${q.max}`,
        };
      return { ok: true, value: n };
    }
    case "rating": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (typeof raw === "boolean" || !Number.isInteger(n))
        return { ok: false, error: "Pick a rating" };
      if (n < 1 || n > q.steps)
        return { ok: false, error: `Pick a rating between 1 and ${q.steps}` };
      return { ok: true, value: n };
    }
    case "time": {
      if (typeof raw !== "string")
        return { ok: false, error: "Expected a time" };
      if (!TIME_RE.test(raw)) return { ok: false, error: "Use 24-hour hh:mm" };
      return { ok: true, value: raw };
    }
    case "file_link": {
      if (typeof raw !== "string")
        return { ok: false, error: "Expected a link" };
      if (!URL_RE.test(raw.trim()))
        return {
          ok: false,
          error: "Enter a link starting with http:// or https://",
        };
      return { ok: true, value: raw.trim() };
    }
    case "multi_choice_grid":
    case "checkbox_grid": {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw))
        return { ok: false, error: "Expected a grid of answers" };
      const incoming = raw as Record<string, unknown>;
      const columnValues = new Set(q.columns.map((c) => c.value));
      const single = q.kind === "multi_choice_grid";
      const value: GridAnswer = {};
      // Iterate the DEFINITION's rows so unknown/extra row keys are dropped and
      // the answer is normalised to known rows and known columns only.
      for (const row of q.rows) {
        const cell = incoming[row.id];
        if (cell === undefined || cell === null) continue;
        if (!Array.isArray(cell) || cell.some((v) => typeof v !== "string"))
          return { ok: false, error: `Malformed answer for "${row.label}"` };
        const picks: string[] = [];
        for (const v of cell as string[]) {
          if (columnValues.has(v) && !picks.includes(v)) picks.push(v);
        }
        if (single && picks.length > 1)
          return { ok: false, error: `Pick one column for "${row.label}"` };
        if (picks.length > 0) value[row.id] = picks;
      }
      const answeredRows = Object.keys(value).length;
      if (q.required) {
        const missing = q.rows.find((r) => (value[r.id] ?? []).length === 0);
        if (missing)
          return {
            ok: false,
            error: `Answer every row — "${missing.label}" is missing`,
          };
      }
      // An optional grid left entirely blank is a valid skip.
      if (answeredRows === 0) return { ok: true, value: undefined };
      return { ok: true, value };
    }
    case "years": {
      if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string"))
        return { ok: false, error: "Expected a list of years" };
      const seen = new Set<string>();
      const years: string[] = [];
      for (const s of raw as string[]) {
        if (!/^\d{4}$/.test(s) || !isValidAttendedYear(Number(s)))
          return { ok: false, error: `${s} isn't a valid AfrikaBurn year` };
        if (!seen.has(s)) {
          seen.add(s);
          years.push(s);
        }
      }
      if (q.required && years.length === 0)
        return { ok: false, error: "Pick at least one year" };
      return { ok: true, value: years };
    }
    case "short_text":
    case "long_text": {
      if (typeof raw !== "string") return { ok: false, error: "Expected text" };
      if (raw.length > q.maxLength)
        return { ok: false, error: `Max ${q.maxLength} characters` };
      if (q.minLength != null && raw.length < q.minLength)
        return { ok: false, error: `At least ${q.minLength} characters` };
      if (q.kind === "short_text") {
        const formatError = checkTextFormat(q, raw);
        if (formatError) return { ok: false, error: formatError };
      }
      return { ok: true, value: raw };
    }
    case "date": {
      if (typeof raw !== "string")
        return { ok: false, error: "Expected a date" };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw))
        return { ok: false, error: "Use yyyy-mm-dd" };
      const t = Date.parse(raw);
      if (Number.isNaN(t)) return { ok: false, error: "Not a real date" };
      return { ok: true, value: raw };
    }
  }
}
