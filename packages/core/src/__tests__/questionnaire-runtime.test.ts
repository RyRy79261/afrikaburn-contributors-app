import { describe, it, expect } from "vitest";
import {
  Questionnaire,
  SUBMIT_TARGET,
  toOtherAnswer,
  validateResponses,
  type QuestionnaireResponses,
} from "@quagga/types";
import {
  allQuestions,
  deriveProgress,
  hasAnswer,
  nextPageId,
  pageById,
  presentationBlocks,
  presentationOptions,
  resolvePath,
  validateSubmission,
  visibleQuestions,
} from "../questionnaire-runtime";
import {
  V1_CAMP_QUESTIONNAIRE,
  V1_MULTIPAGE_QUESTIONNAIRE,
} from "../__fixtures__/questionnaire-v1";

/** sound → sound-detail; quiet → straight to wrap; art → submit. */
const BRANCHING = Questionnaire.parse({
  version: "1",
  pages: [
    {
      id: "start",
      kind: "questions",
      title: "Start",
      questions: [
        { id: "blurb", kind: "info_block", body: "Tell us about your camp." },
        {
          id: "camp_type",
          kind: "single_select",
          prompt: "What kind of camp?",
          options: [
            { value: "sound", label: "Sound camp", goTo: "sound" },
            { value: "quiet", label: "Quiet camp", goTo: "wrap" },
            { value: "art", label: "Art only", goTo: SUBMIT_TARGET },
          ],
          required: true,
        },
      ],
    },
    {
      id: "sound",
      kind: "questions",
      title: "Sound",
      questions: [
        {
          id: "sound_level",
          kind: "linear_scale",
          prompt: "How loud?",
          min: 1,
          max: 5,
          required: true,
        },
        {
          id: "sound_officer",
          kind: "short_text",
          prompt: "Who is your sound officer?",
          maxLength: 80,
          required: true,
        },
      ],
    },
    {
      id: "wrap",
      kind: "questions",
      title: "Wrap up",
      questions: [
        {
          id: "notes",
          kind: "long_text",
          prompt: "Anything else?",
          maxLength: 500,
          required: false,
        },
      ],
    },
  ],
});

const V1 = Questionnaire.parse(V1_CAMP_QUESTIONNAIRE);
const V1_MULTI = Questionnaire.parse(V1_MULTIPAGE_QUESTIONNAIRE);

describe("branch resolution", () => {
  it("falls through in document order when nothing branches", () => {
    expect(resolvePath(V1_MULTI, {})).toEqual(["intro", "identity", "history"]);
  });

  it("routes to the branch target of the chosen option", () => {
    expect(nextPageId(BRANCHING, "start", { camp_type: "sound" })).toBe("sound");
    expect(nextPageId(BRANCHING, "start", { camp_type: "quiet" })).toBe("wrap");
  });

  it("ends the questionnaire when the option targets submit", () => {
    expect(nextPageId(BRANCHING, "start", { camp_type: "art" })).toBeNull();
    expect(resolvePath(BRANCHING, { camp_type: "art" })).toEqual(["start"]);
  });

  it("falls through when the branching question is unanswered", () => {
    expect(nextPageId(BRANCHING, "start", {})).toBe("sound");
    expect(resolvePath(BRANCHING, {})).toEqual(["start", "sound", "wrap"]);
  });

  it("walks the full path per answer set", () => {
    expect(resolvePath(BRANCHING, { camp_type: "sound" })).toEqual([
      "start",
      "sound",
      "wrap",
    ]);
    expect(resolvePath(BRANCHING, { camp_type: "quiet" })).toEqual([
      "start",
      "wrap",
    ]);
  });

  it("returns null past the last page", () => {
    expect(nextPageId(BRANCHING, "wrap", {})).toBeNull();
  });

  it("returns null for an unknown page id", () => {
    expect(nextPageId(BRANCHING, "ghost", {})).toBeNull();
    expect(pageById(BRANCHING, "ghost")).toBeNull();
  });

  it("lets the LAST branching question on a section win", () => {
    const q = Questionnaire.parse({
      version: "1",
      pages: [
        {
          id: "a",
          kind: "questions",
          title: "A",
          questions: [
            {
              id: "first",
              kind: "single_select",
              prompt: "First",
              options: [{ value: "x", label: "X", goTo: "b" }, { value: "y", label: "Y" }],
            },
            {
              id: "second",
              kind: "single_select",
              prompt: "Second",
              options: [{ value: "x", label: "X", goTo: "c" }, { value: "y", label: "Y" }],
            },
          ],
        },
        { id: "b", kind: "questions", title: "B", questions: [{ id: "qb", kind: "short_text", prompt: "B", maxLength: 20 }] },
        { id: "c", kind: "questions", title: "C", questions: [{ id: "qc", kind: "short_text", prompt: "C", maxLength: 20 }] },
      ],
    });
    expect(nextPageId(q, "a", { first: "x", second: "x" })).toBe("c");
    // Second question unanswered → the first one's branch stands.
    expect(nextPageId(q, "a", { first: "x" })).toBe("b");
  });

  it("does not hang on a hand-edited definition containing a loop", () => {
    // Definition validation rejects this; the runtime must still terminate.
    const looping = Questionnaire.parse({
      version: "1",
      pages: [
        { id: "a", kind: "questions", title: "A", next: "b", questions: [{ id: "qa", kind: "short_text", prompt: "A", maxLength: 20 }] },
        { id: "b", kind: "questions", title: "B", next: "a", questions: [{ id: "qb", kind: "short_text", prompt: "B", maxLength: 20 }] },
      ],
    });
    expect(resolvePath(looping, {})).toEqual(["a", "b"]);
  });
});

describe("visible questions", () => {
  it("excludes questions in branched-past sections", () => {
    const ids = visibleQuestions(BRANCHING, { camp_type: "quiet" }).map((q) => q.id);
    expect(ids).toEqual(["camp_type", "notes"]);
  });

  it("excludes content blocks from the answerable set", () => {
    expect(allQuestions(BRANCHING).map((q) => q.id)).not.toContain("blurb");
  });
});

describe("progress derivation", () => {
  it("is complete when every required question on the path is answered", () => {
    const p = deriveProgress(BRANCHING, { camp_type: "quiet" });
    expect(p.path).toEqual(["start", "wrap"]);
    expect(p.requiredTotal).toBe(1);
    expect(p.requiredAnswered).toBe(1);
    expect(p.percent).toBe(100);
    expect(p.complete).toBe(true);
  });

  it("counts required questions only on the resolved path", () => {
    const sound = deriveProgress(BRANCHING, { camp_type: "sound" });
    expect(sound.requiredTotal).toBe(3);
    expect(sound.requiredAnswered).toBe(1);
    expect(sound.complete).toBe(false);
    expect(sound.percent).toBe(33);
  });

  it("reports the current page position", () => {
    const p = deriveProgress(BRANCHING, { camp_type: "sound" }, "sound");
    expect(p.pageIndex).toBe(1);
    expect(p.pageCount).toBe(3);
    expect(deriveProgress(BRANCHING, {}, "ghost").pageIndex).toBe(-1);
  });

  it("falls back to overall completion when nothing is required", () => {
    const q = Questionnaire.parse({
      version: "1",
      pages: [
        {
          id: "a",
          kind: "questions",
          title: "A",
          questions: [
            { id: "x", kind: "long_text", prompt: "X", maxLength: 50, required: false },
            { id: "y", kind: "long_text", prompt: "Y", maxLength: 50, required: false },
          ],
        },
      ],
    });
    expect(deriveProgress(q, { x: "hi" }).percent).toBe(50);
    expect(deriveProgress(q, { x: "hi" }).complete).toBe(true);
  });

  it("treats an invalid answer as unanswered", () => {
    const campType = allQuestions(BRANCHING).find((q) => q.id === "camp_type")!;
    expect(hasAnswer(campType, "not-an-option")).toBe(false);
    expect(hasAnswer(campType, "sound")).toBe(true);
    expect(hasAnswer(campType, "")).toBe(false);
    expect(hasAnswer(campType, undefined)).toBe(false);
  });
});

describe("branch-aware submit validation", () => {
  it("accepts a submission that skipped a branched-past required question", () => {
    const result = validateSubmission(BRANCHING, {
      camp_type: "quiet",
      notes: "See you there",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.responses).toEqual({ camp_type: "quiet", notes: "See you there" });
    expect(result.progress.complete).toBe(true);
  });

  it("still enforces required questions ON the path", () => {
    const result = validateSubmission(BRANCHING, { camp_type: "sound" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.sound_level).toBeDefined();
    expect(result.errors.sound_officer).toBeDefined();
  });

  it("drops answers to questions the respondent branched past", () => {
    const result = validateSubmission(BRANCHING, {
      camp_type: "quiet",
      sound_level: 5,
      sound_officer: "Smuggled in",
      notes: "",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.responses.sound_level).toBeUndefined();
    expect(result.responses.sound_officer).toBeUndefined();
  });

  it("rejects a malformed payload", () => {
    expect(validateSubmission(BRANCHING, "nope").ok).toBe(false);
    expect(validateSubmission(BRANCHING, ["nope"]).ok).toBe(false);
    expect(validateSubmission(BRANCHING, null).ok).toBe(false);
  });

  it("validates a v1 definition exactly as the pre-v2 validator did", () => {
    const payload = {
      arrival_day: "sunday",
      skills: ["build"],
      vehicle: "CA 123-456",
      consent: true,
    };
    const legacy = validateResponses(V1, payload);
    const modern = validateSubmission(V1, payload);
    expect(legacy.ok).toBe(true);
    expect(modern.ok).toBe(true);
    if (!legacy.ok || !modern.ok) return;
    expect(modern.responses).toEqual(legacy.responses);
  });
});

describe("response validation — Builder v2 rules", () => {
  const q = Questionnaire.parse({
    version: "1",
    pages: [
      {
        id: "a",
        kind: "questions",
        title: "A",
        questions: [
          {
            id: "scale",
            kind: "linear_scale",
            prompt: "Scale",
            min: 1,
            max: 5,
            required: false,
          },
          { id: "stars", kind: "rating", prompt: "Stars", steps: 5, required: false },
          { id: "at", kind: "time", prompt: "Time", required: false },
          { id: "plan", kind: "file_link", prompt: "Plan", required: false },
          {
            id: "email_field",
            kind: "short_text",
            prompt: "Email",
            maxLength: 100,
            format: "email",
            required: false,
          },
          {
            id: "crew_size",
            kind: "short_text",
            prompt: "Crew size",
            maxLength: 10,
            format: "integer",
            min: 2,
            max: 40,
            required: false,
          },
          {
            id: "blurb",
            kind: "long_text",
            prompt: "Blurb",
            maxLength: 100,
            minLength: 10,
            required: false,
          },
          {
            id: "pick",
            kind: "single_select",
            prompt: "Pick",
            allowOther: true,
            options: [
              { value: "a", label: "A" },
              { value: "b", label: "B" },
            ],
            required: false,
          },
          {
            id: "picks",
            kind: "multi_select",
            prompt: "Pick some",
            minSelections: 2,
            maxSelections: 3,
            allowOther: true,
            options: [
              { value: "a", label: "A" },
              { value: "b", label: "B" },
              { value: "c", label: "C" },
              { value: "d", label: "D" },
            ],
            required: false,
          },
        ],
      },
    ],
  });

  function errs(payload: Record<string, unknown>): Record<string, string> {
    const r = validateSubmission(q, payload);
    return r.ok ? {} : r.errors;
  }

  it("accepts in-range scale and rating values", () => {
    const r = validateSubmission(q, { scale: 3, stars: 5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.responses).toEqual({ scale: 3, stars: 5 });
  });

  it("rejects out-of-range scale, rating, and non-integers", () => {
    expect(errs({ scale: 9 }).scale).toBeDefined();
    expect(errs({ scale: 2.5 }).scale).toBeDefined();
    expect(errs({ stars: 0 }).stars).toBeDefined();
    expect(errs({ stars: 11 }).stars).toBeDefined();
  });

  it("validates 24-hour times", () => {
    expect(errs({ at: "09:30" }).at).toBeUndefined();
    expect(errs({ at: "23:59" }).at).toBeUndefined();
    expect(errs({ at: "24:00" }).at).toBeDefined();
    expect(errs({ at: "9:30" }).at).toBeDefined();
  });

  it("validates file links as http(s) URLs", () => {
    expect(errs({ plan: "https://drive.test/plan.pdf" }).plan).toBeUndefined();
    expect(errs({ plan: "drive.test/plan.pdf" }).plan).toBeDefined();
    expect(errs({ plan: "javascript:alert(1)" }).plan).toBeDefined();
  });

  it("applies the format presets", () => {
    expect(errs({ email_field: "ren@example.com" }).email_field).toBeUndefined();
    expect(errs({ email_field: "not-an-email" }).email_field).toBeDefined();
    expect(errs({ crew_size: "12" }).crew_size).toBeUndefined();
    expect(errs({ crew_size: "1" }).crew_size).toBeDefined();
    expect(errs({ crew_size: "99" }).crew_size).toBeDefined();
    expect(errs({ crew_size: "12.5" }).crew_size).toBeDefined();
    expect(errs({ crew_size: "twelve" }).crew_size).toBeDefined();
  });

  it("applies minLength", () => {
    expect(errs({ blurb: "too short" }).blurb).toBeDefined();
    expect(errs({ blurb: "long enough to pass" }).blurb).toBeUndefined();
  });

  it("accepts an Other… answer only when the question allows it", () => {
    const ok = validateSubmission(q, { pick: toOtherAnswer("Hybrid camp") });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.responses.pick).toBe("other:Hybrid camp");
    expect(errs({ pick: toOtherAnswer("   ") }).pick).toBeDefined();

    const noOther = Questionnaire.parse({
      version: "1",
      pages: [
        {
          id: "a",
          kind: "questions",
          title: "A",
          questions: [
            {
              id: "pick",
              kind: "single_select",
              prompt: "Pick",
              options: [
                { value: "a", label: "A" },
                { value: "b", label: "B" },
              ],
              required: false,
            },
          ],
        },
      ],
    });
    const r = validateSubmission(noOther, { pick: toOtherAnswer("nope") });
    expect(r.ok).toBe(false);
  });

  it("enforces min/max selection counts", () => {
    expect(errs({ picks: ["a"] }).picks).toBeDefined();
    expect(errs({ picks: ["a", "b"] }).picks).toBeUndefined();
    expect(errs({ picks: ["a", "b", "c", "d"] }).picks).toBeDefined();
    // Empty stays a valid skip on an optional question.
    expect(errs({ picks: [] }).picks).toBeUndefined();
  });

  it("silently drops choices that are not options", () => {
    const r = validateSubmission(q, { picks: ["a", "b", "ghost"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.responses.picks).toEqual(["a", "b"]);
  });
});

describe("shuffle", () => {
  const shuffled = Questionnaire.parse({
    version: "1",
    pages: [
      {
        id: "a",
        kind: "questions",
        title: "A",
        shuffleQuestions: true,
        questions: [
          { id: "q1", kind: "short_text", prompt: "1", maxLength: 20 },
          { id: "q2", kind: "short_text", prompt: "2", maxLength: 20 },
          { id: "q3", kind: "short_text", prompt: "3", maxLength: 20 },
          { id: "q4", kind: "short_text", prompt: "4", maxLength: 20 },
          {
            id: "q5",
            kind: "single_select",
            prompt: "5",
            shuffleOptions: true,
            options: [
              { value: "a", label: "A" },
              { value: "b", label: "B" },
              { value: "c", label: "C" },
              { value: "d", label: "D" },
            ],
          },
        ],
      },
    ],
  });
  const page = shuffled.pages[0]!;

  it("is stable for a given seed and varies across seeds", () => {
    const a1 = presentationBlocks(page, "user-1").map((b) => b.id);
    const a2 = presentationBlocks(page, "user-1").map((b) => b.id);
    const b1 = presentationBlocks(page, "user-9").map((b) => b.id);
    expect(a1).toEqual(a2);
    expect(a1).not.toEqual(b1);
    expect([...a1].sort()).toEqual(["q1", "q2", "q3", "q4", "q5"]);
  });

  it("leaves order alone when shuffle is off", () => {
    const plain = V1.pages[0]!;
    expect(presentationBlocks(plain, "user-1").map((b) => b.id)).toEqual([
      "arrival_day",
      "skills",
      "vehicle",
      "notes",
      "consent",
    ]);
  });

  it("shuffles options without changing their values", () => {
    const q5 = allQuestions(shuffled).find((q) => q.id === "q5")!;
    const shown = presentationOptions(q5, "user-1");
    expect(shown.map((o) => o.value).sort()).toEqual(["a", "b", "c", "d"]);
    expect(presentationOptions(q5, "user-1")).toEqual(shown);
  });

  it("returns no options for a non-choice question", () => {
    const q1 = allQuestions(shuffled).find((q) => q.id === "q1")!;
    expect(presentationOptions(q1, "user-1")).toEqual([]);
  });
});

describe("v1 responses still validate against v1 definitions", () => {
  it("round-trips a stored v1 response map", () => {
    const stored: QuestionnaireResponses = {
      arrival_day: "monday",
      skills: ["kitchen"],
      vehicle: "CJ 998-112",
      consent: false,
    };
    const r = validateSubmission(V1, stored);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.progress.complete).toBe(true);
  });
});
