import { describe, it, expect, beforeEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { GroupKind } from "@quagga/types";
import { boundStrings, dbMock, nullChecksOn } from "@/test/db-mock";
import { resetNextMocks } from "@/test/next-mocks";

// Camp shift ACTIONS (epic #57) — the boundary. What this pins is review M4:
// a request naming a real camp the caller is NOT in gets exactly the answer a
// slug that does not exist gets, so the shift actions are no oracle for a free
// camp's existence. The store's own refusals are pinned in shifts-store.test.

vi.mock("@/lib/db", async () =>
  (await import("@/test/db-mock")).dbModuleMock(),
);
vi.mock("next/cache", async () =>
  (await import("@/test/next-mocks")).nextCacheMock(),
);

const USER = "aaaaaaaa-0000-4000-8000-000000000009";
const CAMP = "11111111-0000-4000-8000-00000000000a";
const SHIFT = "55555555-0000-4000-8000-000000000001";
const MEMBERSHIP = "22222222-0000-4000-8000-000000000003";

const stubs = vi.hoisted(() => ({ calls: [] as unknown[] }));

vi.mock("@/lib/session", () => ({
  requireCampUser: async () => ({ id: USER, email: "stranger@example.com" }),
}));
vi.mock("@/lib/edition", () => ({
  getActiveEdition: async () => ({
    id: "ed-2027",
    year: 2027,
    startDate: "2027-04-26",
    endDate: "2027-05-02",
  }),
}));
vi.mock("@/lib/shifts-store", () => {
  const ok = async (input: unknown) => {
    stubs.calls.push(input);
    return { ok: true };
  };
  return {
    addShiftTeam: ok,
    assignToShift: ok,
    createShifts: ok,
    deleteShift: ok,
    handShiftTo: ok,
    leaveShift: ok,
    offerShift: ok,
    removeShiftTeam: ok,
    renameShiftTeam: ok,
    respondToHandOn: ok,
    signUpForShift: ok,
    takeOfferedShift: ok,
    unassignFromShift: ok,
    updateShift: ok,
    withdrawHandOn: ok,
  };
});

const actions = await import("@/app/(app)/camps/[slug]/shifts/actions");

const THEME_CAMP = GroupKind.enum.theme_camp;
const ORG = GroupKind.enum.org;
const REF = { slug: "dust-bunnies", shiftId: SHIFT };

beforeEach(() => {
  dbMock.reset();
  resetNextMocks();
  stubs.calls = [];
});

describe("shift actions — one answer for every camp you are not in (M4)", () => {
  it("a slug that does not exist: Camp not found.", async () => {
    dbMock.queue(/* no group */ []);
    expect(await actions.signUpForShiftAction(REF)).toEqual({
      ok: false,
      error: "Camp not found.",
    });
    expect(stubs.calls).toHaveLength(0);
  });

  it("a REAL camp the caller is not in: the identical answer, and the store is never asked", async () => {
    dbMock.queue([{ id: CAMP, kind: THEME_CAMP }], /* no membership */ []);
    expect(await actions.signUpForShiftAction(REF)).toEqual({
      ok: false,
      error: "Camp not found.",
    });
    expect(stubs.calls).toHaveLength(0);
    // The membership read is THIS caller's, in THIS camp, active only — a
    // former member gets the stranger's answer too.
    const read = dbMock.queriesTouching(schema.memberships)[0]!;
    expect(boundStrings(read)).toEqual(expect.arrayContaining([CAMP, USER]));
    expect(nullChecksOn(read, schema.memberships.archivedAt)).toEqual([
      "is null",
    ]);
  });

  it("the same for a lead-only action (assign), not just a member one", async () => {
    dbMock.queue([{ id: CAMP, kind: THEME_CAMP }], []);
    expect(
      await actions.assignToShiftAction({ ...REF, membershipId: MEMBERSHIP }),
    ).toEqual({ ok: false, error: "Camp not found." });
    expect(stubs.calls).toHaveLength(0);
  });

  it("the org group is never a camp here", async () => {
    dbMock.queue([{ id: CAMP, kind: ORG }]);
    expect(await actions.signUpForShiftAction(REF)).toEqual({
      ok: false,
      error: "Camp not found.",
    });
    expect(stubs.calls).toHaveLength(0);
  });

  it("a current member reaches the store, for THIS camp", async () => {
    dbMock.queue([{ id: CAMP, kind: THEME_CAMP }], [{ id: MEMBERSHIP }]);
    expect(await actions.signUpForShiftAction(REF)).toEqual({ ok: true });
    expect(stubs.calls).toEqual([
      expect.objectContaining({ userId: USER, groupId: CAMP, shiftId: SHIFT }),
    ]);
  });
});
