import { describe, it, expect, beforeEach, vi } from "vitest";

import { fakeDb, type FakeDb } from "./support/fake-db";

/**
 * THE TWO R1 WRITES ON THE REVIEW SCREEN: the staff-assigned placement handles,
 * and the paid checkbox.
 *
 * Both are guarded by `update` in the `registrations` domain — the same
 * capability as deciding the registration — and both write an audit row in the
 * same transaction as the change. A placement or payment change with no trail is
 * exactly what the audit log exists to prevent, and neither action is worth
 * anything if a reader can issue it.
 */

import type * as QuaggaDb from "@quagga/db";

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
  createPooledDb: () => ({ db, pool: { end: async () => {} } }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const requireOrgSession = vi.fn();
vi.mock("@/lib/session", () => ({
  requireOrgSession: (options?: unknown) => requireOrgSession(options),
}));

import { assignPlacement } from "@/lib/actions/placement";
import { recordRegistrationPayment } from "@/lib/actions/payments";

const REG_ID = "11111111-1111-4111-8111-111111111111";
const EDITION_ID = "22222222-2222-4222-8222-222222222222";
const GROUP_ID = "33333333-3333-4333-8333-333333333333";
const SESSION = { dbUserId: "user-1", orgGroupId: "org-1" };

beforeEach(() => {
  db = fakeDb();
  requireOrgSession.mockReset();
  requireOrgSession.mockResolvedValue(SESSION);
});

describe("assignPlacement", () => {
  /** The registration read, then the clash read (empty = code is free). */
  function seedRegistration(overrides: Record<string, unknown> = {}) {
    db.seed("registrations", [
      [
        {
          id: REG_ID,
          editionId: EDITION_ID,
          groupId: GROUP_ID,
          campSlug: "mad-hatters",
          ...overrides,
        },
      ],
      [], // no camp already holding the code
    ]);
    db.seed("groups", [{ name: "Mad Hatters", slug: "mad-hatters" }]);
  }

  it("asks for `update` on registrations — the decision capability", async () => {
    seedRegistration();
    await assignPlacement({ registrationId: REG_ID, campCode: "MAH", erf: "K12" });
    expect(requireOrgSession).toHaveBeenCalledWith({
      capability: "update",
      domain: "registrations",
    });
  });

  it("normalizes both fields through @quagga/core before writing", async () => {
    seedRegistration();
    const result = await assignPlacement({
      registrationId: REG_ID,
      campCode: "mah-1",
      erf: "  k12   north ",
    });

    expect(result.ok).toBe(true);
    const written = db.calls.find(
      (c) => c.op === "update" && c.table === "registrations",
    )?.values as Record<string, unknown>;
    expect(written.campCode).toBe("MAH1");
    expect(written.erf).toBe("K12 NORTH");
  });

  it("treats empty strings as clearing the assignment", async () => {
    seedRegistration();
    await assignPlacement({ registrationId: REG_ID, campCode: "", erf: "" });

    const written = db.calls.find(
      (c) => c.op === "update" && c.table === "registrations",
    )?.values as Record<string, unknown>;
    expect(written.campCode).toBeNull();
    expect(written.erf).toBeNull();
  });

  it("audits the assignment in the same transaction", async () => {
    seedRegistration();
    await assignPlacement({ registrationId: REG_ID, campCode: "MAH", erf: "K12" });

    const audit = db.calls.find(
      (c) => c.op === "insert" && c.table === "audit_events",
    )?.values as Record<string, unknown>;
    expect(audit.action).toBe("registration.placement_assign");
    expect(audit.subject).toBe(GROUP_ID);
    expect(audit.actorId).toBe("user-1");
  });

  it("names the camp already holding a code rather than leaking a constraint error", async () => {
    db.seed("registrations", [
      [{ id: REG_ID, editionId: EDITION_ID, groupId: GROUP_ID, campSlug: "x" }],
      [{ campName: "Dusty Prototype" }], // the clash
    ]);
    db.seed("groups", [{ name: "Mad Hatters" }]);

    const result = await assignPlacement({
      registrationId: REG_ID,
      campCode: "MAH",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Dusty Prototype");
      expect(result.error).toContain("MAH");
    }
  });

  it("refuses a camp code that cannot be stored", async () => {
    seedRegistration();
    const result = await assignPlacement({
      registrationId: REG_ID,
      campCode: "-m-",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/letters or digits/);
  });

  it("refuses a registration that no longer exists", async () => {
    db.seed("registrations", [[]]);
    const result = await assignPlacement({ registrationId: REG_ID });
    expect(result).toEqual({
      ok: false,
      error: "That registration no longer exists.",
    });
  });

  it("refuses a caller without the capability, before any query", async () => {
    requireOrgSession.mockRejectedValue(new Error("Not yours to change."));
    const result = await assignPlacement({ registrationId: REG_ID, campCode: "MAH" });
    expect(result).toEqual({ ok: false, error: "Not yours to change." });
    expect(db.calls).toHaveLength(0);
  });
});

describe("recordRegistrationPayment", () => {
  function seedForNewPayment(
    registration: Record<string, unknown> = {},
    siblings: Record<string, unknown>[] = [],
  ) {
    db.seed("registrations", [
      [
        {
          id: REG_ID,
          groupId: GROUP_ID,
          campCode: null,
          campName: "Mad Hatters",
          editionYear: 2027,
          ...registration,
        },
      ],
    ]);
    db.seed("groups", [{ name: "Mad Hatters" }]);
    db.seed("editions", [{ year: 2027 }]);
    // First read: the existing payment (none). Second: the reference siblings.
    db.seed("payments", [[], siblings]);
  }

  it("mints a reference on first use, from the assigned camp code", async () => {
    seedForNewPayment({ campCode: "MAH" });
    const result = await recordRegistrationPayment({
      registrationId: REG_ID,
      status: "reconciled",
    });

    expect(result.ok).toBe(true);
    const written = db.inserted("payments") as Record<string, unknown>;
    expect(written.reference).toBe("QP-2027-MAH-001");
    expect(written.status).toBe("reconciled");
    expect(written.subjectType).toBe("registration");
  });

  it("derives a code from the name when placement has not assigned one", async () => {
    seedForNewPayment({ campCode: null });
    await recordRegistrationPayment({
      registrationId: REG_ID,
      status: "pending",
    });
    const written = db.inserted("payments") as Record<string, unknown>;
    expect(written.reference).toBe("QP-2027-MAD-001");
  });

  it("does not collide when two camps derive the same subject code", async () => {
    // "Mad Hatters" and "Madness" both derive MAD. `payments.reference` is
    // unique, so a hardcoded sequence of 1 would fail the second staff member's
    // click with a raw constraint error.
    seedForNewPayment({ campCode: null }, [{ reference: "QP-2027-MAD-001" }]);
    await recordRegistrationPayment({
      registrationId: REG_ID,
      status: "pending",
    });
    const written = db.inserted("payments") as Record<string, unknown>;
    expect(written.reference).toBe("QP-2027-MAD-002");
  });

  it("never regenerates the reference once it exists", async () => {
    db.seed("registrations", [
      [
        {
          id: REG_ID,
          groupId: GROUP_ID,
          campCode: "MAH",
          campName: "Mad Hatters",
          editionYear: 2027,
        },
      ],
    ]);
    db.seed("groups", [{ name: "Mad Hatters" }]);
    db.seed("editions", [{ year: 2027 }]);
    db.seed("payments", [
      [{ id: "pay-1", status: "pending", reference: "QP-2027-OLD-001" }],
    ]);

    await recordRegistrationPayment({
      registrationId: REG_ID,
      status: "reconciled",
    });

    // An update, not an insert — the camp already put that string on an EFT.
    expect(db.calls.some((c) => c.op === "insert" && c.table === "payments")).toBe(
      false,
    );
    const updated = db.calls.find(
      (c) => c.op === "update" && c.table === "payments",
    )?.values as Record<string, unknown>;
    expect(updated.status).toBe("reconciled");
    expect(updated).not.toHaveProperty("reference");
  });

  it("refuses an illegal transition rather than writing a duplicate audit row", async () => {
    db.seed("registrations", [
      [
        {
          id: REG_ID,
          groupId: GROUP_ID,
          campCode: "MAH",
          campName: "Mad Hatters",
          editionYear: 2027,
        },
      ],
    ]);
    db.seed("groups", [{ name: "Mad Hatters" }]);
    db.seed("editions", [{ year: 2027 }]);
    db.seed("payments", [
      [{ id: "pay-1", status: "reconciled", reference: "QP-2027-MAH-001" }],
    ]);

    const result = await recordRegistrationPayment({
      registrationId: REG_ID,
      status: "reconciled",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Illegal payment transition/);
  });

  it("audits the status change with what it moved from", async () => {
    seedForNewPayment({ campCode: "MAH" });
    await recordRegistrationPayment({
      registrationId: REG_ID,
      status: "waived",
    });

    const audit = db.calls.find(
      (c) => c.op === "insert" && c.table === "audit_events",
    )?.values as Record<string, unknown>;
    expect(audit.action).toBe("registration.payment_record");
    expect((audit.meta as Record<string, unknown>).status).toBe("waived");
    expect((audit.meta as Record<string, unknown>).previousStatus).toBeNull();
  });

  it("refuses a negative amount — a platform that never took money cannot refund", async () => {
    seedForNewPayment({ campCode: "MAH" });
    const result = await recordRegistrationPayment({
      registrationId: REG_ID,
      status: "reconciled",
      amountCents: -500,
    });
    expect(result.ok).toBe(false);
  });

  it("asks for `update` on registrations", async () => {
    seedForNewPayment({ campCode: "MAH" });
    await recordRegistrationPayment({
      registrationId: REG_ID,
      status: "pending",
    });
    expect(requireOrgSession).toHaveBeenCalledWith({
      capability: "update",
      domain: "registrations",
    });
  });
});
