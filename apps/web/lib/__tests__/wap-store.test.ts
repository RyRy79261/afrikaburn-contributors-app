import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@quagga/db";
import {
  MembershipRole,
  RegistrationStatus,
  WapListStatus,
  WapRequestStatus,
} from "@quagga/types";
import { wapRefusalMessage } from "@quagga/core";
import { boundStrings, dbMock } from "@/test/db-mock";

// Work Access Passes, the project side (epic #53) — the store's decisions.
// What these pin: who is refused, that a refusal writes nothing, that the cap
// and the list status are read UNDER the registration's `FOR UPDATE` lock
// inside one transaction, that an edit knocks an approved list back to draft,
// and that "Also has a pass from {project}" is only ever computed for people
// on THIS list. The db mock cannot see a WHERE clause beyond `boundStrings`;
// the persona suite drives the real SQL.

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

const {
  allocateWorkAccessPass,
  getOwnWapPass,
  loadWapPage,
  removeWorkAccessPass,
  requestWorkAccessPasses,
  submitWorkAccessPassList,
  updateWorkAccessPass,
} = await import("../wap-store");

// Values from the real vocabularies (AGENTS.md "Verification"). Ids fictional.
const LEAD = MembershipRole.enum.lead;
const ADMIN = MembershipRole.enum.admin;
const MEMBER = MembershipRole.enum.member;
const DRAFT = WapListStatus.enum.draft;
const SUBMITTED = WapListStatus.enum.submitted;
const APPROVED = WapListStatus.enum.approved;
const RETURNED = WapListStatus.enum.returned;
const PENDING = WapRequestStatus.enum.pending;
const GRANTED = WapRequestStatus.enum.granted;
const DECLINED = WapRequestStatus.enum.declined;
const REG_SUBMITTED = RegistrationStatus.enum.submitted;

const CAMP = "11111111-0000-4000-8000-00000000000a";
const EDITION = "eeeeeeee-0000-4000-8000-000000000001";
const REG = "77777777-0000-4000-8000-000000000001";
const OTHER_REG = "77777777-0000-4000-8000-000000000002";
const ALLOC = "99999999-0000-4000-8000-000000000001";

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001"; // lead
const JABU = "aaaaaaaa-0000-4000-8000-000000000002"; // member
const REN = "aaaaaaaa-0000-4000-8000-000000000003"; // member, not on list
const M_ALICE = "22222222-0000-4000-8000-000000000001";
const M_JABU = "22222222-0000-4000-8000-000000000002";
const M_REN = "22222222-0000-4000-8000-000000000003";

const EDITION_DATES = {
  id: EDITION,
  startDate: "2027-04-26",
  endDate: "2027-05-02",
};

const member = (
  userId: string,
  membershipId: string,
  role: MembershipRole,
) => ({
  membershipId,
  userId,
  role,
  groupId: CAMP,
  archivedAt: null,
});
const alice = member(ALICE, M_ALICE, LEAD);
const jabu = member(JABU, M_JABU, MEMBER);

const reg = (overrides: Record<string, unknown> = {}) => ({
  id: REG,
  status: REG_SUBMITTED,
  firstArrival: "2027-04-20",
  listStatus: DRAFT,
  submittedAt: null,
  submittedByUserId: null,
  reviewedAt: null,
  returnNote: null,
  approvedAt: null,
  approvedSnapshot: null,
  ...overrides,
});

const granted = (n: number) => ({ status: GRANTED, granted: n });

function registrationLock() {
  return dbMock
    .queriesTouching(schema.registrations)
    .find((q) => q.kind === "select" && q.called("for"));
}

beforeEach(() => {
  dbMock.reset();
});

describe("allocateWorkAccessPass — the cap, under the lock", () => {
  const input = {
    actorUserId: ALICE,
    groupId: CAMP,
    editionId: EDITION,
    membershipId: M_JABU,
  };

  it("puts a current member on the list, inside one transaction behind FOR UPDATE", async () => {
    dbMock.queue(
      [alice, jabu],
      [reg()],
      [granted(3)],
      [{ n: 2 }],
      /* not already on it */ [],
      [{ id: ALLOC }],
    );
    expect(await allocateWorkAccessPass(input)).toEqual({ ok: true });
    expect(dbMock.transactions).toBe(1);
    const lock = registrationLock();
    expect(lock?.arg("for")).toBe("update");
    expect(lock?.tx).toBe(true);
    const [insert] = dbMock.writesTo(schema.wapAllocations);
    expect(insert!.tx).toBe(true);
    expect(insert!.arg("values")).toMatchObject({
      registrationId: REG,
      membershipId: M_JABU,
      allocatedByUserId: ALICE,
    });
    // A draft stays a draft: no status write.
    expect(dbMock.writesTo(schema.registrations)).toHaveLength(0);
  });

  it("REFUSES the pass past the total granted — counts read under the lock", async () => {
    dbMock.queue([alice, jabu], [reg()], [granted(2)], [{ n: 2 }], []);
    expect(await allocateWorkAccessPass(input)).toEqual({
      ok: false,
      error: wapRefusalMessage("cap_reached"),
    });
    expect(dbMock.writesTo(schema.wapAllocations)).toHaveLength(0);
  });

  it("counts only GRANTED asks toward the cap (pending and declined count nothing)", async () => {
    dbMock.queue(
      [alice, jabu],
      [reg()],
      [
        granted(1),
        { status: PENDING, granted: null },
        { status: DECLINED, granted: null },
      ],
      [{ n: 1 }],
      [],
    );
    expect(await allocateWorkAccessPass(input)).toEqual({
      ok: false,
      error: wapRefusalMessage("cap_reached"),
    });
  });

  it("REFUSES someone who is not a current member of THIS project", async () => {
    // The membership lock is scoped to the project and to active members: a
    // member of another camp, or one archived a moment ago, comes back absent.
    dbMock.queue([alice], [reg()], [granted(5)], [{ n: 0 }], []);
    expect(await allocateWorkAccessPass(input)).toEqual({
      ok: false,
      error: wapRefusalMessage("not_member"),
    });
    expect(dbMock.writesTo(schema.wapAllocations)).toHaveLength(0);
  });

  it("REFUSES a plain member before the registration is even locked", async () => {
    dbMock.queue([member(ALICE, M_ALICE, MEMBER), jabu]);
    expect(await allocateWorkAccessPass(input)).toEqual({
      ok: false,
      error: wapRefusalMessage("not_manager"),
    });
    expect(registrationLock()).toBeUndefined();
    expect(dbMock.writesTo(schema.wapAllocations)).toHaveLength(0);
  });

  it("lets a co-lead manage passes too", async () => {
    dbMock.queue(
      [member(ALICE, M_ALICE, ADMIN), jabu],
      [reg()],
      [granted(3)],
      [{ n: 0 }],
      [],
      [{ id: ALLOC }],
    );
    expect(await allocateWorkAccessPass(input)).toEqual({ ok: true });
  });

  it("REFUSES while the list is with AfrikaBurn", async () => {
    dbMock.queue(
      [alice, jabu],
      [reg({ listStatus: SUBMITTED })],
      [granted(5)],
      [{ n: 0 }],
      [],
    );
    expect(await allocateWorkAccessPass(input)).toEqual({
      ok: false,
      error: wapRefusalMessage("list_locked"),
    });
  });

  it("moves an APPROVED list back to draft when a name is added", async () => {
    dbMock.queue(
      [alice, jabu],
      [reg({ listStatus: APPROVED })],
      [granted(5)],
      [{ n: 1 }],
      [],
      [{ id: ALLOC }],
    );
    expect(await allocateWorkAccessPass(input)).toEqual({ ok: true });
    const [statusWrite] = dbMock.writesTo(schema.registrations);
    expect(statusWrite!.tx).toBe(true);
    expect(statusWrite!.arg("set")).toMatchObject({ wapListStatus: DRAFT });
  });

  it("keeps a RETURNED list returned while the lead edits it", async () => {
    dbMock.queue(
      [alice, jabu],
      [reg({ listStatus: RETURNED })],
      [granted(5)],
      [{ n: 1 }],
      [],
      [{ id: ALLOC }],
    );
    expect(await allocateWorkAccessPass(input)).toEqual({ ok: true });
    expect(dbMock.writesTo(schema.registrations)).toHaveLength(0);
  });
});

describe("removeWorkAccessPass", () => {
  const input = {
    actorUserId: ALICE,
    groupId: CAMP,
    editionId: EDITION,
    allocationId: ALLOC,
  };
  const allocation = {
    id: ALLOC,
    membershipId: M_JABU,
    arrivalDate: null,
    departureDate: null,
    build: null,
    strike: null,
  };

  it("deletes THIS registration's pass and moves an approved list to draft", async () => {
    dbMock.queue([alice], [reg({ listStatus: APPROVED })], [allocation]);
    expect(await removeWorkAccessPass(input)).toEqual({ ok: true });
    const [del] = dbMock
      .writesTo(schema.wapAllocations)
      .filter((q) => q.kind === "delete");
    expect(boundStrings(del!)).toEqual(expect.arrayContaining([ALLOC, REG]));
    expect(dbMock.writesTo(schema.registrations)[0]!.arg("set")).toMatchObject({
      wapListStatus: DRAFT,
    });
  });

  it("answers an allocation of another project like one that does not exist", async () => {
    dbMock.queue([alice], [reg()], /* not on THIS registration */ []);
    expect(await removeWorkAccessPass(input)).toEqual({
      ok: false,
      error: wapRefusalMessage("not_on_list"),
    });
    expect(dbMock.writesTo(schema.wapAllocations)).toHaveLength(0);
  });
});

describe("updateWorkAccessPass — the lead's overrides", () => {
  const allocation = (o: Record<string, unknown> = {}) => ({
    id: ALLOC,
    membershipId: M_JABU,
    arrivalDate: null,
    departureDate: null,
    build: null,
    strike: null,
    ...o,
  });
  const plan = {
    joiningBuild: true,
    joiningStrike: false,
    arrivalDate: "2027-04-22",
    departureDate: "2027-05-03",
  };
  const input = (o: Record<string, unknown> = {}) => ({
    actorUserId: ALICE,
    groupId: CAMP,
    edition: EDITION_DATES,
    allocationId: ALLOC,
    overrides: {
      arrivalDate: null,
      departureDate: null,
      build: null,
      strike: null,
      ...o,
    },
  });

  it("stores an override equal to the roster plan as 'follow the plan' (null)", async () => {
    dbMock.queue([alice], [reg()], [allocation({ build: false })], [plan]);
    expect(
      await updateWorkAccessPass(
        input({ arrivalDate: "2027-04-23", build: true }),
      ),
    ).toEqual({ ok: true });
    const [write] = dbMock.writesTo(schema.wapAllocations);
    expect(write!.arg("set")).toMatchObject({
      arrivalDate: "2027-04-23",
      // build = true is what Jabu's own plan says → not an edit.
      build: null,
    });
  });

  it("writes NOTHING when the save changes nothing — an approved list stays approved", async () => {
    dbMock.queue(
      [alice],
      [reg({ listStatus: APPROVED })],
      [allocation({ arrivalDate: "2027-04-23" })],
      [plan],
    );
    expect(
      await updateWorkAccessPass(input({ arrivalDate: "2027-04-23" })),
    ).toEqual({ ok: true });
    expect(dbMock.writesTo(schema.wapAllocations)).toHaveLength(0);
    expect(dbMock.writesTo(schema.registrations)).toHaveLength(0);
  });

  it("REFUSES an arrival after the roster departure", async () => {
    dbMock.queue([alice], [reg()], [allocation()], [plan]);
    expect(
      await updateWorkAccessPass(input({ arrivalDate: "2027-05-04" })),
    ).toEqual({
      ok: false,
      error: wapRefusalMessage("arrival_after_departure"),
    });
    expect(dbMock.writesTo(schema.wapAllocations)).toHaveLength(0);
  });

  it("REFUSES a date far outside the edition", async () => {
    dbMock.queue([alice], [reg()], [allocation()], [plan]);
    expect(
      await updateWorkAccessPass(input({ arrivalDate: "2026-04-23" })),
    ).toEqual({ ok: false, error: wapRefusalMessage("dates_out_of_window") });
  });
});

describe("submitWorkAccessPassList", () => {
  const input = { actorUserId: ALICE, groupId: CAMP, editionId: EDITION };
  const NOW = new Date("2027-03-20T10:00:00Z");

  it("sends the list, stamps who and when, and clears the org's old note", async () => {
    dbMock.queue(
      [alice],
      [reg({ listStatus: RETURNED, returnNote: "Swap someone out." })],
      [granted(3)],
      [{ n: 3 }],
    );
    expect(await submitWorkAccessPassList({ ...input, now: NOW })).toEqual({
      ok: true,
    });
    const [write] = dbMock.writesTo(schema.registrations);
    expect(write!.tx).toBe(true);
    expect(write!.arg("set")).toMatchObject({
      wapListStatus: SUBMITTED,
      wapListSubmittedAt: NOW,
      wapListSubmittedByUserId: ALICE,
      wapListReturnNote: null,
    });
    expect(registrationLock()?.arg("for")).toBe("update");
  });

  it("REFUSES an empty list", async () => {
    dbMock.queue([alice], [reg()], [granted(3)], [{ n: 0 }]);
    expect(await submitWorkAccessPassList(input)).toEqual({
      ok: false,
      error: wapRefusalMessage("list_empty"),
    });
    expect(dbMock.writesTo(schema.registrations)).toHaveLength(0);
  });

  it("REFUSES a list already with AfrikaBurn", async () => {
    dbMock.queue(
      [alice],
      [reg({ listStatus: SUBMITTED })],
      [granted(3)],
      [{ n: 2 }],
    );
    expect(await submitWorkAccessPassList(input)).toEqual({
      ok: false,
      error: wapRefusalMessage("list_locked"),
    });
  });
});

describe("requestWorkAccessPasses — the window and the one pending ask", () => {
  const NOW = new Date("2027-03-01T10:00:00Z");
  const open = {
    wapRequestsOpenAt: new Date("2027-02-01T00:00:00Z"),
    wapRequestsCloseAt: null,
  };
  const input = {
    actorUserId: ALICE,
    groupId: CAMP,
    editionId: EDITION,
    requested: 4,
    reason: "Our build crew grew.",
    now: NOW,
  };

  it("records the ask while requests are open", async () => {
    dbMock.queue(
      [alice],
      [reg()],
      [open],
      [{ status: GRANTED }],
      [{ id: "r" }],
    );
    expect(await requestWorkAccessPasses(input)).toEqual({ ok: true });
    expect(dbMock.writesTo(schema.wapRequests)[0]!.arg("values")).toEqual({
      registrationId: REG,
      requested: 4,
      reason: "Our build crew grew.",
      requestedByUserId: ALICE,
    });
  });

  it("REFUSES before the org opens requests", async () => {
    dbMock.queue(
      [alice],
      [reg()],
      [{ wapRequestsOpenAt: null, wapRequestsCloseAt: null }],
      [],
    );
    expect(await requestWorkAccessPasses(input)).toEqual({
      ok: false,
      error: wapRefusalMessage("window_closed"),
    });
    expect(dbMock.writesTo(schema.wapRequests)).toHaveLength(0);
  });

  it("REFUSES a second ask while one is waiting", async () => {
    dbMock.queue([alice], [reg()], [open], [{ status: PENDING }]);
    expect(await requestWorkAccessPasses(input)).toEqual({
      ok: false,
      error: wapRefusalMessage("pending_exists"),
    });
  });

  it("REFUSES a project with no registration this edition", async () => {
    dbMock.queue([alice], []);
    const result = await requestWorkAccessPasses(input);
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.wapRequests)).toHaveLength(0);
  });
});

describe("loadWapPage — the flags", () => {
  const member = (
    userId: string,
    membershipId: string,
    username: string,
    bioCompletedAt: Date | null,
  ) => ({
    membershipId,
    userId,
    role: MEMBER,
    username,
    sanitizedAt: null,
    bioCompletedAt,
    logisticsId: null,
    joiningBuild: null,
    joiningStrike: null,
    arrivalDate: null,
    departureDate: null,
  });

  it("refuses to load for anyone who does not manage the project", async () => {
    await expect(
      loadWapPage({ groupId: CAMP, editionId: EDITION, mayManage: false }),
    ).rejects.toThrow();
    expect(dbMock.queries).toHaveLength(0);
  });

  it("names another project only next to a person ON THIS LIST", async () => {
    const done = new Date("2027-01-01T00:00:00Z");
    dbMock.queue(
      /* window */ [{ wapRequestsOpenAt: null, wapRequestsCloseAt: null }],
      /* registration */ [reg()],
      /* members */ [
        member(JABU, M_JABU, "jabu", null),
        member(REN, M_REN, "ren", done),
      ],
      /* requests */ [
        {
          id: "r1",
          requested: 5,
          reason: null,
          status: GRANTED,
          granted: 5,
          createdAt: done,
          decidedAt: done,
          username: "alice",
          sanitizedAt: null,
          requestedBy: ALICE,
        },
      ],
      /* allocations: only Jabu */ [
        {
          id: ALLOC,
          membershipId: M_JABU,
          arrivalDate: null,
          departureDate: null,
          build: null,
          strike: null,
        },
      ],
      /* unfinished onboarding */ [{ userId: JABU }],
      /* other holdings — Ren's would be a leak if it surfaced */ [
        {
          userId: JABU,
          registrationId: OTHER_REG,
          projectName: "Dust Bunnies",
        },
        { userId: REN, registrationId: OTHER_REG, projectName: "Dust Bunnies" },
        { userId: JABU, registrationId: REG, projectName: "This camp" },
      ],
    );
    const page = await loadWapPage({
      groupId: CAMP,
      editionId: EDITION,
      mayManage: true,
    });
    expect(page.passes).toHaveLength(1);
    expect(page.passes[0]!.flags).toEqual([
      { kind: "bio_incomplete" },
      { kind: "onboarding_unfinished" },
      { kind: "other_project", projectName: "Dust Bunnies" },
    ]);
    // Ren is a candidate, and nothing about Ren's other pass is anywhere.
    expect(page.candidates).toEqual([
      { membershipId: M_REN, displayName: "ren" },
    ]);
    expect(JSON.stringify(page)).not.toContain(REN);
    // The arrival falls back to the registration's first arrival.
    expect(page.passes[0]!.effective.arrivalDate).toBe("2027-04-20");
    expect(page.totalGranted).toBe(5);
  });
});

describe("getOwnWapPass", () => {
  it("reports the viewer's own place on the list", async () => {
    dbMock.queue([{ listStatus: APPROVED, allocationId: ALLOC }]);
    expect(
      await getOwnWapPass({ groupId: CAMP, editionId: EDITION, userId: JABU }),
    ).toEqual({ onList: true, listStatus: APPROVED });
    expect(boundStrings(dbMock.queries[0]!)).toContain(JABU);
  });

  it("is not on the list when there is no pass row", async () => {
    dbMock.queue([{ listStatus: SUBMITTED, allocationId: null }]);
    expect(
      await getOwnWapPass({ groupId: CAMP, editionId: EDITION, userId: JABU }),
    ).toEqual({ onList: false, listStatus: SUBMITTED });
  });
});
