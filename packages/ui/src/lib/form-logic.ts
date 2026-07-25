// Pure, framework-agnostic form logic shared by the interactive form controls
// (Textarea word count, PasswordInput strength meter). No React, no "use client"
// — so it is unit-testable in isolation and safe to import from any tree.
//
// NB: `countWords` mirrors the definition of "a word" in @quagga/core's
// word-count.ts. It is duplicated here deliberately rather than adding a
// cross-package dependency on @quagga/core (which would churn the lockfile and
// pull server-domain logic into the UI layer). Keep the two definitions in step.

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

export interface WordCountStatus {
  /** Derived word count. */
  count: number;
  /** The max prop passed through (undefined when uncapped). */
  max?: number;
  /** True when a max is set and the count exceeds it. */
  over: boolean;
  /** True when a min is set and the count is below it (0 counts as below). */
  under: boolean;
}

/** Derive the live counter state for a word-counted textarea. */
export function wordCountStatus(
  value: string | null | undefined,
  opts: { min?: number; max?: number } = {},
): WordCountStatus {
  const count = countWords(value);
  const { min, max } = opts;
  return {
    count,
    max,
    over: max != null && count > max,
    under: min != null && count < min,
  };
}

/** Minimum password length (accounts-security-spec §Security principles: 15+,
 *  no composition rules, no forced rotation, no confirm-twice). */
export const PASSWORD_MIN_LENGTH = 15;

export type PasswordStrengthScore = 0 | 1 | 2 | 3 | 4;

export interface PasswordStrength {
  /** Raw character length. */
  length: number;
  /** Whether the password clears the single-factor minimum. */
  meetsMin: boolean;
  /** Coarse strength bucket, 0 (empty) … 4 (strong). Length-based ONLY. */
  score: PasswordStrengthScore;
  /** Human label for the current bucket ("" when empty). */
  label: string;
  /** Bar fill 0–100, for the strength meter. */
  percent: number;
}

// Length past which the meter is considered full, for the % calculation.
const STRENGTH_FULL_AT = 32;

/**
 * Length-based password strength — no composition rules by design. Below the
 * 15-char minimum reads as "Too short"; above it strengthens with length only.
 */
export function passwordStrength(
  password: string,
  min: number = PASSWORD_MIN_LENGTH,
): PasswordStrength {
  const length = password.length;
  const percent = Math.round((Math.min(length, STRENGTH_FULL_AT) / STRENGTH_FULL_AT) * 100);

  if (length === 0) {
    return { length, meetsMin: false, score: 0, label: "", percent: 0 };
  }
  if (length < min) {
    return { length, meetsMin: false, score: 1, label: "Too short", percent };
  }
  if (length < 20) {
    return { length, meetsMin: true, score: 2, label: "Fair", percent };
  }
  if (length < 30) {
    return { length, meetsMin: true, score: 3, label: "Good", percent };
  }
  return { length, meetsMin: true, score: 4, label: "Strong", percent };
}
