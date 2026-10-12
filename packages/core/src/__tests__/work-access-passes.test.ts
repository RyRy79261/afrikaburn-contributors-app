import { describe, expect, it } from "vitest";
import {
  MembershipRole,
  NotificationKind,
  RegistrationStatus,
  WapListStatus,
  type WapApprovedPass,
} from "@quagga/types";
import {
  ALWAYS_PRIVATE_FIELDS,
  HARD_LOCKED_PRIVATE_FIELDS,
  SAFETY_VISIBLE_FIELDS,
  buildWapCsv,
  canManageWorkAccessPasses,
  decideWapAllocate,
  decideWapApprove,
  decideWapDecline,
  decideWapEdit,
  decideWapGrant,
  decideWapRequest,
  decideWapReturn,
  decideWapSubmit,
  effectiveWapPass,
  emptyMemberLogistics,
  filterWapOverview,
  isWapEligibleMember,
  isWapListEditable,
  isWapPassIncomplete,
  isWapRequestWindowOpen,
  legacyWapAsk,
  normalizeWapOverrides,
  notificationMentionsAny,
  pendingWapRequest,
  shouldSendImmediateEmail,
  summariseWapProject,
  totalWapGranted,
  totalWapRequested,
  validateWapOverrides,
  WAP_EXPORT_COLUMNS,
  wapAllocatedLabel,
  wapApprovedPass,
  wapChangeLabel,
  wapChangesSinceApproval,
  wapCsvFilename,
  wapDuplicateHolders,
  wapDuplicateNote,
  wapExportRow,
  wapFlagLabel,
  wapListApprovedNotification,
  wapListReturnedNotification,
  wapListStatusAfterEdit,
  wapOverviewTotals,
  wapOwnPassLine,
  wapPassApprovedNotification,
  wapPassesLeftLabel,
  wapPassesPath,
  wapPassFlags,
  wapRefusalMessage,
  wapRequestDeclinedNotification,
  wapRequestGrantedNotification,
  wapRequestsOpenNotification,
  wapRequestWindowState,
  wapSinceApprovalBadge,
  wapWindowPatch,
  type MemberLogistics,
  type WapCurrentPass,
  type WapExportInput,
  type WapNoticeContext,
  type WapPassOverrides,
  type WapProjectSummary,
  type WapRefusal,
} from "../index";

const d = (iso: string) => new Date(iso);
const NOW = d("2027-03-10T12:00:00Z");
const NONE: WapPassOverrides = {
  arrivalDate: null,
  departureDate: null,
  build: null,
  strike: null,
};
const PLAN: MemberLogistics = {
  joiningBuild: true,
  joiningStrike: false,
  arrivalDate: "2027-04-22",
  departureDate: "2027-05-03",
};
const EDITION = { startDate: "2027-04-26", endDate: "2027-05-02" };

// --- Authority -----------------------------------------------------------

describe("canManageWorkAccessPasses", () => {
  it("is the structural lead and co-leads only", () => {
    for (const role of MembershipRole.options) {
      expect(canManageWorkAccessPasses({ structuralRole: role })).toBe(
        role === "lead" || role === "admin",
      );
    }
  });

  it("refuses a non-member (null)", () => {
    expect(canManageWorkAccessPasses(null)).toBe(false);
  });
});

// --- The window ------------------------------------------------------------

describe("wapRequestWindowState", () => {
  it("is not opened until the org opens it", () => {
    expect(
      wapRequestWindowState(
        { wapRequestsOpenAt: null, wapRequestsCloseAt: null },
        NOW,
      ),
    ).toBe("not_opened");
    // Scheduled in the future: not open yet.
    expect(
      wapRequestWindowState(
        {
          wapRequestsOpenAt: d("2027-03-11T00:00:00Z"),
          wapRequestsCloseAt: null,
        },
        NOW,
      ),
    ).toBe("not_opened");
  });

  it("is open once opened and not closed", () => {
    const open = {
      wapRequestsOpenAt: d("2027-03-01T00:00:00Z"),
      wapRequestsCloseAt: null,
    };
    expect(wapRequestWindowState(open, NOW)).toBe("open");
    expect(isWapRequestWindowOpen(open, NOW)).toBe(true);
    // Opening at exactly now counts.
    expect(
      isWapRequestWindowOpen({ ...open, wapRequestsOpenAt: NOW }, NOW),
    ).toBe(true);
  });

  it("is closed after a close, and a future close is still open", () => {
    const opened = d("2027-03-01T00:00:00Z");
    expect(
      wapRequestWindowState(
        {
          wapRequestsOpenAt: opened,
          wapRequestsCloseAt: d("2027-03-05T00:00:00Z"),
        },
        NOW,
      ),
    ).toBe("closed");
    expect(
      wapRequestWindowState(
        { wapRequestsOpenAt: opened, wapRequestsCloseAt: NOW },
        NOW,
      ),
    ).toBe("closed");
    expect(
      wapRequestWindowState(
        {
          wapRequestsOpenAt: opened,
          wapRequestsCloseAt: d("2027-04-01T00:00:00Z"),
        },
        NOW,
      ),
    ).toBe("open");
  });

  it("a reopening after an old close is open (close then reopen)", () => {
    expect(
      wapRequestWindowState(
        {
          wapRequestsOpenAt: d("2027-03-08T00:00:00Z"),
          wapRequestsCloseAt: d("2027-03-05T00:00:00Z"),
        },
        NOW,
      ),
    ).toBe("open");
  });

  it("the org's buttons write states that read back correctly", () => {
    const opened = {
      wapRequestsOpenAt: null,
      wapRequestsCloseAt: null,
      ...wapWindowPatch("open", d("2027-03-01T00:00:00Z")),
    };
    expect(wapRequestWindowState(opened, NOW)).toBe("open");
    const closed = {
      ...opened,
      ...wapWindowPatch("close", d("2027-03-05T00:00:00Z")),
    };
    expect(wapRequestWindowState(closed, NOW)).toBe("closed");
    const reopened = {
      ...closed,
      ...wapWindowPatch("open", d("2027-03-09T00:00:00Z")),
    };
    expect(reopened.wapRequestsCloseAt).toBeNull();
    expect(wapRequestWindowState(reopened, NOW)).toBe("open");
  });
});

// --- Requests -----------------------------------------------------------------

describe("requests and totals", () => {
  const requests = [
    { id: "a", requested: 10, status: "granted" as const, granted: 8 },
    { id: "b", requested: 4, status: "declined" as const, granted: null },
    { id: "c", requested: 3, status: "granted" as const, granted: 3 },
    { id: "d", requested: 5, status: "pending" as const, granted: null },
  ];

  it("total granted sums only granted rows", () => {
    expect(totalWapGranted(requests)).toBe(11);
    expect(totalWapGranted([])).toBe(0);
  });

  it("total requested counts every ask, pending included", () => {
    expect(totalWapRequested(requests)).toBe(22);
  });

  it("finds the pending request", () => {
    expect(pendingWapRequest(requests)?.id).toBe("d");
    expect(pendingWapRequest(requests.slice(0, 3))).toBeNull();
  });

  it("legacy registration-form ask shows only when non-empty", () => {
    expect(legacyWapAsk(12)).toBe(12);
    expect(legacyWapAsk(0)).toBeNull();
    expect(legacyWapAsk(null)).toBeNull();
  });
});

describe("decideWapRequest", () => {
  const ok = {
    mayManage: true,
    windowOpen: true,
    registrationStatus: "submitted" as const,
    requests: [],
  };

  it("allows a lead of a submitted project while open", () => {
    expect(decideWapRequest(ok)).toEqual({ ok: true });
  });

  it("refuses a non-manager first", () => {
    expect(
      decideWapRequest({ ...ok, mayManage: false, windowOpen: false }),
    ).toEqual({
      ok: false,
      reason: "not_manager",
    });
  });

  it("refuses when the window is not open", () => {
    expect(decideWapRequest({ ...ok, windowOpen: false })).toEqual({
      ok: false,
      reason: "window_closed",
    });
  });

  it("accepts every submitted-and-alive status and refuses the rest", () => {
    const allowed = [
      "submitted",
      "under_review",
      "changes_requested",
      "approved",
    ];
    for (const status of RegistrationStatus.options) {
      const r = decideWapRequest({ ...ok, registrationStatus: status });
      expect(r.ok).toBe(allowed.includes(status));
      if (!r.ok) expect(r.reason).toBe("not_submitted");
    }
  });

  it("refuses while another request is pending, allows after it is answered", () => {
    expect(
      decideWapRequest({ ...ok, requests: [{ status: "pending" }] }),
    ).toEqual({ ok: false, reason: "pending_exists" });
    expect(
      decideWapRequest({
        ...ok,
        requests: [{ status: "granted" }, { status: "declined" }],
      }),
    ).toEqual({ ok: true });
  });
});

describe("decideWapGrant / decideWapDecline", () => {
  const pending = { status: "pending" as const, requested: 4 };

  it("grants up to the number asked, fewer allowed", () => {
    expect(decideWapGrant(pending, 4)).toEqual({ ok: true });
    expect(decideWapGrant(pending, 1)).toEqual({ ok: true });
  });

  it("never more than asked", () => {
    expect(decideWapGrant(pending, 5)).toEqual({
      ok: false,
      reason: "grant_too_many",
    });
  });

  it("never zero, negative or fractional", () => {
    for (const n of [0, -1, 2.5, Number.NaN]) {
      expect(decideWapGrant(pending, n)).toEqual({
        ok: false,
        reason: "grant_too_few",
      });
    }
  });

  it("grants only go up — an answered request is never re-decided", () => {
    for (const status of ["granted", "declined"] as const) {
      expect(decideWapGrant({ status, requested: 4 }, 2)).toEqual({
        ok: false,
        reason: "not_pending",
      });
      expect(decideWapDecline({ status })).toEqual({
        ok: false,
        reason: "not_pending",
      });
    }
    expect(decideWapDecline(pending)).toEqual({ ok: true });
  });
});

// --- The list ------------------------------------------------------------------

describe("list editing by status", () => {
  it("draft, returned and approved are editable; submitted is locked", () => {
    for (const s of WapListStatus.options) {
      expect(isWapListEditable(s)).toBe(s !== "submitted");
    }
  });

  it("editing an approved list moves it back to draft", () => {
    expect(wapListStatusAfterEdit("approved")).toBe("draft");
    expect(wapListStatusAfterEdit("draft")).toBe("draft");
    expect(wapListStatusAfterEdit("returned")).toBe("returned");
  });

  it("a submitted list cannot be edited at all", () => {
    expect(() => wapListStatusAfterEdit("submitted")).toThrow(/locked/);
  });
});

describe("isWapEligibleMember", () => {
  it("is a current member of this project", () => {
    expect(isWapEligibleMember({ groupId: "g1", archivedAt: null }, "g1")).toBe(
      true,
    );
  });
  it("refuses a former (archived) member", () => {
    expect(isWapEligibleMember({ groupId: "g1", archivedAt: NOW }, "g1")).toBe(
      false,
    );
  });
  it("refuses a member of another project, and a non-member", () => {
    expect(isWapEligibleMember({ groupId: "g2", archivedAt: null }, "g1")).toBe(
      false,
    );
    expect(isWapEligibleMember(null, "g1")).toBe(false);
  });
});

describe("decideWapAllocate", () => {
  const ok = {
    mayManage: true,
    listStatus: "draft" as const,
    totalGranted: 10,
    allocatedCount: 7,
    memberEligible: true,
    alreadyOnList: false,
  };

  it("allows a lead under the cap", () => {
    expect(decideWapAllocate(ok)).toEqual({ ok: true });
    expect(decideWapAllocate({ ...ok, allocatedCount: 9 })).toEqual({
      ok: true,
    });
  });

  it("caps at the total granted (the 10th of 10 is the last)", () => {
    expect(decideWapAllocate({ ...ok, allocatedCount: 10 })).toEqual({
      ok: false,
      reason: "cap_reached",
    });
    expect(decideWapAllocate({ ...ok, allocatedCount: 11 })).toEqual({
      ok: false,
      reason: "cap_reached",
    });
  });

  it("needs a granted number at all", () => {
    expect(
      decideWapAllocate({ ...ok, totalGranted: 0, allocatedCount: 0 }),
    ).toEqual({
      ok: false,
      reason: "no_grant",
    });
  });

  it("refuses a non-manager, a locked list, a former member, a duplicate", () => {
    const cases: [Partial<typeof ok>, WapRefusal][] = [
      [{ mayManage: false }, "not_manager"],
      [{ listStatus: "submitted" as never }, "list_locked"],
      [{ memberEligible: false }, "not_member"],
      [{ alreadyOnList: true }, "already_on_list"],
    ];
    for (const [patch, reason] of cases) {
      expect(decideWapAllocate({ ...ok, ...patch })).toEqual({
        ok: false,
        reason,
      });
    }
  });

  it("allows adding to an approved or returned list", () => {
    expect(
      decideWapAllocate({ ...ok, listStatus: "approved" as never }),
    ).toEqual({ ok: true });
    expect(
      decideWapAllocate({ ...ok, listStatus: "returned" as never }),
    ).toEqual({ ok: true });
  });
});

describe("decideWapEdit", () => {
  it("allows a lead to edit a pass on an editable list", () => {
    expect(
      decideWapEdit({ mayManage: true, listStatus: "draft", onList: true }),
    ).toEqual({ ok: true });
  });
  it("refuses a non-manager, a submitted list, a pass not on the list", () => {
    expect(
      decideWapEdit({ mayManage: false, listStatus: "draft", onList: true }),
    ).toEqual({ ok: false, reason: "not_manager" });
    expect(
      decideWapEdit({ mayManage: true, listStatus: "submitted", onList: true }),
    ).toEqual({ ok: false, reason: "list_locked" });
    expect(
      decideWapEdit({ mayManage: true, listStatus: "draft", onList: false }),
    ).toEqual({ ok: false, reason: "not_on_list" });
  });
});

describe("decideWapSubmit", () => {
  const ok = {
    mayManage: true,
    listStatus: "draft" as const,
    totalGranted: 10,
    allocatedCount: 7,
  };

  it("submits a draft or returned list", () => {
    expect(decideWapSubmit(ok)).toEqual({ ok: true });
    expect(decideWapSubmit({ ...ok, listStatus: "returned" as never })).toEqual(
      { ok: true },
    );
  });

  it("refuses a submitted or (unedited) approved list", () => {
    for (const s of ["submitted", "approved"] as const) {
      expect(decideWapSubmit({ ...ok, listStatus: s as never })).toEqual({
        ok: false,
        reason: "list_locked",
      });
    }
  });

  it("refuses an empty list, an over-cap list, a non-manager", () => {
    expect(decideWapSubmit({ ...ok, allocatedCount: 0 })).toEqual({
      ok: false,
      reason: "list_empty",
    });
    expect(decideWapSubmit({ ...ok, allocatedCount: 11 })).toEqual({
      ok: false,
      reason: "over_cap",
    });
    expect(decideWapSubmit({ ...ok, mayManage: false })).toEqual({
      ok: false,
      reason: "not_manager",
    });
  });
});

describe("org review of the list", () => {
  it("approves only a submitted list", () => {
    for (const s of WapListStatus.options) {
      expect(decideWapApprove(s).ok).toBe(s === "submitted");
    }
  });

  it("returns only a submitted list, and only with a note", () => {
    expect(decideWapReturn("submitted", "Two bios are incomplete.")).toEqual({
      ok: true,
    });
    for (const note of [null, undefined, "", "   "]) {
      expect(decideWapReturn("submitted", note)).toEqual({
        ok: false,
        reason: "note_required",
      });
    }
    expect(decideWapReturn("draft", "x")).toEqual({
      ok: false,
      reason: "not_submitted_list",
    });
  });
});

describe("wapRefusalMessage", () => {
  it("has a sentence for every refusal", () => {
    const reasons: WapRefusal[] = [
      "not_manager",
      "window_closed",
      "not_submitted",
      "pending_exists",
      "not_pending",
      "grant_too_many",
      "grant_too_few",
      "no_grant",
      "cap_reached",
      "not_member",
      "already_on_list",
      "not_on_list",
      "list_locked",
      "list_empty",
      "over_cap",
      "not_submitted_list",
      "note_required",
      "dates_out_of_window",
      "arrival_after_departure",
    ];
    for (const r of reasons)
      expect(wapRefusalMessage(r).length).toBeGreaterThan(10);
  });
});

// --- Effective pass ---------------------------------------------------------

describe("effectiveWapPass", () => {
  it("uses the roster plan when nothing is overridden", () => {
    const p = effectiveWapPass(NONE, PLAN, "2027-04-20");
    expect(p).toMatchObject({
      arrivalDate: "2027-04-22",
      departureDate: "2027-05-03",
      build: true,
      strike: false,
      arrivalSource: "roster",
    });
    expect(Object.values(p.edited).some(Boolean)).toBe(false);
  });

  it("an override wins over the roster and is flagged edited", () => {
    const p = effectiveWapPass(
      { ...NONE, arrivalDate: "2027-04-23", strike: true },
      PLAN,
      "2027-04-20",
    );
    expect(p.arrivalDate).toBe("2027-04-23");
    expect(p.arrivalSource).toBe("pass");
    expect(p.strike).toBe(true);
    expect(p.edited).toEqual({
      arrivalDate: true,
      departureDate: false,
      build: false,
      strike: true,
    });
  });

  it("an override equal to the plan is not 'edited'", () => {
    const p = effectiveWapPass({ ...NONE, build: true }, PLAN, null);
    expect(p.edited.build).toBe(false);
  });

  it("an override false on build is honoured (not treated as unset)", () => {
    const p = effectiveWapPass({ ...NONE, build: false }, PLAN, null);
    expect(p.build).toBe(false);
    expect(p.edited.build).toBe(true);
  });

  it("falls back to the registration's first arrival when the roster has none", () => {
    const p = effectiveWapPass(
      NONE,
      { ...PLAN, arrivalDate: null },
      "2027-04-20",
    );
    expect(p.arrivalDate).toBe("2027-04-20");
    expect(p.arrivalSource).toBe("registration");
    const noPlan = effectiveWapPass(NONE, null, "2027-04-20");
    expect(noPlan).toMatchObject({
      arrivalDate: "2027-04-20",
      arrivalSource: "registration",
      departureDate: null,
      build: null,
      strike: null,
    });
  });

  it("is empty only when there is nothing anywhere", () => {
    const p = effectiveWapPass(NONE, null, null);
    expect(p.arrivalDate).toBeNull();
    expect(p.arrivalSource).toBeNull();
  });

  it("with no plan, any override is 'edited'", () => {
    const p = effectiveWapPass({ ...NONE, strike: false }, null, null);
    expect(p.edited.strike).toBe(true);
  });
});

describe("normalizeWapOverrides", () => {
  it("stores an override equal to the plan as null", () => {
    expect(
      normalizeWapOverrides(
        {
          arrivalDate: "2027-04-22",
          departureDate: "2027-05-01",
          build: true,
          strike: true,
        },
        PLAN,
      ),
    ).toEqual({
      arrivalDate: null,
      departureDate: "2027-05-01",
      build: null,
      strike: true,
    });
  });

  it("keeps everything when there is no plan", () => {
    const input = {
      arrivalDate: "2027-04-22",
      departureDate: null,
      build: false,
      strike: null,
    };
    expect(normalizeWapOverrides(input, null)).toEqual(input);
  });

  it("an empty member plan (build false) makes a false override redundant", () => {
    expect(
      normalizeWapOverrides({ ...NONE, build: false }, emptyMemberLogistics())
        .build,
    ).toBeNull();
  });
});

describe("validateWapOverrides", () => {
  it("accepts dates inside the logistics window", () => {
    expect(
      validateWapOverrides(
        { ...NONE, arrivalDate: "2027-04-20" },
        PLAN,
        null,
        EDITION,
      ),
    ).toEqual({ ok: true });
  });

  it("refuses dates far from the event (a typo'd year)", () => {
    expect(
      validateWapOverrides(
        { ...NONE, arrivalDate: "2026-04-20" },
        PLAN,
        null,
        EDITION,
      ),
    ).toEqual({
      ok: false,
      reason: "dates_out_of_window",
    });
    expect(
      validateWapOverrides(
        { ...NONE, departureDate: "2027-06-30" },
        PLAN,
        null,
        EDITION,
      ),
    ).toEqual({
      ok: false,
      reason: "dates_out_of_window",
    });
  });

  it("refuses an overridden arrival after the roster departure", () => {
    expect(
      validateWapOverrides(
        { ...NONE, arrivalDate: "2027-05-05" },
        PLAN,
        null,
        EDITION,
      ),
    ).toEqual({
      ok: false,
      reason: "arrival_after_departure",
    });
  });

  it("refuses an overridden departure before the fallback arrival", () => {
    expect(
      validateWapOverrides(
        { ...NONE, departureDate: "2027-04-19" },
        null,
        "2027-04-20",
        EDITION,
      ),
    ).toEqual({
      ok: false,
      reason: "arrival_after_departure",
    });
  });

  it("refuses everything when the edition has no usable dates", () => {
    expect(
      validateWapOverrides({ ...NONE, arrivalDate: "2027-04-20" }, PLAN, null, {
        startDate: "",
        endDate: "",
      }),
    ).toEqual({ ok: false, reason: "dates_out_of_window" });
  });
});

// --- Flags + duplicate holders ---------------------------------------------------

describe("flags", () => {
  it("flags an incomplete bio and an unfinished onboarding, never blocks", () => {
    const flags = wapPassFlags({
      bioComplete: false,
      onboardingUnfinished: true,
      otherProjects: [],
    });
    expect(flags.map(wapFlagLabel)).toEqual([
      "Bio incomplete",
      "Onboarding unfinished",
    ]);
    expect(isWapPassIncomplete(flags)).toBe(true);
  });

  it("a complete holder has no flags", () => {
    const flags = wapPassFlags({
      bioComplete: true,
      onboardingUnfinished: false,
      otherProjects: [],
    });
    expect(flags).toEqual([]);
    expect(isWapPassIncomplete(flags)).toBe(false);
  });

  it("another pass is information, not incompleteness", () => {
    const flags = wapPassFlags({
      bioComplete: true,
      onboardingUnfinished: false,
      otherProjects: ["Dust Bunnies"],
    });
    expect(flags.map(wapFlagLabel)).toEqual([
      "Also has a pass from Dust Bunnies",
    ]);
    expect(isWapPassIncomplete(flags)).toBe(false);
  });
});

describe("wapDuplicateHolders — the narrow free-camp exception", () => {
  const holdings = [
    { userId: "jabu", registrationId: "mad", projectName: "Mad Hatters" },
    { userId: "jabu", registrationId: "dust", projectName: "Dust Bunnies" },
    { userId: "jabu", registrationId: "free", projectName: "A Free Camp" },
    { userId: "jabu", registrationId: "free", projectName: "A Free Camp" },
    // Someone NOT on this list who holds a pass elsewhere.
    { userId: "stranger", registrationId: "free", projectName: "A Free Camp" },
    { userId: "ren", registrationId: "mad", projectName: "Mad Hatters" },
  ];

  it("names every other project holding the same person, free camps included", () => {
    const out = wapDuplicateHolders("mad", ["jabu", "ren"], holdings);
    expect(out.get("jabu")).toEqual(["A Free Camp", "Dust Bunnies"]);
    expect(out.has("ren")).toBe(false);
  });

  it("never reveals anything about a person who is not on this list", () => {
    const out = wapDuplicateHolders("mad", ["jabu", "ren"], holdings);
    expect(out.has("stranger")).toBe(false);
    expect([...out.keys()]).toEqual(["jabu"]);
  });

  it("never names this project back to itself", () => {
    const out = wapDuplicateHolders("dust", ["jabu"], holdings);
    expect(out.get("jabu")).toEqual(["A Free Camp", "Mad Hatters"]);
  });

  it("reads 'Also has a pass from {project}'", () => {
    expect(wapDuplicateNote("Dust Bunnies")).toBe(
      "Also has a pass from Dust Bunnies",
    );
  });
});

// --- Since approval ------------------------------------------------------------

describe("wapChangesSinceApproval", () => {
  const pass = (
    id: string,
    patch: Partial<WapCurrentPass> = {},
  ): WapCurrentPass => ({
    membershipId: `m-${id}`,
    userId: `u-${id}`,
    arrivalDate: "2027-04-22",
    departureDate: "2027-05-03",
    build: true,
    strike: false,
    ...patch,
  });
  const snapshot: WapApprovedPass[] = [
    pass("alice"),
    pass("sipho"),
    pass("lerato"),
  ].map(wapApprovedPass);

  it("reports nothing for a never-approved list", () => {
    const c = wapChangesSinceApproval(null, [pass("alice")]);
    expect(c).toMatchObject({ everApproved: false, any: false });
    expect(wapSinceApprovalBadge("submitted", c)).toBeNull();
  });

  it("an unchanged list has no changes", () => {
    const c = wapChangesSinceApproval(snapshot, [
      pass("alice"),
      pass("sipho"),
      pass("lerato"),
    ]);
    expect(c.any).toBe(false);
    expect(wapSinceApprovalBadge("approved", c)).toBeNull();
  });

  it("an approved list that lost a member stays approved and says so", () => {
    const c = wapChangesSinceApproval(snapshot, [pass("alice"), pass("sipho")]);
    expect(c.removed.map((p) => p.membershipId)).toEqual(["m-lerato"]);
    expect(wapSinceApprovalBadge("approved", c)).toBe(
      "1 removed since approval",
    );
  });

  it("an edited-then-resubmitted list shows added and changed fields", () => {
    const c = wapChangesSinceApproval(snapshot, [
      pass("alice"),
      pass("sipho", { strike: true }),
      pass("lerato"),
      pass("mia"),
    ]);
    expect(c.added.map((p) => p.membershipId)).toEqual(["m-mia"]);
    expect(c.changed).toHaveLength(1);
    expect(wapChangeLabel(c.changed[0]!)).toBe("strike No → Yes");
    expect(wapSinceApprovalBadge("submitted", c)).toBe(
      "Changed since approval",
    );
  });

  it("labels date changes with short dates", () => {
    const c = wapChangesSinceApproval(snapshot, [
      pass("alice", { arrivalDate: "2027-04-24" }),
      pass("sipho"),
      pass("lerato"),
    ]);
    expect(wapChangeLabel(c.changed[0]!)).toBe("arrival 22 Apr → 24 Apr");
  });

  it("a member who left and rejoined is a new membership: removed + added", () => {
    const c = wapChangesSinceApproval(snapshot, [
      pass("alice"),
      pass("sipho"),
      pass("lerato", { membershipId: "m-lerato-2" }),
    ]);
    expect(c.removed).toHaveLength(1);
    expect(c.added).toHaveLength(1);
  });
});

// --- Summaries -----------------------------------------------------------------

describe("labels and the org overview", () => {
  it("allocated and left labels", () => {
    expect(wapAllocatedLabel(7, 10)).toBe("7 of 10 allocated");
    expect(wapPassesLeftLabel(7, 10)).toBe("3 passes left");
    expect(wapPassesLeftLabel(9, 10)).toBe("1 pass left");
    expect(wapPassesLeftLabel(10, 10)).toBe("No passes left");
  });

  const rows: WapProjectSummary[] = [
    summariseWapProject({
      registrationId: "r1",
      projectName: "Mad Hatters",
      groupKind: "theme_camp",
      listStatus: "submitted",
      requests: [
        { requested: 10, status: "granted", granted: 10 },
        { requested: 4, status: "pending", granted: null },
      ],
      allocated: 7,
    }),
    summariseWapProject({
      registrationId: "r2",
      projectName: "A Big Duck",
      groupKind: "artwork",
      listStatus: "approved",
      requests: [{ requested: 6, status: "granted", granted: 4 }],
      allocated: 4,
    }),
    summariseWapProject({
      registrationId: "r3",
      projectName: "Camp 404",
      groupKind: "theme_camp",
      listStatus: "draft",
      requests: [{ requested: 2, status: "declined", granted: null }],
      allocated: 0,
    }),
  ];

  it("summarises one project", () => {
    expect(rows[0]).toMatchObject({
      requested: 14,
      granted: 10,
      allocated: 7,
      pendingAsk: 4,
    });
    expect(rows[2]).toMatchObject({
      requested: 2,
      granted: 0,
      pendingAsk: null,
    });
  });

  it("totals the edition", () => {
    expect(wapOverviewTotals(rows)).toEqual({
      requested: 22,
      granted: 14,
      allocated: 11,
      projectsGranted: 2,
      pendingRequests: 1,
      pendingPasses: 4,
    });
  });

  it("filters by status, kind and pending", () => {
    const none = { status: null, kind: null, pendingOnly: false };
    expect(filterWapOverview(rows, none)).toHaveLength(3);
    expect(
      filterWapOverview(rows, { ...none, pendingOnly: true }).map(
        (r) => r.registrationId,
      ),
    ).toEqual(["r1"]);
    expect(
      filterWapOverview(rows, { ...none, kind: "artwork" }).map(
        (r) => r.registrationId,
      ),
    ).toEqual(["r2"]);
    expect(
      filterWapOverview(rows, { ...none, status: "draft" }).map(
        (r) => r.registrationId,
      ),
    ).toEqual(["r3"]);
  });
});

// --- Notifications ---------------------------------------------------------------

describe("notifications", () => {
  const camp: WapNoticeContext = {
    projectName: "The Camp",
    projectKind: "theme_camp",
    projectSlug: "the-camp",
  };
  const art: WapNoticeContext = {
    projectName: "The Artwork",
    projectKind: "artwork",
    projectSlug: "the-art",
  };
  const mv: WapNoticeContext = {
    projectName: "The Vehicle",
    projectKind: "mutant_vehicle",
    projectSlug: "the-mv",
  };

  it("links each project kind to its own passes page", () => {
    expect(wapPassesPath("theme_camp", "x")).toBe("/camps/x/passes");
    expect(wapPassesPath("artwork", "x")).toBe("/artworks/x/passes");
    expect(wapPassesPath("mutant_vehicle", "x")).toBe("/vehicles/x/passes");
    expect(wapListApprovedNotification(art).link).toBe(
      "/artworks/the-art/passes",
    );
    expect(wapListApprovedNotification(mv).link).toBe(
      "/vehicles/the-mv/passes",
    );
  });

  it("every builder is kind 'wap', a valid kind, and carries the project name", () => {
    const all = [
      wapRequestsOpenNotification(camp, "AfrikaBurn 2027"),
      wapRequestGrantedNotification(camp, 4, 4),
      wapRequestDeclinedNotification(camp, 4),
      wapListApprovedNotification(camp),
      wapListReturnedNotification(camp, "Two bios are incomplete."),
      wapPassApprovedNotification(camp),
    ];
    for (const n of all) {
      expect(n.kind).toBe("wap");
      expect(NotificationKind.safeParse(n.kind).success).toBe(true);
      expect(n.body).toContain("The Camp");
    }
  });

  it("granted says the number, and says when it was fewer than asked", () => {
    expect(wapRequestGrantedNotification(camp, 4, 4).title).toBe(
      "AfrikaBurn granted 4 Work Access Passes",
    );
    expect(wapRequestGrantedNotification(camp, 1, 4).title).toBe(
      "AfrikaBurn granted 1 Work Access Pass (you asked for 4)",
    );
  });

  it("returned carries the org's note", () => {
    expect(wapListReturnedNotification(camp, "  Swap out Jabu. ").body).toBe(
      "The Camp: Swap out Jabu.",
    );
  });

  it("pass holders land on the project page, not the lead's page", () => {
    expect(wapPassApprovedNotification(camp).link).toBe("/camps/the-camp");
    // An artwork or vehicle has no page at /artworks/<slug> — its dashboard is
    // /camps/<slug> like every group's, so the holder's link goes there.
    expect(wapPassApprovedNotification(art).link).toBe("/camps/the-art");
    expect(wapPassApprovedNotification(mv).link).toBe("/camps/the-mv");
  });

  it("is in-app only — no immediate email", () => {
    expect(shouldSendImmediateEmail("wap")).toBe(false);
  });

  it("leaks no private value", () => {
    const n = wapListReturnedNotification(camp, "Two bios are incomplete.");
    expect(notificationMentionsAny(n, ["+27820000000", "8001015009087"])).toBe(
      false,
    );
  });
});

describe("wapOwnPassLine", () => {
  it("shows nothing for a draft list or someone not on it", () => {
    expect(wapOwnPassLine("draft", true)).toBeNull();
    expect(wapOwnPassLine("approved", false)).toBeNull();
    expect(wapOwnPassLine(null, true)).toBeNull();
  });
  it("shows the status otherwise", () => {
    expect(wapOwnPassLine("approved", true)).toMatch(
      /^You have a Work Access Pass/,
    );
    expect(wapOwnPassLine("submitted", true)).toMatch(/waiting/);
    expect(wapOwnPassLine("returned", true)).toMatch(/updated/);
  });
});

// --- Export ----------------------------------------------------------------------

describe("CSV export", () => {
  const input: WapExportInput = {
    projectName: "The Camp",
    projectKind: "theme_camp",
    listStatus: "approved",
    name: '=HYPERLINK("x")',
    username: "jabu",
    email: "jabu@example.com",
    pass: {
      arrivalDate: "2027-04-23",
      departureDate: "2027-05-02",
      build: true,
      strike: null,
    },
    flags: [
      { kind: "bio_incomplete" },
      { kind: "other_project", projectName: "Dust Bunnies" },
    ],
  };

  it("cannot carry a hard-locked or medical field — the shape has no slot", () => {
    const keys = WAP_EXPORT_COLUMNS.map((c) => c.key as string);
    const headers = WAP_EXPORT_COLUMNS.map((c) => c.header);
    const forbidden = [
      ...ALWAYS_PRIVATE_FIELDS,
      ...HARD_LOCKED_PRIVATE_FIELDS,
      ...SAFETY_VISIBLE_FIELDS,
      "medicalNotes",
      "idNumber",
    ].map((k) => k.toLowerCase());
    for (const key of [...keys, ...headers]) {
      expect(forbidden).not.toContain(key.toLowerCase());
      expect(key.toLowerCase()).not.toMatch(
        /phone|medical|passport|said|idnumber|contact|emergency/,
      );
    }
    const leaky = {
      ...input,
      phone: "+27820000000",
      medicalNotes: "asthma",
      onsiteContactPhone: "+27830000000",
      idNumber: "8001015009087",
    } as WapExportInput;
    expect(Object.keys(wapExportRow(leaky)).sort()).toEqual([...keys].sort());
    expect(buildWapCsv([leaky])).not.toMatch(
      /27820000000|27830000000|asthma|8001015009087/,
    );
  });

  it("renders a row with flags, yes/blank and formula neutralised", () => {
    const csv = buildWapCsv([input]);
    expect(
      csv.startsWith("﻿Project,Project type,List status,Name,Username,Email"),
    ).toBe(true);
    const line = csv.split("\r\n")[1]!;
    expect(line).toContain("'=HYPERLINK");
    expect(line).toContain("Theme camp,Approved");
    expect(line).toContain("2027-04-23,2027-05-02,Yes,,");
    expect(line).toContain("Bio incomplete; Also has a pass from Dust Bunnies");
  });

  it("names the file by edition and date", () => {
    expect(wapCsvFilename(2027, d("2027-03-01T08:00:00Z"))).toBe(
      "afrikaburn-2027-work-access-passes-2027-03-01.csv",
    );
  });
});
