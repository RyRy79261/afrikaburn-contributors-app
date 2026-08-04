import { describe, it, expect } from "vitest";
import { Question, validateOne } from "../index";
import {
  BOOLEAN,
  DATE,
  EMAIL,
  FILE_LINK,
  KIND_SAMPLES,
  LINEAR_SCALE,
  LONG_TEXT,
  MULTI_SELECT,
  PHONE,
  RATING,
  SHORT_TEXT,
  SINGLE_SELECT,
  TIME,
  YEARS,
} from "./question-fixtures";

// `validateOne` is the ONLY server-side gate between a posted answer and
// `questionnaire_responses` / the `burner_bios` columns — nothing downstream
// re-validates. Every case below asserts the returned value or the returned
// message, never merely that the function ran: a checkbox posted as the string
// "yes" coerced to true, or an "Other" answer accepted on a question whose
// author never enabled Other, would write bad data silently.

describe("validateOne — the missing-value gate", () => {
  it("treats empty string, null and undefined alike and refuses a required question", () => {
    for (const missing of ["", null, undefined]) {
      expect(validateOne(EMAIL, missing)).toEqual({
        ok: false,
        error: "This question is required",
      });
    }
  });

  it("returns a skip (not an error) when an OPTIONAL question is left blank", () => {
    // The distinction matters: a skip must leave the key absent from the
    // response map, so `value` is undefined rather than "" or null.
    for (const missing of ["", null, undefined]) {
      expect(validateOne(LONG_TEXT, missing)).toEqual({
        ok: true,
        value: undefined,
      });
    }
  });
});

describe("validateOne — boolean", () => {
  it("accepts both booleans, including false (which is an answer, not a blank)", () => {
    expect(validateOne(BOOLEAN, true)).toEqual({ ok: true, value: true });
    expect(validateOne(BOOLEAN, false)).toEqual({ ok: true, value: false });
  });

  it("refuses the string 'yes' rather than coercing a checkbox truthy", () => {
    // A form that posts its checkbox as a string must fail loudly here; a
    // truthy coercion would store consent nobody gave.
    expect(validateOne(BOOLEAN, "yes")).toEqual({
      ok: false,
      error: "Expected yes or no",
    });
  });
});

describe("validateOne — email", () => {
  it("accepts an address and refuses a non-address", () => {
    expect(validateOne(EMAIL, "alice@example.com")).toEqual({
      ok: true,
      value: "alice@example.com",
    });
    expect(validateOne(EMAIL, "nope")).toEqual({
      ok: false,
      error: "Enter a valid email address",
    });
  });

  it("refuses a non-string before it reaches the regex", () => {
    expect(validateOne(EMAIL, 5)).toEqual({
      ok: false,
      error: "Expected text",
    });
  });
});

describe("validateOne — phone", () => {
  it("accepts a spaced South African number", () => {
    expect(validateOne(PHONE, "+27 82 123 4567")).toEqual({
      ok: true,
      value: "+27 82 123 4567",
    });
  });

  it("refuses letters and non-strings", () => {
    expect(validateOne(PHONE, "call me")).toEqual({
      ok: false,
      error: "Enter a valid phone number",
    });
    expect(validateOne(PHONE, 27821234567)).toEqual({
      ok: false,
      error: "Expected text",
    });
  });

  it("counts DIGITS, not characters, at both ends of the E.164 range", () => {
    // "1 2 3 4 5" satisfies the character-shape regex (9 chars of digits and
    // spaces) but carries only 5 digits — proof the digit count is the rule.
    expect(validateOne(PHONE, "1 2 3 4 5")).toEqual({
      ok: false,
      error: "Enter a valid phone number",
    });
    expect(validateOne(PHONE, "1234567890123456789")).toEqual({
      ok: false,
      error: "Enter a valid phone number",
    });
  });
});

describe("validateOne — single_select", () => {
  it("accepts a listed option and refuses an unlisted one", () => {
    expect(validateOne(SINGLE_SELECT, "yes")).toEqual({
      ok: true,
      value: "yes",
    });
    expect(validateOne(SINGLE_SELECT, "maybe")).toEqual({
      ok: false,
      error: "Not a valid option",
    });
  });

  it("refuses a non-string", () => {
    expect(validateOne(SINGLE_SELECT, ["yes"])).toEqual({
      ok: false,
      error: "Expected a choice",
    });
  });

  it("refuses an 'Other' answer the author never enabled", () => {
    // The authorisation-shaped case: allowOther is off, so free text is not an
    // answer this question can hold, however well-formed it looks.
    expect(validateOne(SINGLE_SELECT, "other:my own tent")).toEqual({
      ok: false,
      error: "Not a valid option",
    });
  });

  it("accepts 'Other' free text when enabled, but not an empty one", () => {
    const q = { ...SINGLE_SELECT, allowOther: true };
    expect(validateOne(q, "other:in a mutant vehicle")).toEqual({
      ok: true,
      value: "other:in a mutant vehicle",
    });
    expect(validateOne(q, "other:   ")).toEqual({
      ok: false,
      error: "Tell us what your 'other' answer is",
    });
  });
});

describe("validateOne — multi_select", () => {
  it("DROPS unknown values instead of erroring", () => {
    // Assert the exact array: an unknown value silently surviving into JSONB is
    // the failure this normalisation exists to prevent.
    expect(validateOne(MULTI_SELECT, ["build", "ghost", "kitchen"])).toEqual({
      ok: true,
      value: ["build", "kitchen"],
    });
  });

  it("refuses a non-array and an array holding a non-string", () => {
    expect(validateOne(MULTI_SELECT, "build")).toEqual({
      ok: false,
      error: "Expected a list of choices",
    });
    expect(validateOne(MULTI_SELECT, ["build", 7])).toEqual({
      ok: false,
      error: "Expected a list of choices",
    });
  });

  it("drops a disallowed 'Other', and says so when that leaves a required question empty", () => {
    // Returning ok:true with an empty array here would be silent data loss —
    // the respondent believes they answered.
    const required = { ...MULTI_SELECT, required: true };
    expect(validateOne(required, ["other:my own thing"])).toEqual({
      ok: false,
      error: "Pick at least one option",
    });
  });

  it("refuses empty free text on an allowed 'Other'", () => {
    const q = { ...MULTI_SELECT, allowOther: true };
    expect(validateOne(q, ["build", "other:  "])).toEqual({
      ok: false,
      error: "Tell us what your 'other' answer is",
    });
    expect(validateOne(q, ["other:night shift"])).toEqual({
      ok: true,
      value: ["other:night shift"],
    });
  });

  it("binds minSelections only once something is picked", () => {
    // An empty answer on an OPTIONAL question stays a valid skip even when a
    // minimum is set — otherwise a minimum would silently make it required.
    const q = { ...MULTI_SELECT, minSelections: 2 };
    expect(validateOne(q, [])).toEqual({ ok: true, value: [] });
    expect(validateOne(q, ["build"])).toEqual({
      ok: false,
      error: "Pick at least 2 options",
    });
  });

  it("refuses more picks than maxSelections", () => {
    const q = { ...MULTI_SELECT, maxSelections: 2 };
    expect(validateOne(q, ["build", "strike", "kitchen"])).toEqual({
      ok: false,
      error: "Pick at most 2 options",
    });
  });
});

describe("validateOne — linear_scale", () => {
  it("accepts an in-range integer and coerces the string a form posts", () => {
    expect(validateOne(LINEAR_SCALE, 4)).toEqual({ ok: true, value: 4 });
    // HTML forms post numbers as strings; the stored value must be a number.
    expect(validateOne(LINEAR_SCALE, "4")).toEqual({ ok: true, value: 4 });
  });

  it("refuses a boolean, which a bare Number() would have turned into 1 or 0", () => {
    expect(validateOne(LINEAR_SCALE, true)).toEqual({
      ok: false,
      error: "Pick a value on the scale",
    });
  });

  it("refuses a fraction and names both bounds when out of range", () => {
    expect(validateOne(LINEAR_SCALE, 2.5)).toEqual({
      ok: false,
      error: "Pick a value on the scale",
    });
    expect(validateOne(LINEAR_SCALE, 0)).toEqual({
      ok: false,
      error: "Pick a value between 1 and 5",
    });
    expect(validateOne(LINEAR_SCALE, 6)).toEqual({
      ok: false,
      error: "Pick a value between 1 and 5",
    });
  });
});

describe("validateOne — rating", () => {
  it("accepts a step and coerces the posted string", () => {
    expect(validateOne(RATING, 4)).toEqual({ ok: true, value: 4 });
    expect(validateOne(RATING, "4")).toEqual({ ok: true, value: 4 });
  });

  it("refuses 0, steps+1, a boolean and a fraction", () => {
    expect(validateOne(RATING, 0)).toEqual({
      ok: false,
      error: "Pick a rating between 1 and 5",
    });
    expect(validateOne(RATING, 6)).toEqual({
      ok: false,
      error: "Pick a rating between 1 and 5",
    });
    expect(validateOne(RATING, true)).toEqual({
      ok: false,
      error: "Pick a rating",
    });
    expect(validateOne(RATING, 3.5)).toEqual({
      ok: false,
      error: "Pick a rating",
    });
  });
});

describe("validateOne — time", () => {
  it("accepts the last minute of the day and refuses the first of the next", () => {
    expect(validateOne(TIME, "23:59")).toEqual({ ok: true, value: "23:59" });
    expect(validateOne(TIME, "24:00")).toEqual({
      ok: false,
      error: "Use 24-hour hh:mm",
    });
  });

  it("refuses a non-string", () => {
    expect(validateOne(TIME, 2359)).toEqual({
      ok: false,
      error: "Expected a time",
    });
  });
});

describe("validateOne — file_link", () => {
  it("stores the TRIMMED url", () => {
    expect(
      validateOne(FILE_LINK, "  https://example.com/layout.pdf  "),
    ).toEqual({ ok: true, value: "https://example.com/layout.pdf" });
  });

  it("refuses a non-http scheme and a non-string", () => {
    expect(validateOne(FILE_LINK, "ftp://example.com/layout.pdf")).toEqual({
      ok: false,
      error: "Enter a link starting with http:// or https://",
    });
    expect(validateOne(FILE_LINK, 42)).toEqual({
      ok: false,
      error: "Expected a link",
    });
  });
});

describe("validateOne — years", () => {
  it("dedupes while preserving first-seen order", () => {
    expect(validateOne(YEARS, ["2019", "2019", "2018"])).toEqual({
      ok: true,
      value: ["2019", "2018"],
    });
  });

  it("refuses the pandemic no-burn years by name", () => {
    // AfrikaBurn did not run in 2020 or 2021. This is a fact about the event,
    // not a type — a bio must not claim attendance at a burn that never was.
    expect(validateOne(YEARS, ["2020"])).toEqual({
      ok: false,
      error: "2020 isn't a valid AfrikaBurn year",
    });
    expect(validateOne(YEARS, ["2019", "2021"])).toEqual({
      ok: false,
      error: "2021 isn't a valid AfrikaBurn year",
    });
  });

  it("refuses a non-array, a non-string element and a non-year string", () => {
    expect(validateOne(YEARS, "2019")).toEqual({
      ok: false,
      error: "Expected a list of years",
    });
    expect(validateOne(YEARS, [2019])).toEqual({
      ok: false,
      error: "Expected a list of years",
    });
    expect(validateOne(YEARS, ["20x9"])).toEqual({
      ok: false,
      error: "20x9 isn't a valid AfrikaBurn year",
    });
  });

  it("refuses an empty list on a required question", () => {
    expect(validateOne({ ...YEARS, required: true }, [])).toEqual({
      ok: false,
      error: "Pick at least one year",
    });
  });
});

describe("validateOne — short_text and long_text", () => {
  it("names the bound it refused on", () => {
    const q = { ...SHORT_TEXT, maxLength: 10, minLength: 3 };
    expect(validateOne(q, "Camp 404 is a long name")).toEqual({
      ok: false,
      error: "Max 10 characters",
    });
    expect(validateOne(q, "hi")).toEqual({
      ok: false,
      error: "At least 3 characters",
    });
  });

  it("refuses a non-string", () => {
    expect(validateOne(SHORT_TEXT, 404)).toEqual({
      ok: false,
      error: "Expected text",
    });
  });

  it("never format-checks a long_text", () => {
    // Only short_text carries a `format` preset. Free prose that happens to
    // look like a malformed email is a perfectly good long answer.
    expect(validateOne(LONG_TEXT, "not-an-email, and that is fine")).toEqual({
      ok: true,
      value: "not-an-email, and that is fine",
    });
  });
});

describe("validateOne — date", () => {
  it("accepts an ISO date", () => {
    expect(validateOne(DATE, "2027-04-26")).toEqual({
      ok: true,
      value: "2027-04-26",
    });
  });

  it("refuses the wrong shape, and a right-shaped date that does not exist", () => {
    expect(validateOne(DATE, "26/04/2027")).toEqual({
      ok: false,
      error: "Use yyyy-mm-dd",
    });
    // Shape-valid, calendar-invalid — the branch Date.parse is there for.
    expect(validateOne(DATE, "2027-13-45")).toEqual({
      ok: false,
      error: "Not a real date",
    });
  });

  it("refuses a non-string", () => {
    expect(validateOne(DATE, 20270426)).toEqual({
      ok: false,
      error: "Expected a date",
    });
  });
});

describe("validateOne — exhaustiveness over the question union", () => {
  const unionKinds = Question.options.map((o) => o.shape.kind.value as string);

  it("has a sample for every kind in the Question union", () => {
    expect(KIND_SAMPLES.map((s) => s.question.kind).sort()).toEqual(
      [...unionKinds].sort(),
    );
  });

  it("returns a defined result for every kind", () => {
    // validateOne's switch has no default arm, so a kind added without an arm
    // compiles (under a widened type) and returns undefined at runtime — every
    // answer to it would then be accepted-by-absence downstream. This is the
    // assertion that goes red when that happens.
    for (const { question, answer } of KIND_SAMPLES) {
      const result = validateOne(question, answer);
      expect(result, `no result for kind ${question.kind}`).toBeDefined();
      expect(result.ok, `sample answer refused for ${question.kind}`).toBe(
        true,
      );
    }
  });
});
