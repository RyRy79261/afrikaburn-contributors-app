import { describe, it, expect, beforeEach, vi } from "vitest";

import { fakeDb, type FakeDb } from "./support/fake-db";

/**
 * WORK ACCESS PASSES — WHAT THE ORG READS (epic #53, docs/wap-spec.md).
 *
 *   · the CSV needs `personal_information` on `registrations` — refused with a
 *     403 before anything is read — and never carries a hard-locked field;
 *   · email is SELECTED only for the export, never for the review panel;
 *   · "Also has a pass from {project}" reaches only the people on the list
 *     being shown, a free camp's name included (the decided exception);
 *   · the review panel's request facts ("Asks for N more", "Asked at
 *     registration: N") come from the rows, not from a guess.
 *
 * Projection and mapping only — the joins are `pnpm e2e:local`'s.
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

import { GET as exportPasses } from "@/app/api/registrations/passes/export/route";
import { loadWapReview, summariseWapOverviewRows } from "@/lib/wap";

const REG_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_REG = "44444444-4444-4444-8444-444444444444";
const EDITION_ID = "33333333-3333-4333-8333-333333333333";

function pass(overrides: Record<string, unknown> = {}) {
  return {
    allocationId: "alloc-1",
    registrationId: REG_ID,
    membershipId: "m-1",
    overrideArrival: null,
    overrideDeparture: null,
    overrideBuild: null,
    overrideStrike: null,
    userId: "holder-1",
    groupId: "group-1",
    firstArrival: "2027-04-20",
    username: "holder_one",
    sanitizedAt: null,
    email: "holder@example.com",
    // A phone the fake would hand back if anything SELECTED it.
    phone: "+27 82 000 0000",
    bioCompletedAt: null,
    logisticsId: "log-1",
    joiningBuild: true,
    joiningStrike: false,
    arrivalDate: "2027-04-22",
    departureDate: "2027-05-03",
    ...overrides,
  };
}

beforeEach(() => {
  db = fakeDb();
  requireOrgSession.mockReset();
  requireOrgSession.mockResolvedValue({ dbUserId: "reviewer-1" });
});

describe("the Work Access Pass CSV", () => {
  it("is refused without personal_information, before anything is read", async () => {
    requireOrgSession.mockRejectedValue(
      new Error("Only Theme camps may read personal information."),
    );
    const res = await exportPasses();
    expect(res.status).toBe(403);
    expect(requireOrgSession).toHaveBeenCalledWith({
      capability: "personal_information",
      domain: "registrations",
    });
    expect(db.calls).toEqual([]);
  });

  it("lists holders with email, the duplicate note, and no hard-locked field", async () => {
    db.seed("editions", [
      {
        id: EDITION_ID,
        name: "AfrikaBurn 2027",
        year: 2027,
        startDate: "2027-04-26",
        endDate: "2027-05-02",
      },
    ]);
    db.seed("registrations", [
      {
        registrationId: REG_ID,
        projectName: "The Camp",
        projectKind: "theme_camp",
        listStatus: "approved",
      },
    ]);
    db.seed("wap_allocations", [
      [pass()],
      // Holdings: the same person on a free camp's list.
      [
        { userId: "holder-1", registrationId: REG_ID, projectName: "The Camp" },
        {
          userId: "holder-1",
          registrationId: OTHER_REG,
          projectName: "Quiet Free Camp",
        },
      ],
    ]);

    const res = await exportPasses();
    expect(res.status).toBe(200);
    const csv = await res.text();
    const [header, row] = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(header).toBe(
      "Project,Project type,List status,Name,Username,Email,Arrival,Departure,Build,Strike,Flags",
    );
    expect(row).toContain("holder@example.com");
    expect(row).toContain("Also has a pass from Quiet Free Camp");
    expect(row).toContain("Bio incomplete");
    expect(csv.toLowerCase()).not.toMatch(/phone|emergency|passport|medical/);
    expect(csv).not.toContain("+27");

    const [passes] = db.recorded("select", "wap_allocations");
    expect(passes?.columns).toContain("email");
    expect(passes?.columns).not.toContain("phone");
  });
});

describe("loadWapReview", () => {
  function seedReview(snapshot: unknown = null) {
    db.seed("registrations", [
      {
        id: REG_ID,
        status: "approved",
        decidedAt: new Date("2027-02-14"),
        editionId: EDITION_ID,
        legacy: 12,
        listStatus: "submitted",
        submittedAt: new Date("2027-03-20"),
        submittedBy: "lead-1",
        reviewedAt: null,
        reviewedBy: null,
        returnNote: null,
        approvedAt: snapshot ? new Date("2027-03-10") : null,
        snapshot,
        groupId: "group-1",
        groupName: "The Camp",
        groupKind: "theme_camp",
        groupSlug: "the-camp",
        editionName: "AfrikaBurn 2027",
      },
    ]);
    db.seed("wap_requests", [
      {
        id: "req-2",
        requested: 4,
        reason: "Build crew grew",
        status: "pending",
        granted: null,
        createdAt: new Date("2027-03-18"),
        decidedAt: null,
        requestedBy: "lead-1",
      },
      {
        id: "req-1",
        requested: 10,
        reason: null,
        status: "granted",
        granted: 10,
        createdAt: new Date("2027-03-02"),
        decidedAt: new Date("2027-03-04"),
        requestedBy: "lead-1",
      },
    ]);
    db.seed("memberships", [{ count: 18 }]);
    db.seed("users", [
      { id: "lead-1", username: "lead_one", sanitizedAt: null },
      { id: "gone-1", username: "gone_one", sanitizedAt: null },
    ]);
  }

  it("reads the requests, the legacy ask and the list without selecting email", async () => {
    seedReview();
    db.seed("wap_allocations", [[pass()], []]);
    const review = await loadWapReview(REG_ID);
    expect(review).not.toBeNull();
    expect(review!.totalGranted).toBe(10);
    expect(review!.pending?.id).toBe("req-2");
    expect(review!.pendingIsTopUp).toBe(true);
    expect(review!.legacyAsk).toBe(12);
    expect(review!.memberCount).toBe(18);
    expect(review!.list.submittedByName).toBe("lead_one");
    expect(review!.passes[0]?.email).toBeNull();

    const [passes] = db.recorded("select", "wap_allocations");
    expect(passes?.columns).not.toContain("email");
  });

  it("names another project only next to a person on THIS list", async () => {
    seedReview();
    db.seed("wap_allocations", [
      [pass()],
      [
        {
          userId: "holder-1",
          registrationId: OTHER_REG,
          projectName: "Quiet Free Camp",
        },
        // Somebody not on this list — whatever the query returned, their
        // other project must never surface here.
        {
          userId: "stranger-1",
          registrationId: OTHER_REG,
          projectName: "Somebody Else's Camp",
        },
      ],
    ]);
    const review = await loadWapReview(REG_ID);
    const flags = review!.passes.flatMap((p) => p.flags);
    expect(flags).toContainEqual({
      kind: "other_project",
      projectName: "Quiet Free Camp",
    });
    expect(JSON.stringify(review)).not.toContain("Somebody Else's Camp");
  });

  it("reports who was removed since approval, by name", async () => {
    seedReview([
      {
        membershipId: "m-1",
        userId: "holder-1",
        arrivalDate: "2027-04-22",
        departureDate: "2027-05-03",
        build: true,
        strike: false,
      },
      {
        membershipId: "m-gone",
        userId: "gone-1",
        arrivalDate: "2027-04-24",
        departureDate: "2027-05-02",
        build: true,
        strike: false,
      },
    ]);
    db.seed("wap_allocations", [[pass()], []]);
    const review = await loadWapReview(REG_ID);
    expect(review!.changes.removed.map((p) => p.userId)).toEqual(["gone-1"]);
    expect(review!.removedNames.get("gone-1")).toBe("gone_one");
    // Submitted after an approval, and changed: the reviewer is told.
    expect(review!.list.badge).toBe("Changed since approval");
  });

  it("is null for a registration that does not exist", async () => {
    db.seed("registrations", []);
    await expect(loadWapReview(REG_ID)).resolves.toBeNull();
  });
});

describe("summariseWapOverviewRows", () => {
  it("groups asks per project and counts live passes", () => {
    const base = {
      projectName: "The Camp",
      groupKind: "theme_camp" as const,
      listStatus: "submitted" as const,
    };
    const rows = summariseWapOverviewRows(
      [
        {
          ...base,
          registrationId: "r1",
          requested: 10,
          status: "granted",
          granted: 10,
        },
        {
          ...base,
          registrationId: "r1",
          requested: 4,
          status: "pending",
          granted: null,
        },
        {
          ...base,
          registrationId: "r2",
          projectName: "An Artwork",
          groupKind: "artwork",
          listStatus: "draft",
          requested: 3,
          status: "declined",
          granted: null,
        },
      ],
      [{ registrationId: "r1", count: 7 }],
    );
    expect(rows).toEqual([
      expect.objectContaining({
        registrationId: "r2",
        requested: 3,
        granted: 0,
        allocated: 0,
        pendingAsk: null,
      }),
      expect.objectContaining({
        registrationId: "r1",
        requested: 14,
        granted: 10,
        allocated: 7,
        pendingAsk: 4,
      }),
    ]);
  });
});
