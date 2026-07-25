import { z } from "zod";

/**
 * Org-defined camp categories ("theme topics" — build-spec §"Camp categories").
 * A per-edition taxonomy the org CRUDs; camps pick ≥0 from their edition's
 * catalog. This is the validation authority (Zod boundary); the storage
 * authority is `camp_categories` / `group_categories` in @quagga/db, and the
 * dedupe/usage/derivation logic lives in @quagga/core (`camp-categories`).
 */

/** Soft cap — the picker *suggests* at most this many, never hard-blocks. */
export const CATEGORY_SUGGESTED_MAX = 4;

/** Label length bounds for an org category. */
export const CATEGORY_LABEL_MIN = 1;
export const CATEGORY_LABEL_MAX = 40;

/**
 * The org CRUD input for a single category. `emoji` is optional (a curated
 * single glyph); `sort` is the display order (defaulted server-side when
 * omitted). Per-edition dedupe on the normalized label is enforced in
 * @quagga/core + the DB unique index, not here.
 */
export const CampCategoryInput = z.object({
  label: z.string().trim().min(CATEGORY_LABEL_MIN).max(CATEGORY_LABEL_MAX),
  emoji: z.string().trim().min(1).max(16).nullish(),
  sort: z.number().int().min(0).max(9999).optional(),
});
export type CampCategoryInput = z.infer<typeof CampCategoryInput>;
