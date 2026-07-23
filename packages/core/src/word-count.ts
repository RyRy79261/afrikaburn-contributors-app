// Word counting for the 60-word camp-description limit (build-spec §Schema,
// §apps/web routes). Pure + framework-agnostic so the wizard's live counter and
// the server-side submit validation share one definition of "a word".

/** The camp-description word cap enforced on theme camps. */
export const CAMP_DESCRIPTION_WORD_LIMIT = 60;

/**
 * Count words in a string: trimmed, split on any run of whitespace. Empty /
 * whitespace-only input is 0. Punctuation attached to a word does not split it
 * ("well-run" is one word).
 */
export function countWords(input: string | null | undefined): number {
  if (!input) return 0;
  const trimmed = input.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}

/** True when `input` is at or under the limit (default 60). */
export function isWithinWordLimit(
  input: string | null | undefined,
  limit: number = CAMP_DESCRIPTION_WORD_LIMIT,
): boolean {
  return countWords(input) <= limit;
}

/**
 * Words remaining before the limit — negative when over. Drives the live
 * counter ("12 words left" / "3 over").
 */
export function wordsRemaining(
  input: string | null | undefined,
  limit: number = CAMP_DESCRIPTION_WORD_LIMIT,
): number {
  return limit - countWords(input);
}
