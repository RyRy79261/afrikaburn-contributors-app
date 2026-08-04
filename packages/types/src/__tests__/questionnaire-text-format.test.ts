import { describe, it, expect } from "vitest";
import { validateOne, type ShortTextQuestion } from "../index";

// `format` presets are a CLOSED enum on purpose — author-supplied regex would
// be a ReDoS surface on a server-side validator. The presets are reachable only
// through a short_text question, so nothing else in the package exercises them,
// and a preset that silently accepted everything would look identical to a
// working one in the UI. Hence: every arm gets an accept AND a refuse, and the
// refusal copy (which a respondent reads) is asserted verbatim.

function shortText(extra: Partial<ShortTextQuestion> = {}): ShortTextQuestion {
  return {
    id: "answer",
    kind: "short_text",
    prompt: "Your answer",
    maxLength: 200,
    required: false,
    ...extra,
  };
}

describe("text format — the pass-through arms", () => {
  it("accepts anything when no format is set, and when it is explicitly 'text'", () => {
    const anything = "Camp 404 — 100% dust, #nofilter";
    expect(validateOne(shortText(), anything)).toEqual({
      ok: true,
      value: anything,
    });
    expect(validateOne(shortText({ format: "text" }), anything)).toEqual({
      ok: true,
      value: anything,
    });
  });
});

describe("text format — email, url, alphanumeric", () => {
  it("email accepts an address and refuses anything else", () => {
    const q = shortText({ format: "email" });
    expect(validateOne(q, "alice@example.com").ok).toBe(true);
    expect(validateOne(q, "alice at example")).toEqual({
      ok: false,
      error: "Enter a valid email address",
    });
  });

  it("url refuses a bare domain and names both schemes it accepts", () => {
    const q = shortText({ format: "url" });
    expect(validateOne(q, "https://afrikaburn.org/camps").ok).toBe(true);
    expect(validateOne(q, "afrikaburn.org")).toEqual({
      ok: false,
      error: "Enter a link starting with http:// or https://",
    });
  });

  it("alphanumeric allows spaces but refuses punctuation", () => {
    const q = shortText({ format: "alphanumeric" });
    expect(validateOne(q, "Camp 404").ok).toBe(true);
    expect(validateOne(q, "Camp #404")).toEqual({
      ok: false,
      error: "Letters and numbers only",
    });
  });
});

describe("text format — phone applies the same digit bound as the phone kind", () => {
  // The 7–15 digit E.164 rule is written twice in the source: once in
  // validateOne's `phone` arm, once in this preset. They are tested separately
  // (here and in questionnaire-validate-one.test.ts) precisely so drift between
  // the two shows up as a failure rather than as inconsistent product behaviour.
  const q = shortText({ format: "phone" });

  it("accepts a spaced South African number", () => {
    expect(validateOne(q, "+27 82 123 4567").ok).toBe(true);
  });

  it("refuses too few digits even when the character shape passes", () => {
    // Seven characters, four digits.
    expect(validateOne(q, "1-2-3-4")).toEqual({
      ok: false,
      error: "Enter a valid phone number",
    });
  });

  it("refuses more digits than E.164 allows", () => {
    expect(validateOne(q, "1234567890123456789")).toEqual({
      ok: false,
      error: "Enter a valid phone number",
    });
  });
});

describe("text format — the numeric presets", () => {
  it("number refuses a whitespace-only answer and a non-number", () => {
    // A whitespace-only answer reaches here because validateOne treats only the
    // literal empty string as missing.
    const q = shortText({ format: "number" });
    expect(validateOne(q, "   ")).toEqual({
      ok: false,
      error: "Enter a number",
    });
    expect(validateOne(q, "abc")).toEqual({
      ok: false,
      error: "Enter a number",
    });
    expect(validateOne(q, "1.5").ok).toBe(true);
  });

  it("integer refuses a fraction that number would accept", () => {
    const q = shortText({ format: "integer" });
    expect(validateOne(q, "1.5")).toEqual({
      ok: false,
      error: "Enter a whole number",
    });
    expect(validateOne(q, "5").ok).toBe(true);
  });

  it("min and max carry the bound in the message", () => {
    expect(validateOne(shortText({ format: "number", min: 2 }), "1")).toEqual({
      ok: false,
      error: "Must be at least 2",
    });
    expect(validateOne(shortText({ format: "number", max: 2 }), "3")).toEqual({
      ok: false,
      error: "Must be at most 2",
    });
    const bounded = shortText({ format: "number", min: 2, max: 5 });
    expect(validateOne(bounded, "3")).toEqual({ ok: true, value: "3" });
  });

  it("min and max bind only on the numeric presets", () => {
    // Same bound, non-numeric preset: a plain text answer is not compared
    // against min/max, so "1" passes.
    const q = shortText({ format: "text", min: 2, max: 5 });
    expect(validateOne(q, "1")).toEqual({ ok: true, value: "1" });
  });
});

describe("text format — ordering and trimming", () => {
  it("reports the LENGTH error first when an answer is both too long and malformed", () => {
    const q = shortText({ format: "email", maxLength: 5 });
    expect(validateOne(q, "not-an-email")).toEqual({
      ok: false,
      error: "Max 5 characters",
    });
  });

  it("trims before the format check but stores the answer as posted", () => {
    // Deliberate: surrounding whitespace must not fail a valid email, and the
    // stored value is still the raw answer. Both halves are asserted so neither
    // can change invisibly.
    const q = shortText({ format: "email" });
    expect(validateOne(q, " alice@example.com ")).toEqual({
      ok: true,
      value: " alice@example.com ",
    });
  });
});
