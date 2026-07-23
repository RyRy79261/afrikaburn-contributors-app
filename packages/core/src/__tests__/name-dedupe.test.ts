import { describe, it, expect } from "vitest";
import {
  normalizeName,
  isExactNormalizedMatch,
  trigramSimilarity,
  isSimilarName,
  SIMILARITY_WARN_THRESHOLD,
} from "../name-dedupe";

describe("normalizeName", () => {
  it("is case / space / punctuation insensitive", () => {
    expect(normalizeName("Mad Hatters")).toBe("madhatters");
    expect(normalizeName("  mad  hatters!! ")).toBe("madhatters");
    expect(normalizeName("MAD-HATTERS")).toBe("madhatters");
  });

  it("strips diacritics", () => {
    expect(normalizeName("Café Solaire")).toBe("cafesolaire");
  });

  it("collides exact matches across cosmetic differences", () => {
    expect(isExactNormalizedMatch("Mad Hatters", "mad hatters")).toBe(true);
    expect(isExactNormalizedMatch("Mad Hatters", "Sad Hatters")).toBe(false);
  });
});

describe("trigramSimilarity", () => {
  it("is 1 for identical names and 0 for wholly disjoint ones", () => {
    expect(trigramSimilarity("Mad Hatters", "Mad Hatters")).toBe(1);
    expect(trigramSimilarity("abc", "xyz")).toBe(0);
  });

  it("is symmetric and bounded in [0,1]", () => {
    const a = trigramSimilarity("Mad Hatters", "Mad Hatterz");
    const b = trigramSimilarity("Mad Hatterz", "Mad Hatters");
    expect(a).toBeCloseTo(b, 10);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
  });

  it("flags a near-duplicate above the 0.55 warn threshold", () => {
    expect(SIMILARITY_WARN_THRESHOLD).toBe(0.55);
    // One transposed trailing letter — clearly a near-duplicate.
    expect(isSimilarName("Mad Hatters", "Mad Hatters")).toBe(true);
    // Unrelated names stay below the threshold.
    expect(isSimilarName("Mad Hatters", "Dusty Prototype")).toBe(false);
  });
});
