import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@quagga/db";
import type { PermissionMembership } from "@quagga/core";
import {
  GroupKind,
  MembershipRole,
  type GasFuelRecord,
} from "@quagga/types";
import { dbMock } from "@/test/db-mock";

// The gas & fuel record store (docs/registration-safety-spec.md). What these
// pin is the DECISION: who may save (and that a refusal writes nothing), that
// a save stops being a draft, that the fuel depot notice is edge-triggered —
// sent once when a save turns the advice true, cleared when it turns false —
// who receives which copy, and that "Start from last year" makes a DRAFT. The
// db mock answers queries in order; it cannot see a WHERE clause.

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

const stubs = vi.hoisted(() => ({
  permissions: null as PermissionMembership | null,
}));
vi.mock("../roles-store", () => ({
  getMemberPermissions: async () => stubs.permissions,
}));

const store = await import("../gas-fuel-store");

const LEAD = MembershipRole.enum.lead;
const MEMBER = MembershipRole.enum.member;
const THEME_CAMP = GroupKind.enum.theme_camp;

const CAMP = "11111111-0000-4000-8000-00000000000a";
const EDITION = { id: "eeeeeeee-0000-4000-8000-000000000001", year: 2027 };
const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const REN = "aaaaaaaa-0000-4000-8000-000000000002";
const JABU = "aaaaaaaa-0000-4000-8000-000000000003";
const REGISTRATION = "77777777-0000-4000-8000-000000000001";

const camp = {
  id: CAMP,
  name: "Karoo Kombuis",
  slug: "karoo-kombuis",
  kind: THEME_CAMP,
};

const OVER: GasFuelRecord = {
  lpg: [{ sizeKg: 48, count: 2 }],
  jerryCans20l: 2,
  barrels200l: 1,
  fuelTrailers: 0,
  note: "The diesel barrel is for the generator.",
};
const WITHIN: GasFuelRecord = {
  lpg: [{ sizeKg: 9, count: 2 }],
  jerryCans20l: 2,
  barrels200l: 0,
  fuelTrailers: 0,
  note: "",
};

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

/** Everything up to the record row: camp, actor, registration lock. */
function queueWrite(role: MembershipRole | null, grant = false) {
  dbMock.queue([camp]);
  queueActor(role, grant);
  if (role !== null) dbMock.queue([{ id: REGISTRATION }]);
}

type NotificationValue = {
  userId: string;
  kind: string;
  title: string;
  link: string;
  linkApp: string;
  origin: string;
};

function notifications(): NotificationValue[] {
  return dbMock
    .writesTo(schema.notifications)
    .flatMap((q) => q.arg("values") as NotificationValue[]);
}

function recordWrite(): Record<string, unknown> {
  const w = dbMock.writesTo(schema.campGasFuelRecords)[0];
  if (!w) throw new Error("no record write");
  return (w.arg("values") ?? w.arg("set")) as Record<string, unknown>;
}

beforeEach(() => {
  dbMock.reset();
  stubs.permissions = null;
});

describe("saveGasFuelRecord — who", () => {
  it("a plain member is refused and nothing is written", async () => {
    queueWrite(MEMBER);
    const r = await store.saveGasFuelRecord(ALICE, EDITION, {
      slug: "karoo-kombuis",
      record: OVER,
    });
    expect(r).toEqual({
      ok: false,
      error: "Only leads, co-leads and whoever plans the layout can change this.",
    });
    expect(dbMock.writesTo(schema.campGasFuelRecords)).toHaveLength(0);
    expect(dbMock.writesTo(schema.notifications)).toHaveLength(0);
  });

  it("a stranger gets the camp's not-found", async () => {
    queueWrite(null);
    const r = await store.saveGasFuelRecord(ALICE, EDITION, {
      slug: "karoo-kombuis",
      record: OVER,
    });
    expect(r).toEqual({ ok: false, error: "Camp not found." });
  });

  it("a manage_layout holder may save", async () => {
    queueWrite(MEMBER, true);
    dbMock.queue(/* no record yet */ [], /* no wrangler */ [], /* insert */ []);
    const r = await store.saveGasFuelRecord(ALICE, EDITION, {
      slug: "karoo-kombuis",
      record: WITHIN,
    });
    expect(r).toEqual({ ok: true, advice: false });
  });

  it("refuses a malformed record before touching the database", async () => {
    const r = await store.saveGasFuelRecord(ALICE, EDITION, {
      slug: "karoo-kombuis",
      record: { ...OVER, jerryCans20l: -1 },
    });
    expect(r.ok).toBe(false);
    expect(dbMock.queries).toHaveLength(0);
  });
});

describe("saveGasFuelRecord — the fuel depot notice, edge-triggered", () => {
  it("false → true: the camp's leads and admins are told once, no amounts, no wrangler yet", async () => {
    queueWrite(LEAD);
    dbMock.queue(
      /* no record yet */ [],
      /* no wrangler */ [],
      /* insert */ [],
      /* leads and admins */ [{ userId: ALICE }, { userId: REN }],
    );
    const r = await store.saveGasFuelRecord(ALICE, EDITION, {
      slug: "karoo-kombuis",
      record: OVER,
    });
    expect(r).toEqual({ ok: true, advice: true });

    const written = recordWrite();
    expect(written.isDraft).toBe(false);
    expect(written.campNotifiedAt).toBeInstanceOf(Date);
    expect(written.wranglerNotifiedAt).toBeNull();

    const sent = notifications();
    expect(sent.map((n) => n.userId).sort()).toEqual([ALICE, REN].sort());
    for (const n of sent) {
      expect(n).toMatchObject({
        kind: "wrangler",
        origin: "system",
        linkApp: "web",
        link: "/camps/karoo-kombuis/gas-fuel",
        title:
          "Your gas and fuel go to the fuel depot — your wrangler will be told when one is assigned",
      });
      expect(n.title).not.toMatch(/\d/);
    }
  });

  it("a second save over the limit sends nothing", async () => {
    queueWrite(LEAD);
    dbMock.queue(
      [
        {
          id: "rec-1",
          campNotifiedAt: new Date("2027-01-14T10:00:00Z"),
          wranglerNotifiedAt: null,
        },
      ],
      /* no wrangler */ [],
      /* update */ [],
    );
    await store.saveGasFuelRecord(ALICE, EDITION, {
      slug: "karoo-kombuis",
      record: { ...OVER, barrels200l: 2 },
    });
    expect(notifications()).toHaveLength(0);
    expect(recordWrite().campNotifiedAt).toEqual(
      new Date("2027-01-14T10:00:00Z"),
    );
  });

  it("turning false clears both columns, and sends nothing", async () => {
    queueWrite(LEAD);
    dbMock.queue(
      [
        {
          id: "rec-1",
          campNotifiedAt: new Date("2027-01-14T10:00:00Z"),
          wranglerNotifiedAt: new Date("2027-02-01T10:00:00Z"),
        },
      ],
      [],
      [],
    );
    const r = await store.saveGasFuelRecord(ALICE, EDITION, {
      slug: "karoo-kombuis",
      record: WITHIN,
    });
    expect(r).toEqual({ ok: true, advice: false });
    expect(recordWrite()).toMatchObject({
      campNotifiedAt: null,
      wranglerNotifiedAt: null,
      isDraft: false,
    });
    expect(notifications()).toHaveLength(0);
  });

  it("with a wrangler: the wrangler's copy goes to the console; a wrangler who leads gets only that copy", async () => {
    queueWrite(LEAD);
    dbMock.queue(
      [],
      /* the wrangler */ [{ userId: JABU, username: "jabu", sanitizedAt: null }],
      /* insert */ [],
      /* leads and admins — Jabu also leads */ [{ userId: ALICE }, { userId: JABU }],
    );
    await store.saveGasFuelRecord(ALICE, EDITION, {
      slug: "karoo-kombuis",
      record: OVER,
    });
    const written = recordWrite();
    expect(written.campNotifiedAt).toBeInstanceOf(Date);
    expect(written.wranglerNotifiedAt).toBeInstanceOf(Date);

    const sent = notifications();
    const toJabu = sent.filter((n) => n.userId === JABU);
    expect(toJabu).toHaveLength(1);
    expect(toJabu[0]).toMatchObject({
      linkApp: "org",
      link: `/registrations/${REGISTRATION}`,
      title:
        "Karoo Kombuis is over the fuel depot limit — talk to them about how the fuel depot works",
    });
    const toAlice = sent.filter((n) => n.userId === ALICE);
    expect(toAlice).toHaveLength(1);
    expect(toAlice[0]!.title).toBe(
      "Your gas and fuel go to the fuel depot — talk to your wrangler about how it works",
    );
  });

  it("a notification failure never rolls back the save", async () => {
    queueWrite(LEAD);
    dbMock.queue([], [], [], new Error("connection terminated"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await store.saveGasFuelRecord(ALICE, EDITION, {
      slug: "karoo-kombuis",
      record: OVER,
    });
    expect(r).toEqual({ ok: true, advice: true });
    expect(dbMock.writesTo(schema.campGasFuelRecords)).toHaveLength(1);
    error.mockRestore();
  });
});

describe("startGasFuelFromLastYear — a draft, never automatic", () => {
  it("copies last year's saved record in as a DRAFT and sends nothing", async () => {
    queueWrite(LEAD);
    dbMock.queue(
      /* no record this edition */ [],
      /* last year's */ [{ editionYear: 2026, record: OVER }],
      /* insert */ [],
    );
    const r = await store.startGasFuelFromLastYear(ALICE, EDITION, {
      slug: "karoo-kombuis",
    });
    expect(r).toEqual({ ok: true });
    const written = recordWrite();
    expect(written.isDraft).toBe(true);
    expect(written.record).toEqual(OVER);
    expect(written.campNotifiedAt).toBeUndefined();
    expect(notifications()).toHaveLength(0);
  });

  it("never copies over an existing record", async () => {
    queueWrite(LEAD);
    dbMock.queue([{ id: "rec-1" }], [{ editionYear: 2026, record: OVER }]);
    const r = await store.startGasFuelFromLastYear(ALICE, EDITION, {
      slug: "karoo-kombuis",
    });
    expect(r).toEqual({
      ok: false,
      error: "This camp already has a gas & fuel record for this edition.",
    });
    expect(dbMock.writesTo(schema.campGasFuelRecords)).toHaveLength(0);
  });

  it("a plain member cannot start one", async () => {
    queueWrite(MEMBER);
    dbMock.queue([], [{ editionYear: 2026, record: OVER }]);
    const r = await store.startGasFuelFromLastYear(ALICE, EDITION, {
      slug: "karoo-kombuis",
    });
    expect(r.ok).toBe(false);
    expect(dbMock.writesTo(schema.campGasFuelRecords)).toHaveLength(0);
  });
});

describe("getSavedGasFuelRecord — drafts are invisible outside the record page", () => {
  it("ignores a draft", async () => {
    dbMock.queue([
      {
        record: OVER,
        isDraft: true,
        campNotifiedAt: null,
        wranglerNotifiedAt: null,
        updatedAt: new Date(),
        username: "alice",
        sanitizedAt: null,
      },
    ]);
    expect(await store.getSavedGasFuelRecord(REGISTRATION)).toBeNull();
  });

  it("returns a saved record", async () => {
    dbMock.queue([
      {
        record: OVER,
        isDraft: false,
        campNotifiedAt: null,
        wranglerNotifiedAt: null,
        updatedAt: new Date(),
        username: "alice",
        sanitizedAt: null,
      },
    ]);
    expect((await store.getSavedGasFuelRecord(REGISTRATION))?.record).toEqual(
      OVER,
    );
  });
});

describe("loadGasFuelAccess — the record page's read boundary", () => {
  it("a stranger or former member gets null: the camp's not-found", async () => {
    dbMock.queue([camp]);
    stubs.permissions = null;
    expect(await store.loadGasFuelAccess("karoo-kombuis", ALICE)).toBeNull();
  });

  it("no such camp gets null", async () => {
    dbMock.queue([]);
    stubs.permissions = { structuralRole: LEAD, rolePermissions: [] };
    expect(await store.loadGasFuelAccess("nope", ALICE)).toBeNull();
  });

  it("a current member reads but cannot edit; a lead edits", async () => {
    dbMock.queue([camp]);
    stubs.permissions = { structuralRole: MEMBER, rolePermissions: [] };
    const member = await store.loadGasFuelAccess("karoo-kombuis", REN);
    expect(member?.canEditRecord).toBe(false);

    dbMock.queue([camp]);
    stubs.permissions = { structuralRole: LEAD, rolePermissions: [] };
    const lead = await store.loadGasFuelAccess("karoo-kombuis", ALICE);
    expect(lead?.canEditRecord).toBe(true);
  });
});

describe("loadGasFuelPage — what is offered, and the draft's year", () => {
  const leadAccess = () => ({
    camp: { id: CAMP, name: camp.name, slug: camp.slug },
    viewerUserId: ALICE,
    membership: { structuralRole: LEAD, rolePermissions: [] },
    canEdit: true,
    canSeeWarnings: true,
    canEditRecord: true,
  });
  const storedRow = (isDraft: boolean) => ({
    record: OVER,
    isDraft,
    campNotifiedAt: null,
    wranglerNotifiedAt: null,
    updatedAt: new Date(),
    username: "alice",
    sanitizedAt: null,
  });

  it("a carried-forward draft reports the year it came from", async () => {
    dbMock.queue(
      /* registration */ [{ id: REGISTRATION }],
      /* this edition's row */ [storedRow(true)],
      /* no wrangler */ [],
      /* earlier records */ [{ editionYear: 2026, isDraft: false, record: OVER }],
    );
    const view = await store.loadGasFuelPage(leadAccess(), EDITION);
    expect(view.draftSourceYear).toBe(2026);
    expect(view.lastYear).toBeNull();
  });

  it("a saved record reports no draft year and offers nothing", async () => {
    dbMock.queue([{ id: REGISTRATION }], [storedRow(false)], []);
    const view = await store.loadGasFuelPage(leadAccess(), EDITION);
    expect(view.draftSourceYear).toBeNull();
    expect(view.lastYear).toBeNull();
  });

  it("never offers a draft or this edition's own row as last year's", async () => {
    dbMock.queue(
      [{ id: REGISTRATION }],
      /* nothing this edition */ [],
      [],
      [
        { editionYear: 2027, isDraft: false, record: WITHIN },
        { editionYear: 2026, isDraft: true, record: WITHIN },
        { editionYear: 2025, isDraft: false, record: OVER },
      ],
    );
    const view = await store.loadGasFuelPage(leadAccess(), EDITION);
    expect(view.lastYear).toEqual({ editionYear: 2025, record: OVER });
  });

  it("offers nothing when every earlier row is a draft", async () => {
    dbMock.queue(
      [{ id: REGISTRATION }],
      [],
      [],
      [{ editionYear: 2026, isDraft: true, record: OVER }],
    );
    const view = await store.loadGasFuelPage(leadAccess(), EDITION);
    expect(view.lastYear).toBeNull();
  });
});
