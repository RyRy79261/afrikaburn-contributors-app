import { describe, it, expect, beforeEach, vi } from "vitest";

import { fakeDb, whereParams, type FakeDb } from "./support/fake-db";

/**
 * WORK ACCESS PASSES — THE ORG'S DECISIONS (epic #53, docs/wap-spec.md).
 *
 * What this file pins, because each one is silent and permanent when wrong:
 *
 *   · every decision names `update` on `registrations` and is refused BEFORE
 *     anything is read;
 *   · the registration row is taken `FOR UPDATE` before the decision is
 *     re-taken (the lead's writes in apps/web take the same lock);
 *   · a grant can never exceed the ask, and an answered request cannot be
 *     answered again;
 *   · a return needs a note, and only a submitted list can be decided;
 *   · approval stores the snapshot "Changed since approval" is measured
 *     against — effective values, ids only, no names;
 *   · opening requests twice cannot notify every lead twice;
 *   · every decision writes its audit row, and its notices are kind `wap`,
 *     linked to the participant app.
 *
 * The fake proves projection, authorisation and the writes issued — never SQL
 * semantics (see support/fake-db.ts). The real locks and joins are
 * `pnpm e2e:local`'s.
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

import {
  approveWapList,
  declineWapRequest,
  grantWapRequest,
  returnWapList,
  setWapRequestWindow,
} from "@/lib/actions/wap";

const REG_ID = "11111111-1111-4111-8111-111111111111";
const REQ_ID = "22222222-2222-4222-8222-222222222222";
const EDITION_ID = "33333333-3333-4333-8333-333333333333";
const SESSION = { dbUserId: "reviewer-1", orgGroupId: "org-1" };

const UPDATE = { capability: "update", domain: "registrations" };

beforeEach(() => {
  db = fakeDb();
  requireOrgSession.mockReset();
  requireOrgSession.mockResolvedValue(SESSION);
  db.seed("groups", [
    { name: "The Camp", kind: "theme_camp", slug: "the-camp" },
  ]);
  // The project's leads, for the post-commit notices.
  db.seed("memberships", [
    { userId: "lead-1", groupId: "group-1" },
    { userId: "lead-2", groupId: "group-1" },
  ]);
});

function lockedRegistration(listStatus: string) {
  return {
    id: REG_ID,
    editionId: EDITION_ID,
    listStatus,
    groupId: "group-1",
  };
}

/** The request read, the locked request, and the UPDATE … RETURNING. */
function seedRequest(
  status: string,
  requested: number,
  returned: Record<string, unknown>[] = [{ id: REQ_ID }],
) {
  db.seed("wap_requests", [
    [{ registrationId: REG_ID }],
    [{ id: REQ_ID, registrationId: REG_ID, requested, status }],
    returned,
  ]);
  db.seed("registrations", [[lockedRegistration("draft")]]);
}

function audits() {
  return db.recorded("insert", "audit_events").map((c) => c.values);
}

function notices() {
  return db
    .recorded("insert", "notifications")
    .flatMap((c) => c.values as Record<string, unknown>[]);
}

describe("every WAP decision is refused before anything is read", () => {
  const refused = "Only Theme camps may update registrations.";
  const cases: [string, () => Promise<unknown>][] = [
    ["grant", () => grantWapRequest({ requestId: REQ_ID, granted: 2 })],
    ["decline", () => declineWapRequest({ requestId: REQ_ID })],
    ["approve", () => approveWapList({ registrationId: REG_ID })],
    ["return", () => returnWapList({ registrationId: REG_ID, note: "Fix it" })],
    [
      "open",
      () => setWapRequestWindow({ editionId: EDITION_ID, action: "open" }),
    ],
  ];
  it.each(cases)("%s", async (_name, run) => {
    requireOrgSession.mockRejectedValue(new Error(refused));
    await expect(run()).resolves.toEqual({ ok: false, error: refused });
    expect(requireOrgSession).toHaveBeenCalledWith(UPDATE);
    expect(db.calls).toEqual([]);
  });
});

describe("grantWapRequest", () => {
  it("grants within the ask, under the registration lock, audited and notified", async () => {
    seedRequest("pending", 4);
    const result = await grantWapRequest({ requestId: REQ_ID, granted: 3 });
    expect(result).toEqual({ ok: true });

    // The registration row was locked before the request was decided.
    const regLock = db.recorded("select", "registrations")[0];
    expect(regLock?.methods).toContain("for");

    const [update] = db.recorded("update", "wap_requests");
    expect(update?.values).toMatchObject({
      status: "granted",
      granted: 3,
      decidedByUserId: SESSION.dbUserId,
    });
    // Guarded on still being pending — a concurrent answer makes it a no-op.
    expect(whereParams(update?.where)).toContain("pending");

    expect(audits()).toEqual([
      {
        actorId: SESSION.dbUserId,
        action: "wap.request.grant",
        subject: REG_ID,
        meta: { requestId: REQ_ID, requested: 4, granted: 3 },
      },
    ]);

    const sent = notices();
    expect(sent.map((n) => n.userId).sort()).toEqual(["lead-1", "lead-2"]);
    for (const n of sent) {
      expect(n).toMatchObject({
        kind: "wap",
        origin: "org",
        linkApp: "web",
        link: "/camps/the-camp/passes",
        title: "AfrikaBurn granted 3 Work Access Passes (you asked for 4)",
      });
    }
  });

  it("refuses more than asked and writes nothing", async () => {
    seedRequest("pending", 4);
    const result = await grantWapRequest({ requestId: REQ_ID, granted: 5 });
    expect(result).toEqual({
      ok: false,
      error: "You can grant fewer passes than asked, never more.",
    });
    expect(db.recorded("update")).toEqual([]);
    expect(audits()).toEqual([]);
    expect(notices()).toEqual([]);
  });

  it("refuses a request that was already answered (grants only go up)", async () => {
    seedRequest("granted", 4);
    const result = await grantWapRequest({ requestId: REQ_ID, granted: 2 });
    expect(result).toEqual({
      ok: false,
      error: "That request has already been answered.",
    });
    expect(db.recorded("update")).toEqual([]);
  });

  it("refuses when a concurrent answer beat it to the row", async () => {
    seedRequest("pending", 4, []);
    const result = await grantWapRequest({ requestId: REQ_ID, granted: 4 });
    expect(result.ok).toBe(false);
    expect(audits()).toEqual([]);
    expect(notices()).toEqual([]);
  });

  it("rejects a non-integer number at the boundary", async () => {
    const result = await grantWapRequest({ requestId: REQ_ID, granted: 1.5 });
    expect(result.ok).toBe(false);
    expect(db.calls).toEqual([]);
  });
});

describe("declineWapRequest", () => {
  it("declines a pending request, audited and notified", async () => {
    seedRequest("pending", 6);
    await expect(declineWapRequest({ requestId: REQ_ID })).resolves.toEqual({
      ok: true,
    });
    const [update] = db.recorded("update", "wap_requests");
    expect(update?.values).toMatchObject({ status: "declined" });
    expect(update?.values).not.toHaveProperty("granted");
    expect(audits()[0]).toMatchObject({ action: "wap.request.decline" });
    expect(notices()[0]).toMatchObject({
      kind: "wap",
      title: "AfrikaBurn declined the request for 6 Work Access Passes",
    });
  });
});

describe("returnWapList", () => {
  it("needs a note, and says so before touching the database", async () => {
    const result = await returnWapList({ registrationId: REG_ID, note: "  " });
    expect(result).toEqual({
      ok: false,
      error: "Write a note so the project knows what to change.",
    });
    expect(db.calls).toEqual([]);
  });

  it("refuses a list that isn't submitted", async () => {
    db.seed("registrations", [[lockedRegistration("draft")]]);
    const result = await returnWapList({
      registrationId: REG_ID,
      note: "Swap two people",
    });
    expect(result).toEqual({
      ok: false,
      error: "That list isn't waiting for a decision.",
    });
    expect(db.recorded("update")).toEqual([]);
  });

  it("returns a submitted list with the note, and tells the leads what it says", async () => {
    db.seed("registrations", [
      [lockedRegistration("submitted")],
      [{ id: REG_ID }],
    ]);
    const result = await returnWapList({
      registrationId: REG_ID,
      note: "Two bios are unfinished",
    });
    expect(result).toEqual({ ok: true });
    const [update] = db.recorded("update", "registrations");
    expect(update?.values).toMatchObject({
      wapListStatus: "returned",
      wapListReturnNote: "Two bios are unfinished",
      wapListReviewedByUserId: SESSION.dbUserId,
    });
    expect(audits()[0]).toMatchObject({
      action: "wap.list.return",
      meta: { note: "Two bios are unfinished" },
    });
    expect(notices()[0]).toMatchObject({
      kind: "wap",
      body: "The Camp: Two bios are unfinished",
    });
  });
});

describe("approveWapList", () => {
  it("stores the snapshot of effective values and notifies leads and every holder", async () => {
    db.seed("registrations", [
      [lockedRegistration("submitted")],
      [{ id: REG_ID }],
    ]);
    db.seed("wap_allocations", [
      {
        allocationId: "alloc-1",
        registrationId: REG_ID,
        membershipId: "m-1",
        // The lead overrode strike; the roster plan says no strike.
        overrideArrival: null,
        overrideDeparture: null,
        overrideBuild: null,
        overrideStrike: true,
        userId: "holder-1",
        groupId: "group-1",
        firstArrival: "2027-04-20",
        username: "holder_one",
        sanitizedAt: null,
        bioCompletedAt: new Date(),
        logisticsId: "log-1",
        joiningBuild: true,
        joiningStrike: false,
        arrivalDate: "2027-04-22",
        departureDate: "2027-05-03",
      },
    ]);

    await expect(approveWapList({ registrationId: REG_ID })).resolves.toEqual({
      ok: true,
    });

    const [update] = db.recorded("update", "registrations");
    expect(update?.values).toMatchObject({
      wapListStatus: "approved",
      wapListReturnNote: null,
      wapListApprovedSnapshot: [
        {
          membershipId: "m-1",
          userId: "holder-1",
          arrivalDate: "2027-04-22",
          departureDate: "2027-05-03",
          build: true,
          strike: true,
        },
      ],
    });
    // Ids and dates only: a copied name would outlive a rename or erasure.
    expect(JSON.stringify(update?.values)).not.toContain("holder_one");
    // Guarded on still being submitted.
    expect(whereParams(update?.where)).toContain("submitted");

    expect(audits()[0]).toMatchObject({
      action: "wap.list.approve",
      meta: { passes: 1 },
    });

    const sent = notices();
    const byUser = Object.fromEntries(sent.map((n) => [n.userId, n]));
    expect(byUser["lead-1"]).toMatchObject({
      title: "AfrikaBurn approved the Work Access Pass list",
      link: "/camps/the-camp/passes",
    });
    expect(byUser["holder-1"]).toMatchObject({
      kind: "wap",
      linkApp: "web",
      link: "/camps/the-camp",
    });
  });

  it("refuses a draft list and stores nothing", async () => {
    db.seed("registrations", [[lockedRegistration("draft")]]);
    const result = await approveWapList({ registrationId: REG_ID });
    expect(result.ok).toBe(false);
    expect(db.recorded("update")).toEqual([]);
    expect(db.recorded("select", "wap_allocations")).toEqual([]);
  });
});

describe("setWapRequestWindow", () => {
  function seedEdition(open: Date | null, close: Date | null) {
    db.seed("editions", [
      {
        id: EDITION_ID,
        name: "AfrikaBurn 2027",
        wapRequestsOpenAt: open,
        wapRequestsCloseAt: close,
      },
    ]);
  }

  it("opens, audits, and notifies the leads of every project that can ask", async () => {
    seedEdition(null, null);
    db.seed("registrations", [
      {
        groupId: "group-1",
        name: "The Camp",
        kind: "theme_camp",
        slug: "the-camp",
      },
    ]);
    const result = await setWapRequestWindow({
      editionId: EDITION_ID,
      action: "open",
    });
    expect(result).toEqual({ ok: true });

    const [lock] = db.recorded("select", "editions");
    expect(lock?.methods).toContain("for");
    const [update] = db.recorded("update", "editions");
    expect(update?.values).toMatchObject({ wapRequestsCloseAt: null });
    expect(
      (update?.values as { wapRequestsOpenAt: unknown }).wapRequestsOpenAt,
    ).toBeInstanceOf(Date);
    expect(audits()[0]).toMatchObject({
      action: "wap.requests.open",
      subject: EDITION_ID,
    });

    // Only registrations that can ask are notified.
    const projects = db.recorded("select", "registrations")[0];
    const params = whereParams(projects?.where);
    expect(params).toEqual(
      expect.arrayContaining(["submitted", "approved", "theme_camp"]),
    );
    expect(params).not.toContain("draft");

    expect(
      notices()
        .map((n) => n.userId)
        .sort(),
    ).toEqual(["lead-1", "lead-2"]);
    expect(notices()[0]).toMatchObject({
      kind: "wap",
      linkApp: "web",
      link: "/camps/the-camp/passes",
    });
  });

  it("refuses to open an open window, so a double click cannot notify twice", async () => {
    seedEdition(new Date(Date.now() - 60_000), null);
    const result = await setWapRequestWindow({
      editionId: EDITION_ID,
      action: "open",
    });
    expect(result).toEqual({
      ok: false,
      error: "Work Access Pass requests are already open.",
    });
    expect(db.recorded("update")).toEqual([]);
    expect(notices()).toEqual([]);
  });

  it("closes an open window and notifies nobody", async () => {
    seedEdition(new Date(Date.now() - 60_000), null);
    const result = await setWapRequestWindow({
      editionId: EDITION_ID,
      action: "close",
    });
    expect(result).toEqual({ ok: true });
    expect(audits()[0]).toMatchObject({ action: "wap.requests.close" });
    expect(notices()).toEqual([]);
  });
});
