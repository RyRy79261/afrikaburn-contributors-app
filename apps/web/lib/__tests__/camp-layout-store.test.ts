import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@quagga/db";
import { LAYOUT_AUDIT, type PermissionMembership } from "@quagga/core";
import {
  GroupKind,
  MembershipRole,
  RegistrationStatus,
  type LayoutDocument,
} from "@quagga/types";
import { boundStrings, dbMock } from "@/test/db-mock";

// Camp layouts (docs/camp-layout-spec.md) — the store. What these pin is the
// DECISION: who is refused (and that a refusal writes nothing), that the
// layout is found through the camp's own registration and never an id from
// the request, that saves are compare-and-set on the version, that every
// write is Zod- and catalogue-checked before the database is touched, that
// warnings reach editors only, and what is audited. The db mock cannot see a
// WHERE clause beyond what `boundStrings` reads off it.

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

const stubs = vi.hoisted(() => ({
  permissions: null as PermissionMembership | null,
}));

vi.mock("../roles-store", () => ({
  getMemberPermissions: async () => stubs.permissions,
}));

const store = await import("../camp-layout-store");

// Values from the real vocabularies (AGENTS.md "Verification").
const LEAD = MembershipRole.enum.lead;
const MEMBER = MembershipRole.enum.member;
const THEME_CAMP = GroupKind.enum.theme_camp;
const ARTWORK = GroupKind.enum.artwork;
const DRAFT = RegistrationStatus.enum.draft;

const CAMP = "11111111-0000-4000-8000-00000000000a";
const EDITION = { id: "eeeeeeee-0000-4000-8000-000000000001", year: 2027 };
const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const JABU = "aaaaaaaa-0000-4000-8000-000000000002";
const REGISTRATION = "77777777-0000-4000-8000-000000000001";
const LAST_YEAR_REGISTRATION = "77777777-0000-4000-8000-000000000002";
const LAYOUT = "1a1a1a1a-0000-4000-8000-000000000001";
const LAST_YEAR_LAYOUT = "1a1a1a1a-0000-4000-8000-000000000002";
const KITCHEN = "0b0b0b0b-0000-4000-8000-000000000001";
const SHADE = "0b0b0b0b-0000-4000-8000-000000000002";

const camp = (kind: GroupKind = THEME_CAMP) => ({
  id: CAMP,
  name: "Mad Hatters",
  slug: "mad-hatters",
  kind,
});

function kitchen(id = KITCHEN, x = 21, y = 14) {
  return {
    id,
    catalogKey: "kitchen",
    shape: "rect" as const,
    centre: [x, y] as [number, number],
    width: 6,
    length: 4,
    rotationDeg: 0,
    clearanceM: 1,
    safetyM: 0,
    label: "Kitchen",
    visibility: "public" as const,
  };
}

/** Two overlapping objects — a plan with one warning. */
function overlapping(): LayoutDocument {
  return {
    schemaVersion: 1,
    plot: {
      boundary: { kind: "rect", width: 40, depth: 30 },
      objects: [
        kitchen(),
        {
          ...kitchen(SHADE, 26, 15.5),
          catalogKey: "shade",
          width: 8,
          length: 5,
          label: "Shade 2",
        },
      ],
    },
  };
}

const member = (
  structuralRole: MembershipRole,
  grant = false,
): PermissionMembership => ({
  structuralRole,
  rolePermissions: [{}, ...(grant ? [{ manage_layout: true }] : [])],
});

/** The actor lock inside a write, and the camp's roles as it reads them. */
function queueActor(role: MembershipRole | null, grant = false) {
  if (role === null) {
    dbMock.queue([]);
    return;
  }
  dbMock.queue(
    [{ membershipId: "m-1", role, groupKind: THEME_CAMP }],
    [
      { kind: "baseline", permissions: {}, heldBy: null },
      {
        kind: "custom",
        permissions: { manage_layout: true },
        heldBy: grant ? "m-1" : null,
      },
    ],
  );
}

beforeEach(() => {
  dbMock.reset();
  stubs.permissions = null;
});

/** Every number bound anywhere inside a value — the compare-and-set's
 * version is a number, which `boundStrings` does not collect. */
function boundNumbers(value: unknown): number[] {
  const found: number[] = [];
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 16) return;
    if (typeof v === "number") found.push(v);
    if (typeof v !== "object" || v === null || seen.has(v)) return;
    seen.add(v);
    for (const inner of Object.values(v)) walk(inner, depth + 1);
  };
  walk(value, 0);
  return found;
}

const writes = () =>
  dbMock.queries.filter((q) => ["insert", "update", "delete"].includes(q.kind));

// --- Access -------------------------------------------------------------------

describe("loadLayoutAccess", () => {
  it("a stranger gets nothing", async () => {
    dbMock.queue([camp()]);
    expect(await store.loadLayoutAccess("mad-hatters", JABU)).toBeNull();
  });

  it("an artwork has no layout, even for its lead", async () => {
    dbMock.queue([camp(ARTWORK)]);
    stubs.permissions = member(LEAD);
    expect(await store.loadLayoutAccess("mad-hatters", ALICE)).toBeNull();
  });

  it("no such camp", async () => {
    dbMock.queue([]);
    expect(await store.loadLayoutAccess("nope", ALICE)).toBeNull();
  });

  it("a member views; a lead and a manage_layout holder edit and see warnings", async () => {
    dbMock.queue([camp()]);
    stubs.permissions = member(MEMBER);
    expect(await store.loadLayoutAccess("mad-hatters", JABU)).toMatchObject({
      canEdit: false,
      canSeeWarnings: false,
    });
    dbMock.queue([camp()]);
    stubs.permissions = member(LEAD);
    expect(await store.loadLayoutAccess("mad-hatters", ALICE)).toMatchObject({
      canEdit: true,
      canSeeWarnings: true,
    });
    dbMock.queue([camp()]);
    stubs.permissions = member(MEMBER, true);
    expect(await store.loadLayoutAccess("mad-hatters", JABU)).toMatchObject({
      canEdit: true,
    });
  });
});

// --- Reads ---------------------------------------------------------------------

function access(canEdit: boolean) {
  return {
    camp: { id: CAMP, name: "Mad Hatters", slug: "mad-hatters" },
    viewerUserId: canEdit ? ALICE : JABU,
    membership: member(canEdit ? LEAD : MEMBER),
    canEdit,
    canSeeWarnings: canEdit,
  };
}

const layoutRow = (version = 12) => ({
  id: LAYOUT,
  document: overlapping(),
  version,
  updatedAt: new Date("2027-03-02T12:32:00Z"),
  username: "alice",
  sanitizedAt: null,
});

describe("loadCampLayout", () => {
  it("warnings reach editors only; the summary reaches everyone", async () => {
    dbMock.queue([{ id: REGISTRATION, status: DRAFT }], [layoutRow()], []);
    const forMember = await store.loadCampLayout(access(false), EDITION);
    expect(forMember.warnings).toBeNull();
    expect(forMember.summary).toMatchObject({
      width: 40,
      depth: 30,
      objectCount: 2,
    });
    expect(forMember.layout).toMatchObject({
      version: 12,
      updatedByName: "alice",
    });

    dbMock.queue([{ id: REGISTRATION, status: DRAFT }], [layoutRow()], []);
    const forLead = await store.loadCampLayout(access(true), EDITION);
    expect(forLead.warnings?.map((w) => w.code)).toEqual(["overlap"]);
  });

  it("says when the camp has changed the plan since it was sent", async () => {
    dbMock.queue(
      [{ id: REGISTRATION, status: "submitted" }],
      [layoutRow(14)],
      [{ version: 12, pinnedAt: new Date("2027-03-02T10:00:00Z") }],
    );
    const v = await store.loadCampLayout(access(true), EDITION);
    expect(v.snapshotState).toBe("changed_since_sent");
    expect(v.snapshot?.version).toBe(12);
  });

  it("no registration yet: nothing else is read", async () => {
    dbMock.queue([]);
    const v = await store.loadCampLayout(access(true), EDITION);
    expect(v.registration).toBeNull();
    expect(v.layout).toBeNull();
    expect(dbMock.queries).toHaveLength(1);
  });

  it("offers last year's layout to an editor, never to a member", async () => {
    const source = {
      layoutId: LAST_YEAR_LAYOUT,
      registrationId: LAST_YEAR_REGISTRATION,
      editionYear: 2026,
      document: overlapping(),
    };
    dbMock.queue([{ id: REGISTRATION, status: DRAFT }], [], [source]);
    const forLead = await store.loadCampLayout(access(true), EDITION);
    expect(forLead.lastYear).toMatchObject({
      editionYear: 2026,
      summary: { width: 40, objectCount: 2 },
    });

    dbMock.reset();
    dbMock.queue([{ id: REGISTRATION, status: DRAFT }], [], [source]);
    const forMember = await store.loadCampLayout(access(false), EDITION);
    expect(forMember.lastYear).toBeNull();
    expect(dbMock.queriesTouching(schema.editions)).toHaveLength(0);
  });
});

// --- Save ------------------------------------------------------------------------

const save = (document: unknown = overlapping(), expectedVersion = 12) =>
  store.saveCampLayout(ALICE, EDITION, {
    slug: "mad-hatters",
    expectedVersion,
    document,
  });

describe("saveCampLayout", () => {
  it("saves with warnings — advice never refuses — compare-and-set on the version", async () => {
    dbMock.queue([camp()]);
    queueActor(LEAD);
    dbMock.queue(
      [{ id: REGISTRATION }],
      [{ id: LAYOUT, version: 12 }],
      [{ version: 13 }],
    );
    expect(await save()).toEqual({ ok: true, version: 13 });

    const update = dbMock.onlyQuery("update");
    expect(update.tx).toBe(true);
    expect(update.arg("set")).toMatchObject({
      version: 13,
      updatedByUserId: ALICE,
      document: overlapping(),
    });
    // matched on the layout and the version it was made from
    expect(boundStrings(update)).toEqual(expect.arrayContaining([LAYOUT]));
    expect(boundNumbers(update.arg("where"))).toContain(12);
    // ordinary saves are not audited (autosave)
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });

  it("a stale editor is refused and writes nothing", async () => {
    dbMock.queue([camp()]);
    queueActor(LEAD);
    dbMock.queue([{ id: REGISTRATION }], [{ id: LAYOUT, version: 13 }]);
    expect(await save()).toEqual({
      ok: false,
      error: expect.stringMatching(/changed since you opened it/),
    });
    expect(writes()).toHaveLength(0);
  });

  it("losing the compare-and-set is stale too, never a silent success", async () => {
    dbMock.queue([camp()]);
    queueActor(LEAD);
    dbMock.queue([{ id: REGISTRATION }], [{ id: LAYOUT, version: 12 }], []);
    expect(await save()).toMatchObject({
      ok: false,
      error: expect.stringMatching(/changed since/),
    });
  });

  it("a plain member may not save", async () => {
    dbMock.queue([camp()]);
    queueActor(MEMBER);
    dbMock.queue([{ id: REGISTRATION }], [{ id: LAYOUT, version: 12 }]);
    expect(await save()).toMatchObject({
      ok: false,
      error: expect.stringMatching(/leads and layout editors/),
    });
    expect(writes()).toHaveLength(0);
  });

  it("a member holding manage_layout may", async () => {
    dbMock.queue([camp()]);
    queueActor(MEMBER, true);
    dbMock.queue(
      [{ id: REGISTRATION }],
      [{ id: LAYOUT, version: 12 }],
      [{ version: 13 }],
    );
    expect(await save()).toEqual({ ok: true, version: 13 });
  });

  it("a stranger is told the camp does not exist", async () => {
    dbMock.queue([camp()]);
    queueActor(null);
    expect(await save()).toEqual({ ok: false, error: "Camp not found." });
    expect(writes()).toHaveLength(0);
    dbMock.reset();
    dbMock.queue([]);
    expect(await save()).toEqual({ ok: false, error: "Camp not found." });
  });

  it("a malformed document never reaches the database", async () => {
    const bad = overlapping();
    (bad.plot.objects[0] as { width: number }).width = Number.NaN;
    expect((await save(bad)).ok).toBe(false);
    const nested = overlapping();
    (nested.plot.objects[0] as Record<string, unknown>).phone = "0821234567";
    expect((await save(nested)).ok).toBe(false);
    expect(dbMock.queries).toHaveLength(0);
    expect(dbMock.transactions).toBe(0);
  });

  it("an object this year's palette does not offer is refused before the database", async () => {
    const off = overlapping();
    off.plot.objects[0]!.catalogKey = "hot-tub";
    expect(await save(off)).toEqual({
      ok: false,
      error: "That object isn't in this year's palette.",
    });
    expect(dbMock.queries).toHaveLength(0);
  });

  it("no layout yet: nothing to save over", async () => {
    dbMock.queue([camp()]);
    queueActor(LEAD);
    dbMock.queue([{ id: REGISTRATION }], []);
    expect(await save()).toMatchObject({
      ok: false,
      error: expect.stringMatching(/no layout/),
    });
  });
});

// --- Create and start from last year ---------------------------------------------

describe("createCampLayout", () => {
  const create = () =>
    store.createCampLayout(ALICE, EDITION, {
      slug: "mad-hatters",
      width: 40,
      depth: 30,
    });

  it("creates an empty plot of the size typed, with an audit row, in one transaction", async () => {
    dbMock.queue([camp()]);
    queueActor(LEAD);
    dbMock.queue([{ id: REGISTRATION }], [], [{ id: LAYOUT }]);
    expect(await create()).toEqual({ ok: true, version: 1 });
    const insert = dbMock.writesTo(schema.campLayouts)[0]!;
    expect(insert.tx).toBe(true);
    expect(insert.arg("values")).toMatchObject({
      registrationId: REGISTRATION,
      version: 1,
      document: {
        schemaVersion: 1,
        plot: { boundary: { kind: "rect", width: 40, depth: 30 }, objects: [] },
      },
    });
    const auditRow = dbMock.writesTo(schema.auditEvents)[0]!;
    expect(auditRow.tx).toBe(true);
    expect(auditRow.arg("values")).toMatchObject({
      actorId: ALICE,
      action: LAYOUT_AUDIT.create,
      subject: REGISTRATION,
    });
  });

  it("needs a registration to belong to", async () => {
    dbMock.queue([camp()]);
    queueActor(LEAD);
    dbMock.queue([]);
    expect(await create()).toMatchObject({
      ok: false,
      error: expect.stringMatching(/registration/),
    });
    expect(writes()).toHaveLength(0);
  });

  it("never over an existing layout — read first, or lost on the unique index", async () => {
    dbMock.queue([camp()]);
    queueActor(LEAD);
    dbMock.queue([{ id: REGISTRATION }], [{ id: LAYOUT, version: 3 }]);
    expect(await create()).toMatchObject({
      ok: false,
      error: expect.stringMatching(/already has a layout/),
    });
    expect(writes()).toHaveLength(0);

    dbMock.reset();
    dbMock.queue([camp()]);
    queueActor(LEAD);
    dbMock.queue(
      [{ id: REGISTRATION }],
      [],
      Object.assign(new Error("dup"), { code: "23505" }),
    );
    expect(await create()).toMatchObject({
      ok: false,
      error: expect.stringMatching(/already has a layout/),
    });
  });

  it("a plain member may not create one", async () => {
    dbMock.queue([camp()]);
    queueActor(MEMBER);
    dbMock.queue([{ id: REGISTRATION }], []);
    expect((await create()).ok).toBe(false);
    expect(writes()).toHaveLength(0);
  });

  it("refuses a plot over the size cap before the database", async () => {
    expect(
      (
        await store.createCampLayout(ALICE, EDITION, {
          slug: "mad-hatters",
          width: 600,
          depth: 30,
        })
      ).ok,
    ).toBe(false);
    expect(dbMock.queries).toHaveLength(0);
  });
});

describe("startLayoutFromLastYear", () => {
  const start = () =>
    store.startLayoutFromLastYear(ALICE, EDITION, { slug: "mad-hatters" });
  const source = () => ({
    layoutId: LAST_YEAR_LAYOUT,
    registrationId: LAST_YEAR_REGISTRATION,
    editionYear: 2026,
    document: overlapping(),
  });

  it("copies last year's plan with new ids, audited with where it came from", async () => {
    dbMock.queue([camp()]);
    queueActor(LEAD);
    dbMock.queue([{ id: REGISTRATION }], [], [source()], [{ id: LAYOUT }]);
    expect(await start()).toEqual({ ok: true, version: 1 });

    const doc = dbMock.writesTo(schema.campLayouts)[0]!.arg("values") as {
      document: LayoutDocument;
      registrationId: string;
    };
    expect(doc.registrationId).toBe(REGISTRATION);
    expect(doc.document.plot.objects.map((o) => o.label)).toEqual([
      "Kitchen",
      "Shade 2",
    ]);
    expect(doc.document.plot.objects.map((o) => o.id)).not.toContain(KITCHEN);
    expect(dbMock.writesTo(schema.auditEvents)[0]!.arg("values")).toMatchObject(
      {
        action: LAYOUT_AUDIT.carryForward,
        subject: REGISTRATION,
        meta: {
          fromLayoutId: LAST_YEAR_LAYOUT,
          fromRegistrationId: LAST_YEAR_REGISTRATION,
          fromEditionYear: 2026,
          objects: 2,
        },
      },
    );
  });

  it("never over a layout that exists", async () => {
    dbMock.queue([camp()]);
    queueActor(LEAD);
    dbMock.queue(
      [{ id: REGISTRATION }],
      [{ id: LAYOUT, version: 1 }],
      [source()],
    );
    expect((await start()).ok).toBe(false);
    expect(writes()).toHaveLength(0);
  });

  it("nothing to start from", async () => {
    dbMock.queue([camp()]);
    queueActor(LEAD);
    dbMock.queue([{ id: REGISTRATION }], [], []);
    expect(await start()).toMatchObject({
      ok: false,
      error: expect.stringMatching(/earlier year/),
    });
    expect(writes()).toHaveLength(0);
  });

  it("a stored document that no longer validates is not carried", async () => {
    dbMock.queue([camp()]);
    queueActor(LEAD);
    dbMock.queue(
      [{ id: REGISTRATION }],
      [],
      [{ ...source(), document: { schemaVersion: 0 } }],
    );
    expect((await start()).ok).toBe(false);
    expect(writes()).toHaveLength(0);
  });
});

// --- Pinning ------------------------------------------------------------------------

describe("pinLayoutSnapshot", () => {
  it("copies the current layout, stamped with the submission, and audits it", async () => {
    const submittedAt = new Date("2027-03-02T10:00:00Z");
    dbMock.queue([{ id: LAYOUT, version: 12, document: overlapping() }]);
    const pinned = await dbMock.runTransaction((tx) =>
      store.pinLayoutSnapshot(tx, {
        registrationId: REGISTRATION,
        submittedAt,
        actorUserId: ALICE,
      }),
    );
    expect(pinned).toBe(12);
    expect(
      dbMock.writesTo(schema.campLayoutSnapshots)[0]!.arg("values"),
    ).toEqual({
      layoutId: LAYOUT,
      registrationId: REGISTRATION,
      version: 12,
      document: overlapping(),
      registrationSubmittedAt: submittedAt,
      pinnedAt: submittedAt,
      pinnedByUserId: ALICE,
    });
    expect(dbMock.writesTo(schema.auditEvents)[0]!.arg("values")).toMatchObject(
      {
        action: LAYOUT_AUDIT.pin,
        subject: REGISTRATION,
        meta: { layoutId: LAYOUT, version: 12 },
      },
    );
    // read FOR SHARE, so a save in flight commits first
    expect(dbMock.queriesOfKind("select")[0]!.arg("for")).toBe("share");
  });

  it("a camp that drew no layout pins nothing", async () => {
    dbMock.queue([]);
    const pinned = await dbMock.runTransaction((tx) =>
      store.pinLayoutSnapshot(tx, {
        registrationId: REGISTRATION,
        submittedAt: new Date(),
        actorUserId: ALICE,
      }),
    );
    expect(pinned).toBeNull();
    expect(writes()).toHaveLength(0);
  });
});
