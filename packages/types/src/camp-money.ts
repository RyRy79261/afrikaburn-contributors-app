import { z } from "zod";

// Camp money: budget, dues and claims (docs/camp-budget-spec.md). This file is
// the VALIDATION authority for every money input crossing a server-action
// boundary; the storage authority is `camp_budgets`, `budget_categories`,
// `budget_entries`, `member_dues`, `dues_payments` and `camp_claims` in
// @quagga/db schema.ts, and the rules live in @quagga/core camp-budget.ts.
//
// RECORDS, NEVER TRANSACTIONS (Decision 009). Every amount here is a NOTE of
// money that moved somewhere else — by EFT, between people and the camp's own
// bank account. Nothing in this file names a card, an account to debit, a
// payment link or a gateway, and nothing ever should.
//
// Every input names a camp by slug plus ids, amounts, dates and text. Who may
// act is decided server-side from the session, never from the payload.

/** Keep in sync with `campBudgetStatusEnum` in @quagga/db schema.ts. */
export const CampBudgetStatus = z.enum(["draft", "approved"]);
export type CampBudgetStatus = z.infer<typeof CampBudgetStatus>;

/** Keep in sync with `budgetCategoryKindEnum` in @quagga/db schema.ts. */
export const BudgetCategoryKind = z.enum(["expense", "income"]);
export type BudgetCategoryKind = z.infer<typeof BudgetCategoryKind>;

/** Keep in sync with `budgetEntryStatusEnum` in @quagga/db schema.ts. */
export const BudgetEntryStatus = z.enum(["committed", "paid"]);
export type BudgetEntryStatus = z.infer<typeof BudgetEntryStatus>;

/** Keep in sync with `campClaimStatusEnum` in @quagga/db schema.ts. */
export const CampClaimStatus = z.enum([
  "submitted",
  "approved",
  "rejected",
  "repaid",
]);
export type CampClaimStatus = z.infer<typeof CampClaimStatus>;

/** A member's dues standing — DERIVED (@quagga/core `duesStatus`), never
 * stored. `waived` is an amount of R 0,00 set FOR this member (with a
 * reason); `no_fee` is a member on the camp fee while the camp has not set
 * one yet — owing nothing, but not waived either. */
export const DuesStatus = z.enum([
  "awaiting",
  "part_paid",
  "paid",
  "waived",
  "no_fee",
]);
export type DuesStatus = z.infer<typeof DuesStatus>;

/** The largest single amount any money input accepts: R10 000 000,00. A
 * ceiling against a typo (an extra zero or three), well inside a Postgres
 * `integer`. Not a limit on what a camp may spend in total. */
export const MONEY_MAX_CENTS = 1_000_000_000;
export const MONEY_CATEGORY_NAME_MAX = 40;
export const MONEY_MAX_CATEGORIES = 40;
export const MONEY_DESCRIPTION_MAX = 200;
export const MONEY_NOTE_MAX = 500;
export const MONEY_INSTRUCTIONS_MAX = 2_000;
export const MONEY_CONTINGENCY_MAX_PCT = 50;

const Uuid = z.string().uuid();
const Slug = z.string().min(1).max(200);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` that is a real calendar day ("2027-02-31" is refused). */
export const MoneyDate = z
  .string()
  .regex(ISO_DATE, "Pick a day.")
  .refine((v) => {
    const m = ISO_DATE.exec(v);
    if (!m) return false;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return (
      d.getUTCFullYear() === Number(m[1]) &&
      d.getUTCMonth() === Number(m[2]) - 1 &&
      d.getUTCDate() === Number(m[3])
    );
  }, "Pick a day.");

/** A positive amount in whole cents. */
export const MoneyAmountCents = z
  .number()
  .int("Amounts are in whole cents.")
  .min(1, "Enter an amount more than R 0,00.")
  .max(MONEY_MAX_CENTS, "That amount is too large — check for an extra zero.");

/** An amount in whole cents that may be zero (a plan line, a camp fee, a
 * waived member's dues). */
export const MoneyAmountOrZeroCents = z
  .number()
  .int("Amounts are in whole cents.")
  .min(0, "Amounts can't be negative.")
  .max(MONEY_MAX_CENTS, "That amount is too large — check for an extra zero.");

/** Optional free text: blank becomes null. */
const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null));

const requiredText = (max: number, empty: string, tooLong: string) =>
  z.string().trim().min(1, empty).max(max, tooLong);

const CategoryName = requiredText(
  MONEY_CATEGORY_NAME_MAX,
  "Give the category a name.",
  `Keep the name under ${MONEY_CATEGORY_NAME_MAX} characters.`,
);

const Description = requiredText(
  MONEY_DESCRIPTION_MAX,
  "Say what it was for.",
  `Keep it under ${MONEY_DESCRIPTION_MAX} characters.`,
);

// --- Budget settings (money people) --------------------------------------

/** Change the camp fee — what each member owes unless set otherwise. */
export const SetCampFeeInput = z
  .object({ slug: Slug, defaultDuesCents: MoneyAmountOrZeroCents })
  .strict();
export type SetCampFeeInput = z.infer<typeof SetCampFeeInput>;

/** The camp's own "how to pay the camp" text. Blank clears it. */
export const SetPaymentInstructionsInput = z
  .object({
    slug: Slug,
    paymentInstructions: optionalText(
      MONEY_INSTRUCTIONS_MAX,
      `Keep the instructions under ${MONEY_INSTRUCTIONS_MAX} characters.`,
    ),
  })
  .strict();
export type SetPaymentInstructionsInput = z.input<
  typeof SetPaymentInstructionsInput
>;

/** "Edit the plan": the contingency and every category's planned amount, in
 * one save. Lines name categories by id; a category not listed is unchanged. */
export const SetBudgetPlanInput = z
  .object({
    slug: Slug,
    contingencyPct: z
      .number()
      .int("The contingency is a whole percent.")
      .min(0, "The contingency can't be negative.")
      .max(
        MONEY_CONTINGENCY_MAX_PCT,
        `Keep the contingency at ${MONEY_CONTINGENCY_MAX_PCT}% or less.`,
      ),
    lines: z
      .array(
        z
          .object({ categoryId: Uuid, plannedCents: MoneyAmountOrZeroCents })
          .strict(),
      )
      .max(MONEY_MAX_CATEGORIES)
      .refine(
        (lines) =>
          new Set(lines.map((l) => l.categoryId)).size === lines.length,
        "Each category appears once.",
      ),
  })
  .strict();
export type SetBudgetPlanInput = z.infer<typeof SetBudgetPlanInput>;

/** Sign the plan off. Records who and when; changes stay possible. */
export const ApproveBudgetInput = z.object({ slug: Slug }).strict();
export type ApproveBudgetInput = z.infer<typeof ApproveBudgetInput>;

// --- Categories -----------------------------------------------------------

export const AddBudgetCategoryInput = z
  .object({
    slug: Slug,
    kind: BudgetCategoryKind,
    name: CategoryName,
    plannedCents: MoneyAmountOrZeroCents,
  })
  .strict();
export type AddBudgetCategoryInput = z.infer<typeof AddBudgetCategoryInput>;

export const RenameBudgetCategoryInput = z
  .object({ slug: Slug, categoryId: Uuid, name: CategoryName })
  .strict();
export type RenameBudgetCategoryInput = z.infer<
  typeof RenameBudgetCategoryInput
>;

/** Remove a category: deleted when nothing uses it, archived otherwise. */
export const RemoveBudgetCategoryInput = z
  .object({ slug: Slug, categoryId: Uuid })
  .strict();
export type RemoveBudgetCategoryInput = z.infer<
  typeof RemoveBudgetCategoryInput
>;

// --- Entries (actual spending and income) ---------------------------------

const EntryFields = {
  categoryId: Uuid,
  amountCents: MoneyAmountCents,
  entryDate: MoneyDate,
  description: Description,
  status: BudgetEntryStatus,
};

export const AddBudgetEntryInput = z
  .object({ slug: Slug, ...EntryFields })
  .strict();
export type AddBudgetEntryInput = z.infer<typeof AddBudgetEntryInput>;

/** Correct an entry. The change is audited with the amounts before and after. */
export const UpdateBudgetEntryInput = z
  .object({ slug: Slug, entryId: Uuid, ...EntryFields })
  .strict();
export type UpdateBudgetEntryInput = z.infer<typeof UpdateBudgetEntryInput>;

export const DeleteBudgetEntryInput = z
  .object({ slug: Slug, entryId: Uuid })
  .strict();
export type DeleteBudgetEntryInput = z.infer<typeof DeleteBudgetEntryInput>;

// --- Dues -----------------------------------------------------------------

/**
 * Set what one member owes. `amountCents: null` = back to the camp fee.
 * R 0,00 waives their dues and needs a reason ("runs the build crew").
 */
export const SetMemberDuesInput = z
  .object({
    slug: Slug,
    userId: Uuid,
    amountCents: MoneyAmountOrZeroCents.nullable(),
    reason: optionalText(
      MONEY_NOTE_MAX,
      `Keep the reason under ${MONEY_NOTE_MAX} characters.`,
    ),
  })
  .strict()
  .refine((v) => v.amountCents !== 0 || v.reason !== null, {
    message: "Say why their dues are waived.",
    path: ["reason"],
  });
export type SetMemberDuesInput = z.input<typeof SetMemberDuesInput>;

/** Record money a money person SAW ARRIVE in the camp's account. */
export const RecordDuesPaymentInput = z
  .object({
    slug: Slug,
    userId: Uuid,
    amountCents: MoneyAmountCents,
    receivedOn: MoneyDate,
    note: optionalText(
      MONEY_NOTE_MAX,
      `Keep the note under ${MONEY_NOTE_MAX} characters.`,
    ),
  })
  .strict();
export type RecordDuesPaymentInput = z.input<typeof RecordDuesPaymentInput>;

/** Remove a payment recorded in error (audited). Record it again if needed. */
export const DeleteDuesPaymentInput = z
  .object({ slug: Slug, paymentId: Uuid })
  .strict();
export type DeleteDuesPaymentInput = z.infer<typeof DeleteDuesPaymentInput>;

// --- Claims ---------------------------------------------------------------

/** A member claims back money they spent for the camp. The receipt travels
 * beside this (multipart), checked by @quagga/core `checkReceiptUpload`. */
export const SubmitClaimInput = z
  .object({
    slug: Slug,
    categoryId: Uuid.nullable().default(null),
    amountCents: MoneyAmountCents,
    description: Description,
  })
  .strict();
export type SubmitClaimInput = z.input<typeof SubmitClaimInput>;

/** The claimant takes back a claim nobody has decided yet. */
export const WithdrawClaimInput = z
  .object({ slug: Slug, claimId: Uuid })
  .strict();
export type WithdrawClaimInput = z.infer<typeof WithdrawClaimInput>;

/** Approve a claim. `categoryId` files it (required when the claimant left
 * the category blank; otherwise it may re-file it). */
export const ApproveClaimInput = z
  .object({
    slug: Slug,
    claimId: Uuid,
    categoryId: Uuid.nullable().default(null),
  })
  .strict();
export type ApproveClaimInput = z.input<typeof ApproveClaimInput>;

/** Reject a claim: the note is REQUIRED — the claimant reads it. */
export const RejectClaimInput = z
  .object({
    slug: Slug,
    claimId: Uuid,
    note: requiredText(
      MONEY_NOTE_MAX,
      "Tell them why — they see this note.",
      `Keep the note under ${MONEY_NOTE_MAX} characters.`,
    ),
  })
  .strict();
export type RejectClaimInput = z.infer<typeof RejectClaimInput>;

/** Record that the camp paid the claimant back (by EFT, outside the app). */
export const MarkClaimRepaidInput = z
  .object({ slug: Slug, claimId: Uuid, repaidOn: MoneyDate })
  .strict();
export type MarkClaimRepaidInput = z.infer<typeof MarkClaimRepaidInput>;

/** Which record a receipt hangs off (the receipt route's parameter). */
export const ReceiptSubjectKind = z.enum(["claim", "entry"]);
export type ReceiptSubjectKind = z.infer<typeof ReceiptSubjectKind>;
