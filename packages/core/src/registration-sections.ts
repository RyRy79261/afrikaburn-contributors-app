import type { SectionKey } from "@quagga/types";
import { SECTION_KEYS } from "@quagga/types";
import { isWithinWordLimit } from "./word-count";
import { isNoAmplifiedSound } from "./sound";

// Per-section completeness predicates (build-spec §Core logic: "submit-gate —
// all six complete — define per-section completeness predicates"). These are
// the authority: the wizard computes `registrations.completed_sections` from
// them server-side (never trusting the client), and the client re-runs them for
// live progress. The submit gate (`isSubmittable` in ./entitlements) checks that
// every SECTION_KEY appears in that computed set.
//
// A section is "complete" when its REQUIRED fields are present and valid.
// Optional fields (alt contact, WAPs, layout uploads, schedule detail, supplier
// list, budget) never block completion — matching the real form's mandatory set.

/**
 * The fields the predicates read. Camp name/description live on the `groups`
 * row; everything else mirrors the `registrations` typed columns. All optional
 * so a fresh draft (all null) is trivially incomplete.
 */
export interface RegistrationSectionData {
  // Section 1 — Identity
  campName?: string | null;
  campDescription?: string | null;
  s1ContactEmail?: string | null;

  // Section 2 — Leave No Trace
  s2LntPlan?: string | null;
  s2LntLeadName?: string | null;
  s2LntLeadPhone?: string | null;
  s2LntLeadEmail?: string | null;

  // Section 3 — Participation & gifting
  s3ParticipationPlan?: string | null;
  s3OperatingHours?: readonly string[] | null;
  s3GiftingFood?: boolean | null;

  // Section 4 — Size & logistics
  s4ExpectedPopulation?: number | null;
  s4FirstArrivalDate?: string | null;
  s4AreaDimensions?: string | null;
  /**
   * The camp has drawn a layout for this registration
   * (docs/camp-layout-spec.md decision 11, "derive over ask"). The layout
   * states the plot's size, so the free-text area dimensions become optional.
   * Never written into `s4_area_dimensions`; the other section-4 answers are
   * still required, so a layout alone — or one carried from last year
   * (decision 12) — never completes the section.
   */
  hasLayout?: boolean | null;

  // Section 5 — Sound & placement
  s5AmplifiedMusic?: string | null;
  s5SoundPlan?: string | null;
  s5PlacementFirstChoice?: string | null;
  s5FamilyFriendly?: string | null;

  // Section 6 — Suppliers & commerce
  s6PaidPerformers?: boolean | null;
  s6FeeStructure?: string | null;
  s6PlugAndPlayAck?: boolean | null;
}

/** A trimmed, non-empty string. */
function filled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** A yes/no question is "answered" once it holds a real boolean. */
function answered(value: boolean | null | undefined): boolean {
  return typeof value === "boolean";
}

/** A positive population count. */
function positive(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** The per-section predicate table. Each returns true when the section is done. */
const SECTION_PREDICATES: Record<
  SectionKey,
  (d: RegistrationSectionData) => boolean
> = {
  identity: (d) =>
    filled(d.campName) &&
    filled(d.campDescription) &&
    isWithinWordLimit(d.campDescription) &&
    filled(d.s1ContactEmail),

  lnt: (d) =>
    filled(d.s2LntPlan) &&
    filled(d.s2LntLeadName) &&
    filled(d.s2LntLeadPhone) &&
    filled(d.s2LntLeadEmail),

  participation: (d) =>
    filled(d.s3ParticipationPlan) &&
    (d.s3OperatingHours?.length ?? 0) > 0 &&
    answered(d.s3GiftingFood),

  size_logistics: (d) =>
    positive(d.s4ExpectedPopulation) &&
    filled(d.s4FirstArrivalDate) &&
    (filled(d.s4AreaDimensions) || d.hasLayout === true),

  // A rig needs a sound plan; acoustic camps don't. Placement 1st choice and a
  // family-friendly answer are always required.
  sound_placement: (d) =>
    filled(d.s5AmplifiedMusic) &&
    filled(d.s5PlacementFirstChoice) &&
    filled(d.s5FamilyFriendly) &&
    (isNoAmplifiedSound(d.s5AmplifiedMusic) || filled(d.s5SoundPlan)),

  // Plug & Play acknowledgement is mandatory (anti-commerce commitment).
  suppliers_commerce: (d) =>
    answered(d.s6PaidPerformers) &&
    filled(d.s6FeeStructure) &&
    d.s6PlugAndPlayAck === true,
};

/** Whether one section is complete for the given data. */
export function isSectionComplete(
  key: SectionKey,
  data: RegistrationSectionData,
): boolean {
  return SECTION_PREDICATES[key](data);
}

/** The set of complete sections, in canonical order — the value stored in
 * `registrations.completed_sections`. */
export function completedSectionsFor(
  data: RegistrationSectionData,
): SectionKey[] {
  return SECTION_KEYS.filter((key) => isSectionComplete(key, data));
}

/**
 * The stored completed set, refreshed for a layout drawn since it was
 * computed: `completed_sections` is written by the wizard's autosave, so a
 * layout created afterwards would leave section 4 shown incomplete although
 * the camp owes nothing more there. Returns the new set in canonical order,
 * or null when nothing changes.
 */
export function completedSectionsWithLayout(
  completed: readonly string[],
  data: RegistrationSectionData,
): SectionKey[] | null {
  if (completed.includes("size_logistics")) return null;
  if (!isSectionComplete("size_logistics", { ...data, hasLayout: true })) {
    return null;
  }
  const next = new Set<string>([...completed, "size_logistics"]);
  return SECTION_KEYS.filter((k) => next.has(k));
}

