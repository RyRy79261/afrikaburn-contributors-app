import { describe, it, expect, beforeEach, vi } from "vitest";
import { MESSAGE_REPORT_RESOLVE_AUDIT_ACTION } from "@quagga/core";
import type * as QuaggaDb from "@quagga/db";

import { fakeDb, type FakeDb } from "./support/fake-db";
import { CAMPS_LEAD, PERSONAL_READER } from "./support/actors";

// Resolving a direct-message report (epic #69): the safety tier's reading
// authority (personal information in registrations, asked of the guard) PLUS
// `update` there. Reading alone may not resolve.

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
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
  });

  it("refuses a reader of personal information who lacks update", async () => {
    requireOrgSession.mockResolvedValue({
      dbUserId: "u1",
      actor: PERSONAL_READER,
    });
    const result = await resolveMessageReportAction({ reportId: REPORT });
    expect(result.ok).toBe(false);
    expect(db.recorded("update")).toHaveLength(0);
  });

  it("resolves an open report and audits it", async () => {
    requireOrgSession.mockResolvedValue({ dbUserId: "u1", actor: CAMPS_LEAD });
    db.seed("message_reports", [{ id: REPORT }]);
    await expect(
      resolveMessageReportAction({ reportId: REPORT }),
    ).resolves.toEqual({
      ok: true,
    });
    expect(db.recorded("update", "message_reports")[0]!.values).toMatchObject({
      status: "resolved",
      resolvedBy: "u1",
    });
    expect(db.inserted("audit_events")).toMatchObject({
      action: MESSAGE_REPORT_RESOLVE_AUDIT_ACTION,
      subject: REPORT,
    });
  });

  it("reports an already-resolved report honestly", async () => {
    requireOrgSession.mockResolvedValue({ dbUserId: "u1", actor: CAMPS_LEAD });
    const result = await resolveMessageReportAction({ reportId: REPORT });
    expect(result).toEqual({
      ok: false,
      error: "That report is already resolved or no longer exists.",
    });
  });

  it("rejects a malformed id before the guard", async () => {
    const result = await resolveMessageReportAction({ reportId: "nope" });
    expect(result.ok).toBe(false);
    expect(requireOrgSession).not.toHaveBeenCalled();
  });
});
