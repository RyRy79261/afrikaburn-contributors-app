import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@quagga/db";
import { MONEY_AUDIT, MONEY_DELETED_ACCOUNT } from "@quagga/core";
import {
  CampClaimStatus,
  GroupKind,
  MembershipRole,
  NotificationKind,
} from "@quagga/types";
import { boundStrings, dbMock, uniqueViolation } from "@/test/db-mock";

// Camp money store — the loaders the money page renders from, and the writes
// camp-money-store.test.ts does not walk: settings, the plan, categories,
// entries, receipts, dues amounts and the remaining claim decisions. The
// same rules hold for every one: a refusal writes nothing, every write
// carries an audit row in its transaction, and an id is resolved inside the
// camp and edition the server named.

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

const stubs = vi.hoisted(() => ({
  stored: [] as string[],
  quietDeletes: [] as [string, string | null | undefined][],
}));

vi.mock("../roles-store", () => ({
  getMemberPermissions: async () => null,
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

const LEAD = MembershipRole.enum.lead;
const MEMBER = MembershipRole.enum.member;
const THEME_CAMP = GroupKind.enum.theme_camp;
const SUBMITTED = CampClaimStatus.enum.submitted;
const APPROVED = CampClaimStatus.enum.approved;
const REJECTED = CampClaimStatus.enum.rejected;
const REPAID = CampClaimStatus.enum.repaid;
const MONEY = NotificationKind.enum.money;

const CAMP = "11111111-0000-4000-8000-00000000000a";
const EDITION = "eeeeeeee-0000-4000-8000-000000000001";
const ALICE = "aaaaaaaa-0000-4000-8000-000000000001"; // lead
const JABU = "aaaaaaaa-0000-4000-8000-000000000002"; // member
const LERATO = "aaaaaaaa-0000-4000-8000-000000000003"; // former member
const PIETER = "aaaaaaaa-0000-4000-8000-000000000004"; // left, books name him
const THANDI = "aaaaaaaa-0000-4000-8000-000000000005"; // former, owes nothing
const CLAIM = "c1c1c1c1-0000-4000-8000-000000000001";
const KITCHEN = "ca7ca7ca-0000-4000-8000-000000000001";
const DUES_CAT = "ca7ca7ca-0000-4000-8000-000000000002";
const OLD_CAT = "ca7ca7ca-0000-4000-8000-000000000003";
const ENTRY = "e1e1e1e1-0000-4000-8000-000000000001";
const NEW_CAT = "ca7ca7ca-0000-4000-8000-000000000009";

const actorRow = (userId: string, role: MembershipRole) => ({
  membershipId: `m-${userId}`,
  userId,
  role,
  username: userId === ALICE ? "alice" : "jabu",
  groupKind: THEME_CAMP,
  groupName: "Mad Hatters",
  groupSlug: "mad-hatters",
});
const roleRows = [{ kind: "baseline", permissions: {}, heldBy: null }];

/** Queue the actor lock (membership + users FOR SHARE) and their roles. */
function queueActor(userId: string | null, role: MembershipRole = MEMBER) {
  if (userId === null) dbMock.queue([]);
  else dbMock.queue([actorRow(userId, role)], roleRows);
}

const budgetRow = (overrides: Record<string, unknown> = {}) => ({
  id: "b0b0b0b0-0000-4000-8000-000000000001",
  defaultDuesCents: 250_000,
  paymentInstructions: null,
  contingencyPct: 5,
  status: "draft",
  ...overrides,
});
const settingsRow = (overrides: Record<string, unknown> = {}) => ({
  defaultDuesCents: 250_000,
  paymentInstructions: "EFT to the camp",
  contingencyPct: 5,
  status: "approved",
  approvedAt: new Date("2027-03-03T10:00:00Z"),
  approvedByUserId: ALICE,
  approverUsername: "alice",
  approverSanitizedAt: null,
  ...overrides,
});
const category = (overrides: Record<string, unknown> = {}) => ({
  id: KITCHEN,
  kind: "expense",
  name: "Kitchen & food",
  plannedCents: 1_000_000,
  systemKey: null,
  archivedAt: null,
  sort: 0,
  ...overrides,
});
const duesCategory = category({
  id: DUES_CAT,
  kind: "income",
  name: "Camp dues",
  plannedCents: 0,
  systemKey: "dues",
  sort: 1,
});

const base = { groupId: CAMP, editionId: EDITION };
const EDITION_REF = { id: EDITION, year: 2027 };
const access = (isMoneyPerson: boolean, viewerUserId = ALICE) => ({
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

const auditRows = () =>
  dbMock
    .writesTo(schema.auditEvents)
    .map(
      (q) =>
        q.arg("values") as { action: string; meta: Record<string, unknown> },
    );
const noticeRows = () =>
  dbMock.writesTo(schema.notifications).flatMap(
    (q) =>
      q.arg("values") as {
        userId: string;
        kind: string;
        title: string;
        body: string;
      }[],
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
const PDF = new TextEncoder().encode("%PDF-1.7 receipt");

beforeEach(() => {
  dbMock.reset();
  stubs.stored = [];
  stubs.quietDeletes = [];
});
afterEach(() => vi.unstubAllEnvs());

// --- Loaders --------------------------------------------------------------------

describe("getMoneyTileSummary", () => {
  it("gives the totals, the viewer's own outstanding, and claims to decide that are not theirs", async () => {
    dbMock.queue(
      [settingsRow()],
      /* categories */ [category(), duesCategory],
      /* entries */ [
        { categoryId: KITCHEN, amountCents: 300_000, status: "paid" },
      ],
      /* claims */ [],
      /* dues received */ [{ total: "100000" }],
      /* current members */ [{ n: 4 }],
      /* own override */ [],
      /* own received */ [{ total: "0" }],
      /* claims to decide */ [{ n: 2 }],
    );
    const tile = await store.getMoneyTileSummary(access(true), EDITION_REF);
    expect(tile).toMatchObject({
      ownOutstandingCents: 250_000,
      ownStatus: "awaiting",
      claimsToDecide: 2,
    });
    expect(tile.totals).toMatchObject({
      plannedSpendCents: 1_000_000,
      actualSpendCents: 300_000,
      actualIncomeCents: 100_000,
    });
    // The "to decide" count leaves out the viewer's own claims.
    expect(boundStrings(dbMock.queries.at(-1)!)).toContain(ALICE);
    expect(dbMock.pending).toBe(0);
  });

  it("a member gets no claims count at all", async () => {
    const tile = await store.getMoneyTileSummary(
      access(false, JABU),
      EDITION_REF,
    );
    expect(tile.claimsToDecide).toBeNull();
    expect(tile.ownStatus).toBe("no_fee");
  });
});

describe("loadMemberMoney with rows", () => {
  it("shows the member's own waiver, ref code, money in and decided claims", async () => {
    dbMock.queue(
      [settingsRow()],
      [
        category(),
        duesCategory,
        category({ id: OLD_CAT, archivedAt: new Date() }),
      ],
      [],
      [],
      [{ total: "0" }],
      [{ n: 3 }],
      /* own override */ [{ amountCents: 0, reason: "Runs the build crew" }],
      /* own received */ [{ total: "0" }],
      /* membership */ [{ refCode: "MAH-M024" }],
      /* payments */ [
        {
          id: "p1",
          receivedOn: "2027-03-12",
          amountCents: 100_000,
          recordedByUserId: ALICE,
        },
      ],
      /* claims */ [
        {
          id: CLAIM,
          categoryId: KITCHEN,
          amountCents: 120_000,
          description: "Trailer hire",
          status: APPROVED,
          receiptContentType: "application/pdf",
          decidedAt: new Date("2027-04-06T10:00:00Z"),
          decidedByUserId: ALICE,
          decisionNote: null,
          repaidOn: null,
          createdAt: new Date("2027-04-01T10:00:00Z"),
        },
      ],
      /* names */ [{ id: ALICE, username: "alice", sanitizedAt: null }],
    );
    const view = await store.loadMemberMoney(access(false, JABU), EDITION_REF);
    expect(view.ownDues).toMatchObject({
      reason: "Runs the build crew",
      refCode: "MAH-M024",
      figures: { status: "waived", owedCents: 0 },
    });
    expect(view.ownDues.payments[0]!.recordedByName).toBe("alice");
    expect(view.ownClaims[0]).toMatchObject({
      categoryName: "Kitchen & food",
      receiptLabel: "PDF",
      decidedByName: "alice",
      mayWithdraw: false,
    });
    // Live SPENDING categories only: not dues (income), not archived.
    expect(view.claimCategories).toEqual([
      { id: KITCHEN, name: "Kitchen & food" },
    ]);
    expect(view.paymentInstructions).toBe("EFT to the camp");
    expect(dbMock.pending).toBe(0);
  });
});

describe("loadMoneyBooksPage", () => {
  it("does not re-seed a seeded camp, and names who entered what", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "token");
    dbMock.queue(
      /* seeded already */ [{ seededAt: new Date() }],
      [settingsRow({ status: "draft", approvedAt: null })],
      [category(), duesCategory],
      [],
      [],
      [{ total: "0" }],
      [{ n: 3 }],
      /* entries */ [
        {
          id: ENTRY,
          categoryId: KITCHEN,
          amountCents: 320_000,
          entryDate: "2027-04-09",
          description: "Bulk dry goods",
          status: "paid",
          receiptContentType: "image/jpeg",
          enteredByUserId: ALICE,
          createdAt: new Date(),
        },
        {
          id: "e2",
          categoryId: "no-longer-loaded",
          amountCents: 1,
          entryDate: "2027-04-01",
          description: "Orphan",
          status: "committed",
          receiptContentType: null,
          enteredByUserId: null,
          createdAt: new Date(),
        },
      ],
      /* names */ [{ id: ALICE, username: "alice", sanitizedAt: null }],
    );
    const page = await store.loadMoneyBooksPage(access(true), EDITION_REF);
    expect(page!.settings.approvedByName).toBeNull();
    expect(page!.receiptsEnabled).toBe(true);
    expect(page!.entries[0]).toMatchObject({
      categoryName: "Kitchen & food",
      kind: "expense",
      receiptLabel: "JPG",
      enteredByName: "alice",
    });
    expect(page!.entries[1]).toMatchObject({
      categoryName: "",
      enteredByName: null,
      receiptLabel: null,
    });
    expect(dbMock.writesTo(schema.budgetCategories)).toHaveLength(0);
    expect(dbMock.pending).toBe(0);
  });
});

describe("loadDuesBoard", () => {
  it("lists current members, former members and deleted accounts the books name — not former members who owe nothing", async () => {
    dbMock.queue(
      [settingsRow()],
      /* memberships, archived included */ [
        {
          userId: ALICE,
          refCode: "MAH-M017",
          archivedAt: null,
          username: "alice",
          sanitizedAt: null,
        },
        {
          userId: JABU,
          refCode: "MAH-M024",
          archivedAt: null,
          username: "jabu",
          sanitizedAt: null,
        },
        {
          userId: LERATO,
          refCode: "MAH-M008",
          archivedAt: new Date(),
          username: "lerato",
          sanitizedAt: null,
        },
        {
          userId: THANDI,
          refCode: "MAH-M011",
          archivedAt: new Date(),
          username: "thandi",
          sanitizedAt: null,
        },
      ],
      /* overrides */ [
        { userId: LERATO, amountCents: 100_000, reason: "Left in March" },
        { userId: null, amountCents: 50_000, reason: null },
      ],
      /* received */ [
        { userId: JABU, total: "100000" },
        { userId: PIETER, total: "250000" },
      ],
      /* names of people with no membership left */ [
        { id: PIETER, username: "pieter", sanitizedAt: null },
      ],
    );
    const board = await store.loadDuesBoard(access(true), EDITION_REF);
    const rows = board!.rows.map((r) => [r.name, r.standing, r.figures.status]);
    expect(rows).toEqual([
      ["alice", "current", "awaiting"],
      ["jabu", "current", "part_paid"],
      ["lerato", "former", "awaiting"],
      ["pieter", "former", "paid"],
      [MONEY_DELETED_ACCOUNT, "deleted", "awaiting"],
    ]);
    expect(board!.rows.find((r) => r.name === "lerato")!.reason).toBe(
      "Left in March",
    );
    // the viewer is the lead: every row, their own included, is theirs to edit
    expect(board!.rows.every((r) => r.canEdit)).toBe(true);
    expect(board!.summary).toMatchObject({
      memberCount: 5,
      currentCount: 2,
      formerCount: 3,
    });
    expect(dbMock.pending).toBe(0);
  });

  it("a treasurer through a custom role gets no actions on their own row", async () => {
    const member = (userId: string, username: string) => ({
      userId,
      refCode: null,
      archivedAt: null,
      username,
      sanitizedAt: null,
    });
    dbMock.queue(
      [settingsRow()],
      [member(ALICE, "alice"), member(JABU, "jabu")],
      [],
      [],
      [],
    );
    const board = await store.loadDuesBoard(
      {
        ...access(true, JABU),
        membership: {
          structuralRole: MEMBER,
          rolePermissions: [{ manage_money: true }],
        },
      },
      EDITION_REF,
    );
    const canEdit = Object.fromEntries(
      board!.rows.map((r) => [r.name, r.canEdit]),
    );
    expect(canEdit).toEqual({ alice: true, jabu: false });
  });
});

describe("loadClaimsBoard", () => {
  it("never offers the author a decision on their own claim", async () => {
    const claim = (id: string, claimant: string | null, status: string) => ({
      id,
      claimantUserId: claimant,
      categoryId: KITCHEN,
      amountCents: 38_000,
      description: claimant ? "Fairy lights" : null,
      status,
      receiptContentType: null,
      decidedAt: status === SUBMITTED ? null : new Date(),
      decidedByUserId: status === SUBMITTED ? null : ALICE,
      decisionNote: status === REJECTED ? "Borrowing them" : null,
      repaidOn: status === REPAID ? "2027-03-28" : null,
      createdAt: new Date(),
    });
    dbMock.queue(
      /* seeded already */ [{ seededAt: new Date() }],
      [category()],
      [
        claim("own", ALICE, SUBMITTED),
        claim("theirs", JABU, SUBMITTED),
        claim("approved", JABU, APPROVED),
        claim("gone", null, REPAID),
        claim("rejected", JABU, REJECTED),
        claim("own-rejected", ALICE, REJECTED),
        claim("own-repaid", ALICE, REPAID),
      ],
      [
        { id: ALICE, username: "alice", sanitizedAt: null },
        { id: JABU, username: "jabu", sanitizedAt: null },
      ],
    );
    const claims = (await store.loadClaimsBoard(access(true), EDITION_REF))!;
    const by = (id: string) => claims.find((c) => c.id === id)!;
    expect(by("own")).toMatchObject({
      isOwn: true,
      mayDecide: false,
      mayWithdraw: true,
    });
    expect(by("theirs")).toMatchObject({ isOwn: false, mayDecide: true });
    expect(by("approved")).toMatchObject({
      mayMarkRepaid: true,
      mayDecide: false,
    });
    expect(by("gone").claimantName).toBe(MONEY_DELETED_ACCOUNT);
    // the corrections: offered on someone else's, never on the viewer's own
    expect(by("rejected")).toMatchObject({
      mayReopen: true,
      mayUndoRepaid: false,
      mayDecide: false,
    });
    expect(by("gone")).toMatchObject({ mayUndoRepaid: true, mayReopen: false });
    expect(by("own-rejected")).toMatchObject({ isOwn: true, mayReopen: false });
    expect(by("own-repaid")).toMatchObject({
      isOwn: true,
      mayUndoRepaid: false,
    });
    expect(by("approved")).toMatchObject({
      mayReopen: false,
      mayUndoRepaid: false,
    });
  });

  // Regression (e2e camp-money, 14 Oct 2026): a money person who went
  // straight to Dues or Claims never opened Budget, so the camp had no
  // categories — the New claim picker was empty and no claim could be
  // approved. The claims board loads on every money tab, so it seeds.
  it("writes the starter categories when no money person has opened Budget", async () => {
    dbMock.queue(
      /* seeded? */ [],
      /* insert budget */ [],
      /* CAS won */ [{ id: "b" }],
      /* insert categories */ [],
      /* audit */ [],
      /* categories */ [category()],
      /* claims */ [],
    );
    const claims = await store.loadClaimsBoard(access(true), EDITION_REF);
    expect(claims).toEqual([]);
    expect(dbMock.writesTo(schema.budgetCategories)).toHaveLength(1);
    expect(dbMock.pending).toBe(0);
  });

  it("seeds nothing for a member who is not a money person", async () => {
    expect(await store.loadClaimsBoard(access(false), EDITION_REF)).toBeNull();
    expect(dbMock.queries).toHaveLength(0);
  });
});

describe("loadMemberPayments", () => {
  it("gives a money person one member's money in, notes included", async () => {
    dbMock.queue(
      [
        {
          id: "p1",
          receivedOn: "2027-03-12",
          amountCents: 100_000,
          note: "EFT MAH-M024",
          recordedByUserId: ALICE,
          createdAt: new Date(),
        },
      ],
      [{ id: ALICE, username: "alice", sanitizedAt: null }],
    );
    const rows = await store.loadMemberPayments(
      access(true),
      EDITION_REF,
      JABU,
    );
    expect(rows).toEqual([
      expect.objectContaining({
        note: "EFT MAH-M024",
        recordedByName: "alice",
      }),
    ]);
    expect(boundStrings(dbMock.queries[0]!)).toEqual(
      expect.arrayContaining([CAMP, EDITION, JABU]),
    );
  });
});

// --- Settings and the plan ------------------------------------------------------------

describe("budget settings", () => {
  it("writes the payment instructions with an audit row", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue([], [budgetRow()], [], []);
    expect(
      await store.setPaymentInstructions({
        ...base,
        actorUserId: ALICE,
        paymentInstructions: "EFT to Mad Hatters Camp",
      }),
    ).toEqual({ ok: true });
    expect(
      dbMock
        .writesTo(schema.campBudgets)
        .find((q) => q.kind === "update")!
        .arg("set"),
    ).toMatchObject({ paymentInstructions: "EFT to Mad Hatters Camp" });
    expect(auditRows()[0]).toMatchObject({
      action: MONEY_AUDIT.instructions,
      meta: { cleared: false },
    });
  });

  it("a camp fee put back to R 0,00 tells members on it 'no fee set', never 'waived'", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue(
      [],
      [budgetRow({ defaultDuesCents: 150_000 })],
      /* update */ [],
      /* audit */ [],
      /* on the camp fee */ [{ userId: JABU }, { userId: ALICE }],
      /* notices */ [],
    );
    expect(
      await store.setCampFee({
        ...base,
        actorUserId: ALICE,
        defaultDuesCents: 0,
      }),
    ).toEqual({ ok: true });
    const notices = noticeRows();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ userId: JABU, kind: MONEY });
    expect(notices[0]!.title).not.toMatch(/waived/i);
    expect(notices[0]!.title).toMatch(/hasn't set its fee/);
  });

  it("a camp fee that did not change writes nothing", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue([], [budgetRow()]);
    expect(
      await store.setCampFee({
        ...base,
        actorUserId: ALICE,
        defaultDuesCents: 250_000,
      }),
    ).toEqual({ ok: true });
    expect(auditRows()).toHaveLength(0);
    expect(
      dbMock.writesTo(schema.campBudgets).filter((q) => q.kind === "update"),
    ).toHaveLength(0);
  });

  it("saves the plan: changed lines and the contingency, one audit row with before and after", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue(
      [],
      [budgetRow()],
      [category({ plannedCents: 0 }), duesCategory],
      /* kitchen update */ [],
      /* contingency update */ [],
      /* audit */ [],
    );
    expect(
      await store.setBudgetPlan({
        ...base,
        actorUserId: ALICE,
        contingencyPct: 10,
        lines: [
          { categoryId: KITCHEN, plannedCents: 1_400_000 },
          { categoryId: DUES_CAT, plannedCents: 0 },
        ],
      }),
    ).toEqual({ ok: true });
    expect(auditRows()[0]).toMatchObject({
      action: MONEY_AUDIT.plan,
      meta: {
        contingencyBefore: 5,
        contingencyAfter: 10,
        lines: [{ categoryId: KITCHEN, beforeCents: 0, afterCents: 1_400_000 }],
      },
    });
    expect(dbMock.pending).toBe(0);
  });

  it("refuses a plan line for a category that is gone or archived, writing nothing", async () => {
    for (const [cats, error] of [
      [[], "That category doesn't exist any more."],
      [
        [category({ archivedAt: new Date() })],
        "That category was removed. Pick another.",
      ],
    ] as const) {
      dbMock.reset();
      queueActor(ALICE, LEAD);
      dbMock.queue([], [budgetRow()], cats);
      expect(
        await store.setBudgetPlan({
          ...base,
          actorUserId: ALICE,
          contingencyPct: 5,
          lines: [{ categoryId: KITCHEN, plannedCents: 1 }],
        }),
      ).toEqual({ ok: false, error });
      expect(moneyWrites().filter((q) => q.kind === "update")).toHaveLength(0);
      expect(auditRows()).toHaveLength(0);
    }
  });
});

// --- Categories ----------------------------------------------------------------

describe("categories", () => {
  const add = (name = "Art car fuel") =>
    store.addBudgetCategory({
      ...base,
      actorUserId: ALICE,
      kind: "expense",
      name,
      plannedCents: 0,
    });

  it("adds a category at the end of the list, audited", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue(
      [],
      [budgetRow()],
      [category({ sort: 4 })],
      [{ id: NEW_CAT }],
      [],
    );
    expect(await add()).toEqual({ ok: true, id: NEW_CAT });
    expect(
      dbMock.writesTo(schema.budgetCategories)[0]!.arg("values"),
    ).toMatchObject({
      name: "Art car fuel",
      nameNormalized: "art car fuel",
      sort: 5,
      groupId: CAMP,
    });
    expect(auditRows()[0]!.action).toBe(MONEY_AUDIT.categoryAdd);
  });

  it("refuses a name already taken (in any case), and too many categories", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue([], [budgetRow()], [category()]);
    expect(await add("KITCHEN & food")).toEqual({
      ok: false,
      error: "There's already a category with that name.",
    });
    dbMock.reset();
    queueActor(ALICE, LEAD);
    dbMock.queue(
      [],
      [budgetRow()],
      Array.from({ length: 40 }, (_, i) =>
        category({ id: `c${i}`, name: `C${i}` }),
      ),
    );
    expect(await add()).toEqual({
      ok: false,
      error: "That's the most categories a budget can have.",
    });
    expect(dbMock.writesTo(schema.budgetCategories)).toHaveLength(0);
  });

  it("a unique-index race reads as the name being taken; any other failure is thrown", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue([], [budgetRow()], [], uniqueViolation());
    expect(await add()).toEqual({
      ok: false,
      error: "There's already a category with that name.",
    });
    dbMock.reset();
    queueActor(ALICE, LEAD);
    dbMock.queue([], [budgetRow()], [], new Error("connection reset"));
    await expect(add()).rejects.toThrow("connection reset");
  });

  it("renames a live category of this camp; refuses a missing or archived one", async () => {
    const rename = () =>
      store.renameBudgetCategory({
        ...base,
        actorUserId: ALICE,
        categoryId: KITCHEN,
        name: "Kitchen",
      });
    queueActor(ALICE, LEAD);
    dbMock.queue([category()], [category()], [], []);
    expect(await rename()).toEqual({ ok: true });
    expect(auditRows()[0]!.action).toBe(MONEY_AUDIT.categoryRename);

    for (const [lock, error] of [
      [[], "That category doesn't exist any more."],
      [
        [category({ archivedAt: new Date() })],
        "That category was removed. Pick another.",
      ],
    ] as const) {
      dbMock.reset();
      queueActor(ALICE, LEAD);
      dbMock.queue(lock);
      expect(await rename()).toEqual({ ok: false, error });
      expect(auditRows()).toHaveLength(0);
    }

    dbMock.reset();
    queueActor(ALICE, LEAD);
    dbMock.queue([category()], [category()], uniqueViolation());
    expect(await rename()).toEqual({
      ok: false,
      error: "There's already a category with that name.",
    });
    dbMock.reset();
    queueActor(ALICE, LEAD);
    dbMock.queue([category()], [category()], new Error("boom"));
    await expect(rename()).rejects.toThrow("boom");
  });

  it("deletes an unused category, archives a used one, never removes camp dues", async () => {
    const remove = () =>
      store.removeBudgetCategory({
        ...base,
        actorUserId: ALICE,
        categoryId: KITCHEN,
      });
    const row = {
      id: KITCHEN,
      systemKey: null,
      archivedAt: null,
      plannedCents: 5,
    };

    queueActor(ALICE, LEAD);
    dbMock.queue([row], /* entries */ [], /* claims */ [], [], []);
    expect(await remove()).toEqual({ ok: true, action: "delete" });
    expect(dbMock.writesTo(schema.budgetCategories)[0]!.kind).toBe("delete");
    expect(auditRows()[0]!.action).toBe(MONEY_AUDIT.categoryDelete);

    dbMock.reset();
    queueActor(ALICE, LEAD);
    dbMock.queue([row], [{ id: ENTRY }], [], [], []);
    expect(await remove()).toEqual({ ok: true, action: "archive" });
    expect(dbMock.writesTo(schema.budgetCategories)[0]!.kind).toBe("update");
    expect(auditRows()[0]!.action).toBe(MONEY_AUDIT.categoryArchive);

    dbMock.reset();
    queueActor(ALICE, LEAD);
    dbMock.queue([{ ...row, systemKey: "dues" }], [], []);
    expect((await remove()).ok).toBe(false);
    dbMock.reset();
    queueActor(ALICE, LEAD);
    dbMock.queue([]);
    expect(await remove()).toEqual({
      ok: false,
      error: "That category doesn't exist any more.",
    });
    expect(dbMock.writesTo(schema.budgetCategories)).toHaveLength(0);
  });
});

// --- Entries ----------------------------------------------------------------------

describe("entries", () => {
  const fields = {
    categoryId: KITCHEN,
    amountCents: 64_000,
    entryDate: "2027-04-12",
    description: "Ice and fresh veg, Ceres",
    status: "paid" as "paid" | "committed",
  };

  it("adds an entry with its receipt, audited without the description", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "token");
    queueActor(ALICE, LEAD);
    dbMock.queue([category()], [{ id: ENTRY }], []);
    expect(
      await store.addBudgetEntry({
        ...base,
        actorUserId: ALICE,
        fields,
        receipt: { bytes: PDF },
      }),
    ).toEqual({ ok: true, id: ENTRY });
    expect(
      dbMock.writesTo(schema.budgetEntries)[0]!.arg("values"),
    ).toMatchObject({
      receiptKey: stubs.stored[0],
      receiptContentType: "application/pdf",
      enteredByUserId: ALICE,
    });
    expect(auditRows()[0]!.meta).toMatchObject({
      receipt: true,
      amountCents: 64_000,
    });
    expect(JSON.stringify(auditRows()[0]!.meta)).not.toContain("Ceres");
    // Nothing to clean up on success.
    expect(stubs.quietDeletes).toEqual([]);
  });

  it("refuses an entry under camp dues, and deletes the receipt it stored", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "token");
    queueActor(ALICE, LEAD);
    dbMock.queue([duesCategory]);
    expect(
      await store.addBudgetEntry({
        ...base,
        actorUserId: ALICE,
        fields: { ...fields, categoryId: DUES_CAT },
        receipt: { bytes: PDF },
      }),
    ).toEqual({
      ok: false,
      error: "Record dues from the Dues tab, so they aren't counted twice.",
    });
    expect(dbMock.writesTo(schema.budgetEntries)).toHaveLength(0);
    expect(stubs.quietDeletes).toEqual([[CAMP, stubs.stored[0]]]);
  });

  it("a failed write deletes the stored receipt and throws", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "token");
    queueActor(ALICE, LEAD);
    dbMock.queue([category()], new Error("connection reset"));
    await expect(
      store.addBudgetEntry({
        ...base,
        actorUserId: ALICE,
        fields,
        receipt: { bytes: PDF },
      }),
    ).rejects.toThrow("connection reset");
    expect(stubs.quietDeletes).toEqual([[CAMP, stubs.stored[0]]]);
  });

  it("corrects an entry, audited before and after; refuses a missing one and committed income", async () => {
    const update = (f: Partial<typeof fields> = {}) =>
      store.updateBudgetEntry({
        ...base,
        actorUserId: ALICE,
        fields: { entryId: ENTRY, ...fields, ...f },
      });
    queueActor(ALICE, LEAD);
    dbMock.queue(
      [
        {
          id: ENTRY,
          categoryId: KITCHEN,
          amountCents: 60_000,
          status: "committed",
          entryDate: "2027-04-10",
        },
      ],
      [category()],
      [],
      [],
    );
    expect(await update()).toEqual({ ok: true });
    expect(auditRows()[0]).toMatchObject({
      action: MONEY_AUDIT.entryUpdate,
      meta: {
        before: { amountCents: 60_000, status: "committed" },
        after: { amountCents: 64_000, status: "paid" },
      },
    });

    dbMock.reset();
    queueActor(ALICE, LEAD);
    dbMock.queue([]);
    expect(await update()).toEqual({
      ok: false,
      error: "That entry doesn't exist.",
    });

    dbMock.reset();
    queueActor(ALICE, LEAD);
    dbMock.queue(
      [
        {
          id: ENTRY,
          categoryId: KITCHEN,
          amountCents: 1,
          status: "paid",
          entryDate: "2027-04-10",
        },
      ],
      [category({ kind: "income", name: "Fundraising" })],
    );
    expect(await update({ status: "committed" })).toEqual({
      ok: false,
      error: "Income is recorded once it is received.",
    });
    expect(
      dbMock.writesTo(schema.budgetEntries).filter((q) => q.kind === "update"),
    ).toHaveLength(0);
  });

  it("corrects an entry in a removed category in place; refuses moving one into it", async () => {
    const before = {
      id: ENTRY,
      categoryId: OLD_CAT,
      amountCents: 500_000,
      status: "committed",
      entryDate: "2027-04-10",
    };
    const archived = category({
      id: OLD_CAT,
      name: "Sound",
      archivedAt: new Date("2027-04-01T00:00:00Z"),
    });
    queueActor(ALICE, LEAD);
    dbMock.queue([before], [archived], [], []);
    expect(
      await store.updateBudgetEntry({
        ...base,
        actorUserId: ALICE,
        fields: { entryId: ENTRY, ...fields, categoryId: OLD_CAT },
      }),
    ).toEqual({ ok: true });
    expect(
      dbMock
        .writesTo(schema.budgetEntries)
        .find((q) => q.kind === "update")!
        .arg("set"),
    ).toMatchObject({ categoryId: OLD_CAT, status: "paid" });

    dbMock.reset();
    queueActor(ALICE, LEAD);
    dbMock.queue([{ ...before, categoryId: KITCHEN }], [archived]);
    expect(
      await store.updateBudgetEntry({
        ...base,
        actorUserId: ALICE,
        fields: { entryId: ENTRY, ...fields, categoryId: OLD_CAT },
      }),
    ).toEqual({ ok: false, error: "That category was removed. Pick another." });
    expect(
      dbMock.writesTo(schema.budgetEntries).filter((q) => q.kind === "update"),
    ).toHaveLength(0);
  });

  it("deletes an entry (audited) and its receipt after commit", async () => {
    const key = `camp-receipts/${CAMP}/receipt-x.pdf`;
    queueActor(ALICE, LEAD);
    dbMock.queue(
      [
        {
          id: ENTRY,
          categoryId: KITCHEN,
          amountCents: 1,
          status: "paid",
          entryDate: "2027-04-10",
          receiptKey: key,
        },
      ],
      [],
    );
    expect(
      await store.deleteBudgetEntry({
        ...base,
        actorUserId: ALICE,
        entryId: ENTRY,
      }),
    ).toEqual({ ok: true });
    expect(auditRows()[0]!.action).toBe(MONEY_AUDIT.entryDelete);
    expect(stubs.quietDeletes).toEqual([[CAMP, key]]);

    dbMock.reset();
    stubs.quietDeletes = [];
    queueActor(ALICE, LEAD);
    dbMock.queue([]);
    expect(
      await store.deleteBudgetEntry({
        ...base,
        actorUserId: ALICE,
        entryId: ENTRY,
      }),
    ).toEqual({ ok: false, error: "That entry doesn't exist." });
    expect(stubs.quietDeletes).toEqual([]);
  });
});

// --- Receipts on existing records ---------------------------------------------------

describe("attachReceipt", () => {
  beforeEach(() => vi.stubEnv("BLOB_READ_WRITE_TOKEN", "token"));
  const attach = (actorUserId: string, kind: "entry" | "claim", id = ENTRY) =>
    store.attachReceipt({
      ...base,
      actorUserId,
      kind,
      id,
      receipt: { bytes: PDF },
    });

  it("replaces an entry's receipt for a money person, deleting the old one after commit", async () => {
    const old = `camp-receipts/${CAMP}/receipt-old.pdf`;
    queueActor(ALICE, LEAD);
    dbMock.queue([{ id: ENTRY, receiptKey: old }], [], []);
    expect(await attach(ALICE, "entry")).toEqual({ ok: true });
    expect(auditRows()[0]).toMatchObject({
      action: MONEY_AUDIT.receiptAttach,
      meta: { kind: "entry", replaced: true },
    });
    expect(stubs.quietDeletes).toEqual([[CAMP, old]]);
  });

  it("refuses a plain member on an entry, and drops the stored file", async () => {
    queueActor(JABU, MEMBER);
    expect((await attach(JABU, "entry")).ok).toBe(false);
    expect(stubs.quietDeletes).toEqual([[CAMP, stubs.stored[0]]]);
    expect(moneyWrites()).toHaveLength(0);
  });

  it("lets a claimant add one to their OWN waiting claim — nobody else's, not after a decision", async () => {
    const claim = (o: Record<string, unknown>) => [
      {
        id: CLAIM,
        claimantUserId: JABU,
        status: SUBMITTED,
        receiptKey: null,
        ...o,
      },
    ];
    queueActor(JABU, MEMBER);
    dbMock.queue(claim({}), [], []);
    expect(await attach(JABU, "claim", CLAIM)).toEqual({ ok: true });

    for (const [rows, error] of [
      [claim({ claimantUserId: ALICE }), "That isn't your claim."],
      [
        claim({ status: APPROVED }),
        "That claim has already been decided — refresh to see it.",
      ],
      [[], "That claim doesn't exist."],
    ] as const) {
      dbMock.reset();
      queueActor(JABU, MEMBER);
      dbMock.queue(rows);
      expect(await attach(JABU, "claim", CLAIM)).toEqual({ ok: false, error });
      expect(moneyWrites()).toHaveLength(0);
    }
  });

  it("refuses a former member and a missing entry", async () => {
    queueActor(null);
    expect(await attach(JABU, "claim", CLAIM)).toEqual({
      ok: false,
      error: "You're not a member of this camp.",
    });
    dbMock.reset();
    queueActor(ALICE, LEAD);
    dbMock.queue([]);
    expect(await attach(ALICE, "entry")).toEqual({
      ok: false,
      error: "That entry doesn't exist.",
    });
  });

  it("refuses an upload when the deployment has no blob store", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect((await attach(ALICE, "entry")).ok).toBe(false);
    expect(stubs.stored).toEqual([]);
    expect(dbMock.transactions).toBe(0);
  });

  it("a failed write deletes the new file and throws", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue(new Error("connection reset"));
    await expect(attach(ALICE, "entry")).rejects.toThrow("connection reset");
    expect(stubs.quietDeletes).toEqual([[CAMP, stubs.stored[0]]]);
  });
});

// --- Dues amounts ------------------------------------------------------------------------

describe("setMemberDues", () => {
  const set = (
    amountCents: number | null,
    reason: string | null = null,
    userId = JABU,
  ) =>
    store.setMemberDues({
      ...base,
      actorUserId: ALICE,
      userId,
      amountCents,
      reason,
    });

  it("sets a member's amount, audited, and tells them after commit", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue(
      [],
      [budgetRow()],
      /* subject */ [{ id: JABU, sanitizedAt: null }],
      [{ archivedAt: null }],
      /* before */ [],
      /* insert */ [],
      /* audit */ [],
      /* notice */ [],
    );
    expect(await set(150_000, "Joins for build week only")).toEqual({
      ok: true,
    });
    expect(dbMock.writesTo(schema.memberDues)[0]!.kind).toBe("insert");
    expect(auditRows()[0]!.meta).toMatchObject({
      userId: JABU,
      beforeCents: null,
      afterCents: 150_000,
    });
    expect(JSON.stringify(auditRows()[0]!.meta)).not.toContain("build week");
    expect(noticeRows()).toEqual([
      expect.objectContaining({ userId: JABU, kind: MONEY }),
    ]);
  });

  it("changes an existing amount, and puts a member back on the camp fee", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue(
      [],
      [budgetRow()],
      [{ id: JABU, sanitizedAt: null }],
      [{ archivedAt: null }],
      [{ amountCents: 1 }],
      [],
      [],
    );
    expect(await set(200_000)).toEqual({ ok: true });
    expect(dbMock.writesTo(schema.memberDues)[0]!.kind).toBe("update");

    dbMock.reset();
    queueActor(ALICE, LEAD);
    dbMock.queue(
      [],
      [budgetRow()],
      [{ id: JABU, sanitizedAt: null }],
      [{ archivedAt: null }],
      [{ amountCents: 1 }],
      [],
      [],
    );
    expect(await set(null)).toEqual({ ok: true });
    expect(dbMock.writesTo(schema.memberDues)[0]!.kind).toBe("delete");
  });

  it("back on a camp fee of R 0,00 reads 'no fee set', never 'waived'", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue(
      [],
      [budgetRow({ defaultDuesCents: 0 })],
      [{ id: JABU, sanitizedAt: null }],
      [{ archivedAt: null }],
      [{ amountCents: 150_000 }],
      /* delete */ [],
      /* audit */ [],
      /* notice */ [],
    );
    expect(await set(null)).toEqual({ ok: true });
    const [notice] = noticeRows();
    expect(notice!.userId).toBe(JABU);
    expect(notice!.title).not.toMatch(/waived/i);

    // an R 0,00 amount set for the member with a reason IS a waiver
    dbMock.reset();
    queueActor(ALICE, LEAD);
    dbMock.queue(
      [],
      [budgetRow({ defaultDuesCents: 0 })],
      [{ id: JABU, sanitizedAt: null }],
      [{ archivedAt: null }],
      [],
      [],
      [],
      [],
    );
    expect(await set(0, "Build crew")).toEqual({ ok: true });
    expect(noticeRows()[0]!.title).toBe("Your camp dues were waived");
  });

  it("a lead may set their own dues — the no-lockout backstop", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue(
      [],
      [budgetRow()],
      [{ id: ALICE, sanitizedAt: null }],
      [{ archivedAt: null }],
      [],
      [],
      [],
    );
    expect(await set(100_000, "Lead", ALICE)).toEqual({ ok: true });
    expect(dbMock.writesTo(schema.memberDues)).toHaveLength(1);
  });

  it("refuses a waiver without a reason, writing nothing", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue(
      [],
      [budgetRow()],
      [{ id: JABU, sanitizedAt: null }],
      [{ archivedAt: null }],
    );
    expect(await set(0)).toEqual({
      ok: false,
      error: "Say why their dues are waived.",
    });
    expect(dbMock.writesTo(schema.memberDues)).toHaveLength(0);
  });

  it("a former member's amount is set without a notice; someone who left is found through the books", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue(
      [],
      [budgetRow()],
      [{ id: LERATO, sanitizedAt: null }],
      [{ archivedAt: new Date() }],
      [],
      [],
      [],
    );
    expect(await set(100_000, "Left in March", LERATO)).toEqual({ ok: true });
    expect(noticeRows()).toHaveLength(0);

    dbMock.reset();
    queueActor(ALICE, LEAD);
    dbMock.queue(
      [],
      [budgetRow()],
      [{ id: PIETER, sanitizedAt: null }],
      /* no membership */ [],
      /* named by payments */ [{ n: 1 }],
      /* override */ [],
      /* before */ [],
      [],
      [],
    );
    expect(await set(250_000, null, PIETER)).toEqual({ ok: true });
    expect(noticeRows()).toHaveLength(0);
  });

  it("refuses an id that is no user at all", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue([], [budgetRow()], /* no user */ []);
    expect(await set(1)).toEqual({
      ok: false,
      error: "That person isn't on this camp's books.",
    });
  });
});

// --- The rest of the claim decisions ---------------------------------------------

describe("reject and repaid", () => {
  const claimRow = (o: Record<string, unknown> = {}) => ({
    id: CLAIM,
    claimantUserId: JABU,
    status: SUBMITTED,
    categoryId: KITCHEN,
    amountCents: 184_000,
    receiptKey: null,
    ...o,
  });

  it("rejects with the note on the claim, never copied into the claimant's notice", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue([claimRow()], [{ id: CLAIM }], [], [{ id: "m" }], []);
    expect(
      await store.rejectClaim({
        ...base,
        actorUserId: ALICE,
        claimId: CLAIM,
        note: "We already have six bottles.",
      }),
    ).toEqual({ ok: true });
    expect(dbMock.writesTo(schema.campClaims)[0]!.arg("set")).toMatchObject({
      status: REJECTED,
      decisionNote: "We already have six bottles.",
    });
    expect(auditRows()[0]!.action).toBe(MONEY_AUDIT.claimReject);
    // erasure clears the note from the claim and preserves notifications,
    // so a copy in the notice would outlive it
    expect(noticeRows()[0]).toMatchObject({ userId: JABU, kind: MONEY });
    expect(JSON.stringify(noticeRows())).not.toContain("six bottles");
  });

  it("marks an approved claim repaid; a claimant who left gets no notice", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue(
      [claimRow({ status: APPROVED })],
      [{ id: CLAIM }],
      [],
      /* not current */ [],
    );
    expect(
      await store.markClaimRepaid({
        ...base,
        actorUserId: ALICE,
        claimId: CLAIM,
        repaidOn: "2027-04-14",
      }),
    ).toEqual({ ok: true });
    expect(dbMock.writesTo(schema.campClaims)[0]!.arg("set")).toMatchObject({
      status: REPAID,
      repaidOn: "2027-04-14",
      repaidByUserId: ALICE,
    });
    expect(auditRows()[0]!.meta).toMatchObject({
      repaidOn: "2027-04-14",
      to: REPAID,
    });
    expect(noticeRows()).toHaveLength(0);
  });

  it("approving files the claim under the category the approver picked", async () => {
    const OTHER = "ca7ca7ca-0000-4000-8000-000000000004";
    queueActor(ALICE, LEAD);
    dbMock.queue(
      [claimRow({ categoryId: null })],
      [category({ id: OTHER, name: "Transport" })],
      [{ id: CLAIM }],
      [],
      [],
    );
    expect(
      await store.approveClaim({
        ...base,
        actorUserId: ALICE,
        claimId: CLAIM,
        categoryId: OTHER,
      }),
    ).toEqual({ ok: true });
    expect(dbMock.writesTo(schema.campClaims)[0]!.arg("set")).toMatchObject({
      categoryId: OTHER,
    });
  });

  it("refuses to approve a claim with no category until one is picked", async () => {
    queueActor(ALICE, LEAD);
    dbMock.queue([claimRow({ categoryId: null })]);
    expect(
      await store.approveClaim({
        ...base,
        actorUserId: ALICE,
        claimId: CLAIM,
        categoryId: null,
      }),
    ).toEqual({
      ok: false,
      error: "Pick a spending category for this claim before approving it.",
    });
    expect(moneyWrites()).toHaveLength(0);
  });
});
