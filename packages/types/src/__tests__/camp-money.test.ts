import { describe, expect, it } from "vitest";
import {
  AddBudgetEntryInput,
  ApproveClaimInput,
  BudgetCategoryKind,
  BudgetEntryStatus,
  CampBudgetStatus,
  CampClaimStatus,
  DuesStatus,
  MONEY_MAX_CENTS,
  NotificationKind,
  PROJECT_PERMISSION_KEYS,
  PROJECT_PERMISSION_LABELS,
  ProjectPermissions,
  RecordDuesPaymentInput,
  RejectClaimInput,
  SetBudgetPlanInput,
  SetMemberDuesInput,
  SetPaymentInstructionsInput,
  SubmitClaimInput,
} from "../index";

const ID = "6f1c1a52-7c0e-4b8a-9d8e-2f4a3b5c6d7e";
const ID2 = "7f1c1a52-7c0e-4b8a-9d8e-2f4a3b5c6d7e";

describe("camp money vocabularies", () => {
  it("lock every status", () => {
    expect(CampBudgetStatus.options).toEqual(["draft", "approved"]);
    expect(BudgetCategoryKind.options).toEqual(["expense", "income"]);
    expect(BudgetEntryStatus.options).toEqual(["committed", "paid"]);
    expect(CampClaimStatus.options).toEqual([
      "submitted",
      "approved",
      "rejected",
      "repaid",
    ]);
    expect(DuesStatus.options).toEqual([
      "awaiting",
      "part_paid",
      "paid",
      "waived",
      "no_fee",
    ]);
  });

  it("adds the `money` notification kind and the `manage_money` privilege", () => {
    expect(NotificationKind.safeParse("money").success).toBe(true);
    expect(PROJECT_PERMISSION_KEYS).toContain("manage_money");
    expect(PROJECT_PERMISSION_LABELS.manage_money).toBe("Manage money");
    expect(ProjectPermissions.parse({ manage_money: true })).toEqual({
      manage_money: true,
    });
  });
});

describe("amounts", () => {
  it("are positive whole cents under the ceiling", () => {
    const base = {
      slug: "mad-hatters",
      categoryId: ID,
      entryDate: "2027-04-09",
      description: "Bulk dry goods for the kitchen",
      status: "paid",
    };
    expect(
      AddBudgetEntryInput.safeParse({ ...base, amountCents: 320_000 }).success,
    ).toBe(true);
    for (const amountCents of [0, -1, 10.5, MONEY_MAX_CENTS + 1]) {
      expect(
        AddBudgetEntryInput.safeParse({ ...base, amountCents }).success,
      ).toBe(false);
    }
    expect(
      AddBudgetEntryInput.safeParse({
        ...base,
        amountCents: 1,
        entryDate: "2027-02-31",
      }).success,
    ).toBe(false);
  });

  it("never accept a field the action does not name", () => {
    expect(
      SubmitClaimInput.safeParse({
        slug: "mad-hatters",
        amountCents: 38_500,
        description: "Ice for the cooler boxes",
        claimantUserId: ID,
      }).success,
    ).toBe(false);
  });
});

describe("dues", () => {
  it("needs a reason to waive, and null puts a member back on the camp fee", () => {
    expect(
      SetMemberDuesInput.safeParse({
        slug: "s",
        userId: ID,
        amountCents: 0,
        reason: " ",
      }).success,
    ).toBe(false);
    expect(
      SetMemberDuesInput.parse({
        slug: "s",
        userId: ID,
        amountCents: 0,
        reason: "Runs the build crew",
      }).reason,
    ).toBe("Runs the build crew");
    expect(
      SetMemberDuesInput.parse({ slug: "s", userId: ID, amountCents: null })
        .amountCents,
    ).toBeNull();
  });

  it("records money received with an optional note", () => {
    expect(
      RecordDuesPaymentInput.parse({
        slug: "s",
        userId: ID,
        amountCents: 150_000,
        receivedOn: "2027-04-14",
        note: "",
      }).note,
    ).toBeNull();
  });

  it("blanks payment instructions to null", () => {
    expect(
      SetPaymentInstructionsInput.parse({
        slug: "s",
        paymentInstructions: "  ",
      }).paymentInstructions,
    ).toBeNull();
  });
});

describe("plan and claims", () => {
  it("names each category once in a plan save", () => {
    const line = { categoryId: ID, plannedCents: 100 };
    expect(
      SetBudgetPlanInput.safeParse({
        slug: "s",
        contingencyPct: 5,
        lines: [line, line],
      }).success,
    ).toBe(false);
    expect(
      SetBudgetPlanInput.safeParse({
        slug: "s",
        contingencyPct: 5,
        lines: [line, { categoryId: ID2, plannedCents: 0 }],
      }).success,
    ).toBe(true);
    expect(
      SetBudgetPlanInput.safeParse({ slug: "s", contingencyPct: 51, lines: [] })
        .success,
    ).toBe(false);
  });

  it("requires a note to reject and lets an approval file the claim", () => {
    expect(
      RejectClaimInput.safeParse({ slug: "s", claimId: ID, note: "" }).success,
    ).toBe(false);
    expect(
      ApproveClaimInput.parse({ slug: "s", claimId: ID }).categoryId,
    ).toBeNull();
  });
});
