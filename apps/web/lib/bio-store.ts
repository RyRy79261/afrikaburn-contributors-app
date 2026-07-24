import "server-only";

import { and, eq } from "drizzle-orm";
import {
  BURNER_BIO_ACTION_KEY,
  BURNER_BIO_VERSION,
  buildBurnerBioQuestionnaire,
  defaultPrivacyFlags,
  initialPrivacyFlags,
  resolvePrivacyFlagsUpdate,
  isBioComplete,
  mapBioToResponses,
  mapResponsesToBio,
  type BurnerBioFields,
} from "@quagga/core";
import {
  validateResponses,
  type QuestionnaireResponses,
} from "@quagga/types";
import { db, schema } from "./db";
import { safeEncrypt, decryptOrNull, isCryptoConfigured } from "./crypto-guard";
import { generateProfileKeypair, fingerprintPublicKey } from "./keys";
import { completeRequiredAction } from "./required-actions";

export interface BioView {
  fields: BurnerBioFields;
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

  return {
    fields,
    responses: mapBioToResponses(fields),
    privacyFlags: { ...defaultPrivacyFlags(), ...row.privacyFlags },
    completedAt: row.completedAt,
    cryptoConfigured: isCryptoConfigured(),
  };
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
  final: boolean;
}): Promise<SaveBioResult> {
  const questionnaire = buildBurnerBioQuestionnaire();
  const validated = validateResponses(questionnaire, input.rawResponses);
  if (!validated.ok) return { ok: false, errors: validated.errors };

  const fields = mapResponsesToBio(validated.responses);

  if (input.final && !isBioComplete(fields)) {
    return { ok: false, errors: { displayName: "A display name is required." } };
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
