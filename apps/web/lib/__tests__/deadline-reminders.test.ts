import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { dbMock } from "@/test/db-mock";

/**
 * THE CLAIM AND THE SEND ARE ONE UNIT (review on PR #26).
 *
 * The job used to commit its idempotency marker on its own, then write the
 * notifications in a second transaction. When that second write failed, the
 * marker was already committed: every retry found it, answered `already_sent`,
 * and the camps never heard. These tests pin the shape that fixes it — every
 * write inside one transaction, the claim first — and the retry that now
 * succeeds.
 *
 * What the mock cannot prove is the ROLLBACK itself; it has no database. That
 * part was proved against a real Postgres 16: a claim followed by a failing
 * notification insert, in one transaction, leaves zero markers, and the next
 * claim wins. Two concurrent claims leave exactly one.
 */

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

const mail = vi.hoisted(() => ({
  sent: [] as { to: string }[],
  /** How the stub fails, if at all. The real `sendEmail` RETURNS a provider
   * failure as `{ ok: false }`; only a fault inside it throws. */
  failure: null as null | "returns" | "throws",
}));

vi.mock("../email", () => ({
  sendEmail: async (input: { to: string }) => {
    if (mail.failure === "throws") throw new Error("socket hang up");
    if (mail.failure === "returns") {
      return { ok: false, error: "Resend responded 503: unavailable" };
    }
    mail.sent.push(input);
    return { ok: true, id: "mail-1", delivered: true };
  },
}));

const { runDeadlineReminders } = await import("../deadline-reminders");

const EDITION = "eeeeeeee-0000-4000-8000-000000000000";
const NOW = new Date("2027-03-01T09:00:00Z");

/** A close date `n` calendar days after NOW. */
function inDays(n: number): Date {
  const date = new Date(NOW);
  date.setUTCDate(date.getUTCDate() + n);
  return date;
}

/** What the active-edition read answers. */
function edition(closesAt: Date | null) {
  return [{ id: EDITION, closesAt }];
}

const CAMPS = [
  {
    status: "draft",
    groupId: "g-1",
    campName: "Mad Hatters",
    campSlug: "mad-hatters",
  },
];

const LEADS = [
  { userId: "u-1", groupId: "g-1", email: "lead@madhatters.example" },
];

/** Every write the run issued. */
function writes() {
  return dbMock.queries.filter((q) =>
    ["insert", "update", "delete"].includes(q.kind),
  );
}

beforeEach(() => {
  dbMock.reset();
  vi.stubEnv("DATABASE_URL", "postgres://test");
  mail.sent = [];
  mail.failure = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("runDeadlineReminders — the claim and the send are one unit", () => {
  it("claims the marker and writes the notifications inside ONE transaction", async () => {
    dbMock.queue(
      edition(inDays(7)),
      CAMPS,
      LEADS,
      /* the claim won */ [{ id: "marker-1" }],
      /* notifications insert */ [],
    );

    const outcome = await runDeadlineReminders(NOW);

    expect(outcome).toEqual({
      status: "sent",
      milestone: 7,
      camps: 1,
      notified: 1,
    });
    expect(dbMock.transactions).toBe(1);

    const [claim] = dbMock.writesTo(schema.auditEvents);
    const [send] = dbMock.writesTo(schema.notifications);
    expect(claim?.tx).toBe(true);
    expect(send?.tx).toBe(true);
    // Claim FIRST, so a runner that loses stops before writing anything.
    expect(dbMock.queries.indexOf(claim!)).toBeLessThan(
      dbMock.queries.indexOf(send!),
    );

    expect((claim!.arg("values") as { subject: string }).subject).toBe(
      `${EDITION}:deadline-7`,
    );
    expect(
      (send!.arg("values") as { userId: string }[]).map((r) => r.userId),
    ).toEqual(["u-1"]);
    expect(mail.sent.map((m) => m.to)).toEqual(["lead@madhatters.example"]);
  });

  it("a failed notification write strands nothing, and the retry sends", async () => {
    // Run 1: the claim lands, then the notification write fails.
    dbMock.queue(
      edition(inDays(7)),
      CAMPS,
      LEADS,
      [{ id: "marker-1" }],
      new Error("connection reset"),
    );

    await expect(runDeadlineReminders(NOW)).rejects.toThrow("connection reset");

    // THE REGRESSION. The old code committed the claim outside any
    // transaction, so this failure left a marker behind and every retry said
    // `already_sent`. Now every write sits inside the one transaction the
    // failure rolls back — and no email went out for a send that did not land.
    expect(writes().length).toBeGreaterThan(0);
    expect(writes().every((q) => q.tx)).toBe(true);
    expect(mail.sent).toHaveLength(0);

    // Run 2: the claim was rolled back, so this runner wins it and sends.
    dbMock.reset();
    dbMock.queue(
      edition(inDays(7)),
      CAMPS,
      LEADS,
      [{ id: "marker-2" }],
      [],
    );

    const retry = await runDeadlineReminders(NOW);

    expect(retry.status).toBe("sent");
    expect(retry.notified).toBe(1);
    expect(mail.sent).toHaveLength(1);
  });

  it("a runner that loses the claim writes no notifications and sends no email", async () => {
    dbMock.queue(
      edition(inDays(7)),
      CAMPS,
      LEADS,
      /* another runner holds the marker */ [],
    );

    expect(await runDeadlineReminders(NOW)).toEqual({
      status: "already_sent",
      milestone: 7,
    });
    expect(dbMock.writesTo(schema.notifications)).toHaveLength(0);
    expect(mail.sent).toHaveLength(0);
  });

  it("still claims the milestone when nobody needs reminding, so a retry does not rescan", async () => {
    dbMock.queue(edition(inDays(21)), /* no camps */ [], [{ id: "marker-1" }]);

    expect(await runDeadlineReminders(NOW)).toEqual({
      status: "nobody_to_remind",
      milestone: 21,
      camps: 0,
      notified: 0,
    });
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(1);
    expect(dbMock.writesTo(schema.notifications)).toHaveLength(0);
  });

  it.each(["returns", "throws"] as const)(
    "logs an email that fails by %s, and keeps the committed send",
    async (how) => {
      mail.failure = how;
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      dbMock.queue(edition(inDays(1)), CAMPS, LEADS, [{ id: "marker-1" }], []);

      const outcome = await runDeadlineReminders(NOW);

      expect(outcome.status).toBe("sent");
      expect(outcome.notified).toBe(1);
      // A provider failure comes back as `{ ok: false }`, not as an exception.
      // The first version of this job dropped that shape without a trace.
      expect(logged).toHaveBeenCalledWith(
        "[reminders] deadline email failed",
        how === "returns"
          ? "Resend responded 503: unavailable"
          : expect.any(Error),
      );
    },
  );
});

describe("runDeadlineReminders — nothing to do writes nothing", () => {
  it("reports no database without a query", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(await runDeadlineReminders(NOW)).toEqual({ status: "no_database" });
    expect(dbMock.queries).toHaveLength(0);
  });

  it("reports no active edition", async () => {
    dbMock.queue([]);
    expect(await runDeadlineReminders(NOW)).toEqual({
      status: "no_active_edition",
    });
    expect(dbMock.transactions).toBe(0);
  });

  it("reminds nobody when no close date is set", async () => {
    dbMock.queue(edition(null));
    expect(await runDeadlineReminders(NOW)).toEqual({
      status: "no_close_date",
    });
    expect(dbMock.transactions).toBe(0);
  });

  it("stays quiet on a day that is not a milestone", async () => {
    dbMock.queue(edition(inDays(10)));
    expect(await runDeadlineReminders(NOW)).toEqual({
      status: "not_a_milestone_today",
    });
    expect(dbMock.transactions).toBe(0);
  });
});
