import { describe, it, expect } from "vitest";
import { GroupKind } from "@quagga/types";

import {
  ALWAYS_PRIVATE_FIELDS,
  HARD_LOCKED_PRIVATE_FIELDS,
  FIELD_VISIBILITY_LEVELS,
  canBeCampVisible,
  canBePublic,
  encodeFieldVisibility,
  enforcePrivacyFlags,
  fieldVisibility,
  isVisibleToCampMates,
  privacyViolations,
  readFieldVisibility,
} from "../privacy";
import {
  BIO_PRIVACY_FIELDS,
  defaultPrivacyFlags,
  emptyBioExtras,
  initialPrivacyFlags,
  publicBioView,
  type BurnerBioFields,
} from "../bio";
import {
  CAMPMATE_GROUP_KINDS,
  CONTACTABILITY_LEVELS,
  DEFAULT_CONTACTABILITY,
  areCampMates,
  avatarVisibility,
  buildCampPeopleView,
  campmateBioView,
  canContact,
  canViewAvatar,
  canViewCampPeople,
  defaultCampmateSettings,
  readCampmateSettings,
  type CampPersonInput,
  type CampmateContext,
  type CampmateMembership,
} from "../campmates";
import {
  AVATAR_MAX_BYTES,
  checkAvatarUpload,
  isOwnAvatarKey,
  sniffAvatarType,
} from "../avatar";
import { buildBioCarryForward } from "../bio-carry-forward";

// Fixture values come from the real vocabularies (the enum, the privacy
// registry), never invented strings — a fixture outside the domain makes a
// test inert (AGENTS.md §Verification).
const THEME_CAMP: GroupKind = GroupKind.enum.theme_camp;
const ORG: GroupKind = GroupKind.enum.org;
const ARTWORK: GroupKind = GroupKind.enum.artwork;

const ALICE = "00000000-0000-4000-8000-00000000a11c";
const REN = "00000000-0000-4000-8000-000000000404";
const JABU = "00000000-0000-4000-8000-00000000ab00";
const CAMP_A = "10000000-0000-4000-8000-00000000000a";
const CAMP_B = "10000000-0000-4000-8000-00000000000b";
const ORG_GROUP = "10000000-0000-4000-8000-0000000000f0";

const inCamp = (
  groupId: string,
  groupKind: GroupKind = THEME_CAMP,
): CampmateMembership => ({
  groupId,
  groupKind,
});

function ctx(
  viewer: string,
  viewerMemberships: CampmateMembership[],
  subject: string,
  subjectMemberships: CampmateMembership[],
): CampmateContext {
  return {
    viewerUserId: viewer,
    subjectUserId: subject,
    viewerMemberships,
    subjectMemberships,
  };
}

function fields(overrides: Partial<BurnerBioFields> = {}): BurnerBioFields {
  return {
    legalName: "Alice Mary Hatter",
    homeCity: "Cape Town",
    bio: "Tea enthusiast.",
    skills: ["welding"],
    attendedYears: [2019, 2022],
    firstTime: false,
    contactEmail: "alice@example.com",
    phone: "PHONESENTINEL",
    onsiteContactName: "ONSITESENTINEL",
    onsiteContactPhone: "ONSITEPHONESENTINEL",
    offsiteContactName: "OFFSITESENTINEL",
    offsiteContactPhone: "OFFSITEPHONESENTINEL",
    medicalNotes: "MEDICALSENTINEL penicillin",
    idType: "sa_id",
    idNumber: "IDSENTINEL",
    ...overrides,
  };
}

/** Every flag in the registry set to one level — the widest possible ask. */
function everyFieldAt(level: "camp_mates" | "public"): Record<string, unknown> {
  const flags: Record<string, unknown> = {};
  for (const f of BIO_PRIVACY_FIELDS) flags[f.key] = level;
  for (const f of ALWAYS_PRIVATE_FIELDS) flags[f] = level;
  return flags;
}

const SENTINELS = [
  "PHONESENTINEL",
  "ONSITESENTINEL",
  "ONSITEPHONESENTINEL",
  "OFFSITESENTINEL",
  "OFFSITEPHONESENTINEL",
  "MEDICALSENTINEL",
  "IDSENTINEL",
];

describe("three visibility levels — storage is backward compatible", () => {
  it("reads the legacy booleans exactly as before: true=public, false=private", () => {
    expect(readFieldVisibility(true)).toBe("public");
    expect(readFieldVisibility(false)).toBe("private");
    expect(fieldVisibility({ homeCity: true }, "homeCity")).toBe("public");
    expect(fieldVisibility({ homeCity: false }, "homeCity")).toBe("private");
  });

  it("reads the new level and fails CLOSED on anything unrecognised", () => {
    expect(readFieldVisibility("camp_mates")).toBe("camp_mates");
    expect(readFieldVisibility("public")).toBe("public");
    for (const junk of [undefined, null, 1, "yes", "campmates", {}, []]) {
      expect(readFieldVisibility(junk)).toBe("private");
    }
  });

  it("writes public/private as booleans so a legacy `=== true` reader stays correct", () => {
    expect(encodeFieldVisibility("public")).toBe(true);
    expect(encodeFieldVisibility("private")).toBe(false);
    // The ONE new value is a string, which `=== true` reads as private.
    expect(encodeFieldVisibility("camp_mates")).toBe("camp_mates");
    expect(encodeFieldVisibility("camp_mates") === true).toBe(false);
  });

  it("canonicalises on write: every stored value is true, false or 'camp_mates'", () => {
    const safe = enforcePrivacyFlags({
      homeCity: "public",
      bio: "private",
      skills: "camp_mates",
      about: "nonsense",
    });
    expect(safe.homeCity).toBe(true);
    expect(safe.bio).toBe(false);
    expect(safe.skills).toBe("camp_mates");
    expect(safe.about).toBe(false);
  });

  it("a camp-mates field is NOT public", () => {
    const view = publicBioView(fields(), { homeCity: "camp_mates" });
    expect(view.homeCity).toBeNull();
  });

  it("a row written before this change still projects publicly as it did", () => {
    const legacy = { homeCity: true, bio: false, skills: true };
    const view = publicBioView(fields(), legacy);
    expect(view.homeCity).toBe("Cape Town");
    expect(view.bio).toBeNull();
    expect(view.skills).toEqual(["welding"]);
  });

  it("offers exactly three levels", () => {
    expect(FIELD_VISIBILITY_LEVELS).toEqual([
      "private",
      "camp_mates",
      "public",
    ]);
  });
});

describe("canBeCampVisible — the same exclusions as canBePublic", () => {
  it("refuses the camp_mates level for every hard-locked field and medical", () => {
    const refused = [
      "phone",
      "onsiteContactName",
      "onsiteContactPhone",
      "offsiteContactName",
      "offsiteContactPhone",
      "saId",
      "passport",
      "medical",
    ];
    // The list above must BE the always-private union, so a class added to
    // privacy.ts without a test here fails loudly.
    expect([...refused].sort()).toEqual([...ALWAYS_PRIVATE_FIELDS].sort());
    for (const field of refused) {
      expect(canBeCampVisible(field)).toBe(false);
      expect(isVisibleToCampMates({ [field]: "camp_mates" }, field)).toBe(
        false,
      );
      expect(isVisibleToCampMates({ [field]: true }, field)).toBe(false);
      expect(fieldVisibility({ [field]: "camp_mates" }, field)).toBe("private");
    }
  });

  it("an attempt to set any of them camp_mates is reported AND forced private on write", () => {
    for (const field of ALWAYS_PRIVATE_FIELDS) {
      const attempt = { [field]: "camp_mates" };
      expect(privacyViolations(attempt)).toEqual([field]);
      expect(enforcePrivacyFlags(attempt)[field]).toBe(false);
      expect(initialPrivacyFlags(attempt)[field]).toBe(false);
    }
  });

  it("agrees with canBePublic on every registry field", () => {
    for (const f of BIO_PRIVACY_FIELDS) {
      expect(canBeCampVisible(f.key)).toBe(canBePublic(f.key));
    }
  });
});

describe("campmateBioView", () => {
  const alice = [inCamp(CAMP_A)];
  const ren = [inCamp(CAMP_A)];
  const jabu = [inCamp(CAMP_B)];

  it("shows camp-mates what was shared with camp-mates or everyone", () => {
    const view = campmateBioView(ctx(REN, ren, ALICE, alice), {
      fields: fields(),
      confirmed: true,
      privacyFlags: { homeCity: "camp_mates", bio: true, skills: false },
    });
    expect(view).not.toBeNull();
    expect(view?.homeCity).toBe("Cape Town");
    expect(view?.bio).toBe("Tea enthusiast.");
    expect(view?.skills).toEqual([]);
  });

  it("refuses a viewer who shares no camp (null, not an empty view)", () => {
    expect(
      campmateBioView(ctx(JABU, jabu, ALICE, alice), {
        fields: fields(),
        confirmed: true,
        privacyFlags: { homeCity: "camp_mates" },
      }),
    ).toBeNull();
  });

  it("refuses a lead of camp A looking at a member of camp B", () => {
    // Seniority in a different camp is not a shared camp. The role is not even
    // an input — only the shared theme-camp membership is.
    const leadOfA = [inCamp(CAMP_A)];
    const memberOfB = [inCamp(CAMP_B)];
    expect(areCampMates(ctx(ALICE, leadOfA, JABU, memberOfB))).toBe(false);
    expect(
      campmateBioView(ctx(ALICE, leadOfA, JABU, memberOfB), {
        fields: fields(),
        confirmed: true,
        privacyFlags: everyFieldAt("camp_mates"),
      }),
    ).toBeNull();
  });

  it("does not treat a shared ORG or artwork membership as a shared camp", () => {
    expect(CAMPMATE_GROUP_KINDS).toEqual([THEME_CAMP]);
    expect(
      areCampMates(
        ctx(REN, [inCamp(ORG_GROUP, ORG)], ALICE, [inCamp(ORG_GROUP, ORG)]),
      ),
    ).toBe(false);
    expect(
      areCampMates(
        ctx(REN, [inCamp(CAMP_A, ARTWORK)], ALICE, [inCamp(CAMP_A, ARTWORK)]),
      ),
    ).toBe(false);
  });

  it("nobody is their own camp-mate", () => {
    expect(areCampMates(ctx(ALICE, alice, ALICE, alice))).toBe(false);
  });

  it("never carries a hard-locked field or medical, even with every flag camp_mates", () => {
    const view = campmateBioView(ctx(REN, ren, ALICE, alice), {
      fields: fields(),
      confirmed: true,
      privacyFlags: everyFieldAt("camp_mates"),
    });
    const serialised = JSON.stringify(view);
    for (const sentinel of SENTINELS) {
      expect(serialised).not.toContain(sentinel);
    }
    // …and the non-locked fields did come through, so the check is not vacuous.
    expect(serialised).toContain("Cape Town");
  });
});

describe("profile photo visibility", () => {
  const alice = [inCamp(CAMP_A)];
  const ren = [inCamp(CAMP_A)];
  const stranger = [inCamp(CAMP_B)];

  it("defaults to private", () => {
    expect(defaultPrivacyFlags().avatar).toBe(false);
    expect(avatarVisibility({})).toBe("private");
    expect(avatarVisibility(defaultPrivacyFlags())).toBe("private");
  });

  it("refuses a stranger a camp_mates photo, allows the camp-mate", () => {
    const flags = { avatar: "camp_mates" };
    expect(
      canViewAvatar({
        ctx: ctx(JABU, stranger, ALICE, alice),
        viewerSignedIn: true,
        subjectConfirmed: true,
        privacyFlags: flags,
      }),
    ).toBe(false);
    expect(
      canViewAvatar({
        ctx: ctx(REN, ren, ALICE, alice),
        viewerSignedIn: true,
        subjectConfirmed: true,
        privacyFlags: flags,
      }),
    ).toBe(true);
  });

  it("refuses everyone but the owner a private photo", () => {
    expect(
      canViewAvatar({
        ctx: ctx(REN, ren, ALICE, alice),
        viewerSignedIn: true,
        subjectConfirmed: true,
        privacyFlags: { avatar: false },
      }),
    ).toBe(false);
    expect(
      canViewAvatar({
        ctx: ctx(ALICE, alice, ALICE, alice),
        viewerSignedIn: true,
        subjectConfirmed: true,
        privacyFlags: { avatar: false },
      }),
    ).toBe(true);
  });

  it("a public photo is for signed-in viewers only, and never a sanitized account's", () => {
    const base = {
      ctx: ctx(JABU, stranger, ALICE, alice),
      privacyFlags: { avatar: true },
      subjectConfirmed: true,
    };
    expect(canViewAvatar({ ...base, viewerSignedIn: true })).toBe(true);
    expect(canViewAvatar({ ...base, viewerSignedIn: false })).toBe(false);
    expect(
      canViewAvatar({ ...base, viewerSignedIn: true, subjectSanitized: true }),
    ).toBe(false);
  });
});

describe("photo upload — raster only, decided by the bytes", () => {
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
  ]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
  ]);
  const enc = (s: string) => new TextEncoder().encode(s);

  it("accepts png, jpeg and webp by magic number", () => {
    expect(sniffAvatarType(png)).toBe("image/png");
    expect(sniffAvatarType(jpeg)).toBe("image/jpeg");
    expect(sniffAvatarType(webp)).toBe("image/webp");
  });

  it("refuses SVG in every spelling (415)", () => {
    for (const svg of [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>',
      '﻿<svg onload="alert(1)"/>',
      "   <svg/>",
    ]) {
      const result = checkAvatarUpload(enc(svg));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(415);
    }
  });

  it("refuses GIF, HTML and a RIFF that is not WebP", () => {
    expect(sniffAvatarType(enc("GIF89a...."))).toBeNull();
    expect(sniffAvatarType(enc("<html><body>hi</body></html>"))).toBeNull();
    expect(
      sniffAvatarType(
        new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20,
        ]),
      ),
    ).toBeNull();
  });

  it("refuses an empty file and one over the cap", () => {
    expect(checkAvatarUpload(new Uint8Array())).toMatchObject({
      ok: false,
      status: 400,
    });
    const big = new Uint8Array(AVATAR_MAX_BYTES + 1);
    big.set(png);
    expect(checkAvatarUpload(big)).toMatchObject({ ok: false, status: 413 });
    const atCap = new Uint8Array(AVATAR_MAX_BYTES);
    atCap.set(png);
    expect(checkAvatarUpload(atCap)).toEqual({
      ok: true,
      contentType: "image/png",
    });
  });

  it("only treats a key under the owner's own prefix as theirs", () => {
    expect(isOwnAvatarKey(ALICE, `avatars/${ALICE}/photo-x.png`)).toBe(true);
    expect(isOwnAvatarKey(ALICE, `avatars/${REN}/photo-x.png`)).toBe(false);
    expect(isOwnAvatarKey(ALICE, `avatars/${ALICE}/../${REN}/x.png`)).toBe(
      false,
    );
    expect(isOwnAvatarKey(ALICE, "registration-layouts/x.png")).toBe(false);
  });
});

describe("contactability", () => {
  const alice = [inCamp(CAMP_A)];
  const ren = [inCamp(CAMP_A)];
  const stranger = [inCamp(CAMP_B)];

  it("defaults to nobody — the privacy-preserving choice", () => {
    expect(DEFAULT_CONTACTABILITY).toBe("nobody");
    expect(defaultCampmateSettings()).toEqual({
      contactable: "nobody",
      listedInCampPeople: false,
    });
    expect(CONTACTABILITY_LEVELS).toEqual(["nobody", "camp_mates", "anyone"]);
  });

  it("nobody ⇒ refused to all; camp_mates ⇒ camp-mates only; anyone ⇒ all", () => {
    const asMate = ctx(REN, ren, ALICE, alice);
    const asStranger = ctx(JABU, stranger, ALICE, alice);
    expect(canContact({ ctx: asMate, contactable: "nobody", subjectConfirmed: true })).toBe(false);
    expect(canContact({ ctx: asMate, contactable: "camp_mates", subjectConfirmed: true })).toBe(true);
    expect(canContact({ ctx: asStranger, contactable: "camp_mates", subjectConfirmed: true })).toBe(
      false,
    );
    expect(canContact({ ctx: asStranger, contactable: "anyone", subjectConfirmed: true })).toBe(true);
  });

  it("fails closed on junk, self and a sanitized account", () => {
    const asMate = ctx(REN, ren, ALICE, alice);
    expect(canContact({ ctx: asMate, contactable: "everyone", subjectConfirmed: true })).toBe(false);
    expect(canContact({ ctx: asMate, contactable: undefined, subjectConfirmed: true })).toBe(false);
    expect(
      canContact({
        ctx: ctx(ALICE, alice, ALICE, alice),
        contactable: "anyone",
        subjectConfirmed: true,
      }),
    ).toBe(false);
    expect(
      canContact({
        ctx: asMate,
        contactable: "anyone",
        subjectConfirmed: true,
        subjectSanitized: true,
      }),
    ).toBe(false);
    expect(
      readCampmateSettings({ contactable: 7, listedInCampPeople: "yes" }),
    ).toEqual(defaultCampmateSettings());
  });
});

describe("people in my camp", () => {
  function person(
    userId: string,
    memberships: CampmateMembership[],
    opts: {
      listed?: boolean;
      flags?: Record<string, unknown>;
      sanitized?: boolean;
      hasAvatar?: boolean;
      confirmed?: boolean;
    } = {},
  ): CampPersonInput {
    return {
      userId,
      displayName: userId.slice(-4),
      sanitized: opts.sanitized ?? false,
      hasAvatar: opts.hasAvatar ?? false,
      memberships,
      bio: {
        fields: fields(),
        extras: emptyBioExtras(),
        privacyFlags: opts.flags ?? { homeCity: "camp_mates" },
        listedInCampPeople: opts.listed ?? false,
        confirmed: opts.confirmed ?? true,
      },
    };
  }

  it("refuses a non-member — so a free camp's people stay undiscoverable", () => {
    const view = buildCampPeopleView({
      viewerUserId: JABU,
      viewerMemberships: [inCamp(CAMP_B)],
      groupId: CAMP_A,
      groupKind: THEME_CAMP,
      members: [person(ALICE, [inCamp(CAMP_A)], { listed: true })],
    });
    expect(view).toBeNull();
    expect(
      canViewCampPeople({
        viewerMemberships: [],
        groupId: CAMP_A,
        groupKind: THEME_CAMP,
      }),
    ).toBe(false);
  });

  it("refuses the view for a group that is not a theme camp", () => {
    expect(
      canViewCampPeople({
        viewerMemberships: [inCamp(ORG_GROUP, ORG)],
        groupId: ORG_GROUP,
        groupKind: ORG,
      }),
    ).toBe(false);
  });

  it("is off by default: a member who has not opted in is not listed", () => {
    const view = buildCampPeopleView({
      viewerUserId: REN,
      viewerMemberships: [inCamp(CAMP_A)],
      groupId: CAMP_A,
      groupKind: THEME_CAMP,
      members: [
        person(ALICE, [inCamp(CAMP_A)]),
        person(JABU, [inCamp(CAMP_A)], { listed: true }),
      ],
    });
    expect(view?.map((c) => c.userId)).toEqual([JABU]);
  });

  it("shows only what each person shares with camp-mates, never medical or a hard-locked field", () => {
    const view = buildCampPeopleView({
      viewerUserId: REN,
      viewerMemberships: [inCamp(CAMP_A)],
      groupId: CAMP_A,
      groupKind: THEME_CAMP,
      members: [
        person(ALICE, [inCamp(CAMP_A)], {
          listed: true,
          flags: everyFieldAt("camp_mates"),
        }),
        person(JABU, [inCamp(CAMP_A)], {
          listed: true,
          flags: { homeCity: false, bio: "camp_mates" },
        }),
      ],
    });
    const serialised = JSON.stringify(view);
    for (const sentinel of SENTINELS) {
      expect(serialised).not.toContain(sentinel);
    }
    const jabu = view?.find((c) => c.userId === JABU);
    expect(jabu?.fields.homeCity).toBeNull();
    expect(jabu?.fields.bio).toBe("Tea enthusiast.");
  });

  it("drops a sanitized account and a row that is not actually in the group", () => {
    const view = buildCampPeopleView({
      viewerUserId: REN,
      viewerMemberships: [inCamp(CAMP_A)],
      groupId: CAMP_A,
      groupKind: THEME_CAMP,
      members: [
        person(ALICE, [inCamp(CAMP_A)], { listed: true, sanitized: true }),
        person(JABU, [inCamp(CAMP_B)], { listed: true }),
      ],
    });
    expect(view).toEqual([]);
  });

  it("shows a photo only where the photo's own level allows it", () => {
    const view = buildCampPeopleView({
      viewerUserId: REN,
      viewerMemberships: [inCamp(CAMP_A)],
      groupId: CAMP_A,
      groupKind: THEME_CAMP,
      members: [
        person(ALICE, [inCamp(CAMP_A)], {
          listed: true,
          hasAvatar: true,
          flags: { avatar: "camp_mates" },
        }),
        person(JABU, [inCamp(CAMP_A)], {
          listed: true,
          hasAvatar: true,
          flags: { avatar: false },
        }),
      ],
    });
    expect(view?.find((c) => c.userId === ALICE)?.showAvatar).toBe(true);
    expect(view?.find((c) => c.userId === JABU)?.showAvatar).toBe(false);
  });
});

// Regression (review of epic #68): a new edition's onboarding saves drafts that
// carry last year's camp-mate choices. Until the member confirms this edition's
// bio, every exposure is refused — the most-open setting on an unconfirmed bio,
// against the viewer it would otherwise admit.
describe("an unconfirmed bio exposes nothing to anyone but its owner", () => {
  const alice = [inCamp(CAMP_A)];
  const ren = [inCamp(CAMP_A)];

  it("campmateBioView refuses a camp-mate", () => {
    expect(
      campmateBioView(ctx(REN, ren, ALICE, alice), {
        fields: fields(),
        confirmed: false,
        privacyFlags: { homeCity: "camp_mates" },
      }),
    ).toBeNull();
  });

  it("the photo is refused to a camp-mate, still shown to its owner", () => {
    expect(
      canViewAvatar({
        ctx: ctx(REN, ren, ALICE, alice),
        viewerSignedIn: true,
        privacyFlags: { avatar: true },
        subjectConfirmed: false,
      }),
    ).toBe(false);
    expect(
      canViewAvatar({
        ctx: ctx(ALICE, alice, ALICE, alice),
        viewerSignedIn: true,
        privacyFlags: { avatar: false },
        subjectConfirmed: false,
      }),
    ).toBe(true);
  });

  it("contactable=anyone admits nobody", () => {
    expect(
      canContact({
        ctx: ctx(REN, ren, ALICE, alice),
        contactable: "anyone",
        subjectConfirmed: false,
      }),
    ).toBe(false);
  });

  it("a carried people-view opt-in lists nobody", () => {
    const view = buildCampPeopleView({
      viewerUserId: REN,
      viewerMemberships: ren,
      groupId: CAMP_A,
      groupKind: THEME_CAMP,
      members: [
        {
          userId: ALICE,
          displayName: "lice",
          sanitized: false,
          hasAvatar: true,
          memberships: alice,
          bio: {
            fields: fields(),
            privacyFlags: { homeCity: "camp_mates", avatar: "camp_mates" },
            listedInCampPeople: true,
            confirmed: false,
          },
        },
      ],
    });
    expect(view).toEqual([]);
  });
});

describe("carry-forward of the camp-mate settings", () => {
  it("carries contactable, the people opt-in and every level (photo included)", () => {
    const carried = buildBioCarryForward({
      fields: fields(),
      extras: emptyBioExtras(),
      privacyFlags: { homeCity: "camp_mates", avatar: "camp_mates" },
      campmate: { contactable: "camp_mates", listedInCampPeople: true },
    });
    expect(carried.campmate).toEqual({
      contactable: "camp_mates",
      listedInCampPeople: true,
    });
    expect(carried.privacyFlags.homeCity).toBe("camp_mates");
    expect(carried.privacyFlags.avatar).toBe("camp_mates");
  });

  it("an unset prior carries as the private defaults", () => {
    const carried = buildBioCarryForward({
      fields: fields(),
      extras: emptyBioExtras(),
      privacyFlags: {},
    });
    expect(carried.campmate).toEqual(defaultCampmateSettings());
  });

  it("the hard lock is unaffected: a carried locked flag is still private on write", () => {
    const carried = buildBioCarryForward({
      fields: fields(),
      extras: emptyBioExtras(),
      privacyFlags: { phone: "camp_mates", medical: "camp_mates" },
    });
    const written = initialPrivacyFlags(carried.privacyFlags);
    for (const field of [...HARD_LOCKED_PRIVATE_FIELDS, "medical"]) {
      expect(written[field]).toBe(false);
    }
  });
});
