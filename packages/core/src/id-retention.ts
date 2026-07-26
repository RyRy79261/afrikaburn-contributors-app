// ID / passport retention (docs/accounts-security-spec.md §"ID document —
// lawful purpose + retention"; Ryan, 26 Jul 2026).
//
// LAWFUL PURPOSE. SA ID / passport are collected on `burner_bios` for a single
// documented purpose: ON-SITE IDENTITY VERIFICATION against the ticket at the
// gate. That purpose is SPENT once an edition's gate has closed and the event has
// ended, so the data becomes purgeable — POPIA's storage-limitation principle
// (keep personal information no longer than necessary for the purpose).
//
// PURITY CONTRACT (as with the rest of @quagga/core): no I/O, no env, no DB, no
// crypto. This module owns the RULE — which editions' ID data has aged out, and
// what a purge patch looks like — so a scheduled purge job (a LATER task) has one
// tested implementation to apply. Nothing here reads or writes the database; the
// job supplies rows and applies the returned patch.

/** An edition, reduced to what the retention rule needs. `endDate` is the ISO
 * `YYYY-MM-DD` string stored on `editions.end_date`. */
export interface RetentionEdition {
  id: string;
  /** `editions.end_date` — ISO date string (YYYY-MM-DD). */
  endDate: string;
}

/** A bio row, reduced to what the retention rule needs. */
export interface RetentionBio {
  id: string;
  editionId: string;
  /** base64 ciphertext, or null when no SA ID was ever stored. */
  saIdEncrypted: string | null;
  /** base64 ciphertext, or null when no passport was ever stored. */
  passportEncrypted: string | null;
}

/**
 * Days AFTER an edition's end date before its ID data is purgeable. A small,
 * bounded grace: the gate is the purpose, but late arrivals, gate disputes and
 * access reconciliation can run a few weeks past the closing date. After this
 * window the data has no remaining lawful purpose and is purged.
 */
export const ID_RETENTION_GRACE_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The instant an edition's ID data becomes purgeable: end of its `endDate` plus
 * the grace window. Uses the end of the end-date day (UTC) so an edition is never
 * treated as expired on its final day.
 */
export function idRetentionExpiresAt(
  edition: RetentionEdition,
  graceDays: number = ID_RETENTION_GRACE_DAYS,
): Date {
  // Parse the ISO date as UTC midnight, advance to the END of that day, then add
  // the grace window. `new Date("YYYY-MM-DD")` is parsed as UTC by spec.
  const endOfDay = new Date(`${edition.endDate}T23:59:59.999Z`).getTime();
  return new Date(endOfDay + graceDays * MS_PER_DAY);
}

/**
 * Whether an edition's ID retention window has elapsed as of `now` (i.e. its ID
 * data is purgeable). False for a malformed end date — never purge on ambiguous
 * input.
 */
export function isIdRetentionExpired(
  edition: RetentionEdition,
  now: Date,
  graceDays: number = ID_RETENTION_GRACE_DAYS,
): boolean {
  const expiresAt = idRetentionExpiresAt(edition, graceDays).getTime();
  if (Number.isNaN(expiresAt)) return false;
  return now.getTime() > expiresAt;
}

/** Whether a bio currently holds any ID data worth purging. */
export function bioHasIdData(bio: RetentionBio): boolean {
  return bio.saIdEncrypted !== null || bio.passportEncrypted !== null;
}

/** The patch a purge applies to a bio row — nulls both encrypted ID columns. */
export interface IdPurgePatch {
  saIdEncrypted: null;
  passportEncrypted: null;
}

/** Build the purge patch (both ID columns → null). */
export function buildIdPurgePatch(): IdPurgePatch {
  return { saIdEncrypted: null, passportEncrypted: null };
}

/** A bio identified as holding purgeable ID data, with its edition for the trail. */
export interface PurgeableIdBio {
  bioId: string;
  editionId: string;
}

/**
 * Identify the bios whose ID data is purgeable: those belonging to an edition
 * whose retention window has elapsed AND that still hold ID data. Pure — the
 * caller (a later scheduled job) selects the rows, calls this, and applies
 * `buildIdPurgePatch()` to each returned `bioId`.
 *
 * An edition present in `bios` but absent from `editions` is treated as UNKNOWN
 * and its bios are left alone (never purge without a confirmed expired edition).
 */
export function identifyPurgeableIdBios(input: {
  now: Date;
  editions: readonly RetentionEdition[];
  bios: readonly RetentionBio[];
  graceDays?: number;
}): PurgeableIdBio[] {
  const graceDays = input.graceDays ?? ID_RETENTION_GRACE_DAYS;
  const expiredEditionIds = new Set(
    input.editions
      .filter((e) => isIdRetentionExpired(e, input.now, graceDays))
      .map((e) => e.id),
  );

  return input.bios
    .filter((b) => expiredEditionIds.has(b.editionId) && bioHasIdData(b))
    .map((b) => ({ bioId: b.id, editionId: b.editionId }));
}
