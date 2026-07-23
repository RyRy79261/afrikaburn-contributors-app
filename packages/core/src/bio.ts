// Burner Bio as a CODE questionnaire (build-spec §apps/web `/onboarding`). The
// bio is a bespoke `burner_bios` row, but it is authored + rendered through the
// questionnaire engine: this module owns the definition, the field↔column
// mapping, and the per-field privacy metadata. It is PURE (no DB, no crypto,
// no I/O) — apps/web layers persistence, pgcrypto, and keypair generation on
// top. The encrypted ID columns are produced here only as plaintext
// (`idType`/`idNumber`); apps/web encrypts before storage.

import type { Questionnaire, QuestionnaireResponses } from "@quagga/types";
import { HARD_LOCKED_PRIVATE_FIELDS } from "./privacy";

/** Bump when the questionnaire SHAPE changes (a question added/removed or a
 * required flag flipped). Stored on `burner_bios.version`. */
export const BURNER_BIO_VERSION = "2027.1";

/** Plaintext, column-shaped view of a bio — what the mapping produces/consumes.
 * Mirrors the toggleable + locked columns on `burner_bios`; the ID document is
 * carried as plaintext here and encrypted by apps/web at the write boundary. */
export interface BurnerBioFields {
  displayName: string | null;
  legalName: string | null;
  homeCity: string | null;
  bio: string | null;
  skills: string[];
  previousAfrikaburns: number;
  firstTime: boolean;
  contactEmail: string | null;
  phone: string | null;
  emergencyContact: {
    name: string;
    phone: string;
    relationship: string;
  } | null;
  medicalNotes: string | null;
  idType: "passport" | "sa_id" | null;
  idNumber: string | null;
}

/** A single privacy-flaggable bio field surfaced in the onboarding + profile
 * toggle UI. `locked` fields render as a locked row and can never be public. */
export interface BioPrivacyField {
  /** Key as it appears in `burner_bios.privacy_flags`. */
  key: string;
  label: string;
  /** True ⇒ always-private, toggle is disabled (build-spec hard-lock). */
  locked: boolean;
  /** The out-of-the-box public/private stance for a non-locked field. */
  defaultPublic: boolean;
  /** One-line reason shown on a locked row. */
  lockReason?: string;
}

const HARD_LOCKED = new Set<string>(HARD_LOCKED_PRIVATE_FIELDS);

/** The ordered privacy registry. Toggleable fields first, then the locked
 * always-private classes. The `locked` flags are derived from
 * HARD_LOCKED_PRIVATE_FIELDS so the two can never drift. */
export const BIO_PRIVACY_FIELDS: readonly BioPrivacyField[] = [
  { key: "displayName", label: "Display name", locked: false, defaultPublic: true },
  { key: "legalName", label: "Legal name", locked: false, defaultPublic: false },
  { key: "homeCity", label: "Home city", locked: false, defaultPublic: true },
  { key: "bio", label: "About you", locked: false, defaultPublic: true },
  { key: "skills", label: "Skills", locked: false, defaultPublic: true },
  {
    key: "previousAfrikaburns",
    label: "Burn history",
    locked: false,
    defaultPublic: true,
  },
  { key: "firstTime", label: "First-timer status", locked: false, defaultPublic: true },
  { key: "contactEmail", label: "Contact email", locked: false, defaultPublic: false },
  {
    key: "phone",
    label: "Phone number",
    locked: true,
    defaultPublic: false,
    lockReason: "Always private — never shown in the directory or to other camps.",
  },
  {
    key: "emergencyContact",
    label: "Emergency contact",
    locked: true,
    defaultPublic: false,
    lockReason: "Always private — held for safety teams only.",
  },
  {
    key: "medical",
    label: "Medical notes",
    locked: true,
    defaultPublic: false,
    lockReason: "Always private — held for medics only.",
  },
  {
    key: "saId",
    label: "SA ID number",
    locked: true,
    defaultPublic: false,
    lockReason: "Always private + encrypted at rest (POPIA).",
  },
  {
    key: "passport",
    label: "Passport number",
    locked: true,
    defaultPublic: false,
    lockReason: "Always private + encrypted at rest (POPIA).",
  },
].map((f) => ({ ...f, locked: HARD_LOCKED.has(f.key) || f.locked }));

/** The default privacy-flags map for a brand-new bio — non-locked fields take
 * their `defaultPublic`, locked fields are forced private. */
export function defaultPrivacyFlags(): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const field of BIO_PRIVACY_FIELDS) {
    flags[field.key] = field.locked ? false : field.defaultPublic;
  }
  return flags;
}

// --- Previous-burn buckets ----------------------------------------------
// The integer column is captured via a single_select; values are the stored
// integer as a string so the mapping round-trips losslessly.
const PREVIOUS_BURN_OPTIONS = [
  { value: "0", label: "None — this is my first" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "5", label: "5" },
  { value: "6", label: "6 or more" },
] as const;

const SKILL_OPTIONS = [
  { value: "build", label: "Build / carpentry" },
  { value: "electrical", label: "Electrical / power" },
  { value: "sound", label: "Sound / AV" },
  { value: "lighting", label: "Lighting" },
  { value: "kitchen", label: "Kitchen / catering" },
  { value: "medical", label: "Medical / first aid" },
  { value: "safety", label: "Safety / fire" },
  { value: "art", label: "Art / fabrication" },
  { value: "admin", label: "Admin / coordination" },
  { value: "welding", label: "Welding / metalwork" },
] as const;

/** Build the Burner Bio questionnaire definition. Pure — identical on client,
 * server, and in tests. Uses only the eight question kinds @quagga/types
 * defines. */
export function buildBurnerBioQuestionnaire(): Questionnaire {
  return {
    version: BURNER_BIO_VERSION,
    pages: [
      {
        id: "intro",
        kind: "intro",
        heading: "Your Burner Bio",
        body: "A short, self-serve profile you carry year to year. Fill it once — every field you set means one less form later. Sensitive details (phone, medical, ID) stay locked private, always.",
      },
      {
        id: "identity",
        kind: "questions",
        title: "Who you are",
        subtitle: "How you show up in the directory and to camps you join.",
        questions: [
          {
            id: "displayName",
            kind: "short_text",
            prompt: "Display name",
            helper: "The name other burners see. A playa name is fine.",
            maxLength: 80,
            required: true,
          },
          {
            id: "legalName",
            kind: "short_text",
            prompt: "Legal name",
            helper: "Optional — used only where AfrikaBurn needs it for logistics.",
            maxLength: 120,
            required: false,
          },
          {
            id: "homeCity",
            kind: "short_text",
            prompt: "Home city",
            helper: "Where you're travelling to the Tankwa from.",
            maxLength: 80,
            required: false,
          },
        ],
      },
      {
        id: "about",
        kind: "questions",
        title: "A bit about you",
        subtitle: "Free-form — this is what a camp lead reads first.",
        questions: [
          {
            id: "bio",
            kind: "long_text",
            prompt: "Tell us about yourself",
            helper: "Who you are in the dust, what you love bringing to a burn.",
            maxLength: 1500,
            required: false,
          },
          {
            id: "skills",
            kind: "multi_select",
            prompt: "Skills you can bring",
            helper: "Helps camps find the hands they need. Pick any that fit.",
            options: [...SKILL_OPTIONS],
            required: false,
          },
        ],
      },
      {
        id: "history",
        kind: "questions",
        title: "Burn history",
        subtitle: "So camps know who the veterans are and who's arriving fresh.",
        questions: [
          {
            id: "firstTime",
            kind: "boolean",
            prompt: "Is this your first AfrikaBurn?",
            required: false,
          },
          {
            id: "previousAfrikaburns",
            kind: "single_select",
            prompt: "How many AfrikaBurns have you attended?",
            options: [...PREVIOUS_BURN_OPTIONS],
            required: true,
          },
        ],
      },
      {
        id: "contact",
        kind: "questions",
        title: "Contact",
        subtitle: "Your phone stays locked private — used only for safety and logistics.",
        questions: [
          {
            id: "contactEmail",
            kind: "email",
            prompt: "Contact email",
            helper: "Optional — where camps reach you. Defaults to your sign-in email.",
            required: false,
          },
          {
            id: "phone",
            kind: "phone",
            prompt: "Phone number",
            helper: "Include the country code, e.g. +27 82 555 1234.",
            required: false,
          },
        ],
      },
      {
        id: "emergency",
        kind: "questions",
        title: "Emergency contact",
        subtitle: "Always private — held for safety teams only, never shown to camps.",
        questions: [
          {
            id: "emergency.name",
            kind: "short_text",
            prompt: "Emergency contact name",
            maxLength: 120,
            required: false,
          },
          {
            id: "emergency.phone",
            kind: "phone",
            prompt: "Emergency contact phone",
            required: false,
          },
          {
            id: "emergency.relationship",
            kind: "short_text",
            prompt: "Relationship to you",
            helper: "e.g. partner, sibling, friend.",
            maxLength: 60,
            required: false,
          },
          {
            id: "medicalNotes",
            kind: "long_text",
            prompt: "Medical notes",
            helper: "Allergies, conditions, medication a medic should know. Always private.",
            maxLength: 1000,
            required: false,
          },
        ],
      },
      {
        id: "identity_documents",
        kind: "questions",
        title: "Identity document",
        subtitle: "Always private + encrypted at rest. Used only for ticket and access allocation.",
        questions: [
          {
            id: "id.type",
            kind: "single_select",
            prompt: "Document type",
            options: [
              { value: "passport", label: "Passport" },
              { value: "sa_id", label: "South African ID" },
            ],
            required: false,
          },
          {
            id: "id.number",
            kind: "short_text",
            prompt: "Document number",
            helper: "SA ID: 13 digits. Passport: as printed. Stored encrypted.",
            maxLength: 40,
            required: false,
          },
        ],
      },
    ],
  };
}

// --- Mapping: responses ⇄ bio columns -----------------------------------

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Convert a questionnaire response map into column-shaped bio fields. */
export function mapResponsesToBio(
  responses: QuestionnaireResponses,
): BurnerBioFields {
  const skillsRaw = responses["skills"];
  const skills = Array.isArray(skillsRaw)
    ? skillsRaw.filter((s): s is string => typeof s === "string")
    : [];

  const prevRaw = responses["previousAfrikaburns"];
  const previousAfrikaburns =
    typeof prevRaw === "string" && /^\d+$/.test(prevRaw)
      ? Number.parseInt(prevRaw, 10)
      : 0;

  const emName = asString(responses["emergency.name"]);
  const emPhone = asString(responses["emergency.phone"]);
  const emRel = asString(responses["emergency.relationship"]);
  const emergencyContact =
    emName || emPhone || emRel
      ? {
          name: emName ?? "",
          phone: emPhone ?? "",
          relationship: emRel ?? "",
        }
      : null;

  const idTypeRaw = responses["id.type"];
  const idType =
    idTypeRaw === "passport" || idTypeRaw === "sa_id" ? idTypeRaw : null;

  return {
    displayName: asString(responses["displayName"]),
    legalName: asString(responses["legalName"]),
    homeCity: asString(responses["homeCity"]),
    bio: asString(responses["bio"]),
    skills,
    previousAfrikaburns,
    firstTime: responses["firstTime"] === true,
    contactEmail: asString(responses["contactEmail"]),
    phone: asString(responses["phone"]),
    emergencyContact,
    medicalNotes: asString(responses["medicalNotes"]),
    idType,
    idNumber: asString(responses["id.number"]),
  };
}

/** Convert column-shaped bio fields back into a response map (for pre-fill on
 * replay / profile edit). The ID number is passed in decrypted by the caller. */
export function mapBioToResponses(
  fields: Partial<BurnerBioFields>,
): QuestionnaireResponses {
  const r: QuestionnaireResponses = {};
  if (fields.displayName) r["displayName"] = fields.displayName;
  if (fields.legalName) r["legalName"] = fields.legalName;
  if (fields.homeCity) r["homeCity"] = fields.homeCity;
  if (fields.bio) r["bio"] = fields.bio;
  if (fields.skills && fields.skills.length > 0) r["skills"] = fields.skills;
  if (typeof fields.previousAfrikaburns === "number")
    r["previousAfrikaburns"] = String(Math.min(fields.previousAfrikaburns, 6));
  if (typeof fields.firstTime === "boolean") r["firstTime"] = fields.firstTime;
  if (fields.contactEmail) r["contactEmail"] = fields.contactEmail;
  if (fields.phone) r["phone"] = fields.phone;
  if (fields.emergencyContact) {
    r["emergency.name"] = fields.emergencyContact.name;
    r["emergency.phone"] = fields.emergencyContact.phone;
    r["emergency.relationship"] = fields.emergencyContact.relationship;
  }
  if (fields.medicalNotes) r["medicalNotes"] = fields.medicalNotes;
  if (fields.idType) r["id.type"] = fields.idType;
  if (fields.idNumber) r["id.number"] = fields.idNumber;
  return r;
}

/** The bio is complete once a display name is captured — the one required
 * identity anchor. Gates the rest of the app via `required_actions`. */
export function isBioComplete(fields: Pick<BurnerBioFields, "displayName">): boolean {
  return Boolean(fields.displayName && fields.displayName.trim() !== "");
}
