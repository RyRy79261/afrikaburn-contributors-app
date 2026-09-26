import { describe, it, expect, beforeEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { GroupKind } from "@quagga/types";
import { dbMock } from "@/test/db-mock";

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

const {
  canViewerContact,
  getCampmateBioView,
  listCampPeople,
  loadCampmateMemberships,
  resolveAvatarForViewer,
} = await import("../campmates-store");
const { saveCampmateSettings } = await import("../bio-store");
const { hasAvatar } = await import("../avatar-store");
const { CampmateSettingsInput, CampmateSettingsPatchInput, PrivacyFlagsInput } =
  await import("../campmate-input");

// Values from the real vocabularies (AGENTS.md: a fixture outside the enum is
// inert). Ids are fictional.
const THEME_CAMP = GroupKind.enum.theme_camp;
const ORG = GroupKind.enum.org;
const EDITION = "eeeeeeee-0000-4000-8000-000000000000";
const ALICE = "aaaaaaaa-0000-4000-8000-000000000001"; // subject, camp A
const REN = "aaaaaaaa-0000-4000-8000-000000000002"; // camp-mate, camp A
const JABU = "aaaaaaaa-0000-4000-8000-000000000003"; // lead of camp B
const CAMP_A = "11111111-0000-4000-8000-00000000000a";
const CAMP_B = "11111111-0000-4000-8000-00000000000b";
const ORG_GROUP = "11111111-0000-4000-8000-0000000000f0";

function m(userId: string, groupId: string, groupKind: string = THEME_CAMP) {
  return { userId, groupId, groupKind };
}

/** A SAFE bio row as `select(SAFE_BIO_COLUMNS)` returns it. */
function safeBio(overrides: Record<string, unknown> = {}) {
  return {
    userId: ALICE,
    legalName: "Alice Mary Hatter",
    homeCity: "Cape Town",
    bio: "Tea enthusiast.",
    skills: ["welding"],
    attendedYears: [2019],
    firstTime: false,
    contactEmail: "alice@example.com",
    about: null,
    campHistory: null,
    volunteeringInterests: null,
    rangerTraining: null,
    rangerCurious: null,
    greenDotTraining: null,
    privacyFlags: {},
    contactable: "nobody",
    listedInCampPeople: false,
    ...overrides,
  };
}

/** The columns a select chain asked for. */
function selectedColumns(index: number): string[] {
  const q = dbMock.queries[index]!;
  return Object.keys((q.arg("select") as Record<string, unknown>) ?? {});
}

const SENSITIVE_COLUMNS = [
  "phone",
  "onsiteContactName",
  "onsiteContactPhone",
  "offsiteContactName",
  "offsiteContactPhone",
  "medicalNotes",
  "saIdEncrypted",
  "passportEncrypted",
];

beforeEach(() => {
  dbMock.reset();
});

describe("loadCampmateMemberships", () => {
  it("keys every requested user, including one with no memberships", async () => {
    dbMock.queue([m(ALICE, CAMP_A)]);
    const map = await loadCampmateMemberships([ALICE, REN]);
    expect(map.get(ALICE)).toEqual([
      { groupId: CAMP_A, groupKind: THEME_CAMP },
    ]);
    expect(map.get(REN)).toEqual([]);
  });

  it("issues no query for an empty list", async () => {
    expect((await loadCampmateMemberships([])).size).toBe(0);
    expect(dbMock.queries).toHaveLength(0);
  });
});

describe("getCampmateBioView", () => {
  it("refuses a stranger BEFORE reading the subject's bio", async () => {
    dbMock.queue([m(JABU, CAMP_B), m(ALICE, CAMP_A)]);
    const view = await getCampmateBioView({
      viewerUserId: JABU,
      subjectUserId: ALICE,
      editionId: EDITION,
    });
    expect(view).toBeNull();
    expect(dbMock.queriesTouching(schema.burnerBios)).toHaveLength(0);
  });

  it("refuses a lead of camp B looking at a member of camp A", async () => {
    // Jabu leads camp B. The role is irrelevant — only a shared camp counts.
    dbMock.queue([{ ...m(JABU, CAMP_B) }, m(ALICE, CAMP_A)]);
    expect(
      await getCampmateBioView({
        viewerUserId: JABU,
        subjectUserId: ALICE,
        editionId: EDITION,
      }),
    ).toBeNull();
  });

  it("does not count a shared ORG membership as a shared camp", async () => {
    dbMock.queue([m(REN, ORG_GROUP, ORG), m(ALICE, ORG_GROUP, ORG)]);
    expect(
      await getCampmateBioView({
        viewerUserId: REN,
        subjectUserId: ALICE,
        editionId: EDITION,
      }),
    ).toBeNull();
  });

  it("shows a camp-mate the camp_mates fields, from a select that never loads a sensitive column", async () => {
    dbMock.queue(
      [m(REN, CAMP_A), m(ALICE, CAMP_A)],
      [safeBio({ privacyFlags: { homeCity: "camp_mates", bio: false } })],
    );
    const view = await getCampmateBioView({
      viewerUserId: REN,
      subjectUserId: ALICE,
      editionId: EDITION,
    });
    expect(view?.homeCity).toBe("Cape Town");
    expect(view?.bio).toBeNull();
    const cols = selectedColumns(1);
    expect(cols).toContain("homeCity");
    for (const col of SENSITIVE_COLUMNS) expect(cols).not.toContain(col);
  });

  it("is null when the camp-mate has no bio this edition", async () => {
    dbMock.queue([m(REN, CAMP_A), m(ALICE, CAMP_A)], []);
    expect(
      await getCampmateBioView({
        viewerUserId: REN,
        subjectUserId: ALICE,
        editionId: EDITION,
      }),
    ).toBeNull();
  });
});

describe("resolveAvatarForViewer — what the photo proxy serves", () => {
  const KEY = `avatars/${ALICE}/photo-x.png`;

  it("refuses a stranger a camp_mates photo", async () => {
    dbMock.queue(
      [{ avatarKey: KEY, sanitizedAt: null }],
      [m(JABU, CAMP_B), m(ALICE, CAMP_A)],
      [safeBio({ privacyFlags: { avatar: "camp_mates" } })],
    );
    expect(
      await resolveAvatarForViewer({
        viewerUserId: JABU,
        subjectUserId: ALICE,
        editionId: EDITION,
      }),
    ).toBeNull();
  });

  it("serves the camp-mate the same camp_mates photo", async () => {
    dbMock.queue(
      [{ avatarKey: KEY, sanitizedAt: null }],
      [m(REN, CAMP_A), m(ALICE, CAMP_A)],
      [safeBio({ privacyFlags: { avatar: "camp_mates" } })],
    );
    expect(
      await resolveAvatarForViewer({
        viewerUserId: REN,
        subjectUserId: ALICE,
        editionId: EDITION,
      }),
    ).toBe(KEY);
  });

  it("defaults to private: no flag ⇒ even a camp-mate is refused", async () => {
    dbMock.queue(
      [{ avatarKey: KEY, sanitizedAt: null }],
      [m(REN, CAMP_A), m(ALICE, CAMP_A)],
      [safeBio({ privacyFlags: {} })],
    );
    expect(
      await resolveAvatarForViewer({
        viewerUserId: REN,
        subjectUserId: ALICE,
        editionId: EDITION,
      }),
    ).toBeNull();
  });

  it("always serves the owner, and never a signed-out viewer or a deleted account", async () => {
    dbMock.queue([{ avatarKey: KEY, sanitizedAt: null }], [safeBio()]);
    expect(
      await resolveAvatarForViewer({
        viewerUserId: ALICE,
        subjectUserId: ALICE,
        editionId: EDITION,
      }),
    ).toBe(KEY);

    dbMock.reset();
    dbMock.queue([{ avatarKey: KEY, sanitizedAt: null }]);
    expect(
      await resolveAvatarForViewer({
        viewerUserId: null,
        subjectUserId: ALICE,
        editionId: EDITION,
      }),
    ).toBeNull();

    dbMock.reset();
    dbMock.queue(
      [{ avatarKey: KEY, sanitizedAt: new Date() }],
      [m(REN, CAMP_A), m(ALICE, CAMP_A)],
      [safeBio({ privacyFlags: { avatar: true } })],
    );
    expect(
      await resolveAvatarForViewer({
        viewerUserId: REN,
        subjectUserId: ALICE,
        editionId: EDITION,
      }),
    ).toBeNull();
  });

  it("is null with no photo on file, without loading anything else", async () => {
    dbMock.queue([{ avatarKey: null, sanitizedAt: null }]);
    expect(
      await resolveAvatarForViewer({
        viewerUserId: REN,
        subjectUserId: ALICE,
        editionId: EDITION,
      }),
    ).toBeNull();
    expect(dbMock.queries).toHaveLength(1);
  });
});

describe("canViewerContact", () => {
  it("is refused by default (nobody) and for an unknown subject", async () => {
    dbMock.queue(
      [{ sanitizedAt: null }],
      [m(REN, CAMP_A), m(ALICE, CAMP_A)],
      [safeBio()],
    );
    expect(
      await canViewerContact({
        viewerUserId: REN,
        subjectUserId: ALICE,
        editionId: EDITION,
      }),
    ).toBe(false);

    dbMock.reset();
    dbMock.queue([]);
    expect(
      await canViewerContact({
        viewerUserId: REN,
        subjectUserId: ALICE,
        editionId: EDITION,
      }),
    ).toBe(false);
  });

  it("camp_mates lets a camp-mate through and not a stranger", async () => {
    dbMock.queue(
      [{ sanitizedAt: null }],
      [m(REN, CAMP_A), m(ALICE, CAMP_A)],
      [safeBio({ contactable: "camp_mates" })],
    );
    expect(
      await canViewerContact({
        viewerUserId: REN,
        subjectUserId: ALICE,
        editionId: EDITION,
      }),
    ).toBe(true);

    dbMock.reset();
    dbMock.queue(
      [{ sanitizedAt: null }],
      [m(JABU, CAMP_B), m(ALICE, CAMP_A)],
      [safeBio({ contactable: "camp_mates" })],
    );
    expect(
      await canViewerContact({
        viewerUserId: JABU,
        subjectUserId: ALICE,
        editionId: EDITION,
      }),
    ).toBe(false);
  });
});

describe("listCampPeople", () => {
  const CAMP = {
    id: CAMP_A,
    kind: THEME_CAMP,
    name: "Mad Hatters",
    slug: "mad-hatters",
  };

  it("is null for an unknown slug", async () => {
    dbMock.queue([]);
    expect(
      await listCampPeople({
        viewerUserId: REN,
        slug: "nope",
        editionId: EDITION,
      }),
    ).toBeNull();
  });

  it("refuses a non-member BEFORE any member row is read — a free camp stays undiscoverable", async () => {
    dbMock.queue([CAMP], [m(JABU, CAMP_B)]);
    expect(
      await listCampPeople({
        viewerUserId: JABU,
        slug: CAMP.slug,
        editionId: EDITION,
      }),
    ).toBeNull();
    expect(dbMock.queriesTouching(schema.burnerBios)).toHaveLength(0);
  });

  it("lists only opted-in members, as camp-mates see them, from a select with no sensitive column", async () => {
    dbMock.queue(
      [CAMP],
      [m(REN, CAMP_A)],
      [
        {
          ...safeBio({
            listedInCampPeople: true,
            privacyFlags: { homeCity: "camp_mates", skills: false },
          }),
          username: "alice_hatter",
          sanitizedAt: null,
          avatarKey: null,
        },
        {
          // The query filters on the opt-in; core re-checks it anyway.
          ...safeBio({ userId: JABU, listedInCampPeople: false }),
          username: "jabu",
          sanitizedAt: null,
          avatarKey: null,
        },
      ],
    );
    const result = await listCampPeople({
      viewerUserId: REN,
      slug: CAMP.slug,
      editionId: EDITION,
    });
    expect(result?.people.map((p) => p.userId)).toEqual([ALICE]);
    expect(result?.people[0]?.fields.homeCity).toBe("Cape Town");
    expect(result?.people[0]?.fields.skills).toEqual([]);
    const cols = selectedColumns(2);
    expect(cols).toContain("listedInCampPeople");
    for (const col of SENSITIVE_COLUMNS) expect(cols).not.toContain(col);
  });
});

describe("saveCampmateSettings", () => {
  it("merges the photo level into the stored map without resetting other fields", async () => {
    dbMock.queue([
      {
        privacyFlags: { homeCity: true, bio: "camp_mates" },
        contactable: "nobody",
        listedInCampPeople: false,
      },
    ]);
    const ok = await saveCampmateSettings(ALICE, EDITION, {
      avatarVisibility: "camp_mates",
      listedInCampPeople: true,
    });
    expect(ok).toBe(true);
    const set = dbMock.writesTo(schema.burnerBios)[0]!.arg("set") as Record<
      string,
      unknown
    >;
    const flags = set.privacyFlags as Record<string, unknown>;
    expect(flags.avatar).toBe("camp_mates");
    expect(flags.homeCity).toBe(true);
    expect(flags.bio).toBe("camp_mates");
    // The last-line enforcement ran: locked fields are forced private.
    expect(flags.phone).toBe(false);
    expect(flags.medical).toBe(false);
    expect(set.listedInCampPeople).toBe(true);
    expect(set.contactable).toBe("nobody");
  });

  it("leaves privacy_flags alone when the photo level is not being changed", async () => {
    dbMock.queue([
      { privacyFlags: {}, contactable: "nobody", listedInCampPeople: false },
    ]);
    await saveCampmateSettings(ALICE, EDITION, { contactable: "anyone" });
    const set = dbMock.writesTo(schema.burnerBios)[0]!.arg("set") as Record<
      string,
      unknown
    >;
    expect(set).not.toHaveProperty("privacyFlags");
    expect(set.contactable).toBe("anyone");
  });

  it("is false when there is no bio row this edition", async () => {
    dbMock.queue([]);
    expect(
      await saveCampmateSettings(ALICE, EDITION, { contactable: "anyone" }),
    ).toBe(false);
    expect(dbMock.writesTo(schema.burnerBios)).toHaveLength(0);
  });
});

describe("hasAvatar", () => {
  it("reports whether a photo is on file", async () => {
    dbMock.queue(
      [{ avatarKey: `avatars/${ALICE}/p.png` }],
      [{ avatarKey: null }],
    );
    expect(await hasAvatar(ALICE)).toBe(true);
    expect(await hasAvatar(ALICE)).toBe(false);
  });
});

describe("the Zod boundaries (campmate-input)", () => {
  it("accepts the legacy booleans and the three named levels, nothing else", () => {
    expect(
      PrivacyFlagsInput.safeParse({
        homeCity: true,
        bio: false,
        skills: "camp_mates",
        about: "public",
        legalName: "private",
      }).success,
    ).toBe(true);
    expect(PrivacyFlagsInput.safeParse({ homeCity: "everyone" }).success).toBe(
      false,
    );
    expect(PrivacyFlagsInput.safeParse({ homeCity: 1 }).success).toBe(false);
  });

  it("caps the size of a flags map", () => {
    const huge = Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => [`f${i}`, true]),
    );
    expect(PrivacyFlagsInput.safeParse(huge).success).toBe(false);
  });

  it("only takes the contactability vocabulary, and rejects unknown patch keys", () => {
    expect(
      CampmateSettingsInput.safeParse({
        contactable: "camp_mates",
        listedInCampPeople: true,
      }).success,
    ).toBe(true);
    expect(
      CampmateSettingsInput.safeParse({
        contactable: "everyone",
        listedInCampPeople: true,
      }).success,
    ).toBe(false);
    expect(
      CampmateSettingsPatchInput.safeParse({ avatarVisibility: "camp_mates" })
        .success,
    ).toBe(true);
    expect(
      CampmateSettingsPatchInput.safeParse({ privacyFlags: { phone: true } })
        .success,
    ).toBe(false);
  });
});
