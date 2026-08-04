import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as DbModule from "@/lib/db";
import { installFakeDb, type FakeDb } from "@/test/fakes/db";

// The edition label on the signed-OUT auth screens (lib/edition.ts).
//
// This runs BEFORE any session exists, and hard engineering rule 4 says all
// three apps must boot env-less to a graceful state. Every failure mode here is
// a silent one: the formatter is explicitly UTC because a timezone-naive parse
// shifts the dates by a day for anyone west of Greenwich, and the whole read is
// wrapped so an unreachable database degrades to the static label rather than
// breaking sign-in itself.

vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof DbModule>("@/lib/db");
  const { fakeDb: current } = await import("@/test/fakes/db");
  return { ...actual, getDb: () => current().handle };
});

const { getEditionLabel, FALLBACK_EDITION_LABEL } = await import("@/lib/edition");

const ACTIVE = {
  name: "AfrikaBurn 2027",
  startDate: "2027-04-26",
  endDate: "2027-05-02",
};

let db: FakeDb;

beforeEach(() => {
  db = installFakeDb();
  vi.stubEnv("DATABASE_URL", "postgres://stub/does-not-connect");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getEditionLabel", () => {
  it("returns the static fallback with no database configured, without querying", async () => {
    vi.stubEnv("DATABASE_URL", "");

    expect(await getEditionLabel()).toBe(FALLBACK_EDITION_LABEL);
    expect(db.queries).toEqual([]);
  });

  it("prefers the active edition", async () => {
    db.rows("editions", [ACTIVE]);

    expect(await getEditionLabel()).toBe("AfrikaBurn 2027 · 26 April – 2 May");
    expect(db.queries[0]!.sql).toContain('"editions"."is_active" = ');
    // Only one read: the fallback query must not run when an active row exists.
    expect(db.queries).toHaveLength(1);
  });

  it("falls back to the most recent edition by year when none is active", async () => {
    db.rows("editions", [], [{ ...ACTIVE, name: "AfrikaBurn 2026" }]);

    expect(await getEditionLabel()).toContain("AfrikaBurn 2026");
    expect(db.queries[1]!.sql).toContain('order by "editions"."year" desc');
  });

  it("returns the static fallback when there are no edition rows at all", async () => {
    // The correct first-boot state on a fresh database — the seed has not run.
    db.rows("editions", [], []);

    expect(await getEditionLabel()).toBe(FALLBACK_EDITION_LABEL);
  });

  it("formats the range in UTC, so a date near midnight does not shift", async () => {
    // `new Date("2027-04-26")` is midnight UTC; rendering it in a local
    // timezone behind UTC prints the 25th. The dates are the event's, not the
    // reader's, so the format pins the zone.
    const original = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      db.rows("editions", [ACTIVE]);
      // 26 April, not 25 — which is what a local-timezone parse prints for a
      // reader behind UTC.
      expect(await getEditionLabel()).toBe("AfrikaBurn 2027 · 26 April – 2 May");
    } finally {
      process.env.TZ = original;
    }
  });

  it("degrades a thrown query to the static fallback rather than propagating", async () => {
    // A crash here takes out the sign-in page — the one screen that has to work
    // when everything else does not.
    db.failEverything = new Error("connection reset by peer");

    expect(await getEditionLabel()).toBe(FALLBACK_EDITION_LABEL);
  });

  it("never throws on a malformed date, and still names the edition", async () => {
    // MEASURED, and worth a maintainer's eye: `formatRange`'s try/catch reads
    // as "a bad date degrades to the bare name", but `toLocaleDateString` on an
    // Invalid Date RETURNS the string "Invalid Date" rather than throwing, so
    // the catch never fires and the label renders "… · Invalid Date – 2 May".
    // Not currently reachable from the database (`start_date` is `date NOT
    // NULL`, so Postgres cannot hand back an unparseable value), which is why
    // this asserts only what holds either way — it must not go red the day the
    // fallback is tightened.
    db.rows("editions", [{ ...ACTIVE, startDate: "not-a-date" }]);

    const label = await getEditionLabel();

    expect(label).toContain("AfrikaBurn 2027");
  });
});
