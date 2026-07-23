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

export const SingleSelectQuestion = z.object({
  id: z.string().min(1),
  kind: z.literal("single_select"),
  prompt: z.string().min(1),
  helper: z.string().optional(),
  options: z
    .array(z.object({ value: z.string().min(1), label: z.string().min(1) }))
    .min(2),
  required: z.boolean().default(true),
});
export type SingleSelectQuestion = z.infer<typeof SingleSelectQuestion>;

export const MultiSelectQuestion = z.object({
  id: z.string().min(1),
  kind: z.literal("multi_select"),
  prompt: z.string().min(1),
  helper: z.string().optional(),
  options: z
    .array(z.object({ value: z.string().min(1), label: z.string().min(1) }))
    .min(2),
  required: z.boolean().default(false),
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

export const Question = z.discriminatedUnion("kind", [
  SingleSelectQuestion,
  MultiSelectQuestion,
  ShortTextQuestion,
  LongTextQuestion,
  DateQuestion,
  BooleanQuestion,
  EmailQuestion,
  PhoneQuestion,
]);
export type Question = z.infer<typeof Question>;

// The result every questionnaire SAVE action returns.
export type SaveResult =
  { ok: true } | { ok: false; errors: Record<string, string> };

// Standard page: one or more questions, validated on Next.
export const QuestionsPage = z.object({
  id: z.string().min(1),
  kind: z.literal("questions"),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  questions: z.array(Question).min(1),
});
export type QuestionsPage = z.infer<typeof QuestionsPage>;

// Full-screen "what's coming next" interstitial — no questions, no validation.
export const IntroPage = z.object({
  id: z.string().min(1),
  kind: z.literal("intro"),
  heading: z.string().min(1),
  body: z.string().min(1),
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

// Responses are a flat map keyed by question id; each value's shape depends on
// the question kind. Stored as JSONB on `questionnaire_responses.responses`.
export const QuestionnaireResponseValue = z.union([
  z.number(),
  z.string(),
  z.array(z.string()),
  z.boolean(),
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

/** Flatten a questionnaire's pages into a single ordered list of questions. */
export function flattenQuestions(questionnaire: Questionnaire): Question[] {
  const out: Question[] = [];
  for (const page of questionnaire.pages) {
    if (page.kind === "questions") out.push(...page.questions);
  }
  return out;
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
    for (const q of page.questions) {
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
      if (!q.options.some((o) => o.value === raw))
        return { ok: false, error: "Not a valid option" };
      return { ok: true, value: raw };
    }
    case "multi_select": {
      if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string"))
        return { ok: false, error: "Expected a list of choices" };
      const allowed = new Set(q.options.map((o) => o.value));
      const filtered = (raw as string[]).filter((v) => allowed.has(v));
      if (q.required && filtered.length === 0)
        return { ok: false, error: "Pick at least one option" };
      return { ok: true, value: filtered };
    }
    case "short_text":
    case "long_text": {
      if (typeof raw !== "string") return { ok: false, error: "Expected text" };
      if (raw.length > q.maxLength)
        return { ok: false, error: `Max ${q.maxLength} characters` };
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
