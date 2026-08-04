// Camp categories ("theme topics" — build-spec §"Camp categories"). The org
// CRUDs a per-edition taxonomy; camps pick ≥0. This module is the pure logic:
//   - CANONICAL_CAMP_CATEGORIES: the seed catalog (org may edit freely);
//   - normalizeCategoryLabel + categoryLabelConflicts: per-edition dedupe;
//   - validateCampCategory: the CRUD validation (Zod + dedupe);
//   - countCategoryUsage: usage counts over the join rows;
//   - matchesCategoryFilter: the directory filter predicate.
//
// Pure logic only — no I/O, no DB. The store persists rows; this decides what
// is valid and derives counts/filters. The dedupe normalizer matches the groups
// name-dedupe rule so categories behave like every other named entity.

import { CampCategoryInput, CATEGORY_SUGGESTED_MAX } from "@quagga/types";
import { normalizeName } from "./name-dedupe";

export { CATEGORY_SUGGESTED_MAX };

/** One canonical seed category — a label + curated emoji. Sort = array order. */
export interface CanonicalCategory {
  label: string;
  emoji: string;
}

/**
 * The proposed seed set (build-spec §"Camp categories" + the /directory canvas
 * filter chips). The org can add/rename/remove freely after seeding; this is
 * only the starting catalog. Array order is the seed `sort`.
 */
export const CANONICAL_CAMP_CATEGORIES: readonly CanonicalCategory[] = [
  { label: "Family-friendly", emoji: "🧸" },
  { label: "Food & drink", emoji: "🍲" },
  { label: "Workshops & talks", emoji: "🛠️" },
  { label: "Music & sound", emoji: "🔊" },
  { label: "Art & making", emoji: "🎨" },
  { label: "Chill & shade", emoji: "🌿" },
  { label: "Bar", emoji: "🍹" },
  { label: "Performance", emoji: "🎭" },
];

/**
 * Normalize a category label for per-edition dedupe (case/space/punctuation-
 * insensitive) — the same rule the groups name-dedupe uses, so "Food & Drink",
 * "food and drink" (sans the ampersand→"and" nuance) and "  Food&Drink  " all
 * collapse together. This is the value stored in `camp_categories.labelNormalized`.
 */
export function normalizeCategoryLabel(label: string): string {
  return normalizeName(label);
}

/** A stored category row, trimmed to what the dedupe check needs. */
export interface CategoryLike {
  id: string;
  label: string;
}

/**
 * True when `label` collides (normalized) with any existing category for the
 * edition. `exceptId` skips a row (for rename — a category never conflicts with
 * itself).
 */
export function categoryLabelConflicts(
  label: string,
  existing: readonly CategoryLike[],
  exceptId?: string,
): boolean {
  const normalized = normalizeCategoryLabel(label);
  if (normalized === "") return false;
  return existing.some(
    (c) => c.id !== exceptId && normalizeCategoryLabel(c.label) === normalized,
  );
}

/** Successful validation carries the cleaned, storage-ready values. */
export type ValidateCategoryResult =
  | {
      ok: true;
      label: string;
      labelNormalized: string;
      emoji: string | null;
      sort: number | null;
    }
  | { ok: false; error: string };

/**
 * Validate an org CRUD payload for a camp category: shape (Zod boundary) +
 * per-edition dedupe. On success returns the trimmed label, its normalized
 * form, the emoji (or null), and the requested sort (or null → caller defaults).
 */
export function validateCampCategory(
  raw: unknown,
  existing: readonly CategoryLike[],
  exceptId?: string,
): ValidateCategoryResult {
  const parsed = CampCategoryInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid category.",
    };
  }
  const { label } = parsed.data;
  if (categoryLabelConflicts(label, existing, exceptId)) {
    return { ok: false, error: `"${label}" already exists for this edition.` };
  }
  return {
    ok: true,
    label,
    labelNormalized: normalizeCategoryLabel(label),
    emoji: parsed.data.emoji ?? null,
    sort: parsed.data.sort ?? null,
  };
}

/**
 * Usage counts (categoryId → number of groups) over the `group_categories`
 * join rows. Categories with zero pickers are absent from the map — callers
 * default to 0.
 */
export function countCategoryUsage(
  assignments: readonly { categoryId: string }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const a of assignments) {
    counts.set(a.categoryId, (counts.get(a.categoryId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Whether a proposed selection exceeds the *suggested* max. This never blocks a
 * save (the cap is a nudge) — the picker uses it to show a "keep it to ~4" hint.
 */
export function categorySelectionExceedsSuggested(count: number): boolean {
  return count > CATEGORY_SUGGESTED_MAX;
}

/** A directory entry carrying its assigned category ids (filter shape). */
export interface CategorizedEntry {
  categories: readonly { id: string }[];
}

/**
 * The directory category-filter predicate. A null/empty filter matches
 * everything ("All camps"); otherwise an entry matches iff it carries the
 * selected category.
 */
export function matchesCategoryFilter(
  entry: CategorizedEntry,
  categoryId: string | null | undefined,
): boolean {
  if (!categoryId) return true;
  return entry.categories.some((c) => c.id === categoryId);
}
