import { describe, it, expect } from "vitest";
import {
  countWords,
  isWithinWordLimit,
  wordsRemaining,
  CAMP_DESCRIPTION_WORD_LIMIT,
} from "../word-count";

describe("countWords", () => {
  it("counts whitespace-separated words", () => {
    expect(countWords("a lantern-lit dome in the dust")).toBe(6);
  });

  it("treats empty / whitespace / nullish as zero", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t ")).toBe(0);
    expect(countWords(null)).toBe(0);
    expect(countWords(undefined)).toBe(0);
  });

  it("collapses irregular spacing and does not split hyphenated words", () => {
    expect(countWords("  well-run   camp\tkitchen ")).toBe(3);
  });
});

describe("60-word limit", () => {
  it("defaults to the camp-description limit of 60", () => {
    expect(CAMP_DESCRIPTION_WORD_LIMIT).toBe(60);
    const sixty = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");
    const sixtyOne = `${sixty} over`;
    expect(isWithinWordLimit(sixty)).toBe(true);
    expect(isWithinWordLimit(sixtyOne)).toBe(false);
  });

  it("reports words remaining, negative when over", () => {
    expect(wordsRemaining("one two three", 60)).toBe(57);
    expect(wordsRemaining("one two three", 2)).toBe(-1);
  });
});
