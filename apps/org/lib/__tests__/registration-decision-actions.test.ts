import { describe, it, expect, beforeEach, vi } from "vitest";

import { fakeDb, type FakeDb } from "./support/fake-db";

/**
 * APPROVING A REGISTRATION IS THE ENTITLEMENT FLIP — an `approved` row is what
 * makes a camp registered. The decision, its audit row and the reason the camp
 * reads are one atomic unit, and every failure here is silent and permanent: a
 * decision with no trail, or a green banner sitting over last round's rejection
 * reason.
 *
 * `apps/web` already carries `decision-reason-invariant.test.ts` for the READING
 * side. This is the writing side, which had none.
 */

import type * as QuaggaDb from "@quagga/db";

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
  // `withTransaction` opens a real Neon WebSocket pool. Handing it the same fake
  // means one call log covers the writes whether they ran standalone or inside
  // the transaction — which is the assertion that matters here (they must be
  // issued together).
  createPooledDb: () => ({ db, pool: { end: async () => {} } }),
}));

// Both throw outside a request scope; neither is what this file is about.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const requireOrgSession = vi.fn();
vi.mock("@/lib/session", () => ({
  requireOrgSession: (options?: unknown) => requireOrgSession(options),
}));

import {
  addSectionReview,
  decideRegistration,
  setSectionReviewStatus,
} from "@/lib/actions/registrations";

const REG_ID = "11111111-1111-4111-8111-111111111111";
const REVIEW_ID = "22222222-2222-4222-8222-222222222222";

const SESSION = { dbUserId: "user-1", orgGroupId: "org-1" };

beforeEach(() => {
  db = fakeDb();
  requireOrgSession.mockReset();
  requireOrgSession.mockResolvedValue(SESSION);
  // The camp's leads, for the post-commit notification hook.
  db.seed("groups", [{ name: "Mad Hatters", slug: "mad-hatters" }]);
  db.seed("memberships", []);
});

/** Seed the registration read, then the row the UPDATE … RETURNING gives back. */
function seedRegistration(status: string, returned: Record<string, unknown>[]) {
  db.seed("registrations", [[{ status, groupId: "group-1" }], returned]);
}

describe("decideRegistration", () => {
  it("refuses a caller without `update` on the registrations domain", async () => {
    // The refusal is the one @quagga/core produced — it names the department
    // that does hold the right — not a generic sentence invented here.
    requireOrgSession.mockRejectedValue(
      new Error("Only Theme camps may update registrations."),
    );

    const result = await decideRegistration({
      registrationId: REG_ID,
      action: "approve",
    });

    expect(result).toEqual({
      ok: false,
      error: "Only Theme camps may update registrations.",
    });
    expect(requireOrgSession).toHaveBeenCalledWith({
      capability: "update",
      domain: "registrations",
    });
    // Refused before it read anything.
    expect(db.calls).toEqual([]);
  });

  it("requires a reason for a rejection and for requested changes, with different sentences", async () => {
    seedRegistration("under_review", [{ id: REG_ID }]);
    await expect(
      decideRegistration({ registrationId: REG_ID, action: "reject" }),
    ).resolves.toEqual({
      ok: false,
      error: "A rejection needs a reason for the camp.",
    });

    await expect(
      decideRegistration({
        registrationId: REG_ID,
        action: "request_changes",
        reason: "   ",
      }),
    ).resolves.toEqual({
      ok: false,
      error: "Tell the camp what to change — a reason is required.",
    });

    // Neither ever reached the database.
    expect(db.calls).toEqual([]);
  });

  it("does NOT require a reason to approve", async () => {
    seedRegistration("under_review", [{ id: REG_ID }]);
    const result = await decideRegistration({
      registrationId: REG_ID,
      action: "approve",
    });
    expect(result).toEqual({ ok: true });
  });

  it("refuses a registration that no longer exists", async () => {
    db.seed("registrations", [[], []]);
    await expect(
      decideRegistration({ registrationId: REG_ID, action: "approve" }),
    ).resolves.toEqual({
      ok: false,
      error: "That registration no longer exists.",
    });
  });

  it("refuses an illegal transition and writes nothing", async () => {
    // Already approved: `resolveReviewAction` throws rather than re-stamping a
    // decision, and no audit row must be left behind claiming one happened.
    seedRegistration("approved", [{ id: REG_ID }]);

    const result = await decideRegistration({
      registrationId: REG_ID,
      action: "approve",
    });

    expect(result.ok).toBe(false);
    expect(db.recorded("update", "registrations")).toHaveLength(0);
    expect(db.recorded("insert", "audit_events")).toHaveLength(0);
  });

  /**
   * THE TOCTOU GUARD. The status the transition was validated against must still
   * be the row's status when the write lands. Guarding the UPDATE's WHERE on it
   * means a concurrent decision (another reviewer, a resubmit) makes this a
   * no-op — and a no-op MUST throw, because a stale audit event is worse than a
   * failed decision.
   */
  it("throws and audits nothing when the status moved under the reviewer", async () => {
    seedRegistration("under_review", []);

    const result = await decideRegistration({
      registrationId: REG_ID,
      action: "approve",
    });

    expect(result).toEqual({
      ok: false,
      error:
        "This registration changed since you opened it — reload and try again.",
    });
    expect(db.recorded("insert", "audit_events")).toHaveLength(0);
  });

  it("writes the reason ON THE ROW THE CAMP READS, and stamps the decision", async () => {
    // It used to land in `audit_events` and the notification alone, so a camp
    // opening its registration saw "See the reviewer's notes below" above an
    // empty thread (migration 0025).
    seedRegistration("under_review", [{ id: REG_ID }]);

    await decideRegistration({
      registrationId: REG_ID,
      action: "reject",
      reason: "Your fire plan is missing.",
    });

    const [update] = db.recorded("update", "registrations");
    expect(update?.values).toMatchObject({
      status: "rejected",
      decisionReason: "Your fire plan is missing.",
      decidedByUserId: "user-1",
    });
    expect((update?.values as { decidedAt?: Date }).decidedAt).toBeInstanceOf(
      Date,
    );
  });

  it("CLEARS the reason on a later transition that carries none", async () => {
    // An approval must not leave last round's "your fire plan is missing"
    // sitting under a green banner. A resubmitted registration is `submitted`,
    // and approving it routes through `under_review` in one step.
    seedRegistration("submitted", [{ id: REG_ID }]);

    await decideRegistration({ registrationId: REG_ID, action: "approve" });

    const [update] = db.recorded("update", "registrations");
    expect((update?.values as { decisionReason: string | null }).decisionReason)
      .toBeNull();
  });

  it("does not stamp decidedAt for a non-decision transition", async () => {
    // `request_changes` and `start_review` move the row without deciding it;
    // stamping them would make the decision timestamp mean two things.
    seedRegistration("submitted", [{ id: REG_ID }]);

    await decideRegistration({
      registrationId: REG_ID,
      action: "request_changes",
      reason: "Add your sound plan.",
    });

    const values = db.recorded("update", "registrations")[0]?.values as Record<
      string,
      unknown
    >;
    expect(values.status).toBe("changes_requested");
    expect(values.decidedAt).toBeUndefined();
    expect(values.decidedByUserId).toBeUndefined();
  });

  it("writes the audit row with the from/to pair and the reason", async () => {
    seedRegistration("under_review", [{ id: REG_ID }]);

    await decideRegistration({
      registrationId: REG_ID,
      action: "reject",
      reason: "Not this year.",
    });

    expect(db.inserted("audit_events")).toEqual({
      actorId: "user-1",
      action: "registration.reject",
      subject: REG_ID,
      meta: { from: "under_review", to: "rejected", reason: "Not this year." },
    });
  });

  it("notifies the camp's leads AFTER the decision is committed", async () => {
    seedRegistration("under_review", [{ id: REG_ID }]);
    db.seed("memberships", [{ userId: "lead-1" }, { userId: "lead-1" }]);

    await decideRegistration({ registrationId: REG_ID, action: "approve" });

    // Deduplicated: one lead holding two rows must not be told twice.
    const rows = db.inserted("notifications") as { userId: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: "lead-1", origin: "org", linkApp: "web" });
  });

  it("commits the decision even when the notification hook fails", async () => {
    // Best-effort, after commit: a notification failure must never roll back a
    // decision that is already true.
    seedRegistration("under_review", [{ id: REG_ID }]);
    db.fail("groups");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      decideRegistration({ registrationId: REG_ID, action: "approve" }),
    ).resolves.toEqual({ ok: true });
    expect(db.recorded("insert", "audit_events")).toHaveLength(1);
    error.mockRestore();
  });

  it("rejects a malformed id at the zod boundary", async () => {
    const result = await decideRegistration({
      registrationId: "not-a-uuid",
      action: "approve",
    });
    expect(result.ok).toBe(false);
    expect(db.calls).toEqual([]);
  });
});

describe("addSectionReview", () => {
  it("refuses a caller without `create` on registrations", async () => {
    requireOrgSession.mockRejectedValue(new Error("Not authorised."));
    await expect(
      addSectionReview({
        registrationId: REG_ID,
        sectionKey: "sound_placement",
        comment: "Sound plan",
      }),
    ).resolves.toEqual({ ok: false, error: "Not authorised." });
    expect(requireOrgSession).toHaveBeenCalledWith({
      capability: "create",
      domain: "registrations",
    });
  });

  it("refuses an empty comment", async () => {
    const result = await addSectionReview({
      registrationId: REG_ID,
      sectionKey: "sound_placement",
      comment: "   ",
    });
    expect(result.ok).toBe(false);
    expect(db.calls).toEqual([]);
  });

  it("opens the thread and audits it in one unit", async () => {
    await addSectionReview({
      registrationId: REG_ID,
      sectionKey: "sound_placement",
      comment: "The sound plan needs a decibel figure.",
    });

    expect(db.inserted("section_reviews")).toEqual({
      registrationId: REG_ID,
      sectionKey: "sound_placement",
      status: "open",
      comment: "The sound plan needs a decibel figure.",
      reviewerId: "user-1",
    });
    expect(db.inserted("audit_events")).toMatchObject({
      action: "review.comment",
      subject: REG_ID,
      meta: { sectionKey: "sound_placement" },
    });
  });
});

describe("setSectionReviewStatus", () => {
  it("refuses a comment that no longer exists", async () => {
    db.seed("section_reviews", []);
    await expect(
      setSectionReviewStatus({
        reviewId: REVIEW_ID,
        registrationId: REG_ID,
        status: "resolved",
      }),
    ).resolves.toEqual({ ok: false, error: "That comment no longer exists." });
  });

  it("resolves an open thread", async () => {
    db.seed("section_reviews", [{ status: "open" }]);
    await expect(
      setSectionReviewStatus({
        reviewId: REVIEW_ID,
        registrationId: REG_ID,
        status: "resolved",
      }),
    ).resolves.toEqual({ ok: true });
    expect(db.recorded("update", "section_reviews")[0]?.values).toMatchObject({
      status: "resolved",
    });
  });

  it("is a no-op-shaped success when the status is already what was asked for", async () => {
    // Two reviewers pressing Resolve at once must not produce an error screen.
    db.seed("section_reviews", [{ status: "resolved" }]);
    await expect(
      setSectionReviewStatus({
        reviewId: REVIEW_ID,
        registrationId: REG_ID,
        status: "resolved",
      }),
    ).resolves.toEqual({ ok: true });
  });
});
