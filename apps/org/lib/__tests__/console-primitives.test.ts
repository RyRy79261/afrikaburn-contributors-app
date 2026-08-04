import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { fakeDb, type FakeDb } from "./support/fake-db";

// One fake database for the whole file; `createHttpDb` is the seam every
// console module reaches the database through (`lib/db.ts` getDb()), so the
// modules under test are the real ones and so is `lib/db.ts`.
import type * as QuaggaDb from "@quagga/db";

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
}));

import { getDb, schema } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";
import {
  isAuthConfigured,
  isDatabaseConfigured,
  missingConfig,
  participantAppUrl,
} from "@/lib/config";
import { formatDate, formatDateTime, formatMoney } from "@/lib/labels";
import { runAction } from "@/lib/actions/result";
import {
  asProjectKind,
  getProjectRegistrationAnswers,
} from "@/lib/project-registration";

const ENV = { ...process.env };

beforeEach(() => {
  db = fakeDb();
});

afterEach(() => {
  process.env = { ...ENV };
});

/**
 * `config.ts` is the copy an operator reads on a half-configured deployment.
 * Every app must boot env-less to a graceful "not configured" state (AGENTS.md
 * hard rule 4), and this module is what decides which sentence that is.
 */
describe("config probes", () => {
  it("reports both services missing when neither is configured", () => {
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.DATABASE_URL;

    expect(isAuthConfigured()).toBe(false);
    expect(isDatabaseConfigured()).toBe(false);
    // The order matters to the reader: sign-in first, because a deployment with
    // no auth cannot be used at all, whatever the database is doing.
    expect(missingConfig()).toEqual([
      "Better Auth (sign-in)",
      "Neon Postgres (database)",
    ]);
  });

  it("names only the service that is actually missing", () => {
    process.env.BETTER_AUTH_SECRET = "secret";
    delete process.env.DATABASE_URL;
    expect(missingConfig()).toEqual(["Neon Postgres (database)"]);

    process.env.DATABASE_URL = "postgres://localhost/db";
    expect(missingConfig()).toEqual([]);
  });

  it("falls back to the dev participant app so the gate button works env-less", () => {
    delete process.env.NEXT_PUBLIC_PARTICIPANT_APP_URL;
    expect(participantAppUrl()).toBe("http://localhost:3000");

    process.env.NEXT_PUBLIC_PARTICIPANT_APP_URL = "https://quagga.example.com";
    expect(participantAppUrl()).toBe("https://quagga.example.com");
  });

  it("treats an empty string as unconfigured, not as configuration", () => {
    // An env var set to "" is what a half-filled Vercel form produces, and it
    // must not read as "auth is set up" — the gate would then render a sign-in
    // form against nothing.
    process.env.BETTER_AUTH_SECRET = "";
    expect(isAuthConfigured()).toBe(false);
  });
});

describe("presentation labels", () => {
  it("renders cents as major units and a dash when there is no amount", () => {
    // en-ZA, deliberately: a comma decimal separator and a space for thousands
    // is what a South African reader expects on an invoice, and the locale is
    // pinned rather than taken from the server's.
    expect(formatMoney(125050, "ZAR")).toBe("ZAR 1 250,50");
    // Zero is an AMOUNT and must not read as "nothing recorded" — the two mean
    // different things on a supplier's row.
    expect(formatMoney(0, "ZAR")).toBe("ZAR 0,00");
    expect(formatMoney(null, "ZAR")).toBe("—");
  });

  it("returns a dash rather than 'Invalid Date' for anything unparseable", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("not a date")).toBe("—");
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("not a date")).toBe("—");
  });

  it("formats a date without the clock and a datetime WITH the minutes", () => {
    const at = new Date("2027-04-26T14:03:00Z");
    const day = formatDate(at);
    const stamp = formatDateTime(at);

    expect(day).toMatch(/2027/);
    expect(day).not.toMatch(/:/);
    // The audit trail is only legible with the clock: a burst of reads in one
    // sitting and a read a month apart are the same row without minutes.
    expect(stamp).toMatch(/\d{2}:\d{2}/);
  });

  it("accepts an ISO string as well as a Date, because rows arrive as both", () => {
    expect(formatDate("2027-04-26T00:00:00.000Z")).toBe(
      formatDate(new Date("2027-04-26T00:00:00.000Z")),
    );
  });
});

/**
 * `runAction` is the error contract for every server action in the console: it
 * is what turns a thrown authorisation refusal into the sentence the staff
 * member actually reads.
 */
describe("runAction", () => {
  it("reports success when the body completes", async () => {
    await expect(runAction(async () => {})).resolves.toEqual({ ok: true });
  });

  it("surfaces a thrown Error's message VERBATIM", async () => {
    // The refusals thrown by @quagga/core say which department owns what and
    // what to ask for. Replacing them with a generic sentence is the difference
    // between a staff member knowing who to ask and filing a bug.
    const result = await runAction(async () => {
      throw new Error("Suppliers cannot read a theme camp's members.");
    });
    expect(result).toEqual({
      ok: false,
      error: "Suppliers cannot read a theme camp's members.",
    });
  });

  it("falls back to a generic message for a non-Error throw", async () => {
    // A driver or a third-party library can throw a string; the client must
    // still get a `{ ok: false }` it can toast rather than an unhandled reject.
    const result = await runAction(async () => {
      throw "connection reset";
    });
    expect(result).toEqual({
      ok: false,
      error: "Something went wrong. Try again.",
    });
  });
});

describe("writeAuditEvent", () => {
  it("writes into audit_events and defaults subject and meta to null", async () => {
    await writeAuditEvent(getDb(), {
      actorId: "user-1",
      action: "account.elevate",
    });

    const [call] = db.recorded("insert", "audit_events");
    expect(call).toBeDefined();
    // Explicit nulls, not absent keys: the column is NOT NULL-able and a row
    // with an undefined subject is a row drizzle would omit from the INSERT.
    expect(call?.values).toEqual({
      actorId: "user-1",
      action: "account.elevate",
      subject: null,
      meta: null,
    });
  });

  it("carries the subject and meta through when they are given", async () => {
    await writeAuditEvent(getDb(), {
      actorId: "user-1",
      action: "registration.approve",
      subject: "reg-1",
      meta: { status: "approved" },
    });

    expect(db.inserted("audit_events")).toEqual({
      actorId: "user-1",
      action: "registration.approve",
      subject: "reg-1",
      meta: { status: "approved" },
    });
  });
});

describe("project registration answers", () => {
  it("narrows only the two project kinds", () => {
    expect(asProjectKind("mutant_vehicle")).toBe("mutant_vehicle");
    expect(asProjectKind("artwork")).toBe("artwork");
    // A theme camp's registration lives in the `registrations` COLUMNS; there is
    // no project questionnaire to read, and returning one would render a
    // camp-shaped page with an empty project form on it.
    expect(asProjectKind("theme_camp")).toBeNull();
    expect(asProjectKind("org")).toBeNull();
  });

  it("returns the answers the project authored", async () => {
    db.seed("questionnaire_responses", [
      { responses: { "mv-name": "The Dust Whale" } },
    ]);

    await expect(
      getProjectRegistrationAnswers("group-1", "mutant_vehicle", "ed-1"),
    ).resolves.toEqual({ "mv-name": "The Dust Whale" });
  });

  it("returns null when the project never authored the form", async () => {
    db.seed("questionnaire_responses", []);
    await expect(
      getProjectRegistrationAnswers("group-1", "artwork", "ed-1"),
    ).resolves.toBeNull();
  });

  it("only ever selects the responses column", async () => {
    db.seed("questionnaire_responses", [{ responses: {} }]);
    await getProjectRegistrationAnswers("group-1", "artwork", "ed-1");

    const [call] = db.recorded("select", "questionnaire_responses");
    expect(call?.columns).toEqual(["responses"]);
  });
});

describe("lib/db", () => {
  it("hands back the HTTP client and the real schema", () => {
    // `schema` is re-exported here so every console module has one import for
    // both; a barrel that dropped it would break ~40 files at once.
    expect(getDb()).toBeDefined();
    expect(schema.auditEvents).toBeDefined();
    expect(schema.registrations).toBeDefined();
  });
});
