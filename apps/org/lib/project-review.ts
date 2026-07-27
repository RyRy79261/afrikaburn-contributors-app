// Pure, framework-agnostic presentation logic for the mutant-vehicle / artwork
// registration review (the console's non-camp review layout). No I/O, no React,
// no server-only — unit-tested in __tests__/project-review.test.ts.
//
// The camp review renders six fixed sections (@quagga/types SECTION_LABELS). MV
// and art submissions have DIFFERENT questions, so this module produces a
// kind-appropriate section list instead — but every section still keys off one
// of the six `section_key` enum values so the existing per-section review-thread
// storage works unchanged (no migration). Each kind uses DISTINCT keys, and a
// registration is only ever one kind, so threads never collide.

import type { QuestionnaireResponses, SectionKey } from "@quagga/types";

import type { ProjectRegistrationKind } from "./project-registration";
import {
  classifySoundLevel,
  deriveCohort,
  SOUND_LEVEL_LABELS,
  SOUND_LEVEL_SHORT,
  type Cohort,
} from "./org-logic";
import { formatDate } from "./labels";

// --- Honest per-kind vocabulary ------------------------------------------

/** The subject noun each kind is referred to by in decision + audit copy. */
export const PROJECT_SUBJECT_NOUN: Record<string, string> = {
  theme_camp: "camp",
  mutant_vehicle: "mutant vehicle",
  artwork: "artwork",
};

/** Officers-card copy per kind (camps say "camp"; projects say "project"). */
export interface OfficersCopy {
  title: string;
  description: string;
  empty: string;
}

export function officersCopy(kind: string): OfficersCopy {
  if (kind === "mutant_vehicle") {
    return {
      title: "Vehicle crew officers",
      description:
        "Responsible people this crew has registered with AfrikaBurn. Contact details appear only for officers who accepted the role.",
      empty: "No officers have accepted a role for this vehicle yet.",
    };
  }
  if (kind === "artwork") {
    return {
      title: "Project officers",
      description:
        "Responsible people this project has registered with AfrikaBurn. Contact details appear only for officers who accepted the role.",
      empty: "No officers have accepted a role for this project yet.",
    };
  }
  return {
    title: "Camp officers",
    description:
      "Responsible people this camp has registered with AfrikaBurn. Contact details appear only for officers who accepted the role.",
    empty: "No officers have accepted a role for this camp yet.",
  };
}

/** The three DMV acknowledgements, short labels (full text lives on the web
 * form / DMV corpus; the console only needs a glanceable summary). */
export const VEHICLE_ACK_LABELS: readonly { key: string; label: string }[] = [
  {
    key: "speed_limit",
    label: "10 km/h speed limit & pedestrian right of way",
  },
  {
    key: "testing_station",
    label: "On-site licensing at the DMV Testing Station",
  },
  { key: "driver_indemnity", label: "Every driver signs the DMV indemnity" },
];

/** Power-source labels (mirrors the web form's two options). */
export const ARTWORK_POWER_LABELS: Record<string, string> = {
  solar_battery: "Solar / battery (preferred)",
  generator: "Insulated generator",
};

// --- Typed answer extraction ---------------------------------------------
// Answers are a flat `QuestionnaireResponses` record (union values). These
// coerce each expected key to the concrete type, treating anything else as
// absent — so a malformed jsonb payload degrades to "Not provided", never
// throws or mislabels.

export function answerString(
  answers: QuestionnaireResponses | null,
  key: string,
): string | null {
  const v = answers?.[key];
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

export function answerBool(
  answers: QuestionnaireResponses | null,
  key: string,
): boolean | null {
  const v = answers?.[key];
  return typeof v === "boolean" ? v : null;
}

export function answerStringArray(
  answers: QuestionnaireResponses | null,
  key: string,
): string[] {
  const v = answers?.[key];
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

// --- Section model -------------------------------------------------------
// Structured (not JSX) so it stays pure + testable; the page renders each
// field type to a `FieldSpec`.

export type ProjectFieldValue =
  | { type: "text"; value: string | null }
  | { type: "yesno"; value: boolean | null }
  | { type: "uploads"; urls: string[]; noun: string }
  | { type: "acks"; ackedKeys: string[] }
  | { type: "power"; keys: string[] };

export interface ProjectField {
  label: string;
  value: ProjectFieldValue;
  wide?: boolean;
}

export interface ProjectSection {
  /** One of the six section_key enum values — drives review-thread storage. */
  key: SectionKey;
  label: string;
  fields: ProjectField[];
}

/** The `registrations` columns whose meaning survives for a vehicle/artwork. */
export interface ProjectRegistrationView {
  contactEmail: string | null;
  areaDimensions: string | null;
  imageUrls: string[];
  soundRaw: string | null;
  placementNotes: string | null;
  lntPlan: string | null;
  grantsInterest: boolean | null;
}

function vehicleSections(
  groupName: string,
  view: ProjectRegistrationView,
  answers: QuestionnaireResponses | null,
): ProjectSection[] {
  const soundLevel = classifySoundLevel(view.soundRaw);
  return [
    {
      key: "identity",
      label: "Vehicle & mutation",
      fields: [
        { label: "Vehicle name", value: { type: "text", value: groupName } },
        {
          label: "Donor (base) vehicle",
          value: { type: "text", value: answerString(answers, "base_vehicle") },
        },
        {
          label: "Mutation",
          value: {
            type: "text",
            value: answerString(answers, "mutation_description"),
          },
          wide: true,
        },
        {
          label: "Contact email",
          value: { type: "text", value: view.contactEmail },
        },
      ],
    },
    {
      key: "size_logistics",
      label: "Photos",
      fields: [
        {
          label: "Vehicle photos",
          value: { type: "uploads", urls: view.imageUrls, noun: "Photo" },
          wide: true,
        },
      ],
    },
    {
      key: "sound_placement",
      label: "Sound (SOOP)",
      fields: [
        {
          label: "Amplified sound level",
          value: {
            type: "text",
            value: view.soundRaw ? SOUND_LEVEL_LABELS[soundLevel] : null,
          },
        },
      ],
    },
    {
      key: "participation",
      label: "On-site operations",
      fields: [
        {
          label: "Carries flame effects?",
          value: { type: "yesno", value: answerBool(answers, "flame_effects") },
        },
        {
          label: "Plans to drive at night?",
          value: { type: "yesno", value: answerBool(answers, "night_driving") },
        },
      ],
    },
    {
      key: "lnt",
      label: "DMV acknowledgements",
      fields: [
        {
          label: "On-site licensing acknowledgements",
          value: {
            type: "acks",
            ackedKeys: answerStringArray(answers, "acknowledgements"),
          },
          wide: true,
        },
      ],
    },
  ];
}

function artworkSections(
  groupName: string,
  view: ProjectRegistrationView,
  answers: QuestionnaireResponses | null,
): ProjectSection[] {
  return [
    {
      key: "identity",
      label: "Artwork identity",
      fields: [
        { label: "Artwork name", value: { type: "text", value: groupName } },
        {
          label: "Artist / collective",
          value: {
            type: "text",
            value: answerString(answers, "artist_or_collective"),
          },
        },
        {
          label: "Description",
          value: { type: "text", value: answerString(answers, "description") },
          wide: true,
        },
        {
          label: "Contact email",
          value: { type: "text", value: view.contactEmail },
        },
      ],
    },
    {
      key: "size_logistics",
      label: "Physical footprint",
      fields: [
        {
          label: "Footprint (W × D × H)",
          value: { type: "text", value: view.areaDimensions },
        },
        {
          label: "Concept images",
          value: { type: "uploads", urls: view.imageUrls, noun: "Image" },
          wide: true,
        },
      ],
    },
    {
      key: "participation",
      label: "Burning & power",
      fields: [
        {
          label: "Intended to burn?",
          value: { type: "yesno", value: answerBool(answers, "burn_intent") },
        },
        {
          label: "Power",
          value: {
            type: "power",
            keys: answerStringArray(answers, "power_needs"),
          },
        },
      ],
    },
    {
      key: "sound_placement",
      label: "Placement",
      fields: [
        {
          label: "Placement notes",
          value: { type: "text", value: view.placementNotes },
          wide: true,
        },
      ],
    },
    {
      key: "lnt",
      label: "Strike & Leave No Trace",
      fields: [
        {
          label: "Strike & LNT plan",
          value: { type: "text", value: view.lntPlan },
          wide: true,
        },
      ],
    },
    {
      key: "suppliers_commerce",
      label: "Build & grant",
      fields: [
        {
          label: "Build plan",
          value: { type: "text", value: answerString(answers, "build_plan") },
          wide: true,
        },
        {
          label: "Interested in an art grant?",
          value: { type: "yesno", value: view.grantsInterest },
        },
      ],
    },
  ];
}

/** Build the kind-appropriate review sections for a project registration. */
export function buildProjectSections(
  kind: ProjectRegistrationKind,
  groupName: string,
  view: ProjectRegistrationView,
  answers: QuestionnaireResponses | null,
): ProjectSection[] {
  return kind === "mutant_vehicle"
    ? vehicleSections(groupName, view, answers)
    : artworkSections(groupName, view, answers);
}

// --- Header meta ---------------------------------------------------------

/** Kind label used in the header meta cohort chip ("New mutant vehicle"). */
const KIND_META_NOUN: Record<ProjectRegistrationKind, string> = {
  mutant_vehicle: "mutant vehicle",
  artwork: "artwork",
};

/**
 * The header meta line for a project review — honest per kind (never
 * "campers"). Vehicles show submitted · SOOP level · cohort; artworks show
 * submitted · footprint · burn intent · cohort.
 */
export function buildProjectMeta(
  kind: ProjectRegistrationKind,
  input: {
    submittedAt: Date | null;
    cohort: Cohort;
    view: ProjectRegistrationView;
    answers: QuestionnaireResponses | null;
  },
): string[] {
  const cohortLabel = `${input.cohort === "returning" ? "Returning" : "New"} ${KIND_META_NOUN[kind]}`;
  const submitted = input.submittedAt
    ? `Submitted ${formatDate(input.submittedAt)}`
    : "Not yet submitted";

  if (kind === "mutant_vehicle") {
    const short = SOUND_LEVEL_SHORT[classifySoundLevel(input.view.soundRaw)];
    return [
      submitted,
      short !== "—" ? `SOOP ${short}` : null,
      cohortLabel,
    ].filter((x): x is string => Boolean(x));
  }

  const burn = answerBool(input.answers, "burn_intent");
  return [
    submitted,
    input.view.areaDimensions,
    burn === null ? null : burn ? "Intends to burn" : "Non-burning",
    cohortLabel,
  ].filter((x): x is string => Boolean(x));
}

// Re-export so callers building meta can derive cohort from the same module.
export { deriveCohort };
