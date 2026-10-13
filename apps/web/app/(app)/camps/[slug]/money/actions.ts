"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  AddBudgetCategoryInput,
  AddBudgetEntryInput,
  ApproveBudgetInput,
  ApproveClaimInput,
  DeleteBudgetEntryInput,
  DeleteDuesPaymentInput,
  MarkClaimRepaidInput,
  RecordDuesPaymentInput,
  RejectClaimInput,
  RemoveBudgetCategoryInput,
  RenameBudgetCategoryInput,
  SetBudgetPlanInput,
  SetCampFeeInput,
  SetMemberDuesInput,
  SetPaymentInstructionsInput,
  SubmitClaimInput,
  UpdateBudgetEntryInput,
  WithdrawClaimInput,
} from "@quagga/types";
import { getActiveEdition } from "@/lib/edition";
import { requireCampUser } from "@/lib/session";
import {
  addBudgetCategory,
  addBudgetEntry,
  approveBudget,
  approveClaim,
  deleteBudgetEntry,
  deleteDuesPayment,
  loadMemberPayments,
  loadMoneyAccess,
  markClaimRepaid,
  recordDuesPayment,
  rejectClaim,
  removeBudgetCategory,
  renameBudgetCategory,
  setBudgetPlan,
  setCampFee,
  setMemberDues,
  setPaymentInstructions,
  submitClaim,
  updateBudgetEntry,
  withdrawClaim,
  type DuesPaymentView,
  type MoneyResult,
} from "@/lib/camp-money-store";

// Camp money actions (docs/camp-budget-spec.md). Zod at the boundary; every
// request names the camp by slug and then only ids. WHO the caller is comes
// from the session; whether they may do it is decided by @quagga/core inside
// the store's transaction, over facts the store reads itself (it locks the
// caller's membership first). Nothing here is a permission check on its own.
//
// ONE ANSWER for "no such camp" and "a camp you are not in": `loadMoneyAccess`
// is null for both (and for an archived member, and for a project that is not
// a theme camp), so the actions are no oracle for a free camp's existence.
//
// RECORDS ONLY. No action here takes, moves or refunds money: "record money
// in" writes what a money person saw arrive in the camp's own account, and
// "mark repaid" records an EFT the camp already made (Decision 009).
//
// Receipts do NOT travel through these actions — a server action's body is
// capped at 1 MB. They go to POST /api/money/receipts after the record exists.

export type MoneyActionResult<T = object> = MoneyResult<T>;

const NOT_FOUND = "Camp not found.";

interface Resolved {
  ok: true;
  actorUserId: string;
  groupId: string;
  editionId: string;
}

async function resolve(
  slug: string,
): Promise<Resolved | { ok: false; error: string }> {
  const user = await requireCampUser();
  const access = await loadMoneyAccess(slug, user.id);
  if (!access) return { ok: false, error: NOT_FOUND };
  const edition = await getActiveEdition();
  if (!edition) return { ok: false, error: "No active edition is configured." };
  return {
    ok: true,
    actorUserId: user.id,
    groupId: access.camp.id,
    editionId: edition.id,
  };
}

function firstIssue(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

function revalidate(slug: string) {
  revalidatePath(`/camps/${slug}`);
  revalidatePath(`/camps/${slug}/money`);
}

/**
 * Parse → resolve → write → revalidate, the same four steps for every action.
 * The store call gets the parsed fields (slug removed) and the resolved camp.
 */
async function run<S extends z.ZodTypeAny, T extends object>(
  schema: S,
  raw: unknown,
  fallback: string,
  write: (
    base: Omit<Resolved, "ok">,
    fields: Omit<z.output<S>, "slug">,
  ) => Promise<MoneyResult<T>>,
): Promise<MoneyActionResult<T>> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, fallback) };
  }
  const { slug, ...rest } = parsed.data as { slug: string };
  // Every schema here is a strict object with a `slug`; what remains after
  // taking it out is exactly the schema's other fields.
  const fields = rest as Omit<z.output<S>, "slug">;
  const r = await resolve(slug);
  if (!r.ok) return r;
  const result = await write(
    { actorUserId: r.actorUserId, groupId: r.groupId, editionId: r.editionId },
    fields,
  );
  if (result.ok) revalidate(slug);
  return result;
}

// --- The budget (money people) ------------------------------------------------

export async function setCampFeeAction(
  raw: unknown,
): Promise<MoneyActionResult> {
  return run(SetCampFeeInput, raw, "Check the camp fee.", (base, f) =>
    setCampFee({ ...base, defaultDuesCents: f.defaultDuesCents }),
  );
}

export async function setPaymentInstructionsAction(
  raw: unknown,
): Promise<MoneyActionResult> {
  return run(
    SetPaymentInstructionsInput,
    raw,
    "Check the instructions.",
    (base, f) =>
      setPaymentInstructions({
        ...base,
        paymentInstructions: f.paymentInstructions,
      }),
  );
}

export async function setBudgetPlanAction(
  raw: unknown,
): Promise<MoneyActionResult> {
  return run(SetBudgetPlanInput, raw, "Check the plan.", (base, f) =>
    setBudgetPlan({
      ...base,
      contingencyPct: f.contingencyPct,
      lines: f.lines,
    }),
  );
}

export async function approveBudgetAction(
  raw: unknown,
): Promise<MoneyActionResult> {
  return run(ApproveBudgetInput, raw, "Camp not found.", (base) =>
    approveBudget(base),
  );
}

export async function addBudgetCategoryAction(
  raw: unknown,
): Promise<MoneyActionResult<{ id: string }>> {
  return run(AddBudgetCategoryInput, raw, "Check the category.", (base, f) =>
    addBudgetCategory({ ...base, ...f }),
  );
}

export async function renameBudgetCategoryAction(
  raw: unknown,
): Promise<MoneyActionResult> {
  return run(RenameBudgetCategoryInput, raw, "Check the category.", (base, f) =>
    renameBudgetCategory({ ...base, ...f }),
  );
}

export async function removeBudgetCategoryAction(
  raw: unknown,
): Promise<MoneyActionResult<{ action: "delete" | "archive" }>> {
  return run(RemoveBudgetCategoryInput, raw, "Check the category.", (base, f) =>
    removeBudgetCategory({ ...base, categoryId: f.categoryId }),
  );
}

export async function addBudgetEntryAction(
  raw: unknown,
): Promise<MoneyActionResult<{ id: string }>> {
  return run(AddBudgetEntryInput, raw, "Check the entry.", (base, f) =>
    addBudgetEntry({ ...base, fields: f }),
  );
}

export async function updateBudgetEntryAction(
  raw: unknown,
): Promise<MoneyActionResult> {
  return run(UpdateBudgetEntryInput, raw, "Check the entry.", (base, f) =>
    updateBudgetEntry({ ...base, fields: f }),
  );
}

export async function deleteBudgetEntryAction(
  raw: unknown,
): Promise<MoneyActionResult> {
  return run(DeleteBudgetEntryInput, raw, "Check the entry.", (base, f) =>
    deleteBudgetEntry({ ...base, entryId: f.entryId }),
  );
}

// --- Dues (money people) --------------------------------------------------------

export async function setMemberDuesAction(
  raw: unknown,
): Promise<MoneyActionResult> {
  return run(SetMemberDuesInput, raw, "Check the amount.", (base, f) =>
    setMemberDues({
      ...base,
      userId: f.userId,
      amountCents: f.amountCents,
      reason: f.reason,
    }),
  );
}

export async function recordDuesPaymentAction(
  raw: unknown,
): Promise<MoneyActionResult<{ id: string }>> {
  return run(RecordDuesPaymentInput, raw, "Check the amount.", (base, f) =>
    recordDuesPayment({ ...base, fields: f }),
  );
}

export async function deleteDuesPaymentAction(
  raw: unknown,
): Promise<MoneyActionResult> {
  return run(DeleteDuesPaymentInput, raw, "Check the payment.", (base, f) =>
    deleteDuesPayment({ ...base, paymentId: f.paymentId }),
  );
}

const MemberPaymentsInput = z
  .object({ slug: z.string().min(1).max(200), userId: z.string().uuid() })
  .strict();

/** One member's recorded money in, notes included — money people only (the
 * store returns null for anyone else, which answers like a missing camp). */
export async function listMemberPaymentsAction(
  raw: unknown,
): Promise<MoneyActionResult<{ payments: DuesPaymentView[] }>> {
  const parsed = MemberPaymentsInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: NOT_FOUND };
  const user = await requireCampUser();
  const access = await loadMoneyAccess(parsed.data.slug, user.id);
  if (!access) return { ok: false, error: NOT_FOUND };
  const edition = await getActiveEdition();
  if (!edition) return { ok: false, error: "No active edition is configured." };
  const payments = await loadMemberPayments(
    access,
    { id: edition.id, year: edition.year },
    parsed.data.userId,
  );
  if (!payments) return { ok: false, error: NOT_FOUND };
  return { ok: true, payments };
}

// --- Claims ------------------------------------------------------------------------

/** Any current member, for money they spent for the camp. */
export async function submitClaimAction(
  raw: unknown,
): Promise<MoneyActionResult<{ id: string }>> {
  return run(SubmitClaimInput, raw, "Check the claim.", (base, f) =>
    submitClaim({
      ...base,
      fields: {
        categoryId: f.categoryId,
        amountCents: f.amountCents,
        description: f.description,
      },
    }),
  );
}

export async function withdrawClaimAction(
  raw: unknown,
): Promise<MoneyActionResult> {
  return run(WithdrawClaimInput, raw, "Check the claim.", (base, f) =>
    withdrawClaim({ ...base, claimId: f.claimId }),
  );
}

export async function approveClaimAction(
  raw: unknown,
): Promise<MoneyActionResult> {
  return run(ApproveClaimInput, raw, "Check the claim.", (base, f) =>
    approveClaim({ ...base, claimId: f.claimId, categoryId: f.categoryId }),
  );
}

export async function rejectClaimAction(
  raw: unknown,
): Promise<MoneyActionResult> {
  return run(RejectClaimInput, raw, "Check the claim.", (base, f) =>
    rejectClaim({ ...base, claimId: f.claimId, note: f.note }),
  );
}

export async function markClaimRepaidAction(
  raw: unknown,
): Promise<MoneyActionResult> {
  return run(MarkClaimRepaidInput, raw, "Check the claim.", (base, f) =>
    markClaimRepaid({ ...base, claimId: f.claimId, repaidOn: f.repaidOn }),
  );
}
