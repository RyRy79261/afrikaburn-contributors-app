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
  /**
   * The registration read, then the clash read (empty = code is free) — which
   * only runs when a code is being set — then the before-values read under the
   * row lock inside the transaction, then (in the hook) the camp's leads.
   */
  function seedRegistration(
    options: {
      before?: { campCode: string | null; erf: string | null };
      settingCode?: boolean;
    } = {},
  ) {
    const { before = { campCode: null, erf: null }, settingCode = true } =
      options;
    db.seed("registrations", [
      [
        {
          id: REG_ID,
          editionId: EDITION_ID,
          groupId: GROUP_ID,
          campName: "Mad Hatters",
          campSlug: "mad-hatters",
        },
      ],
      ...(settingCode ? [[]] : []), // no camp already holding the code
      [before],
    ]);
    db.seed("memberships", [{ userId: "lead-1" }, { userId: "admin-1" }]);
  }

  /** Every notification row written, across every insert. */
  function notificationRows() {
    return db.recorded("insert", "notifications").flatMap(
      (c) =>
        c.values as {
          userId: string;
          kind: string;
          title: string;
          body: string | null;
          link: string | null;
          origin: string | null;
          linkApp: string | null;
        }[],
    );
  }

  it("asks for `update` on registrations — the decision capability", async () => {
    seedRegistration();
    await assignPlacement({
      registrationId: REG_ID,
      campCode: "MAH",
      erf: "K12",
    });
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
    seedRegistration({
      before: { campCode: "MAH", erf: "K12" },
      settingCode: false,
    });
    await assignPlacement({ registrationId: REG_ID, campCode: "", erf: "" });

    const written = db.calls.find(
      (c) => c.op === "update" && c.table === "registrations",
    )?.values as Record<string, unknown>;
    expect(written.campCode).toBeNull();
    expect(written.erf).toBeNull();
  });

  it("audits the assignment in the same transaction", async () => {
    seedRegistration();
    await assignPlacement({
      registrationId: REG_ID,
      campCode: "MAH",
      erf: "K12",
    });

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
    db.seed("memberships", [{ userId: "lead-1" }]);

    const result = await assignPlacement({
      registrationId: REG_ID,
      campCode: "MAH",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Dusty Prototype");
      expect(result.error).toContain("MAH");
    }
    // A refused write tells nobody anything.
    expect(db.recorded("update", "registrations")).toHaveLength(0);
    expect(db.recorded("insert", "notifications")).toHaveLength(0);
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
    const result = await assignPlacement({
      registrationId: REG_ID,
      campCode: "MAH",
    });
    expect(result).toEqual({ ok: false, error: "Not yours to change." });
    expect(db.calls).toHaveLength(0);
  });

  // --- Notifying the camp (epic #48; Ryan, 27 Sep 2026: first assignment AND
  // every change). The change rules themselves are pinned in @quagga/core's
  // placement-codes test; these prove the action feeds them the real before-
  // and after-values and writes what they say, to the right people.

  describe("notifying the camp's leads", () => {
    it("a first assignment notifies every lead and admin, once, linking to the camp page", async () => {
      seedRegistration();
      const result = await assignPlacement({
        registrationId: REG_ID,
        campCode: "mah",
        erf: "c-14",
      });

      expect(result.ok).toBe(true);
      const rows = notificationRows();
      expect(rows.map((r) => r.userId).sort()).toEqual(["admin-1", "lead-1"]);
      expect(rows[0]).toEqual({
        userId: rows[0]!.userId,
        kind: "registration",
        title: "Your camp's placement is set: MAH · C-14",
        body: "Mad Hatters",
        link: "/camps/mad-hatters",
        origin: "org",
        // Written by the console, read in the participant app.
        linkApp: "web",
        bulletinId: null,
      });
      // The leads read comes from the camp's own structural roles.
      const leadsRead = db.recorded("select", "memberships")[0];
      expect(leadsRead?.where).toBeDefined();
    });

    it("a change notifies, and says it changed", async () => {
      seedRegistration({ before: { campCode: "MAH", erf: "C-14" } });
      await assignPlacement({
        registrationId: REG_ID,
        campCode: "MAH",
        erf: "C-15",
      });

      const titles = [...new Set(notificationRows().map((r) => r.title))];
      expect(titles).toEqual(["Your camp's placement changed: MAH · C-15"]);
    });

    it("re-saving the same values notifies nobody", async () => {
      seedRegistration({ before: { campCode: "MAH", erf: "C-14" } });
      const result = await assignPlacement({
        registrationId: REG_ID,
        // Different case and spacing, same stored form.
        campCode: "mah",
        erf: " c-14 ",
      });

      expect(result.ok).toBe(true);
      // The save still happened and is still audited — only the inbox is quiet.
      expect(db.recorded("update", "registrations")).toHaveLength(1);
      expect(db.recorded("insert", "audit_events")).toHaveLength(1);
      expect(db.recorded("insert", "notifications")).toHaveLength(0);
    });

    it("both fields moving in one save is ONE notification per lead", async () => {
      seedRegistration({ before: { campCode: "MAH", erf: "C-14" } });
      await assignPlacement({
        registrationId: REG_ID,
        campCode: "HAT",
        erf: "D-2",
      });

      const rows = notificationRows();
      expect(rows).toHaveLength(2); // lead-1 and admin-1, one each
      expect(new Set(rows.map((r) => r.userId)).size).toBe(2);
      expect(rows.every((r) => r.title.endsWith("HAT · D-2"))).toBe(true);
    });

    it("clearing the placement notifies nobody (the wrangler-unassign precedent)", async () => {
      seedRegistration({
        before: { campCode: "MAH", erf: "C-14" },
        settingCode: false,
      });
      await assignPlacement({ registrationId: REG_ID, campCode: "", erf: "" });

      expect(db.recorded("update", "registrations")).toHaveLength(1);
      expect(db.recorded("insert", "notifications")).toHaveLength(0);
    });

    it("a write that fails inside the transaction notifies nobody", async () => {
      seedRegistration();
      db.fail("audit_events", "audit insert failed");

      const result = await assignPlacement({
        registrationId: REG_ID,
        campCode: "MAH",
        erf: "C-14",
      });

      expect(result.ok).toBe(false);
      expect(db.recorded("insert", "notifications")).toHaveLength(0);
      expect(db.recorded("select", "memberships")).toHaveLength(0);
    });

    it("a registration that vanished before the lock is refused and notifies nobody", async () => {
      db.seed("registrations", [
        [
          {
            id: REG_ID,
            editionId: EDITION_ID,
            groupId: GROUP_ID,
            campName: "Mad Hatters",
            campSlug: "mad-hatters",
          },
        ],
        [],
        [], // the locked read found nothing
      ]);
      db.seed("memberships", [{ userId: "lead-1" }]);

      const result = await assignPlacement({
        registrationId: REG_ID,
        campCode: "MAH",
        erf: "C-14",
      });

      expect(result).toEqual({
        ok: false,
        error: "That registration no longer exists.",
      });
      expect(db.recorded("update", "registrations")).toHaveLength(0);
      expect(db.recorded("insert", "notifications")).toHaveLength(0);
    });

    it("reads the before-values under a row lock inside the transaction", async () => {
      seedRegistration();
      await assignPlacement({
        registrationId: REG_ID,
        campCode: "MAH",
        erf: "C-14",
      });

      const locked = db
        .recorded("select", "registrations")
        .find((c) => c.methods.includes("for"));
      expect(locked?.columns).toEqual(["campCode", "erf"]);
    });

    it("commits the placement even when the notification hook fails", async () => {
      seedRegistration();
      db.fail("notifications");
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await assignPlacement({
        registrationId: REG_ID,
        campCode: "MAH",
        erf: "C-14",
      });

      expect(result).toEqual({ ok: true, campCode: "MAH", erf: "C-14" });
      expect(db.recorded("update", "registrations")).toHaveLength(1);
      error.mockRestore();
    });
  });
});
