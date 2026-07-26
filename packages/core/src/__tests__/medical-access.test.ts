import { describe, it, expect } from "vitest";
import {
  canViewMedicalNotes,
  medicalAccessBasis,
  isOrgStaffRole,
  MEDICAL_VIEW_AUDIT_ACTION,
  type MedicalAccessContext,
} from "../medical-access";
import {
  canBePublic,
  isSafetyVisibleField,
  ALWAYS_PRIVATE_FIELDS,
} from "../privacy";
import {
  publicBioView,
  BIO_PRIVACY_FIELDS,
  emptyBioExtras,
  MEDICAL_AUDIENCE_NOTE,
  type BurnerBioFields,
} from "../bio";

const CAMP_A = "11111111-1111-1111-1111-111111111111";
const CAMP_B = "22222222-2222-2222-2222-222222222222";

function ctx(overrides: Partial<MedicalAccessContext>): MedicalAccessContext {
  return {
    isSelf: false,
    actorOrgRole: null,
    actorLeadCampIds: [],
    subjectCampIds: [],
    ...overrides,
  };
}

describe("canViewMedicalNotes — who is in the consented audience", () => {
  it("lets the owner see their own notes (self)", () => {
    expect(canViewMedicalNotes(ctx({ isSelf: true }))).toBe(true);
    expect(medicalAccessBasis(ctx({ isSelf: true }))).toBe("self");
  });

  it("lets a lead of a camp the subject belongs to see them (right camp)", () => {
    const c = ctx({
      actorLeadCampIds: [CAMP_A],
      subjectCampIds: [CAMP_A],
    });
    expect(canViewMedicalNotes(c)).toBe(true);
    expect(medicalAccessBasis(c)).toBe("camp_lead");
  });

  it("REFUSES a lead of another camp (lead of A, subject only in B)", () => {
    const c = ctx({
      actorLeadCampIds: [CAMP_A],
      subjectCampIds: [CAMP_B],
    });
    expect(canViewMedicalNotes(c)).toBe(false);
    expect(medicalAccessBasis(c)).toBe(null);
  });

  it("lets org staff (god / org_staff) see them for anyone", () => {
    for (const role of ["god", "org_staff"] as const) {
      const c = ctx({ actorOrgRole: role });
      expect(canViewMedicalNotes(c)).toBe(true);
      expect(medicalAccessBasis(c)).toBe("org_staff");
    }
  });

  it("REFUSES a plain member (no org role, leads no camp the subject is in)", () => {
    // A member who happens to be in the same camp but is NOT a lead there.
    const c = ctx({
      actorOrgRole: null,
      actorLeadCampIds: [], // not a structural lead anywhere
      subjectCampIds: [CAMP_A],
    });
    expect(canViewMedicalNotes(c)).toBe(false);
    expect(medicalAccessBasis(c)).toBe(null);
  });

  it("REFUSES a lead whose lead-camp set does not intersect the subject's camps", () => {
    const c = ctx({
      actorLeadCampIds: [CAMP_A, "33333333-3333-3333-3333-333333333333"],
      subjectCampIds: [CAMP_B],
    });
    expect(canViewMedicalNotes(c)).toBe(false);
  });

  it("is fail-closed for an empty context", () => {
    expect(canViewMedicalNotes(ctx({}))).toBe(false);
  });

  it("isOrgStaffRole recognises only god / org_staff", () => {
    expect(isOrgStaffRole("god")).toBe(true);
    expect(isOrgStaffRole("org_staff")).toBe(true);
    expect(isOrgStaffRole("lead")).toBe(false);
    expect(isOrgStaffRole("admin")).toBe(false);
    expect(isOrgStaffRole("member")).toBe(false);
    expect(isOrgStaffRole(null)).toBe(false);
  });

  it("names a stable audit action for the disclosing read", () => {
    // The audit trail is what makes enumeration detectable now that there is no
    // reveal ceremony; the action string must not drift silently.
    expect(MEDICAL_VIEW_AUDIT_ACTION).toBe("bio.medical.view");
  });
});

describe("consent at the point of entry — the medical field states its audience", () => {
  // The honest label IS the privacy control in this model (Ryan, 26 Jul 2026):
  // the disclosure is the consent, so the field must never be collected without
  // naming who holds it. If this string stops naming both audiences, the
  // consent basis is gone — hence a test, not a comment.
  it("names camp leads AND AfrikaBurn's safety team", () => {
    expect(MEDICAL_AUDIENCE_NOTE.toLowerCase()).toContain("camp leads");
    expect(MEDICAL_AUDIENCE_NOTE.toLowerCase()).toContain("safety team");
  });

  it("is the lock reason shown on the medical privacy toggle", () => {
    const medical = BIO_PRIVACY_FIELDS.find((f) => f.key === "medical");
    expect(medical?.locked).toBe(true);
    expect(medical?.lockReason).toContain(MEDICAL_AUDIENCE_NOTE);
    // Still never public — the audience note explains WHO, never grants public.
    expect(medical?.defaultPublic).toBe(false);
  });
});

describe("REGRESSION: medical notes never appear in ANY public projection", () => {
  const FIELDS: BurnerBioFields = {
    displayName: "Ren Notfound",
    legalName: "Ren N.",
    homeCity: "Cape Town",
    bio: "Dust enthusiast",
    skills: ["build"],
    attendedYears: [2024],
    firstTime: false,
    contactEmail: "ren@example.com",
    phone: "+27 82 000 0000",
    onsiteContactName: "Alice Hatter",
    onsiteContactPhone: "+27 82 111 1111",
    offsiteContactName: "Jabu",
    offsiteContactPhone: "+27 82 222 2222",
    medicalNotes: "SECRET-penicillin-allergy-diabetic",
    idType: "sa_id",
    idNumber: "0000000000000",
  };

  it("medical is safety-visible and can never be public", () => {
    expect(isSafetyVisibleField("medical")).toBe(true);
    expect(canBePublic("medical")).toBe(false);
  });

  it("exposes no always-private field as a key of publicBioView", () => {
    // DERIVED from ALWAYS_PRIVATE_FIELDS, not a hard-coded pair of key names.
    //
    // The version this replaced asserted `keys not to contain "medical"` and was
    // structurally incapable of failing: PublicBioView has no medical key, so
    // publicBioView could never emit one whatever the guard did. It named itself
    // the projection regression and protected nothing. This form fails the
    // moment anyone widens the projection to carry ANY never-public field —
    // which, paired with a relaxed `canBePublic`, is the exact refactor the
    // original claimed to catch.
    const allPublic: Record<string, boolean> = {};
    for (const f of BIO_PRIVACY_FIELDS) allPublic[f.key] = true;
    for (const key of ALWAYS_PRIVATE_FIELDS) allPublic[key] = true;

    const view = publicBioView(FIELDS, allPublic, emptyBioExtras());
    const viewKeys = new Set(Object.keys(view));
    for (const key of ALWAYS_PRIVATE_FIELDS) {
      expect(viewKeys.has(key)).toBe(false);
    }
    // Belt and braces: no key the public gate refuses may appear at all, even
    // under a name that is not literally the flag key (medical → medicalNotes).
    for (const key of viewKeys) {
      expect(canBePublic(key)).toBe(true);
    }
    expect(JSON.stringify(view)).not.toContain(
      "SECRET-penicillin-allergy-diabetic",
    );
  });

  it("stays private even with a corrupted flag map claiming medical public", () => {
    const corrupt: Record<string, boolean> = { medical: true };
    const view = publicBioView(FIELDS, corrupt, emptyBioExtras());
    expect(JSON.stringify(view)).not.toContain("SECRET-penicillin-allergy-diabetic");
  });
});
