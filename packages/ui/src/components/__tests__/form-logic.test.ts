import { describe, it, expect } from "vitest";
import {
  countWords,
  wordCountStatus,
  passwordStrength,
  PASSWORD_MIN_LENGTH,
} from "../../lib/form-logic";

describe("countWords", () => {
  it("is 0 for empty / whitespace / nullish", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t ")).toBe(0);
    expect(countWords(null)).toBe(0);
    expect(countWords(undefined)).toBe(0);
  });

  it("splits on runs of whitespace and keeps hyphenated words whole", () => {
    expect(countWords("one")).toBe(1);
    expect(countWords("  a   well-run   camp ")).toBe(3);
    expect(countWords("line one\nline two")).toBe(4);
  });
});

describe("wordCountStatus", () => {
  it("flags over-max", () => {
    const s = wordCountStatus("a b c d", { max: 3 });
    expect(s.count).toBe(4);
    expect(s.over).toBe(true);
    expect(s.under).toBe(false);
  });

  it("flags under-min", () => {
    const s = wordCountStatus("a b", { min: 5 });
    expect(s.under).toBe(true);
    expect(s.over).toBe(false);
  });

  it("is neither over nor under within bounds", () => {
    const s = wordCountStatus("a b c", { min: 2, max: 5 });
    expect(s.over).toBe(false);
    expect(s.under).toBe(false);
    expect(s.max).toBe(5);
  });
});

describe("passwordStrength", () => {
  it("is empty/score 0 for no input", () => {
    const s = passwordStrength("");
    expect(s.score).toBe(0);
    expect(s.label).toBe("");
    expect(s.percent).toBe(0);
    expect(s.meetsMin).toBe(false);
  });

  it("marks below-minimum as too short and not meeting min", () => {
    const s = passwordStrength("short"); // 5 chars
    expect(s.meetsMin).toBe(false);
    expect(s.label).toBe("Too short");
    expect(s.score).toBe(1);
  });

  it("clears the 15-char minimum at exactly the boundary", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(15);
    const s = passwordStrength("a".repeat(15));
    expect(s.meetsMin).toBe(true);
    expect(s.label).toBe("Fair");
    expect(s.score).toBe(2);
  });

  it("strengthens with length only (no composition rules)", () => {
    expect(passwordStrength("a".repeat(22)).label).toBe("Good");
    expect(passwordStrength("a".repeat(22)).score).toBe(3);
    const strong = passwordStrength("a".repeat(40));
    expect(strong.label).toBe("Strong");
    expect(strong.score).toBe(4);
    expect(strong.percent).toBe(100);
  });
});
