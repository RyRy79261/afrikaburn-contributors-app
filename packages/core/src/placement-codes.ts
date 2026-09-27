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

// --- Reading a camp's placement (epic #48) ------------------------------------
//
// ONE SOURCE, READ — NEVER COPIED (ERF-019). The camp code and erf live on the
// camp's registration for the edition and nowhere else. The camp page, the
// registration summary and, later, every logistics module (container, gas,
// water, wood) READ them through this shape; none of them keeps its own copy.
// A copied erf is a second truth that goes stale the first time Placements
// revises it, and erfs are revised several times before the map is final.

/** A camp's placement for one edition, as every reader sees it. */
export interface CampPlacement {
  campCode: string | null;
  erf: string | null;
  /**
   * DERIVED, not stored: an erf has been written down. There is no
   * "placement allocated" status value — adding one would make a second
   * source that could disagree with the erf column.
   */
  placementAllocated: boolean;
}

/** Whether a stored erf means the camp has a placement. */
export function isPlacementAllocated(erf: string | null | undefined): boolean {
  return normalizeErf(erf) !== null;
}

/**
 * The placement to show for a registration row, or null when there is nothing
 * to show yet (no registration, or neither field assigned). Re-normalises on
 * the way out, so a reader never depends on how carefully a writer stored it.
 */
export function campPlacementOf(
  row: { campCode: string | null; erf: string | null } | null | undefined,
): CampPlacement | null {
  if (!row) return null;
  const campCode = normalizeCampCode(row.campCode);
  const erf = normalizeErf(row.erf);
  if (campCode === null && erf === null) return null;
  return { campCode, erf, placementAllocated: erf !== null };
}

/**
 * Who may read a camp's placement: its members, and nobody else in the
 * participant app. An erf is where a camp will be on site — not something a
 * stranger browsing the directory needs, and for a free camp not something a
 * stranger may even learn exists. Org staff read it in the console under their
 * own capability.
 */
export function canViewCampPlacement(viewerIsMember: boolean): boolean {
  return viewerIsMember;
}

// --- Telling the camp its placement moved (epic #48) --------------------------
//
// Ryan, 27 Sep 2026: notify the camp's leads when the camp code or erf is FIRST
// ASSIGNED, and on EVERY CHANGE. The rules below are the whole of "did it
// change", in one pure place, so the console action cannot drift from its tests.

/** What a placement save means to the camp, or null when it means nothing new. */
export interface PlacementChange {
  /**
   * `set` when every field that moved was previously empty (a first
   * assignment); `changed` when any moved field replaced or removed a value
   * the camp already had.
   */
  verb: "set" | "changed";
  /** The camp's placement AFTER the save, one line: "MAH · C-14". */
  line: string;
}

/**
 * Compare a registration's placement before and after a save.
 *
 * Returns null — no notification — when:
 *  - nothing moved (re-saving the same values, or a value that only differs in
 *    case/whitespace and so normalizes to the same stored form); or
 *  - the only movement was CLEARING a field. That follows the wrangler
 *    precedent (unassigning is audited, not notified): "your erf has been
 *    removed" with nothing in its place gives the camp nothing to act on, and
 *    the camp page already stops showing the value.
 *
 * Both fields are compared in one call, so a save that moves both produces ONE
 * notice, not two.
 */
export function placementChange(
  before: { campCode: string | null; erf: string | null },
  after: { campCode: string | null; erf: string | null },
): PlacementChange | null {
  const prev = {
    campCode: normalizeCampCode(before.campCode),
    erf: normalizeErf(before.erf),
  };
  const next = {
    campCode: normalizeCampCode(after.campCode),
    erf: normalizeErf(after.erf),
  };
  const fields = ["campCode", "erf"] as const;
  const moved = fields.filter((f) => prev[f] !== next[f]);
  // Only a field that moved TO a value is news; a pure clear is not.
  if (!moved.some((f) => next[f] !== null)) return null;

  const verb = moved.some((f) => prev[f] !== null) ? "changed" : "set";
  const line = [next.campCode, next.erf]
    .filter((v): v is string => v !== null)
    .join(" · ");
  return { verb, line };
}
