import { describe, it, expect } from "vitest";
import { validateOne } from "../index";
import { CB_GRID, MC_GRID } from "./question-fixtures";

// A grid is ONE question whose answer is a nested map `{ [rowId]: column[] }`.
// Its normaliser is the only thing standing between a client-supplied row key
// or column value and a verbatim write into JSONB, so most of what follows
// asserts the exact returned map rather than just `ok`.

describe("grid answers — normalisation to the definition", () => {
  it("drops unknown rows and unknown columns rather than storing them", () => {
    const r = validateOne(MC_GRID, {
      mon: ["am", "ghost_col"],
      tue: ["pm"],
      ghost_row: ["am"],
    });
    expect(r).toEqual({ ok: true, value: { mon: ["am"], tue: ["pm"] } });
  });

  it("dedupes repeated column picks inside one row", () => {
    expect(validateOne(CB_GRID, { kitchen: ["am", "pm", "am"] })).toEqual({
      ok: true,
      value: { kitchen: ["am", "pm"] },
    });
  });

  it("skips a row answered as null or left out entirely", () => {
    // A row nobody could answer is not an error — the required check below is
    // what decides whether an unanswered row is acceptable.
    expect(validateOne(CB_GRID, { kitchen: null, gate: ["night"] })).toEqual({
      ok: true,
      value: { gate: ["night"] },
    });
  });
});

describe("grid answers — one column per row vs many", () => {
  it("multi_choice_grid refuses two columns in one row and names that row", () => {
    // The row LABEL is the whole UX of the failure — the respondent has to know
    // which row to fix.
    expect(validateOne(MC_GRID, { mon: ["am", "pm"], tue: ["am"] })).toEqual({
      ok: false,
      error: 'Pick one column for "Monday"',
    });
  });

  it("checkbox_grid accepts many columns in one row", () => {
    expect(validateOne(CB_GRID, { kitchen: ["am", "pm", "night"] })).toEqual({
      ok: true,
      value: { kitchen: ["am", "pm", "night"] },
    });
  });
});

describe("grid answers — malformed payloads", () => {
  it("refuses a non-object and an array", () => {
    expect(validateOne(MC_GRID, 5)).toEqual({
      ok: false,
      error: "Expected a grid of answers",
    });
    expect(validateOne(MC_GRID, ["am"])).toEqual({
      ok: false,
      error: "Expected a grid of answers",
    });
  });

  it("refuses a row cell that is not an array of strings, naming the row", () => {
    expect(validateOne(MC_GRID, { mon: "am" })).toEqual({
      ok: false,
      error: 'Malformed answer for "Monday"',
    });
    expect(validateOne(MC_GRID, { mon: [1] })).toEqual({
      ok: false,
      error: 'Malformed answer for "Monday"',
    });
  });
});

describe("grid answers — required and skipped", () => {
  it("required grid names the MISSING row when only some rows are answered", () => {
    expect(validateOne(MC_GRID, { mon: ["am"] })).toEqual({
      ok: false,
      error: 'Answer every row — "Tuesday" is missing',
    });
  });

  it("optional grid posted as an empty object is a valid skip", () => {
    // Not an empty-map write: the key must stay out of the response map.
    expect(validateOne(CB_GRID, {})).toEqual({ ok: true, value: undefined });
  });

  it("optional grid whose every pick was dropped is also a valid skip", () => {
    // The row key was real but the column was not, so nothing survives
    // normalisation — that is a skip, not a `{ kitchen: [] }` write.
    expect(validateOne(CB_GRID, { kitchen: ["ghost_col"] })).toEqual({
      ok: true,
      value: undefined,
    });
  });
});
