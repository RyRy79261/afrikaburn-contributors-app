import { describe, it, expect, beforeEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { GroupKind } from "@quagga/types";
import { dbMock, nullChecksOn, type RecordedQuery } from "@/test/db-mock";

// "ARCHIVING REVOKES CAMP ACCESS" (CDB-036, decided 2026-09-27 on #55), path
// by path. Each case runs the REAL store function against the db mock and
// asserts the membership read it issues carries `archived_at is null` — the
// one WHERE-clause fact the mock can see, and the one this rule hangs on. The
// source guard (membership-archive-guard.test.ts) covers every query in the
// monorepo structurally; these prove the filter is actually on the chains the
// most important access decisions run.

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());
vi.mock("next/server", async () =>
  (await import("@/test/next-mocks")).nextServerMock(),
);

const groups = await import("../groups-store");
const roles = await import("../roles-store");
const campmates = await import("../campmates-store");
const medical = await import("../medical-access");
const gate = await import("../announcement-gate");

const THEME_CAMP = GroupKind.enum.theme_camp;
const EDITION = "eeeeeeee-0000-4000-8000-000000000000";
const CAMP = "11111111-0000-4000-8000-00000000000a";
const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const REN = "aaaaaaaa-0000-4000-8000-000000000002";

/** Every chain that READ `memberships` (as the FROM or a join). */
function membershipReads(): RecordedQuery[] {
  return dbMock
    .queriesTouching(schema.memberships)
    .filter((q) => q.kind === "select");
}

/** Assert each membership read asks for current members only. */
function expectEveryReadActive(atLeast = 1): void {
  const reads = membershipReads();
  expect(reads.length).toBeGreaterThanOrEqual(atLeast);
  for (const q of reads) {
    expect(nullChecksOn(q, schema.memberships.archivedAt)).toContain("is null");
  }
}

beforeEach(() => {
  dbMock.reset();
});

describe("a former member is no member — per access path", () => {
  it("the viewer's role in a camp (every camp page, invite, action gate)", async () => {
    await groups.getViewerRole(REN, CAMP);
    expectEveryReadActive(1);
  });

  it("the viewer's permission membership (roster, roles, announcements, questionnaires)", async () => {
    await roles.getMemberPermissions(CAMP, REN);
    expectEveryReadActive(1);
  });

  it("'my camps' in the nav and home", async () => {
    await groups.listMyCamps(REN);
    expectEveryReadActive(1);
  });

  it("the camp page's member list, and the viewer's role derived from it", async () => {
    dbMock.queue(
      [
        {
          id: CAMP,
          kind: THEME_CAMP,
          name: "Mad Hatters",
          slug: "mad-hatters",
          description: null,
          joinability: "invite",
          createdByUserId: ALICE,
        },
      ],
      /* registration */ [],
    );
    await groups.getCampBySlug("mad-hatters", EDITION, REN);
    expectEveryReadActive(1);
  });

  it("the directory: free-camp visibility and member counts", async () => {
    dbMock.queue(
      [
        {
          id: CAMP,
          kind: THEME_CAMP,
          name: "Mad Hatters",
          nameNormalized: "mad hatters",
          slug: "mad-hatters",
        },
      ],
      /* registrations */ [],
    );
    await groups.listDirectory({ editionId: EDITION, viewerId: REN });
    // The viewer's memberships AND the member counts.
    expectEveryReadActive(2);
  });

  it("the public profile's camp list", async () => {
    dbMock.queue(/* user */ [{ id: REN, username: "ren", sanitizedAt: null }]);
    await groups.getPublicBurnerProfile(REN, EDITION);
    expectEveryReadActive(1);
  });

  it("camp-mate reach (profiles, photos, messaging)", async () => {
    await campmates.loadCampmateMemberships([ALICE, REN]);
    expectEveryReadActive(1);
  });

  it("the safety audience for medical notes", async () => {
    await medical.resolveMedicalNotesForViewer({
      viewerUserId: ALICE,
      subjectUserId: REN,
      editionId: EDITION,
    });
    expectEveryReadActive(1);
  });

  it("role holders (questionnaire and announcement audiences) and role chips", async () => {
    await roles.membershipIdsWithRoles(CAMP, ["r-1"]);
    await roles.getRoleAssignments(CAMP);
    expectEveryReadActive(2);
  });

  it("a camp announcement's full-screen gate", async () => {
    await gate.firstUnacknowledgedAnnouncement(REN);
    const [q] = dbMock.queries;
    expect(nullChecksOn(q!, schema.memberships.archivedAt)).toEqual([
      "is null",
    ]);
  });
});

describe("the reads that deliberately see former members", () => {
  it("the former roster reads ARCHIVED role assignments, not current ones", async () => {
    await roles.getRoleAssignments(CAMP, "former");
    const [q] = membershipReads();
    expect(nullChecksOn(q!, schema.memberships.archivedAt)).toEqual([
      "is not null",
    ]);
  });

  it("ref-code allocation counts former members' codes (a restore keeps theirs)", async () => {
    dbMock.queue([{ refCode: "MAH-M001" }]);
    expect(await groups.nextMemberRefCode(CAMP, "Mad Hatters")).toBe(
      "MAH-M002",
    );
    const [q] = membershipReads();
    expect(nullChecksOn(q!, schema.memberships.archivedAt)).toEqual([]);
  });
});
