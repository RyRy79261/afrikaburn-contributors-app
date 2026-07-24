import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import {
  BURNER_BIO_ACTION_KEY,
  BURNER_BIO_VERSION,
  buildBurnerBioQuestionnaire,
  defaultPrivacyFlags,
  initialPrivacyFlags,
  parseVolunteering,
  resolvePrivacyFlagsUpdate,
  serializeVolunteering,
  isBioComplete,
  mapBioToResponses,
  mapResponsesToBio,
  type BioExtras,
  type BurnerBioFields,
} from "@quagga/core";
import {
  BioExtrasInput,
  validateResponses,
  type CampHistoryEntry,
  type QuestionnaireResponses,
} from "@quagga/types";
import { db, schema } from "./db";
import { safeEncrypt, decryptOrNull, isCryptoConfigured } from "./crypto-guard";
import { generateProfileKeypair, fingerprintPublicKey } from "./keys";
import { completeRequiredAction } from "./required-actions";

export interface BioView {
  fields: BurnerBioFields;
  /** v3 additions — carried alongside the questionnaire-mapped fields. */
  extras: BioExtras;
  responses: QuestionnaireResponses;
  privacyFlags: Record<string, boolean>;
  completedAt: Date | null;
  /** Whether crypto is configured — the ID document is dropped without it. */
  cryptoConfigured: boolean;
}

/** Load a user's bio for an edition (decrypting the ID document for the owner). */
export async function getBio(
  userId: string,
  editionId: string,
): Promise<BioView | null> {
  const rows = await db()
    .select()
    .from(schema.burnerBios)
    .where(
      and(
        eq(schema.burnerBios.userId, userId),
        eq(schema.burnerBios.editionId, editionId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const idNumber =
    decryptOrNull(row.saIdEncrypted) ?? decryptOrNull(row.passportEncrypted);
  const idType = row.saIdEncrypted
    ? "sa_id"
    : row.passportEncrypted
      ? "passport"
      : null;

  const fields: BurnerBioFields = {
    displayName: row.displayName,
    legalName: row.legalName,
    homeCity: row.homeCity,
    bio: row.bio,
    skills: row.skills,
    attendedYears: row.attendedYears,
    firstTime: row.firstTime,
    contactEmail: row.contactEmail,
    phone: row.phone,
    onsiteContactName: row.onsiteContactName,
    onsiteContactPhone: row.onsiteContactPhone,
    offsiteContactName: row.offsiteContactName,
    offsiteContactPhone: row.offsiteContactPhone,
    medicalNotes: row.medicalNotes,
    idType,
    idNumber,
  };

  const volunteering = parseVolunteering(row.volunteeringInterests);
  const extras: BioExtras = {
    about: row.about,
    campHistory: row.campHistory ?? [],
    volunteeringInterests: volunteering.interests,
    volunteeringOther: volunteering.other,
    rangerTraining: row.rangerTraining ?? false,
    rangerCurious: row.rangerCurious ?? false,
    greenDotTraining: row.greenDotTraining ?? false,
  };

  return {
    fields,
    extras,
    responses: mapBioToResponses(fields),
    privacyFlags: { ...defaultPrivacyFlags(), ...row.privacyFlags },
    completedAt: row.completedAt,
    cryptoConfigured: isCryptoConfigured(),
  };
}

/**
 * Validate the v3 camp-history entries at the write boundary (build-spec: linked
 * entries must reference an existing group). A linked entry whose group is
 * missing degrades gracefully to free text (its label survives); a valid linked
 * entry has its label refreshed to the group's current name.
 */
async function resolveCampHistoryForWrite(
  entries: CampHistoryEntry[],
): Promise<CampHistoryEntry[]> {
  const linkedIds = entries
    .filter((e) => e.kind === "linked" && e.groupId)
    .map((e) => e.groupId as string);
  if (linkedIds.length === 0) return entries;

  const rows = await db()
    .select({ id: schema.groups.id, name: schema.groups.name })
    .from(schema.groups)
    .where(inArray(schema.groups.id, linkedIds));
  const byId = new Map(rows.map((r) => [r.id, r.name]));

  return entries.map((e) => {
    if (e.kind !== "linked" || !e.groupId) return e;
    const name = byId.get(e.groupId);
    if (name) return { ...e, label: name };
    // Stale link — keep the data as free text so nothing is lost.
    return {
      kind: "freetext" as const,
      label: e.label,
      ...(e.event ? { event: e.event } : {}),
      ...(e.years ? { years: e.years } : {}),
    };
  });
}

export type SaveBioResult =
  | { ok: true }
  | { ok: false; errors: Record<string, string> };

/**
 * Validate + persist a bio from questionnaire responses. Enforces the privacy
 * hard-lock, encrypts the ID document (dropping it if crypto is unconfigured),
 * ensures the profile keypair exists, and — on completion — clears the blocking
 * Burner Bio required action. `final` marks the bio complete.
 */
export async function saveBio(input: {
  userId: string;
  editionId: string;
  rawResponses: unknown;
  rawPrivacyFlags?: Record<string, boolean>;
  /** v3 extras. `undefined` ⇒ leave the stored v3 columns untouched. */
  rawExtras?: unknown;
  final: boolean;
}): Promise<SaveBioResult> {
  const questionnaire = buildBurnerBioQuestionnaire();
  const validated = validateResponses(questionnaire, input.rawResponses);
  if (!validated.ok) return { ok: false, errors: validated.errors };

  const fields = mapResponsesToBio(validated.responses);

  if (input.final && !isBioComplete(fields)) {
    return { ok: false, errors: { displayName: "A display name is required." } };
  }

  // v3 extras — validated (Zod) at this boundary; camp-history linked entries
  // are resolved against real groups. Omitted ⇒ the columns are left untouched
  // (mirrors the privacy-flags "don't reset on a partial save" rule).
  let extrasValues: {
    about: string | null;
    campHistory: CampHistoryEntry[];
    volunteeringInterests: string[];
    rangerTraining: boolean;
    rangerCurious: boolean;
    greenDotTraining: boolean;
  } | null = null;
  if (input.rawExtras !== undefined) {
    const parsedExtras = BioExtrasInput.safeParse(input.rawExtras);
    if (!parsedExtras.success) {
      return { ok: false, errors: { _form: "Invalid bio details." } };
    }
    const e = parsedExtras.data;
    const campHistory = await resolveCampHistoryForWrite(e.campHistory ?? []);
    const about = e.about?.trim() ? e.about.trim() : null;
    extrasValues = {
      about,
      campHistory,
      volunteeringInterests: serializeVolunteering(
        e.volunteeringInterests ?? [],
        e.volunteeringOther ?? null,
      ),
      rangerTraining: e.rangerTraining ?? false,
      rangerCurious: e.rangerCurious ?? false,
      greenDotTraining: e.greenDotTraining ?? false,
    };
  }

  const saIdEncrypted =
    fields.idType === "sa_id" ? safeEncrypt(fields.idNumber) : null;
  const passportEncrypted =
    fields.idType === "passport" ? safeEncrypt(fields.idNumber) : null;

  const now = new Date();
  const completedAt = input.final ? now : null;

  // Column values shared by insert + update — EXCLUDING privacy_flags, which are
  // owned by the dedicated privacy editor. A plain bio-text save (no
  // rawPrivacyFlags) must not reset a user's deliberate privacy choices.
  const baseValues = {
    userId: input.userId,
    editionId: input.editionId,
    displayName: fields.displayName,
    legalName: fields.legalName,
    homeCity: fields.homeCity,
    bio: fields.bio,
    skills: fields.skills,
    attendedYears: fields.attendedYears,
    firstTime: fields.firstTime,
    contactEmail: fields.contactEmail,
    phone: fields.phone,
    onsiteContactName: fields.onsiteContactName,
    onsiteContactPhone: fields.onsiteContactPhone,
    offsiteContactName: fields.offsiteContactName,
    offsiteContactPhone: fields.offsiteContactPhone,
    medicalNotes: fields.medicalNotes,
    saIdEncrypted,
    passportEncrypted,
    // v3 columns only when the caller supplied extras (else left untouched).
    ...(extrasValues ?? {}),
    version: BURNER_BIO_VERSION,
    updatedAt: now,
  };

  await db()
    .insert(schema.burnerBios)
    .values({
      ...baseValues,
      // A brand-new row still needs an initial privacy_flags value.
      privacyFlags: initialPrivacyFlags(input.rawPrivacyFlags),
      completedAt,
    })
    .onConflictDoUpdate({
      target: [schema.burnerBios.userId, schema.burnerBios.editionId],
      set: {
        ...baseValues,
        // Only touch privacy_flags when the caller explicitly supplied them.
        ...resolvePrivacyFlagsUpdate(input.rawPrivacyFlags),
        // On an update, only stamp completedAt when finalising — never unset it.
        ...(input.final ? { completedAt } : {}),
      },
    });

  await ensureProfileKeypair(input.userId);

  if (input.final) {
    await completeRequiredAction(input.userId, BURNER_BIO_ACTION_KEY);
  }

  return { ok: true };
}

/** Update only the per-field privacy flags for an existing bio. */
export async function savePrivacyFlags(
  userId: string,
  editionId: string,
  rawPrivacyFlags: Record<string, boolean>,
): Promise<void> {
  const privacyFlags = initialPrivacyFlags(rawPrivacyFlags);
  await db()
    .update(schema.burnerBios)
    .set({ privacyFlags, updatedAt: new Date() })
    .where(
      and(
        eq(schema.burnerBios.userId, userId),
        eq(schema.burnerBios.editionId, editionId),
      ),
    );
}

/** Ensure a profile keypair exists for the user (generate + store once). */
export async function ensureProfileKeypair(userId: string): Promise<void> {
  const existing = await db()
    .select({ userId: schema.profileKeys.userId })
    .from(schema.profileKeys)
    .where(eq(schema.profileKeys.userId, userId))
    .limit(1);
  if (existing[0]) return;

  const pair = await generateProfileKeypair();
  const encryptedPrivate = safeEncrypt(pair.privateKeyB64) ?? pair.privateKeyB64;
  await db()
    .insert(schema.profileKeys)
    .values({
      userId,
      publicKey: pair.publicKeyB64,
      encryptedPrivateKey: encryptedPrivate,
    })
    .onConflictDoNothing({ target: schema.profileKeys.userId });
}

/** The public-key fingerprint shown on the profile, or null if no keypair. */
export async function getKeyFingerprint(userId: string): Promise<string | null> {
  const rows = await db()
    .select({ publicKey: schema.profileKeys.publicKey })
    .from(schema.profileKeys)
    .where(eq(schema.profileKeys.userId, userId))
    .limit(1);
  if (!rows[0]) return null;
  return fingerprintPublicKey(rows[0].publicKey);
}
