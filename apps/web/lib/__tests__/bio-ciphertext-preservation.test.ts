import { describe, it, expect, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";

// THE BLOCKER THIS PINS (audit, 28 Jul 2026).
//
// `getBio` populates the bio form through `decryptOrNull`, which returns null
// BOTH for a genuinely empty field and for ciphertext it cannot decrypt (wrong
// or rotated PGCRYPTO_KEY, or a pre-encryption row). The save then wrote that
// null straight back. So a burner whose medical notes were written under a
// different key opened their profile, saw an empty medical box, changed their
// home city, hit save — and destroyed the only copy of the field a medic needs.
//
// This test runs the REAL save against a REAL database, because the bug lives in
// the interaction between three layers and no amount of mocking would have
// caught it. It skips when there is no DATABASE_URL so the normal unit run is
// unaffected; run it with the local docker stack up:
//
//   NEON_LOCAL_PROXY=1 DATABASE_URL=postgres://postgres:postgres@localhost:5432/quagga \
//     pnpm --filter @quagga/web test
//
// It is NOT in the default CI gate, which is a real limitation — CI has no
// database. Recorded rather than hidden.

const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeDb = HAS_DB ? describe : describe.skip;

/** Present, non-empty, and NOT decryptable under any key — the exact state. */
const UNREADABLE = "this-is-not-valid-base64-aes-gcm-ciphertext";

describeDb("saveBio never destroys ciphertext it could not read", () => {
  let db: typeof import("../db")["db"];
  let schema: typeof import("../db")["schema"];
  let saveBio: typeof import("../bio-store")["saveBio"];
  let getBio: typeof import("../bio-store")["getBio"];
  let userId: string;
  let editionId: string;

  beforeAll(async () => {
    process.env.PGCRYPTO_KEY ??= "test-key-at-least-16-chars-long";
    const dbMod = await import("../db");
    db = dbMod.db;
    schema = dbMod.schema;
    const store = await import("../bio-store");
    saveBio = store.saveBio;
    getBio = store.getBio;

    const [edition] = await db()
      .select({ id: schema.editions.id })
      .from(schema.editions)
      .limit(1);
    if (!edition) throw new Error("no edition in the test database");
    editionId = edition.id;

    const authUserId = "bio-cipher-probe";
    await db()
      .delete(schema.users)
      .where(eq(schema.users.authUserId, authUserId));
    const [u] = await db()
      .insert(schema.users)
      .values({ authUserId, email: "biocipher@example.com" })
      .returning({ id: schema.users.id });
    userId = u!.id;

    // A bio whose sensitive columns hold ciphertext this process cannot read.
    const { BURNER_BIO_VERSION } = await import("@quagga/core");
    await db().insert(schema.burnerBios).values({
      userId,
      editionId,
      version: BURNER_BIO_VERSION,
      legalName: "Cipher Probe",
      homeCity: "Cape Town",
      medicalNotes: UNREADABLE,
      saIdEncrypted: UNREADABLE,
    });
  });

  it("preserves unreadable medical + ID ciphertext across an unrelated edit", async () => {
    // What the burner actually sees: the medical and ID boxes are EMPTY, because
    // the resolver could not decrypt them.
    const before = await getBio(userId, editionId);
    expect(before).not.toBeNull();
    expect(before!.fields.medicalNotes).toBeNull();
    expect(before!.fields.idNumber).toBeNull();

    // They change something unrelated and save — exactly the responses the form
    // would post back, with those two fields blank.
    const responses = { ...before!.responses, homeCity: "Johannesburg" };
    const result = await saveBio({
      userId,
      editionId,
      rawResponses: responses,
      final: false,
    });
    expect(result.ok).toBe(true);

    const [row] = await db()
      .select({
        medicalNotes: schema.burnerBios.medicalNotes,
        saIdEncrypted: schema.burnerBios.saIdEncrypted,
        homeCity: schema.burnerBios.homeCity,
      })
      .from(schema.burnerBios)
      .where(
        and(
          eq(schema.burnerBios.userId, userId),
          eq(schema.burnerBios.editionId, editionId),
        ),
      )
      .limit(1);

    // The edit landed...
    expect(row!.homeCity).toBe("Johannesburg");
    // ...and the unreadable ciphertext is STILL THERE. Before the fix both of
    // these were null, permanently.
    expect(row!.medicalNotes).toBe(UNREADABLE);
    expect(row!.saIdEncrypted).toBe(UNREADABLE);
  });

  it("still lets a burner genuinely clear a READABLE value", async () => {
    // The other half of the contract: preservation must not become a trap where
    // nobody can ever delete their own medical notes. A value the form actually
    // showed, cleared to empty, clears.
    const view = await getBio(userId, editionId);
    const withNotes = { ...view!.responses, medicalNotes: "penicillin" };
    await saveBio({
      userId,
      editionId,
      rawResponses: withNotes,
      final: false,
    });

    const reloaded = await getBio(userId, editionId);
    expect(reloaded!.fields.medicalNotes).toBe("penicillin");

    const cleared = { ...reloaded!.responses, medicalNotes: "" };
    await saveBio({ userId, editionId, rawResponses: cleared, final: false });

    const [row] = await db()
      .select({ medicalNotes: schema.burnerBios.medicalNotes })
      .from(schema.burnerBios)
      .where(
        and(
          eq(schema.burnerBios.userId, userId),
          eq(schema.burnerBios.editionId, editionId),
        ),
      )
      .limit(1);
    expect(row!.medicalNotes).toBeNull();
  });
});
