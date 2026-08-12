import type { SectionKey } from "@quagga/types";
import { SECTION_LABELS, formForSection } from "@quagga/types";

// Previous-year duplication + change comparison (roadmap R1, "the flagship
// fewer-forms feature": returning camps confirm deltas instead of re-entering).
//
// ── THE RULE (Ryan, 12 Aug 2026) ────────────────────────────────────────────
//
// A RETURNING CAMP STILL MAKES A NEW PROPOSAL. New Form 1, new Form 2, reviewed
// on its own merits. Carry-forward is a TYPING AID, never a shortcut through the
// process: what it produces is a PRE-FILLED DRAFT that the camp must go through
// and update, not a registration that is already half-answered.
//
// Two consequences the code has to honour, and both are easy to get wrong:
//
//   1. **Pre-filled is not complete.** The store deliberately does NOT mark any
//      section complete after carrying forward — see `carryForwardRegistration`
//      in apps/web. A camp that could carry forward and immediately submit would
//      be submitting last year's proposal with this year's date on it.
//
//   2. **Everything Form 2 asks starts empty.** Placement, layout, size and
//      sound are new every year, full stop.
//
// ── WHY FORM 2 IS THE LINE ──────────────────────────────────────────────────
//
// It is not an arbitrary list. Form 2 exists precisely because "how big are you,
// where do you want to be, what noise will you make, and where is your layout
// diagram" are questions NOBODY CAN ANSWER IN SEPTEMBER (see FORM_2_SECTION_KEYS
// in @quagga/types). Pre-filling those from last year would hand a September
// applicant a set of January answers they never gave — the exact failure the
// two-form split exists to prevent — and a reviewer would have no way to tell a
// confirmed answer from a copied one.
//
// It is also concretely unsafe. Placement zones are configured PER EDITION YEAR
// (`getPlacementZones` in ./placement-zones), so a carried-over 2026 zone string
// may name a zone that does not exist in 2027 — a stale value sitting in a
// dropdown that no longer offers it. And the erf and camp code are staff-assigned
// per edition; they are not in this module's field set at all, so they can never
// leak across a year.
//
// WHY THIS IS PURE. Deciding what carries and what must be re-answered is a
// policy question that wants tests, not a database question. The store applies
// the patch; this module decides what the patch contains, and `diffRegistrations`
// is the same table read the other way round.

/**
 * The registration fields this module reasons about — the typed `registrations`
 * columns that hold a camp's ANSWERS. Deliberately not the whole row: status,
 * decision and timestamp columns are lifecycle, not answers, and carrying them
 * would forge a decision nobody made.
 */
export interface CarryForwardFields {
  s1ContactEmail?: string | null;
  s1AltContactName?: string | null;
  s1AltContactPhone?: string | null;
  s1AltContactEmail?: string | null;
  s2LntPlan?: string | null;
  s2LntLeadName?: string | null;
  s2LntLeadPhone?: string | null;
  s2LntLeadEmail?: string | null;
  s3ParticipationPlan?: string | null;
  s3OperatingHours?: readonly string[] | null;
  s3ScheduleDetail?: string | null;
  s3GiftingFood?: boolean | null;
  s4ExpectedPopulation?: number | null;
  s4FirstArrivalDate?: string | null;
  s4WorkAccessPasses?: number | null;
  s4AreaDimensions?: string | null;
  s4LayoutUploadUrls?: readonly string[] | null;
  s5AmplifiedMusic?: string | null;
  s5SoundPlan?: string | null;
  s5PlacementFirstChoice?: string | null;
  s5PlacementSecondChoice?: string | null;
  s5NeighbourRequest?: string | null;
  s5FamilyFriendly?: string | null;
  s6SuppliersNote?: string | null;
  s6PaidPerformers?: boolean | null;
  s6FeeStructure?: string | null;
  s6ExpectedBudgetZar?: number | null;
  s6PlugAndPlayAck?: boolean | null;
  grantsInterest?: boolean | null;
}

export type CarryForwardField = keyof CarryForwardFields;

/** Which section a field belongs to, for grouping the comparison view. */
const FIELD_SECTION: Record<CarryForwardField, SectionKey> = {
  s1ContactEmail: "identity",
  s1AltContactName: "identity",
  s1AltContactPhone: "identity",
  s1AltContactEmail: "identity",
  s2LntPlan: "lnt",
  s2LntLeadName: "lnt",
  s2LntLeadPhone: "lnt",
  s2LntLeadEmail: "lnt",
  s3ParticipationPlan: "participation",
  s3OperatingHours: "participation",
  s3ScheduleDetail: "participation",
  s3GiftingFood: "participation",
  s4ExpectedPopulation: "size_logistics",
  s4FirstArrivalDate: "size_logistics",
  s4WorkAccessPasses: "size_logistics",
  s4AreaDimensions: "size_logistics",
  s4LayoutUploadUrls: "size_logistics",
  s5AmplifiedMusic: "sound_placement",
  s5SoundPlan: "sound_placement",
  s5PlacementFirstChoice: "sound_placement",
  s5PlacementSecondChoice: "sound_placement",
  s5NeighbourRequest: "sound_placement",
  s5FamilyFriendly: "sound_placement",
  s6SuppliersNote: "suppliers_commerce",
  s6PaidPerformers: "suppliers_commerce",
  s6FeeStructure: "suppliers_commerce",
  s6ExpectedBudgetZar: "suppliers_commerce",
  s6PlugAndPlayAck: "suppliers_commerce",
  grantsInterest: "suppliers_commerce",
};

/** Human labels for the comparison view. */
const FIELD_LABELS: Record<CarryForwardField, string> = {
  s1ContactEmail: "Contact email",
  s1AltContactName: "Alternate contact name",
  s1AltContactPhone: "Alternate contact phone",
  s1AltContactEmail: "Alternate contact email",
  s2LntPlan: "Leave No Trace plan",
  s2LntLeadName: "LNT lead name",
  s2LntLeadPhone: "LNT lead phone",
  s2LntLeadEmail: "LNT lead email",
  s3ParticipationPlan: "Participation plan",
  s3OperatingHours: "Operating hours",
  s3ScheduleDetail: "Schedule detail",
  s3GiftingFood: "Gifting food or drink",
  s4ExpectedPopulation: "Expected population",
  s4FirstArrivalDate: "First arrival date",
  s4WorkAccessPasses: "Work Access Passes",
  s4AreaDimensions: "Area dimensions",
  s4LayoutUploadUrls: "Layout uploads",
  s5AmplifiedMusic: "Amplified sound level",
  s5SoundPlan: "Sound plan",
  s5PlacementFirstChoice: "Placement — first choice",
  s5PlacementSecondChoice: "Placement — second choice",
  s5NeighbourRequest: "Neighbour request",
  s5FamilyFriendly: "Family friendly",
  s6SuppliersNote: "Suppliers note",
  s6PaidPerformers: "Paid performers",
  s6FeeStructure: "Fee structure",
  s6ExpectedBudgetZar: "Expected budget (ZAR)",
  s6PlugAndPlayAck: "Plug & Play acknowledgement",
  grantsInterest: "Interested in a creative project grant",
};

/** Every field this module knows about, in canonical (section, then form) order. */
export const CARRY_FORWARD_FIELDS: readonly CarryForwardField[] = Object.keys(
  FIELD_SECTION,
) as CarryForwardField[];

/**
 * Form 1 fields that STILL do not carry, each for its own reason. Everything
 * Form 2 asks is excluded structurally (see `NON_CARRIED_FIELDS` below); these
 * two are the exceptions inside Form 1.
 *
 *   · `s6PlugAndPlayAck` — an ACKNOWLEDGEMENT is a person committing, this year,
 *     that this year's camp is not plug-and-play. Copying a tick from last year
 *     manufactures consent that was never given, which is the one thing an
 *     anti-commerce commitment cannot survive.
 *
 *   · `grantsInterest` — a per-edition intent tied to that edition's grant round,
 *     not a standing property of the camp.
 */
const NON_CARRIED_FORM_1_FIELDS: readonly CarryForwardField[] = [
  "s6PlugAndPlayAck",
  "grantsInterest",
];

/**
 * Everything that starts empty in a new edition: every Form 2 field, plus the
 * two Form 1 exceptions above.
 *
 * DERIVED, NOT LISTED. A hand-written list would drift the moment a field moves
 * between sections or a new one is added — and the failure mode of that drift is
 * silent: last year's placement quietly reappearing in this year's draft. Asking
 * `formForSection` means a field added to `sound_placement` tomorrow is excluded
 * automatically, which is the safe direction to fail.
 */
export const NON_CARRIED_FIELDS: readonly CarryForwardField[] =
  CARRY_FORWARD_FIELDS.filter(
    (field) =>
      formForSection(FIELD_SECTION[field]) === 2 ||
      NON_CARRIED_FORM_1_FIELDS.includes(field),
  );

/** The fields that actually copy into a new edition's draft. */
export const CARRIED_FIELDS: readonly CarryForwardField[] =
  CARRY_FORWARD_FIELDS.filter((f) => !NON_CARRIED_FIELDS.includes(f));

/** The section a field belongs to. */
export function sectionForField(field: CarryForwardField): SectionKey {
  return FIELD_SECTION[field];
}

/** The human label for a field. */
export function labelForField(field: CarryForwardField): string {
  return FIELD_LABELS[field];
}

/** True when a value counts as "no answer" for comparison purposes. */
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Build the patch that seeds a new edition's draft from a prior registration.
 *
 * Only non-empty carried fields appear in the result, so the caller can spread
 * it over a fresh row without writing nulls across columns the camp may already
 * have touched. Returns `{}` when there is nothing worth carrying.
 */
export function buildCarryForwardPatch(
  prior: CarryForwardFields,
): Partial<CarryForwardFields> {
  const patch: Record<string, unknown> = {};
  for (const field of CARRIED_FIELDS) {
    const value = prior[field];
    if (!isEmpty(value)) patch[field] = value;
  }
  return patch as Partial<CarryForwardFields>;
}

/** How a single field moved between two editions. */
export type FieldChangeKind = "unchanged" | "changed" | "added" | "cleared";

export interface FieldChange {
  field: CarryForwardField;
  label: string;
  section: SectionKey;
  sectionLabel: string;
  kind: FieldChangeKind;
  prior: unknown;
  current: unknown;
  /** False when the field is one that deliberately never carries forward. */
  carried: boolean;
}

/** Order-insensitive for arrays; strict everywhere else. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const left = [...a].map(String).sort();
    const right = [...b].map(String).sort();
    return left.every((v, i) => v === right[i]);
  }
  if (typeof a === "string" && typeof b === "string") {
    return a.trim() === b.trim();
  }
  return a === b;
}

/**
 * Compare a prior edition's registration against the current one, field by
 * field.
 *
 * `added` means the camp answered something it left blank last year; `cleared`
 * means the reverse. Both are reported because a reviewer reading a diff needs
 * "this used to say something and now says nothing" to be visible rather than
 * absent — a silently emptied sound plan is precisely the change worth catching.
 */
export function diffRegistrations(
  prior: CarryForwardFields,
  current: CarryForwardFields,
): FieldChange[] {
  return CARRY_FORWARD_FIELDS.map((field) => {
    const priorValue = prior[field] ?? null;
    const currentValue = current[field] ?? null;
    const priorEmpty = isEmpty(priorValue);
    const currentEmpty = isEmpty(currentValue);

    let kind: FieldChangeKind;
    if (priorEmpty && currentEmpty) kind = "unchanged";
    else if (priorEmpty) kind = "added";
    else if (currentEmpty) kind = "cleared";
    else kind = sameValue(priorValue, currentValue) ? "unchanged" : "changed";

    const section = FIELD_SECTION[field];
    return {
      field,
      label: FIELD_LABELS[field],
      section,
      sectionLabel: SECTION_LABELS[section],
      kind,
      prior: priorValue,
      current: currentValue,
      carried: !NON_CARRIED_FIELDS.includes(field),
    };
  });
}

/** Just the fields that moved — what a reviewer actually wants to read. */
export function changedFields(
  prior: CarryForwardFields,
  current: CarryForwardFields,
): FieldChange[] {
  return diffRegistrations(prior, current).filter(
    (c) => c.kind !== "unchanged",
  );
}

/** A one-line summary for the console list, e.g. "4 changes since 2026". */
export function summarizeChanges(
  changes: readonly FieldChange[],
  priorYear: number,
): string {
  const moved = changes.filter((c) => c.kind !== "unchanged").length;
  if (moved === 0) return `No changes since ${priorYear}`;
  return `${moved} change${moved === 1 ? "" : "s"} since ${priorYear}`;
}
