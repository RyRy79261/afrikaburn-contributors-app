import { deriveCampPrefix } from "./member-ref-code";

// Staff-assigned camp codes and erf labels (roadmap R1: "Staff-assigned ERFs +
// camp codes on profiles — unblocks container booking without any placement
// tool").
//
// THIS IS DELIBERATELY NOT A PLACEMENT TOOL. The layout/erf work is parked
// because no structured map data exists to build against and the official map is
// a late-arriving PDF that changes every year (roadmap §"Placement & layout
// tooling", App Spec §13). What container booking and on-site logistics actually
// need from placement is far smaller: a short stable handle for the camp, and
// somewhere to write down the erf once a human has decided it. Both are strings
// a staff member types.
//
// SO THE ERF IS FREE TEXT ON PURPOSE, and the validator below refuses to invent
// a format AfrikaBurn has not given us. It normalizes case and whitespace, caps
// the length, and stops there. The moment AB supplies a real erf grammar this is
// the one function that changes.

/** Longest accepted erf label. Generous — nobody knows the real format yet. */
export const MAX_ERF_LENGTH = 32;

/** Longest accepted camp code. */
export const MAX_CAMP_CODE_LENGTH = 8;

const CAMP_CODE_RE = /^[A-Z0-9]{2,8}$/;

/**
 * Normalize a staff-typed erf label: trimmed, inner whitespace collapsed to one
 * space, upper-cased. Returns null for anything blank, so "cleared the field"
 * and "typed spaces" mean the same thing to the database.
 */
export function normalizeErf(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/\s+/g, " ").toUpperCase();
  return cleaned === "" ? null : cleaned;
}

/** Whether a normalized erf label is storable. Null (unassigned) is always fine. */
export function isValidErf(erf: string | null): boolean {
  if (erf === null) return true;
  return erf.length > 0 && erf.length <= MAX_ERF_LENGTH;
}

/**
 * Normalize a camp code to the stored form: A–Z and 0–9 only, upper-cased,
 * capped at 8 characters. Null when nothing usable remains.
 */
export function normalizeCampCode(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, MAX_CAMP_CODE_LENGTH);
  return cleaned === "" ? null : cleaned;
}

/** Whether a normalized camp code is storable. Null (unassigned) is always fine. */
export function isValidCampCode(code: string | null): boolean {
  if (code === null) return true;
  return CAMP_CODE_RE.test(code);
}

/**
 * Suggest a camp code for a camp, avoiding the codes already assigned in the
 * same edition.
 *
 * A SUGGESTION, NOT AN ASSIGNMENT. The staff member sees this pre-filled and can
 * overwrite it — AfrikaBurn has its own historical codes for long-running camps
 * (MAH-1 and friends), and a generated code must never quietly displace the one
 * a camp has answered to for six years. Uniqueness is still enforced in the
 * database; this only saves typing in the common case.
 */
export function suggestCampCode(
  campName: string,
  taken: Iterable<string>,
): string {
  const takenSet = new Set(
    [...taken]
      .map((c) => normalizeCampCode(c))
      .filter((c): c is string => c !== null),
  );
  const base = normalizeCampCode(deriveCampPrefix(campName)) ?? "XXX";
  if (!takenSet.has(base)) return base;

  // Same deterministic ladder as camp prefixes: letters first (they still read
  // as a name), then numbers.
  const core = base.slice(0, 3);
  for (const suffix of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const candidate = `${core}${suffix}`;
    if (!takenSet.has(candidate)) return candidate;
  }
  for (let n = 2; n <= 9999; n++) {
    const candidate = `${core}${n}`;
    if (candidate.length <= MAX_CAMP_CODE_LENGTH && !takenSet.has(candidate)) {
      return candidate;
    }
  }
  return `${core}${takenSet.size + 1}`.slice(0, MAX_CAMP_CODE_LENGTH);
}

/** Both staff-assigned placement fields for one registration. */
export interface PlacementAssignment {
  campCode: string | null;
  erf: string | null;
}

/**
 * Normalize and validate a staff placement assignment in one step. Throws with a
 * readable message rather than returning a result type, because both callers
 * (the server action and its test) want the failure to be loud.
 */
export function parsePlacementAssignment(input: {
  campCode?: string | null;
  erf?: string | null;
}): PlacementAssignment {
  const campCode = normalizeCampCode(input.campCode);
  const erf = normalizeErf(input.erf);
  if (!isValidCampCode(campCode)) {
    throw new Error(
      `A camp code is 2–${MAX_CAMP_CODE_LENGTH} letters or digits, e.g. MAH.`,
    );
  }
  if (!isValidErf(erf)) {
    throw new Error(`An erf label is at most ${MAX_ERF_LENGTH} characters.`);
  }
  return { campCode, erf };
}
