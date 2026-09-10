import { describe, it, expect, beforeEach, vi } from "vitest";

import { fakeDb, type FakeDb } from "./support/fake-db";

/**
 * THE R1 WRITE ON THE REVIEW SCREEN: the staff-assigned placement handles.
 *
 * Guarded by `update` in the `registrations` domain — the same capability as
 * deciding the registration — and it writes an audit row in the same transaction
 * as the change. A placement change with no trail is exactly what the audit log
 * exists to prevent, and the action is worth nothing if a reader can issue it.
 *
 * There is deliberately NO payment test here: registration is free and payment
 * UI appears in no registration context (AGENTS.md §Product laws).
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
