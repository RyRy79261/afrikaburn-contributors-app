import { describe, it, expect } from "vitest";
import { SUBMIT_TARGET } from "@quagga/types";
import {
  validateQuestionnaireDefinition,
  isValidQuestionnaireDefinition,
  type DefinitionIssueCode,
} from "../questionnaire-definition";
import {
  V1_CAMP_QUESTIONNAIRE,
  V1_MULTIPAGE_QUESTIONNAIRE,
} from "../__fixtures__/questionnaire-v1";

function codes(raw: unknown): DefinitionIssueCode[] {
  const result = validateQuestionnaireDefinition(raw);
  return result.ok ? [] : result.issues.map((i) => i.code);
}

/** A minimal three-section definition used as a branching base. */
function branchingDefinition(): unknown {
  return {
    version: "1",
    pages: [
      {
        id: "start",
        kind: "questions",
        title: "Start",
        questions: [
          {
            id: "camp_type",
            kind: "single_select",
            prompt: "What kind of camp?",
            options: [
              { value: "sound", label: "Sound camp", goTo: "sound" },
              { value: "quiet", label: "Quiet camp", goTo: "wrap" },
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
            minLabel: "Ambient",
            maxLabel: "Dance floor",
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
  };
}

describe("backward compatibility — v1 definitions", () => {
  it("accepts a pre-Builder-v2 camp questionnaire unchanged", () => {
    const result = validateQuestionnaireDefinition(V1_CAMP_QUESTIONNAIRE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.pages).toHaveLength(1);
    const page = result.definition.pages[0];
    expect(page?.kind).toBe("questions");
    if (page?.kind !== "questions") return;
    expect(page.questions).toHaveLength(5);
    // None of the Builder v2 fields are invented on the way through.
    expect(page.next).toBeUndefined();
    expect(page.shuffleQuestions).toBeUndefined();
  });

  it("accepts the multi-page intro+questions (Burner Bio) shape", () => {
    expect(isValidQuestionnaireDefinition(V1_MULTIPAGE_QUESTIONNAIRE)).toBe(true);
  });

  // MIGRATION SAFETY. Builder v2 is a jsonb EXTENSION — no migration, no
  // backfill. That is only true if parsing a stored v1 definition with the v2
  // schema returns byte-identical JSON: any injected default would mean every
  // `questionnaire_definitions.definition` row on disk is now stale.
  it("round-trips a stored v1 definition to identical JSON (no rewrite needed)", () => {
    for (const stored of [V1_CAMP_QUESTIONNAIRE, V1_MULTIPAGE_QUESTIONNAIRE]) {
      const result = validateQuestionnaireDefinition(stored);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(JSON.parse(JSON.stringify(result.definition))).toEqual(stored);
    }
  });

  it("preserves v1 option shape without adding image/branch fields", () => {
    const result = validateQuestionnaireDefinition(V1_CAMP_QUESTIONNAIRE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const page = result.definition.pages[0];
    if (page?.kind !== "questions") throw new Error("expected questions page");
    const q = page.questions[0];
    if (q?.kind !== "single_select") throw new Error("expected single_select");
    expect(q.options[0]).toEqual({ value: "sunday", label: "Sunday" });
    expect(q.display).toBeUndefined();
    expect(q.allowOther).toBeUndefined();
  });
});

describe("shape validation", () => {
  it("rejects a non-questionnaire payload", () => {
    expect(codes({ pages: [] })).toContain("shape");
    expect(codes(null)).toContain("shape");
    expect(codes({ version: "1", pages: [] })).toContain("shape");
  });

  it("rejects a questions page with no blocks", () => {
    expect(
      codes({
        version: "1",
        pages: [{ id: "a", kind: "questions", title: "A", questions: [] }],
      }),
    ).toContain("shape");
  });

  it("rejects a choice question with fewer than two options", () => {
    expect(
      codes({
        version: "1",
        pages: [
          {
            id: "a",
            kind: "questions",
            title: "A",
            questions: [
              {
                id: "q",
                kind: "single_select",
                prompt: "Pick",
                options: [{ value: "x", label: "X" }],
              },
            ],
          },
        ],
      }),
    ).toContain("shape");
  });
});

describe("id integrity", () => {
  it("rejects duplicate question ids — responses would overwrite each other", () => {
    expect(
      codes({
        version: "1",
        pages: [
          {
            id: "a",
            kind: "questions",
            title: "A",
            questions: [
              { id: "dup", kind: "short_text", prompt: "One", maxLength: 50 },
              { id: "dup", kind: "short_text", prompt: "Two", maxLength: 50 },
            ],
          },
        ],
      }),
    ).toContain("duplicate_id");
  });

  it("rejects a question id colliding with a section id", () => {
    expect(
      codes({
        version: "1",
        pages: [
          {
            id: "shared",
            kind: "questions",
            title: "A",
            questions: [
              { id: "shared", kind: "short_text", prompt: "Q", maxLength: 50 },
            ],
          },
        ],
      }),
    ).toContain("duplicate_id");
  });

  it("rejects the reserved submit id", () => {
    expect(
      codes({
        version: "1",
        pages: [
          {
            id: SUBMIT_TARGET,
            kind: "questions",
            title: "A",
            questions: [
              { id: "q", kind: "short_text", prompt: "Q", maxLength: 50 },
            ],
          },
        ],
      }),
    ).toContain("reserved_id");
  });

  it("rejects duplicate and other:-prefixed option values", () => {
    const got = codes({
      version: "1",
      pages: [
        {
          id: "a",
          kind: "questions",
          title: "A",
          questions: [
            {
              id: "q",
              kind: "single_select",
              prompt: "Pick",
              options: [
                { value: "x", label: "X" },
                { value: "x", label: "X again" },
                { value: "other:sneaky", label: "Sneaky" },
              ],
            },
          ],
        },
      ],
    });
    expect(got).toContain("duplicate_option_value");
    expect(got).toContain("reserved_option_value");
  });
});

describe("branching", () => {
  it("accepts forward branches to sections and to submit", () => {
    const def = branchingDefinition() as {
      pages: { id: string; questions: { options: { goTo?: string }[] }[] }[];
    };
    const first = def.pages[0]?.questions[0];
    if (first?.options[1]) first.options[1].goTo = SUBMIT_TARGET;
    expect(validateQuestionnaireDefinition(def).ok).toBe(true);
  });

  it("accepts a plain forward-only definition", () => {
    expect(isValidQuestionnaireDefinition(branchingDefinition())).toBe(true);
  });

  it("rejects a branch to a section that does not exist", () => {
    const def = branchingDefinition() as {
      pages: { questions: { options: { goTo?: string }[] }[] }[];
    };
    const option = def.pages[0]?.questions[0]?.options[0];
    if (option) option.goTo = "nowhere";
    expect(codes(def)).toContain("unknown_branch_target");
  });

  it("rejects a backward branch — that is a loop", () => {
    const def = branchingDefinition() as {
      pages: { id: string; next?: string }[];
    };
    const wrap = def.pages[2];
    if (wrap) wrap.next = "start";
    expect(codes(def)).toContain("backward_branch");
  });

  it("rejects a section branching to itself", () => {
    const def = branchingDefinition() as {
      pages: { id: string; next?: string }[];
    };
    const sound = def.pages[1];
    if (sound) sound.next = "sound";
    expect(codes(def)).toContain("self_branch");
  });

  it("rejects branching on a multi-choice question", () => {
    expect(
      codes({
        version: "1",
        pages: [
          {
            id: "a",
            kind: "questions",
            title: "A",
            questions: [
              {
                id: "q",
                kind: "multi_select",
                prompt: "Pick some",
                options: [
                  { value: "x", label: "X", goTo: "b" },
                  { value: "y", label: "Y" },
                ],
              },
            ],
          },
          {
            id: "b",
            kind: "questions",
            title: "B",
            questions: [
              { id: "q2", kind: "short_text", prompt: "Q", maxLength: 50 },
            ],
          },
        ],
      }),
    ).toContain("branch_not_allowed");
  });

  it("rejects an unreachable section (a dead end in the graph)", () => {
    // "start" jumps straight past "orphan" to "wrap"; nothing ever reaches it.
    expect(
      codes({
        version: "1",
        pages: [
          {
            id: "start",
            kind: "questions",
            title: "Start",
            next: "wrap",
            questions: [
              { id: "q", kind: "short_text", prompt: "Q", maxLength: 50 },
            ],
          },
          {
            id: "orphan",
            kind: "questions",
            title: "Orphan",
            questions: [
              { id: "q2", kind: "short_text", prompt: "Q2", maxLength: 50 },
            ],
          },
          {
            id: "wrap",
            kind: "questions",
            title: "Wrap",
            questions: [
              { id: "q3", kind: "short_text", prompt: "Q3", maxLength: 50 },
            ],
          },
        ],
      }),
    ).toContain("unreachable_page");
  });

  it("keeps a section reachable when only SOME options branch past it", () => {
    // One option jumps to "wrap"; the unbranched option falls through to
    // "middle", so "middle" stays reachable.
    expect(
      isValidQuestionnaireDefinition({
        version: "1",
        pages: [
          {
            id: "start",
            kind: "questions",
            title: "Start",
            questions: [
              {
                id: "q",
                kind: "single_select",
                prompt: "Skip ahead?",
                options: [
                  { value: "yes", label: "Yes", goTo: "wrap" },
                  { value: "no", label: "No" },
                ],
              },
            ],
          },
          {
            id: "middle",
            kind: "questions",
            title: "Middle",
            questions: [
              { id: "q2", kind: "short_text", prompt: "Q2", maxLength: 50 },
            ],
          },
          {
            id: "wrap",
            kind: "questions",
            title: "Wrap",
            questions: [
              { id: "q3", kind: "short_text", prompt: "Q3", maxLength: 50 },
            ],
          },
        ],
      }),
    ).toBe(true);
  });
});

describe("validation-rule consistency", () => {
  it("rejects minLength above maxLength", () => {
    expect(
      codes({
        version: "1",
        pages: [
          {
            id: "a",
            kind: "questions",
            title: "A",
            questions: [
              {
                id: "q",
                kind: "short_text",
                prompt: "Q",
                maxLength: 10,
                minLength: 20,
              },
            ],
          },
        ],
      }),
    ).toContain("invalid_range");
  });

  it("rejects numeric min/max on a non-numeric format", () => {
    expect(
      codes({
        version: "1",
        pages: [
          {
            id: "a",
            kind: "questions",
            title: "A",
            questions: [
              {
                id: "q",
                kind: "short_text",
                prompt: "Q",
                maxLength: 50,
                format: "email",
                min: 1,
              },
            ],
          },
        ],
      }),
    ).toContain("invalid_range");
  });

  it("rejects minSelections above maxSelections and above the option count", () => {
    const base = {
      id: "q",
      kind: "multi_select",
      prompt: "Q",
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    };
    const wrap = (q: unknown) => ({
      version: "1",
      pages: [{ id: "p", kind: "questions", title: "P", questions: [q] }],
    });
    expect(codes(wrap({ ...base, minSelections: 2, maxSelections: 1 }))).toContain(
      "invalid_range",
    );
    expect(codes(wrap({ ...base, minSelections: 5 }))).toContain("invalid_range");
    expect(codes(wrap({ ...base, maxSelections: 2 }))).toEqual([]);
  });

  it("accepts every Builder v2 question type and content block", () => {
    expect(
      isValidQuestionnaireDefinition({
        version: "1",
        pages: [
          {
            id: "all",
            kind: "questions",
            title: "Everything",
            shuffleQuestions: true,
            questions: [
              { id: "b1", kind: "info_block", heading: "Heads up", body: "Read this." },
              { id: "b2", kind: "image_block", url: "https://x.test/a.png", alt: "A" },
              { id: "q1", kind: "short_text", prompt: "Name", maxLength: 80 },
              { id: "q2", kind: "long_text", prompt: "Story", maxLength: 900 },
              {
                id: "q3",
                kind: "single_select",
                prompt: "Pick",
                display: "dropdown",
                allowOther: true,
                shuffleOptions: true,
                options: [
                  { value: "a", label: "A" },
                  { value: "b", label: "B" },
                ],
              },
              {
                id: "q4",
                kind: "multi_select",
                prompt: "Pick some",
                display: "image_grid",
                minSelections: 1,
                maxSelections: 2,
                options: [
                  { value: "a", label: "A", imageUrl: "https://x.test/a.png", imageAlt: "A" },
                  { value: "b", label: "B", imageUrl: "https://x.test/b.png", imageAlt: "B" },
                ],
              },
              { id: "q5", kind: "linear_scale", prompt: "Scale", min: 1, max: 10 },
              { id: "q6", kind: "rating", prompt: "Stars", steps: 5, glyph: "star" },
              { id: "q7", kind: "date", prompt: "When" },
              { id: "q8", kind: "time", prompt: "What time" },
              { id: "q9", kind: "file_link", prompt: "Link to your plan" },
            ],
          },
        ],
      }),
    ).toBe(true);
  });
});
