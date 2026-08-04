import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as DbModule from "@/lib/db";
import { installFakeDb, type FakeDb } from "@/test/fakes/db";
import { refusal, success } from "@/test/fakes/expect";
import type { SupplierSession } from "@/lib/session";

// Driving one onboarding step as the supplier (lib/actions/onboarding.ts).
//
// ONE STEP, ONE WAY TO COMPLETE IT. When the org binds a required document to a
// step, acknowledging that document is what completes it. This action used to
// be a SECOND, independent route to the same `completed`, and it skipped the
// document entirely. Two things went wrong for a real supplier: they could
// press "Sign the agreement" without ever opening the agreement; and because
// reconciliation recomputes every bound step from the acknowledgements, their
// very next tick on ANY document quietly reverted the step they had just
// signed, with no explanation. The refusal — including its singular versus
// plural form — is what sends them to the right place instead.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSupplierSession: vi.fn() }));
vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof DbModule>("@/lib/db");
  const { fakeDb: current } = await import("@/test/fakes/db");
  return {
    ...actual,
    getDb: () => current().handle,
    withTransaction: async <T>(fn: (tx: never) => Promise<T>): Promise<T> =>
      fn(current().handle as never),
  };
});

const { revalidatePath } = await import("next/cache");
const { requireSupplierSession } = await import("@/lib/session");
const { setOnboardingStep } = await import("@/lib/actions/onboarding");

const SESSION = {
  user: {
    id: "auth-alice",
    primaryEmail: "alice@example.com",
    displayName: "Alice Hatter",
    emailVerified: true,
  },
  dbUserId: "user-alice",
  supplier: { id: "sup-1", name: "Karoo Tents", standing: "good" },
  edition: { id: "ed-2027", name: "AfrikaBurn 2027", year: 2027 },
  steps: {},
  progress: { completed: 0, total: 7 },
} as unknown as SupplierSession;

function boundDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    title: "Supplier agreement",
    sourceType: "link",
    url: "https://example.com/agreement.pdf",
    requiredAck: true,
    stepKey: "agreement_signed",
    sort: 0,
    ...overrides,
  };
}

let db: FakeDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = installFakeDb();
  vi.mocked(requireSupplierSession).mockResolvedValue(SESSION);
  db.rows("supplier_documents", []);
  db.rows("supplier_onboarding", [{ steps: {} }]);
});

describe("refusals", () => {
  it("refuses every org-confirmed step, before opening a transaction", async () => {
    // Deposit, briefing and fee are AfrikaBurn's to confirm. The platform never
    // processes funds, so "I paid" is not evidence the org received anything.
    for (const stepKey of [
      "deposit_paid",
      "briefing_attended",
      "registration_fee_paid",
    ] as const) {
      db = installFakeDb();

      const result = await setOnboardingStep({ stepKey, to: "completed" });

      expect(refusal(result)).toBe("Only AfrikaBurn can confirm this step.");
      expect(db.queries).toEqual([]);
    }
  });

  it("refuses an unknown step key at the boundary", async () => {
    const result = await setOnboardingStep({
      stepKey: "free_beer" as never,
      to: "completed",
    });

    expect(refusal(result)).toMatch(/invalid|expected|option/i);
    expect(db.queries).toEqual([]);
  });

  it("refuses a step with ONE bound document, naming that document", async () => {
    // Naming it is the point: the supplier has to know which box to tick and
    // where. "Not allowed" alone leaves them stuck on a step they must complete.
    db.rows("supplier_documents", [boundDocument()]);

    const message = refusal(
      await setOnboardingStep({ stepKey: "agreement_signed", to: "completed" }),
    );

    expect(message).toContain('"Supplier agreement"');
    expect(message).toContain("Documents & links");
    expect(message).toContain("tick its box");
    expect(db.matching('update "supplier_onboarding"')).toEqual([]);
  });

  it("refuses a step with SEVERAL bound documents with the plural message, naming none", async () => {
    db.rows("supplier_documents", [
      boundDocument(),
      boundDocument({ id: "doc-2", title: "Depot rules" }),
    ]);

    const message = refusal(
      await setOnboardingStep({ stepKey: "agreement_signed", to: "completed" }),
    );

    expect(message).toContain("tick each box");
    // Listing two titles inside a sentence reads badly and goes stale as soon
    // as the org adds a third.
    expect(message).not.toContain('"Supplier agreement"');
    expect(message).not.toContain('"Depot rules"');
  });

  it("surfaces the core transition's own rejection reason verbatim", async () => {
    // An org-reviewed step (inventory, crew) may be submitted or withdrawn by
    // the supplier, never completed. The wording belongs to @quagga/core, so
    // one policy answers for all three apps.
    const message = refusal(
      await setOnboardingStep({
        stepKey: "inventory_submitted",
        to: "completed",
      }),
    );

    expect(message).toBe(
      "AfrikaBurn must review and confirm this step — you can submit it, but not mark it complete.",
    );
    expect(db.matching('update "supplier_onboarding"')).toEqual([]);
  });

  it("refuses entirely without an ok supplier session", async () => {
    vi.mocked(requireSupplierSession).mockRejectedValue(
      new Error("Sign in as a registered supplier to do that."),
    );

    const result = await setOnboardingStep({
      stepKey: "agreement_signed",
      to: "completed",
    });

    expect(refusal(result)).toBe("Sign in as a registered supplier to do that.");
    expect(db.queries).toEqual([]);
  });
});

describe("a permitted transition", () => {
  it("validates against the map read INSIDE the transaction, not the session's copy", async () => {
    // `session.steps` was read before the transaction, on another connection.
    // Validating against it would let a step be driven from a state it has
    // already left — and the UPDATE below persists the whole seven-step map.
    vi.mocked(requireSupplierSession).mockResolvedValue({
      ...SESSION,
      steps: { agreement_signed: "pending", deposit_paid: "pending" },
    } as unknown as SupplierSession);
    db.rows("supplier_onboarding", [
      { steps: { agreement_signed: "pending", deposit_paid: "completed" } },
    ]);

    success(
      await setOnboardingStep({ stepKey: "agreement_signed", to: "completed" }),
    );

    const read = db.matching('select "steps" from "supplier_onboarding"')[0]!;
    expect(read.sql).toContain("for update");

    const write = db.matching('update "supplier_onboarding" set "steps"')[0]!;
    expect(JSON.parse(String(write.params[0]))).toEqual({
      agreement_signed: "completed",
      // The org's confirmation survives, because the map came from the tx.
      deposit_paid: "completed",
    });
  });

  it("writes the map, audits the move, and revalidates the checklist", async () => {
    success(
      await setOnboardingStep({
        stepKey: "inventory_submitted",
        to: "awaiting_confirmation",
      }),
    );

    const audit = db.matching('insert into "audit_events"')[0]!;
    expect(audit.params).toContain("supplier.onboarding_step");
    expect(audit.params).toContain("user-alice");
    expect(audit.params).toContain("sup-1");
    const meta = JSON.parse(String(audit.params.at(-1)));
    expect(meta).toEqual({
      step: "inventory_submitted",
      to: "awaiting_confirmation",
      edition: 2027,
    });

    expect(revalidatePath).toHaveBeenCalledWith("/onboarding");
  });

  it("scopes the write to this supplier AND this edition", async () => {
    success(
      await setOnboardingStep({ stepKey: "agreement_signed", to: "completed" }),
    );

    const write = db.matching('update "supplier_onboarding" set "steps"')[0]!;
    expect(write.sql).toContain('"supplier_onboarding"."supplier_id" = ');
    expect(write.sql).toContain('"supplier_onboarding"."edition_id" = ');
    expect(write.params).toContain("sup-1");
    expect(write.params).toContain("ed-2027");
  });

  it("lets a self-service step be undone", async () => {
    db.rows("supplier_onboarding", [{ steps: { agreement_signed: "completed" } }]);

    success(
      await setOnboardingStep({ stepKey: "agreement_signed", to: "pending" }),
    );

    const write = db.matching('update "supplier_onboarding" set "steps"')[0]!;
    expect(JSON.parse(String(write.params[0]))).toEqual({
      agreement_signed: "pending",
    });
  });
});
