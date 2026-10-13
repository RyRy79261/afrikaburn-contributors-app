import "server-only";

import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { activeMembership } from "@quagga/db";
import {
  canManageMoney,
  canViewMemberMoney,
  canViewMoneyTotals,
  canViewReceipt,
  checkReceiptUpload,
  claimApprovedNotification,
  claimRejectedNotification,
  claimRepaidNotification,
  claimSubmittedNotification,
  decideCategoryName,
  decideCategoryRemoval,
  decideClaimAction,
  decideClaimCategory,
  decideEntry,
  decideMoneyWrite,
  deriveMoneyBooks,
  duesPaymentRecordedNotification,
  duesSetNotification,
  enforceKindPermissions,
  isReceiptContentType,
  memberDuesFigures,
  memberMoneyTotals,
  MONEY_AUDIT,
  MONEY_STARTER_CATEGORIES,
  moneyAvailableForGroup,
  moneyMemberName,
  moneyRefusalMessage,
  normalizeCategoryName,
  onDuesList,
  publicMemberName,
  receiptLabel,
  summariseDues,
  type CategoryFacts,
  type ClaimAction,
  type DuesFigures,
  type DuesMemberFacts,
  type DuesStanding,
  type DuesSummary,
  type MemberMoneyTotals,
  type MoneyBooks,
  type MoneyNoticeContext,
  type MoneyRefusal,
  type NotificationPayload,
  type NotificationRow,
  type PermissionMembership,
  type ReceiptContentType,
} from "@quagga/core";
import {
  MONEY_MAX_CATEGORIES,
  type AddBudgetCategoryInput,
  type AddBudgetEntryInput,
  type ApproveClaimInput,
  type BudgetCategoryKind,
  type BudgetEntryStatus,
  type CampBudgetStatus,
  type CampClaimStatus,
  type DuesStatus,
  type GroupKind,
  type MarkClaimRepaidInput,
  type MembershipRole,
  type ProjectPermissions,
  type ReceiptSubjectKind,
  type RecordDuesPaymentInput,
  type RejectClaimInput,
  type RenameBudgetCategoryInput,
  type SetBudgetPlanInput,
  type SubmitClaimInput,
  type UpdateBudgetEntryInput,
} from "@quagga/types";
import { db, schema, withTransaction, type Tx } from "./db";
import { insertNotifications } from "./notifications";
import { getMemberPermissions } from "./roles-store";
import {
  deleteReceiptBlobQuietly,
  isReceiptStorageConfigured,
  putReceiptBlob,
} from "./camp-receipt-blob";

// Camp money: budget, dues and claims (docs/camp-budget-spec.md). Every rule
// is a pure @quagga/core function (packages/core/src/camp-budget.ts); this
// file loads the facts those functions read — from the database, never from
// the request — and performs the writes.
//
// RECORDS, NEVER TRANSACTIONS. Nothing here moves money (Decision 009). A
// "payment" row is a money person's record of money already received in the
// camp's own account; a "repaid" claim is a record that the camp paid a
// member back by EFT, outside the app.
//
// SCOPING. A request names a camp by slug and then only ids. The caller's
// membership is resolved for that camp (`loadMoneyAccess` for reads,
// `lockMoneyActor` inside every write), and every id — category, entry,
// claim, payment, member — is resolved INSIDE that camp and edition, so an id
// from another camp answers exactly like one that does not exist.
// Non-members get null from every read; the pages turn that into the camp's
// ordinary not-found.
//
// PRIVACY. Members see the totals (`memberMoneyTotals`) and their OWN dues,
// payments and claims. Every other member's figures, every claim and every
// note are loaded only after `canManageMoney` said yes. A payment's note is
// the money person's and is never shown to the member it concerns.
//
// RACES. Every write runs in ONE transaction that first locks the actor's
// membership and user row `FOR SHARE` (an archive, a demotion or an account
// erasure that committed first is what it sees), then the rows the decision
// depends on: the budget row for plan writes, the category for anything filed
// under it (`FOR SHARE`, so a concurrent remove waits), the claim
// `FOR UPDATE` for every claim decision (and the UPDATE is compare-and-set on
// the status it decided from), the subject's user row for dues writes. The
// starter categories are written once by a compare-and-set on
// `camp_budgets.categories_seeded_at`, like shift teams.
//
// AUDIT. Every money write inserts an `audit_events` row in the same
// transaction: ids, amounts, dates and statuses only — never a description or
// a note, so account erasure has nothing personal to chase into the trail.
//
// NOTIFICATIONS (kind `money`, in-app only) go out AFTER commit, best effort:
// a failed notice never un-does a money record.

export type MoneyResult<T = object> =
  ({ ok: true } & T) | { ok: false; error: string };

type Handle = Tx | ReturnType<typeof db>;

const MISSING_CLAIM = "That claim doesn't exist.";
const MISSING_ENTRY = "That entry doesn't exist.";
const MISSING_PAYMENT = "That payment doesn't exist.";
const NAME_TAKEN = moneyRefusalMessage("category_name_taken");
const NO_RECEIPT_STORE =
  "Receipt uploads aren't configured on this deployment. Save it without the receipt for now.";

function refused(reason: MoneyRefusal): { ok: false; error: string } {
  return { ok: false, error: moneyRefusalMessage(reason) };
}

function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    if ((e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

// --- Access ----------------------------------------------------------------

export interface MoneyCamp {
  id: string;
  name: string;
  slug: string;
  kind: GroupKind;
}

/** The edition the money page describes (the active one). */
export interface MoneyEdition {
  id: string;
  year: number;
}

export interface MoneyAccess {
  camp: MoneyCamp;
  viewerUserId: string;
  membership: PermissionMembership;
  isMoneyPerson: boolean;
}

/**
 * The viewer's access to a camp's money, or null — not a theme camp, not a
 * member (an archived member is not a member), or no such camp. Every read
 * below takes the result of this, never a slug or a group id on its own.
 */
export async function loadMoneyAccess(
  slug: string,
  viewerUserId: string,
): Promise<MoneyAccess | null> {
  const [group] = await db()
    .select({
      id: schema.groups.id,
      name: schema.groups.name,
      slug: schema.groups.slug,
      kind: schema.groups.kind,
    })
    .from(schema.groups)
    .where(eq(schema.groups.slug, slug))
    .limit(1);
  if (!group || !moneyAvailableForGroup(group.kind)) return null;
  const membership = await getMemberPermissions(group.id, viewerUserId);
  if (!membership || !canViewMoneyTotals(membership)) return null;
  return {
    camp: group,
    viewerUserId,
    membership,
    isMoneyPerson: canManageMoney(membership),
  };
}

// --- Shared reads -----------------------------------------------------------

export interface BudgetSettingsView {
  defaultDuesCents: number;
  paymentInstructions: string | null;
  contingencyPct: number;
  status: CampBudgetStatus;
  approvedAt: Date | null;
  approvedByName: string | null;
}

const NO_BUDGET: BudgetSettingsView = {
  defaultDuesCents: 0,
  paymentInstructions: null,
  contingencyPct: 0,
  status: "draft",
  approvedAt: null,
  approvedByName: null,
};

async function loadSettings(
  handle: Handle,
  groupId: string,
  editionId: string,
): Promise<BudgetSettingsView> {
  const [row] = await handle
    .select({
      defaultDuesCents: schema.campBudgets.defaultDuesCents,
      paymentInstructions: schema.campBudgets.paymentInstructions,
      contingencyPct: schema.campBudgets.contingencyPct,
      status: schema.campBudgets.status,
      approvedAt: schema.campBudgets.approvedAt,
      approvedByUserId: schema.campBudgets.approvedByUserId,
      approverUsername: schema.users.username,
      approverSanitizedAt: schema.users.sanitizedAt,
    })
    .from(schema.campBudgets)
    .leftJoin(
      schema.users,
      eq(schema.users.id, schema.campBudgets.approvedByUserId),
    )
    .where(
      and(
        eq(schema.campBudgets.groupId, groupId),
        eq(schema.campBudgets.editionId, editionId),
      ),
    )
    .limit(1);
  if (!row) return NO_BUDGET;
  return {
    defaultDuesCents: row.defaultDuesCents,
    paymentInstructions: row.paymentInstructions,
    contingencyPct: row.contingencyPct,
    status: row.status,
    approvedAt: row.approvedAt,
    approvedByName: row.approvedAt
      ? moneyMemberName(row.approverUsername, {
          sanitizedAt: row.approverSanitizedAt,
          userId: row.approvedByUserId,
        })
      : null,
  };
}

async function loadCategories(
  handle: Handle,
  groupId: string,
  editionId: string,
): Promise<CategoryFacts[]> {
  const rows = await handle
    .select({
      id: schema.budgetCategories.id,
      kind: schema.budgetCategories.kind,
      name: schema.budgetCategories.name,
      plannedCents: schema.budgetCategories.plannedCents,
      systemKey: schema.budgetCategories.systemKey,
      archivedAt: schema.budgetCategories.archivedAt,
      sort: schema.budgetCategories.sort,
    })
    .from(schema.budgetCategories)
    .where(
      and(
        eq(schema.budgetCategories.groupId, groupId),
        eq(schema.budgetCategories.editionId, editionId),
      ),
    )
    .orderBy(
      asc(schema.budgetCategories.sort),
      asc(schema.budgetCategories.createdAt),
    );
  return rows.map(({ archivedAt, ...r }) => ({
    ...r,
    archived: archivedAt !== null,
  }));
}

/** Current members: active, not deleted. The cost-per-camper divisor. */
async function countCurrentMembers(
  handle: Handle,
  groupId: string,
): Promise<number> {
  const [row] = await handle
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.groupId, groupId),
        activeMembership(),
        isNull(schema.users.sanitizedAt),
      ),
    );
  return Number(row?.n ?? 0);
}

async function loadBooks(
  handle: Handle,
  groupId: string,
  editionId: string,
  contingencyPct: number,
): Promise<{ books: MoneyBooks; categories: CategoryFacts[] }> {
  const categories = await loadCategories(handle, groupId, editionId);
  const entries = await handle
    .select({
      categoryId: schema.budgetEntries.categoryId,
      amountCents: schema.budgetEntries.amountCents,
      status: schema.budgetEntries.status,
    })
    .from(schema.budgetEntries)
    .where(
      and(
        eq(schema.budgetEntries.groupId, groupId),
        eq(schema.budgetEntries.editionId, editionId),
      ),
    );
  const claims = await handle
    .select({
      categoryId: schema.campClaims.categoryId,
      amountCents: schema.campClaims.amountCents,
      status: schema.campClaims.status,
    })
    .from(schema.campClaims)
    .where(
      and(
        eq(schema.campClaims.groupId, groupId),
        eq(schema.campClaims.editionId, editionId),
      ),
    );
  const [received] = await handle
    .select({
      total: sql<string>`coalesce(sum(${schema.duesPayments.amountCents}), 0)::bigint`,
    })
    .from(schema.duesPayments)
    .where(
      and(
        eq(schema.duesPayments.groupId, groupId),
        eq(schema.duesPayments.editionId, editionId),
      ),
    );
  const currentMemberCount = await countCurrentMembers(handle, groupId);
  const books = deriveMoneyBooks({
    contingencyPct,
    categories,
    entries,
    claims,
    duesReceivedCents: Number(received?.total ?? 0),
    currentMemberCount,
  });
  return { books, categories };
}

interface PersonName {
  name: string;
  sanitizedAt: Date | null;
}

/** Display names for a set of users, one query. */
async function namesFor(
  handle: Handle,
  userIds: readonly (string | null)[],
): Promise<Map<string, PersonName>> {
  const ids = [...new Set(userIds.filter((u): u is string => u !== null))];
  const out = new Map<string, PersonName>();
  if (ids.length === 0) return out;
  const rows = await handle
    .select({
      id: schema.users.id,
      username: schema.users.username,
      sanitizedAt: schema.users.sanitizedAt,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, ids));
  for (const r of rows) {
    out.set(r.id, {
      name: publicMemberName(r.username, { sanitizedAt: r.sanitizedAt }),
      sanitizedAt: r.sanitizedAt,
    });
  }
  return out;
}

function nameOf(names: Map<string, PersonName>, userId: string | null): string {
  const found = userId ? names.get(userId) : undefined;
  return moneyMemberName(found?.name ?? null, {
    sanitizedAt: found?.sanitizedAt ?? null,
    userId: found ? userId : null,
  });
}

// --- The camp tile and the members' view (frame M4) --------------------------

export interface MoneyTileSummary {
  totals: MemberMoneyTotals;
  ownOutstandingCents: number;
  ownStatus: DuesStatus;
  /** Claims waiting on THIS viewer (money people only; never their own). */
  claimsToDecide: number | null;
}

async function ownDuesFigures(
  handle: Handle,
  groupId: string,
  editionId: string,
  userId: string,
  campFeeCents: number,
): Promise<{ figures: DuesFigures; reason: string | null }> {
  const [override] = await handle
    .select({
      amountCents: schema.memberDues.amountCents,
      reason: schema.memberDues.reason,
    })
    .from(schema.memberDues)
    .where(
      and(
        eq(schema.memberDues.groupId, groupId),
        eq(schema.memberDues.editionId, editionId),
        eq(schema.memberDues.userId, userId),
      ),
    )
    .limit(1);
  const [received] = await handle
    .select({
      total: sql<string>`coalesce(sum(${schema.duesPayments.amountCents}), 0)::bigint`,
    })
    .from(schema.duesPayments)
    .where(
      and(
        eq(schema.duesPayments.groupId, groupId),
        eq(schema.duesPayments.editionId, editionId),
        eq(schema.duesPayments.userId, userId),
      ),
    );
  return {
    figures: memberDuesFigures(campFeeCents, {
      overrideCents: override?.amountCents ?? null,
      receivedCents: Number(received?.total ?? 0),
    }),
    reason: override?.reason ?? null,
  };
}

/** The camp page's Money tile: the open-books totals for everyone, and "You
 * owe R…" for the viewer. */
export async function getMoneyTileSummary(
  access: MoneyAccess,
  edition: MoneyEdition,
): Promise<MoneyTileSummary> {
  const handle = db();
  const groupId = access.camp.id;
  const settings = await loadSettings(handle, groupId, edition.id);
  const { books } = await loadBooks(
    handle,
    groupId,
    edition.id,
    settings.contingencyPct,
  );
  const own = await ownDuesFigures(
    handle,
    groupId,
    edition.id,
    access.viewerUserId,
    settings.defaultDuesCents,
  );
  let claimsToDecide: number | null = null;
  if (access.isMoneyPerson) {
    const [row] = await handle
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.campClaims)
      .where(
        and(
          eq(schema.campClaims.groupId, groupId),
          eq(schema.campClaims.editionId, edition.id),
          eq(schema.campClaims.status, "submitted"),
          or(
            isNull(schema.campClaims.claimantUserId),
            sql`${schema.campClaims.claimantUserId} <> ${access.viewerUserId}`,
          ),
        ),
      );
    claimsToDecide = Number(row?.n ?? 0);
  }
  return {
    totals: memberMoneyTotals(books.totals),
    ownOutstandingCents: own.figures.outstandingCents,
    ownStatus: own.figures.status,
    claimsToDecide,
  };
}

export interface OwnPaymentView {
  id: string;
  receivedOn: string;
  amountCents: number;
  recordedByName: string;
}

export interface OwnClaimView {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  amountCents: number;
  description: string | null;
  status: CampClaimStatus;
  receiptLabel: string | null;
  decidedAt: Date | null;
  decidedByName: string | null;
  decisionNote: string | null;
  repaidOn: string | null;
  createdAt: Date;
  mayWithdraw: boolean;
}

export interface MemberMoneyView {
  totals: MemberMoneyTotals;
  budgetStatus: CampBudgetStatus;
  ownDues: {
    figures: DuesFigures;
    reason: string | null;
    refCode: string | null;
    payments: OwnPaymentView[];
  };
  /** The camp's own "how to pay the camp" text. Instructions only. */
  paymentInstructions: string | null;
  ownClaims: OwnClaimView[];
  /** Live spending categories, for the claim form. */
  claimCategories: { id: string; name: string }[];
  receiptsEnabled: boolean;
}

/** Frame M4: what EVERY current member sees — the totals and their own. */
export async function loadMemberMoney(
  access: MoneyAccess,
  edition: MoneyEdition,
): Promise<MemberMoneyView> {
  const handle = db();
  const groupId = access.camp.id;
  const me = access.viewerUserId;
  const settings = await loadSettings(handle, groupId, edition.id);
  const { books, categories } = await loadBooks(
    handle,
    groupId,
    edition.id,
    settings.contingencyPct,
  );
  const own = await ownDuesFigures(
    handle,
    groupId,
    edition.id,
    me,
    settings.defaultDuesCents,
  );
  const [membership] = await handle
    .select({ refCode: schema.memberships.refCode })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.groupId, groupId),
        eq(schema.memberships.userId, me),
        activeMembership(),
      ),
    )
    .limit(1);
  const payments = await handle
    .select({
      id: schema.duesPayments.id,
      receivedOn: schema.duesPayments.receivedOn,
      amountCents: schema.duesPayments.amountCents,
      recordedByUserId: schema.duesPayments.recordedByUserId,
    })
    .from(schema.duesPayments)
    .where(
      and(
        eq(schema.duesPayments.groupId, groupId),
        eq(schema.duesPayments.editionId, edition.id),
        eq(schema.duesPayments.userId, me),
      ),
    )
    .orderBy(desc(schema.duesPayments.receivedOn));
  const claims = await handle
    .select({
      id: schema.campClaims.id,
      categoryId: schema.campClaims.categoryId,
      amountCents: schema.campClaims.amountCents,
      description: schema.campClaims.description,
      status: schema.campClaims.status,
      receiptContentType: schema.campClaims.receiptContentType,
      decidedAt: schema.campClaims.decidedAt,
      decidedByUserId: schema.campClaims.decidedByUserId,
      decisionNote: schema.campClaims.decisionNote,
      repaidOn: schema.campClaims.repaidOn,
      createdAt: schema.campClaims.createdAt,
    })
    .from(schema.campClaims)
    .where(
      and(
        eq(schema.campClaims.groupId, groupId),
        eq(schema.campClaims.editionId, edition.id),
        eq(schema.campClaims.claimantUserId, me),
      ),
    )
    .orderBy(desc(schema.campClaims.createdAt));
  const names = await namesFor(handle, [
    ...payments.map((p) => p.recordedByUserId),
    ...claims.map((c) => c.decidedByUserId),
  ]);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  return {
    totals: memberMoneyTotals(books.totals),
    budgetStatus: settings.status,
    ownDues: {
      figures: own.figures,
      reason: own.reason,
      refCode: membership?.refCode ?? null,
      payments: payments.map((p) => ({
        id: p.id,
        receivedOn: p.receivedOn,
        amountCents: p.amountCents,
        recordedByName: nameOf(names, p.recordedByUserId),
      })),
    },
    paymentInstructions: settings.paymentInstructions,
    ownClaims: claims.map((c) => ({
      id: c.id,
      categoryId: c.categoryId,
      categoryName: c.categoryId
        ? (categoryName.get(c.categoryId) ?? null)
        : null,
      amountCents: c.amountCents,
      description: c.description,
      status: c.status,
      receiptLabel: c.receiptContentType
        ? receiptLabel(c.receiptContentType)
        : null,
      decidedAt: c.decidedAt,
      decidedByName: c.decidedAt ? nameOf(names, c.decidedByUserId) : null,
      decisionNote: c.decisionNote,
      repaidOn: c.repaidOn,
      createdAt: c.createdAt,
      mayWithdraw: c.status === "submitted",
    })),
    claimCategories: categories
      .filter((c) => c.kind === "expense" && !c.archived)
      .map((c) => ({ id: c.id, name: c.name })),
    receiptsEnabled: isReceiptStorageConfigured(),
  };
}

// --- Money people: the budget (frame M1) ------------------------------------

/**
 * Write the starter category list ONCE per camp per edition: a
 * compare-and-set on `camp_budgets.categories_seeded_at` decides who writes
 * it, so two money people opening the budget at once seed it once, and a
 * camp that removed a starter is never handed it again.
 */
export async function ensureStarterCategories(
  access: MoneyAccess,
  edition: MoneyEdition,
): Promise<void> {
  if (!access.isMoneyPerson) return;
  const groupId = access.camp.id;
  const [budget] = await db()
    .select({ seededAt: schema.campBudgets.categoriesSeededAt })
    .from(schema.campBudgets)
    .where(
      and(
        eq(schema.campBudgets.groupId, groupId),
        eq(schema.campBudgets.editionId, edition.id),
      ),
    )
    .limit(1);
  if (budget?.seededAt) return;
  await withTransaction(async (tx) => {
    await tx
      .insert(schema.campBudgets)
      .values({ groupId, editionId: edition.id })
      .onConflictDoNothing({
        target: [schema.campBudgets.groupId, schema.campBudgets.editionId],
      });
    const claimed = await tx
      .update(schema.campBudgets)
      .set({ categoriesSeededAt: new Date() })
      .where(
        and(
          eq(schema.campBudgets.groupId, groupId),
          eq(schema.campBudgets.editionId, edition.id),
          isNull(schema.campBudgets.categoriesSeededAt),
        ),
      )
      .returning({ id: schema.campBudgets.id });
    if (!claimed[0]) return;
    await tx
      .insert(schema.budgetCategories)
      .values(
        MONEY_STARTER_CATEGORIES.map((c, i) => ({
          groupId,
          editionId: edition.id,
          kind: c.kind,
          name: c.name,
          nameNormalized: normalizeCategoryName(c.name),
          systemKey: c.systemKey,
          sort: i,
        })),
      )
      .onConflictDoNothing();
    await tx.insert(schema.auditEvents).values({
      actorId: access.viewerUserId,
      action: MONEY_AUDIT.categoriesSeeded,
      subject: groupId,
      meta: {
        groupId,
        editionId: edition.id,
        categories: MONEY_STARTER_CATEGORIES.length,
      },
    });
  });
}

export interface MoneyEntryView {
  id: string;
  categoryId: string;
  categoryName: string;
  kind: BudgetCategoryKind;
  amountCents: number;
  entryDate: string;
  description: string;
  status: BudgetEntryStatus;
  receiptLabel: string | null;
  enteredByName: string | null;
  createdAt: Date;
}

export interface MoneyBooksPage {
  settings: BudgetSettingsView;
  books: MoneyBooks;
  categories: CategoryFacts[];
  /** Newest first. */
  entries: MoneyEntryView[];
  receiptsEnabled: boolean;
}

/** Frame M1, for money people only (null otherwise). Writes the starter
 * categories first when this camp-edition has none yet. */
export async function loadMoneyBooksPage(
  access: MoneyAccess,
  edition: MoneyEdition,
): Promise<MoneyBooksPage | null> {
  if (!access.isMoneyPerson) return null;
  await ensureStarterCategories(access, edition);
  const handle = db();
  const groupId = access.camp.id;
  const settings = await loadSettings(handle, groupId, edition.id);
  const { books, categories } = await loadBooks(
    handle,
    groupId,
    edition.id,
    settings.contingencyPct,
  );
  const rows = await handle
    .select({
      id: schema.budgetEntries.id,
      categoryId: schema.budgetEntries.categoryId,
      amountCents: schema.budgetEntries.amountCents,
      entryDate: schema.budgetEntries.entryDate,
      description: schema.budgetEntries.description,
      status: schema.budgetEntries.status,
      receiptContentType: schema.budgetEntries.receiptContentType,
      enteredByUserId: schema.budgetEntries.enteredByUserId,
      createdAt: schema.budgetEntries.createdAt,
    })
    .from(schema.budgetEntries)
    .where(
      and(
        eq(schema.budgetEntries.groupId, groupId),
        eq(schema.budgetEntries.editionId, edition.id),
      ),
    )
    .orderBy(
      desc(schema.budgetEntries.entryDate),
      desc(schema.budgetEntries.createdAt),
    );
  const names = await namesFor(
    handle,
    rows.map((r) => r.enteredByUserId),
  );
  const byId = new Map(categories.map((c) => [c.id, c]));
  return {
    settings,
    books,
    categories,
    entries: rows.map((r) => {
      const category = byId.get(r.categoryId);
      return {
        id: r.id,
        categoryId: r.categoryId,
        categoryName: category?.name ?? "",
        kind: category?.kind ?? "expense",
        amountCents: r.amountCents,
        entryDate: r.entryDate,
        description: r.description,
        status: r.status,
        receiptLabel: r.receiptContentType
          ? receiptLabel(r.receiptContentType)
          : null,
        enteredByName: r.enteredByUserId
          ? nameOf(names, r.enteredByUserId)
          : null,
        createdAt: r.createdAt,
      };
    }),
    receiptsEnabled: isReceiptStorageConfigured(),
  };
}

// --- Money people: dues (frame M2) -----------------------------------------

export interface DuesRowView {
  userId: string | null;
  name: string;
  refCode: string | null;
  standing: DuesStanding;
  figures: DuesFigures;
  /** Why this member owes a different amount (or is waived). */
  reason: string | null;
}

export interface DuesBoard {
  settings: BudgetSettingsView;
  rows: DuesRowView[];
  summary: DuesSummary;
}

const STANDING_ORDER: Record<DuesStanding, number> = {
  current: 0,
  former: 1,
  deleted: 2,
};

/** Frame M2, for money people only (null otherwise). Every current member,
 * and former members and deleted accounts the books already name. */
export async function loadDuesBoard(
  access: MoneyAccess,
  edition: MoneyEdition,
): Promise<DuesBoard | null> {
  if (!access.isMoneyPerson) return null;
  const handle = db();
  const groupId = access.camp.id;
  const settings = await loadSettings(handle, groupId, edition.id);
  const members = await handle
    .select({
      userId: schema.memberships.userId,
      refCode: schema.memberships.refCode,
      archivedAt: schema.memberships.archivedAt,
      username: schema.users.username,
      sanitizedAt: schema.users.sanitizedAt,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    // former members: listed when the books name them (`onDuesList`).
    .where(eq(schema.memberships.groupId, groupId));
  const overrides = await handle
    .select({
      userId: schema.memberDues.userId,
      amountCents: schema.memberDues.amountCents,
      reason: schema.memberDues.reason,
    })
    .from(schema.memberDues)
    .where(
      and(
        eq(schema.memberDues.groupId, groupId),
        eq(schema.memberDues.editionId, edition.id),
      ),
    );
  const received = await handle
    .select({
      userId: schema.duesPayments.userId,
      total: sql<string>`sum(${schema.duesPayments.amountCents})::bigint`,
    })
    .from(schema.duesPayments)
    .where(
      and(
        eq(schema.duesPayments.groupId, groupId),
        eq(schema.duesPayments.editionId, edition.id),
      ),
    )
    .groupBy(schema.duesPayments.userId);

  const NOBODY = "";
  const key = (userId: string | null) => userId ?? NOBODY;
  const overrideBy = new Map(overrides.map((o) => [key(o.userId), o]));
  const receivedBy = new Map(
    received.map((r) => [key(r.userId), Number(r.total)]),
  );
  const memberBy = new Map(members.map((m) => [m.userId, m]));

  // Anyone the books name who has no membership row at all any more (they
  // left the camp): their user row still exists, so their name does too.
  const orphanIds = [
    ...new Set([...overrideBy.keys(), ...receivedBy.keys()]),
  ].filter((id) => id !== NOBODY && !memberBy.has(id));
  const orphanNames = await namesFor(handle, orphanIds);

  const candidates = new Set<string>([
    ...members.map((m) => m.userId),
    ...overrideBy.keys(),
    ...receivedBy.keys(),
  ]);
  const rows: DuesRowView[] = [];
  const facts: DuesMemberFacts[] = [];
  for (const id of candidates) {
    const m = id === NOBODY ? undefined : memberBy.get(id);
    const sanitizedAt = m
      ? m.sanitizedAt
      : (orphanNames.get(id)?.sanitizedAt ?? null);
    const standing: DuesStanding =
      id === NOBODY || sanitizedAt !== null
        ? "deleted"
        : m && m.archivedAt === null
          ? "current"
          : "former";
    const override = overrideBy.get(id);
    const receivedCents = receivedBy.get(id) ?? 0;
    if (
      !onDuesList({
        standing,
        hasOverride: override !== undefined,
        hasPayments: receivedCents > 0,
      })
    ) {
      continue;
    }
    const fact: DuesMemberFacts = {
      userId: id === NOBODY ? null : id,
      standing,
      overrideCents: override?.amountCents ?? null,
      receivedCents,
    };
    facts.push(fact);
    const shownName =
      id === NOBODY
        ? null
        : m
          ? publicMemberName(m.username, { sanitizedAt: m.sanitizedAt })
          : (orphanNames.get(id)?.name ?? null);
    rows.push({
      userId: fact.userId,
      name: moneyMemberName(shownName, { sanitizedAt, userId: fact.userId }),
      refCode: m?.refCode ?? null,
      standing,
      figures: memberDuesFigures(settings.defaultDuesCents, fact),
      reason: override?.reason ?? null,
    });
  }
  rows.sort(
    (a, b) =>
      STANDING_ORDER[a.standing] - STANDING_ORDER[b.standing] ||
      a.name.localeCompare(b.name),
  );
  return {
    settings,
    rows,
    summary: summariseDues(settings.defaultDuesCents, facts),
  };
}

export interface DuesPaymentView {
  id: string;
  receivedOn: string;
  amountCents: number;
  note: string | null;
  recordedByName: string;
  createdAt: Date;
}

/** One member's payments, notes included — money people only. */
export async function loadMemberPayments(
  access: MoneyAccess,
  edition: MoneyEdition,
  userId: string,
): Promise<DuesPaymentView[] | null> {
  if (
    !canViewMemberMoney(
      { userId: access.viewerUserId, membership: access.membership },
      userId,
    )
  ) {
    return null;
  }
  if (!access.isMoneyPerson) return null;
  const handle = db();
  const rows = await handle
    .select({
      id: schema.duesPayments.id,
      receivedOn: schema.duesPayments.receivedOn,
      amountCents: schema.duesPayments.amountCents,
      note: schema.duesPayments.note,
      recordedByUserId: schema.duesPayments.recordedByUserId,
      createdAt: schema.duesPayments.createdAt,
    })
    .from(schema.duesPayments)
    .where(
      and(
        eq(schema.duesPayments.groupId, access.camp.id),
        eq(schema.duesPayments.editionId, edition.id),
        eq(schema.duesPayments.userId, userId),
      ),
    )
    .orderBy(desc(schema.duesPayments.receivedOn));
  const names = await namesFor(
    handle,
    rows.map((r) => r.recordedByUserId),
  );
  return rows.map((r) => ({
    id: r.id,
    receivedOn: r.receivedOn,
    amountCents: r.amountCents,
    note: r.note,
    recordedByName: nameOf(names, r.recordedByUserId),
    createdAt: r.createdAt,
  }));
}

// --- Money people: claims (frame M3) ----------------------------------------

export interface ClaimView extends OwnClaimView {
  claimantUserId: string | null;
  claimantName: string;
  isOwn: boolean;
  /** This viewer may approve / reject it (never their own). */
  mayDecide: boolean;
  /** This viewer may mark it repaid (never their own). */
  mayMarkRepaid: boolean;
}

/** Frame M3, for money people only (null otherwise). Newest first. */
export async function loadClaimsBoard(
  access: MoneyAccess,
  edition: MoneyEdition,
): Promise<ClaimView[] | null> {
  if (!access.isMoneyPerson) return null;
  const handle = db();
  const categories = await loadCategories(handle, access.camp.id, edition.id);
  const rows = await handle
    .select({
      id: schema.campClaims.id,
      claimantUserId: schema.campClaims.claimantUserId,
      categoryId: schema.campClaims.categoryId,
      amountCents: schema.campClaims.amountCents,
      description: schema.campClaims.description,
      status: schema.campClaims.status,
      receiptContentType: schema.campClaims.receiptContentType,
      decidedAt: schema.campClaims.decidedAt,
      decidedByUserId: schema.campClaims.decidedByUserId,
      decisionNote: schema.campClaims.decisionNote,
      repaidOn: schema.campClaims.repaidOn,
      createdAt: schema.campClaims.createdAt,
    })
    .from(schema.campClaims)
    .where(
      and(
        eq(schema.campClaims.groupId, access.camp.id),
        eq(schema.campClaims.editionId, edition.id),
      ),
    )
    .orderBy(desc(schema.campClaims.createdAt));
  const names = await namesFor(handle, [
    ...rows.map((r) => r.claimantUserId),
    ...rows.map((r) => r.decidedByUserId),
  ]);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const actor = { userId: access.viewerUserId, membership: access.membership };
  const may = (
    action: ClaimAction,
    r: {
      claimantUserId: string | null;
      status: CampClaimStatus;
      categoryId: string | null;
    },
  ) =>
    decideClaimAction({
      action,
      actor,
      claim: r,
      // Approval is offered when the decision could go through; the server
      // re-decides with the real category on submit.
      category: { kind: "expense", archived: false },
    }).ok;
  return rows.map((r) => {
    const isOwn =
      r.claimantUserId !== null && r.claimantUserId === access.viewerUserId;
    return {
      id: r.id,
      claimantUserId: r.claimantUserId,
      claimantName: nameOf(names, r.claimantUserId),
      isOwn,
      categoryId: r.categoryId,
      categoryName: r.categoryId
        ? (categoryName.get(r.categoryId) ?? null)
        : null,
      amountCents: r.amountCents,
      description: r.description,
      status: r.status,
      receiptLabel: r.receiptContentType
        ? receiptLabel(r.receiptContentType)
        : null,
      decidedAt: r.decidedAt,
      decidedByName: r.decidedAt ? nameOf(names, r.decidedByUserId) : null,
      decisionNote: r.decisionNote,
      repaidOn: r.repaidOn,
      createdAt: r.createdAt,
      mayWithdraw: isOwn && r.status === "submitted",
      mayDecide: may("approve", r),
      mayMarkRepaid: may("repay", r),
    };
  });
}

// --- Receipts: who may open one ----------------------------------------------

/**
 * The receipt behind a claim or an entry, if THIS viewer may open it: a money
 * person of the record's camp, or a claim's own claimant (a current member).
 * Null for everything else — not signed in, not allowed, no receipt, no such
 * record — so the route is no oracle for which receipts exist.
 */
export async function resolveReceiptForViewer(input: {
  viewerUserId: string;
  kind: ReceiptSubjectKind;
  id: string;
}): Promise<{
  groupId: string;
  key: string;
  contentType: ReceiptContentType;
} | null> {
  const handle = db();
  let record: {
    groupId: string;
    receiptKey: string | null;
    receiptContentType: string | null;
    claimantUserId: string | null;
  } | null;
  if (input.kind === "claim") {
    const [row] = await handle
      .select({
        groupId: schema.campClaims.groupId,
        receiptKey: schema.campClaims.receiptKey,
        receiptContentType: schema.campClaims.receiptContentType,
        claimantUserId: schema.campClaims.claimantUserId,
      })
      .from(schema.campClaims)
      .where(eq(schema.campClaims.id, input.id))
      .limit(1);
    record = row ?? null;
  } else {
    const [row] = await handle
      .select({
        groupId: schema.budgetEntries.groupId,
        receiptKey: schema.budgetEntries.receiptKey,
        receiptContentType: schema.budgetEntries.receiptContentType,
      })
      .from(schema.budgetEntries)
      .where(eq(schema.budgetEntries.id, input.id))
      .limit(1);
    record = row ? { ...row, claimantUserId: null } : null;
  }
  if (!record?.receiptKey || !record.receiptContentType) return null;
  if (!isReceiptContentType(record.receiptContentType)) return null;
  const membership = await getMemberPermissions(
    record.groupId,
    input.viewerUserId,
  );
  const allowed = canViewReceipt(
    { userId: input.viewerUserId, membership },
    input.kind === "claim"
      ? { kind: "claim", claimantUserId: record.claimantUserId }
      : { kind: "entry" },
  );
  if (!allowed) return null;
  return {
    groupId: record.groupId,
    key: record.receiptKey,
    contentType: record.receiptContentType,
  };
}

// --- Write plumbing ------------------------------------------------------------

interface MoneyActor {
  membershipId: string;
  userId: string;
  role: MembershipRole;
  name: string;
  camp: MoneyNoticeContext;
  permissions: PermissionMembership;
}

/** Every project-role permission object this membership holds, baseline
 * included, read through the kind rule (a captain holds everything). */
async function loadRolePermissions(
  handle: Handle,
  groupId: string,
  membershipId: string,
): Promise<ProjectPermissions[]> {
  const rows = await handle
    .select({
      kind: schema.projectRoles.kind,
      permissions: schema.projectRoles.permissions,
      heldBy: schema.memberRoleAssignments.membershipId,
    })
    .from(schema.projectRoles)
    .leftJoin(
      schema.memberRoleAssignments,
      and(
        eq(schema.memberRoleAssignments.projectRoleId, schema.projectRoles.id),
        eq(schema.memberRoleAssignments.membershipId, membershipId),
        eq(schema.memberRoleAssignments.consentStatus, "accepted"),
      ),
    )
    .where(eq(schema.projectRoles.groupId, groupId));
  return rows
    .filter((r) => r.kind === "baseline" || r.heldBy !== null)
    .map((r) => enforceKindPermissions(r.kind, r.permissions));
}

/**
 * The caller's ACTIVE membership of this camp, held `FOR SHARE` — the
 * membership AND the users row, because account erasure locks the users row
 * `FOR UPDATE` before it touches anything (lib/account-sanitize.ts), so this
 * waits for an erasure in flight and then sees the tombstone. Null when not a
 * current member, deleted, or the group is not a theme camp.
 */
async function lockMoneyActor(
  tx: Tx,
  groupId: string,
  userId: string,
): Promise<MoneyActor | null> {
  const [row] = await tx
    .select({
      membershipId: schema.memberships.id,
      userId: schema.memberships.userId,
      role: schema.memberships.role,
      username: schema.users.username,
      groupKind: schema.groups.kind,
      groupName: schema.groups.name,
      groupSlug: schema.groups.slug,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .innerJoin(schema.groups, eq(schema.groups.id, schema.memberships.groupId))
    .where(
      and(
        eq(schema.memberships.groupId, groupId),
        eq(schema.memberships.userId, userId),
        activeMembership(),
        isNull(schema.users.sanitizedAt),
      ),
    )
    .limit(1)
    .for("share", { of: [schema.memberships, schema.users] });
  if (!row || !moneyAvailableForGroup(row.groupKind)) return null;
  const rolePermissions = await loadRolePermissions(
    tx,
    groupId,
    row.membershipId,
  );
  return {
    membershipId: row.membershipId,
    userId: row.userId,
    role: row.role,
    name: publicMemberName(row.username, { sanitizedAt: null }),
    camp: { campName: row.groupName, campSlug: row.groupSlug },
    permissions: { structuralRole: row.role, rolePermissions },
  };
}

/** `lockMoneyActor` + the money-people gate, in one step. */
async function lockMoneyPerson(
  tx: Tx,
  groupId: string,
  userId: string,
): Promise<{ ok: true; actor: MoneyActor } | { ok: false; error: string }> {
  const actor = await lockMoneyActor(tx, groupId, userId);
  const gate = decideMoneyWrite(actor?.permissions ?? null);
  if (!gate.ok || !actor) return refused(gate.ok ? "not_member" : gate.reason);
  return { ok: true, actor };
}

/** The budget row, created on first write, locked `FOR UPDATE`. */
async function lockBudget(tx: Tx, groupId: string, editionId: string) {
  await tx
    .insert(schema.campBudgets)
    .values({ groupId, editionId })
    .onConflictDoNothing({
      target: [schema.campBudgets.groupId, schema.campBudgets.editionId],
    });
  const [row] = await tx
    .select({
      id: schema.campBudgets.id,
      defaultDuesCents: schema.campBudgets.defaultDuesCents,
      paymentInstructions: schema.campBudgets.paymentInstructions,
      contingencyPct: schema.campBudgets.contingencyPct,
      status: schema.campBudgets.status,
    })
    .from(schema.campBudgets)
    .where(
      and(
        eq(schema.campBudgets.groupId, groupId),
        eq(schema.campBudgets.editionId, editionId),
      ),
    )
    .limit(1)
    .for("update");
  if (!row) throw new Error("camp budget row missing after upsert");
  return row;
}

/** A category of THIS camp and edition, held `FOR SHARE` so a concurrent
 * remove waits for the write that files something under it. */
async function lockCategory(
  tx: Tx,
  groupId: string,
  editionId: string,
  categoryId: string,
): Promise<CategoryFacts | null> {
  const [row] = await tx
    .select({
      id: schema.budgetCategories.id,
      kind: schema.budgetCategories.kind,
      name: schema.budgetCategories.name,
      plannedCents: schema.budgetCategories.plannedCents,
      systemKey: schema.budgetCategories.systemKey,
      archivedAt: schema.budgetCategories.archivedAt,
      sort: schema.budgetCategories.sort,
    })
    .from(schema.budgetCategories)
    .where(
      and(
        eq(schema.budgetCategories.id, categoryId),
        eq(schema.budgetCategories.groupId, groupId),
        eq(schema.budgetCategories.editionId, editionId),
      ),
    )
    .limit(1)
    .for("share");
  if (!row) return null;
  const { archivedAt, ...rest } = row;
  return { ...rest, archived: archivedAt !== null };
}

async function audit(
  tx: Tx,
  actorId: string,
  action: string,
  groupId: string,
  editionId: string,
  meta: Record<string, unknown>,
): Promise<void> {
  await tx.insert(schema.auditEvents).values({
    actorId,
    action,
    subject: groupId,
    meta: { groupId, editionId, ...meta },
  });
}

function toRow(userId: string, payload: NotificationPayload): NotificationRow {
  return { ...payload, userId, origin: "camp", linkApp: "web" };
}

/** Insert after commit. Best effort: a failed notice never fails the change. */
async function notifyAfterCommit(rows: NotificationRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await insertNotifications(db(), rows);
  } catch (err) {
    console.error("[notifications] money notice failed", err);
  }
}

/** Current, non-deleted members holding `manage_money` (leads included). */
async function moneyPeopleUserIds(
  handle: Handle,
  groupId: string,
): Promise<string[]> {
  const members = await handle
    .select({
      membershipId: schema.memberships.id,
      userId: schema.memberships.userId,
      role: schema.memberships.role,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.groupId, groupId),
        activeMembership(),
        isNull(schema.users.sanitizedAt),
      ),
    );
  if (members.length === 0) return [];
  const roles = await handle
    .select({
      id: schema.projectRoles.id,
      kind: schema.projectRoles.kind,
      permissions: schema.projectRoles.permissions,
    })
    .from(schema.projectRoles)
    .where(eq(schema.projectRoles.groupId, groupId));
  const held = await handle
    .select({
      membershipId: schema.memberRoleAssignments.membershipId,
      projectRoleId: schema.memberRoleAssignments.projectRoleId,
    })
    .from(schema.memberRoleAssignments)
    .where(
      and(
        inArray(
          schema.memberRoleAssignments.membershipId,
          members.map((m) => m.membershipId),
        ),
        eq(schema.memberRoleAssignments.consentStatus, "accepted"),
      ),
    );
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const baseline = roles
    .filter((r) => r.kind === "baseline")
    .map((r) => r.permissions);
  const heldBy = new Map<string, ProjectPermissions[]>();
  for (const h of held) {
    const role = roleById.get(h.projectRoleId);
    if (!role || role.kind === "baseline") continue;
    const list = heldBy.get(h.membershipId) ?? [];
    list.push(enforceKindPermissions(role.kind, role.permissions));
    heldBy.set(h.membershipId, list);
  }
  return members
    .filter((m) =>
      canManageMoney({
        structuralRole: m.role,
        rolePermissions: [...baseline, ...(heldBy.get(m.membershipId) ?? [])],
      }),
    )
    .map((m) => m.userId);
}

/** A receipt's bytes → checked and stored, or a refusal. Nothing is stored
 * when the file is refused or the deployment has no blob token. */
async function storeReceipt(
  groupId: string,
  receipt: { bytes: Uint8Array } | null | undefined,
): Promise<
  | {
      ok: true;
      stored: { key: string; contentType: ReceiptContentType } | null;
    }
  | { ok: false; error: string }
> {
  if (!receipt) return { ok: true, stored: null };
  const check = checkReceiptUpload(receipt.bytes);
  if (!check.ok) return { ok: false, error: check.error };
  if (!isReceiptStorageConfigured())
    return { ok: false, error: NO_RECEIPT_STORE };
  const key = await putReceiptBlob(groupId, receipt.bytes, check.contentType);
  return { ok: true, stored: { key, contentType: check.contentType } };
}

interface WriteBase {
  actorUserId: string;
  groupId: string;
  editionId: string;
}

// --- Writes: budget settings ----------------------------------------------------

/** "Change the camp fee". Members on the camp fee are told what they now
 * owe. */
export async function setCampFee(
  input: WriteBase & { defaultDuesCents: number },
): Promise<MoneyResult> {
  const notices: NotificationRow[] = [];
  const result = await withTransaction(async (tx): Promise<MoneyResult> => {
    const gate = await lockMoneyPerson(tx, input.groupId, input.actorUserId);
    if (!gate.ok) return gate;
    const budget = await lockBudget(tx, input.groupId, input.editionId);
    if (budget.defaultDuesCents === input.defaultDuesCents) return { ok: true };
    await tx
      .update(schema.campBudgets)
      .set({ defaultDuesCents: input.defaultDuesCents, updatedAt: new Date() })
      .where(eq(schema.campBudgets.id, budget.id));
    await audit(
      tx,
      input.actorUserId,
      MONEY_AUDIT.campFee,
      input.groupId,
      input.editionId,
      {
        beforeCents: budget.defaultDuesCents,
        afterCents: input.defaultDuesCents,
      },
    );
    // Who is on the camp fee: current, non-deleted members without an amount
    // of their own this edition.
    const onFee = await tx
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .leftJoin(
        schema.memberDues,
        and(
          eq(schema.memberDues.userId, schema.memberships.userId),
          eq(schema.memberDues.groupId, input.groupId),
          eq(schema.memberDues.editionId, input.editionId),
        ),
      )
      .where(
        and(
          eq(schema.memberships.groupId, input.groupId),
          activeMembership(),
          isNull(schema.users.sanitizedAt),
          isNull(schema.memberDues.id),
        ),
      );
    const payload = duesSetNotification(
      gate.actor.camp,
      input.defaultDuesCents,
    );
    for (const m of onFee) {
      if (m.userId !== input.actorUserId)
        notices.push(toRow(m.userId, payload));
    }
    return { ok: true };
  });
  if (result.ok) await notifyAfterCommit(notices);
  return result;
}

/** "Edit instructions" — the camp's own bank details and how to pay. */
export async function setPaymentInstructions(
  input: WriteBase & { paymentInstructions: string | null },
): Promise<MoneyResult> {
  return withTransaction(async (tx): Promise<MoneyResult> => {
    const gate = await lockMoneyPerson(tx, input.groupId, input.actorUserId);
    if (!gate.ok) return gate;
    const budget = await lockBudget(tx, input.groupId, input.editionId);
    await tx
      .update(schema.campBudgets)
      .set({
        paymentInstructions: input.paymentInstructions,
        updatedAt: new Date(),
      })
      .where(eq(schema.campBudgets.id, budget.id));
    await audit(
      tx,
      input.actorUserId,
      MONEY_AUDIT.instructions,
      input.groupId,
      input.editionId,
      { cleared: input.paymentInstructions === null },
    );
    return { ok: true };
  });
}

/** "Edit the plan": contingency + planned amounts, one save, one audit row
 * carrying every changed line before and after. */
export async function setBudgetPlan(
  input: WriteBase & Omit<SetBudgetPlanInput, "slug">,
): Promise<MoneyResult> {
  return withTransaction(async (tx): Promise<MoneyResult> => {
    const gate = await lockMoneyPerson(tx, input.groupId, input.actorUserId);
    if (!gate.ok) return gate;
    const budget = await lockBudget(tx, input.groupId, input.editionId);
    const categories = await loadCategories(tx, input.groupId, input.editionId);
    const byId = new Map(categories.map((c) => [c.id, c]));
    for (const line of input.lines) {
      const c = byId.get(line.categoryId);
      if (!c) return refused("category_missing");
      if (c.archived) return refused("category_archived");
    }
    const changed: {
      categoryId: string;
      beforeCents: number;
      afterCents: number;
    }[] = [];
    for (const line of input.lines) {
      const c = byId.get(line.categoryId)!;
      if (c.plannedCents === line.plannedCents) continue;
      changed.push({
        categoryId: c.id,
        beforeCents: c.plannedCents,
        afterCents: line.plannedCents,
      });
      await tx
        .update(schema.budgetCategories)
        .set({ plannedCents: line.plannedCents, updatedAt: new Date() })
        .where(
          and(
            eq(schema.budgetCategories.id, c.id),
            eq(schema.budgetCategories.groupId, input.groupId),
          ),
        );
    }
    if (budget.contingencyPct !== input.contingencyPct) {
      await tx
        .update(schema.campBudgets)
        .set({ contingencyPct: input.contingencyPct, updatedAt: new Date() })
        .where(eq(schema.campBudgets.id, budget.id));
    }
    await audit(
      tx,
      input.actorUserId,
      MONEY_AUDIT.plan,
      input.groupId,
      input.editionId,
      {
        contingencyBefore: budget.contingencyPct,
        contingencyAfter: input.contingencyPct,
        lines: changed,
        budgetStatus: budget.status,
      },
    );
    return { ok: true };
  });
}

/** Sign the plan off (compare-and-set on `draft`). */
export async function approveBudget(input: WriteBase): Promise<MoneyResult> {
  return withTransaction(async (tx): Promise<MoneyResult> => {
    const gate = await lockMoneyPerson(tx, input.groupId, input.actorUserId);
    if (!gate.ok) return gate;
    const budget = await lockBudget(tx, input.groupId, input.editionId);
    if (budget.status === "approved") return refused("budget_already_approved");
    const now = new Date();
    const done = await tx
      .update(schema.campBudgets)
      .set({
        status: "approved",
        approvedAt: now,
        approvedByUserId: input.actorUserId,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.campBudgets.id, budget.id),
          eq(schema.campBudgets.status, "draft"),
        ),
      )
      .returning({ id: schema.campBudgets.id });
    if (!done[0]) return refused("budget_already_approved");
    await audit(
      tx,
      input.actorUserId,
      MONEY_AUDIT.approve,
      input.groupId,
      input.editionId,
      {},
    );
    return { ok: true };
  });
}

// --- Writes: categories -------------------------------------------------------

export async function addBudgetCategory(
  input: WriteBase & Omit<AddBudgetCategoryInput, "slug">,
): Promise<MoneyResult<{ id: string }>> {
  try {
    return await withTransaction(
      async (tx): Promise<MoneyResult<{ id: string }>> => {
        const gate = await lockMoneyPerson(
          tx,
          input.groupId,
          input.actorUserId,
        );
        if (!gate.ok) return gate;
        // Locks the budget row too: two adds serialise on it, so the count and
        // the sort below cannot race.
        await lockBudget(tx, input.groupId, input.editionId);
        const existing = await loadCategories(
          tx,
          input.groupId,
          input.editionId,
        );
        if (existing.length >= MONEY_MAX_CATEGORIES) {
          return refused("too_many_categories");
        }
        const name = decideCategoryName(existing, input.name);
        if (!name.ok) return refused(name.reason);
        const sort = existing.reduce((n, c) => Math.max(n, c.sort + 1), 0);
        const [row] = await tx
          .insert(schema.budgetCategories)
          .values({
            groupId: input.groupId,
            editionId: input.editionId,
            kind: input.kind,
            name: input.name,
            nameNormalized: normalizeCategoryName(input.name),
            plannedCents: input.plannedCents,
            sort,
          })
          .returning({ id: schema.budgetCategories.id });
        if (!row) throw new Error("category insert returned nothing");
        await audit(
          tx,
          input.actorUserId,
          MONEY_AUDIT.categoryAdd,
          input.groupId,
          input.editionId,
          {
            categoryId: row.id,
            kind: input.kind,
            plannedCents: input.plannedCents,
          },
        );
        return { ok: true, id: row.id };
      },
    );
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: NAME_TAKEN };
    throw err;
  }
}

export async function renameBudgetCategory(
  input: WriteBase & Omit<RenameBudgetCategoryInput, "slug">,
): Promise<MoneyResult> {
  try {
    return await withTransaction(async (tx): Promise<MoneyResult> => {
      const gate = await lockMoneyPerson(tx, input.groupId, input.actorUserId);
      if (!gate.ok) return gate;
      const category = await lockCategory(
        tx,
        input.groupId,
        input.editionId,
        input.categoryId,
      );
      if (!category) return refused("category_missing");
      if (category.archived) return refused("category_archived");
      const existing = await loadCategories(tx, input.groupId, input.editionId);
      const name = decideCategoryName(existing, input.name, category.id);
      if (!name.ok) return refused(name.reason);
      await tx
        .update(schema.budgetCategories)
        .set({
          name: input.name,
          nameNormalized: normalizeCategoryName(input.name),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.budgetCategories.id, category.id),
            eq(schema.budgetCategories.groupId, input.groupId),
          ),
        );
      await audit(
        tx,
        input.actorUserId,
        MONEY_AUDIT.categoryRename,
        input.groupId,
        input.editionId,
        { categoryId: category.id },
      );
      return { ok: true };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: NAME_TAKEN };
    throw err;
  }
}

/** Remove a category: deleted when nothing uses it, archived otherwise. */
export async function removeBudgetCategory(
  input: WriteBase & { categoryId: string },
): Promise<MoneyResult<{ action: "delete" | "archive" }>> {
  return withTransaction(
    async (tx): Promise<MoneyResult<{ action: "delete" | "archive" }>> => {
      const gate = await lockMoneyPerson(tx, input.groupId, input.actorUserId);
      if (!gate.ok) return gate;
      // FOR UPDATE, not share: an entry or claim filed under it concurrently
      // holds FOR SHARE (lockCategory), so whichever commits first decides.
      const [row] = await tx
        .select({
          id: schema.budgetCategories.id,
          systemKey: schema.budgetCategories.systemKey,
          archivedAt: schema.budgetCategories.archivedAt,
          plannedCents: schema.budgetCategories.plannedCents,
        })
        .from(schema.budgetCategories)
        .where(
          and(
            eq(schema.budgetCategories.id, input.categoryId),
            eq(schema.budgetCategories.groupId, input.groupId),
            eq(schema.budgetCategories.editionId, input.editionId),
          ),
        )
        .limit(1)
        .for("update");
      if (!row) return refused("category_missing");
      const [entryUse] = await tx
        .select({ id: schema.budgetEntries.id })
        .from(schema.budgetEntries)
        .where(eq(schema.budgetEntries.categoryId, row.id))
        .limit(1);
      const [claimUse] = await tx
        .select({ id: schema.campClaims.id })
        .from(schema.campClaims)
        .where(eq(schema.campClaims.categoryId, row.id))
        .limit(1);
      const decision = decideCategoryRemoval(
        { systemKey: row.systemKey, archived: row.archivedAt !== null },
        Boolean(entryUse || claimUse),
      );
      if (!decision.ok) return refused(decision.reason);
      if (decision.action === "delete") {
        await tx
          .delete(schema.budgetCategories)
          .where(eq(schema.budgetCategories.id, row.id));
      } else {
        await tx
          .update(schema.budgetCategories)
          .set({ archivedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.budgetCategories.id, row.id));
      }
      await audit(
        tx,
        input.actorUserId,
        decision.action === "delete"
          ? MONEY_AUDIT.categoryDelete
          : MONEY_AUDIT.categoryArchive,
        input.groupId,
        input.editionId,
        { categoryId: row.id, plannedCents: row.plannedCents },
      );
      return { ok: true, action: decision.action };
    },
  );
}

// --- Writes: entries -----------------------------------------------------------

type EntryFields = Omit<AddBudgetEntryInput, "slug">;

export async function addBudgetEntry(
  input: WriteBase & {
    fields: EntryFields;
    receipt?: { bytes: Uint8Array } | null;
  },
): Promise<MoneyResult<{ id: string }>> {
  const stored = await storeReceipt(input.groupId, input.receipt);
  if (!stored.ok) return stored;
  const receipt = stored.stored;
  let result: MoneyResult<{ id: string }>;
  try {
    result = await withTransaction(
      async (tx): Promise<MoneyResult<{ id: string }>> => {
        const gate = await lockMoneyPerson(
          tx,
          input.groupId,
          input.actorUserId,
        );
        if (!gate.ok) return gate;
        const f = input.fields;
        const category = await lockCategory(
          tx,
          input.groupId,
          input.editionId,
          f.categoryId,
        );
        const decision = decideEntry(category, f.status);
        if (!decision.ok) return refused(decision.reason);
        const [row] = await tx
          .insert(schema.budgetEntries)
          .values({
            groupId: input.groupId,
            editionId: input.editionId,
            categoryId: f.categoryId,
            amountCents: f.amountCents,
            entryDate: f.entryDate,
            description: f.description,
            status: f.status,
            receiptKey: receipt?.key ?? null,
            receiptContentType: receipt?.contentType ?? null,
            enteredByUserId: input.actorUserId,
          })
          .returning({ id: schema.budgetEntries.id });
        if (!row) throw new Error("entry insert returned nothing");
        await audit(
          tx,
          input.actorUserId,
          MONEY_AUDIT.entryAdd,
          input.groupId,
          input.editionId,
          {
            entryId: row.id,
            categoryId: f.categoryId,
            amountCents: f.amountCents,
            status: f.status,
            entryDate: f.entryDate,
            receipt: receipt !== null,
          },
        );
        return { ok: true, id: row.id };
      },
    );
  } catch (err) {
    await deleteReceiptBlobQuietly(input.groupId, receipt?.key);
    throw err;
  }
  if (!result.ok) await deleteReceiptBlobQuietly(input.groupId, receipt?.key);
  return result;
}

/** Correct an entry (committed → paid is the usual one). Audited with the
 * amount, category, status and date before and after. */
export async function updateBudgetEntry(
  input: WriteBase & { fields: Omit<UpdateBudgetEntryInput, "slug"> },
): Promise<MoneyResult> {
  return withTransaction(async (tx): Promise<MoneyResult> => {
    const gate = await lockMoneyPerson(tx, input.groupId, input.actorUserId);
    if (!gate.ok) return gate;
    const f = input.fields;
    const [before] = await tx
      .select({
        id: schema.budgetEntries.id,
        categoryId: schema.budgetEntries.categoryId,
        amountCents: schema.budgetEntries.amountCents,
        status: schema.budgetEntries.status,
        entryDate: schema.budgetEntries.entryDate,
      })
      .from(schema.budgetEntries)
      .where(
        and(
          eq(schema.budgetEntries.id, f.entryId),
          eq(schema.budgetEntries.groupId, input.groupId),
          eq(schema.budgetEntries.editionId, input.editionId),
        ),
      )
      .limit(1)
      .for("update");
    if (!before) return { ok: false, error: MISSING_ENTRY };
    const category = await lockCategory(
      tx,
      input.groupId,
      input.editionId,
      f.categoryId,
    );
    const decision = decideEntry(category, f.status);
    if (!decision.ok) return refused(decision.reason);
    await tx
      .update(schema.budgetEntries)
      .set({
        categoryId: f.categoryId,
        amountCents: f.amountCents,
        entryDate: f.entryDate,
        description: f.description,
        status: f.status,
        updatedAt: new Date(),
      })
      .where(eq(schema.budgetEntries.id, before.id));
    await audit(
      tx,
      input.actorUserId,
      MONEY_AUDIT.entryUpdate,
      input.groupId,
      input.editionId,
      {
        entryId: before.id,
        before: {
          categoryId: before.categoryId,
          amountCents: before.amountCents,
          status: before.status,
          entryDate: before.entryDate,
        },
        after: {
          categoryId: f.categoryId,
          amountCents: f.amountCents,
          status: f.status,
          entryDate: f.entryDate,
        },
      },
    );
    return { ok: true };
  });
}

export async function deleteBudgetEntry(
  input: WriteBase & { entryId: string },
): Promise<MoneyResult> {
  let receiptKey: string | null = null;
  const result = await withTransaction(async (tx): Promise<MoneyResult> => {
    const gate = await lockMoneyPerson(tx, input.groupId, input.actorUserId);
    if (!gate.ok) return gate;
    const [gone] = await tx
      .delete(schema.budgetEntries)
      .where(
        and(
          eq(schema.budgetEntries.id, input.entryId),
          eq(schema.budgetEntries.groupId, input.groupId),
          eq(schema.budgetEntries.editionId, input.editionId),
        ),
      )
      .returning({
        id: schema.budgetEntries.id,
        categoryId: schema.budgetEntries.categoryId,
        amountCents: schema.budgetEntries.amountCents,
        status: schema.budgetEntries.status,
        entryDate: schema.budgetEntries.entryDate,
        receiptKey: schema.budgetEntries.receiptKey,
      });
    if (!gone) return { ok: false, error: MISSING_ENTRY };
    receiptKey = gone.receiptKey;
    await audit(
      tx,
      input.actorUserId,
      MONEY_AUDIT.entryDelete,
      input.groupId,
      input.editionId,
      {
        entryId: gone.id,
        categoryId: gone.categoryId,
        amountCents: gone.amountCents,
        status: gone.status,
        entryDate: gone.entryDate,
      },
    );
    return { ok: true };
  });
  if (result.ok) await deleteReceiptBlobQuietly(input.groupId, receiptKey);
  return result;
}

/**
 * Add or replace a receipt: on an entry (money people), or on the caller's
 * OWN claim while it waits for a decision. The old receipt goes after commit.
 */
export async function attachReceipt(
  input: WriteBase & {
    kind: ReceiptSubjectKind;
    id: string;
    receipt: { bytes: Uint8Array };
  },
): Promise<MoneyResult> {
  const stored = await storeReceipt(input.groupId, input.receipt);
  if (!stored.ok) return stored;
  const receipt = stored.stored!;
  let replaced: string | null = null;
  let result: MoneyResult;
  try {
    result = await withTransaction(async (tx): Promise<MoneyResult> => {
      const actor = await lockMoneyActor(tx, input.groupId, input.actorUserId);
      if (!actor) return refused("not_member");
      if (input.kind === "entry") {
        const gate = decideMoneyWrite(actor.permissions);
        if (!gate.ok) return refused(gate.reason);
        const [row] = await tx
          .select({
            id: schema.budgetEntries.id,
            receiptKey: schema.budgetEntries.receiptKey,
          })
          .from(schema.budgetEntries)
          .where(
            and(
              eq(schema.budgetEntries.id, input.id),
              eq(schema.budgetEntries.groupId, input.groupId),
              eq(schema.budgetEntries.editionId, input.editionId),
            ),
          )
          .limit(1)
          .for("update");
        if (!row) return { ok: false, error: MISSING_ENTRY };
        replaced = row.receiptKey;
        await tx
          .update(schema.budgetEntries)
          .set({
            receiptKey: receipt.key,
            receiptContentType: receipt.contentType,
            updatedAt: new Date(),
          })
          .where(eq(schema.budgetEntries.id, row.id));
      } else {
        const [row] = await tx
          .select({
            id: schema.campClaims.id,
            claimantUserId: schema.campClaims.claimantUserId,
            status: schema.campClaims.status,
            receiptKey: schema.campClaims.receiptKey,
          })
          .from(schema.campClaims)
          .where(
            and(
              eq(schema.campClaims.id, input.id),
              eq(schema.campClaims.groupId, input.groupId),
              eq(schema.campClaims.editionId, input.editionId),
            ),
          )
          .limit(1)
          .for("update");
        if (!row) return { ok: false, error: MISSING_CLAIM };
        if (row.claimantUserId !== input.actorUserId)
          return refused("not_your_claim");
        if (row.status !== "submitted") return refused("claim_already_decided");
        replaced = row.receiptKey;
        await tx
          .update(schema.campClaims)
          .set({
            receiptKey: receipt.key,
            receiptContentType: receipt.contentType,
            updatedAt: new Date(),
          })
          .where(eq(schema.campClaims.id, row.id));
      }
      await audit(
        tx,
        input.actorUserId,
        MONEY_AUDIT.receiptAttach,
        input.groupId,
        input.editionId,
        { kind: input.kind, id: input.id, replaced: replaced !== null },
      );
      return { ok: true };
    });
  } catch (err) {
    await deleteReceiptBlobQuietly(input.groupId, receipt.key);
    throw err;
  }
  if (!result.ok) {
    await deleteReceiptBlobQuietly(input.groupId, receipt.key);
    return result;
  }
  await deleteReceiptBlobQuietly(input.groupId, replaced);
  return result;
}

// --- Writes: dues ------------------------------------------------------------------

/**
 * Is this person on THIS camp's books? A current or former member (any
 * membership row of the camp), or someone the edition's books already name
 * (they left; the rows stay). Their users row is locked `FOR SHARE` so an
 * account erasure in flight finishes first and the write sees the tombstone.
 */
async function resolveDuesSubject(
  tx: Tx,
  groupId: string,
  editionId: string,
  userId: string,
): Promise<
  { ok: true; current: boolean } | { ok: false; reason: MoneyRefusal }
> {
  const [user] = await tx
    .select({ id: schema.users.id, sanitizedAt: schema.users.sanitizedAt })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1)
    .for("share");
  if (!user) return { ok: false, reason: "unknown_member" };
  if (user.sanitizedAt !== null)
    return { ok: false, reason: "deleted_account" };
  const [membership] = await tx
    .select({ archivedAt: schema.memberships.archivedAt })
    .from(schema.memberships)
    // former members: a former member's dues are still set and recorded.
    .where(
      and(
        eq(schema.memberships.groupId, groupId),
        eq(schema.memberships.userId, userId),
      ),
    )
    .limit(1);
  if (membership) return { ok: true, current: membership.archivedAt === null };
  const [named] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.duesPayments)
    .where(
      and(
        eq(schema.duesPayments.groupId, groupId),
        eq(schema.duesPayments.editionId, editionId),
        eq(schema.duesPayments.userId, userId),
      ),
    );
  const [override] = await tx
    .select({ id: schema.memberDues.id })
    .from(schema.memberDues)
    .where(
      and(
        eq(schema.memberDues.groupId, groupId),
        eq(schema.memberDues.editionId, editionId),
        eq(schema.memberDues.userId, userId),
      ),
    )
    .limit(1);
  if (Number(named?.n ?? 0) > 0 || override)
    return { ok: true, current: false };
  return { ok: false, reason: "unknown_member" };
}

/** "Set amount": what one member owes. `amountCents: null` = back to the
 * camp fee. The member is told. */
export async function setMemberDues(
  input: WriteBase & {
    userId: string;
    amountCents: number | null;
    reason: string | null;
  },
): Promise<MoneyResult> {
  const notices: NotificationRow[] = [];
  const result = await withTransaction(async (tx): Promise<MoneyResult> => {
    const gate = await lockMoneyPerson(tx, input.groupId, input.actorUserId);
    if (!gate.ok) return gate;
    const budget = await lockBudget(tx, input.groupId, input.editionId);
    const subject = await resolveDuesSubject(
      tx,
      input.groupId,
      input.editionId,
      input.userId,
    );
    if (!subject.ok) return refused(subject.reason);
    // The core rule behind the Zod refine: waiving needs a reason.
    if (input.amountCents === 0 && !input.reason) {
      return { ok: false, error: "Say why their dues are waived." };
    }
    const where = and(
      eq(schema.memberDues.groupId, input.groupId),
      eq(schema.memberDues.editionId, input.editionId),
      eq(schema.memberDues.userId, input.userId),
    );
    const [before] = await tx
      .select({ amountCents: schema.memberDues.amountCents })
      .from(schema.memberDues)
      .where(where)
      .limit(1)
      .for("update");
    if (input.amountCents === null) {
      await tx.delete(schema.memberDues).where(where);
    } else if (before) {
      await tx
        .update(schema.memberDues)
        .set({
          amountCents: input.amountCents,
          reason: input.reason,
          setByUserId: input.actorUserId,
          updatedAt: new Date(),
        })
        .where(where);
    } else {
      await tx.insert(schema.memberDues).values({
        groupId: input.groupId,
        editionId: input.editionId,
        userId: input.userId,
        amountCents: input.amountCents,
        reason: input.reason,
        setByUserId: input.actorUserId,
      });
    }
    await audit(
      tx,
      input.actorUserId,
      MONEY_AUDIT.duesSet,
      input.groupId,
      input.editionId,
      {
        userId: input.userId,
        beforeCents: before?.amountCents ?? null,
        afterCents: input.amountCents,
        campFeeCents: budget.defaultDuesCents,
      },
    );
    if (subject.current && input.userId !== input.actorUserId) {
      notices.push(
        toRow(
          input.userId,
          duesSetNotification(
            gate.actor.camp,
            input.amountCents ?? budget.defaultDuesCents,
          ),
        ),
      );
    }
    return { ok: true };
  });
  if (result.ok) await notifyAfterCommit(notices);
  return result;
}

/** "Record money in": money a money person SAW ARRIVE in the camp's account.
 * Nothing is collected or moved here. The member is told. */
export async function recordDuesPayment(
  input: WriteBase & {
    fields: Omit<RecordDuesPaymentInput, "slug" | "note"> & {
      note: string | null;
    };
  },
): Promise<MoneyResult<{ id: string }>> {
  const notices: NotificationRow[] = [];
  const f = input.fields;
  const result = await withTransaction(
    async (tx): Promise<MoneyResult<{ id: string }>> => {
      const gate = await lockMoneyPerson(tx, input.groupId, input.actorUserId);
      if (!gate.ok) return gate;
      const subject = await resolveDuesSubject(
        tx,
        input.groupId,
        input.editionId,
        f.userId,
      );
      if (!subject.ok) return refused(subject.reason);
      const [row] = await tx
        .insert(schema.duesPayments)
        .values({
          groupId: input.groupId,
          editionId: input.editionId,
          userId: f.userId,
          amountCents: f.amountCents,
          receivedOn: f.receivedOn,
          note: f.note,
          recordedByUserId: input.actorUserId,
        })
        .returning({ id: schema.duesPayments.id });
      if (!row) throw new Error("payment insert returned nothing");
      await audit(
        tx,
        input.actorUserId,
        MONEY_AUDIT.paymentRecord,
        input.groupId,
        input.editionId,
        {
          paymentId: row.id,
          userId: f.userId,
          amountCents: f.amountCents,
          receivedOn: f.receivedOn,
        },
      );
      if (subject.current && f.userId !== input.actorUserId) {
        const own = await ownDuesFigures(
          tx,
          input.groupId,
          input.editionId,
          f.userId,
          (await loadSettings(tx, input.groupId, input.editionId))
            .defaultDuesCents,
        );
        notices.push(
          toRow(
            f.userId,
            duesPaymentRecordedNotification(
              gate.actor.camp,
              f.amountCents,
              own.figures.outstandingCents,
            ),
          ),
        );
      }
      return { ok: true, id: row.id };
    },
  );
  if (result.ok) await notifyAfterCommit(notices);
  return result;
}

/** Remove a payment recorded in error. Audited with what it was; record the
 * right one again. Never edited in place. */
export async function deleteDuesPayment(
  input: WriteBase & { paymentId: string },
): Promise<MoneyResult> {
  return withTransaction(async (tx): Promise<MoneyResult> => {
    const gate = await lockMoneyPerson(tx, input.groupId, input.actorUserId);
    if (!gate.ok) return gate;
    const [gone] = await tx
      .delete(schema.duesPayments)
      .where(
        and(
          eq(schema.duesPayments.id, input.paymentId),
          eq(schema.duesPayments.groupId, input.groupId),
          eq(schema.duesPayments.editionId, input.editionId),
        ),
      )
      .returning({
        id: schema.duesPayments.id,
        userId: schema.duesPayments.userId,
        amountCents: schema.duesPayments.amountCents,
        receivedOn: schema.duesPayments.receivedOn,
        recordedByUserId: schema.duesPayments.recordedByUserId,
      });
    if (!gone) return { ok: false, error: MISSING_PAYMENT };
    await audit(
      tx,
      input.actorUserId,
      MONEY_AUDIT.paymentDelete,
      input.groupId,
      input.editionId,
      {
        paymentId: gone.id,
        userId: gone.userId,
        amountCents: gone.amountCents,
        receivedOn: gone.receivedOn,
        recordedByUserId: gone.recordedByUserId,
      },
    );
    return { ok: true };
  });
}

// --- Writes: claims ---------------------------------------------------------------

/** "Submit claim": any current member, for money they spent for the camp. The
 * money people (never the claimant) are told. */
export async function submitClaim(
  input: WriteBase & {
    fields: Omit<SubmitClaimInput, "slug" | "categoryId"> & {
      categoryId: string | null;
    };
    receipt?: { bytes: Uint8Array } | null;
  },
): Promise<MoneyResult<{ id: string }>> {
  const stored = await storeReceipt(input.groupId, input.receipt);
  if (!stored.ok) return stored;
  const receipt = stored.stored;
  const f = input.fields;
  let camp: MoneyNoticeContext | null = null;
  let claimantName = "";
  let result: MoneyResult<{ id: string }>;
  try {
    result = await withTransaction(
      async (tx): Promise<MoneyResult<{ id: string }>> => {
        const actor = await lockMoneyActor(
          tx,
          input.groupId,
          input.actorUserId,
        );
        if (!actor) return refused("not_member");
        if (f.categoryId !== null) {
          const category = await lockCategory(
            tx,
            input.groupId,
            input.editionId,
            f.categoryId,
          );
          const ok = decideClaimCategory(category);
          if (!ok.ok) return refused(ok.reason);
        }
        const [row] = await tx
          .insert(schema.campClaims)
          .values({
            groupId: input.groupId,
            editionId: input.editionId,
            claimantUserId: input.actorUserId,
            categoryId: f.categoryId,
            amountCents: f.amountCents,
            description: f.description,
            receiptKey: receipt?.key ?? null,
            receiptContentType: receipt?.contentType ?? null,
          })
          .returning({ id: schema.campClaims.id });
        if (!row) throw new Error("claim insert returned nothing");
        await audit(
          tx,
          input.actorUserId,
          MONEY_AUDIT.claimSubmit,
          input.groupId,
          input.editionId,
          {
            claimId: row.id,
            categoryId: f.categoryId,
            amountCents: f.amountCents,
            receipt: receipt !== null,
          },
        );
        camp = actor.camp;
        claimantName = actor.name;
        return { ok: true, id: row.id };
      },
    );
  } catch (err) {
    await deleteReceiptBlobQuietly(input.groupId, receipt?.key);
    throw err;
  }
  if (!result.ok) {
    await deleteReceiptBlobQuietly(input.groupId, receipt?.key);
    return result;
  }
  if (camp) {
    try {
      const recipients = (await moneyPeopleUserIds(db(), input.groupId)).filter(
        (u) => u !== input.actorUserId,
      );
      const payload = claimSubmittedNotification(
        camp,
        claimantName,
        f.amountCents,
      );
      await notifyAfterCommit(recipients.map((u) => toRow(u, payload)));
    } catch (err) {
      console.error("[notifications] claim notice failed", err);
    }
  }
  return result;
}

interface LockedClaim {
  id: string;
  claimantUserId: string | null;
  status: CampClaimStatus;
  categoryId: string | null;
  amountCents: number;
  receiptKey: string | null;
}

async function lockClaim(
  tx: Tx,
  groupId: string,
  editionId: string,
  claimId: string,
): Promise<LockedClaim | null> {
  const [row] = await tx
    .select({
      id: schema.campClaims.id,
      claimantUserId: schema.campClaims.claimantUserId,
      status: schema.campClaims.status,
      categoryId: schema.campClaims.categoryId,
      amountCents: schema.campClaims.amountCents,
      receiptKey: schema.campClaims.receiptKey,
    })
    .from(schema.campClaims)
    .where(
      and(
        eq(schema.campClaims.id, claimId),
        eq(schema.campClaims.groupId, groupId),
        eq(schema.campClaims.editionId, editionId),
      ),
    )
    .limit(1)
    .for("update");
  return row ?? null;
}

/** Is the claimant still a current, non-deleted member? (Only they get a
 * notice — a former member has no camp page to open it on.) */
async function claimantIsCurrent(
  tx: Tx,
  groupId: string,
  userId: string | null,
): Promise<boolean> {
  if (!userId) return false;
  const [row] = await tx
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.groupId, groupId),
        eq(schema.memberships.userId, userId),
        activeMembership(),
        isNull(schema.users.sanitizedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** The claimant takes back their claim while it waits. Deleted (audited);
 * its receipt goes after commit. */
export async function withdrawClaim(
  input: WriteBase & { claimId: string },
): Promise<MoneyResult> {
  let receiptKey: string | null = null;
  const result = await withTransaction(async (tx): Promise<MoneyResult> => {
    const actor = await lockMoneyActor(tx, input.groupId, input.actorUserId);
    if (!actor) return refused("not_member");
    const claim = await lockClaim(
      tx,
      input.groupId,
      input.editionId,
      input.claimId,
    );
    if (!claim) return { ok: false, error: MISSING_CLAIM };
    const decision = decideClaimAction({
      action: "withdraw",
      actor: { userId: actor.userId, membership: actor.permissions },
      claim,
    });
    if (!decision.ok) return refused(decision.reason);
    await tx
      .delete(schema.campClaims)
      .where(
        and(
          eq(schema.campClaims.id, claim.id),
          eq(schema.campClaims.status, "submitted"),
        ),
      );
    receiptKey = claim.receiptKey;
    await audit(
      tx,
      input.actorUserId,
      MONEY_AUDIT.claimWithdraw,
      input.groupId,
      input.editionId,
      {
        claimId: claim.id,
        amountCents: claim.amountCents,
      },
    );
    return { ok: true };
  });
  if (result.ok) await deleteReceiptBlobQuietly(input.groupId, receiptKey);
  return result;
}

type DecideFields =
  | { action: "approve"; categoryId: string | null }
  | { action: "reject"; note: string }
  | { action: "repay"; repaidOn: string };

/**
 * Approve, reject or mark repaid. The claim row is locked `FOR UPDATE`, the
 * decision is taken in @quagga/core from what the row says now, and the
 * UPDATE is compare-and-set on the status it decided from — so two money
 * people deciding at once decide it once, and the claimant is never the one
 * deciding (also a CHECK on the table).
 */
async function decideClaim(
  input: WriteBase & { claimId: string; fields: DecideFields },
): Promise<MoneyResult> {
  const notices: NotificationRow[] = [];
  const result = await withTransaction(async (tx): Promise<MoneyResult> => {
    const actor = await lockMoneyActor(tx, input.groupId, input.actorUserId);
    if (!actor) return refused("not_member");
    const claim = await lockClaim(
      tx,
      input.groupId,
      input.editionId,
      input.claimId,
    );
    if (!claim) return { ok: false, error: MISSING_CLAIM };
    const f = input.fields;
    let categoryId = claim.categoryId;
    let category: CategoryFacts | null | undefined = undefined;
    if (f.action === "approve") {
      categoryId = f.categoryId ?? claim.categoryId;
      category = categoryId
        ? await lockCategory(tx, input.groupId, input.editionId, categoryId)
        : null;
    }
    const decision = decideClaimAction({
      action: f.action,
      actor: { userId: actor.userId, membership: actor.permissions },
      claim,
      category,
    });
    if (!decision.ok) return refused(decision.reason);
    const now = new Date();
    const from = claim.status;
    const set =
      f.action === "approve"
        ? {
            status: "approved" as const,
            categoryId,
            decidedByUserId: actor.userId,
            decidedAt: now,
            updatedAt: now,
          }
        : f.action === "reject"
          ? {
              status: "rejected" as const,
              decidedByUserId: actor.userId,
              decidedAt: now,
              decisionNote: f.note,
              updatedAt: now,
            }
          : {
              status: "repaid" as const,
              repaidOn: f.repaidOn,
              repaidByUserId: actor.userId,
              updatedAt: now,
            };
    const done = await tx
      .update(schema.campClaims)
      .set(set)
      .where(
        and(
          eq(schema.campClaims.id, claim.id),
          eq(schema.campClaims.status, from),
        ),
      )
      .returning({ id: schema.campClaims.id });
    if (!done[0]) return refused("claim_already_decided");
    await audit(
      tx,
      input.actorUserId,
      f.action === "approve"
        ? MONEY_AUDIT.claimApprove
        : f.action === "reject"
          ? MONEY_AUDIT.claimReject
          : MONEY_AUDIT.claimRepaid,
      input.groupId,
      input.editionId,
      {
        claimId: claim.id,
        claimantUserId: claim.claimantUserId,
        amountCents: claim.amountCents,
        from,
        to: set.status,
        categoryId,
        ...(f.action === "repay" ? { repaidOn: f.repaidOn } : {}),
      },
    );
    if (
      claim.claimantUserId &&
      (await claimantIsCurrent(tx, input.groupId, claim.claimantUserId))
    ) {
      const payload =
        f.action === "approve"
          ? claimApprovedNotification(actor.camp, claim.amountCents)
          : f.action === "reject"
            ? claimRejectedNotification(actor.camp, claim.amountCents, f.note)
            : claimRepaidNotification(actor.camp, claim.amountCents);
      notices.push(toRow(claim.claimantUserId, payload));
    }
    return { ok: true };
  });
  if (result.ok) await notifyAfterCommit(notices);
  return result;
}

export function approveClaim(
  input: WriteBase &
    Omit<ApproveClaimInput, "slug" | "categoryId"> & {
      categoryId: string | null;
    },
): Promise<MoneyResult> {
  return decideClaim({
    ...input,
    fields: { action: "approve", categoryId: input.categoryId },
  });
}

export function rejectClaim(
  input: WriteBase & Omit<RejectClaimInput, "slug">,
): Promise<MoneyResult> {
  return decideClaim({
    ...input,
    fields: { action: "reject", note: input.note },
  });
}

export function markClaimRepaid(
  input: WriteBase & Omit<MarkClaimRepaidInput, "slug">,
): Promise<MoneyResult> {
  return decideClaim({
    ...input,
    fields: { action: "repay", repaidOn: input.repaidOn },
  });
}
