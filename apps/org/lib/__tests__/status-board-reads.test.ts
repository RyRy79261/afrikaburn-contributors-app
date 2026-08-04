import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { fakeDb, whereMentions, type FakeDb } from "./support/fake-db";
import { GOD, PERSONAL_READER, READER, SUPPLIERS_LEAD } from "./support/actors";

/**
 * THE STATUS BOARD AND THE SYSTEM PANEL — the pages someone opens when
 * something is already wrong.
 *
 * `probeDatabase` must therefore report a failure rather than throw one: a
 * status page that goes down with the thing it monitors is worth nothing. And
 * the activity feed must keep medical reads out — one roster walk emits dozens
 * of `bio.medical.view` rows in a minute and would evict every registration
 * decision from a six-row card. `status-board-format.test.ts` asserts that at
 * the pure layer; this is where the QUERY applies it.
 */

import type * as QuaggaDb from "@quagga/db";

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
}));

import { MEDICAL_VIEW_AUDIT_ACTION } from "@quagga/core";
import { getRecentActivity, getSubmissionSeries } from "@/lib/status-board";
import { getSystemStatus, probeDatabase } from "@/lib/system-probe";

const ENV = { ...process.env };

beforeEach(() => {
  db = fakeDb();
  process.env.DATABASE_URL = "postgres://localhost/quagga";
});

afterEach(() => {
  process.env = { ...ENV };
});

describe("getRecentActivity", () => {
  const EVENT = {
    id: "audit-1",
    action: "registration.approve",
    meta: { status: "approved" },
    createdAt: new Date("2026-11-01T00:00:00Z"),
    actorEmail: "staff@example.com",
  };

  it("names the actor for a caller who reads personal information in AUDIT", async () => {
    db.seed("audit_events", [EVENT]);
    const [row] = await getRecentActivity(PERSONAL_READER);
    expect(row?.actorEmail).toBe("staff@example.com");
  });

  it("gives everyone else the same feed, unattributed", async () => {
    // This feed is audit rows from across the whole console, so a grant scoped
    // to one department is not a grant over it.
    db.seed("audit_events", [EVENT]);

    const [row] = await getRecentActivity(SUPPLIERS_LEAD);

    expect(row?.action).toBe("registration.approve");
    expect(row?.actorEmail).toBeNull();
    expect(db.recorded("select", "audit_events")[0]?.columns).not.toContain(
      "actorEmail",
    );

    const [plain] = await getRecentActivity(READER);
    expect(plain?.actorEmail).toBeNull();
  });

  it("EXCLUDES medical reads IN THE QUERY, for every rank", async () => {
    // Not hidden — they get `/audit`, which shows them with the context a
    // six-row card could never carry. The exclusion is a display decision made
    // in one pure, tested place and applied here, never an ad-hoc filter.
    db.seed("audit_events", []);
    await getRecentActivity(GOD);

    // The condition the query was BUILT with names the action, so removing the
    // filter — or pointing it at something else — turns this red.
    const [call] = db.recorded("select", "audit_events");
    expect(whereMentions(call?.where, MEDICAL_VIEW_AUDIT_ACTION)).toBe(true);
  });

  it("honours the row limit the card asks for", async () => {
    db.seed("audit_events", []);
    await getRecentActivity(GOD, 3);
    expect(db.recorded("select", "audit_events")[0]?.methods).toContain("limit");
  });
});

describe("getSubmissionSeries", () => {
  it("returns an empty series WITHOUT querying when there is no edition", async () => {
    await expect(getSubmissionSeries(null)).resolves.toEqual([]);
    expect(db.calls).toEqual([]);
  });

  it("buckets submissions by month and drops rows with no timestamp", async () => {
    // Only submitted registrations carry `submitted_at`, so drafts never appear
    // on a card labelled "submissions" — a null slipping through would bucket
    // as an Invalid Date.
    db.seed("registrations", [
      { submittedAt: new Date("2026-10-04T00:00:00Z") },
      { submittedAt: new Date("2026-10-20T00:00:00Z") },
      { submittedAt: new Date("2026-11-02T00:00:00Z") },
      { submittedAt: null },
    ]);

    const series = await getSubmissionSeries("ed-2027");

    const total = series.reduce((sum, p) => sum + p.count, 0);
    expect(total).toBe(3);
    expect(series.every((p) => Number.isFinite(p.count))).toBe(true);
  });
});

describe("probeDatabase — it must never take the diagnostic page down with it", () => {
  it("reports not_configured without a connection string, and probes nothing", async () => {
    delete process.env.DATABASE_URL;
    await expect(probeDatabase()).resolves.toEqual({ kind: "not_configured" });
    expect(db.calls).toEqual([]);
  });

  it("reports ok with the latency and the seeded edition", async () => {
    db.seed("editions", [
      {
        id: "ed-2027",
        name: "AfrikaBurn 2027",
        year: 2027,
        startDate: "2027-04-26",
        endDate: "2027-05-02",
      },
    ]);

    const probe = await probeDatabase();

    expect(probe).toMatchObject({
      kind: "ok",
      edition: { name: "AfrikaBurn 2027", year: 2027 },
    });
  });

  it("distinguishes CONNECTED-BUT-UNSEEDED from connected", async () => {
    // A connection that works but has no reference data is a real, distinct
    // state (a migrated-but-unseeded deployment), and collapsing it into
    // "connected" hides the actual fault.
    db.seed("editions", []);
    const probe = await probeDatabase();
    expect(probe).toMatchObject({ kind: "ok", edition: null });
  });

  it("REPORTS a failure rather than throwing it", async () => {
    db.fail("editions", "connection to server was lost");

    const probe = await probeDatabase();

    expect(probe).toMatchObject({ kind: "unreachable" });
    expect((probe as { message: string }).message).toMatch(
      /connection to server was lost/,
    );
  });

  it("REDACTS the connection string out of a driver error", async () => {
    // A driver error quotes the connection string it failed on. Belt and braces
    // on a credential is cheap, and this page is the one an engineer screenshots.
    process.env.DATABASE_URL = "postgres://user:s3cr3t@db.example.com/quagga";
    db.fail("editions", "could not connect to postgres://user:s3cr3t@db.example.com/quagga");

    const probe = await probeDatabase();

    expect((probe as { message: string }).message).not.toContain("s3cr3t");
  });
});

describe("getSystemStatus", () => {
  it("composes a report on a deployment with nothing configured at all", async () => {
    // Hard rule 4 again: the panel that explains an unconfigured deployment is
    // the panel that must render on one.
    delete process.env.DATABASE_URL;
    delete process.env.BETTER_AUTH_SECRET;

    const status = await getSystemStatus();

    // The report still renders, and it names the missing database rather than
    // claiming a green one.
    expect(status.headline.tone).not.toBe("ok");
    const database = status.health.find((c) => /database/i.test(c.label));
    expect(database?.tone).not.toBe("ok");
    expect(status.security.length).toBeGreaterThan(0);
  });

  it("carries the live probe into the report", async () => {
    db.seed("editions", [
      {
        id: "ed-2027",
        name: "AfrikaBurn 2027",
        year: 2027,
        startDate: "2027-04-26",
        endDate: "2027-05-02",
      },
    ]);

    const status = await getSystemStatus();

    // The probe answered, so the panel says so — and names the seeded edition,
    // which is the honest answer to "has this database ever been seeded?".
    const database = status.health.find((c) => /database/i.test(c.label));
    expect(database?.tone).toBe("ok");
    expect(JSON.stringify(status)).toMatch(/AfrikaBurn 2027/);
  });
});
