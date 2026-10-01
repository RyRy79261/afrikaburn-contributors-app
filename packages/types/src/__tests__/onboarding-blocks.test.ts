import { describe, it, expect } from "vitest";
import {
  ContentBlock,
  ProjectAudience,
  Questionnaire,
  isAnswerableBlock,
  validateOne,
} from "../index";
import { ACKNOWLEDGEMENT } from "./question-fixtures";

// Camp onboarding's two new building blocks (epic #54) and the audience's
// narrowing fields.

describe("acknowledgement — a tick box that must be TICKED", () => {
  it("accepts only a tick", () => {
    expect(validateOne(ACKNOWLEDGEMENT, true)).toEqual({ ok: true, value: true });
  });

  it("refuses an unticked box — false is not an acknowledgement", () => {
    // A `boolean` question would accept false; that is exactly why this is
    // its own kind.
    expect(validateOne(ACKNOWLEDGEMENT, false)).toEqual({
      ok: false,
      error: "Tick this to finish",
    });
  });

  it("refuses a missing answer, and anything that merely looks truthy", () => {
    for (const v of [undefined, null, "", "true", 1, ["yes"]]) {
      expect(validateOne(ACKNOWLEDGEMENT, v).ok, String(v)).toBe(false);
    }
  });

  it("is required even when a stored definition says otherwise", () => {
    expect(
      validateOne({ ...ACKNOWLEDGEMENT, required: false }, undefined).ok,
    ).toBe(false);
  });

  it("takes an answer (it is counted, not decorative)", () => {
    expect(isAnswerableBlock(ACKNOWLEDGEMENT)).toBe(true);
  });
});

describe("video_link — a link card, never an embed", () => {
  const block = {
    id: "v",
    kind: "video_link",
    url: "https://vimeo.com/123",
    title: "A walk around camp",
  };

  it("accepts an https link with a title", () => {
    expect(ContentBlock.safeParse(block).success).toBe(true);
  });

  it("refuses any other scheme", () => {
    for (const url of [
      "http://vimeo.com/123",
      "javascript:alert(1)",
      "data:text/html,hi",
      "//vimeo.com/123",
    ]) {
      expect(ContentBlock.safeParse({ ...block, url }).success, url).toBe(false);
    }
  });

  it("is decorative — never answerable", () => {
    expect(isAnswerableBlock(ContentBlock.parse(block))).toBe(false);
  });
});

describe("Questionnaire.preset", () => {
  it("is optional, and only 'onboarding' is a preset", () => {
    const pages = [
      {
        id: "p",
        kind: "questions",
        title: "T",
        questions: [{ id: "i", kind: "info_block", body: "b" }],
      },
    ];
    expect(Questionnaire.safeParse({ version: "1", pages }).success).toBe(true);
    expect(
      Questionnaire.safeParse({ version: "1", pages, preset: "onboarding" })
        .success,
    ).toBe(true);
    expect(
      Questionnaire.safeParse({ version: "1", pages, preset: "survey" }).success,
    ).toBe(false);
  });
});

describe("ProjectAudience narrowing fields", () => {
  const base = { kind: "project", groupId: "g", mode: "everyone", roleIds: [] };

  it("keeps every pre-existing audience valid (both fields optional)", () => {
    expect(ProjectAudience.safeParse(base).success).toBe(true);
  });

  it("refuses an empty filter — 'nobody' is not a narrowing", () => {
    expect(ProjectAudience.safeParse({ ...base, tenure: [] }).success).toBe(false);
    expect(
      ProjectAudience.safeParse({ ...base, structuralRoles: [] }).success,
    ).toBe(false);
  });

  it("refuses org ranks as a structural role", () => {
    expect(
      ProjectAudience.safeParse({ ...base, structuralRoles: ["god"] }).success,
    ).toBe(false);
  });
});
