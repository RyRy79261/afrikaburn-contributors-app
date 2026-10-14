// Camp money: budget, dues and claims (docs/camp-budget-spec.md, App Spec §7
// BUDGET-001–062, §8 PAY-010–013 as records). PURE — no I/O, no env, no DB.
// The store (apps/web/lib/camp-money-store.ts) loads every fact these
// functions read from the database; a request names ids and nothing else.
//
// RECORDS, NEVER TRANSACTIONS. The platform never holds, moves, collects or
// refunds money (AGENTS.md money law, Decision 009, ./payment-tracking.ts).
// Camps keep their books here the way they would in a spreadsheet: a plan by
// category, what was spent and received, what each member owes and has paid
// the camp by EFT, and what the camp owes members who bought things for it.
// A "payment" in this file is always a money person's record of money ALREADY
// received in the camp's own account. Nothing here takes an amount FROM a
// payer, and nothing ever should without Decision 009 reopened first.
//
// WHO (Ryan, 13 Oct 2026):
//   · MONEY PEOPLE — the structural lead and co-leads (irrevocably, the
//     ./project-permissions backstop) and members holding the camp privilege
//     `manage_money` — see and edit everything.
//   · EVERY CURRENT MEMBER sees the totals (open books) and their OWN dues and
//     claims, and submits and withdraws their own claims.
//   · Nobody else sees another member's dues or claims. Non-members: the
//     camp's 404 (the store returns null).
//   · A claim's author never decides their own claim, money person or not.

import type {
  BudgetCategoryKind,
  BudgetEntryStatus,
  CampBudgetStatus,
  CampClaimStatus,
  DuesStatus,
  GroupKind,
  NotificationPayload,
} from "@quagga/types";
import {
  hasProjectPermission,
  isPermissionBackstop,
  type PermissionMembership,
} from "./project-permissions";

// --- Constants -------------------------------------------------------------

/** Audit action names, written in the same transaction as the change. Meta
 * carries ids, amounts and dates only — never a description or a note, so an
 * account erasure has nothing personal to chase into the audit trail. */
export const MONEY_AUDIT = {
  categoriesSeeded: "camp.money.categories_seeded",
  campFee: "camp.money.camp_fee",
  instructions: "camp.money.payment_instructions",
  plan: "camp.money.plan",
  approve: "camp.money.budget_approve",
  budgetReopen: "camp.money.budget_reopen",
  categoryAdd: "camp.money.category_add",
  categoryRename: "camp.money.category_rename",
  categoryDelete: "camp.money.category_delete",
  categoryArchive: "camp.money.category_archive",
  entryAdd: "camp.money.entry_add",
  entryUpdate: "camp.money.entry_update",
  entryDelete: "camp.money.entry_delete",
  receiptAttach: "camp.money.receipt_attach",
  duesSet: "camp.money.dues_set",
  paymentRecord: "camp.money.payment_record",
  paymentDelete: "camp.money.payment_delete",
  claimSubmit: "camp.money.claim_submit",
  claimWithdraw: "camp.money.claim_withdraw",
  claimApprove: "camp.money.claim_approve",
  claimReject: "camp.money.claim_reject",
  claimRepaid: "camp.money.claim_repaid",
  claimReopen: "camp.money.claim_reopen",
  claimRepaidUndo: "camp.money.claim_repaid_undo",
} as const;

/** The `system_key` of the income category dues received are counted into. */
export const DUES_CATEGORY_KEY = "dues";

/** Shown wherever a deleted account's amounts appear (the spec's wording). */
export const MONEY_DELETED_ACCOUNT = "Deleted account";

export interface StarterCategory {
  kind: BudgetCategoryKind;
  name: string;
  systemKey: string | null;
}

/**
 * The list a camp starts with, written once per camp per edition the first
 * time a money person opens the budget. Expense rows follow App Spec
 * BUDGET-022–048 as the M1 frame groups them (the full 27-line list is a form
 * nobody fills; a camp adds what it needs). BUDGET-049 Contingency is the
 * plan's contingency percentage, not a category. Income rows are
 * BUDGET-013, 015–018 and 021; village dues (014) are out of scope and ticket
 * or transport contributions (019, 020) are ordinary income a camp adds.
 */
export const MONEY_STARTER_CATEGORIES: readonly StarterCategory[] = [
  { kind: "expense", name: "Tents & structures", systemKey: null },
  { kind: "expense", name: "Transport", systemKey: null },
  { kind: "expense", name: "Power", systemKey: null },
  { kind: "expense", name: "Water", systemKey: null },
  { kind: "expense", name: "Kitchen & food", systemKey: null },
  { kind: "expense", name: "Sound", systemKey: null },
  { kind: "expense", name: "Lighting", systemKey: null },
  { kind: "expense", name: "Décor", systemKey: null },
  { kind: "expense", name: "Build", systemKey: null },
  { kind: "expense", name: "MOOP & strike", systemKey: null },
  { kind: "expense", name: "Other spending", systemKey: null },
  { kind: "income", name: "Camp dues", systemKey: DUES_CATEGORY_KEY },
  { kind: "income", name: "Fundraising", systemKey: null },
  { kind: "income", name: "Donations", systemKey: null },
  { kind: "income", name: "Grants", systemKey: null },
  { kind: "income", name: "Sponsorship", systemKey: null },
  { kind: "income", name: "Other", systemKey: null },
];

/** Case-, space-insensitive key for "is this name taken in this camp?". */
export function normalizeCategoryName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// --- Who may ---------------------------------------------------------------

/** Money is a theme-camp feature (artworks and vehicles: not in this build). */
export function moneyAvailableForGroup(kind: GroupKind): boolean {
  return kind === "theme_camp";
}

/** Money people: lead/admin (irrevocable backstop) or a `manage_money` grant. */
export function canManageMoney(
  membership: PermissionMembership | null,
): boolean {
  return (
    membership !== null && hasProjectPermission(membership, "manage_money")
  );
}

/** Open books: every CURRENT member sees the totals. `null` = not a member
 * (archived and non-members alike — the store resolves active memberships). */
export function canViewMoneyTotals(
  membership: PermissionMembership | null,
): boolean {
  return membership !== null;
}

/** Whose dues, payments and claims a viewer may see: their own, or anyone's
 * for a money person. A former member's own figures are not reachable — they
 * have no membership, so no camp page at all. */
export function canViewMemberMoney(
  viewer: { userId: string; membership: PermissionMembership | null },
  subjectUserId: string | null,
): boolean {
  if (viewer.membership === null) return false;
  if (canManageMoney(viewer.membership)) return true;
  return subjectUserId !== null && subjectUserId === viewer.userId;
}

/** Any current member may claim back money they spent for the camp. */
export function canSubmitClaim(
  membership: PermissionMembership | null,
): boolean {
  return membership !== null;
}

export type ReceiptSubject =
  { kind: "claim"; claimantUserId: string | null } | { kind: "entry" };

/** A receipt opens for the money people, and a claim's receipt also for its
 * claimant. Everyone else gets the route's ordinary not-found. */
export function canViewReceipt(
  viewer: { userId: string; membership: PermissionMembership | null },
  subject: ReceiptSubject,
): boolean {
  if (viewer.membership === null) return false;
  if (canManageMoney(viewer.membership)) return true;
  return (
    subject.kind === "claim" &&
    subject.claimantUserId !== null &&
    subject.claimantUserId === viewer.userId
  );
}

// --- Refusals --------------------------------------------------------------

export type MoneyRefusal =
  | "not_money_person"
  | "not_member"
  | "own_claim"
  | "own_dues"
  | "not_your_claim"
  | "claim_already_decided"
  | "claim_not_approved"
  | "claim_needs_category"
  | "claim_changed"
  | "category_missing"
  | "category_archived"
  | "category_not_expense"
  | "dues_category_entry"
  | "dues_category_remove"
  | "committed_income"
  | "category_name_taken"
  | "too_many_categories"
  | "budget_already_approved"
  | "budget_not_approved"
  | "unknown_member"
  | "deleted_account";

export function moneyRefusalMessage(reason: MoneyRefusal): string {
  switch (reason) {
    case "not_money_person":
      return "Only the camp's money people can do that.";
    case "not_member":
      return "You're not a member of this camp.";
    case "own_claim":
      return "You can't decide your own claim. Another money person or a lead decides it.";
    case "own_dues":
      return "You can't set or record your own dues. A lead does that for you.";
    case "not_your_claim":
      return "That isn't your claim.";
    case "claim_already_decided":
      return "That claim has already been decided — refresh to see it.";
    case "claim_not_approved":
      return "Only an approved claim can be marked repaid.";
    case "claim_changed":
      return "That claim has changed since you opened it — refresh to see it.";
    case "claim_needs_category":
      return "Pick a spending category for this claim before approving it.";
    case "category_missing":
      return "That category doesn't exist any more.";
    case "category_archived":
      return "That category was removed. Pick another.";
    case "category_not_expense":
      return "Claims go against a spending category.";
    case "dues_category_entry":
      return "Record dues from the Dues tab, so they aren't counted twice.";
    case "dues_category_remove":
      return "Camp dues can be renamed, never removed — dues received count there.";
    case "committed_income":
      return "Income is recorded once it is received.";
    case "category_name_taken":
      return "There's already a category with that name.";
    case "too_many_categories":
      return "That's the most categories a budget can have.";
    case "budget_already_approved":
      return "The budget is already approved.";
    case "budget_not_approved":
      return "The budget is already a draft — refresh to see it.";
    case "unknown_member":
      return "That person isn't on this camp's books.";
    case "deleted_account":
      return "That account has been deleted.";
  }
}

export type MoneyDecision<T = object> =
  ({ ok: true } & T) | { ok: false; reason: MoneyRefusal };

const refuse = (reason: MoneyRefusal) => ({ ok: false as const, reason });

/** Gate for every money-people write. */
export function decideMoneyWrite(
  membership: PermissionMembership | null,
): MoneyDecision {
  if (membership === null) return refuse("not_member");
  if (!canManageMoney(membership)) return refuse("not_money_person");
  return { ok: true };
}

/**
 * May this money person set the amount of, or record money in for, THIS
 * member? Not for themselves through a custom role: a treasurer could
 * otherwise waive their own dues or record an EFT that never arrived, and the
 * only trace would be an audit row (the claims path refuses the same self-
 * dealing with `own_claim`). A structural lead/admin may — they hold every
 * project permission irrevocably, and a camp whose only money person is its
 * lead must still be able to record the lead's own dues.
 */
export function canWriteDuesFor(
  membership: PermissionMembership | null,
  actorUserId: string,
  subjectUserId: string | null,
): boolean {
  return decideDuesWriteFor(membership, actorUserId, subjectUserId).ok;
}

export function decideDuesWriteFor(
  membership: PermissionMembership | null,
  actorUserId: string,
  subjectUserId: string | null,
): MoneyDecision {
  const gate = decideMoneyWrite(membership);
  if (!gate.ok || membership === null) return gate;
  if (
    subjectUserId === actorUserId &&
    !isPermissionBackstop(membership.structuralRole)
  ) {
    return refuse("own_dues");
  }
  return { ok: true };
}

// --- Categories ------------------------------------------------------------

export interface CategoryFacts {
  id: string;
  kind: BudgetCategoryKind;
  name: string;
  plannedCents: number;
  systemKey: string | null;
  archived: boolean;
  sort: number;
}

/** May this name be used for a new or renamed category? Archived names are
 * taken too (the unique index spans them): restore by re-adding is not a
 * thing, a camp picks a different name. */
export function decideCategoryName(
  existing: readonly Pick<CategoryFacts, "id" | "name">[],
  name: string,
  excludeId: string | null = null,
): MoneyDecision {
  const key = normalizeCategoryName(name);
  const clash = existing.some(
    (c) => c.id !== excludeId && normalizeCategoryName(c.name) === key,
  );
  return clash ? refuse("category_name_taken") : { ok: true };
}

/** Removing a category: deleted when nothing uses it, archived otherwise
 * (the books keep every amount). The dues category is never removed. */
export function decideCategoryRemoval(
  category: Pick<CategoryFacts, "systemKey" | "archived">,
  used: boolean,
): MoneyDecision<{ action: "delete" | "archive" }> {
  if (category.systemKey === DUES_CATEGORY_KEY) {
    return refuse("dues_category_remove");
  }
  if (category.archived) return refuse("category_archived");
  return { ok: true, action: used ? "archive" : "delete" };
}

/** An entry's category and status: a live category of this camp; never the
 * dues category (dues come from the Dues tab); income is only ever received. */
export function decideEntry(
  category: Pick<CategoryFacts, "kind" | "systemKey" | "archived"> | null,
  status: BudgetEntryStatus,
  opts: {
    /** A correction that leaves the entry in the category it is already
     * filed under. A removed (archived) category takes no NEW entries, but
     * the ones it kept must stay correctable — committed → paid, a wrong
     * amount — or the books keep counting them wrong. */
    keepsCategory?: boolean;
  } = {},
): MoneyDecision {
  if (!category) return refuse("category_missing");
  if (category.archived && !opts.keepsCategory) {
    return refuse("category_archived");
  }
  if (category.systemKey === DUES_CATEGORY_KEY) {
    return refuse("dues_category_entry");
  }
  if (category.kind === "income" && status === "committed") {
    return refuse("committed_income");
  }
  return { ok: true };
}

/** A claim's category, when one is named: a live SPENDING category. */
export function decideClaimCategory(
  category: Pick<CategoryFacts, "kind" | "archived"> | null,
): MoneyDecision {
  if (!category) return refuse("category_missing");
  if (category.archived) return refuse("category_archived");
  if (category.kind !== "expense") return refuse("category_not_expense");
  return { ok: true };
}

// --- Claims: the state machine ---------------------------------------------

/**
 * submitted → approved | rejected; approved → repaid. Two corrections go
 * back one step (Ryan, 14 Oct 2026, "allow reopen"): a rejected claim is
 * reopened (→ submitted, to be decided again) and a repaid claim's "repaid"
 * is undone (→ approved). Nothing else goes back — an approval is not
 * reopened. Each is a correction by a money person who is not the claimant,
 * and the audit row keeps the decision it replaced. A withdrawn claim (its
 * author, while `submitted`) is deleted, so it has no state of its own.
 */
export const CLAIM_TRANSITIONS: Record<
  CampClaimStatus,
  readonly CampClaimStatus[]
> = {
  submitted: ["approved", "rejected"],
  approved: ["repaid"],
  rejected: ["submitted"],
  repaid: ["approved"],
};

export function canTransitionClaim(
  from: CampClaimStatus,
  to: CampClaimStatus,
): boolean {
  return CLAIM_TRANSITIONS[from].includes(to);
}

export type ClaimAction =
  | "approve"
  | "reject"
  | "repay"
  | "withdraw"
  /** rejected → submitted: decide it again. */
  | "reopen"
  /** repaid → approved: the EFT was recorded in error. */
  | "undo_repaid";

export interface ClaimActor {
  userId: string;
  membership: PermissionMembership | null;
}

export interface ClaimFacts {
  claimantUserId: string | null;
  status: CampClaimStatus;
  categoryId: string | null;
}

/**
 * Who may move a claim, and to what. `category` is the category the claim
 * will be filed under after the action (an approval may name one) — only
 * read for `approve`. `next: null` means the claim is deleted (withdrawn).
 *
 * The author rule comes FIRST for every money decision: a money person's own
 * claim is decided by another money person or a lead — never by its author,
 * not even to mark it repaid (they would be recording that they paid
 * themselves), and not to reopen a rejection or undo a "repaid" on it.
 *
 * Every refusal on status is decided from what the row says NOW (the store
 * locks it and compare-and-sets on the status it decided from), so two money
 * people acting at once: the second one is refused here, or loses the CAS.
 */
export function decideClaimAction(input: {
  action: ClaimAction;
  actor: ClaimActor;
  claim: ClaimFacts;
  category?: Pick<CategoryFacts, "kind" | "archived"> | null;
}): MoneyDecision<{ next: CampClaimStatus | null }> {
  const { action, actor, claim } = input;
  if (actor.membership === null) return refuse("not_member");
  const isAuthor =
    claim.claimantUserId !== null && claim.claimantUserId === actor.userId;

  if (action === "withdraw") {
    if (!isAuthor) return refuse("not_your_claim");
    if (claim.status !== "submitted") return refuse("claim_already_decided");
    return { ok: true, next: null };
  }

  if (!canManageMoney(actor.membership)) return refuse("not_money_person");
  if (isAuthor) return refuse("own_claim");

  if (action === "reopen") {
    if (claim.status !== "rejected") return refuse("claim_changed");
    return { ok: true, next: "submitted" };
  }

  if (action === "undo_repaid") {
    if (claim.status !== "repaid") return refuse("claim_changed");
    return { ok: true, next: "approved" };
  }

  if (action === "repay") {
    if (claim.status !== "approved") {
      return refuse(
        claim.status === "submitted"
          ? "claim_not_approved"
          : "claim_already_decided",
      );
    }
    return { ok: true, next: "repaid" };
  }

  if (claim.status !== "submitted") return refuse("claim_already_decided");
  if (action === "reject") return { ok: true, next: "rejected" };

  // approve: it must end up filed under a live spending category.
  if (input.category === undefined || input.category === null) {
    return refuse(
      claim.categoryId === null ? "claim_needs_category" : "category_missing",
    );
  }
  const filed = decideClaimCategory(input.category);
  if (!filed.ok) return filed;
  return { ok: true, next: "approved" };
}

// --- The budget's status ------------------------------------------------------

export type BudgetAction = "approve" | "reopen";

/**
 * draft → approved (sign-off) and approved → draft ("Back to draft", Ryan,
 * 14 Oct 2026). Money people only; decided from the status the store locked,
 * and the UPDATE compare-and-sets on it, so of two at once one wins.
 */
export function decideBudgetAction(input: {
  action: BudgetAction;
  membership: PermissionMembership | null;
  status: CampBudgetStatus;
}): MoneyDecision<{ next: CampBudgetStatus }> {
  const gate = decideMoneyWrite(input.membership);
  if (!gate.ok) return gate;
  if (input.action === "approve") {
    return input.status === "draft"
      ? { ok: true, next: "approved" }
      : refuse("budget_already_approved");
  }
  return input.status === "approved"
    ? { ok: true, next: "draft" }
    : refuse("budget_not_approved");
}

// --- Derived figures (the books) -------------------------------------------

export interface EntryFacts {
  categoryId: string;
  amountCents: number;
  status: BudgetEntryStatus;
}

export interface ClaimAmountFacts {
  categoryId: string | null;
  amountCents: number;
  status: CampClaimStatus;
}

export interface MoneyBooksFacts {
  contingencyPct: number;
  /** Every category of the camp's edition, archived ones included. */
  categories: readonly CategoryFacts[];
  entries: readonly EntryFacts[];
  claims: readonly ClaimAmountFacts[];
  /** Sum of every `dues_payments` row this edition. */
  duesReceivedCents: number;
  /** Current members (active, non-deleted) — the cost-per-camper divisor. */
  currentMemberCount: number;
}

export interface CategoryFigures {
  /** Null only for the synthesised "Uncategorised" row (never expected:
   * an approved claim always has a category — a CHECK says so). */
  id: string | null;
  kind: BudgetCategoryKind;
  name: string;
  systemKey: string | null;
  archived: boolean;
  /** Archived categories plan nothing: their planned amount is not counted. */
  plannedCents: number;
  /** Paid entries + approved/repaid claims (spending); received entries +
   * dues received (income). */
  actualCents: number;
  committedCents: number;
  /** planned − (actual + committed). Negative = over plan / above plan. */
  varianceCents: number;
  /** max(planned, actual + committed) — BUDGET-006 forecast. */
  forecastCents: number;
  /** Anything planned, spent, committed or received. */
  hasActivity: boolean;
}

export interface MoneyTotals {
  plannedSpendCents: number;
  plannedIncomeCents: number;
  actualSpendCents: number;
  committedSpendCents: number;
  actualIncomeCents: number;
  /** Σ forecast over spending categories (BUDGET-058). */
  projectedSpendCents: number;
  /** Σ forecast over income categories (BUDGET-057). */
  projectedIncomeCents: number;
  contingencyPct: number;
  /** contingency_pct of PLANNED spend (BUDGET-011). */
  contingencyCents: number;
  /** projected income − projected spend − contingency (BUDGET-012). */
  surplusCents: number;
  /** planned − (actual + committed) over spending. */
  spendVarianceCents: number;
  /** planned − actual over income. */
  incomeVarianceCents: number;
  /** Approved, not yet repaid: what the camp owes members. */
  claimsOwedCents: number;
  claimsOwedCount: number;
  claimsRepaidCents: number;
  claimsRepaidCount: number;
  claimsSubmittedCents: number;
  claimsSubmittedCount: number;
  claimsRejectedCount: number;
  /** Income received − spending paid − claims repaid (BUDGET-008, 061). */
  cashAvailableCents: number;
  /** Projected spend ÷ current members, rounded to the cent; null with no
   * members (BUDGET-010, 059). */
  costPerCamperCents: number | null;
  currentMemberCount: number;
}

export interface MoneyBooks {
  /** Spending first, then income; each in the camp's own order. */
  categories: CategoryFigures[];
  totals: MoneyTotals;
}

function countsAsSpent(status: CampClaimStatus): boolean {
  return status === "approved" || status === "repaid";
}

/** The whole books, from the rows. Every figure on M1, M2's totals and M4. */
export function deriveMoneyBooks(facts: MoneyBooksFacts): MoneyBooks {
  const rows = new Map<string, CategoryFigures>();
  const ordered = [...facts.categories].sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === "expense" ? -1 : 1) ||
      a.sort - b.sort ||
      a.name.localeCompare(b.name),
  );
  for (const c of ordered) {
    rows.set(c.id, {
      id: c.id,
      kind: c.kind,
      name: c.name,
      systemKey: c.systemKey,
      archived: c.archived,
      plannedCents: c.archived ? 0 : c.plannedCents,
      actualCents: 0,
      committedCents: 0,
      varianceCents: 0,
      forecastCents: 0,
      hasActivity: false,
    });
  }
  const extra: { uncategorised: CategoryFigures | null } = {
    uncategorised: null,
  };
  const rowFor = (id: string | null): CategoryFigures => {
    const found = id === null ? undefined : rows.get(id);
    if (found) return found;
    extra.uncategorised ??= {
      id: null,
      kind: "expense",
      name: "Uncategorised",
      systemKey: null,
      archived: false,
      plannedCents: 0,
      actualCents: 0,
      committedCents: 0,
      varianceCents: 0,
      forecastCents: 0,
      hasActivity: false,
    };
    return extra.uncategorised;
  };

  for (const e of facts.entries) {
    const row = rowFor(e.categoryId);
    if (e.status === "paid") row.actualCents += e.amountCents;
    else row.committedCents += e.amountCents;
  }

  let claimsOwedCents = 0;
  let claimsOwedCount = 0;
  let claimsRepaidCents = 0;
  let claimsRepaidCount = 0;
  let claimsSubmittedCents = 0;
  let claimsSubmittedCount = 0;
  let claimsRejectedCount = 0;
  for (const c of facts.claims) {
    if (countsAsSpent(c.status))
      rowFor(c.categoryId).actualCents += c.amountCents;
    if (c.status === "approved") {
      claimsOwedCents += c.amountCents;
      claimsOwedCount += 1;
    } else if (c.status === "repaid") {
      claimsRepaidCents += c.amountCents;
      claimsRepaidCount += 1;
    } else if (c.status === "submitted") {
      claimsSubmittedCents += c.amountCents;
      claimsSubmittedCount += 1;
    } else {
      claimsRejectedCount += 1;
    }
  }

  const duesRow = [...rows.values()].find(
    (r) => r.systemKey === DUES_CATEGORY_KEY,
  );
  if (duesRow) duesRow.actualCents += facts.duesReceivedCents;

  const all: CategoryFigures[] = [...rows.values()];
  if (extra.uncategorised) all.push(extra.uncategorised);
  // The dues category missing (never expected — it cannot be removed) must
  // not make dues received vanish from the books.
  const orphanDues = duesRow ? 0 : facts.duesReceivedCents;

  for (const r of all) {
    const spent = r.actualCents + r.committedCents;
    r.varianceCents = r.plannedCents - spent;
    r.forecastCents = Math.max(r.plannedCents, spent);
    r.hasActivity = r.plannedCents > 0 || spent > 0;
  }

  const sum = (
    kind: BudgetCategoryKind,
    pick: (r: CategoryFigures) => number,
  ) => all.filter((r) => r.kind === kind).reduce((n, r) => n + pick(r), 0);

  const plannedSpendCents = sum("expense", (r) => r.plannedCents);
  const plannedIncomeCents = sum("income", (r) => r.plannedCents);
  const actualSpendCents = sum("expense", (r) => r.actualCents);
  const committedSpendCents = sum("expense", (r) => r.committedCents);
  const actualIncomeCents = sum("income", (r) => r.actualCents) + orphanDues;
  const projectedSpendCents = sum("expense", (r) => r.forecastCents);
  const projectedIncomeCents =
    sum("income", (r) => r.forecastCents) + orphanDues;
  const contingencyPct = facts.contingencyPct;
  const contingencyCents = Math.round(
    (plannedSpendCents * contingencyPct) / 100,
  );
  const surplusCents =
    projectedIncomeCents - projectedSpendCents - contingencyCents;
  const spendPaidCents = actualSpendCents - claimsOwedCents - claimsRepaidCents;
  const cashAvailableCents =
    actualIncomeCents - spendPaidCents - claimsRepaidCents;

  return {
    categories: all,
    totals: {
      plannedSpendCents,
      plannedIncomeCents,
      actualSpendCents,
      committedSpendCents,
      actualIncomeCents,
      projectedSpendCents,
      projectedIncomeCents,
      contingencyPct,
      contingencyCents,
      surplusCents,
      spendVarianceCents:
        plannedSpendCents - actualSpendCents - committedSpendCents,
      incomeVarianceCents: plannedIncomeCents - actualIncomeCents,
      claimsOwedCents,
      claimsOwedCount,
      claimsRepaidCents,
      claimsRepaidCount,
      claimsSubmittedCents,
      claimsSubmittedCount,
      claimsRejectedCount,
      cashAvailableCents,
      costPerCamperCents:
        facts.currentMemberCount > 0
          ? Math.round(projectedSpendCents / facts.currentMemberCount)
          : null,
      currentMemberCount: facts.currentMemberCount,
    },
  };
}

/** What every current member sees — the open-books card (M4), and nothing
 * else: no claims owed, no dues outstanding, no per-category lines. */
export interface MemberMoneyTotals {
  plannedSpendCents: number;
  actualSpendCents: number;
  committedSpendCents: number;
  actualIncomeCents: number;
  surplusCents: number;
  contingencyPct: number;
}

export function memberMoneyTotals(totals: MoneyTotals): MemberMoneyTotals {
  return {
    plannedSpendCents: totals.plannedSpendCents,
    actualSpendCents: totals.actualSpendCents,
    committedSpendCents: totals.committedSpendCents,
    actualIncomeCents: totals.actualIncomeCents,
    surplusCents: totals.surplusCents,
    contingencyPct: totals.contingencyPct,
  };
}

export type VarianceTone =
  "on_plan" | "left" | "over" | "to_come" | "above_plan";

/** How a category's variance reads (M1): spending "R … left" / "On plan" /
 * "−R …" OVER; income "R … to come" / "+R … above plan". */
export function describeVariance(
  kind: BudgetCategoryKind,
  varianceCents: number,
): { tone: VarianceTone; text: string } {
  if (varianceCents === 0) return { tone: "on_plan", text: "On plan" };
  if (kind === "expense") {
    return varianceCents > 0
      ? { tone: "left", text: `${formatRand(varianceCents)} left` }
      : { tone: "over", text: formatRand(varianceCents) };
  }
  return varianceCents > 0
    ? { tone: "to_come", text: `${formatRand(varianceCents)} to come` }
    : {
        tone: "above_plan",
        text: `+${formatRand(-varianceCents)} above plan`,
      };
}

// --- Dues --------------------------------------------------------------------

export type DuesStanding = "current" | "former" | "deleted";

export interface DuesMemberFacts {
  userId: string | null;
  standing: DuesStanding;
  /** `member_dues.amount_cents`, or null = the camp fee. */
  overrideCents: number | null;
  /** Sum of this member's `dues_payments` this edition. */
  receivedCents: number;
}

export interface DuesFigures {
  owedCents: number;
  receivedCents: number;
  /** max(0, owed − received). */
  outstandingCents: number;
  /** max(0, received − owed): money in beyond what was owed. */
  overpaidCents: number;
  status: DuesStatus;
  /** True when the camp fee applies (no amount set for this member). */
  isCampFee: boolean;
}

/**
 * awaiting | part paid | paid | waived | no fee. Owing R 0,00 is "waived"
 * only when that amount was SET for the member; a member on the camp fee
 * while the camp fee is still R 0,00 has "no fee" yet — reading that as
 * waived would tell every member of a new camp their dues were waived.
 */
export function duesStatus(
  owedCents: number,
  receivedCents: number,
  onCampFee = false,
): DuesStatus {
  if (owedCents === 0) {
    if (!onCampFee) return "waived";
    return receivedCents > 0 ? "paid" : "no_fee";
  }
  if (receivedCents <= 0) return "awaiting";
  if (receivedCents < owedCents) return "part_paid";
  return "paid";
}

export function memberDuesFigures(
  campFeeCents: number,
  member: Pick<DuesMemberFacts, "overrideCents" | "receivedCents">,
): DuesFigures {
  const owedCents = member.overrideCents ?? campFeeCents;
  const receivedCents = member.receivedCents;
  return {
    owedCents,
    receivedCents,
    outstandingCents: Math.max(0, owedCents - receivedCents),
    overpaidCents: Math.max(0, receivedCents - owedCents),
    status: duesStatus(owedCents, receivedCents, member.overrideCents === null),
    isCampFee: member.overrideCents === null,
  };
}

/**
 * Who is on the dues list. Every current member. A former member or a deleted
 * account only when the camp's books already name them (an amount set, or
 * money received) — the books must add up, and someone who left without
 * either owes nothing this app should chase.
 */
export function onDuesList(member: {
  standing: DuesStanding;
  hasOverride: boolean;
  hasPayments: boolean;
}): boolean {
  if (member.standing === "current") return true;
  return member.hasOverride || member.hasPayments;
}

export interface DuesSummary {
  memberCount: number;
  currentCount: number;
  formerCount: number;
  owedCents: number;
  receivedCents: number;
  outstandingCents: number;
  /** Members with something outstanding. */
  membersOwing: number;
  byStatus: Record<DuesStatus, number>;
}

/** The M2 "Dues for 2027" card. */
export function summariseDues(
  campFeeCents: number,
  members: readonly DuesMemberFacts[],
): DuesSummary {
  const byStatus: Record<DuesStatus, number> = {
    awaiting: 0,
    part_paid: 0,
    paid: 0,
    waived: 0,
    no_fee: 0,
  };
  let owedCents = 0;
  let receivedCents = 0;
  let outstandingCents = 0;
  let membersOwing = 0;
  let currentCount = 0;
  for (const m of members) {
    const f = memberDuesFigures(campFeeCents, m);
    owedCents += f.owedCents;
    receivedCents += f.receivedCents;
    outstandingCents += f.outstandingCents;
    if (f.outstandingCents > 0) membersOwing += 1;
    byStatus[f.status] += 1;
    if (m.standing === "current") currentCount += 1;
  }
  return {
    memberCount: members.length,
    currentCount,
    formerCount: members.length - currentCount,
    owedCents,
    receivedCents,
    outstandingCents,
    membersOwing,
    byStatus,
  };
}

export const DUES_STATUS_LABELS: Record<DuesStatus, string> = {
  awaiting: "Awaiting",
  part_paid: "Part paid",
  paid: "Paid",
  waived: "Waived",
  no_fee: "No fee set",
};

export const CLAIM_STATUS_LABELS: Record<CampClaimStatus, string> = {
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  repaid: "Repaid",
};

export const BUDGET_STATUS_LABELS: Record<CampBudgetStatus, string> = {
  draft: "Draft",
  approved: "Approved",
};

/** The name a money row shows for a person: their public name, or "Deleted
 * account" when the account was erased (amounts stay, the person does not). */
export function moneyMemberName(
  publicName: string | null,
  options: { sanitizedAt: Date | null; userId: string | null },
): string {
  if (options.userId === null || options.sanitizedAt !== null) {
    return MONEY_DELETED_ACCOUNT;
  }
  return publicName?.trim() || MONEY_DELETED_ACCOUNT;
}

// --- Amounts ----------------------------------------------------------------

const NBSP = " ";
const MINUS = "−";

/**
 * en-ZA rand, whole cents in: "R 1 250,00", "−R 2 025,00". Done by hand rather
 * than with `Intl.NumberFormat` so server and browser (different ICU builds)
 * render the same string — a hydration mismatch on every money figure
 * otherwise. Spaces are non-breaking so "R" never wraps away from its number.
 */
export function formatRand(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const rands = Math.floor(abs / 100).toString();
  const rest = (abs % 100).toString().padStart(2, "0");
  const grouped = rands.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${negative ? MINUS : ""}R${NBSP}${grouped},${rest}`;
}

/**
 * What someone typed into an amount field → whole cents, or null when it is
 * not an amount. Accepts "R 1 500,00", "1500", "1 500.5", "1,500.00",
 * "R1500,50". A separator followed by one or two final digits is the decimal
 * point; any other separator groups thousands. Negative amounts are refused:
 * a record of money received or spent is never below zero.
 */
export function parseRandToCents(input: string): number | null {
  const cleaned = input
    .replace(/\s/g, "") // \s covers NBSP and the narrow NBSP too
    .replace(/^R/i, "")
    .trim();
  if (cleaned === "" || !/^[\d.,]+$/.test(cleaned)) return null;
  const decimal = /[.,](\d{1,2})$/.exec(cleaned);
  const wholePart = decimal ? cleaned.slice(0, decimal.index) : cleaned;
  if (!/^\d{1,3}([.,]?\d{3})*$/.test(wholePart) && !/^\d+$/.test(wholePart)) {
    return null;
  }
  const whole = Number(wholePart.replace(/[.,]/g, ""));
  const fraction = decimal ? Number(decimal[1]!.padEnd(2, "0")) : 0;
  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(cents) ? cents : null;
}

// --- Receipts --------------------------------------------------------------

/** Photo or PDF (M1 / M4 "Add the receipt"). Sniffed from the bytes. */
export const RECEIPT_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;
export type ReceiptContentType = (typeof RECEIPT_CONTENT_TYPES)[number];

/** A phone photo of a till slip or a PDF invoice fits comfortably. 4 MB, not
 * more: the upload is one multipart POST to a Vercel function, whose request
 * body is capped at 4.5 MB — a larger limit here would be refused by the
 * platform before this check could explain why. */
export const RECEIPT_MAX_BYTES = 4 * 1024 * 1024;

function startsWith(bytes: Uint8Array, signature: readonly number[], at = 0) {
  if (bytes.length < at + signature.length) return false;
  return signature.every((b, i) => bytes[at + i] === b);
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG = [0xff, 0xd8, 0xff] as const;
const RIFF = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP = [0x57, 0x45, 0x42, 0x50] as const;
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d] as const; // "%PDF-"

/** The format these bytes actually are, from the magic number only — never
 * a filename or a declared type. SVG, HTML and everything else: null. */
export function sniffReceiptType(bytes: Uint8Array): ReceiptContentType | null {
  if (startsWith(bytes, PNG)) return "image/png";
  if (startsWith(bytes, JPEG)) return "image/jpeg";
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8))
    return "image/webp";
  if (startsWith(bytes, PDF)) return "application/pdf";
  return null;
}

export type ReceiptCheck =
  | { ok: true; contentType: ReceiptContentType }
  | { ok: false; status: 400 | 413 | 415; error: string };

export function checkReceiptUpload(bytes: Uint8Array): ReceiptCheck {
  if (bytes.length === 0) {
    return { ok: false, status: 400, error: "That file is empty." };
  }
  if (bytes.length > RECEIPT_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      error: "That receipt is larger than 4 MB. Try a smaller photo.",
    };
  }
  const contentType = sniffReceiptType(bytes);
  if (!contentType) {
    return {
      ok: false,
      status: 415,
      error: "Upload a photo (PNG, JPEG or WebP) or a PDF.",
    };
  }
  return { ok: true, contentType };
}

/** Every receipt of a camp lives under this private prefix. */
export function campReceiptPrefix(groupId: string): string {
  return `camp-receipts/${groupId}/`;
}

/** True when a stored key sits under THIS camp's prefix — the guard before
 * any read or delete, so a corrupted key never reaches another camp's file. */
export function isCampReceiptKey(groupId: string, key: string): boolean {
  return key.startsWith(campReceiptPrefix(groupId)) && !key.includes("..");
}

const RECEIPT_EXTENSION: Record<ReceiptContentType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/** The blob pathname for a new receipt (the store adds a random suffix). */
export function campReceiptPath(
  groupId: string,
  contentType: ReceiptContentType,
): string {
  return `${campReceiptPrefix(groupId)}receipt.${RECEIPT_EXTENSION[contentType]}`;
}

/** The tile label on M3/M4: "JPG", "PDF". */
export function receiptLabel(contentType: string): string {
  if (contentType === "application/pdf") return "PDF";
  if (contentType === "image/png") return "PNG";
  if (contentType === "image/webp") return "WEBP";
  return "JPG";
}

export function isReceiptContentType(
  value: string,
): value is ReceiptContentType {
  return (RECEIPT_CONTENT_TYPES as readonly string[]).includes(value);
}

// --- Notifications ---------------------------------------------------------
// Kind `money`, in-app only (`shouldSendImmediateEmail("money")` is false).
// Titles carry amounts and the camp; never a claim's description (erasure
// clears descriptions, and a copy in an inbox would outlive it).

export interface MoneyNoticeContext {
  campName: string;
  campSlug: string;
}

export type MoneyTab = "budget" | "dues" | "claims";

/** The money page, optionally on a tab. */
export function moneyPath(slug: string, tab?: MoneyTab): string {
  const base = `/camps/${slug}/money`;
  return tab && tab !== "budget" ? `${base}?tab=${tab}` : base;
}

function moneyNotice(
  c: MoneyNoticeContext,
  title: string,
  body: string = c.campName,
  link: string = moneyPath(c.campSlug),
): NotificationPayload {
  return { kind: "money", title, body, link };
}

/** To the member: their dues were set, changed, waived or put back to the
 * camp fee. `onCampFee`: the amount is the camp fee, not one set for this
 * member — so R 0,00 there means "no fee set yet", never "waived" (waived is
 * R 0,00 set for the member with a reason; `duesStatus`). */
export function duesSetNotification(
  c: MoneyNoticeContext,
  owedCents: number,
  opts: { onCampFee: boolean },
): NotificationPayload {
  return moneyNotice(
    c,
    owedCents !== 0
      ? `Your camp dues are now ${formatRand(owedCents)}`
      : opts.onCampFee
        ? "Your camp hasn't set its fee yet — you owe nothing for now"
        : "Your camp dues were waived",
  );
}

/** To the member: a money person recorded money from them as received. */
export function duesPaymentRecordedNotification(
  c: MoneyNoticeContext,
  amountCents: number,
  outstandingCents: number,
): NotificationPayload {
  return moneyNotice(
    c,
    `The camp recorded ${formatRand(amountCents)} received from you`,
    outstandingCents > 0
      ? `${c.campName} · ${formatRand(outstandingCents)} still to pay`
      : `${c.campName} · your dues are paid up`,
  );
}

/** To the camp's money people (not the claimant): a claim to decide. */
export function claimSubmittedNotification(
  c: MoneyNoticeContext,
  claimantName: string,
  amountCents: number,
): NotificationPayload {
  return moneyNotice(
    c,
    `${claimantName} claimed ${formatRand(amountCents)}`,
    c.campName,
    moneyPath(c.campSlug, "claims"),
  );
}

export function claimApprovedNotification(
  c: MoneyNoticeContext,
  amountCents: number,
): NotificationPayload {
  return moneyNotice(
    c,
    `Your claim for ${formatRand(amountCents)} was approved`,
    `${c.campName} · the camp repays you by EFT`,
  );
}

/** The decision note is NOT copied here: it lives on the claim (shown to
 * the claimant there), and account erasure clears it from the claim — a copy
 * in `notifications`, which erasure preserves, would outlive it. The notice
 * points at the claim instead. */
export function claimRejectedNotification(
  c: MoneyNoticeContext,
  amountCents: number,
): NotificationPayload {
  return moneyNotice(
    c,
    `Your ${c.campName} claim for ${formatRand(amountCents)} was rejected`,
    `${c.campName} · open the claim to read why`,
  );
}

/** To the claimant: their rejected claim is back in the queue. */
export function claimReopenedNotification(
  c: MoneyNoticeContext,
  amountCents: number,
): NotificationPayload {
  return moneyNotice(
    c,
    `Your claim for ${formatRand(amountCents)} was reopened`,
    `${c.campName} · it waits for a decision again`,
  );
}

/** To the claimant: "repaid" was recorded in error; still owed to them. */
export function claimRepaidUndoneNotification(
  c: MoneyNoticeContext,
  amountCents: number,
): NotificationPayload {
  return moneyNotice(
    c,
    `Your claim for ${formatRand(amountCents)} is no longer marked repaid`,
    `${c.campName} · the camp still owes you`,
  );
}

export function claimRepaidNotification(
  c: MoneyNoticeContext,
  amountCents: number,
): NotificationPayload {
  return moneyNotice(
    c,
    `Your claim for ${formatRand(amountCents)} was marked repaid`,
  );
}
