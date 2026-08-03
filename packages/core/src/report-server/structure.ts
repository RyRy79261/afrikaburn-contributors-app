// Letting Claude turn a report into a readable issue.
//
// This is ADDITIVE and never load-bearing. Every failure path — no key, a
// refusal, a timeout, output that does not validate — returns null, and the
// caller files the report from the plain template instead. A person who
// described a bug must never lose their report because a model was unavailable.
//
// ## What it is not allowed to do
//
// The model restructures; it does not investigate, and it does not fill gaps.
// A fabricated reproduction step in a triage queue is worse than no step at
// all, because the person who reads it has no way to tell which half came from
// the reporter. Hence the "never invent" instruction, and hence
// `assembleIssue` publishing the report as filed alongside the summary.
//
// The output is sanitized again by `assembleIssue`, because it is derived from
// the report and can carry anything the report carried.

import Anthropic from "@anthropic-ai/sdk";

import { StructuredReportSchema, type ReportType, type StructuredReport } from "../report";

/**
 * Opus 5, deliberately, for a call that runs at most a handful of times a day.
 * The cost of a bad structuring is a triager misreading a bug report about
 * somebody's medical note; the cost of the better model here is cents.
 *
 * `effort: "low"` because restructuring prose someone else wrote is not a
 * reasoning problem. Thinking is left ON (the default): with it disabled the
 * model sometimes writes its answer as prose instead of honouring the output
 * schema, which would silently drop us to the template every time.
 */
const MODEL = "claude-opus-5";

const SYSTEM_PROMPT = `You turn a raw bug or feature report from the AfrikaBurn Contributors App into a well-structured GitHub issue.

Rules:
- Be faithful. NEVER invent reproduction steps, symptoms, causes, or facts the reporter did not state. An empty field is correct when they did not say.
- Write a specific title. "App is broken" is not a title; "Roster shows members from another camp" is.
- For a bug: extract steps, expected and actual ONLY if the reporter described them.
- For a feature request: put the request in the summary and leave steps/expected/actual empty.
- The text has already had personal data stripped. Placeholders like [email], [phone], [id] or [structured data removed] will appear — leave them exactly as they are and never guess at what they replaced.
- Write in plain English. The person reading this is a volunteer triaging in their own time.`;

/**
 * The JSON schema the response is constrained to. Structured outputs require
 * `additionalProperties: false` and an explicit `required` list; the optional
 * fields are simply absent from `required`.
 */
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Concise issue title, at most about 100 characters. No '[Bug]' prefix.",
    },
    summary: {
      type: "string",
      description: "One to three sentences describing the problem or request.",
    },
    stepsToReproduce: {
      type: "array",
      items: { type: "string" },
      description: "Ordered reproduction steps. Omit unless the reporter gave them.",
    },
    expected: { type: "string", description: "What the reporter expected to happen." },
    actual: { type: "string", description: "What actually happened." },
  },
  required: ["title", "summary"],
  additionalProperties: false,
} as const;

export function structuringConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Restructure a report. Returns null on ANY failure — the caller falls back to
 * the plain template, which is a complete, filable issue on its own.
 */
export async function structureReport(
  type: ReportType,
  description: string,
): Promise<StructuredReport | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 16_000,
        system: SYSTEM_PROMPT,
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: OUTPUT_SCHEMA },
        },
        messages: [
          {
            role: "user",
            content: `Report type: ${type}\n\nThe reporter wrote:\n"""\n${description}\n"""`,
          },
        ],
      },
      { timeout: 60_000 },
    );

    // Check the stop reason before reading content: a refusal returns HTTP 200
    // with empty or partial content, and indexing into it would throw.
    if (response.stop_reason === "refusal") {
      console.warn("[report] structuring refused; filing from the template");
      return null;
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    if (!text) return null;

    const parsed: unknown = JSON.parse(text);
    const validated = StructuredReportSchema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch (error) {
    // Never fatal. The report is already in hand and gets filed either way.
    console.error("[report] structuring failed; filing from the template:", error);
    return null;
  }
}
