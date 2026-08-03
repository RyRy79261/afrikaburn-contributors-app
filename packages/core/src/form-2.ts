import type { QuestionnaireResponses } from "@quagga/types";

// FORM 2 → THE REGISTRATION ROW (roadmap M4-20).
//
// AfrikaBurn asks size, placement, sound and the layout diagram in January, five
// months after Form 1. We ship that as an org questionnaire so AfrikaBurn can
// author and release it without a deploy — and then MIRROR its answers into the
// same `registrations` columns the wizard has always written.
//
// ## Why mirror at all, rather than leave the answers in jsonb
//
// Because a dozen things downstream already read those columns, and they are the
// things that matter operationally:
//
//   · `getOfficerStatus` derives a camp's REQUIRED OFFICERS from the sound
//     answer. Leave sound in jsonb and a camp with a sound system silently owes
//     no sound officer.
//   · the org review screen's Size and Sound panels, the camp's own summary, and
//     placement all read the typed columns.
//
// Answering in January must not mean answering somewhere the rest of the product
// cannot see. One source of truth, two ways in.
//
// ## The mapping is DATA, and it is checked
//
// The org can edit this questionnaire in the console — that is the point of it
// being a questionnaire. Which means somebody can rename a question id, and the
// mirror would quietly stop filling a column while the form still looked fine
// and the response still saved. So `mapForm2Answers` reports what it could NOT
// place as well as what it could, and the caller surfaces it rather than
// shrugging. A mapping that fails silently is worse than no mapping: the camp
// believes it has declared its sound level and the console believes it has not.

/**
 * The seeded Form-2 template's key. One constant, because the org action that
 * sends it, the submit path that mirrors it and the tests that pin the two
 * together must all mean the same questionnaire.
 */
export const FORM_2_QUESTIONNAIRE_KEY = "org-theme-camp-form-2-2027";

/**
 * The registration columns Form 2 fills.
 *
 * NON-NULLABLE on purpose, even though every one of these columns is nullable in
 * the database. A mapping result only ever carries values it actually mapped —
 * `mapForm2Answers` returns a `Partial` and reports what it could not place
 * separately — so "present but null" is not a state this type should be able to
 * express. Allowing it would let a blank answer overwrite a real earlier one.
 */
export interface Form2Columns {
  s4ExpectedPopulation: number;
  s4FirstArrivalDate: string;
  s4AreaDimensions: string;
  s4LayoutUploadUrls: string[];
  s5AmplifiedMusic: string;
  s5SoundPlan: string;
  s5PlacementFirstChoice: string;
  s5FamilyFriendly: string;
}

/** How each column is filled, so coercion is declared once rather than inline. */
type ColumnKind = "number" | "text" | "urls";

/**
 * THE CONTRACT between the Form-2 questionnaire and the registration row.
 *
 * The question ids on the left are the ones the seeded `org-theme-camp-form-2-*`
 * definition uses. They are part of the contract, not incidental names — an org
 * editing the form keeps them or the mirror reports the column as unfilled.
 */
export const FORM_2_FIELD_MAP: Readonly<
  Record<string, { column: keyof Form2Columns; kind: ColumnKind }>
> = {
  expected_population: { column: "s4ExpectedPopulation", kind: "number" },
  first_arrival_date: { column: "s4FirstArrivalDate", kind: "text" },
  area_dimensions: { column: "s4AreaDimensions", kind: "text" },
  layout_diagram: { column: "s4LayoutUploadUrls", kind: "urls" },
  amplified_music: { column: "s5AmplifiedMusic", kind: "text" },
  sound_plan: { column: "s5SoundPlan", kind: "text" },
  placement_first_choice: { column: "s5PlacementFirstChoice", kind: "text" },
  family_friendly: { column: "s5FamilyFriendly", kind: "text" },
};

/** Every column Form 2 is responsible for, derived so the two cannot drift. */
export const FORM_2_COLUMNS: readonly (keyof Form2Columns)[] = Object.values(
  FORM_2_FIELD_MAP,
).map((f) => f.column);

export interface Form2MappingResult {
  /** The columns to write. Only keys actually answered are present. */
  columns: Partial<Form2Columns>;
  /**
   * Question ids in the response that this mapping does not know about —
   * usually a question the org ADDED, which is fine and expected. Reported so
   * the console can say "this answer is kept in the questionnaire only".
   */
  unmapped: string[];
  /**
   * Columns Form 2 owns that came back with nothing usable — either the question
   * was removed/renamed, or it was left blank. THE ONE TO SURFACE: it is the
   * difference between "the camp did not say" and "we lost what they said".
   */
  unfilled: (keyof Form2Columns)[];
}

/** A trimmed non-empty string, or null. */
function text(value: unknown): string | null {
  if (typeof value === "string") {
    const t = value.trim();
    return t.length > 0 ? t : null;
  }
  // A single-select question can come back as a one-element array.
  if (Array.isArray(value) && value.length === 1) return text(value[0]);
  return null;
}

/** A positive integer population, or null. Strings are accepted because a
 * number question that was authored as short_text still means a number. */
function count(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return null;
  const rounded = Math.trunc(n);
  return rounded > 0 ? rounded : null;
}

/** The layout diagram(s). Capped at four, matching the wizard's own limit. */
function urls(value: unknown): string[] | null {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const cleaned = raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .slice(0, 4);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Map a submitted Form-2 response onto the registration columns.
 *
 * Pure: no database, no clock. The caller writes `columns` onto the row and
 * decides what to do about `unfilled`.
 */
export function mapForm2Answers(
  responses: QuestionnaireResponses,
): Form2MappingResult {
  const columns: Partial<Form2Columns> = {};
  const unmapped: string[] = [];

  for (const [questionId, value] of Object.entries(responses)) {
    const field = FORM_2_FIELD_MAP[questionId];
    if (!field) {
      unmapped.push(questionId);
      continue;
    }
    switch (field.kind) {
      case "number": {
        const n = count(value);
        if (n !== null) columns.s4ExpectedPopulation = n;
        break;
      }
      case "urls": {
        const u = urls(value);
        if (u !== null) columns.s4LayoutUploadUrls = u;
        break;
      }
      case "text": {
        const t = text(value);
        if (t !== null) {
          // Narrowed to the text-valued columns by the map itself; the cast is
          // confined to this one line rather than spread across eight branches.
          (columns as Record<string, unknown>)[field.column] = t;
        }
        break;
      }
    }
  }

  const unfilled = FORM_2_COLUMNS.filter(
    (column) => columns[column] === undefined,
  );

  return { columns, unmapped: unmapped.sort(), unfilled };
}
