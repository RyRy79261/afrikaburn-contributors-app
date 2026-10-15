import { beforeEach, describe, expect, it, vi } from "vitest";
import { meetingRefusalMessage } from "@quagga/core";
import { resetNextMocks, revalidated } from "@/test/next-mocks";

// Camp meeting ACTIONS — the thin boundary (docs/camp-meetings-spec.md). What
// this pins:
//   · the store is called with the SESSION's user and the SERVER's active
//     edition, never anything from the request beyond the raw input;
//   · a notes save that lost the race comes back as a conflict, so the
//     autosave controller stops and offers a reload instead of retrying;
//   · notes saves never revalidate (the editor would be re-rendered under
//     the writer on every keystroke pause); the other writes do.
// Who may write what is pinned in camp-meetings-store.test.ts and core.

vi.mock("next/cache", async () =>
  (await import("@/test/next-mocks")).nextCacheMock(),
);

const USER = "aaaaaaaa-0000-4000-8000-000000000009";
const EDITION = "eeeeeeee-0000-4000-8000-000000000000";
const MEETING = "33333333-0000-4000-8000-000000000001";

const stubs = vi.hoisted(() => ({
  edition: true,
  calls: [] as { fn: string; userId: string; edition: unknown }[],
  notesResult: { ok: true, version: 3 } as
    { ok: true; version: number } | { ok: false; error: string },
}));

vi.mock("@/lib/session", () => ({
  requireCampUser: async () => ({ id: USER, email: "jabu@example.com" }),
}));
vi.mock("@/lib/edition", () => ({
  getActiveEdition: async () =>
    stubs.edition
      ? {
          id: EDITION,
          name: "AfrikaBurn 2027",
          year: 2027,
          startDate: "2027-04-26",
          endDate: "2027-05-02",
          isActive: true,
        }
      : null,
}));
vi.mock("@/lib/camp-meetings-store", () => {
  const record =
    (fn: string, result: Record<string, unknown>) =>
    async (userId: string, edition: unknown) => {
      stubs.calls.push({ fn, userId, edition });
      return result;
    };
  return {
    createCampMeeting: record("create", { ok: true, id: MEETING, version: 1 }),
    updateCampMeeting: record("update", { ok: true, version: 2 }),
    cancelCampMeeting: record("cancel", { ok: true, version: 2 }),
    setCampMeetingAttendance: record("attendance", { ok: true }),
    saveCampMeetingNotes: async (userId: string, edition: unknown) => {
      stubs.calls.push({ fn: "notes", userId, edition });
      return stubs.notesResult;
    },
  };
});

const actions = await import("@/app/(app)/camps/[slug]/meetings/actions");

const EDITION_ARG = {
  id: EDITION,
  startDate: "2027-04-26",
  endDate: "2027-05-02",
};

beforeEach(() => {
  resetNextMocks();
  stubs.calls = [];
  stubs.edition = true;
  stubs.notesResult = { ok: true, version: 3 };
});

describe("meeting actions", () => {
  it("passes the session user and the active edition to the store", async () => {
    const r = await actions.createMeetingAction({ slug: "mad-hatters" });
    expect(r).toEqual({ ok: true, id: MEETING });
    expect(stubs.calls).toEqual([
      { fn: "create", userId: USER, edition: EDITION_ARG },
    ]);
    expect(revalidated.map((r) => r.path)).toContain(
      `/camps/mad-hatters/meetings/${MEETING}`,
    );
  });

  it("refuses every write without an active edition, store untouched", async () => {
    stubs.edition = false;
    for (const call of [
      actions.createMeetingAction,
      actions.updateMeetingAction,
      actions.cancelMeetingAction,
      actions.saveMeetingNotesAction,
      actions.setMeetingAttendanceAction,
    ]) {
      expect(await call({ slug: "mad-hatters" })).toEqual({
        ok: false,
        error: "No active edition is configured.",
      });
    }
    expect(stubs.calls).toEqual([]);
  });

  it("turns a stale notes save into a conflict", async () => {
    stubs.notesResult = { ok: false, error: meetingRefusalMessage("stale") };
    const r = await actions.saveMeetingNotesAction({ slug: "mad-hatters" });
    expect(r).toEqual({
      ok: false,
      error: meetingRefusalMessage("stale"),
      conflict: { byName: null, at: null },
    });
  });

  it("passes any other notes refusal through without a conflict", async () => {
    const error = meetingRefusalMessage("not_note_taker");
    stubs.notesResult = { ok: false, error };
    expect(
      await actions.saveMeetingNotesAction({ slug: "mad-hatters" }),
    ).toEqual({ ok: false, error });
  });

  it("does not revalidate on a notes save; does on cancel", async () => {
    expect(
      await actions.saveMeetingNotesAction({
        slug: "mad-hatters",
        id: MEETING,
      }),
    ).toEqual({ ok: true, version: 3 });
    expect(revalidated).toEqual([]);
    await actions.cancelMeetingAction({ slug: "mad-hatters", id: MEETING });
    expect(revalidated.map((r) => r.path)).toEqual(
      expect.arrayContaining([
        "/camps/mad-hatters",
        "/camps/mad-hatters/meetings",
        "/camps/mad-hatters/calendar",
        `/camps/mad-hatters/meetings/${MEETING}`,
      ]),
    );
  });
});
