import { describe, it, expect, beforeEach, vi } from "vitest";
import { MESSAGE_REPORT_RESOLVE_AUDIT_ACTION } from "@quagga/core";
import type * as QuaggaDb from "@quagga/db";

import { fakeDb, whereMentions, type FakeDb } from "./support/fake-db";
import { CAMPS_LEAD, PERSONAL_READER } from "./support/actors";

// Resolving a direct-message report (epic #69): the safety tier's reading
// authority (personal information in registrations, asked of the guard) PLUS
// `update` there. Reading alone may not resolve.

// Two handles on purpose: `db` is the HTTP driver (`getDb()`), which has no
// transactions; `txDb` is the pooled driver `withTransaction` opens. Keeping
// them apart is what lets a test say WHICH handle a write went through.
let db: FakeDb;
let txDb: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
  createPooledDb: () => ({ db: txDb, pool: { end: async () => {} } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const requireOrgSession = vi.fn();
vi.mock("@/lib/session", () => ({
  requireOrgSession: (options?: unknown) => requireOrgSession(options),
}));

const { resolveMessageReportAction } =
  await import("@/lib/actions/message-reports");

const REPORT = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  db = fakeDb();
  txDb = fakeDb();
  requireOrgSession.mockReset();
});

describe("resolveMessageReportAction", () => {
  it("asks the guard for personal information in registrations, and stops on its refusal", async () => {
    requireOrgSession.mockRejectedValue(new Error("Not authorised."));
    await expect(
      resolveMessageReportAction({ reportId: REPORT }),
    ).resolves.toEqual({
      ok: false,
      error: "Not authorised.",
    });
    expect(requireOrgSession).toHaveBeenCalledWith({
      capability: "personal_information",
      domain: "registrations",
    });
    expect(db.recorded("update")).toHaveLength(0);
    expect(txDb.recorded("update")).toHaveLength(0);
  });

  it("refuses a reader of personal information who lacks update", async () => {
    requireOrgSession.mockResolvedValue({
      dbUserId: "u1",
      actor: PERSONAL_READER,
    });
    const result = await resolveMessageReportAction({ reportId: REPORT });
    expect(result.ok).toBe(false);
    expect(db.recorded("update")).toHaveLength(0);
    expect(txDb.recorded("update")).toHaveLength(0);
  });

  // Regression: the status update and the audit row ran on the HTTP driver as
  // two separate statements, so a failed audit insert left a resolved report
  // with no record of who resolved it. Both now go through ONE transaction.
  it("resolves an open report and audits it, both writes on the transaction handle", async () => {
    requireOrgSession.mockResolvedValue({ dbUserId: "u1", actor: CAMPS_LEAD });
    txDb.seed("message_reports", [{ id: REPORT }]);
    await expect(
      resolveMessageReportAction({ reportId: REPORT }),
    ).resolves.toEqual({
      ok: true,
    });
    expect(txDb.recorded("update", "message_reports")[0]!.values).toMatchObject(
      {
        status: "resolved",
        resolvedBy: "u1",
      },
    );
    expect(txDb.inserted("audit_events")).toMatchObject({
      action: MESSAGE_REPORT_RESOLVE_AUDIT_ACTION,
      subject: REPORT,
    });
    // Nothing went through the transaction-less HTTP driver.
    expect(db.calls).toHaveLength(0);
  });

  it("keeps the open-status compare-and-set", async () => {
    requireOrgSession.mockResolvedValue({ dbUserId: "u1", actor: CAMPS_LEAD });
    txDb.seed("message_reports", [{ id: REPORT }]);
    await resolveMessageReportAction({ reportId: REPORT });
    const where = txDb.recorded("update", "message_reports")[0]!.where;
    expect(whereMentions(where, "open")).toBe(true);
    expect(whereMentions(where, REPORT)).toBe(true);
  });

  it("reports an already-resolved report honestly", async () => {
    requireOrgSession.mockResolvedValue({ dbUserId: "u1", actor: CAMPS_LEAD });
    const result = await resolveMessageReportAction({ reportId: REPORT });
    expect(result).toEqual({
      ok: false,
      error: "That report is already resolved or no longer exists.",
    });
    // The lost compare-and-set writes no audit row.
    expect(txDb.recorded("insert", "audit_events")).toHaveLength(0);
  });

  it("rejects a malformed id before the guard", async () => {
    const result = await resolveMessageReportAction({ reportId: "nope" });
    expect(result.ok).toBe(false);
    expect(requireOrgSession).not.toHaveBeenCalled();
  });
});
