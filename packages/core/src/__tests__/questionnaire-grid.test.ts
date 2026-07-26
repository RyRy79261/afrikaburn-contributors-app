import { describe, it, expect } from "vitest";
import {
  Questionnaire,
  validateOne,
  type MultiChoiceGridQuestion,
  type CheckboxGridQuestion,
  type QuestionnaireResponses,
} from "@quagga/types";
import { validateQuestionnaireDefinition } from "../questionnaire-definition";
import { validateSubmission } from "../questionnaire-runtime";
import { aggregateQuestion } from "../questionnaire-results";

// Grid question types (Google-Forms parity): multiple-choice grid (one column
// per row) and checkbox grid (many columns per row). The response value is a
// per-row map `{ [rowId]: columnValue[] }`.

const MC_GRID: MultiChoiceGridQuestion = {
  id: "shift",
  kind: "multi_choice_grid",
  prompt: "Availability by day",
  rows: [
    { id: "mon", label: "Monday" },
    { id: "tue", label: "Tuesday" },
  ],
  columns: [
    { value: "am", label: "Morning" },
    { value: "pm", label: "Afternoon" },
  ],
  required: true,
};

const CB_GRID: CheckboxGridQuestion = {
  id: "skills",
  kind: "checkbox_grid",
  prompt: "Skills by area",
  rows: [{ id: "kitchen", label: "Kitchen" }],
  columns: [
    { value: "cook", label: "Cook" },
    { value: "clean", label: "Clean" },
  ],
  required: false,
};

function grid(question: MultiChoiceGridQuestion | CheckboxGridQuestion) {
  return Questionnaire.parse({
    version: "1",
    pages: [
      { id: "p1", kind: "questions", title: "Grid", questions: [question] },
    ],
  });
}

describe("grid definition validation", () => {
  it("accepts a well-formed grid", () => {
    expect(validateQuestionnaireDefinition(grid(MC_GRID)).ok).toBe(true);
  });

  it("rejects duplicate row ids", () => {
    const bad = grid({
      ...MC_GRID,
      rows: [
        { id: "mon", label: "Monday" },
        { id: "mon", label: "Monday again" },
      ],
    });
    const result = validateQuestionnaireDefinition(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === "duplicate_id")).toBe(true);
    }
  });

  it("rejects duplicate column values", () => {
    const bad = grid({
      ...MC_GRID,
      columns: [
        { value: "am", label: "Morning" },
        { value: "am", label: "Also morning" },
      ],
    });
    const result = validateQuestionnaireDefinition(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some((i) => i.code === "duplicate_option_value"),
      ).toBe(true);
    }
  });
});

describe("grid answer validation", () => {
  it("multiple-choice grid: one column per row is valid", () => {
    const r = validateOne(MC_GRID, { mon: ["am"], tue: ["pm"] });
    expect(r).toEqual({ ok: true, value: { mon: ["am"], tue: ["pm"] } });
  });

  it("multiple-choice grid: two columns in one row is rejected", () => {
    const r = validateOne(MC_GRID, { mon: ["am", "pm"], tue: ["am"] });
    expect(r.ok).toBe(false);
  });

  it("required grid rejects a missing row", () => {
    const r = validateOne(MC_GRID, { mon: ["am"] });
    expect(r.ok).toBe(false);
  });

  it("drops unknown rows and unknown columns", () => {
    const r = validateOne(MC_GRID, {
      mon: ["am", "ghost_col"],
      tue: ["pm"],
      ghost_row: ["am"],
    });
    // ghost_col dropped -> mon has one pick; ghost_row dropped entirely.
    expect(r).toEqual({ ok: true, value: { mon: ["am"], tue: ["pm"] } });
  });

  it("optional checkbox grid left blank is a valid skip", () => {
    expect(validateOne(CB_GRID, {})).toEqual({ ok: true, value: undefined });
  });

  it("checkbox grid allows several columns per row", () => {
    const r = validateOne(CB_GRID, { kitchen: ["cook", "clean"] });
    expect(r).toEqual({ ok: true, value: { kitchen: ["cook", "clean"] } });
  });

  it("submission validation keeps a normalised grid answer", () => {
    const out = validateSubmission(grid(MC_GRID), {
      shift: { mon: ["am"], tue: ["am"] },
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.responses.shift).toEqual({ mon: ["am"], tue: ["am"] });
    }
  });
});

describe("grid aggregation", () => {
  it("tallies per row against that row's respondents", () => {
    const responses: QuestionnaireResponses[] = [
      { shift: { mon: ["am"], tue: ["pm"] } },
      { shift: { mon: ["am"], tue: ["am"] } },
      { shift: { mon: ["pm"], tue: ["pm"] } },
    ];
    const agg = aggregateQuestion(MC_GRID, responses);
    expect(agg.chart).toBe("grid");
    if (agg.chart !== "grid") return;
    expect(agg.responded).toBe(3);
    const mon = agg.rows.find((r) => r.id === "mon");
    expect(mon?.responded).toBe(3);
    expect(mon?.columns.find((c) => c.value === "am")?.count).toBe(2);
    expect(mon?.columns.find((c) => c.value === "pm")?.count).toBe(1);
    const tue = agg.rows.find((r) => r.id === "tue");
    expect(tue?.columns.find((c) => c.value === "pm")?.count).toBe(2);
  });

  it("counts an all-empty grid as skipped, not answered", () => {
    const agg = aggregateQuestion(MC_GRID, [{ shift: {} }, {}]);
    expect(agg.chart).toBe("grid");
    expect(agg.responded).toBe(0);
    expect(agg.skipped).toBe(2);
  });
});

// The grid answer must round-trip through the Questionnaire response schema
// (proves the QuestionnaireResponseValue union broadening is JSONB-safe).
describe("grid response schema", () => {
  it("parses a grid value in the flat response map", () => {
    const parsed = Questionnaire.safeParse(grid(MC_GRID));
    expect(parsed.success).toBe(true);
  });
});
