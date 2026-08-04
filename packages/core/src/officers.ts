// Officer roles (questionnaire-spec §"Officer roles — org-defined, condition-
// triggered"). An org-defined catalog of responsible-person roles with STABLE
// keys (the org targeting anchor). Camps may not alias them; display name/emoji/
// color are fixed here. Their trigger conditions run over a camp's registration
// data to mark each officer `required` or `recommended`.
//
// Pure logic only — no I/O. Assignment/consent state and org-visibility are
// modelled here so the store can persist them and tests can prove the rules.

import type {
  OfficerKey,
  RoleAssignmentConsent,
  RoleColor,
} from "@quagga/types";
import { SOUND_SCALE_VALUES, isNoAmplifiedSound } from "./sound";

/** One catalog entry: the fixed org-facing identity of an officer role. */
export interface OfficerCatalogEntry {
  key: OfficerKey;
  /** Seeded display name (camps may NOT alias — org vocabulary stays uniform). */
  name: string;
  emoji: string;
  color: RoleColor;
}

/**
 * The officer catalog (questionnaire-spec table). Order = display order on the
 * settings page Officers section.
 */
export const OFFICER_CATALOG: readonly OfficerCatalogEntry[] = [
  { key: "lnt_officer", name: "LNT Lead", emoji: "♻️", color: "sage" },
  {
    key: "safety_officer",
    name: "Safety Officer",
    emoji: "⛑️",
    color: "apricot",
  },
  {
    key: "fire_safety_officer",
    name: "Safety Baron",
    emoji: "🔥",
    color: "rust",
  },
  { key: "sound_officer", name: "Sound Officer", emoji: "🔊", color: "teal" },
  {
    key: "safety_monitor",
    name: "Safety Monitor",
    emoji: "🛡️",
    color: "olive",
  },
];

const CATALOG_BY_KEY: ReadonlyMap<OfficerKey, OfficerCatalogEntry> = new Map(
  OFFICER_CATALOG.map((e) => [e.key, e]),
);

/** Catalog entry for a key, or undefined for an unknown key. */
export function officerCatalogEntry(
  key: OfficerKey,
): OfficerCatalogEntry | undefined {
  return CATALOG_BY_KEY.get(key);
}

/** Whether an officer is required or (merely) recommended for a camp. */
export type OfficerRequirement = "required" | "recommended";

/**
 * The registration signals that drive officer triggers. Kept explicit (rather
 * than reading raw registration columns) so the trigger matrix is unit-testable
 * and the wiring stays honest about what data actually exists.
 */
export interface OfficerTriggerInput {
  /** Amplified-sound level 0–4 (0 = none). Derive with `soundLevelFromValue`. */
  soundLevel: number;
  /** Declared generators / open-flame gifting / large fuel or gas storage. */
  hasGenerators: boolean;
  hasOpenFlame: boolean;
  hasFuelStorage: boolean;
}

/**
 * Parse a stored `s5_amplified_music` value into a 0–4 sound level. "No
 * amplified sound" (or empty) → 0; otherwise the first digit in the label, or
 * its index in the SOUND_SCALE as a fallback.
 */
export function soundLevelFromValue(value: string | null | undefined): number {
  if (isNoAmplifiedSound(value)) return 0;
  const text = value ?? "";
  const digit = text.match(/\d/);
  if (digit) return Number(digit[0]);
  const idx = SOUND_SCALE_VALUES.indexOf(text);
  return idx > 0 ? idx : 0;
}

/**
 * Evaluate the trigger condition for every catalog officer. Returns a full map
 * (all 5 keys). Requirement rules (questionnaire-spec table):
 *   - lnt_officer        → always REQUIRED (supersedes the contact-only LNT lead)
 *   - safety_officer     → always recommended
 *   - fire_safety_officer→ always REQUIRED for registered camps (Ryan, 24 Jul:
 *     a registered camp will have fire around sooner or later — generators,
 *     braais, gifting flames — so the officer is unconditional, not triggered)
 *   - sound_officer      → REQUIRED when sound level ≥ 2, else recommended
 *   - safety_monitor     → always recommended
 */
export function officerRequirements(
  input: OfficerTriggerInput,
): Map<OfficerKey, OfficerRequirement> {
  const soundRequired = input.soundLevel >= 2;
  return new Map<OfficerKey, OfficerRequirement>([
    ["lnt_officer", "required"],
    ["safety_officer", "recommended"],
    ["fire_safety_officer", "required"],
    ["sound_officer", soundRequired ? "required" : "recommended"],
    ["safety_monitor", "recommended"],
  ]);
}

/** Officer keys that are REQUIRED for the given trigger input. */
export function requiredOfficerKeys(input: OfficerTriggerInput): OfficerKey[] {
  return [...officerRequirements(input)]
    .filter(([, req]) => req === "required")
    .map(([key]) => key);
}

/** The outstanding-officers summary for the settings header + dashboard badge. */
export interface OutstandingOfficers {
  /** Required officer keys with no assignment yet. */
  outstanding: OfficerKey[];
  /** Total required officers for this camp. */
  requiredCount: number;
  /** Required officers that have at least one assignment (pending or accepted). */
  assignedCount: number;
  /** Whether requirements apply at all (false for free/unregistered camps). */
  applies: boolean;
}

/**
 * Count unassigned REQUIRED officers (questionnaire-spec §"Outstanding-officers
 * indicator"). Requirements apply ONLY to camps with an approved registration
 * OR one in flight — free camps get no badge and no requirement counts.
 *
 * A slot counts as "assigned" once ANY member is assigned to it (even a pending
 * acceptance) — "not yet assigned" is the outstanding state.
 */
export function outstandingOfficers(input: {
  isRegisteredOrInFlight: boolean;
  triggers: OfficerTriggerInput;
  /** Officer keys that currently have at least one assignment (any consent). */
  assignedKeys: Iterable<OfficerKey>;
}): OutstandingOfficers {
  if (!input.isRegisteredOrInFlight) {
    return {
      outstanding: [],
      requiredCount: 0,
      assignedCount: 0,
      applies: false,
    };
  }
  const required = requiredOfficerKeys(input.triggers);
  const assigned = new Set(input.assignedKeys);
  const outstanding = required.filter((k) => !assigned.has(k));
  return {
    outstanding,
    requiredCount: required.length,
    assignedCount: required.length - outstanding.length,
    applies: true,
  };
}

// --- Consent + org-visibility ---------------------------------------------

/**
 * Assigning an officer is an officer REGISTRATION with the org. Because phone is
 * otherwise hard-locked private, acceptance is a consent moment: the member must
 * ACCEPT (contact details shared with AfrikaBurn for the role) or DECLINE.
 * Assigning creates the `pending` state.
 */
export const OFFICER_CONSENT_INITIAL: RoleAssignmentConsent = "pending";

/** Copy shown to a member being asked to accept an officer role (POPIA). */
export function officerConsentCopy(officerName: string): string {
  return (
    `Accepting the ${officerName} role shares your contact details ` +
    `(name, email, and phone number) with AfrikaBurn for this function. ` +
    `You can decline, which leaves the role unassigned.`
  );
}

/**
 * The ONLY path that exposes an officer's phone/email/name to the org: an
 * ACCEPTED officer assignment. This is the single, explicit exception to the
 * bio phone hard-lock; every other path keeps phone private. Returns false for
 * pending/declined assignments and for any non-officer role.
 */
export function officerContactVisibleToOrg(assignment: {
  isOfficer: boolean;
  consent: RoleAssignmentConsent;
}): boolean {
  return assignment.isOfficer && assignment.consent === "accepted";
}

/** True when a consent state is one that fills an officer slot (pending or accepted). */
export function officerSlotFilled(consent: RoleAssignmentConsent): boolean {
  return consent === "pending" || consent === "accepted";
}
