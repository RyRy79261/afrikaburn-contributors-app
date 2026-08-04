import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MEDICAL_VIEW_AUDIT_ACTION } from "@quagga/core";

import { fakeDb, whereMentions, type FakeDb } from "./support/fake-db";
import { GOD, PERSONAL_READER, READER, SUPPLIERS_LEAD } from "./support/actors";

// The source-text assertions below and the EXECUTED ones at the bottom of this
// file belong together: one proves the guard is written, the other proves it
// runs. Neither replaces the other — a refactor that keeps the words and
// changes the object passes the first and fails the second.
import type * as QuaggaDb from "@quagga/db";

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
}));

import {
  activityLabel,
  activityTone,
  isFeedAction,
  FEED_EXCLUDED_ACTIONS,
} from "../status-board-format";
import {
  canReadMedicalAccessLog,
  getAuditTrail,
  getMedicalAccessLog,
} from "../medical-audit";

// REGRESSION: the medical read path is fail-open on purpose — an emergency read
// is never blocked, never rate-limited, and its audit row is written in
// `after()` so a dropped instance or a DB blip yields a silent, unlogged
// disclosure. That trade is only defensible if the rows that DO land are read
// by a human. Before `/audit` they were not: the registration decision log
// filters `subject = registrationId` (medical rows carry a user id), and the
// overview feed was six unfiltered rows, so medical reads were written and
// never read back by anyone.
//
// These tests pin the reader down: the action renders as English, it is kept
// out of the six-row feed so a burst of reads cannot evict every decision, and a
// module + page actually query and render it.

/** Drop block and line comments so assertions read CODE, not the prose about it. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function source(relative: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${relative}`, import.meta.url)),
    "utf8",
  );
}

describe("REGRESSION: medical reads render as English, not a raw action key", () => {
  it("labels bio.medical.view for a human", () => {
    const label = activityLabel(MEDICAL_VIEW_AUDIT_ACTION);
    expect(label).not.toBe(MEDICAL_VIEW_AUDIT_ACTION);
    expect(label).not.toMatch(/\./); // no dotted key leaking into the UI
    expect(label.toLowerCase()).toContain("medical");
  });

  it("gives it an attention tone, not the neutral admin dot", () => {
    expect(activityTone(MEDICAL_VIEW_AUDIT_ACTION)).toBe("attention");
  });

  it("still falls back to the key for genuinely unknown actions", () => {
    expect(activityLabel("something.new")).toBe("something.new");
  });
});

describe("REGRESSION: medical reads cannot swamp the six-row activity feed", () => {
  it("excludes bio.medical.view from the glance feed", () => {
    expect(FEED_EXCLUDED_ACTIONS).toContain(MEDICAL_VIEW_AUDIT_ACTION);
    expect(isFeedAction(MEDICAL_VIEW_AUDIT_ACTION)).toBe(false);
  });

  it("keeps registration decisions in the feed", () => {
    for (const action of [
      "registration.approve",
      "registration.reject",
      "registration.request_changes",
      "registration.start_review",
      "review.comment",
    ]) {
      expect(isFeedAction(action)).toBe(true);
    }
  });

  it("excludes nothing else — the feed is a glance, not a redaction", () => {
    expect([...FEED_EXCLUDED_ACTIONS]).toEqual([MEDICAL_VIEW_AUDIT_ACTION]);
  });

  it("the feed query applies the exclusion in SQL, not in the component", () => {
    // A JS-side filter after `limit 6` would return fewer than six rows (or
    // none) during a burst — the eviction bug in a different costume.
    const statusBoard = source("lib/status-board.ts");
    expect(statusBoard).toMatch(/notInArray\(\s*schema\.auditEvents\.action/);
    expect(statusBoard).toMatch(/FEED_EXCLUDED_ACTIONS/);
  });
});

describe("REGRESSION: something actually READS the medical audit rows", () => {
  const reader = source("lib/medical-audit.ts");

  it("queries audit_events for the medical action", () => {
    expect(reader).toMatch(/MEDICAL_VIEW_AUDIT_ACTION/);
    expect(reader).toMatch(/schema\.auditEvents\.action/);
  });

  it("is a plain record — no aggregation, threshold or alerting", () => {
    // Ryan's call, 26 Jul 2026: reading many members' notes in one sitting is
    // ordinary medic work, so flagging it reports normal care as an incident
    // and tells safety staff the tool watches them. If this ever comes back it
    // is a product decision, not a refactor.
    // Strip comments first: the prose in these files EXPLAINS why there is no
    // threshold or alerting, so matching raw source would fail on the very
    // sentence that records the decision.
    expect(stripComments(reader)).not.toMatch(
      /summarizeMedicalAccess|detectMedicalEnumeration|threshold|alert/i,
    );
    const panel = source("components/audit/medical-access-panel.tsx");
    expect(stripComments(panel)).not.toMatch(/alert/i);
    for (const p of [
      "app/(console)/page.tsx",
      "app/(console)/status/page.tsx",
    ]) {
      expect(source(p)).not.toMatch(
        /MedicalAccessStrip|getMedicalAccessGlance/,
      );
    }
  });

  it("a gated console page renders that log", () => {
    const page = source("app/(console)/audit/page.tsx");
    expect(page).toMatch(/guardConsole/);
    expect(page).toMatch(/getMedicalAccessLog/);
    expect(page).toMatch(/MedicalAccessPanel/);
  });

  it("the audit surfaces show who/whose/when but never the notes", () => {
    const panel = source("components/audit/medical-access-panel.tsx");
    expect(panel).not.toMatch(/medicalNotes/);
    expect(panel).not.toMatch(/decrypt/i);
  });
});

// ---------------------------------------------------------------------------
// AND NOW THE EXECUTED HALF.
// ---------------------------------------------------------------------------

const SUBJECT_ID = "16161616-1616-4616-8616-161616161616";

function medicalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "audit-1",
    actorId: "user-9",
    actorEmail: "medic@example.com",
    subjectId: SUBJECT_ID,
    meta: { basis: "org_staff" },
    createdAt: new Date("2026-11-01T00:00:00Z"),
    ...overrides,
  };
}

describe("canReadMedicalAccessLog asks the AUDIT domain, not 'anywhere'", () => {
  it("admits an org-wide personal-information role and the System manager", () => {
    expect(canReadMedicalAccessLog(PERSONAL_READER)).toBe(true);
    expect(canReadMedicalAccessLog(GOD)).toBe(true);
  });

  it("REFUSES a suppliers-scoped personal-information role", () => {
    // A suppliers lead reading supply-related details is exactly right. A
    // suppliers lead reading which burners disclosed a health condition is
    // exactly what this predicate exists to stop — the log spans every camp's
    // members, so a departmental grant cannot open an org-wide census.
    expect(canReadMedicalAccessLog(SUPPLIERS_LEAD)).toBe(false);
    expect(canReadMedicalAccessLog(READER)).toBe(false);
  });
});

describe("getMedicalAccessLog", () => {
  beforeEach(() => {
    db = fakeDb();
  });

  it("FAILS CLOSED — throws and issues no query for a refused actor", async () => {
    // There is no redaction of these rows that is not still a disclosure
    // census, so there is nothing to return.
    await expect(getMedicalAccessLog(SUPPLIERS_LEAD)).rejects.toThrow(
      "Not authorised to read the medical access log.",
    );
    expect(db.calls).toEqual([]);
  });

  it("resolves the actor, the subject and the basis", async () => {
    db.seed("audit_events", [medicalRow()]);
    db.seed("users", [
      { userId: SUBJECT_ID, username: "alice", sanitizedAt: null },
    ]);

    const log = await getMedicalAccessLog(PERSONAL_READER);

    expect(log.rows[0]).toMatchObject({
      actorEmail: "medic@example.com",
      subjectId: SUBJECT_ID,
      subjectName: "alice",
      basis: "org_staff",
    });
    expect(log.lookbackDays).toBe(30);
  });

  it("renders a SANITIZED subject through publicMemberName", async () => {
    db.seed("audit_events", [medicalRow()]);
    db.seed("users", [
      {
        userId: SUBJECT_ID,
        username: null,
        sanitizedAt: new Date("2026-08-01T00:00:00Z"),
      },
    ]);

    const log = await getMedicalAccessLog(GOD);
    expect(log.rows[0]?.subjectName).toBe("Departed Burner");
  });

  it("parses only the three real bases, and never echoes anything else", async () => {
    // `audit_events.meta` is jsonb written by another code path; whatever is in
    // there must not reach the screen as an authority nobody granted.
    db.seed("audit_events", [
      medicalRow({ id: "a", meta: { basis: "self" } }),
      medicalRow({ id: "b", meta: { basis: "camp_lead" } }),
      medicalRow({ id: "c", meta: { basis: "because I said so" } }),
      medicalRow({ id: "d", meta: null }),
    ]);
    db.seed("users", []);

    const log = await getMedicalAccessLog(GOD);

    expect(log.rows.map((r) => r.basis)).toEqual([
      "self",
      "camp_lead",
      null,
      null,
    ]);
  });

  it("only resolves names for UUID-SHAPED subjects, and still renders", async () => {
    // `audit_events.subject` is `text` and holds ids for several row kinds.
    // Casting the column in a join would let one malformed historical row error
    // the whole page — and this page must always render.
    db.seed("audit_events", [
      medicalRow({ subjectId: "legacy-subject-key" }),
      medicalRow({ id: "audit-2", subjectId: null }),
    ]);

    const log = await getMedicalAccessLog(GOD);

    expect(log.rows).toHaveLength(2);
    expect(log.rows[0]?.subjectName).toBeNull();
    expect(log.rows[1]?.subjectName).toBeNull();
    // No id looked like a uuid, so there was nothing to look up.
    expect(db.recorded("select", "users")).toHaveLength(0);
  });

  it("says the view is PARTIAL when the row cap is hit", async () => {
    // A busy edition must not OOM the page, and a silently truncated census
    // reads as "only three people looked" — which would be the wrong
    // conclusion from the one screen that exists to answer that question.
    db.seed("audit_events", [medicalRow(), medicalRow({ id: "audit-2" })]);
    db.seed("users", []);

    const full = await getMedicalAccessLog(GOD, { limit: 2 });
    expect(full.truncated).toBe(true);

    const partial = await getMedicalAccessLog(GOD, { limit: 5 });
    expect(partial.truncated).toBe(false);
  });

  it("clamps an over-large limit to the hard cap", async () => {
    db.seed("audit_events", []);
    const log = await getMedicalAccessLog(GOD, { limit: 100000 });
    // 500 rows requested, none returned — so it cannot be truncated.
    expect(log.truncated).toBe(false);
  });

  it("honours a custom lookback window", async () => {
    db.seed("audit_events", []);
    const log = await getMedicalAccessLog(GOD, { lookbackDays: 7 });
    expect(log.lookbackDays).toBe(7);
  });
});

describe("getAuditTrail", () => {
  beforeEach(() => {
    db = fakeDb();
  });

  it("gives the actor's address AND the medical rows to an audit-domain reader", async () => {
    db.seed("audit_events", [
      {
        id: "audit-1",
        action: MEDICAL_VIEW_AUDIT_ACTION,
        subject: SUBJECT_ID,
        createdAt: new Date("2026-11-01T00:00:00Z"),
        actorEmail: "medic@example.com",
      },
    ]);

    const rows = await getAuditTrail(PERSONAL_READER);

    expect(rows[0]).toMatchObject({
      action: MEDICAL_VIEW_AUDIT_ACTION,
      actorEmail: "medic@example.com",
    });
    // The granted caller's query carries NO exclusion at all — the pair is what
    // makes the negative half above mean something.
    expect(db.recorded("select", "audit_events")[0]?.where).toBeUndefined();
  });

  it("WITHHOLDS the address and FILTERS the medical rows for everyone else", async () => {
    // Those rows carry a subject id, every console rank can open a member page,
    // and the row only exists when the subject HAS notes — so leaving them in
    // would let any rank walk the trail and reconstruct a list of burners who
    // have disclosed a health condition. That is the exact bulk exposure the
    // member roster refuses to carry, arriving by the back door.
    db.seed("audit_events", [
      {
        id: "audit-1",
        action: "registration.approve",
        subject: "reg-1",
        createdAt: new Date("2026-11-01T00:00:00Z"),
        actorEmail: "staff@example.com",
      },
    ]);

    const rows = await getAuditTrail(READER);

    // The ordinary org activity still reads.
    expect(rows[0]).toMatchObject({ action: "registration.approve" });
    expect(rows[0]?.actorEmail).toBeNull();

    const [call] = db.recorded("select", "audit_events");
    expect(call?.columns).not.toContain("actorEmail");
    // ...and the medical action was excluded IN THE QUERY, not after the fetch.
    // The condition itself names the action, so this fails if the filter is
    // dropped, and also if it is quietly pointed at something else.
    expect(whereMentions(call?.where, MEDICAL_VIEW_AUDIT_ACTION)).toBe(true);
  });

  it("refuses the medical rows to a department that does not own the audit log", async () => {
    db.seed("audit_events", []);
    await getAuditTrail(SUPPLIERS_LEAD);
    const [call] = db.recorded("select", "audit_events");
    expect(call?.columns).not.toContain("actorEmail");
    expect(whereMentions(call?.where, MEDICAL_VIEW_AUDIT_ACTION)).toBe(true);
  });
});
