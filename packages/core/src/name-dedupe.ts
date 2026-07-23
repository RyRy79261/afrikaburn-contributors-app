// Group-name de-duplication (build-spec §apps/web routes `/camps/new`):
// reject an exact normalized match; WARN on trigram similarity ≥ 0.55.
//
// `normalizeName` is the canonical uniqueness key (case/space/punct-
// insensitive) stored in `groups.name_normalized`. `trigramSimilarity`
// reproduces PostgreSQL pg_trgm's Jaccard-over-trigrams so a warning computed
// in the app matches what a DB-side `similarity()` would say.

/**
 * Canonical uniqueness key: lowercased, diacritics stripped, every
 * non-alphanumeric removed. "Mad Hatters!" and "mad  hatters" both collapse to
 * "madhatters" — so they collide on the unique index.
 */
export function normalizeName(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Two names collide iff their normalized keys are identical. */
export function isExactNormalizedMatch(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b);
}

/** The similarity at/above which the UI warns about a near-duplicate name. */
export const SIMILARITY_WARN_THRESHOLD = 0.55;

// pg_trgm pads each word with two leading spaces + one trailing space, then
// slides a 3-char window. e.g. "cat" -> {"  c"," ca","cat","at "}.
function trigramSet(input: string): Set<string> {
  const words = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const set = new Set<string>();
  for (const word of words) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) {
      set.add(padded.slice(i, i + 3));
    }
  }
  return set;
}

/**
 * Jaccard similarity of two names' trigram sets, in [0, 1] — mirrors pg_trgm's
 * `similarity()`. Two empty strings are treated as identical (1).
 */
export function trigramSimilarity(a: string, b: string): number {
  const A = trigramSet(a);
  const B = trigramSet(b);
  if (A.size === 0 && B.size === 0) return 1;
  let intersection = 0;
  for (const gram of A) if (B.has(gram)) intersection++;
  const union = A.size + B.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** True when two names are similar enough to warrant a near-duplicate warning. */
export function isSimilarName(
  a: string,
  b: string,
  threshold: number = SIMILARITY_WARN_THRESHOLD,
): boolean {
  return trigramSimilarity(a, b) >= threshold;
}
