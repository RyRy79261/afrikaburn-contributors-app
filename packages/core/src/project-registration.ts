import { z } from "zod";
import {
  PROJECT_ADMIN_ROLES,
  type MembershipRole,
  type QuestionnaireResponses,
} from "@quagga/types";

// Creative-project registration parity (epic #52 · App Spec §18 CREATIVE-005,
// -007, -014, -017, -019).
//
// Artworks and mutant vehicles sit on the same `groups` spine as camps but keep
// their kind-specific answers in a project-namespaced questionnaire response
// (apps/web/lib/project-registration-store.ts). So the features built onto the
// camp registration — Work Access Passes, previous-year duplication — never
// reached them. This module holds the POLICY for those features; the stores
// only apply it. Pure: no I/O, no React.
//
// INSTALLATIONS (CREATIVE-005) are artworks. There is no separate group kind:
// an installation registers through /artworks/new, and nothing in this module
// or the schema distinguishes them. See docs/technical-spec.md §18.

/** The two creative-project kinds that register through their own forms. */
export const PROJECT_REGISTRATION_KINDS = [
  "artwork",
  "mutant_vehicle",
] as const;
export type ProjectRegistrationKind =
  (typeof PROJECT_REGISTRATION_KINDS)[number];

/** Narrow an arbitrary group kind to a project kind, or null. */
export function asProjectRegistrationKind(
  kind: string | null | undefined,
): ProjectRegistrationKind | null {
  return kind === "artwork" || kind === "mutant_vehicle" ? kind : null;
}

// ── Work Access Passes (CREATIVE-014) ─────────────────────────────────────
//
// A project requests WAPs exactly as a camp does: one whole number, stored on
// `registrations.s4_work_access_passes`, allocated separately by AfrikaBurn.
// The ceiling mirrors the camp wizard's `nullableInt(100_000)` so the column
// has one bound whichever form wrote it.

export const MAX_WORK_ACCESS_PASS_REQUEST = 100_000;

/** Zod for the WAP request at a project form's boundary. Empty = not asked. */
export const WorkAccessPassRequest = z
  .number()
  .int("Work Access Passes are a whole number.")
  .min(0, "Work Access Passes can't be negative.")
  .max(MAX_WORK_ACCESS_PASS_REQUEST)
  .nullable()
  .default(null);

// ── Previous-year duplication (CREATIVE-019) ─────────────────────────────
//
// THE SAME RULE AS CAMPS (registration-carry-forward.ts, Ryan 12 Aug 2026): a
// returning project still makes a NEW proposal. Carrying forward produces a
// pre-filled DRAFT, never a registration that is already answered:
//
//   · Nothing is submitted, nothing is marked complete. A project registration
//     has no `completed_sections`; its equivalent is the submit gate, and every
//     kind has at least one gate-required answer that NEVER carries (burn
//     intent for art; SOOP level, flame effects, night driving and the DMV
//     acknowledgements for vehicles). So a carried draft cannot be submitted
//     until someone has answered this year's questions this year.
//     `carriedDraftIsIncomplete` states that as a test-pinned invariant.
//
//   · What is new every year starts empty — the camp rule's Form 2 line applied
//     to a project: footprint, placement, sound and the WAP count are "how big,
//     where, how loud, how many early", which nobody can answer before the new
//     edition's planning starts.
//
//   · Intents and consents never carry: grant interest (per grant round), burn
//     intent, flame effects, night driving (each a per-burn safety declaration)
//     and the DMV acknowledgements (a person committing, this year).
//
// AN ALLOW-LIST, ON PURPOSE. The camp module derives its excluded set from the
// Form 2 split so a new field fails SAFE (excluded). Project answers have no such
// structure to derive from, so the safe direction here is to name what DOES
// carry: a key added to a form tomorrow starts empty until someone decides it
// should carry.

const CARRIED_ANSWER_KEYS: Record<ProjectRegistrationKind, readonly string[]> =
  {
    artwork: [
      "artist_or_collective",
      "description",
      // Concept art identifies the piece; unlike a camp's per-year layout
      // diagram it says nothing about this year's placement.
      "images",
      "power_needs",
      "build_plan",
      "strike_plan",
    ],
    mutant_vehicle: [
      "base_vehicle",
      "mutation_description",
      // The same physical vehicle — its photos are its identity for the DMV.
      "photos",
    ],
  };

/** Every answer key that deliberately starts empty in a new edition. Listed
 * for the UI copy and the tests; the carry decision reads the allow-list. */
const NON_CARRIED_ANSWER_KEYS: Record<
  ProjectRegistrationKind,
  readonly string[]
> = {
  artwork: [
    "width_m",
    "depth_m",
    "height_m",
    "placement_notes",
    "burn_intent",
    "grant_interest",
    "work_access_passes",
  ],
  mutant_vehicle: [
    "soop_level",
    "flame_effects",
    "night_driving",
    "acknowledgements",
    "work_access_passes",
  ],
};

export function carriedProjectAnswerKeys(
  kind: ProjectRegistrationKind,
): readonly string[] {
  return CARRIED_ANSWER_KEYS[kind];
}

export function nonCarriedProjectAnswerKeys(
  kind: ProjectRegistrationKind,
): readonly string[] {
  return NON_CARRIED_ANSWER_KEYS[kind];
}

/** Null, undefined, blank string or empty array — "not answered". */
export function isUnansweredValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * The answers a prior edition's payload contributes to a new draft: only
 * allow-listed keys, only non-empty values.
 */
export function buildProjectCarryForwardAnswers(
  kind: ProjectRegistrationKind,
  prior: QuestionnaireResponses | null | undefined,
): QuestionnaireResponses {
  const patch: QuestionnaireResponses = {};
  if (!prior) return patch;
  for (const key of CARRIED_ANSWER_KEYS[kind]) {
    const value = prior[key];
    if (value !== undefined && !isUnansweredValue(value)) patch[key] = value;
  }
  return patch;
}

/**
 * Lay a carry-forward patch over whatever this edition's draft already holds.
 * ONLY EMPTY KEYS ARE FILLED — a lead who already typed this year's build plan
 * must not lose it to last year's. Returns the merged payload and which keys
 * were filled (the count the UI reports).
 */
export function mergeProjectCarryForward(
  current: QuestionnaireResponses | null | undefined,
  patch: QuestionnaireResponses,
): { answers: QuestionnaireResponses; filled: string[] } {
  const answers: QuestionnaireResponses = { ...(current ?? {}) };
  const filled: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (isUnansweredValue(answers[key])) {
      answers[key] = value;
      filled.push(key);
    }
  }
  return { answers, filled };
}

/**
 * The mirrored `registrations` columns a carried draft should hold, derived
 * from the merged answers so the column and the payload can never disagree.
 * Only columns whose source answer carries appear here; everything else stays
 * whatever the row already says (null on a fresh draft).
 */
export function projectCarriedColumns(
  kind: ProjectRegistrationKind,
  answers: QuestionnaireResponses,
): { s4LayoutUploadUrls: string[]; s2LntPlan?: string | null } {
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  if (kind === "mutant_vehicle") {
    return { s4LayoutUploadUrls: strings(answers.photos) };
  }
  const strike = answers.strike_plan;
  return {
    s4LayoutUploadUrls: strings(answers.images),
    s2LntPlan:
      typeof strike === "string" && strike.trim() !== "" ? strike : null,
  };
}

/**
 * The gate-required answers that never carry, per kind. A carried draft lacks
 * every one of these, so the kind's submit gate refuses it — which is what
 * "carried sections never auto-complete" means for a form with no sections.
 */
const GATE_REQUIRED_NON_CARRIED: Record<
  ProjectRegistrationKind,
  readonly string[]
> = {
  artwork: ["burn_intent", "width_m", "depth_m", "height_m"],
  mutant_vehicle: [
    "soop_level",
    "flame_effects",
    "night_driving",
    "acknowledgements",
  ],
};

/** True when a payload built only by carrying forward still lacks at least one
 * answer the kind's submit gate requires. Always true for a pure carry. */
export function carriedDraftIsIncomplete(
  kind: ProjectRegistrationKind,
  answers: QuestionnaireResponses,
): boolean {
  return GATE_REQUIRED_NON_CARRIED[kind].some((key) =>
    isUnansweredValue(answers[key]),
  );
}

// ── Safety documents (CREATIVE-017) ──────────────────────────────────────
//
// Evidence a project attaches to its registration, each with an expiry date.
// PRIVATE: the project's structural lead/admin and org staff (personal-
// information readers in the registrations domain). Never public, never in a
// list, card, roster or export.

/** How many a single registration may hold. Enough for structural, fire,
 * electrical, roadworthy, insurance and one spare — not a document store. */
export const MAX_SAFETY_DOCUMENTS = 6;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in `YYYY-MM-DD` (rejects 2027-02-30). */
export function isIsoCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * The boundary schema for one safety document. The URL must be https: it is
 * rendered as a link on the review page, and `z.string().url()` alone accepts
 * `javascript:` — a stored link that runs script in a reviewer's session.
 */
export const SafetyDocumentInput = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Name the document — e.g. “Structural engineer sign-off”.")
    .max(120),
  url: z
    .string()
    .trim()
    .max(2048)
    .url("That link isn't a valid URL.")
    .refine((v) => {
      try {
        return new URL(v).protocol === "https:";
      } catch {
        return false;
      }
    }, "Safety documents must be an https link or an upload."),
  expiresOn: z
    .string()
    .refine(isIsoCalendarDate, "Give the document's expiry date."),
});
export type SafetyDocumentInput = z.infer<typeof SafetyDocumentInput>;

export const SafetyDocumentList = z
  .array(SafetyDocumentInput)
  .max(
    MAX_SAFETY_DOCUMENTS,
    `Attach at most ${MAX_SAFETY_DOCUMENTS} safety documents.`,
  )
  .default([]);

export type SafetyDocumentValidity =
  "valid" | "expires_during_event" | "expired";

/** One vocabulary for the lead's form and the reviewer's page. */
export const SAFETY_DOCUMENT_VALIDITY_LABELS: Record<
  SafetyDocumentValidity,
  string
> = {
  valid: "Covers the event",
  expires_during_event: "Lapses before the event ends",
  expired: "Expired",
};

/**
 * Does this document cover the burn? `valid` only when it is still in force on
 * the edition's LAST day — a certificate that lapses on day three of the event
 * does not cover a structure standing on day five. `expired` when it has
 * already lapsed as of `today`.
 *
 * ISO `YYYY-MM-DD` strings compare correctly as strings, which keeps this free
 * of timezone arithmetic.
 */
export function safetyDocumentValidity(
  expiresOn: string,
  edition: { endDate: string },
  today: string,
): SafetyDocumentValidity {
  if (expiresOn < today) return "expired";
  if (expiresOn < edition.endDate) return "expires_during_event";
  return "valid";
}

/** The documents worth copying into a new edition's draft: those valid through
 * that edition's end. Anything that lapses before then must be re-uploaded. */
export function carriedSafetyDocuments<T extends { expiresOn: string }>(
  docs: readonly T[],
  edition: { endDate: string },
): T[] {
  return docs.filter((d) => d.expiresOn >= edition.endDate);
}

/**
 * Who may see and change a project's safety documents on the participant side:
 * its STRUCTURAL lead/admin only. Not a custom-role grant, not a member —
 * certificates can carry an engineer's or owner's details, and nothing about
 * a member role needs them.
 */
export function canManageProjectSafetyDocuments(
  role: MembershipRole | null | undefined,
): boolean {
  return role != null && PROJECT_ADMIN_ROLES.includes(role);
}

// ── Project-scoped questionnaires (CREATIVE-007) ─────────────────────────

/** The base path a group's own pages live under, by kind. Camps keep
 * `/camps/<slug>`; creative projects get their own kind-named routes. */
export function projectQuestionnairesPath(kind: string, slug: string): string {
  const projectKind = asProjectRegistrationKind(kind);
  const base =
    projectKind === "artwork"
      ? "/artworks"
      : projectKind === "mutant_vehicle"
        ? "/vehicles"
        : "/camps";
  return `${base}/${slug}/questionnaires`;
}
