import type { BurnerBioFields, BioExtras } from "./bio";

// Burner Bio rollover into a new edition (Ryan, 12 Aug 2026: "We copy across the
// Burner bio but they still have to complete that — consider it pre-filled and
// they have to update it").
//
// `burner_bios` is one row per user × edition. A new edition therefore starts
// every returning burner at a blank form describing a person who has not
// changed, which is the fewer-forms law read backwards. So the new edition's
// onboarding opens PRE-FILLED from the person's most recent prior bio.
//
// ── IT IS PRE-FILL, NOT A COMPLETED BIO ─────────────────────────────────────
//
// The carried view is handed back with `completedAt: null`, which is what the
// onboarding gate reads (`apps/web/app/(app)/onboarding/page.tsx` redirects only
// when `completedAt` is set). So a returning burner still walks the flow, still
// reviews every step, and still presses the final button. Nothing is silently
// re-asserted on their behalf — emergency contacts and medical notes especially
// are things a person should look at once a year.
//
// ── WHAT DOES NOT CARRY ─────────────────────────────────────────────────────
//
//   · **`firstTime`.** The only one. An edition-relative claim: someone who
//     attended last year is not a first-timer this year, so copying `true`
//     forward would state something false on their behalf. Reset to `false`,
//     which is what having a prior bio already implies.
//
// ── THE ID DOCUMENT DOES CARRY ──────────────────────────────────────────────
//
// The reason is the plain one (Ryan, 12 Aug 2026): an SA ID number does not
// change, ever. Making someone re-type thirteen digits every year is pure
// administrative burden — precisely what the fewer-forms law exists to remove —
// and the field stays editable for the case that does change, a renewed
// passport. Gate verification against the ticket is a live purpose for the
// edition they are now registering for, so the lawful basis arises again rather
// than being stretched. A row is only written when they SAVE, so nothing is
// persisted for an edition they never engaged with.
//
// AN EARLIER VERSION OF THIS FILE DROPPED THEM, on the stated grounds that
// carrying would "re-arm the retention clock and defeat the purge" in
// ./id-retention. That was wrong twice over, and both corrections belong here so
// the mistake is not re-introduced as a precaution:
//
//   1. `identifyPurgeableIdBios` is scoped PER BIO ROW, keyed on that row's own
//      edition (`expiredEditionIds.has(bio.editionId)`). A new edition's row
//      cannot extend an older row's window; it would have its own.
//
//   2. **THERE IS NO PURGE JOB.** ./id-retention is a pure, tested RULE with no
//      caller anywhere in this repo — nothing reads it, and nothing ever writes
//      `buildIdPurgePatch()` to the database. docs/accounts-security-spec.md
//      says so explicitly ("Wiring a scheduled purge job that applies this is a
//      LATER task"). So no ID data is currently deleted on any schedule, and any
//      argument here that leans on one being deleted is unsound.
//
// The honest consequence: ID ciphertext accumulates one row per user per edition
// and nothing removes it. Carrying forward does not create that gap — a returning
// burner would type the same number into the new edition's row anyway — but it
// does make the missing purge job more worth building, not less.
//
// **Medical notes carry** for a related reason: the failure mode of dropping
// them is a returning burner with a real condition arriving on-site with an empty
// medical field because re-typing it felt optional. Carried forward it is shown
// back during a flow they must complete, so it gets confirmed or corrected
// rather than lost.
//
// Encryption, hard-locked privacy and the medical access log are unchanged by any
// of this. When no `PGCRYPTO_KEY` is configured, `decryptOrNull` yields null
// upstream and nothing sensitive carries at all — the correct fail-safe.

/** What a new edition's onboarding opens with, derived from the prior bio. */
export interface BioCarryForward {
  fields: BurnerBioFields;
  extras: BioExtras;
  privacyFlags: Record<string, boolean>;
}

/** Fields deliberately dropped on rollover — see the module header. */
export const BIO_NON_CARRIED_FIELDS = ["firstTime"] as const;

/**
 * Build the pre-fill for a new edition from the person's most recent prior bio.
 *
 * Pure: the caller decides which row is "most recent" and is responsible for
 * presenting the result with `completedAt: null`.
 */
export function buildBioCarryForward(prior: {
  fields: BurnerBioFields;
  extras: BioExtras;
  privacyFlags: Record<string, boolean>;
}): BioCarryForward {
  return {
    fields: {
      ...prior.fields,
      // The ID document carries — see the module header. The new edition's row
      // gets its own retention window; the prior edition's is purged on its own
      // schedule regardless.
      // An edition-relative claim, re-answered each year.
      firstTime: false,
    },
    extras: { ...prior.extras },
    // Privacy choices carry: a person who made their skills public last year
    // should not silently become private, nor the reverse. Hard-locked fields
    // are forced private downstream regardless of what is stored here.
    privacyFlags: { ...prior.privacyFlags },
  };
}
