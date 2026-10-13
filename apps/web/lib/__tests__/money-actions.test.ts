import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetNextMocks, revalidated } from "@/test/next-mocks";

// Camp money ACTIONS — the boundary (docs/camp-budget-spec.md). What this pins:
//   · a camp the caller is not in answers exactly like one that does not
//     exist, and nothing reaches the store;
//   · Zod refuses bad input before anything resolves;
//   · the store gets the camp and edition the SERVER resolved, never a group
//     id or user id from the request, and the slug is not passed through.
// The store's own refusals (who may write, the author never deciding their
// own claim) are pinned in camp-money-store.test.ts.

vi.mock("next/cache", async () =>
  (await import("@/test/next-mocks")).nextCacheMock(),
);

const USER = "aaaaaaaa-0000-4000-8000-000000000009";
const OTHER = "aaaaaaaa-0000-4000-8000-000000000002";
const CAMP = "11111111-0000-4000-8000-00000000000a";
const EDITION = "eeeeeeee-0000-4000-8000-000000000000";
const CLAIM = "33333333-0000-4000-8000-000000000001";
const CATEGORY = "44444444-0000-4000-8000-000000000001";

const stubs = vi.hoisted(() => ({
  member: true,
  calls: [] as { fn: string; input: unknown }[],
}));

vi.mock("@/lib/session", () => ({
  requireCampUser: async () => ({ id: USER, email: "jabu@example.com" }),
}));
vi.mock("@/lib/edition", () => ({
  getActiveEdition: async () => ({
    id: EDITION,
    name: "AfrikaBurn 2027",
    year: 2027,
    startDate: "2027-04-26",
    endDate: "2027-05-02",
    isActive: true,
  }),
}));
vi.mock("@/lib/camp-money-store", () => {
  const record =
    (fn: string, extra: Record<string, unknown> = {}) =>
    async (input: unknown) => {
      stubs.calls.push({ fn, input });
      return { ok: true, ...extra };
    };
  return {
    loadMoneyAccess: async (slug: string, userId: string) =>
      stubs.member && slug === "mad-hatters"
        ? {
            camp: { id: CAMP, name: "Mad Hatters", slug, kind: "theme_camp" },
            viewerUserId: userId,
            membership: { structuralRole: "member", rolePermissions: [] },
            isMoneyPerson: false,
          }
        : null,
    loadMemberPayments: async () => null,
    addBudgetCategory: record("addBudgetCategory", { id: CATEGORY }),
    addBudgetEntry: record("addBudgetEntry", { id: "e" }),
    approveBudget: record("approveBudget"),
    approveClaim: record("approveClaim"),
    deleteBudgetEntry: record("deleteBudgetEntry"),
    deleteDuesPayment: record("deleteDuesPayment"),
    markClaimRepaid: record("markClaimRepaid"),
    recordDuesPayment: record("recordDuesPayment", { id: "p" }),
    rejectClaim: record("rejectClaim"),
    removeBudgetCategory: record("removeBudgetCategory", { action: "delete" }),
    renameBudgetCategory: record("renameBudgetCategory"),
    setBudgetPlan: record("setBudgetPlan"),
    setCampFee: record("setCampFee"),
    setMemberDues: record("setMemberDues"),
    setPaymentInstructions: record("setPaymentInstructions"),
    submitClaim: record("submitClaim", { id: CLAIM }),
    updateBudgetEntry: record("updateBudgetEntry"),
    withdrawClaim: record("withdrawClaim"),
  };
});

const actions = await import("@/app/(app)/camps/[slug]/money/actions");

beforeEach(() => {
  resetNextMocks();
  stubs.calls = [];
  stubs.member = true;
});

const BASE = { actorUserId: USER, groupId: CAMP, editionId: EDITION };

describe("money actions — one answer for every camp you are not in", () => {
  it("a slug that does not exist: Camp not found., and the store is never called", async () => {
    expect(
      await actions.submitClaimAction({
        slug: "no-such-camp",
        amountCents: 38500,
        description: "Ice",
      }),
    ).toEqual({ ok: false, error: "Camp not found." });
    expect(stubs.calls).toHaveLength(0);
  });

  it("a real camp the caller is not in: the SAME answer", async () => {
    stubs.member = false;
    for (const call of [
      () => actions.approveBudgetAction({ slug: "mad-hatters" }),
      () =>
        actions.recordDuesPaymentAction({
          slug: "mad-hatters",
          userId: OTHER,
          amountCents: 100000,
          receivedOn: "2027-04-14",
        }),
      () =>
        actions.listMemberPaymentsAction({
          slug: "mad-hatters",
          userId: OTHER,
        }),
    ]) {
      expect(await call()).toEqual({ ok: false, error: "Camp not found." });
    }
    expect(stubs.calls).toHaveLength(0);
    expect(revalidated).toHaveLength(0);
  });

  it("a member asking for another member's payments gets the same answer (the store says null)", async () => {
    expect(
      await actions.listMemberPaymentsAction({
        slug: "mad-hatters",
        userId: OTHER,
      }),
    ).toEqual({ ok: false, error: "Camp not found." });
  });
});

describe("money actions — Zod first", () => {
  it("refuses a claim with no amount, a waiver without a reason, a reject without a note", async () => {
    expect(
      await actions.submitClaimAction({
        slug: "mad-hatters",
        amountCents: 0,
        description: "Ice",
      }),
    ).toMatchObject({ ok: false });
    expect(
      await actions.setMemberDuesAction({
        slug: "mad-hatters",
        userId: OTHER,
        amountCents: 0,
        reason: "",
      }),
    ).toEqual({ ok: false, error: "Say why their dues are waived." });
    expect(
      await actions.rejectClaimAction({
        slug: "mad-hatters",
        claimId: CLAIM,
        note: "  ",
      }),
    ).toEqual({ ok: false, error: "Tell them why — they see this note." });
    expect(stubs.calls).toHaveLength(0);
  });

  it("refuses fields the schema does not know (a smuggled group or claimant id)", async () => {
    expect(
      await actions.submitClaimAction({
        slug: "mad-hatters",
        amountCents: 38500,
        description: "Ice",
        claimantUserId: OTHER,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await actions.approveBudgetAction({
        slug: "mad-hatters",
        groupId: "11111111-0000-4000-8000-00000000000b",
      }),
    ).toMatchObject({ ok: false });
    expect(stubs.calls).toHaveLength(0);
  });
});

describe("money actions — the store gets what the server resolved", () => {
  it("a claim: the session user, the resolved camp and edition, no slug", async () => {
    const result = await actions.submitClaimAction({
      slug: "mad-hatters",
      amountCents: 38500,
      description: "  Ice for the cooler boxes  ",
    });
    expect(result).toEqual({ ok: true, id: CLAIM });
    expect(stubs.calls).toEqual([
      {
        fn: "submitClaim",
        input: {
          ...BASE,
          fields: {
            categoryId: null,
            amountCents: 38500,
            description: "Ice for the cooler boxes",
          },
        },
      },
    ]);
    expect(revalidated.map((r) => r.path)).toEqual([
      "/camps/mad-hatters",
      "/camps/mad-hatters/money",
    ]);
  });

  it("money in: a blank note becomes null; the record carries no slug", async () => {
    await actions.recordDuesPaymentAction({
      slug: "mad-hatters",
      userId: OTHER,
      amountCents: 150000,
      receivedOn: "2027-04-14",
      note: "",
    });
    expect(stubs.calls[0]).toEqual({
      fn: "recordDuesPayment",
      input: {
        ...BASE,
        fields: {
          userId: OTHER,
          amountCents: 150000,
          receivedOn: "2027-04-14",
          note: null,
        },
      },
    });
  });

  it("approve: an unset category is null (the store keeps the claim's own)", async () => {
    await actions.approveClaimAction({ slug: "mad-hatters", claimId: CLAIM });
    expect(stubs.calls[0]).toEqual({
      fn: "approveClaim",
      input: { ...BASE, claimId: CLAIM, categoryId: null },
    });
  });

  it("a refused write is not revalidated", async () => {
    stubs.member = true;
    const failing = await import("@/lib/camp-money-store");
    const spy = vi
      .spyOn(failing, "withdrawClaim")
      .mockResolvedValueOnce({ ok: false, error: "Not your claim." });
    expect(
      await actions.withdrawClaimAction({
        slug: "mad-hatters",
        claimId: CLAIM,
      }),
    ).toEqual({ ok: false, error: "Not your claim." });
    expect(revalidated).toHaveLength(0);
    spy.mockRestore();
  });
});
