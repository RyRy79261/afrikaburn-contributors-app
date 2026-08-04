import { describe, it, expect, beforeEach, vi } from "vitest";

import { fakeDb, type FakeDb } from "./support/fake-db";

/**
 * THE PANEL THAT HANDS OUT AND TAKES AWAY CONSOLE ACCESS.
 *
 * Two rails stop an afternoon's mistake becoming a permanent lockout of the
 * deployment: you cannot change your own access, and a `god` membership is
 * untouchable from here in EITHER direction, so the last System manager can be
 * neither removed nor demoted by anyone including themselves. Both are one `if`
 * that nothing executed.
 */

import type * as QuaggaDb from "@quagga/db";

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
  createPooledDb: () => ({ db, pool: { end: async () => {} } }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const requireSystemManager = vi.fn();
vi.mock("@/lib/session", () => ({
  requireSystemManager: (what?: string) => requireSystemManager(what),
}));

import { setOrgStaffRole } from "@/lib/actions/accounts";

const TARGET = "44444444-4444-4444-8444-444444444444";
const ACTOR = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  db = fakeDb();
  requireSystemManager.mockReset();
  requireSystemManager.mockResolvedValue({
    dbUserId: ACTOR,
    orgGroupId: "org-1",
  });
  db.seed("users", [{ id: TARGET, email: "alice@example.com" }]);
  db.seed("memberships", []);
  db.seed("org_roles", [{ id: "role-seeded" }]);
});

describe("setOrgStaffRole", () => {
  it("refuses a caller who is not the System manager", async () => {
    requireSystemManager.mockRejectedValue(
      new Error("Only a System manager may manage departments, roles or who holds them."),
    );
    const result = await setOrgStaffRole({ userId: TARGET, action: "elevate" });
    expect(result.ok).toBe(false);
    expect(db.calls).toEqual([]);
  });

  it("refuses a System manager acting on THEMSELVES, before any write", async () => {
    // Not a courtesy: it is what stops the only System manager on a deployment
    // demoting themselves out of the console with nobody able to put them back.
    const result = await setOrgStaffRole({ userId: ACTOR, action: "demote" });

    expect(result).toEqual({
      ok: false,
      error: "You cannot change your own access.",
    });
    expect(db.calls).toEqual([]);
  });

  it("refuses a user id that no longer exists", async () => {
    db.seed("users", []);
    await expect(
      setOrgStaffRole({ userId: TARGET, action: "elevate" }),
    ).resolves.toEqual({ ok: false, error: "That account no longer exists." });
  });

  it("REFUSES A GOD TARGET IN BOTH DIRECTIONS", async () => {
    // The sole-System-manager guard. `god` comes solely from a verified
    // GOD_EMAILS address at sign-in, which is the ceiling that stops the console
    // minting its own highest privilege — and the same rule read backwards is
    // what makes the last System manager unremovable from any screen.
    db.seed("memberships", [{ id: "mem-1", role: "god" }]);

    const demote = await setOrgStaffRole({ userId: TARGET, action: "demote" });
    expect(demote).toMatchObject({ ok: false });
    expect((demote as { error: string }).error).toMatch(/GOD_EMAILS/);

    db.seed("memberships", [{ id: "mem-1", role: "god" }]);
    const elevate = await setOrgStaffRole({ userId: TARGET, action: "elevate" });
    expect(elevate).toMatchObject({ ok: false });

    expect(db.recorded("delete", "memberships")).toHaveLength(0);
    expect(db.recorded("insert", "audit_events")).toHaveLength(0);
  });

  it("elevates at the requested door and seeds the matching starting role", async () => {
    // Granting the door alone is fail-closed but a poor first experience: an
    // elevation also assigns the seeded role matching the door they came in
    // through, which a System manager can change immediately.
    db.seed("memberships", [[], [{ id: "mem-1" }]]);

    const result = await setOrgStaffRole({
      userId: TARGET,
      action: "elevate",
      rank: "engineer",
    });

    expect(result).toEqual({ ok: true });
    expect(db.inserted("memberships")).toEqual({
      userId: TARGET,
      groupId: "org-1",
      role: "engineer",
    });
    expect(db.inserted("org_role_assignments")).toEqual({
      membershipId: "mem-1",
      orgRoleId: "role-seeded",
    });
  });

  it("defaults to org_staff when no door is named", async () => {
    // The behaviour this action had when there was only one door — an older
    // caller keeps working rather than silently granting something else.
    db.seed("memberships", [[], [{ id: "mem-1" }]]);

    await setOrgStaffRole({ userId: TARGET, action: "elevate" });

    expect(db.inserted("memberships")).toMatchObject({ role: "org_staff" });
  });

  it("does NOT re-seed a default role over an existing account's tailored roles", async () => {
    // A System manager may already have tailored them, and re-adding a default
    // over the top would silently undo that.
    db.seed("memberships", [
      [{ id: "mem-1", role: "org_staff" }],
      [{ id: "mem-1" }],
    ]);

    await setOrgStaffRole({ userId: TARGET, action: "elevate" });

    expect(db.recorded("insert", "org_role_assignments")).toHaveLength(0);
  });

  it("revokes by DELETING the membership, so role assignments cascade away", async () => {
    // Nothing must be left to reattach itself if the account is re-granted
    // access later.
    db.seed("memberships", [{ id: "mem-1", role: "engineer" }]);

    const result = await setOrgStaffRole({ userId: TARGET, action: "demote" });

    expect(result).toEqual({ ok: true });
    expect(db.recorded("delete", "memberships")).toHaveLength(1);
    expect(db.recorded("insert", "memberships")).toHaveLength(0);
  });

  it("audits both directions, naming the target and the rank", async () => {
    db.seed("memberships", [[], [{ id: "mem-1" }]]);
    await setOrgStaffRole({ userId: TARGET, action: "elevate" });
    expect(db.inserted("audit_events")).toEqual({
      actorId: ACTOR,
      action: "account.elevate",
      subject: TARGET,
      meta: { email: "alice@example.com", role: "org_staff" },
    });

    db = fakeDb();
    db.seed("users", [{ id: TARGET, email: "alice@example.com" }]);
    db.seed("memberships", [{ id: "mem-1", role: "engineer" }]);
    await setOrgStaffRole({ userId: TARGET, action: "demote" });
    expect(db.inserted("audit_events")).toEqual({
      actorId: ACTOR,
      action: "account.demote",
      subject: TARGET,
      // The rank they HELD, not the one they were moved to — a revoke's audit
      // row has to say what was taken away.
      meta: { email: "alice@example.com", role: "engineer" },
    });
  });

  it("rejects a malformed user id at the zod boundary", async () => {
    const result = await setOrgStaffRole({
      userId: "not-a-uuid",
      action: "elevate",
    });
    expect(result.ok).toBe(false);
    expect(db.calls).toEqual([]);
  });
});
