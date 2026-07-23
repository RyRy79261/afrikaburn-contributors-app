import "server-only";

import { and, eq } from "drizzle-orm";
import {
  BURNER_BIO_ACTION_KEY,
  BURNER_BIO_VERSION,
  buildBurnerBioQuestionnaire,
  defaultPrivacyFlags,
  enforcePrivacyFlags,
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
    previousAfrikaburns: row.previousAfrikaburns,
    firstTime: row.firstTime,
    contactEmail: row.contactEmail,
    phone: row.phone,
    emergencyContact: row.emergencyContact ?? null,
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

  // Privacy flags: merge onto defaults, then force every hard-locked field
  // private — the last line before persistence.
  const privacyFlags = enforcePrivacyFlags({
    ...defaultPrivacyFlags(),
    ...(input.rawPrivacyFlags ?? {}),
  });

  const saIdEncrypted =
    fields.idType === "sa_id" ? safeEncrypt(fields.idNumber) : null;
  const passportEncrypted =
    fields.idType === "passport" ? safeEncrypt(fields.idNumber) : null;

  const now = new Date();
  const completedAt = input.final ? now : null;

  const values = {
    userId: input.userId,
    editionId: input.editionId,
    displayName: fields.displayName,
    legalName: fields.legalName,
    homeCity: fields.homeCity,
    bio: fields.bio,
    skills: fields.skills,
    previousAfrikaburns: fields.previousAfrikaburns,
    firstTime: fields.firstTime,
    contactEmail: fields.contactEmail,
    phone: fields.phone,
    emergencyContact: fields.emergencyContact,
    medicalNotes: fields.medicalNotes,
    saIdEncrypted,
    passportEncrypted,
    privacyFlags,
    version: BURNER_BIO_VERSION,
    updatedAt: now,
  };

  await db()
    .insert(schema.burnerBios)
    .values({ ...values, completedAt })
    .onConflictDoUpdate({
      target: [schema.burnerBios.userId, schema.burnerBios.editionId],
      // On an update, only stamp completedAt when finalising — never unset it.
      set: input.final ? { ...values, completedAt } : values,
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
  const privacyFlags = enforcePrivacyFlags({
    ...defaultPrivacyFlags(),
    ...rawPrivacyFlags,
  });
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
