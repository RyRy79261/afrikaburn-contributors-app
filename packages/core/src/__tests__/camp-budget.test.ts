import { describe, expect, it } from "vitest";
import {
  BudgetCategoryKind,
  BudgetEntryStatus,
  CampClaimStatus,
  DuesStatus,
  GroupKind,
  NotificationKind,
  type ProjectPermissions,
} from "@quagga/types";
import {
  CLAIM_TRANSITIONS,
  DUES_CATEGORY_KEY,
  MONEY_DELETED_ACCOUNT,
  MONEY_STARTER_CATEGORIES,
  campReceiptPath,
  campReceiptPrefix,
  canManageMoney,
  canWriteDuesFor,
  canSubmitClaim,
  canTransitionClaim,
  canViewMemberMoney,
  canViewMoneyTotals,
  canViewReceipt,
  checkReceiptUpload,
  RECEIPT_MAX_BYTES,
  claimApprovedNotification,
  claimRejectedNotification,
  claimRepaidNotification,
  claimSubmittedNotification,
  decideCategoryName,
  decideCategoryRemoval,
  decideClaimAction,
  decideClaimCategory,
  decideDuesWriteFor,
  decideEntry,
  decideMoneyWrite,
  deriveMoneyBooks,
  describeVariance,
  duesPaymentRecordedNotification,
  duesSetNotification,
  duesStatus,
  formatRand,
  isCampReceiptKey,
  memberDuesFigures,
  memberMoneyTotals,
  moneyAvailableForGroup,
  moneyMemberName,
  moneyPath,
  moneyRefusalMessage,
  normalizeCategoryName,
  onDuesList,
  parseRandToCents,
  receiptLabel,
  shouldSendImmediateEmail,
  sniffReceiptType,
  summariseDues,
  type CategoryFacts,
  type ClaimAmountFacts,
  type DuesMemberFacts,
  type EntryFacts,
  type MoneyBooksFacts,
  type PermissionMembership,
} from "../index";

// Camp money (docs/camp-budget-spec.md). The M1 fixture below IS the frame:
// every planned, actual and committed figure on "Plan vs actual", the six
// recent entries, the seven claims on M3 (two of them Jabu's on M4) and the
// dues received on M2. If a derivation changes, the frame's numbers stop
// adding up and these go red.

// Vocabularies from the real enums (AGENTS.md "Verification").
const EXPENSE = BudgetCategoryKind.enum.expense;
const INCOME = BudgetCategoryKind.enum.income;
const PAID = BudgetEntryStatus.enum.paid;
const COMMITTED = BudgetEntryStatus.enum.committed;
const SUBMITTED = CampClaimStatus.enum.submitted;
const APPROVED = CampClaimStatus.enum.approved;
const REJECTED = CampClaimStatus.enum.rejected;
const REPAID = CampClaimStatus.enum.repaid;

const R = (rands: number) => Math.round(rands * 100);
const NB = " ";

let nextSort = 0;
const cat = (
  id: string,
  kind: BudgetCategoryKind,
  name: string,
  planned: number,
  systemKey: string | null = null,
): CategoryFacts => ({
  id,
  kind,
  name,
  plannedCents: R(planned),
  systemKey,
  archived: false,
  sort: nextSort++,
});

const CATEGORIES: CategoryFacts[] = [
  cat("tents", EXPENSE, "Tents & structures", 12_000),
  cat("transport", EXPENSE, "Transport", 8_000),
  cat("power", EXPENSE, "Power", 4_500),
  cat("water", EXPENSE, "Water", 2_500),
  cat("kitchen", EXPENSE, "Kitchen & food", 14_000),
  cat("sound", EXPENSE, "Sound", 3_000),
  cat("lighting", EXPENSE, "Lighting", 2_000),
  cat("decor", EXPENSE, "Décor", 1_500),
  cat("moop", EXPENSE, "MOOP & strike", 1_000),
  cat("dues", INCOME, "Camp dues", 45_000, DUES_CATEGORY_KEY),
  cat("fundraising", INCOME, "Fundraising", 4_000),
  cat("donations", INCOME, "Donations", 1_000),
  cat("grants", INCOME, "Grants", 0),
  cat("sponsorship", INCOME, "Sponsorship", 0),
  cat("other", INCOME, "Other", 0),
];

const entry = (
  categoryId: string,
  rands: number,
  status: BudgetEntryStatus = PAID,
): EntryFacts => ({ categoryId, amountCents: R(rands), status });

// Paid entries are each category's actual LESS the claims counted into it.
const ENTRIES: EntryFacts[] = [
  entry("tents", 8_550), // + Sipho's R 950 repaid claim = R 9 500
  entry("tents", 2_500, COMMITTED), // "Shade cloth, 3 × 50 m rolls"
  entry("transport", 5_000), // + Jabu's R 1 200 approved claim = R 6 200
  entry("transport", 2_650, COMMITTED), // "Truck hire deposit"
  entry("power", 3_800), // "Generator service and fuel cans"
  entry("water", 1_000), // + Jabu's R 450 repaid claim = R 1 450
  entry("water", 600, COMMITTED),
  entry("kitchen", 3_200), // "Bulk dry goods for the kitchen"
  entry("kitchen", 3_800), // + Lerato's R 2 380 approved claim = R 9 380
  entry("kitchen", 1_800, COMMITTED),
  entry("sound", 3_600), // Mia's rejected R 600 claim is NOT counted
  entry("lighting", 1_180), // Alice's submitted R 380 claim is NOT counted
  entry("decor", 640),
  entry("fundraising", 2_600), // "Mad Tea Party fundraiser"
  entry("donations", 1_350), // "Donation from a camp friend"
];

const claim = (
  categoryId: string,
  rands: number,
  status: CampClaimStatus,
): ClaimAmountFacts => ({ categoryId, amountCents: R(rands), status });

const CLAIMS: ClaimAmountFacts[] = [
  claim("kitchen", 1_840, SUBMITTED), // Ren — gas bottle refills
  claim("lighting", 380, SUBMITTED), // Alice (you) — solar fairy lights
  claim("kitchen", 2_380, APPROVED), // Lerato — first food shop
  claim("transport", 1_200, APPROVED), // Jabu — trailer hire (M4)
  claim("sound", 600, REJECTED), // Mia — speaker cable
  claim("tents", 950, REPAID), // Sipho — cable ties, rope and pegs
  claim("water", 450, REPAID), // Jabu — water drums ×3 (M4)
];

const FRAME: MoneyBooksFacts = {
  contingencyPct: 5,
  categories: CATEGORIES,
  entries: ENTRIES,
  claims: CLAIMS,
  duesReceivedCents: R(33_500),
  currentMemberCount: 18,
};

const row = (id: string) => {
  const found = deriveMoneyBooks(FRAME).categories.find((c) => c.id === id);
  if (!found) throw new Error(`no category ${id}`);
  return found;
};

describe("the books — frame M1, exactly", () => {
  const { totals } = deriveMoneyBooks(FRAME);

  it("totals the plan, the spending and the income as the frame shows", () => {
    expect(totals.plannedSpendCents).toBe(R(48_500));
    expect(totals.actualSpendCents).toBe(R(35_750));
    expect(totals.committedSpendCents).toBe(R(7_550));
    expect(totals.plannedIncomeCents).toBe(R(50_000));
    expect(totals.actualIncomeCents).toBe(R(37_450));
  });

  it("projects income and spend from max(planned, actual + committed)", () => {
    expect(totals.projectedIncomeCents).toBe(R(50_350));
    expect(totals.projectedSpendCents).toBe(R(49_950));
  });

  it("holds back 5% of PLANNED spend and lands on a R 2 025 shortfall", () => {
    expect(totals.contingencyCents).toBe(R(2_425));
    expect(totals.surplusCents).toBe(R(-2_025));
  });

  it("counts cash, claims owed and cost per camper", () => {
    expect(totals.cashAvailableCents).toBe(R(5_280));
    expect(totals.claimsOwedCents).toBe(R(3_580));
    expect(totals.claimsOwedCount).toBe(2);
    expect(totals.claimsSubmittedCents).toBe(R(2_220));
    expect(totals.claimsSubmittedCount).toBe(2);
    expect(totals.claimsRepaidCents).toBe(R(1_400));
    expect(totals.claimsRepaidCount).toBe(2);
    expect(totals.claimsRejectedCount).toBe(1);
    expect(totals.costPerCamperCents).toBe(R(2_775));
  });

  it("reads each category's actual, committed and variance off the frame", () => {
    const expected: [string, number, number, number][] = [
      ["tents", 9_500, 2_500, 0],
      ["transport", 6_200, 2_650, -850],
      ["power", 3_800, 0, 700],
      ["water", 1_450, 600, 450],
      ["kitchen", 9_380, 1_800, 2_820],
      ["sound", 3_600, 0, -600],
      ["lighting", 1_180, 0, 820],
      ["decor", 640, 0, 860],
      ["moop", 0, 0, 1_000],
      ["dues", 33_500, 0, 11_500],
      ["fundraising", 2_600, 0, 1_400],
      ["donations", 1_350, 0, -350],
    ];
    for (const [id, actual, committed, variance] of expected) {
      const r = row(id);
      expect([id, r.actualCents, r.committedCents, r.varianceCents]).toEqual([
        id,
        R(actual),
        R(committed),
        R(variance),
      ]);
    }
    expect(totals.spendVarianceCents).toBe(R(5_200));
    expect(totals.incomeVarianceCents).toBe(R(12_550));
  });

  it("words the variance column the way the frame does", () => {
    const say = (id: string) => {
      const r = row(id);
      return describeVariance(r.kind, r.varianceCents);
    };
    expect(say("tents")).toEqual({ tone: "on_plan", text: "On plan" });
    expect(say("transport")).toEqual({
      tone: "over",
      text: `−R${NB}850,00`,
    });
    expect(say("power").text).toBe(`R${NB}700,00 left`);
    expect(say("dues").text).toBe(`R${NB}11${NB}500,00 to come`);
    expect(say("donations")).toEqual({
      tone: "above_plan",
      text: `+R${NB}350,00 above plan`,
    });
    expect(describeVariance(EXPENSE, R(5_200)).text).toBe(
      `R${NB}5${NB}200,00 left`,
    );
  });

  it("orders spending before income and marks the empty income rows idle", () => {
    const books = deriveMoneyBooks(FRAME);
    const kinds = books.categories.map((c) => c.kind);
    expect(kinds.indexOf(INCOME)).toBe(kinds.lastIndexOf(EXPENSE) + 1);
    const idle = books.categories
      .filter((c) => !c.hasActivity)
      .map((c) => c.id);
    expect(idle).toEqual(["grants", "sponsorship", "other"]);
  });

  it("shows members the totals and nothing else", () => {
    expect(memberMoneyTotals(totals)).toEqual({
      plannedSpendCents: R(48_500),
      actualSpendCents: R(35_750),
      committedSpendCents: R(7_550),
      actualIncomeCents: R(37_450),
      surplusCents: R(-2_025),
      contingencyPct: 5,
    });
  });
});

describe("the books — edges", () => {
  it("counts only approved and repaid claims as spending", () => {
    const facts: MoneyBooksFacts = {
      ...FRAME,
      entries: [],
      claims: [
        claim("kitchen", 100, SUBMITTED),
        claim("kitchen", 200, REJECTED),
        claim("kitchen", 300, APPROVED),
        claim("kitchen", 400, REPAID),
      ],
      duesReceivedCents: 0,
    };
    const books = deriveMoneyBooks(facts);
    expect(books.categories.find((c) => c.id === "kitchen")?.actualCents).toBe(
      R(700),
    );
    // Cash: nothing received, the repaid claim went out.
    expect(books.totals.cashAvailableCents).toBe(R(-400));
  });

  it("plans nothing for an archived category but keeps its spending", () => {
    const facts: MoneyBooksFacts = {
      ...FRAME,
      categories: CATEGORIES.map((c) =>
        c.id === "moop" ? { ...c, archived: true } : c,
      ),
      entries: [entry("moop", 250)],
      claims: [],
      duesReceivedCents: 0,
    };
    const books = deriveMoneyBooks(facts);
    const moop = books.categories.find((c) => c.id === "moop");
    expect(moop?.plannedCents).toBe(0);
    expect(moop?.actualCents).toBe(R(250));
    expect(books.totals.plannedSpendCents).toBe(R(47_500));
  });

  it("never loses dues received, even without a dues category", () => {
    const facts: MoneyBooksFacts = {
      ...FRAME,
      categories: CATEGORIES.filter((c) => c.id !== "dues"),
      entries: [],
      claims: [],
    };
    expect(deriveMoneyBooks(facts).totals.actualIncomeCents).toBe(R(33_500));
  });

  it("files a claim with no known category under Uncategorised", () => {
    const books = deriveMoneyBooks({
      ...FRAME,
      entries: [],
      claims: [{ categoryId: null, amountCents: R(10), status: APPROVED }],
      duesReceivedCents: 0,
    });
    const un = books.categories.find((c) => c.id === null);
    expect(un?.name).toBe("Uncategorised");
    expect(books.totals.actualSpendCents).toBe(R(10));
  });

  it("has no cost per camper with no members", () => {
    expect(
      deriveMoneyBooks({ ...FRAME, currentMemberCount: 0 }).totals
        .costPerCamperCents,
    ).toBeNull();
  });
});

// --- Dues: frame M2 ---------------------------------------------------------

const FEE = R(2_500);
const member = (
  name: string,
  received: number,
  override: number | null = null,
  standing: DuesMemberFacts["standing"] = "current",
): DuesMemberFacts & { name: string } => ({
  name,
  userId: name,
  standing,
  overrideCents: override === null ? null : R(override),
  receivedCents: R(received),
});

/** The nine rows M2 shows, then the eleven "not shown" that make its
 * card add up: 7 paid, 2 part paid (R 1 000 + R 1 500 in), 2 awaiting. */
const DUES: (DuesMemberFacts & { name: string })[] = [
  member("Alice Hatter", 2_500),
  member("Ren Notfound", 2_500),
  member("Jabu", 1_000),
  member("Lerato Dlamini", 0),
  member("Thandi Mokoena", 0, 0),
  member("Sipho Nkosi", 1_500, 1_500),
  member("Mia Fourie", 2_500),
  member("Pieter van Wyk", 2_500, null, "former"),
  member("Kagiso Molefe", 1_000, 1_000, "former"),
  ...Array.from({ length: 7 }, (_, i) => member(`Paid ${i}`, 2_500)),
  member("Part A", 1_000),
  member("Part B", 1_500),
  member("Awaiting A", 0),
  member("Awaiting B", 0),
];

describe("dues — frame M2, exactly", () => {
  it("adds up to the card: owed, received, outstanding, paid up", () => {
    const s = summariseDues(FEE, DUES);
    expect(s.memberCount).toBe(20);
    expect(s.formerCount).toBe(2);
    expect(s.currentCount).toBe(18);
    expect(s.owedCents).toBe(R(45_000));
    expect(s.receivedCents).toBe(R(33_500));
    expect(s.outstandingCents).toBe(R(11_500));
    expect(s.membersOwing).toBe(6);
    expect(s.byStatus).toEqual({
      paid: 13,
      part_paid: 3,
      awaiting: 3,
      waived: 1,
      no_fee: 0,
    });
  });

  it("reads each shown row the way the frame does", () => {
    const fig = (name: string) => {
      const m = DUES.find((d) => d.name === name);
      if (!m) throw new Error(name);
      return memberDuesFigures(FEE, m);
    };
    expect(fig("Jabu")).toMatchObject({
      owedCents: R(2_500),
      receivedCents: R(1_000),
      outstandingCents: R(1_500),
      status: "part_paid",
      isCampFee: true,
    });
    expect(fig("Lerato Dlamini").status).toBe("awaiting");
    expect(fig("Thandi Mokoena")).toMatchObject({
      owedCents: 0,
      status: "waived",
      isCampFee: false,
    });
    expect(fig("Sipho Nkosi")).toMatchObject({
      owedCents: R(1_500),
      status: "paid",
    });
  });

  it("treats money beyond what was owed as overpaid, not negative", () => {
    const f = memberDuesFigures(FEE, {
      overrideCents: null,
      receivedCents: R(3_000),
    });
    expect(f.outstandingCents).toBe(0);
    expect(f.overpaidCents).toBe(R(500));
    expect(f.status).toBe("paid");
  });

  it("derives every status from the real vocabulary", () => {
    const seen = new Set([
      duesStatus(0, 0),
      duesStatus(100, 0),
      duesStatus(100, 50),
      duesStatus(100, 100),
      duesStatus(0, 0, true),
    ]);
    expect([...seen].sort()).toEqual([...DuesStatus.options].sort());
  });

  // Regression (found by the money e2e, 14 Oct): with no camp fee set yet,
  // every member of a new camp read "Waived".
  it("never calls a member waived just because the camp fee is still R 0,00", () => {
    const onFee = memberDuesFigures(0, {
      overrideCents: null,
      receivedCents: 0,
    });
    expect(onFee).toMatchObject({ status: "no_fee", outstandingCents: 0 });
    // Money that arrived anyway reads as paid, not waived.
    expect(
      memberDuesFigures(0, { overrideCents: null, receivedCents: R(100) })
        .status,
    ).toBe("paid");
    // An amount of R 0,00 SET for the member is a waiver, whatever the fee.
    expect(
      memberDuesFigures(0, { overrideCents: 0, receivedCents: 0 }).status,
    ).toBe("waived");
    expect(
      memberDuesFigures(FEE, { overrideCents: 0, receivedCents: 0 }).status,
    ).toBe("waived");
    const s = summariseDues(0, [
      {
        userId: "a",
        standing: "current",
        overrideCents: null,
        receivedCents: 0,
      },
      { userId: "b", standing: "current", overrideCents: 0, receivedCents: 0 },
    ]);
    expect(s.byStatus).toMatchObject({ no_fee: 1, waived: 1 });
  });

  it("lists every current member, and former ones only when the books name them", () => {
    expect(
      onDuesList({
        standing: "current",
        hasOverride: false,
        hasPayments: false,
      }),
    ).toBe(true);
    expect(
      onDuesList({
        standing: "former",
        hasOverride: false,
        hasPayments: false,
      }),
    ).toBe(false);
    expect(
      onDuesList({ standing: "former", hasOverride: false, hasPayments: true }),
    ).toBe(true);
    expect(
      onDuesList({
        standing: "deleted",
        hasOverride: true,
        hasPayments: false,
      }),
    ).toBe(true);
  });
});

// --- Who may ---------------------------------------------------------------

const as = (
  structuralRole: PermissionMembership["structuralRole"],
  ...rolePermissions: ProjectPermissions[]
): PermissionMembership => ({ structuralRole, rolePermissions });

const LEAD = as("lead");
const ADMIN = as("admin");
const TREASURER = as("member", { manage_money: true });
const MEMBER = as("member", {});
const ROSTER_VIEWER = as("member", {
  view_member_details: true,
  manage_members: true,
});

describe("who may", () => {
  it("money people are the leads and manage_money holders, nobody else", () => {
    expect(canManageMoney(LEAD)).toBe(true);
    expect(canManageMoney(ADMIN)).toBe(true);
    expect(canManageMoney(TREASURER)).toBe(true);
    expect(canManageMoney(MEMBER)).toBe(false);
    expect(canManageMoney(ROSTER_VIEWER)).toBe(false);
    expect(canManageMoney(null)).toBe(false);
    expect(decideMoneyWrite(MEMBER)).toEqual({
      ok: false,
      reason: "not_money_person",
    });
    expect(decideMoneyWrite(null)).toEqual({ ok: false, reason: "not_member" });
    expect(decideMoneyWrite(TREASURER)).toEqual({ ok: true });
  });

  it("a custom-role money person never writes their own dues; a lead or admin may", () => {
    const me = "u-me";
    const other = "u-other";
    expect(decideDuesWriteFor(TREASURER, me, me)).toEqual({
      ok: false,
      reason: "own_dues",
    });
    expect(canWriteDuesFor(TREASURER, me, me)).toBe(false);
    expect(decideDuesWriteFor(TREASURER, me, other)).toEqual({ ok: true });
    // the no-lockout backstop: a camp whose only money person is its lead
    expect(decideDuesWriteFor(LEAD, me, me)).toEqual({ ok: true });
    expect(decideDuesWriteFor(ADMIN, me, me)).toEqual({ ok: true });
    // deleted-account rows (no user) are someone else's
    expect(canWriteDuesFor(TREASURER, me, null)).toBe(true);
    expect(decideDuesWriteFor(MEMBER, me, other)).toEqual({
      ok: false,
      reason: "not_money_person",
    });
    expect(decideDuesWriteFor(null, me, me)).toEqual({
      ok: false,
      reason: "not_member",
    });
    expect(moneyRefusalMessage("own_dues")).toMatch(/own dues/);
  });

  it("every current member sees the totals; a non-member sees nothing", () => {
    expect(canViewMoneyTotals(MEMBER)).toBe(true);
    expect(canViewMoneyTotals(null)).toBe(false);
    expect(canSubmitClaim(MEMBER)).toBe(true);
    expect(canSubmitClaim(null)).toBe(false);
  });

  it("a member sees only their own dues and claims", () => {
    const jabu = { userId: "jabu", membership: MEMBER };
    expect(canViewMemberMoney(jabu, "jabu")).toBe(true);
    expect(canViewMemberMoney(jabu, "lerato")).toBe(false);
    expect(canViewMemberMoney(jabu, null)).toBe(false);
    expect(
      canViewMemberMoney({ userId: "alice", membership: TREASURER }, "lerato"),
    ).toBe(true);
    expect(
      canViewMemberMoney({ userId: "jabu", membership: null }, "jabu"),
    ).toBe(false);
  });

  it("a receipt opens for money people and its claimant only", () => {
    const claimReceipt = { kind: "claim" as const, claimantUserId: "jabu" };
    expect(
      canViewReceipt({ userId: "jabu", membership: MEMBER }, claimReceipt),
    ).toBe(true);
    expect(
      canViewReceipt({ userId: "lerato", membership: MEMBER }, claimReceipt),
    ).toBe(false);
    expect(
      canViewReceipt({ userId: "alice", membership: LEAD }, claimReceipt),
    ).toBe(true);
    expect(
      canViewReceipt({ userId: "jabu", membership: null }, claimReceipt),
    ).toBe(false);
    expect(
      canViewReceipt({ userId: "jabu", membership: MEMBER }, { kind: "entry" }),
    ).toBe(false);
    expect(
      canViewReceipt({ userId: "x", membership: TREASURER }, { kind: "entry" }),
    ).toBe(true);
    expect(
      canViewReceipt(
        { userId: "jabu", membership: MEMBER },
        { kind: "claim", claimantUserId: null },
      ),
    ).toBe(false);
  });

  it("is a theme-camp feature only", () => {
    const on = GroupKind.options.filter(moneyAvailableForGroup);
    expect(on).toEqual(["theme_camp"]);
  });
});

// --- Claims ------------------------------------------------------------------

const KITCHEN = { kind: EXPENSE, archived: false };
const submitted = (
  claimantUserId: string,
  categoryId: string | null = "kitchen",
) => ({
  claimantUserId,
  status: SUBMITTED,
  categoryId,
});

describe("claims — the state machine", () => {
  it("allows exactly submitted→approved|rejected and approved→repaid", () => {
    const allowed: string[] = [];
    for (const from of CampClaimStatus.options) {
      for (const to of CampClaimStatus.options) {
        if (canTransitionClaim(from, to)) allowed.push(`${from}->${to}`);
      }
    }
    expect(allowed.sort()).toEqual([
      "approved->repaid",
      "submitted->approved",
      "submitted->rejected",
    ]);
    expect(CLAIM_TRANSITIONS.rejected).toEqual([]);
    expect(CLAIM_TRANSITIONS.repaid).toEqual([]);
  });

  it("a money person approves, rejects and marks repaid someone else's claim", () => {
    const actor = { userId: "alice", membership: TREASURER };
    expect(
      decideClaimAction({
        action: "approve",
        actor,
        claim: submitted("ren"),
        category: KITCHEN,
      }),
    ).toEqual({ ok: true, next: APPROVED });
    expect(
      decideClaimAction({ action: "reject", actor, claim: submitted("ren") }),
    ).toEqual({
      ok: true,
      next: REJECTED,
    });
    expect(
      decideClaimAction({
        action: "repay",
        actor,
        claim: {
          claimantUserId: "lerato",
          status: APPROVED,
          categoryId: "kitchen",
        },
      }),
    ).toEqual({ ok: true, next: REPAID });
  });

  it("never lets the author decide their own claim — not even a lead", () => {
    for (const membership of [LEAD, ADMIN, TREASURER]) {
      const actor = { userId: "alice", membership };
      for (const action of ["approve", "reject"] as const) {
        expect(
          decideClaimAction({
            action,
            actor,
            claim: submitted("alice"),
            category: KITCHEN,
          }),
        ).toEqual({ ok: false, reason: "own_claim" });
      }
      expect(
        decideClaimAction({
          action: "repay",
          actor,
          claim: {
            claimantUserId: "alice",
            status: APPROVED,
            categoryId: "kitchen",
          },
        }),
      ).toEqual({ ok: false, reason: "own_claim" });
    }
    expect(moneyRefusalMessage("own_claim")).toMatch(
      /can't decide your own claim/,
    );
  });

  it("refuses a plain member every decision", () => {
    const actor = { userId: "jabu", membership: MEMBER };
    expect(
      decideClaimAction({
        action: "approve",
        actor,
        claim: submitted("ren"),
        category: KITCHEN,
      }),
    ).toEqual({ ok: false, reason: "not_money_person" });
  });

  it("decides a claim once", () => {
    const actor = { userId: "alice", membership: LEAD };
    for (const status of [APPROVED, REJECTED, REPAID]) {
      const claim = { claimantUserId: "ren", status, categoryId: "kitchen" };
      expect(
        decideClaimAction({
          action: "approve",
          actor,
          claim,
          category: KITCHEN,
        }),
      ).toEqual({
        ok: false,
        reason: "claim_already_decided",
      });
      expect(decideClaimAction({ action: "reject", actor, claim })).toEqual({
        ok: false,
        reason: "claim_already_decided",
      });
    }
    expect(
      decideClaimAction({ action: "repay", actor, claim: submitted("ren") }),
    ).toEqual({ ok: false, reason: "claim_not_approved" });
  });

  it("files an approved claim under a live spending category", () => {
    const actor = { userId: "alice", membership: LEAD };
    expect(
      decideClaimAction({
        action: "approve",
        actor,
        claim: submitted("ren", null),
        category: null,
      }),
    ).toEqual({ ok: false, reason: "claim_needs_category" });
    expect(
      decideClaimAction({
        action: "approve",
        actor,
        claim: submitted("ren"),
        category: { kind: INCOME, archived: false },
      }),
    ).toEqual({ ok: false, reason: "category_not_expense" });
    expect(
      decideClaimAction({
        action: "approve",
        actor,
        claim: submitted("ren"),
        category: { kind: EXPENSE, archived: true },
      }),
    ).toEqual({ ok: false, reason: "category_archived" });
    expect(decideClaimCategory(null)).toEqual({
      ok: false,
      reason: "category_missing",
    });
  });

  it("lets only the author withdraw, and only while it waits", () => {
    const jabu = { userId: "jabu", membership: MEMBER };
    expect(
      decideClaimAction({
        action: "withdraw",
        actor: jabu,
        claim: submitted("jabu"),
      }),
    ).toEqual({
      ok: true,
      next: null,
    });
    expect(
      decideClaimAction({
        action: "withdraw",
        actor: jabu,
        claim: submitted("ren"),
      }),
    ).toEqual({
      ok: false,
      reason: "not_your_claim",
    });
    expect(
      decideClaimAction({
        action: "withdraw",
        actor: { userId: "alice", membership: LEAD },
        claim: submitted("ren"),
      }),
    ).toEqual({ ok: false, reason: "not_your_claim" });
    expect(
      decideClaimAction({
        action: "withdraw",
        actor: jabu,
        claim: {
          claimantUserId: "jabu",
          status: APPROVED,
          categoryId: "kitchen",
        },
      }),
    ).toEqual({ ok: false, reason: "claim_already_decided" });
    expect(
      decideClaimAction({
        action: "withdraw",
        actor: { userId: "jabu", membership: null },
        claim: submitted("jabu"),
      }),
    ).toEqual({ ok: false, reason: "not_member" });
  });
});

// --- Categories and entries ------------------------------------------------

describe("categories and entries", () => {
  it("starts every camp with one dues category and unique names", () => {
    const dues = MONEY_STARTER_CATEGORIES.filter(
      (c) => c.systemKey === DUES_CATEGORY_KEY,
    );
    expect(dues).toEqual([
      { kind: INCOME, name: "Camp dues", systemKey: DUES_CATEGORY_KEY },
    ]);
    const names = MONEY_STARTER_CATEGORIES.map((c) =>
      normalizeCategoryName(c.name),
    );
    expect(new Set(names).size).toBe(names.length);
    for (const c of MONEY_STARTER_CATEGORIES) {
      expect(BudgetCategoryKind.options).toContain(c.kind);
    }
  });

  it("refuses a taken name, case and spacing aside", () => {
    const existing = [{ id: "a", name: "Kitchen & food" }];
    expect(decideCategoryName(existing, "  kitchen   &  FOOD ")).toEqual({
      ok: false,
      reason: "category_name_taken",
    });
    expect(decideCategoryName(existing, "Kitchen & food", "a")).toEqual({
      ok: true,
    });
    expect(decideCategoryName(existing, "Bar")).toEqual({ ok: true });
  });

  it("deletes an unused category, archives a used one, never removes dues", () => {
    const plain = { systemKey: null, archived: false };
    expect(decideCategoryRemoval(plain, false)).toEqual({
      ok: true,
      action: "delete",
    });
    expect(decideCategoryRemoval(plain, true)).toEqual({
      ok: true,
      action: "archive",
    });
    expect(
      decideCategoryRemoval(
        { systemKey: DUES_CATEGORY_KEY, archived: false },
        false,
      ),
    ).toEqual({
      ok: false,
      reason: "dues_category_remove",
    });
  });

  it("keeps entries out of the dues category and income always received", () => {
    const live = { kind: EXPENSE, systemKey: null, archived: false };
    expect(decideEntry(live, COMMITTED)).toEqual({ ok: true });
    expect(decideEntry({ ...live, kind: INCOME }, COMMITTED)).toEqual({
      ok: false,
      reason: "committed_income",
    });
    expect(decideEntry({ ...live, kind: INCOME }, PAID)).toEqual({ ok: true });
    expect(
      decideEntry(
        { kind: INCOME, systemKey: DUES_CATEGORY_KEY, archived: false },
        PAID,
      ),
    ).toEqual({
      ok: false,
      reason: "dues_category_entry",
    });
    // a correction that keeps an entry in its (since removed) category is
    // allowed; moving one INTO a removed category is not
    expect(
      decideEntry({ ...live, archived: true }, PAID, { keepsCategory: true }),
    ).toEqual({ ok: true });
    expect(
      decideEntry({ ...live, archived: true }, PAID, { keepsCategory: false }),
    ).toEqual({ ok: false, reason: "category_archived" });
    expect(decideEntry({ ...live, archived: true }, PAID)).toEqual({
      ok: false,
      reason: "category_archived",
    });
    expect(decideEntry(null, PAID)).toEqual({
      ok: false,
      reason: "category_missing",
    });
  });
});

// --- Amounts ---------------------------------------------------------------

describe("amounts", () => {
  it("formats en-ZA rand with a true minus", () => {
    expect(formatRand(R(1_250))).toBe(`R${NB}1${NB}250,00`);
    expect(formatRand(R(-2_025))).toBe(`−R${NB}2${NB}025,00`);
    expect(formatRand(0)).toBe(`R${NB}0,00`);
    expect(formatRand(5)).toBe(`R${NB}0,05`);
    expect(formatRand(R(1_234_567.89))).toBe(`R${NB}1${NB}234${NB}567,89`);
  });

  it("reads what people type into an amount field", () => {
    expect(parseRandToCents("R 1 500,00")).toBe(R(1_500));
    expect(parseRandToCents(`R${NB}1${NB}500,00`)).toBe(R(1_500));
    expect(parseRandToCents("1500")).toBe(R(1_500));
    expect(parseRandToCents("1 500.5")).toBe(R(1_500.5));
    expect(parseRandToCents("1,500.00")).toBe(R(1_500));
    expect(parseRandToCents("1.500,00")).toBe(R(1_500));
    expect(parseRandToCents("r385")).toBe(R(385));
    expect(parseRandToCents("1,500")).toBe(R(1_500));
    expect(parseRandToCents("")).toBeNull();
    expect(parseRandToCents("-10")).toBeNull();
    expect(parseRandToCents("ten")).toBeNull();
    expect(parseRandToCents("1,5,0")).toBeNull();
  });

  it("round-trips its own output", () => {
    for (const cents of [0, 5, 99, 100, 38_500, 4_850_000]) {
      expect(parseRandToCents(formatRand(cents))).toBe(cents);
    }
  });

  it("names a deleted account and never a blank", () => {
    expect(moneyMemberName("jabu", { sanitizedAt: null, userId: "u" })).toBe(
      "jabu",
    );
    expect(
      moneyMemberName("jabu", { sanitizedAt: new Date(), userId: "u" }),
    ).toBe(MONEY_DELETED_ACCOUNT);
    expect(moneyMemberName(null, { sanitizedAt: null, userId: null })).toBe(
      MONEY_DELETED_ACCOUNT,
    );
  });
});

// --- Receipts ----------------------------------------------------------------

const bytes = (...b: number[]) => new Uint8Array(b);
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\n...");
const SVG_BYTES = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"/>',
);

describe("receipts", () => {
  it("sniffs a photo or a PDF from the bytes and refuses everything else", () => {
    expect(sniffReceiptType(PDF_BYTES)).toBe("application/pdf");
    expect(sniffReceiptType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffReceiptType(SVG_BYTES)).toBeNull();
    expect(checkReceiptUpload(SVG_BYTES)).toMatchObject({
      ok: false,
      status: 415,
    });
    expect(checkReceiptUpload(new Uint8Array(0))).toMatchObject({
      ok: false,
      status: 400,
    });
    // 4 MB exactly is accepted; one byte more is refused (the platform caps
    // a function's request body at 4.5 MB, multipart overhead included).
    const atLimit = new Uint8Array(RECEIPT_MAX_BYTES);
    atLimit.set(PDF_BYTES);
    expect(RECEIPT_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(checkReceiptUpload(atLimit)).toMatchObject({ ok: true });
    const big = new Uint8Array(RECEIPT_MAX_BYTES + 1);
    big.set(PDF_BYTES);
    expect(checkReceiptUpload(big)).toMatchObject({ ok: false, status: 413 });
    expect(checkReceiptUpload(PDF_BYTES)).toEqual({
      ok: true,
      contentType: "application/pdf",
    });
  });

  it("keeps every receipt under its own camp's private prefix", () => {
    const key = `${campReceiptPrefix("camp-a")}receipt-x1y2.pdf`;
    expect(campReceiptPath("camp-a", "application/pdf")).toBe(
      "camp-receipts/camp-a/receipt.pdf",
    );
    expect(isCampReceiptKey("camp-a", key)).toBe(true);
    expect(isCampReceiptKey("camp-b", key)).toBe(false);
    expect(
      isCampReceiptKey("camp-a", "camp-receipts/camp-a/../camp-b/r.pdf"),
    ).toBe(false);
    expect(isCampReceiptKey("camp-a", "avatars/camp-a/photo.png")).toBe(false);
    expect(receiptLabel("application/pdf")).toBe("PDF");
    expect(receiptLabel("image/jpeg")).toBe("JPG");
  });
});

// --- Notifications -----------------------------------------------------------

describe("notifications", () => {
  const c = { campName: "Mad Hatters", campSlug: "mad-hatters" };

  it("are kind `money`, in-app only, and link to the money page", () => {
    const all = [
      duesSetNotification(c, R(1_500), { onCampFee: false }),
      duesPaymentRecordedNotification(c, R(1_000), R(1_500)),
      claimSubmittedNotification(c, "Ren Notfound", R(1_840)),
      claimApprovedNotification(c, R(2_380)),
      claimRejectedNotification(c, R(600)),
      claimRepaidNotification(c, R(950)),
    ];
    for (const n of all) {
      expect(NotificationKind.options).toContain(n.kind);
      expect(n.kind).toBe("money");
      expect(n.link?.startsWith("/camps/mad-hatters/money")).toBe(true);
    }
    expect(shouldSendImmediateEmail("money")).toBe(false);
  });

  it("says what changed in plain words", () => {
    expect(duesSetNotification(c, 0, { onCampFee: false }).title).toBe(
      "Your camp dues were waived",
    );
    // R 0,00 on the camp fee is "no fee set", never "waived" (duesStatus)
    expect(duesSetNotification(c, 0, { onCampFee: true }).title).not.toMatch(
      /waived/i,
    );
    expect(duesSetNotification(c, 0, { onCampFee: true }).title).toMatch(
      /hasn't set its fee/,
    );
    expect(duesSetNotification(c, R(1_500), { onCampFee: true }).title).toBe(
      `Your camp dues are now R${NB}1${NB}500,00`,
    );
    expect(duesSetNotification(c, R(1_500), { onCampFee: false }).title).toBe(
      `Your camp dues are now R${NB}1${NB}500,00`,
    );
    expect(duesPaymentRecordedNotification(c, R(1_000), R(1_500)).body).toBe(
      `Mad Hatters · R${NB}1${NB}500,00 still to pay`,
    );
    expect(duesPaymentRecordedNotification(c, R(1_000), 0).body).toBe(
      "Mad Hatters · your dues are paid up",
    );
    // the decision note stays on the claim: erasure clears it there, and
    // notifications are preserved by erasure
    expect(claimRejectedNotification(c, R(600)).body).toBe(
      "Mad Hatters · open the claim to read why",
    );
    expect(claimSubmittedNotification(c, "Ren", R(1)).link).toBe(
      moneyPath("mad-hatters", "claims"),
    );
    expect(moneyPath("mad-hatters", "claims")).toBe(
      "/camps/mad-hatters/money?tab=claims",
    );
    expect(moneyPath("mad-hatters", "budget")).toBe("/camps/mad-hatters/money");
  });

  it("never offers a way to pay through the app", () => {
    const text = [
      duesSetNotification(c, R(1_500), { onCampFee: false }),
      duesPaymentRecordedNotification(c, R(1_000), R(1_500)),
      claimApprovedNotification(c, R(2_380)),
    ]
      .map((n) => `${n.title} ${n.body ?? ""}`)
      .join(" ");
    expect(text).not.toMatch(/pay now|pay here|checkout|card/i);
  });
});
