import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  MESSAGE_REPORT_STATUSES,
  MESSAGE_REPORT_VIEW_AUDIT_ACTION,
} from "@quagga/core";
import type * as QuaggaDb from "@quagga/db";

import { fakeDb, type FakeDb } from "./support/fake-db";
import {
  CAMPS_LEAD,
  GOD,
  NO_ROLES,
  PERSONAL_READER,
  READER,
  SUPPLIERS_LEAD,
} from "./support/actors";

// The org safety queue for direct-message reports (epic #69). Two properties
// are pinned here:
//
//   1. WHO — the safety tier only (personal information in `registrations`, the
//      same authority that reads medical notes). Refused BEFORE any query.
//   2. WHAT — copies of reported messages and nothing else. The module never
//      names the live `messages`, `conversations` or
//      `conversation_participants` tables, in its source or in any query it
//      runs, so there is no path from the console to a conversation.

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
}));

const pendingAfter: (() => Promise<void>)[] = [];
vi.mock("next/server", () => ({
  after: (fn: () => Promise<void>) => {
    pendingAfter.push(fn);
  },
}));

const { listMessageReports, getMessageReport } = await import(
  "../message-reports"
);

const [OPEN] = MESSAGE_REPORT_STATUSES;
const NOW = new Date("2027-04-28T08:00:00Z");
const REPORT = "rrrrrrrr-0000-4000-8000-000000000001";
const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const REN = "aaaaaaaa-0000-4000-8000-000000000002";
const STAFF = "ssssssss-0000-4000-8000-000000000001";
const FORBIDDEN_TABLES = [
  "messages",
  "conversations",
  "conversation_participants",
];

function seedReport(): void {
  db.seed("message_reports", [
    {
      id: REPORT,
      status: OPEN,
      createdAt: new Date("2027-04-27T08:00:00Z"),
      expiresAt: new Date("2027-10-24T08:00:00Z"),
      resolvedAt: null,
      reason: "kept messaging after I said stop",
      reporterId: ALICE,
      reportedUserId: REN,
    },
  ]);
  db.seed("message_report_items", [
    {
      id: "item-1",
      reportId: REPORT,
      senderId: REN,
      kind: "text",
      body: "the reported words",
      sentAt: new Date("2027-04-27T07:59:00Z"),
      n: 1,
    },
  ]);
  db.seed("users", [
    { id: ALICE, username: "alice_hatter", sanitizedAt: null },
    { id: REN, username: "ren_notfound", sanitizedAt: null },
  ]);
}

beforeEach(() => {
  db = fakeDb();
  pendingAfter.length = 0;
});

describe("who may review message reports", () => {
  for (const [name, actor] of [
    ["an org-wide reader without personal information", READER],
    ["a Suppliers lead (personal information in another domain)", SUPPLIERS_LEAD],
    ["an account with no roles", NO_ROLES],
  ] as const) {
    it(`refuses ${name} before any query`, async () => {
      seedReport();
      expect(await listMessageReports(actor, OPEN, NOW)).toBeNull();
      expect(await getMessageReport(actor, STAFF, REPORT, NOW)).toBeNull();
      expect(db.calls).toHaveLength(0);
      expect(pendingAfter).toHaveLength(0);
    });
  }

  it("admits the safety tier: org-wide personal information, a camps lead, and the System manager", async () => {
    for (const actor of [PERSONAL_READER, CAMPS_LEAD, GOD]) {
      db = fakeDb();
      seedReport();
      const list = await listMessageReports(actor, OPEN, NOW);
      expect(list).toHaveLength(1);
    }
  });
});

describe("what the queue shows", () => {
  it("lists who reported whom with a count — no message body or reason is selected", async () => {
    seedReport();
    const list = await listMessageReports(PERSONAL_READER, OPEN, NOW);
    expect(list).toEqual([
      expect.objectContaining({
        id: REPORT,
        reporterName: "alice_hatter",
        reportedName: "ren_notfound",
        messageCount: 1,
      }),
    ]);
    for (const call of db.recorded("select")) {
      expect(call.columns ?? []).not.toContain("body");
      expect(call.columns ?? []).not.toContain("reason");
    }
  });

  it("shows a report's copied messages and audits the read", async () => {
    seedReport();
    const detail = await getMessageReport(PERSONAL_READER, STAFF, REPORT, NOW);
    expect(detail?.items).toEqual([
      expect.objectContaining({
        body: "the reported words",
        senderName: "ren_notfound",
        fromReportedUser: true,
      }),
    ]);
    expect(detail?.reason).toBe("kept messaging after I said stop");

    expect(pendingAfter).toHaveLength(1);
    await pendingAfter[0]!();
    expect(db.inserted("audit_events")).toMatchObject({
      actorId: STAFF,
      action: MESSAGE_REPORT_VIEW_AUDIT_ACTION,
      subject: REPORT,
    });
  });

  it("never queries a live conversation table", async () => {
    seedReport();
    await listMessageReports(GOD, OPEN, NOW);
    await getMessageReport(GOD, STAFF, REPORT, NOW);
    for (const call of db.calls) {
      expect(FORBIDDEN_TABLES).not.toContain(call.table);
    }
  });

  it("names no live conversation table anywhere in its source", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../message-reports.ts", import.meta.url)),
      "utf8",
    ).replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/schema\.messages\b/);
    expect(source).not.toMatch(/schema\.conversations\b/);
    expect(source).not.toMatch(/schema\.conversationParticipants\b/);
  });

  it("answers not-found for an unknown report without auditing", async () => {
    expect(await getMessageReport(GOD, STAFF, REPORT, NOW)).toBeNull();
    expect(pendingAfter).toHaveLength(0);
  });
});
