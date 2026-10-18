import { describe, it, expect, beforeEach, vi } from "vitest";

import { fakeDb, whereParams, type FakeDb } from "./support/fake-db";

/**
 * A wrangler is AfrikaBurn's "dusty guardian angel" for one approved theme camp,
 * and assigning one hands an org account an org-side view of that camp.
 *
 * THE GUARD THIS FILE EXISTS FOR is the org-member check on the ASSIGNEE. The
 * file's own comment calls it out: the picker is a client control and this
 * action is a public endpoint, so a hand-made request could otherwise hand a
 * camp to any account in the database — including one of that camp's own
 * members. Nothing executed that branch before this.
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

import { assignWrangler, unassignWrangler } from "@/lib/actions/wranglers";

const REG_ID = "11111111-1111-4111-8111-111111111111";
const WRANGLER_ID = "33333333-3333-4333-8333-333333333333";

const APPROVED_CAMP = {
  id: REG_ID,
  status: "approved",
  groupId: "group-1",
  editionId: "ed-2027",
  campName: "Mad Hatters",
  campSlug: "mad-hatters",
  campKind: "theme_camp",
};

beforeEach(() => {
  db = fakeDb();
  requireOrgSession.mockReset();
  requireOrgSession.mockResolvedValue({
    dbUserId: "user-1",
    orgGroupId: "org-1",
  });
  db.seed("registrations", [APPROVED_CAMP]);
  // The registration read, then the org-member check, then (in the hook) the
  // camp's leads.
  db.seed("memberships", [
    [{ userId: WRANGLER_ID, username: "alice", sanitizedAt: null }],
    [{ userId: "lead-1" }],
  ]);
  db.seed("users", []);
});

describe("assignWrangler", () => {
  it("refuses a caller without `update` on registrations", async () => {
    requireOrgSession.mockRejectedValue(new Error("Not authorised."));
    await expect(
      assignWrangler({ registrationId: REG_ID, wranglerUserId: WRANGLER_ID }),
    ).resolves.toEqual({ ok: false, error: "Not authorised." });
    expect(requireOrgSession).toHaveBeenCalledWith({
      capability: "update",
      domain: "registrations",
    });
  });

  it("refuses a registration that no longer exists", async () => {
    db.seed("registrations", []);
    await expect(
      assignWrangler({ registrationId: REG_ID, wranglerUserId: WRANGLER_ID }),
    ).resolves.toEqual({
      ok: false,
      error: "That registration no longer exists.",
    });
  });

  it("refuses anything that is not a theme camp, and says who does shepherd it", async () => {
    db.seed("registrations", [{ ...APPROVED_CAMP, campKind: "artwork" }]);
    const result = await assignWrangler({
      registrationId: REG_ID,
      wranglerUserId: WRANGLER_ID,
    });
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/DMV and the Art crew/);
  });

  it("refuses a camp whose registration is not approved", async () => {
    // Approval IS the gate, and it is a server rule rather than a UI one — the
    // review screen has promised "unlocks after approval" since it was a stub.
    db.seed("registrations", [{ ...APPROVED_CAMP, status: "under_review" }]);
    const result = await assignWrangler({
      registrationId: REG_ID,
      wranglerUserId: WRANGLER_ID,
    });
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/Approve it first/);
    expect(db.recorded("insert", "wrangler_assignments")).toHaveLength(0);
  });

  it("REFUSES AN ASSIGNEE WHO IS NOT AN ORG MEMBER", async () => {
    // The one that matters. Without it, a forged request hands the camp to one
    // of its own members, who then holds an org-side view of it.
    db.seed("memberships", [[], [{ userId: "lead-1" }]]);

    const result = await assignWrangler({
      registrationId: REG_ID,
      wranglerUserId: WRANGLER_ID,
    });

    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(
      /isn't an AfrikaBurn org member/,
    );
    expect(db.recorded("insert", "wrangler_assignments")).toHaveLength(0);
    expect(db.recorded("insert", "audit_events")).toHaveLength(0);
  });

  it("writes the assignment and its audit row together", async () => {
    const result = await assignWrangler({
      registrationId: REG_ID,
      wranglerUserId: WRANGLER_ID,
    });

    expect(result).toEqual({ ok: true });
    expect(db.inserted("wrangler_assignments")).toEqual({
      groupId: "group-1",
      editionId: "ed-2027",
      wranglerUserId: WRANGLER_ID,
      assignedByUserId: "user-1",
    });
    expect(db.inserted("audit_events")).toMatchObject({
      actorId: "user-1",
      action: "wrangler.assign",
      subject: "group-1",
      meta: {
        registrationId: REG_ID,
        editionId: "ed-2027",
        wranglerUserId: WRANGLER_ID,
      },
    });
  });

  it("tells the camp and the wrangler, and nobody else", async () => {
    // Two audiences, two payloads. Both recipient lists are derived from ids
    // this function was handed, never from a role or a broadcast audience —
    // which is the structural reason it cannot over-send.
    await assignWrangler({
      registrationId: REG_ID,
      wranglerUserId: WRANGLER_ID,
    });

    const writes = db.recorded("insert", "notifications");
    const recipients = writes.flatMap((w) =>
      (w.values as { userId: string; linkApp: string }[]).map((r) => r),
    );
    expect(recipients.map((r) => r.userId).sort()).toEqual(
      ["lead-1", WRANGLER_ID].sort(),
    );
    // The camp reads its copy in the participant app; the wrangler reads theirs
    // in the console, because that is where the work is.
    expect(recipients.find((r) => r.userId === "lead-1")?.linkApp).toBe("web");
    expect(recipients.find((r) => r.userId === WRANGLER_ID)?.linkApp).toBe(
      "org",
    );
  });

  it("does not send a wrangler who also leads the camp both halves of the news", async () => {
    db.seed("memberships", [
      [{ userId: WRANGLER_ID, username: "alice", sanitizedAt: null }],
      [{ userId: WRANGLER_ID }],
    ]);

    await assignWrangler({
      registrationId: REG_ID,
      wranglerUserId: WRANGLER_ID,
    });

    const writes = db.recorded("insert", "notifications");
    // Only the org-side copy — the one that tells them to act.
    expect(writes).toHaveLength(1);
    expect((writes[0]?.values as { link: string }[])[0]?.link).toBe(
      "/wranglers",
    );
  });

  it("commits the assignment even when the notification hook fails", async () => {
    db.seed("memberships", [
      [{ userId: WRANGLER_ID, username: "alice", sanitizedAt: null }],
    ]);
    db.fail("notifications");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      assignWrangler({ registrationId: REG_ID, wranglerUserId: WRANGLER_ID }),
    ).resolves.toEqual({ ok: true });
    expect(db.recorded("insert", "wrangler_assignments")).toHaveLength(1);
    error.mockRestore();
  });
});

describe("assignWrangler — the deferred fuel depot copy (registration-safety-spec)", () => {
  const OVER = {
    lpg: [{ sizeKg: 48, count: 2 }],
    jerryCans20l: 2,
    barrels200l: 1,
    fuelTrailers: 0,
    note: "",
  };
  const WITHIN = { ...OVER, lpg: [{ sizeKg: 9, count: 2 }], barrels200l: 0 };

  type Row = { userId: string; link: string; linkApp: string; title: string };
  const depotCopies = () =>
    db
      .recorded("insert", "notifications")
      .flatMap((w) => w.values as Row[])
      .filter((r) => r.link === `/registrations/${REG_ID}`);

  it("tells the new wrangler when the camp's saved record is over the limit", async () => {
    db.seed("camp_gas_fuel_records", [
      [{ record: OVER, isDraft: false, wranglerNotifiedAt: null }],
      [{ id: "rec-1" }],
    ]);
    await assignWrangler({ registrationId: REG_ID, wranglerUserId: WRANGLER_ID });
    const copies = depotCopies();
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({
      userId: WRANGLER_ID,
      linkApp: "org",
      title:
        "Mad Hatters is over the fuel depot limit — talk to them about how the fuel depot works",
    });
    // Claimed exactly once, with a conditional update.
    const claims = db
      .recorded("update", "camp_gas_fuel_records")
      .filter((c) => (c.values as { wranglerNotifiedAt: unknown }).wranglerNotifiedAt instanceof Date);
    expect(claims).toHaveLength(1);
  });

  it("a reassignment resets the column so the new wrangler is told too", async () => {
    db.seed("wrangler_assignments", [{ userId: "someone-else" }]);
    db.seed("camp_gas_fuel_records", [
      [{ record: OVER, isDraft: false, wranglerNotifiedAt: new Date() }],
      [{ id: "rec-1" }],
    ]);
    await assignWrangler({ registrationId: REG_ID, wranglerUserId: WRANGLER_ID });
    const resets = db
      .recorded("update", "camp_gas_fuel_records")
      .filter((c) => (c.values as { wranglerNotifiedAt: unknown }).wranglerNotifiedAt === null);
    expect(resets).toHaveLength(1);
    expect(depotCopies()).toHaveLength(1);
  });

  it("re-assigning the same wrangler who was already told sends nothing", async () => {
    db.seed("wrangler_assignments", [{ userId: WRANGLER_ID }]);
    db.seed("camp_gas_fuel_records", [
      [{ record: OVER, isDraft: false, wranglerNotifiedAt: new Date() }],
    ]);
    await assignWrangler({ registrationId: REG_ID, wranglerUserId: WRANGLER_ID });
    expect(depotCopies()).toHaveLength(0);
  });

  it("never for a draft, a record within the limits, or no record", async () => {
    for (const rows of [
      [[{ record: OVER, isDraft: true, wranglerNotifiedAt: null }]],
      [[{ record: WITHIN, isDraft: false, wranglerNotifiedAt: null }]],
      [[]],
    ]) {
      db = fakeDb();
      db.seed("registrations", [APPROVED_CAMP]);
      db.seed("memberships", [
        [{ userId: WRANGLER_ID, username: "alice", sanitizedAt: null }],
        [{ userId: "lead-1" }],
      ]);
      db.seed("camp_gas_fuel_records", rows);
      await assignWrangler({ registrationId: REG_ID, wranglerUserId: WRANGLER_ID });
      expect(depotCopies()).toHaveLength(0);
    }
  });

  it("locks the registration row before writing, as a gas & fuel save does", async () => {
    // Without the lock a save and an assignment interleave and the wrangler
    // is never told: the save sees no wrangler, the assignment commits, and
    // the deferred check reads the record from before the save.
    await assignWrangler({ registrationId: REG_ID, wranglerUserId: WRANGLER_ID });
    const lockIndex = db.calls.findIndex(
      (c) =>
        c.op === "select" &&
        c.table === "registrations" &&
        c.methods.includes("for"),
    );
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(whereParams(db.calls[lockIndex]!.where)).toEqual([REG_ID]);
    const writeIndex = db.calls.findIndex(
      (c) => c.op === "insert" && c.table === "wrangler_assignments",
    );
    expect(lockIndex).toBeLessThan(writeIndex);
  });

  it("sends nothing when another request claimed the column first", async () => {
    db.seed("camp_gas_fuel_records", [
      [{ record: OVER, isDraft: false, wranglerNotifiedAt: null }],
      /* the conditional update matched no row */ [],
    ]);
    await assignWrangler({ registrationId: REG_ID, wranglerUserId: WRANGLER_ID });
    expect(depotCopies()).toHaveLength(0);
  });
});

describe("unassignWrangler", () => {
  it("refuses a registration that no longer exists", async () => {
    db.seed("registrations", []);
    await expect(unassignWrangler({ registrationId: REG_ID })).resolves.toEqual(
      {
        ok: false,
        error: "That registration no longer exists.",
      },
    );
  });

  it("refuses a camp that has no wrangler to remove", async () => {
    // A DELETE that matched nothing must not leave an audit row claiming
    // somebody was unassigned.
    db.seed("wrangler_assignments", []);

    const result = await unassignWrangler({ registrationId: REG_ID });

    expect(result).toEqual({
      ok: false,
      error: "That camp doesn't have a wrangler to remove.",
    });
    expect(db.recorded("insert", "audit_events")).toHaveLength(0);
  });

  it("removes the assignment and names who was removed in the audit row", async () => {
    db.seed("wrangler_assignments", [{ wranglerUserId: WRANGLER_ID }]);

    const result = await unassignWrangler({ registrationId: REG_ID });

    expect(result).toEqual({ ok: true });
    expect(db.inserted("audit_events")).toMatchObject({
      action: "wrangler.unassign",
      subject: "group-1",
      meta: { wranglerUserId: WRANGLER_ID },
    });
    // Deliberately NOT notified: "you are no longer this camp's wrangler" is a
    // conversation someone should have, and telling the camp their guardian
    // angel has gone without saying who is next is worse than saying nothing.
    expect(db.recorded("insert", "notifications")).toHaveLength(0);
  });
});
