import { describe, it, expect } from "vitest";
import {
  DEPARTED_BURNER_NAME,
  SANITIZED_BIO_NULL_FIELDS,
  SANITIZATION_PRESERVED_TABLES,
  SANITIZATION_PURGED_TABLES,
  buildBioSanitizationPatch,
  buildUserSanitizationPatch,
  buildSanitizationPlan,
  isSanitized,
  assertNotSanitized,
  uncoveredHardLockedFields,
  patchLeaksAny,
} from "../account-sanitization";
import { HARD_LOCKED_PRIVATE_FIELDS } from "../privacy";

const AT = new Date("2026-08-08T09:00:00.000Z");
const USER_ID = "11111111-2222-3333-4444-555555555555";

// A realistic burner bio, standing in for the row sanitization has to erase.
// Every value here is something that must NOT survive.
const REAL_BIO = {
  displayName: "Alice Hatter",
  legalName: "Alice Mary Hatter",
  homeCity: "Cape Town",
  bio: "Tea enthusiast, chronic tinkerer.",
  about: "I build impractical clocks for the playa.",
  contactEmail: "alice@example.com",
  phone: "+27821234567",
  onsiteContactName: "Ren Notfound",
  onsiteContactPhone: "+27829876543",
  offsiteContactName: "Jabu",
  offsiteContactPhone: "+27831112222",
  medicalNotes: "Penicillin allergy",
  saIdEncrypted: "ENCRYPTED-8001015009087",
  passportEncrypted: "ENCRYPTED-A01234567",
  skills: ["welding", "electronics"],
  attendedYears: [2018, 2019, 2022],
  campHistory: [{ name: "Mad Hatters", year: 2019 }],
  volunteeringInterests: ["rangers"],
  rangerTraining: true,
  rangerCurious: true,
  greenDotTraining: false,
  firstTime: false,
  privacyFlags: { displayName: true, bio: true },
};

describe("buildBioSanitizationPatch", () => {
  const patch = buildBioSanitizationPatch(AT);

  it("replaces the display name with the Departed Burner stub", () => {
    expect(DEPARTED_BURNER_NAME).toBe("Departed Burner");
    expect(patch.displayName).toBe(DEPARTED_BURNER_NAME);
  });

  it("nulls every personal field in the erasure list", () => {
    for (const field of SANITIZED_BIO_NULL_FIELDS) {
      expect(patch[field]).toBeNull();
    }
  });

  it("erases EVERY hard-locked private field", () => {
    // The load-bearing assertion: if someone adds a hard-locked class to
    // ./privacy and forgets the erasure path, this fails.
    expect(HARD_LOCKED_PRIVATE_FIELDS.length).toBeGreaterThan(0);
    expect(uncoveredHardLockedFields(patch)).toEqual([]);
  });

  it("resets re-identifying arrays and flags rather than carrying them over", () => {
    // Skills + attended years + camp history are a fingerprint: "welder who was
    // at 2018/2019/2022 with Mad Hatters" identifies one person in a small
    // community even with the name gone.
    expect(patch.skills).toEqual([]);
    expect(patch.attendedYears).toEqual([]);
    expect(patch.campHistory).toBeNull();
    expect(patch.volunteeringInterests).toBeNull();
    expect(patch.rangerTraining).toBeNull();
    expect(patch.rangerCurious).toBeNull();
    expect(patch.greenDotTraining).toBeNull();
    expect(patch.firstTime).toBe(false);
  });

  it("clears privacy flags — they describe fields that no longer hold anything", () => {
    expect(patch.privacyFlags).toEqual({});
  });

  it("leaks NOTHING from the original bio once applied", () => {
    const sanitizedRow = { ...REAL_BIO, ...patch };
    const everyPersonalValue = [
      REAL_BIO.displayName,
      REAL_BIO.legalName,
      REAL_BIO.homeCity,
      REAL_BIO.bio,
      REAL_BIO.about,
      REAL_BIO.contactEmail,
      REAL_BIO.phone,
      REAL_BIO.onsiteContactName,
      REAL_BIO.onsiteContactPhone,
      REAL_BIO.offsiteContactName,
      REAL_BIO.offsiteContactPhone,
      REAL_BIO.medicalNotes,
      REAL_BIO.saIdEncrypted,
      REAL_BIO.passportEncrypted,
      "welding",
      "electronics",
      "rangers",
    ];
    expect(patchLeaksAny(sanitizedRow, everyPersonalValue)).toBe(false);
  });

  it("stamps updatedAt so the change is visible in the row's own history", () => {
    expect(patch.updatedAt).toEqual(AT);
  });
});

describe("buildUserSanitizationPatch", () => {
  const patch = buildUserSanitizationPatch(USER_ID, AT);

  it("nulls the email and stamps the tombstone", () => {
    expect(patch.email).toBeNull();
    expect(patch.sanitizedAt).toEqual(AT);
  });

  it("rewrites authUserId so a recycled provider id can't re-adopt the account", () => {
    // Derived from OUR primary key: stable, unique, and carrying no personal data.
    expect(patch.authUserId).toBe(`deleted:${USER_ID}`);
    expect(patch.authUserId).not.toContain("@");
  });
});

describe("buildSanitizationPlan — referential integrity", () => {
  const plan = buildSanitizationPlan({
    userId: USER_ID,
    at: AT,
    bioCount: 3,
    membershipCount: 4,
  });

  it("PRESERVES memberships, questionnaire responses and audit events", () => {
    // The whole point of the Lost Cat precedent: a cascade would be the damage.
    expect(plan.preservedTables).toContain("memberships");
    expect(plan.preservedTables).toContain("questionnaire_responses");
    expect(plan.preservedTables).toContain("audit_events");
    expect(plan.preservedTables).toContain("required_actions");
    expect(plan.preservedTables).toContain("member_role_assignments");
    expect(plan.preservedTables).toContain("supplier_document_acks");
  });

  it("never lists a preserved table as purged", () => {
    for (const table of SANITIZATION_PRESERVED_TABLES) {
      expect(SANITIZATION_PURGED_TABLES).not.toContain(table);
    }
  });

  it("purges only the secrets-and-tokens tables", () => {
    expect([...plan.purgedTables].sort()).toEqual([
      "email_change_requests",
      "profile_keys",
    ]);
  });

  it("never purges the users row itself", () => {
    expect(plan.purgedTables).not.toContain("users");
    expect(plan.preservedTables).not.toContain("users");
    // users is PATCHED, not deleted — that's what `plan.user` is.
    expect(plan.user.sanitizedAt).toEqual(AT);
  });

  it("records provable erasure in the audit trail without naming personal data", () => {
    expect(plan.audit.action).toBe("account.sanitized");
    expect(plan.audit.subject).toBe(USER_ID);
    expect(plan.audit.meta.reason).toBe("deletion_grace_elapsed");
    expect(plan.audit.meta.bioRows).toBe(3);
    expect(plan.audit.meta.membershipsPreserved).toBe(4);
    // The event itself must not undo the erasure it records.
    expect(
      patchLeaksAny(plan.audit.meta, [
        REAL_BIO.displayName,
        REAL_BIO.contactEmail,
        REAL_BIO.phone,
        REAL_BIO.saIdEncrypted,
      ]),
    ).toBe(false);
  });
});

describe("sanitized-account guards", () => {
  it("recognises a sanitized row", () => {
    expect(isSanitized({ sanitizedAt: null })).toBe(false);
    expect(isSanitized({})).toBe(false);
    expect(isSanitized({ sanitizedAt: AT })).toBe(true);
  });

  it("REFUSES to hand a session back to a sanitized account", () => {
    // Its memberships and roles survive for integrity — re-adopting the row
    // would hand someone a camp lead's permissions.
    expect(assertNotSanitized({ sanitizedAt: null }).ok).toBe(true);
    const refused = assertNotSanitized({ sanitizedAt: AT });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain("deleted");
  });
});

describe("patchLeaksAny", () => {
  it("is case-insensitive and ignores blank needles", () => {
    expect(patchLeaksAny({ a: "Alice Hatter" }, ["alice hatter"])).toBe(true);
    expect(patchLeaksAny({ a: "x" }, ["", null, undefined])).toBe(false);
    expect(patchLeaksAny({ a: "x" }, [])).toBe(false);
  });

  it("searches nested values, not just top-level strings", () => {
    expect(
      patchLeaksAny({ nested: { deep: ["+27821234567"] } }, ["+27821234567"]),
    ).toBe(true);
  });
});
