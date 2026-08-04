import { describe, it, expect, beforeEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { dbMock, uniqueViolation } from "@/test/db-mock";

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

const {
  slugify,
  listDirectory,
  listCampCategories,
  searchCampDirectory,
  checkCampName,
  prepareCampCreate,
  createCamp,
  nextMemberRefCode,
  ensureMembershipWithRefCode,
  getViewerRole,
  leaveCamp,
  listMyCamps,
  getCampBySlug,
  resolveCampHistoryDisplay,
  getPublicBurnerProfile,
} = await import("../groups-store");

const EDITION = "eeeeeeee-0000-0000-0000-000000000000";
const VIEWER = "aaaaaaaa-0000-0000-0000-000000000001";
const MAD_HATTERS = "11111111-1111-1111-1111-111111111111";
const CAMP_404 = "22222222-2222-2222-2222-222222222222";

/** A `groups` row as `select()` returns it (the whole row, not a projection). */
function group(overrides: Record<string, unknown> = {}) {
  return {
    id: MAD_HATTERS,
    kind: "theme_camp",
    name: "Mad Hatters",
    nameNormalized: "mad hatters",
    slug: "mad-hatters",
    description: "Tea, all night.",
    joinability: "invite",
    createdByUserId: VIEWER,
    ...overrides,
  };
}

beforeEach(() => {
  dbMock.reset();
});

describe("slugify", () => {
  it("collapses accents and punctuation into a hyphenated slug", () => {
    expect(slugify("Café Kombuis!")).toBe("cafe-kombuis");
    expect(slugify("  The Long Drop Inn  ")).toBe("the-long-drop-inn");
  });

  it("never returns an empty slug", () => {
    // An empty slug would produce `/camps/` — a route that resolves to the
    // directory rather than 404ing, so the camp becomes unreachable silently.
    expect(slugify("🔥🔥🔥")).toBe("camp");
    expect(slugify("")).toBe("camp");
  });
});

describe("listDirectory — free camps are undiscoverable to strangers", () => {
  /** The five reads `listDirectory` makes, in order. */
  function queueDirectory(input: {
    groups: unknown[];
    registrations?: unknown[];
    memberships?: unknown[];
    counts?: unknown[];
    categories?: unknown[];
  }) {
    dbMock.queue(input.groups);
    if ((input.groups as unknown[]).length > 0) {
      dbMock.queue(input.registrations ?? []);
    }
    if (input.memberships) dbMock.queue(input.memberships);
    if ((input.groups as unknown[]).length > 0) {
      dbMock.queue(input.counts ?? [], input.categories ?? []);
    }
  }

  it("omits an unregistered camp from a stranger's directory", async () => {
    // A product law, not a preference: a camp that chose not to register is
    // not listed at all for someone who is not in it.
    queueDirectory({ groups: [group()], memberships: [] });

    expect(
      await listDirectory({ editionId: EDITION, viewerId: VIEWER }),
    ).toEqual([]);
  });

  it("shows the same camp to one of its own members, with their role", async () => {
    queueDirectory({
      groups: [group()],
      memberships: [{ groupId: MAD_HATTERS, role: "lead" }],
      counts: [{ groupId: MAD_HATTERS, count: 7 }],
      categories: [
        {
          groupId: MAD_HATTERS,
          id: "cat-1",
          label: "Sound",
          emoji: "🔊",
        },
      ],
    });

    const entries = await listDirectory({
      editionId: EDITION,
      viewerId: VIEWER,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      slug: "mad-hatters",
      registered: false,
      viewerRole: "lead",
      memberCount: 7,
      categories: [{ id: "cat-1", label: "Sound", emoji: "🔊" }],
    });
  });

  it("sorts registered camps ahead of unregistered ones, then by name", async () => {
    queueDirectory({
      groups: [
        group({ id: MAD_HATTERS, name: "Zulu Warriors", slug: "zulu" }),
        group({
          id: CAMP_404,
          name: "Camp 404",
          slug: "camp-404",
          nameNormalized: "camp 404",
        }),
        group({ id: "33333333-3333-3333-3333-333333333333", name: "Aardvark" }),
      ],
      registrations: [
        { groupId: MAD_HATTERS, status: "approved" },
        { groupId: CAMP_404, status: "approved" },
      ],
      memberships: [
        { groupId: "33333333-3333-3333-3333-333333333333", role: "member" },
      ],
    });

    const entries = await listDirectory({
      editionId: EDITION,
      viewerId: VIEWER,
    });
    expect(entries.map((e) => e.name)).toEqual([
      "Camp 404",
      "Zulu Warriors",
      "Aardvark",
    ]);
  });

  it("filters on the normalized name and reports 0 for a camp with no members", async () => {
    queueDirectory({
      groups: [
        group(),
        group({
          id: CAMP_404,
          name: "Camp 404",
          nameNormalized: "camp 404",
          slug: "camp-404",
        }),
      ],
      registrations: [
        { groupId: MAD_HATTERS, status: "approved" },
        { groupId: CAMP_404, status: "approved" },
      ],
      memberships: [],
      counts: [],
    });

    const entries = await listDirectory({
      editionId: EDITION,
      viewerId: VIEWER,
      search: "  HATTERS ",
    });
    expect(entries.map((e) => e.slug)).toEqual(["mad-hatters"]);
    // `undefined` here would render as "undefined members" on the card.
    expect(entries[0]!.memberCount).toBe(0);
  });

  it("queries nothing extra for a signed-out visitor and skips the empty-group reads", async () => {
    queueDirectory({ groups: [] });

    expect(await listDirectory({ editionId: EDITION, viewerId: null })).toEqual(
      [],
    );
    // No registration, count or category query when there are no groups.
    expect(dbMock.queries).toHaveLength(1);
  });
});

describe("listCampCategories", () => {
  it("returns the edition's catalog rows", async () => {
    dbMock.queue([{ id: "cat-1", label: "Workshops", emoji: "🛠" }]);
    expect(await listCampCategories(EDITION)).toEqual([
      { id: "cat-1", label: "Workshops", emoji: "🛠" },
    ]);
  });
});

describe("searchCampDirectory — the SECOND copy of the same rule", () => {
  it("returns nothing for a needle under two characters, before issuing a query", async () => {
    // A one-letter type-ahead would match nearly every camp, including the
    // free ones the viewer belongs to — a slow leak of their own memberships
    // is not the risk, but the query cost is, and the rule is a real one.
    expect(await searchCampDirectory("m", EDITION, VIEWER)).toEqual([]);
    expect(dbMock.queries).toHaveLength(0);
  });

  it("omits a free camp for a stranger and includes it for a member", async () => {
    // The directory rule is implemented TWICE — here and in listDirectory —
    // and two copies of a rule is how this repo's notification linkApp bug
    // happened. This proves the second copy separately from the first.
    const rows = [
      {
        id: MAD_HATTERS,
        name: "Mad Hatters",
        slug: "mad-hatters",
        kind: "theme_camp",
        nameNormalized: "mad hatters",
      },
    ];

    dbMock.queue(rows, /* approved */ [], /* memberships */ []);
    expect(await searchCampDirectory("mad", EDITION, VIEWER)).toEqual([]);

    dbMock.reset();
    dbMock.queue(rows, [], [{ groupId: MAD_HATTERS }]);
    const found = await searchCampDirectory("mad", EDITION, VIEWER);
    expect(found).toEqual([
      {
        id: MAD_HATTERS,
        name: "Mad Hatters",
        slug: "mad-hatters",
        kind: "theme_camp",
        registered: false,
      },
    ]);
  });

  it("returns early when nothing matches the needle", async () => {
    dbMock.queue([
      {
        id: MAD_HATTERS,
        name: "Mad Hatters",
        slug: "mad-hatters",
        kind: "theme_camp",
        nameNormalized: "mad hatters",
      },
    ]);

    expect(await searchCampDirectory("kombuis", EDITION, VIEWER)).toEqual([]);
    expect(dbMock.queries).toHaveLength(1);
  });

  it("caps the type-ahead at 10 results", async () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      id: `g-${i}`,
      name: `Dust Bunnies ${String(i).padStart(2, "0")}`,
      slug: `dust-${i}`,
      kind: "theme_camp",
      nameNormalized: `dust bunnies ${i}`,
    }));

    dbMock.queue(
      many,
      many.map((g) => ({ groupId: g.id })),
    );
    const results = await searchCampDirectory("dust", EDITION, null);
    expect(results).toHaveLength(10);
    expect(results[0]!.name).toBe("Dust Bunnies 00");
    expect(results.every((r) => r.registered)).toBe(true);
  });
});

describe("checkCampName", () => {
  it("REFUSES an exact normalized collision and offers no warnings", async () => {
    dbMock.queue([{ name: "Mad  Hatters" }]);

    expect(await checkCampName("mad hatters", "theme_camp")).toEqual({
      ok: false,
      reason: "exact",
      warnings: [],
    });
  });

  it("returns similar names as NON-blocking warnings, most similar first", async () => {
    dbMock.queue([
      { name: "Mad Haberdashery" },
      { name: "Mad Hatterz" },
      { name: "Karoo Kombuis" },
    ]);

    const check = await checkCampName("Mad Hatters", "theme_camp");
    expect(check.ok).toBe(true);
    expect(check.reason).toBeNull();
    expect(check.warnings[0]).toBe("Mad Hatterz");
    expect(check.warnings).not.toContain("Karoo Kombuis");
  });
});

describe("prepareCampCreate", () => {
  it("REFUSES a name under two characters before any query runs", async () => {
    expect(
      await prepareCampCreate({
        creatorId: VIEWER,
        name: " M ",
        kind: "theme_camp",
        description: null,
        joinability: "open",
      }),
    ).toEqual({ ok: false, error: "Give your camp a name." });
    expect(dbMock.queries).toHaveLength(0);
  });

  it("REFUSES an over-long description before any query runs", async () => {
    const tooLong = Array.from({ length: 400 }, () => "dust").join(" ");

    const result = await prepareCampCreate({
      creatorId: VIEWER,
      name: "Dust Bunnies",
      kind: "theme_camp",
      description: tooLong,
      joinability: "open",
    });
    expect(result.ok).toBe(false);
    expect(dbMock.queries).toHaveLength(0);
  });

  it("REFUSES a name that already exists in the same kind", async () => {
    dbMock.queue([{ name: "Mad Hatters" }]);

    expect(
      await prepareCampCreate({
        creatorId: VIEWER,
        name: "Mad Hatters",
        kind: "theme_camp",
        description: null,
        joinability: "open",
      }),
    ).toEqual({
      ok: false,
      error: "A camp of this kind already uses that name. Pick another.",
    });
  });

  it("appends a suffix when the base slug is taken", async () => {
    dbMock.queue(
      /* checkCampName */ [],
      /* slug clash */ [{ id: CAMP_404 }],
      /* the suffixed slug is free */ [],
    );

    const result = await prepareCampCreate({
      creatorId: VIEWER,
      name: "Mad Hatters",
      kind: "theme_camp",
      description: "Tea.",
      joinability: "open",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prepared.slug).toMatch(/^mad-hatters-[a-z0-9]{4}$/);
    expect(result.prepared.name).toBe("Mad Hatters");
  });
});

describe("createCamp", () => {
  it("writes the group and the creator's lead membership in ONE transaction", async () => {
    dbMock.queue(
      /* checkCampName */ [],
      /* slug free */ [],
      /* group insert … returning */ [{ id: CAMP_404, slug: "camp-404" }],
      /* nextMemberRefCode: no coded members */ [],
      /* …so it disambiguates against every other camp */ [],
      /* membership insert */ [],
    );

    expect(
      await createCamp({
        creatorId: VIEWER,
        name: "Camp 404",
        kind: "theme_camp",
        description: null,
        joinability: "open",
      }),
    ).toEqual({ ok: true, slug: "camp-404" });

    // A camp with no lead cannot be administered by anyone, so the pair is
    // atomic on purpose.
    expect(dbMock.transactions).toBe(1);
    const membership = dbMock.writesTo(schema.memberships);
    expect(membership).toHaveLength(1);
    expect(membership[0]!.tx).toBe(true);
    expect(membership[0]!.arg("values")).toMatchObject({
      userId: VIEWER,
      groupId: CAMP_404,
      role: "lead",
      // Digits are not part of a prefix, so "Camp 404" derives CAMP.
      refCode: "CAMP-M001",
    });
  });

  it("maps a 23505 unique violation to the graceful message rather than a 500", async () => {
    // `checkCampName` is a SELECT-then-decide with a TOCTOU window: two
    // concurrent creates of the same name both pass it, and the unique index
    // is the real guarantee. The loser must be told to pick another name, not
    // shown an error page.
    dbMock.queue([], [], uniqueViolation("groups_kind_name_normalized_idx"));

    expect(
      await createCamp({
        creatorId: VIEWER,
        name: "Mad Hatters",
        kind: "theme_camp",
        description: null,
        joinability: "open",
      }),
    ).toEqual({
      ok: false,
      error: "A camp of this kind already uses that name. Pick another.",
    });
  });

  it("rethrows anything that is NOT a unique violation", async () => {
    // Swallowing every failure as "pick another name" would tell a burner
    // their name is taken when the database was simply unreachable.
    dbMock.queue([], [], new Error("connection terminated unexpectedly"));

    await expect(
      createCamp({
        creatorId: VIEWER,
        name: "Mad Hatters",
        kind: "theme_camp",
        description: null,
        joinability: "open",
      }),
    ).rejects.toThrow("connection terminated");
  });

  it("passes a refusal from prepare straight through, opening no transaction", async () => {
    const result = await createCamp({
      creatorId: VIEWER,
      name: "x",
      kind: "theme_camp",
      description: null,
      joinability: "open",
    });
    expect(result).toEqual({ ok: false, error: "Give your camp a name." });
    expect(dbMock.transactions).toBe(0);
  });
});

describe("nextMemberRefCode", () => {
  it("continues the camp's established prefix and increments the sequence", async () => {
    // Every member of a camp shares one prefix — the treasurer reconciles a
    // bank statement on it, so it must not drift between members.
    dbMock.queue([
      { refCode: "MAH-M001" },
      { refCode: "MAH-M017" },
      { refCode: null },
    ]);

    expect(await nextMemberRefCode(MAD_HATTERS, "Mad Hatters")).toBe(
      "MAH-M018",
    );
    // The established prefix was found, so the cross-camp query never ran.
    expect(dbMock.queries).toHaveLength(1);
  });

  it("derives a fresh prefix disambiguated against every OTHER camp's", async () => {
    dbMock.queue(
      /* this camp has no coded members */ [],
      /* every other camp's codes */ [
        { refCode: "MAH-M001" },
        { refCode: null },
        { refCode: "not-a-ref-code" },
      ],
    );

    // "Mad Haberdashery" also derives MAH, which is taken, so it steps on.
    expect(await nextMemberRefCode(CAMP_404, "Mad Haberdashery")).toBe(
      "MAHA-M001",
    );
  });
});

describe("ensureMembershipWithRefCode", () => {
  it("retries on a ref-code collision and succeeds on the next attempt", async () => {
    dbMock.queue(
      [{ refCode: "MAH-M001" }],
      uniqueViolation("memberships_group_ref_code_idx"),
      [{ refCode: "MAH-M001" }],
      [],
    );

    await dbMock.runTransaction(async (tx) =>
      ensureMembershipWithRefCode(tx, {
        userId: VIEWER,
        groupId: MAD_HATTERS,
        groupName: "Mad Hatters",
        role: "member",
      }),
    );

    expect(dbMock.writesTo(schema.memberships)).toHaveLength(2);
  });

  it("gives up with an error after five attempts", async () => {
    for (let i = 0; i < 5; i++) {
      dbMock.queue([{ refCode: "MAH-M001" }], uniqueViolation());
    }

    await expect(
      dbMock.runTransaction(async (tx) =>
        ensureMembershipWithRefCode(tx, {
          userId: VIEWER,
          groupId: MAD_HATTERS,
          groupName: "Mad Hatters",
          role: "member",
        }),
      ),
    ).rejects.toThrow("Could not assign a member reference code.");
  });

  it("rethrows an error that is not a unique violation", async () => {
    dbMock.queue([{ refCode: "MAH-M001" }], new Error("deadlock detected"));

    await expect(
      dbMock.runTransaction(async (tx) =>
        ensureMembershipWithRefCode(tx, {
          userId: VIEWER,
          groupId: MAD_HATTERS,
          groupName: "Mad Hatters",
          role: "member",
        }),
      ),
    ).rejects.toThrow("deadlock detected");
  });
});

describe("leaveCamp — the no-lockout backstop on the way out", () => {
  it("REFUSES a lead while other members remain, and issues no delete", async () => {
    dbMock.queue([{ role: "lead" }], [{ count: 4 }]);

    const result = await leaveCamp(VIEWER, MAD_HATTERS);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Transfer the lead role/);
    expect(dbMock.queriesOfKind("delete")).toHaveLength(0);
  });

  it("lets the LAST member leave, lead or not", async () => {
    dbMock.queue([{ role: "lead" }], [{ count: 0 }], []);

    expect(await leaveCamp(VIEWER, MAD_HATTERS)).toEqual({ ok: true });
    expect(dbMock.queriesOfKind("delete")).toHaveLength(1);
  });

  it("REFUSES someone who is not a member", async () => {
    dbMock.queue([]);

    expect(await leaveCamp(VIEWER, MAD_HATTERS)).toEqual({
      ok: false,
      error: "You're not a member of this camp.",
    });
    expect(dbMock.queriesOfKind("delete")).toHaveLength(0);
  });

  it("lets an ordinary member leave without counting anybody", async () => {
    dbMock.queue([{ role: "member" }], []);

    expect(await leaveCamp(VIEWER, MAD_HATTERS)).toEqual({ ok: true });
  });
});

describe("getViewerRole / listMyCamps", () => {
  it("getViewerRole is null for a non-member", async () => {
    dbMock.queue([]);
    expect(await getViewerRole(VIEWER, MAD_HATTERS)).toBeNull();
  });

  it("listMyCamps drops the org group from a burner's own camp list", async () => {
    dbMock.queue([
      {
        name: "Mad Hatters",
        slug: "mad-hatters",
        role: "lead",
        kind: "theme_camp",
      },
      { name: "AfrikaBurn", slug: "afrikaburn", role: "god", kind: "org" },
    ]);

    expect(await listMyCamps(VIEWER)).toEqual([
      {
        name: "Mad Hatters",
        slug: "mad-hatters",
        role: "lead",
        kind: "theme_camp",
      },
    ]);
  });
});

describe("getCampBySlug", () => {
  it("is null for an unknown slug and for the org group", async () => {
    dbMock.queue([]);
    expect(await getCampBySlug("nope", EDITION, VIEWER)).toBeNull();

    dbMock.reset();
    dbMock.queue([group({ kind: "org", slug: "afrikaburn" })]);
    expect(await getCampBySlug("afrikaburn", EDITION, VIEWER)).toBeNull();
  });

  it("sorts the roster, marks the viewer, and names the wrangler", async () => {
    dbMock.queue(
      [group()],
      [{ status: "approved" }],
      [
        {
          membershipId: "ms-1",
          userId: "other-user",
          role: "member",
          refCode: "MAH-M002",
          username: "jabu",
          sanitizedAt: null,
        },
        {
          membershipId: "ms-2",
          userId: VIEWER,
          role: "lead",
          refCode: "MAH-M001",
          username: "alice",
          sanitizedAt: null,
        },
      ],
      [{ username: "sipho", sanitizedAt: null }],
    );

    const camp = await getCampBySlug("mad-hatters", EDITION, VIEWER);
    expect(camp?.registered).toBe(true);
    expect(camp?.viewerRole).toBe("lead");
    expect(camp?.members.map((m) => m.role)).toEqual(["lead", "member"]);
    expect(camp?.members[0]!.isViewer).toBe(true);
    // NAME ONLY — a camp is told who their guardian angel is, never how to
    // reach them.
    expect(camp?.wranglerName).toBe("sipho");
  });

  it("reads as unassigned when the wrangler's account has gone", async () => {
    dbMock.queue([group()], [], [], /* no wrangler row */ []);

    const camp = await getCampBySlug("mad-hatters", EDITION, VIEWER);
    expect(camp?.wranglerName).toBeNull();
    expect(camp?.registered).toBe(false);
    expect(camp?.registrationStatus).toBeNull();
  });
});

describe("resolveCampHistoryDisplay", () => {
  it("falls back to plain text when the linked group no longer exists", async () => {
    // A camp that dissolved leaves a dangling groupId in somebody's bio. The
    // entry must still read, just without a link.
    dbMock.queue(/* groups */ [], /* approved */ []);

    expect(
      await resolveCampHistoryDisplay(
        [
          {
            kind: "linked",
            groupId: MAD_HATTERS,
            label: "Mad Hatters",
            event: "  ",
            years: " 2024 ",
          },
        ],
        EDITION,
      ),
    ).toEqual([
      {
        kind: "text",
        label: "Mad Hatters",
        slug: null,
        registered: false,
        event: null,
        years: "2024",
      },
    ]);
  });

  it("reports registered false for a linked group with no approved registration", async () => {
    // Callers gate the public link on `registered`, so a free camp getting
    // `true` here is the undiscoverability rule leaking through a bio.
    dbMock.queue(
      [{ id: MAD_HATTERS, name: "Mad Hatters", slug: "mad-hatters" }],
      [],
    );

    const [entry] = await resolveCampHistoryDisplay(
      [{ kind: "linked", groupId: MAD_HATTERS, label: "old name" }],
      EDITION,
    );
    expect(entry).toMatchObject({
      kind: "linked",
      // The CURRENT name, not the one stored when the entry was made.
      label: "Mad Hatters",
      slug: "mad-hatters",
      registered: false,
    });
  });

  it("passes free-text entries through without querying", async () => {
    expect(
      await resolveCampHistoryDisplay(
        [{ kind: "freetext", label: "A camp that never registered" }],
        EDITION,
      ),
    ).toEqual([
      {
        kind: "text",
        label: "A camp that never registered",
        slug: null,
        registered: false,
        event: null,
        years: null,
      },
    ]);
    expect(dbMock.queries).toHaveLength(0);
  });
});

describe("getPublicBurnerProfile", () => {
  it("is null for a user who does not exist", async () => {
    dbMock.queue([]);
    expect(await getPublicBurnerProfile(VIEWER, EDITION)).toBeNull();
  });

  it("omits every hard-locked private field, whatever the flags say", async () => {
    // Hard-locked fields have NO reveal path of any kind. This asserts on the
    // projection the page renders, with the flags set as permissively as a
    // crafted row could set them.
    dbMock.queue(
      [{ id: VIEWER, username: "alice", sanitizedAt: null }],
      [
        {
          legalName: "Alice Hatter",
          homeCity: "Cape Town",
          bio: "Tea enthusiast.",
          skills: ["welding"],
          attendedYears: [2024],
          firstTime: false,
          contactEmail: "alice@example.com",
          about: null,
          campHistory: [],
          volunteeringInterests: [],
          rangerTraining: null,
          rangerCurious: null,
          greenDotTraining: null,
          privacyFlags: {
            phone: true,
            medical: true,
            onsiteContact: true,
            offsiteContact: true,
            idNumber: true,
            bio: true,
          },
        },
      ],
      /* memberships */ [],
    );

    const profile = await getPublicBurnerProfile(VIEWER, EDITION);
    expect(profile?.displayName).toBe("alice");
    const publicFields = profile?.publicFields as unknown as Record<
      string,
      unknown
    >;
    for (const locked of [
      "phone",
      "medicalNotes",
      "onsiteContactPhone",
      "offsiteContactPhone",
      "idNumber",
      "idType",
    ]) {
      expect(publicFields[locked] ?? null).toBeNull();
    }
    expect(profile?.camps).toEqual([]);
  });

  it("broadcasts only the burner's REGISTERED camps", async () => {
    dbMock.queue(
      [{ id: VIEWER, username: null, sanitizedAt: null }],
      /* no bio row at all */ [],
      [
        {
          groupId: MAD_HATTERS,
          name: "Mad Hatters",
          slug: "mad-hatters",
          kind: "theme_camp",
          role: "lead",
        },
        {
          groupId: CAMP_404,
          name: "Camp 404",
          slug: "camp-404",
          kind: "theme_camp",
          role: "member",
        },
      ],
      /* only one of them is approved */ [{ groupId: CAMP_404 }],
    );

    const profile = await getPublicBurnerProfile(VIEWER, EDITION);
    expect(profile?.camps).toEqual([
      {
        name: "Camp 404",
        slug: "camp-404",
        kind: "theme_camp",
        role: "member",
      },
    ]);
    // No bio row: every field defaults rather than throwing.
    expect(profile?.campHistory).toEqual([]);
  });
});
