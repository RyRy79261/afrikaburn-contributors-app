import { describe, it, expect } from "vitest";
import {
  Questionnaire,
  flattenQuestions,
  isAnswerableBlock,
  pageBlocks,
  pageQuestions,
  validateResponses,
  type ImageBlock,
  type InfoBlock,
} from "../index";
import { KIND_SAMPLES } from "./question-fixtures";

// `validateResponses` is what a server action actually calls, and
// flattenQuestions / pageQuestions / pageBlocks / isAnswerableBlock decide what
// counts as a question at all. If a content block ever leaked into
// flattenQuestions it would be counted as an unanswered required question and
// NO questionnaire could be submitted; if unknown keys stopped being dropped,
// arbitrary client-supplied keys would be persisted into JSONB.

const QN = Questionnaire.parse({
  version: "1",
  pages: [
    {
      id: "welcome",
      kind: "intro",
      heading: "Before you start",
      body: "Three questions, two minutes.",
    },
    {
      id: "about",
      kind: "questions",
      title: "About you",
      questions: [
        { id: "name", kind: "short_text", prompt: "Your name" },
        { id: "aside", kind: "info_block", body: "We only ask once." },
        { id: "attended", kind: "years", prompt: "Which burns have you been to?" },
      ],
    },
    {
      id: "camp",
      kind: "questions",
      title: "Your camp",
      questions: [
        {
          id: "banner",
          kind: "image_block",
          url: "https://example.com/banner.png",
          alt: "A dusty banner",
        },
        { id: "contact_email", kind: "email", prompt: "Contact email" },
      ],
    },
  ],
});

const INTRO_PAGE = QN.pages[0]!;
const ABOUT_PAGE = QN.pages[1]!;

describe("validateResponses — malformed payloads", () => {
  it("returns one _root error rather than throwing on a non-map payload", () => {
    expect(validateResponses(QN, 42)).toEqual({
      ok: false,
      errors: { _root: "Malformed response payload" },
    });
  });

  it("rejects a payload whose value matches no member of the response union", () => {
    // `{ a: 1 }` is neither a grid answer (string[] values) nor any scalar the
    // response map allows.
    expect(validateResponses(QN, { name: { a: 1 } })).toEqual({
      ok: false,
      errors: { _root: "Malformed response payload" },
    });
  });
});

describe("validateResponses — normalisation", () => {
  it("drops unknown keys and omits skipped optional questions", () => {
    // The mass-assignment guard: only ids the definition declares survive. The
    // skipped optional question is ABSENT rather than present-and-undefined, so
    // the stored JSONB says "not answered" rather than "answered with nothing".
    expect(
      validateResponses(QN, {
        name: "Ren Notfound",
        contact_email: "ren@example.com",
        is_admin: true,
        ghost: "x",
      }),
    ).toEqual({
      ok: true,
      responses: { name: "Ren Notfound", contact_email: "ren@example.com" },
    });
  });

  it("collects an error for EVERY failing question, keyed by question id", () => {
    // Stopping at the first failure would make a respondent fix one field per
    // round trip.
    expect(
      validateResponses(QN, { name: "", contact_email: "nope" }),
    ).toEqual({
      ok: false,
      errors: {
        name: "This question is required",
        contact_email: "Enter a valid email address",
      },
    });
  });

  it("contributes no questions and no errors for an intro page", () => {
    const introOnly = Questionnaire.parse({
      version: "1",
      pages: [
        { id: "only", kind: "intro", heading: "Hello", body: "Nothing to do." },
      ],
    });
    expect(validateResponses(introOnly, {})).toEqual({ ok: true, responses: {} });
  });
});

describe("question/block traversal", () => {
  it("flattens answerable questions in page order and excludes content blocks", () => {
    expect(flattenQuestions(QN).map((q) => q.id)).toEqual([
      "name",
      "attended",
      "contact_email",
    ]);
  });

  it("pageBlocks keeps questions and content blocks in authored order", () => {
    expect(pageBlocks(ABOUT_PAGE).map((b) => b.id)).toEqual([
      "name",
      "aside",
      "attended",
    ]);
    expect(pageQuestions(ABOUT_PAGE).map((q) => q.id)).toEqual([
      "name",
      "attended",
    ]);
  });

  it("an intro page has neither questions nor blocks", () => {
    expect(pageQuestions(INTRO_PAGE)).toEqual([]);
    expect(pageBlocks(INTRO_PAGE)).toEqual([]);
  });
});

describe("isAnswerableBlock", () => {
  const INFO: InfoBlock = { id: "aside", kind: "info_block", body: "Read me." };
  const IMAGE: ImageBlock = {
    id: "banner",
    kind: "image_block",
    url: "https://example.com/banner.png",
    alt: "A dusty banner",
  };

  it("is false for the decorative blocks", () => {
    expect(isAnswerableBlock(INFO)).toBe(false);
    expect(isAnswerableBlock(IMAGE)).toBe(false);
  });

  it("is true for every question kind", () => {
    // Driven off the full kind table: a newly added kind that forgets to
    // register in ANSWERABLE_KINDS would be treated as decorative, silently
    // dropping its answers from every submission.
    for (const { question } of KIND_SAMPLES) {
      expect(isAnswerableBlock(question), `kind ${question.kind}`).toBe(true);
    }
  });
});
