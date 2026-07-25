// Pure, framework-agnostic bulletin logic — the read-rate maths behind the org
// Bulletins list's "n of m read · p%" bar. No React, no "use client", so it is
// unit-testable in isolation and safe to import from any tree.

export interface ReadRate {
  /** Recipients who have opened the bulletin (clamped to 0…of). */
  read: number;
  /** Total recipients the bulletin was sent to. */
  of: number;
  /** Integer percentage 0–100 (0 when nobody was targeted). */
  percent: number;
}

/**
 * Derive the read-rate state for a bulletin. `read` is clamped into [0, of] so
 * a stale count can never render a >100% or negative bar; a zero-recipient
 * bulletin reads as 0%.
 */
export function readRate(read: number, of: number): ReadRate {
  const total = Math.max(0, Math.floor(of));
  const opened = Math.min(Math.max(0, Math.floor(read)), total);
  const percent = total === 0 ? 0 : Math.round((opened / total) * 100);
  return { read: opened, of: total, percent };
}
