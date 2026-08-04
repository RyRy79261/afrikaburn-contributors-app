import { describe, it, expect } from "vitest";
import {
  CANONICAL_CAMP_CATEGORIES,
  CATEGORY_SUGGESTED_MAX,
  normalizeCategoryLabel,
  categoryLabelConflicts,
  validateCampCategory,
  countCategoryUsage,
  categorySelectionExceedsSuggested,
  matchesCategoryFilter,
} from "../camp-categories";

describe("CANONICAL_CAMP_CATEGORIES", () => {
  it("is the eight-strong seed catalog matching the directory canvas chips", () => {
    expect(CANONICAL_CAMP_CATEGORIES.map((c) => c.label)).toEqual([
      "Family-friendly",
      "Food & drink",
      "Workshops & talks",
      "Music & sound",
      "Art & making",
      "Chill & shade",
      "Bar",
      "Performance",
    ]);
  });

  it("every canonical category carries an emoji", () => {
    for (const c of CANONICAL_CAMP_CATEGORIES) {
      expect(c.emoji.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate labels (normalized)", () => {
    const normalized = CANONICAL_CAMP_CATEGORIES.map((c) =>
      normalizeCategoryLabel(c.label),
    );
    expect(new Set(normalized).size).toBe(normalized.length);
  });
});

describe("normalizeCategoryLabel", () => {
  it("collapses case, spacing and punctuation", () => {
    expect(normalizeCategoryLabel("Food & Drink")).toBe(
      normalizeCategoryLabel("  food&drink  "),
    );
    expect(normalizeCategoryLabel("Family-Friendly")).toBe(
      normalizeCategoryLabel("family friendly"),
    );
  });
});

describe("categoryLabelConflicts", () => {
  const existing = [
    { id: "a", label: "Food & drink" },
    { id: "b", label: "Bar" },
  ];

  it("flags a normalized-equal label as a conflict", () => {
    expect(
      categoryLabelConflicts(
        "food and drink".replace(" and ", " & "),
        existing,
      ),
    ).toBe(true);
    expect(categoryLabelConflicts("  BAR ", existing)).toBe(true);
  });

  it("does not flag a genuinely new label", () => {
    expect(categoryLabelConflicts("Performance", existing)).toBe(false);
  });

  it("ignores the row being renamed (exceptId)", () => {
    expect(categoryLabelConflicts("Bar", existing, "b")).toBe(false);
    expect(categoryLabelConflicts("Bar", existing, "a")).toBe(true);
  });

  it("treats an all-punctuation/empty label as non-conflicting", () => {
    expect(categoryLabelConflicts("   ", existing)).toBe(false);
  });
});

describe("validateCampCategory", () => {
  const existing = [{ id: "a", label: "Bar" }];

  it("accepts a valid new category and normalizes the label", () => {
    const result = validateCampCategory(
      { label: "  Music & sound ", emoji: "🔊", sort: 3 },
      existing,
    );
    expect(result).toEqual({
      ok: true,
      label: "Music & sound",
      labelNormalized: normalizeCategoryLabel("Music & sound"),
      emoji: "🔊",
      sort: 3,
    });
  });

  it("defaults emoji + sort to null when omitted", () => {
    const result = validateCampCategory({ label: "Chill & shade" }, existing);
    expect(result).toMatchObject({ ok: true, emoji: null, sort: null });
  });

  it("rejects an empty label", () => {
    const result = validateCampCategory({ label: "   " }, existing);
    expect(result.ok).toBe(false);
  });

  it("rejects an over-long label", () => {
    const result = validateCampCategory({ label: "x".repeat(41) }, existing);
    expect(result.ok).toBe(false);
  });

  it("rejects a duplicate (normalized) label", () => {
    const result = validateCampCategory({ label: "bar" }, existing);
    expect(result).toEqual({
      ok: false,
      error: '"bar" already exists for this edition.',
    });
  });

  it("allows renaming a category to its own current label", () => {
    const result = validateCampCategory({ label: "Bar" }, existing, "a");
    expect(result.ok).toBe(true);
  });
});

describe("countCategoryUsage", () => {
  it("counts pickers per category and omits unused ones", () => {
    const counts = countCategoryUsage([
      { categoryId: "x" },
      { categoryId: "x" },
      { categoryId: "y" },
    ]);
    expect(counts.get("x")).toBe(2);
    expect(counts.get("y")).toBe(1);
    expect(counts.has("z")).toBe(false);
  });

  it("is empty for no assignments", () => {
    expect(countCategoryUsage([]).size).toBe(0);
  });
});

describe("categorySelectionExceedsSuggested", () => {
  it("flags only counts above the suggested max", () => {
    expect(categorySelectionExceedsSuggested(CATEGORY_SUGGESTED_MAX)).toBe(
      false,
    );
    expect(categorySelectionExceedsSuggested(CATEGORY_SUGGESTED_MAX + 1)).toBe(
      true,
    );
  });
});

describe("matchesCategoryFilter", () => {
  const entry = { categories: [{ id: "a" }, { id: "b" }] };

  it("matches everything when the filter is empty", () => {
    expect(matchesCategoryFilter(entry, null)).toBe(true);
    expect(matchesCategoryFilter(entry, undefined)).toBe(true);
    expect(matchesCategoryFilter(entry, "")).toBe(true);
  });

  it("matches only entries carrying the selected category", () => {
    expect(matchesCategoryFilter(entry, "a")).toBe(true);
    expect(matchesCategoryFilter(entry, "z")).toBe(false);
    expect(matchesCategoryFilter({ categories: [] }, "a")).toBe(false);
  });
});
