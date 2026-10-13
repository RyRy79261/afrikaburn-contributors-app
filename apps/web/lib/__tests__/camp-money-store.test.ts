import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Param, is } from "drizzle-orm";
import { schema } from "@quagga/db";
import { MONEY_AUDIT, type PermissionMembership } from "@quagga/core";
import {
  CampClaimStatus,
  GroupKind,
  MembershipRole,
  NotificationKind,
} from "@quagga/types";
import { boundStrings, dbMock, nullChecksOn } from "@/test/db-mock";

// Camp money (docs/camp-budget-spec.md) — the store. What these pin is the
// DECISION: who is refused (and that a refusal writes nothing), that the
// facts come from the database and not the request, that every money write
// runs in ONE transaction with an audit row, that claims are decided by
// compare-and-set and never by their author, and that notices go out only
// after commit. The db mock cannot see a WHERE clause beyond what
// `boundStrings` / `nullChecksOn` read off it.

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

const stubs = vi.hoisted(() => ({
  permissions: null as PermissionMembership | null,
  permissionCalls: [] as [string, string][],
  stored: [] as string[],
  quietDeletes: [] as [string, string | null | undefined][],
}));

vi.mock("../roles-store", () => ({
  getMemberPermissions: async (groupId: string, userId: string) => {
    stubs.permissionCalls.push([groupId, userId]);
    return stubs.permissions;
  },
}));

vi.mock("../camp-receipt-blob", () => ({
  isReceiptStorageConfigured: () => Boolean(process.env.BLOB_READ_WRITE_TOKEN),
  putReceiptBlob: async (groupId: string) => {
    const key = `camp-receipts/${groupId}/receipt-${stubs.stored.length}.pdf`;
    stubs.stored.push(key);
    return key;
  },
  deleteReceiptBlobQuietly: async (
    groupId: string,
    key: string | null | undefined,
  ) => {
    stubs.quietDeletes.push([groupId, key]);
  },
}));

const store = await import("../camp-money-store");

// Values from the real vocabularies (AGENTS.md "Verification").
const LEAD = MembershipRole.enum.lead;
const MEMBER = MembershipRole.enum.member;
const THEME_CAMP = GroupKind.enum.theme_camp;
const ARTWORK = GroupKind.enum.artwork;
const SUBMITTED = CampClaimStatus.enum.submitted;
const APPROVED = CampClaimStatus.enum.approved;
const MONEY = NotificationKind.enum.money;

const CAMP = "11111111-0000-4000-8000-00000000000a";
const EDITION = "eeeeeeee-0000-4000-8000-000000000001";
const ALICE = "aaaaaaaa-0000-4000-8000-000000000001"; // lead
const JABU = "aaaaaaaa-0000-4000-8000-000000000002"; // member
const LERATO = "aaaaaaaa-0000-4000-8000-000000000003"; // member, treasurer role
const M_ALICE = "22222222-0000-4000-8000-000000000001";
const M_JABU = "22222222-0000-4000-8000-000000000002";
const M_LERATO = "22222222-0000-4000-8000-000000000003";
const CLAIM = "c1c1c1c1-0000-4000-8000-000000000001";
const KITCHEN = "ca7ca7ca-0000-4000-8000-000000000001";
const PAYMENT = "9a9a9a9a-0000-4000-8000-000000000001";

const MEMBERSHIP: Record<string, string> = {
  [ALICE]: M_ALICE,
  [JABU]: M_JABU,
  [LERATO]: M_LERATO,
};

const actorRow = (userId: string, role: MembershipRole, kind = THEME_CAMP) => ({
  membershipId: MEMBERSHIP[userId],
  userId,
  role,
  username: userId === ALICE ? "alice" : userId === JABU ? "jabu" : "lerato",
  groupKind: kind,
  groupName: "Mad Hatters",
  groupSlug: "mad-hatters",
});

/** The roles of the camp as `loadRolePermissions` reads them: the baseline
 * (everyone) and, optionally, a custom role this member holds or not. */
const roleRows = (custom?: { manage_money: boolean; held: boolean }) => [
  { kind: "baseline", permissions: {}, heldBy: null },
  ...(custom
    ? [
        {
          kind: "custom",
          permissions: { manage_money: custom.manage_money },
          heldBy: custom.held ? "held" : null,
        },
      ]
    : []),
];

/** Queue the actor lock + their role permissions. */
function queueActor(
  userId: string | null,
  role: MembershipRole = MEMBER,
  custom?: { manage_money: boolean; held: boolean },
) {
  if (userId === null) {
    dbMock.queue([]);
    return;
  }
  dbMock.queue([actorRow(userId, role)], roleRows(custom));
}

const budgetRow = (overrides: Record<string, unknown> = {}) => ({
  id: "b0b0b0b0-0000-4000-8000-000000000001",
  defaultDuesCents: 250_000,
  paymentInstructions: null,
  contingencyPct: 5,
  status: "draft",
  ...overrides,
});

const base = { groupId: CAMP, editionId: EDITION };

/** Every bound PARAMETER in a chain's WHERE (not the column metadata
 * `boundStrings` also walks into — an enum column carries every value). */
function whereParams(query: { arg(method: string): unknown }): unknown[] {
  const found: unknown[] = [];
  const seen = new WeakSet<object>();
  const walk = (value: unknown, depth: number) => {
    if (depth > 16 || typeof value !== "object" || value === null) return;
    if (seen.has(value)) return;
    seen.add(value);
    if (is(value, Param)) {
      found.push((value as { value: unknown }).value);
      return;
    }
    for (const inner of Object.values(value)) walk(inner, depth + 1);
  };
  walk(query.arg("where"), 0);
  return found;
}

const auditRows = () =>
  dbMock.writesTo(schema.auditEvents).map(
    (q) =>
      q.arg("values") as {
        actorId: string;
        action: string;
        subject: string;
        meta: Record<string, unknown>;
      },
  );

const noticeRows = () =>
  dbMock
    .writesTo(schema.notifications)
    .flatMap(
      (q) =>
        q.arg("values") as { userId: string; kind: string; title: string }[],
    );

const MONEY_TABLES = [
  schema.campBudgets,
  schema.budgetCategories,
  schema.budgetEntries,
  schema.memberDues,
  schema.duesPayments,
  schema.campClaims,
];
const moneyWrites = () => MONEY_TABLES.flatMap((t) => dbMock.writesTo(t));

beforeEach(() => {
  dbMock.reset();
  stubs.permissions = null;
  stubs.permissionCalls = [];
  stubs.stored = [];
  stubs.quietDeletes = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// --- Access -------------------------------------------------------------------

describe("loadMoneyAccess", () => {
  const group = (kind: GroupKind = THEME_CAMP) => [
    { id: CAMP, name: "Mad Hatters", slug: "mad-hatters", kind },
  ];

  it("is null for a non-member — the camp's 404", async () => {
    dbMock.queue(group());
    stubs.permissions = null;
    expect(await store.loadMoneyAccess("mad-hatters", JABU)).toBeNull();
    expect(stubs.permissionCalls).toEqual([[CAMP, JABU]]);
  });

  it("is null for an artwork, before any membership is read", async () => {
    dbMock.queue(group(ARTWORK));
    stubs.permissions = { structuralRole: LEAD, rolePermissions: [] };
    expect(await store.loadMoneyAccess("art", ALICE)).toBeNull();
    expect(stubs.permissionCalls).toEqual([]);
  });

  it("marks the lead and a manage_money holder as money people, a member not", async () => {
    for (const [permissions, expected] of [
      [{ structuralRole: LEAD, rolePermissions: [] }, true],
      [
        { structuralRole: MEMBER, rolePermissions: [{ manage_money: true }] },
        true,
      ],
      [{ structuralRole: MEMBER, rolePermissions: [{}] }, false],
    ] as const) {
      dbMock.reset();
      dbMock.queue(group());
      stubs.permissions = permissions;
      const access = await store.loadMoneyAccess("mad-hatters", JABU);
      expect(access?.isMoneyPerson).toBe(expected);
    }
  });
});

const access = (isMoneyPerson: boolean, viewerUserId = JABU) => ({
  camp: {
    id: CAMP,
    name: "Mad Hatters",
    slug: "mad-hatters",
    kind: THEME_CAMP,
  },
  viewerUserId,
  membership: {
    structuralRole: isMoneyPerson ? LEAD : MEMBER,
    rolePermissions: [],
  },
  isMoneyPerson,
});
const EDITION_REF = { id: EDITION, year: 2027 };

describe("the money people's pages are closed to members", () => {
  it("returns null without reading a single row", async () => {
    expect(
      await store.loadMoneyBooksPage(access(false), EDITION_REF),
    ).toBeNull();
    expect(await store.loadDuesBoard(access(false), EDITION_REF)).toBeNull();
    expect(await store.loadClaimsBoard(access(false), EDITION_REF)).toBeNull();
    expect(
      await store.loadMemberPayments(access(false), EDITION_REF, JABU),
    ).toBeNull();
    expect(dbMock.queries).toHaveLength(0);
  });
});

describe("loadMemberMoney — a member sees their own and the totals", () => {
  it("reads only the viewer's dues, payments and claims, and never a payment note", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    const view = await store.loadMemberMoney(access(false), EDITION_REF);
    const ownReads = dbMock.queries.filter((q) =>
      [schema.memberDues, schema.duesPayments, schema.campClaims].some((t) =>
        q.calls.some((c) => c.method === "from" && c.args[0] === t),
      ),
    );
    // Every read of a per-person table is either the camp-wide SUM for the
    // totals or carries the viewer's id.
    const scoped = ownReads.filter((q) => boundStrings(q).includes(JABU));
    expect(scoped.length).toBeGreaterThanOrEqual(4);
    for (const q of ownReads) {
      const columns = Object.keys((q.arg("select") as object) ?? {});
      expect(columns).not.toContain("note");
      if (!boundStrings(q).includes(JABU)) {
        // camp-wide reads: amounts and statuses only
        for (const c of columns) {
          expect(["categoryId", "amountCents", "status", "total"]).toContain(c);
        }
      }
    }
    expect(view.receiptsEnabled).toBe(false);
    expect(Object.keys(view.totals).sort()).toEqual([
      "actualIncomeCents",
      "actualSpendCents",
      "committedSpendCents",
      "contingencyPct",
      "plannedSpendCents",
      "surplusCents",
    ]);
  });
});

// --- Budget writes ---------------------------------------------------------------

describe("money-people writes", () => {
  it("refuses a plain member and writes nothing", async () => {
    queueActor(JABU, MEMBER);
    expect(
      await store.setCampFee({
        ...base,
        actorUserId: JABU,
        defaultDuesCents: 1,
      }),
    ).toEqual({
      ok: false,
      error: "Only the camp's money people can do that.",
    });
    expect(moneyWrites()).toHaveLength(0);
    expect(auditRows()).toHaveLength(0);
  });

  it("refuses someone with no ACTIVE membership", async () => {
    queueActor(null);
    const result = await store.approveBudget({ ...base, actorUserId: JABU });
    expect(result.ok).toBe(false);
    const actorRead = dbMock.queries[0]!;
    expect(nullChecksOn(actorRead, schema.memberships.archivedAt)).toEqual([
      "is null",
    ]);
    expect(nullChecksOn(actorRead, schema.users.sanitizedAt)).toEqual([
      "is null",
    ]);
    // …held FOR SHARE on the membership AND the users row (erasure race).
    expect(actorRead.arg("for")).toBe("share");
    expect(moneyWrites()).toHaveLength(0);
  });

  it("lets a member through on a HELD manage_money role, not an unheld one", async () => {
    queueActor(LERATO, MEMBER, { manage_money: true, held: false });
    expect(
      (await store.approveBudget({ ...base, actorUserId: LERATO })).ok,
    ).toBe(false);

    dbMock.reset();
    queueActor(LERATO, MEMBER, { manage_money: true, held: true });
    dbMock.queue([], [budgetRow()], [{ id: "b" }], []);
    expect(await store.approveBudget({ ...base, actorUserId: LERATO })).toEqual(
      { ok: true },
    );
    expect(auditRows().map((a) => a.action)).toEqual([MONEY_AUDIT.approve]);
  });

  it("approves a draft once, by compare-and-set, with an audit row", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue(
      /* insert budget */ [],
      [budgetRow()],
      /* CAS */ [{ id: "b" }],
      /* audit */ [],
    );
    expect(await store.approveBudget({ ...base, actorUserId: ALICE })).toEqual({
      ok: true,
    });
    const update = dbMock
      .writesTo(schema.campBudgets)
      .find((q) => q.kind === "update")!;
    expect(update.tx).toBe(true);
    expect(whereParams(update)).toContain("draft");
    expect(update.arg("set")).toMatchObject({
      status: "approved",
      approvedByUserId: ALICE,
    });
    const [row] = auditRows();
    expect(row).toMatchObject({
      actorId: ALICE,
      action: MONEY_AUDIT.approve,
      subject: CAMP,
    });

    dbMock.reset();
    queueActor(ALICE, LEAD);
    dbMock.queue([], [budgetRow({ status: "approved" })]);
    expect(await store.approveBudget({ ...base, actorUserId: ALICE })).toEqual({
      ok: false,
      error: "The budget is already approved.",
    });
    expect(auditRows()).toHaveLength(0);
  });

  it("changes the camp fee, audits before/after and tells members on the fee after commit", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue(
      /* insert budget */ [],
      [budgetRow({ defaultDuesCents: 200_000 })],
      /* update */ [],
      /* audit */ [],
      /* members on the camp fee */ [{ userId: JABU }, { userId: ALICE }],
      /* notifications insert */ [],
    );
    expect(
      await store.setCampFee({
        ...base,
        actorUserId: ALICE,
        defaultDuesCents: 250_000,
      }),
    ).toEqual({ ok: true });
    expect(auditRows()[0]!.meta).toMatchObject({
      beforeCents: 200_000,
      afterCents: 250_000,
    });
    const notices = noticeRows();
    // The lead who made the change is not told about it.
    expect(notices.map((n) => n.userId)).toEqual([JABU]);
    expect(notices[0]!.kind).toBe(MONEY);
    const insert = dbMock.writesTo(schema.notifications)[0]!;
    expect(insert.tx).toBe(false);
  });
});

describe("ensureStarterCategories", () => {
  it("writes the starters only when it wins the compare-and-set", async () => {
    dbMock.queue(/* seeded? */ [], /* insert budget */ [], /* CAS lost */ []);
    await store.ensureStarterCategories(access(true, ALICE), EDITION_REF);
    expect(dbMock.writesTo(schema.budgetCategories)).toHaveLength(0);

    dbMock.reset();
    dbMock.queue([], [], [{ id: "b" }], /* insert */ [], /* audit */ []);
    await store.ensureStarterCategories(access(true, ALICE), EDITION_REF);
    const [insert] = dbMock.writesTo(schema.budgetCategories);
    const values = insert!.arg("values") as { systemKey: string | null }[];
    expect(values.filter((v) => v.systemKey === "dues")).toHaveLength(1);
    expect(auditRows().map((a) => a.action)).toEqual([
      MONEY_AUDIT.categoriesSeeded,
    ]);
    const cas = dbMock
      .writesTo(schema.campBudgets)
      .find((q) => q.kind === "update")!;
    expect(nullChecksOn(cas, schema.campBudgets.categoriesSeededAt)).toEqual([
      "is null",
    ]);
  });

  it("never seeds for a member who is not a money person", async () => {
    await store.ensureStarterCategories(access(false), EDITION_REF);
    expect(dbMock.queries).toHaveLength(0);
  });
});

// --- Dues ----------------------------------------------------------------------

describe("recordDuesPayment", () => {
  const fields = {
    userId: JABU,
    amountCents: 150_000,
    receivedOn: "2027-04-14",
    note: "EFT with reference MAH-M024",
  };

  it("records money received, audits it and tells the member what is left", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue(
      /* subject user */ [{ id: JABU, sanitizedAt: null }],
      /* subject membership */ [{ archivedAt: null }],
      /* insert */ [{ id: PAYMENT }],
      /* audit */ [],
      /* settings */ [
        {
          defaultDuesCents: 250_000,
          paymentInstructions: null,
          contingencyPct: 0,
          status: "draft",
          approvedAt: null,
          approvedByUserId: null,
          approverUsername: null,
          approverSanitizedAt: null,
        },
      ],
      /* override */ [],
      /* received so far */ [{ total: "250000" }],
      /* notification insert */ [],
    );
    expect(
      await store.recordDuesPayment({ ...base, actorUserId: ALICE, fields }),
    ).toEqual({
      ok: true,
      id: PAYMENT,
    });
    const insert = dbMock.writesTo(schema.duesPayments)[0]!;
    expect(insert.tx).toBe(true);
    expect(insert.arg("values")).toMatchObject({
      userId: JABU,
      amountCents: 150_000,
      recordedByUserId: ALICE,
    });
    // The audit row carries amounts and ids — never the note.
    const [row] = auditRows();
    expect(row!.action).toBe(MONEY_AUDIT.paymentRecord);
    expect(JSON.stringify(row!.meta)).not.toContain("MAH-M024");
    const [notice] = noticeRows();
    expect(notice).toMatchObject({ userId: JABU, kind: MONEY });
  });

  it("refuses a deleted account and writes nothing", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue([{ id: JABU, sanitizedAt: new Date() }]);
    expect(
      await store.recordDuesPayment({ ...base, actorUserId: ALICE, fields }),
    ).toEqual({
      ok: false,
      error: "That account has been deleted.",
    });
    expect(moneyWrites()).toHaveLength(0);
  });

  it("refuses someone who was never on this camp's books", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue(
      [{ id: JABU, sanitizedAt: null }],
      /* no membership */ [],
      [{ n: 0 }],
      [],
    );
    expect(
      (await store.recordDuesPayment({ ...base, actorUserId: ALICE, fields }))
        .ok,
    ).toBe(false);
    expect(moneyWrites()).toHaveLength(0);
  });

  it("refuses a treasurer (custom role) recording money in for themselves; writes nothing", async () => {
    queueActor(LERATO, MEMBER, { manage_money: true, held: true });
    expect(
      await store.recordDuesPayment({
        ...base,
        actorUserId: LERATO,
        fields: { ...fields, userId: LERATO },
      }),
    ).toEqual({
      ok: false,
      error: "You can't set or record your own dues. A lead does that for you.",
    });
    expect(moneyWrites()).toHaveLength(0);
    expect(auditRows()).toHaveLength(0);
  });

  it("refuses a treasurer (custom role) setting their own dues, waived or not; writes nothing", async () => {
    for (const amountCents of [0, 100, null]) {
      dbMock.reset();
      queueActor(LERATO, MEMBER, { manage_money: true, held: true });
      expect(
        await store.setMemberDues({
          ...base,
          actorUserId: LERATO,
          userId: LERATO,
          amountCents,
          reason: "Treasurer",
        }),
      ).toEqual({
        ok: false,
        error:
          "You can't set or record your own dues. A lead does that for you.",
      });
      expect(moneyWrites()).toHaveLength(0);
    }
  });

  it("refuses a plain member recording money for themselves", async () => {
    queueActor(JABU, MEMBER);
    expect(
      (await store.recordDuesPayment({ ...base, actorUserId: JABU, fields }))
        .ok,
    ).toBe(false);
    expect(moneyWrites()).toHaveLength(0);
  });
});

describe("deleteDuesPayment", () => {
  it("deletes only this camp's payment and audits what it was", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue(
      [
        {
          id: PAYMENT,
          userId: JABU,
          amountCents: 100_000,
          receivedOn: "2027-03-12",
          recordedByUserId: ALICE,
        },
      ],
      [],
    );
    expect(
      await store.deleteDuesPayment({
        ...base,
        actorUserId: ALICE,
        paymentId: PAYMENT,
      }),
    ).toEqual({ ok: true });
    const del = dbMock.writesTo(schema.duesPayments)[0]!;
    expect(boundStrings(del)).toEqual(
      expect.arrayContaining([PAYMENT, CAMP, EDITION]),
    );
    expect(auditRows()[0]).toMatchObject({
      action: MONEY_AUDIT.paymentDelete,
      meta: { amountCents: 100_000, userId: JABU },
    });
  });
});

// --- Claims ----------------------------------------------------------------------

const claimRow = (overrides: Record<string, unknown> = {}) => ({
  id: CLAIM,
  claimantUserId: JABU,
  status: SUBMITTED,
  categoryId: KITCHEN,
  amountCents: 184_000,
  receiptKey: null,
  ...overrides,
});
const kitchenRow = {
  id: KITCHEN,
  kind: "expense",
  name: "Kitchen & food",
  plannedCents: 0,
  systemKey: null,
  archivedAt: null,
  sort: 0,
};

describe("claim decisions", () => {
  it("approves someone else's claim by compare-and-set and tells the claimant after commit", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue(
      [claimRow()],
      [kitchenRow],
      /* CAS update */ [{ id: CLAIM }],
      /* audit */ [],
      /* claimant current? */ [{ id: M_JABU }],
      /* notification */ [],
    );
    expect(
      await store.approveClaim({
        ...base,
        actorUserId: ALICE,
        claimId: CLAIM,
        categoryId: null,
      }),
    ).toEqual({ ok: true });
    const lock = dbMock.queries.find((q) =>
      q.calls.some(
        (c) => c.method === "from" && c.args[0] === schema.campClaims,
      ),
    )!;
    expect(lock.arg("for")).toBe("update");
    expect(boundStrings(lock)).toEqual(
      expect.arrayContaining([CLAIM, CAMP, EDITION]),
    );
    const update = dbMock.writesTo(schema.campClaims)[0]!;
    expect(update.tx).toBe(true);
    // Compare-and-set: the WHERE names the status it decided from.
    expect(whereParams(update)).toEqual([CLAIM, SUBMITTED]);
    expect(update.arg("set")).toMatchObject({
      status: APPROVED,
      decidedByUserId: ALICE,
      categoryId: KITCHEN,
    });
    expect(auditRows()[0]).toMatchObject({
      action: MONEY_AUDIT.claimApprove,
      meta: { from: SUBMITTED, to: APPROVED, amountCents: 184_000 },
    });
    expect(noticeRows()).toEqual([
      expect.objectContaining({ userId: JABU, kind: MONEY }),
    ]);
  });

  it("NEVER lets the author decide their own claim — not even the lead", async () => {
    for (const run of [
      () =>
        store.approveClaim({
          ...base,
          actorUserId: ALICE,
          claimId: CLAIM,
          categoryId: null,
        }),
      () =>
        store.rejectClaim({
          ...base,
          actorUserId: ALICE,
          claimId: CLAIM,
          note: "No.",
        }),
      () =>
        store.markClaimRepaid({
          ...base,
          actorUserId: ALICE,
          claimId: CLAIM,
          repaidOn: "2027-04-14",
        }),
    ]) {
      dbMock.reset();
      queueActor(ALICE, LEAD);
      dbMock.queue(
        [claimRow({ claimantUserId: ALICE, status: SUBMITTED })],
        [kitchenRow],
      );
      const result = await run();
      expect(result.ok).toBe(false);
      expect(moneyWrites()).toHaveLength(0);
      expect(auditRows()).toHaveLength(0);
      expect(noticeRows()).toHaveLength(0);
    }
  });

  it("loses a race cleanly: the CAS updates nothing, so nothing is audited or sent", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue([claimRow()], /* CAS lost */ []);
    expect(
      await store.rejectClaim({
        ...base,
        actorUserId: ALICE,
        claimId: CLAIM,
        note: "Borrowing cables.",
      }),
    ).toEqual({
      ok: false,
      error: "That claim has already been decided — refresh to see it.",
    });
    expect(auditRows()).toHaveLength(0);
    expect(noticeRows()).toHaveLength(0);
  });

  it("refuses a plain member every decision", async () => {
    queueActor(LERATO, MEMBER);
    dbMock.queue([claimRow()]);
    expect(
      (
        await store.rejectClaim({
          ...base,
          actorUserId: LERATO,
          claimId: CLAIM,
          note: "x",
        })
      ).ok,
    ).toBe(false);
    expect(moneyWrites()).toHaveLength(0);
  });

  it("answers a claim of another camp like one that does not exist", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue(/* not in this camp */ []);
    expect(
      await store.approveClaim({
        ...base,
        actorUserId: ALICE,
        claimId: CLAIM,
        categoryId: null,
      }),
    ).toEqual({ ok: false, error: "That claim doesn't exist." });
  });
});

describe("submitClaim and withdrawClaim", () => {
  const fields = {
    categoryId: null,
    amountCents: 38_500,
    description: "Ice for the cooler boxes",
  };

  it("refuses a receipt gracefully when the deployment has no blob store — nothing stored, nothing written", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    const pdf = new TextEncoder().encode("%PDF-1.7 ...");
    const result = await store.submitClaim({
      ...base,
      actorUserId: JABU,
      fields,
      receipt: { bytes: pdf },
    });
    expect(result.ok).toBe(false);
    expect(stubs.stored).toEqual([]);
    expect(dbMock.transactions).toBe(0);
  });

  it("refuses a receipt that is not a photo or a PDF before storing anything", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "token");
    const svg = new TextEncoder().encode("<svg/>");
    const result = await store.submitClaim({
      ...base,
      actorUserId: JABU,
      fields,
      receipt: { bytes: svg },
    });
    expect(result).toEqual({
      ok: false,
      error: "Upload a photo (PNG, JPEG or WebP) or a PDF.",
    });
    expect(stubs.stored).toEqual([]);
  });

  it("files the claim as the caller and tells the money people, not the claimant", async () => {
    queueActor(JABU, MEMBER);
    dbMock.queue(
      /* insert */ [{ id: CLAIM }],
      /* audit */ [],
      /* members */ [
        { membershipId: M_ALICE, userId: ALICE, role: LEAD },
        { membershipId: M_JABU, userId: JABU, role: MEMBER },
        { membershipId: M_LERATO, userId: LERATO, role: MEMBER },
      ],
      /* roles */ [
        { id: "r-base", kind: "baseline", permissions: {} },
        {
          id: "r-treasurer",
          kind: "custom",
          permissions: { manage_money: true },
        },
      ],
      /* held */ [{ membershipId: M_LERATO, projectRoleId: "r-treasurer" }],
      /* notifications */ [],
    );
    expect(
      await store.submitClaim({ ...base, actorUserId: JABU, fields }),
    ).toEqual({
      ok: true,
      id: CLAIM,
    });
    const insert = dbMock.writesTo(schema.campClaims)[0]!;
    expect(insert.arg("values")).toMatchObject({
      claimantUserId: JABU,
      amountCents: 38_500,
      groupId: CAMP,
      editionId: EDITION,
    });
    expect(auditRows()[0]!.action).toBe(MONEY_AUDIT.claimSubmit);
    expect(JSON.stringify(auditRows()[0]!.meta)).not.toContain("cooler");
    expect(
      noticeRows()
        .map((n) => n.userId)
        .sort(),
    ).toEqual([ALICE, LERATO].sort());
  });

  it("deletes the stored receipt when the claim is refused", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "token");
    queueActor(null);
    const pdf = new TextEncoder().encode("%PDF-1.7 ...");
    const result = await store.submitClaim({
      ...base,
      actorUserId: JABU,
      fields,
      receipt: { bytes: pdf },
    });
    expect(result.ok).toBe(false);
    expect(stubs.stored).toHaveLength(1);
    expect(stubs.quietDeletes).toEqual([[CAMP, stubs.stored[0]]]);
  });

  it("lets only the author withdraw, and deletes the receipt after commit", async () => {
    queueActor(LERATO, MEMBER);
    dbMock.queue([claimRow()]);
    expect(
      await store.withdrawClaim({
        ...base,
        actorUserId: LERATO,
        claimId: CLAIM,
      }),
    ).toEqual({
      ok: false,
      error: "That isn't your claim.",
    });
    expect(moneyWrites()).toHaveLength(0);

    dbMock.reset();
    const key = `camp-receipts/${CAMP}/receipt-x.pdf`;
    queueActor(JABU, MEMBER);
    dbMock.queue(
      [claimRow({ receiptKey: key })],
      /* delete */ [],
      /* audit */ [],
    );
    expect(
      await store.withdrawClaim({ ...base, actorUserId: JABU, claimId: CLAIM }),
    ).toEqual({ ok: true });
    const del = dbMock.writesTo(schema.campClaims)[0]!;
    expect(del.kind).toBe("delete");
    expect(whereParams(del)).toEqual([CLAIM, SUBMITTED]);
    expect(auditRows()[0]!.action).toBe(MONEY_AUDIT.claimWithdraw);
    expect(stubs.quietDeletes).toEqual([[CAMP, key]]);
  });
});

describe("resolveReceiptForViewer", () => {
  const claimReceipt = {
    groupId: CAMP,
    receiptKey: `camp-receipts/${CAMP}/receipt-x.pdf`,
    receiptContentType: "application/pdf",
    claimantUserId: JABU,
  };

  it("opens a claim's receipt for its claimant and the money people, nobody else", async () => {
    for (const [viewer, permissions, expected] of [
      [JABU, { structuralRole: MEMBER, rolePermissions: [] }, true],
      [ALICE, { structuralRole: LEAD, rolePermissions: [] }, true],
      [LERATO, { structuralRole: MEMBER, rolePermissions: [] }, false],
      [LERATO, null, false],
    ] as const) {
      dbMock.reset();
      dbMock.queue([claimReceipt]);
      stubs.permissions = permissions;
      const found = await store.resolveReceiptForViewer({
        viewerUserId: viewer,
        kind: "claim",
        id: CLAIM,
      });
      expect([viewer, found !== null]).toEqual([viewer, expected]);
    }
  });

  it("refuses a stored type that is not a receipt type", async () => {
    dbMock.queue([{ ...claimReceipt, receiptContentType: "image/svg+xml" }]);
    stubs.permissions = { structuralRole: LEAD, rolePermissions: [] };
    expect(
      await store.resolveReceiptForViewer({
        viewerUserId: ALICE,
        kind: "claim",
        id: CLAIM,
      }),
    ).toBeNull();
  });
});
