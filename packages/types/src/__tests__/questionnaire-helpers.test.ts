import { describe, it, expect } from "vitest";
import {
  ATTENDED_YEAR_MAX,
  ATTENDED_YEAR_MIN,
  NO_BURN_YEARS,
  OTHER_PREFIX,
  attendedYearOptions,
  isOtherAnswer,
  isValidAttendedYear,
  otherAnswerText,
  toOtherAnswer,
  validateOne,
} from "../index";
import { SINGLE_SELECT } from "./question-fixtures";

// The "Other…" encoding keeps free text in the same flat response map as the
// listed options, and the attended-year rule encodes a fact about AfrikaBurn
// (no burn in 2020 or 2021) rather than a type. Both are enforced in exactly
// one place each, so nothing else would notice them changing.

describe("Other-answer encoding", () => {
  it("round trips through the prefix", () => {
    const stored = toOtherAnswer("in a mutant vehicle");
    expect(stored).toBe(`${OTHER_PREFIX}in a mutant vehicle`);
    expect(isOtherAnswer(stored)).toBe(true);
    expect(otherAnswerText(stored)).toBe("in a mutant vehicle");
  });

  it("stays unambiguous when the free text contains a colon", () => {
    // Only the FIRST prefix is stripped — "a:b" must come back as "a:b".
    expect(otherAnswerText(toOtherAnswer("a:b"))).toBe("a:b");
  });

  it("returns an empty string, not undefined, for a listed option value", () => {
    expect(isOtherAnswer("yes")).toBe(false);
    expect(otherAnswerText("yes")).toBe("");
  });

  it("encodes an empty free text as the bare prefix, which validateOne refuses", () => {
    // Asserted as a pair so the encoder and the validator cannot drift apart:
    // if the prefix ever changed, this refusal would stop matching.
    const stored = toOtherAnswer("");
    expect(stored).toBe(OTHER_PREFIX);
    expect(validateOne({ ...SINGLE_SELECT, allowOther: true }, stored)).toEqual(
      {
        ok: false,
        error: "Tell us what your 'other' answer is",
      },
    );
  });
});

describe("attended years", () => {
  it("accepts the real edition years and refuses the range's outside", () => {
    expect(isValidAttendedYear(ATTENDED_YEAR_MIN)).toBe(true);
    expect(isValidAttendedYear(2019)).toBe(true);
    expect(isValidAttendedYear(ATTENDED_YEAR_MAX)).toBe(true);
    expect(isValidAttendedYear(ATTENDED_YEAR_MIN - 1)).toBe(false);
    expect(isValidAttendedYear(ATTENDED_YEAR_MAX + 1)).toBe(false);
  });

  it("refuses the pandemic no-burn years and a non-integer", () => {
    expect(isValidAttendedYear(2020)).toBe(false);
    expect(isValidAttendedYear(2021)).toBe(false);
    expect(isValidAttendedYear(2019.5)).toBe(false);
  });

  it("offers the full range newest-first with exactly the no-burn years disabled", () => {
    // Asserted against the exported constants rather than a literal count, so
    // moving the edition year is not a test chore.
    const options = attendedYearOptions();
    expect(options).toHaveLength(ATTENDED_YEAR_MAX - ATTENDED_YEAR_MIN + 1);
    expect(options[0]?.year).toBe(ATTENDED_YEAR_MAX);
    expect(options.at(-1)?.year).toBe(ATTENDED_YEAR_MIN);
    expect(options.filter((o) => o.disabled).map((o) => o.year)).toEqual(
      [...NO_BURN_YEARS].sort((a, b) => b - a),
    );
    // Every other year is offered, so the grid is never accidentally empty.
    expect(options.filter((o) => !o.disabled).length).toBe(
      options.length - NO_BURN_YEARS.length,
    );
  });
});
