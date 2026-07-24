// Burner Bio as a CODE questionnaire (build-spec §apps/web `/onboarding`). The
// bio is a bespoke `burner_bios` row, but it is authored + rendered through the
// questionnaire engine: this module owns the definition, the field↔column
// mapping, and the per-field privacy metadata. It is PURE (no DB, no crypto,
// no I/O) — apps/web layers persistence, pgcrypto, and keypair generation on
// top. The encrypted ID columns are produced here only as plaintext
// (`idType`/`idNumber`); apps/web encrypts before storage.

import {
  isValidAttendedYear,
  isVolunteerPortfolioKey,
  type CampHistoryEntry,
  type Questionnaire,
  type QuestionnaireResponses,
} from "@quagga/types";
import {
  HARD_LOCKED_PRIVATE_FIELDS,
  canBePublic,
  enforcePrivacyFlags,
} from "./privacy";

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
  /** Specific AfrikaBurn years attended (valid range 2007–2026, never
   * 2020/2021). Empty ⇒ first-timer / none recorded. */
  attendedYears: number[];
  firstTime: boolean;
  contactEmail: string | null;
  phone: string | null;
  // Two emergency contacts (on-site + off-site), each split into name + phone.
  // All four are hard-locked always-private (see BIO_PRIVACY_FIELDS).
  onsiteContactName: string | null;
  onsiteContactPhone: string | null;
  offsiteContactName: string | null;
  offsiteContactPhone: string | null;
  medicalNotes: string | null;
  idType: "passport" | "sa_id" | null;
  idNumber: string | null;
}

/** The Burner Bio v3 "extras" (build-spec §"Burner Bio v3 additions"): self-
 * promotional data that lives in dedicated `burner_bios` columns but does NOT
 * flow through the questionnaire-response map (camp history is object-shaped and
 * cannot fit `QuestionnaireResponseValue`). Threaded alongside the responses on
 * save + load. None of these fields is ever hard-locked. */
export interface BioExtras {
  /** Free-text bio "for the burns" (soft ~150-word cap, counted in the UI). */
  about: string | null;
  campHistory: CampHistoryEntry[];
  /** Selected portfolio KEYS only (the free-text "other" lives separately). */
  volunteeringInterests: string[];
  volunteeringOther: string | null;
  rangerTraining: boolean;
  rangerCurious: boolean;
  greenDotTraining: boolean;
}

/** A fresh, empty extras record — the default for a bio with no v3 data yet. */
export function emptyBioExtras(): BioExtras {
  return {
    about: null,
    campHistory: [],
    volunteeringInterests: [],
    volunteeringOther: null,
    rangerTraining: false,
    rangerCurious: false,
    greenDotTraining: false,
  };
}

/** Soft word cap on the v3 `about` field — a UI counter hint, not a hard limit. */
export const ABOUT_SOFT_WORD_CAP = 150;

/**
 * Serialize the volunteering selection into the single jsonb string[] column:
 * the known portfolio keys, followed by the free-text "other" (if any). The
 * inverse is `parseVolunteering`.
 */
export function serializeVolunteering(
  interests: string[],
  other: string | null | undefined,
): string[] {
  const keys = interests.filter(isVolunteerPortfolioKey);
  const trimmed = other?.trim();
  return trimmed ? [...keys, trimmed] : keys;
}

/**
 * Split a stored volunteering string[] back into known portfolio keys and the
 * free-text "other" (any non-key strings, joined). Round-trips
 * `serializeVolunteering` for realistic data (free text never collides with an
 * internal snake_case key).
 */
export function parseVolunteering(raw: string[] | null | undefined): {
  interests: string[];
  other: string | null;
} {
  const arr = Array.isArray(raw) ? raw : [];
  const interests: string[] = [];
  const others: string[] = [];
  for (const v of arr) {
    if (typeof v !== "string") continue;
    if (isVolunteerPortfolioKey(v)) interests.push(v);
    else if (v.trim()) others.push(v.trim());
  }
  return { interests, other: others.length ? others.join(", ") : null };
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
    key: "attendedYears",
    label: "Years attended",
    locked: false,
    defaultPublic: true,
  },
  { key: "firstTime", label: "First-timer status", locked: false, defaultPublic: true },
  { key: "contactEmail", label: "Contact email", locked: false, defaultPublic: false },
  // v3 additions — all self-promotional, default public, never hard-locked.
  { key: "about", label: "Bio for the burns", locked: false, defaultPublic: true },
  { key: "campHistory", label: "Camp history", locked: false, defaultPublic: true },
  {
    key: "volunteeringInterests",
    label: "Volunteering interests",
    locked: false,
    defaultPublic: true,
  },
  { key: "ranger", label: "Ranger interests", locked: false, defaultPublic: true },
  {
    key: "phone",
    label: "Phone number",
    locked: true,
    defaultPublic: false,
    lockReason: "Always private — never shown in the directory or to other camps.",
  },
  {
    key: "onsiteContactName",
    label: "On-site emergency contact — name",
    locked: true,
    defaultPublic: false,
    lockReason: "Always private — held for safety teams only.",
  },
  {
    key: "onsiteContactPhone",
    label: "On-site emergency contact — phone",
    locked: true,
    defaultPublic: false,
    lockReason: "Always private — held for safety teams only.",
  },
  {
    key: "offsiteContactName",
    label: "Off-site emergency contact — name",
    locked: true,
    defaultPublic: false,
    lockReason: "Always private — held for safety teams only.",
  },
  {
    key: "offsiteContactPhone",
    label: "Off-site emergency contact — phone",
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

/**
 * The privacy-flags value for a brand-NEW bio row: defaults overlaid with any
 * caller-supplied flags, then hard-locked fields forced private. Use this only
 * for the INSERT path — an existing row's flags are owned by the privacy editor
 * (see `resolvePrivacyFlagsUpdate`).
 */
export function initialPrivacyFlags(
  rawPrivacyFlags?: Record<string, boolean>,
): Record<string, boolean> {
  return enforcePrivacyFlags({
    ...defaultPrivacyFlags(),
    ...(rawPrivacyFlags ?? {}),
  });
}

/**
 * The privacy-flags patch for an UPDATE to an existing bio. Privacy flags are
 * owned by the dedicated privacy editor — a plain bio-text save (which omits
 * `rawPrivacyFlags`) must NOT touch them, or a user's deliberate private→public
 * choices silently reset to defaults, re-exposing default-public fields they had
 * marked private. Returns an EMPTY patch to leave the stored flags untouched, or
 * the enforced flags when the caller explicitly supplies them. Spread the result
 * into the update `set`.
 */
export function resolvePrivacyFlagsUpdate(
  rawPrivacyFlags: Record<string, boolean> | undefined,
): { privacyFlags: Record<string, boolean> } | Record<string, never> {
  if (rawPrivacyFlags === undefined) return {};
  return { privacyFlags: initialPrivacyFlags(rawPrivacyFlags) };
}

/**
 * A member's PUBLIC-facing display name. Falls back to a neutral placeholder —
 * NEVER to the account email, which is POPIA-relevant PII that must not leak
 * onto public camp pages or the directory.
 */
export function publicMemberName(
  displayName: string | null | undefined,
): string {
  const trimmed = displayName?.trim();
  return trimmed ? trimmed : "Unnamed burner";
}

// --- Third-party (public) profile view ----------------------------------

/**
 * A third-party-safe projection of a bio. Only the fields the OWNER flagged
 * public are populated; every other field is null/empty. The hard-locked
 * always-private classes (phone, emergency contacts, medical, ID) are never
 * even eligible — they are not part of this shape AND `publicBioView` gates on
 * `canBePublic`, so a corrupted flag map claiming one is public can never
 * surface it.
 */
export interface PublicBioView {
  displayName: string | null;
  legalName: string | null;
  homeCity: string | null;
  bio: string | null;
  skills: string[];
  attendedYears: number[];
  firstTime: boolean | null;
  contactEmail: string | null;
  // v3 additions (build-spec §"Burner Bio v3 additions"). Camp history is passed
  // through raw here; whether a LINKED entry renders as a discoverable camp link
  // is resolved downstream against registration status (free camps stay hidden).
  about: string | null;
  campHistory: CampHistoryEntry[];
  volunteeringInterests: string[];
  volunteeringOther: string | null;
  rangerTraining: boolean;
  rangerCurious: boolean;
  greenDotTraining: boolean;
}

/**
 * Build the public, third-party-facing view of a bio. A field appears only when
 * BOTH its privacy flag is explicitly `true` AND it is allowed to be public at
 * all (`canBePublic`). The `canBePublic` guard is the last line of defence: even
 * if `privacyFlags` is corrupted to claim a hard-locked field public, this
 * function will not leak it. Pass the FULL bio so the caller cannot accidentally
 * bypass the lock by pre-selecting fields — the gate lives here.
 */
export function publicBioView(
  fields: BurnerBioFields,
  privacyFlags: Record<string, boolean>,
  extras: BioExtras = emptyBioExtras(),
): PublicBioView {
  const show = (key: string): boolean =>
    canBePublic(key) && privacyFlags[key] === true;

  // The three ranger flags share one privacy toggle ("ranger").
  const showRanger = show("ranger");

  return {
    displayName: show("displayName") ? fields.displayName : null,
    legalName: show("legalName") ? fields.legalName : null,
    homeCity: show("homeCity") ? fields.homeCity : null,
    bio: show("bio") ? fields.bio : null,
    skills: show("skills") ? fields.skills : [],
    attendedYears: show("attendedYears") ? fields.attendedYears : [],
    firstTime: show("firstTime") ? fields.firstTime : null,
    contactEmail: show("contactEmail") ? fields.contactEmail : null,
    about: show("about") ? extras.about : null,
    campHistory: show("campHistory") ? extras.campHistory : [],
    volunteeringInterests: show("volunteeringInterests")
      ? extras.volunteeringInterests
      : [],
    volunteeringOther: show("volunteeringInterests")
      ? extras.volunteeringOther
      : null,
    rangerTraining: showRanger ? extras.rangerTraining : false,
    rangerCurious: showRanger ? extras.rangerCurious : false,
    greenDotTraining: showRanger ? extras.greenDotTraining : false,
  };
}

/**
 * Up-to-two-letter initials for an avatar, derived from a display name. Falls
 * back to a neutral glyph so a nameless burner still renders.
 */
export function initialsFromName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0] ?? "";
  const last = parts[parts.length - 1] ?? "";
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  return (first.slice(0, 1) + last.slice(0, 1)).toUpperCase();
}

// --- Attended years -----------------------------------------------------

/** Coerce raw response data into a sorted, de-duplicated list of valid
 * AfrikaBurn years — silently drops anything out of range or in a no-burn
 * year (2020/2021). Accepts year strings or numbers. */
export function parseAttendedYears(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const years = new Set<number>();
  for (const v of raw) {
    const n =
      typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (isValidAttendedYear(n)) years.add(n);
  }
  return [...years].sort((a, b) => a - b);
}

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
            id: "attendedYears",
            kind: "years",
            prompt: "Which AfrikaBurns have you attended?",
            helper:
              "Tap every year you were on the playa. 2020 and 2021 had no burn.",
            required: false,
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
        title: "Emergency contacts",
        subtitle:
          "Always private — held for safety teams only, never shown to camps. Give us one person on-site and one off-site.",
        questions: [
          {
            id: "onsite.name",
            kind: "short_text",
            prompt: "On-site contact name",
            helper: "Someone at the burn we can reach if needed.",
            maxLength: 120,
            required: false,
          },
          {
            id: "onsite.phone",
            kind: "phone",
            prompt: "On-site contact phone",
            required: false,
          },
          {
            id: "offsite.name",
            kind: "short_text",
            prompt: "Off-site contact name",
            helper: "Someone not at the burn — next of kin or similar.",
            maxLength: 120,
            required: false,
          },
          {
            id: "offsite.phone",
            kind: "phone",
            prompt: "Off-site contact phone",
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

  const idTypeRaw = responses["id.type"];
  const idType =
    idTypeRaw === "passport" || idTypeRaw === "sa_id" ? idTypeRaw : null;

  return {
    displayName: asString(responses["displayName"]),
    legalName: asString(responses["legalName"]),
    homeCity: asString(responses["homeCity"]),
    bio: asString(responses["bio"]),
    skills,
    attendedYears: parseAttendedYears(responses["attendedYears"]),
    firstTime: responses["firstTime"] === true,
    contactEmail: asString(responses["contactEmail"]),
    phone: asString(responses["phone"]),
    onsiteContactName: asString(responses["onsite.name"]),
    onsiteContactPhone: asString(responses["onsite.phone"]),
    offsiteContactName: asString(responses["offsite.name"]),
    offsiteContactPhone: asString(responses["offsite.phone"]),
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
  if (fields.attendedYears && fields.attendedYears.length > 0)
    r["attendedYears"] = fields.attendedYears.map(String);
  if (typeof fields.firstTime === "boolean") r["firstTime"] = fields.firstTime;
  if (fields.contactEmail) r["contactEmail"] = fields.contactEmail;
  if (fields.phone) r["phone"] = fields.phone;
  if (fields.onsiteContactName) r["onsite.name"] = fields.onsiteContactName;
  if (fields.onsiteContactPhone) r["onsite.phone"] = fields.onsiteContactPhone;
  if (fields.offsiteContactName) r["offsite.name"] = fields.offsiteContactName;
  if (fields.offsiteContactPhone)
    r["offsite.phone"] = fields.offsiteContactPhone;
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
