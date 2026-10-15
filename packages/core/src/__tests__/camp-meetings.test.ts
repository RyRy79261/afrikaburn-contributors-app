import { describe, expect, it } from "vitest";
import {
  MembershipRole,
  type MeetingAudience,
  type ProjectPermissions,
} from "@quagga/types";
import {
  buildCampCalendar,
  buildMeetingIcs,
  calendarAgenda,
  calendarMonthGrid,
  calendarMonths,
  canEditMeeting,
  canEditMeetingNotes,
  canScheduleMeetings,
  canViewMeeting,
  decideMeetingAudience,
  decideMeetingEdit,
  decideMeetingNotesSave,
  escapeIcsText,
  foldIcsLine,
  isInMeetingAudience,
  isMeetingUpcoming,
  isRetryOfStoredNotes,
  meetingCancelledNotification,
  meetingIcsFilename,
  meetingMovedNotification,
  meetingRefusalMessage,
  meetingScheduledNotification,
  meetingsAvailableForGroup,
  meetingTimingChanged,
  meetingUpdateNotices,
  nextMeeting,
  resolveMeetingRecipients,
  sastWallClock,
  splitMeetings,
  type MeetingRefusal,
  type MeetingViewer,
} from "../camp-meetings";
import type { PermissionMembership } from "../project-permissions";

// Camp meetings (docs/camp-meetings-spec.md) — the pure rules. Values come
// from the real vocabularies (AGENTS.md "Verification"): structural roles
// from MembershipRole, the privilege by its real key.

const LEAD = MembershipRole.enum.lead;
const ADMIN = MembershipRole.enum.admin;
const MEMBER = MembershipRole.enum.member;

const CAMP = "11111111-0000-4000-8000-00000000000a";
const OTHER_CAMP = "11111111-0000-4000-8000-00000000000b";
const BASELINE = "0b0b0b0b-0000-4000-8000-000000000000";
const KITCHEN = "0b0b0b0b-0000-4000-8000-000000000001";
const SOUND = "0b0b0b0b-0000-4000-8000-000000000002";
const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const JABU = "aaaaaaaa-0000-4000-8000-000000000002";
const REN = "aaaaaaaa-0000-4000-8000-000000000003";

const perms = (
  role: MembershipRole,
  extra: ProjectPermissions = {},
): PermissionMembership => ({
  structuralRole: role,
  rolePermissions: [{}, extra],
});

const viewer = (
  userId: string,
  membership: PermissionMembership | null,
  roles: string[] = [],
): MeetingViewer => ({ userId, membership, heldRoleIds: new Set(roles) });

const everyone: MeetingAudience = {
  kind: "project",
  groupId: CAMP,
  mode: "everyone",
  roleIds: [],
};
const kitchenOnly: MeetingAudience = {
  kind: "project",
  groupId: CAMP,
  mode: "roles",
  roleIds: [KITCHEN],
};
const meeting = (
  audience: MeetingAudience,
  createdByUserId: string | null = ALICE,
) => ({
  groupId: CAMP,
  audience,
  createdByUserId,
});

describe("who may schedule", () => {
  it("leads and co-leads always; members only with schedule_meetings", () => {
    expect(canScheduleMeetings(perms(LEAD))).toBe(true);
    expect(canScheduleMeetings(perms(ADMIN))).toBe(true);
    expect(canScheduleMeetings(perms(MEMBER))).toBe(false);
    expect(
      canScheduleMeetings(perms(MEMBER, { schedule_meetings: true })),
    ).toBe(true);
    // A different privilege is not this one.
    expect(canScheduleMeetings(perms(MEMBER, { manage_layout: true }))).toBe(
      false,
    );
    expect(canScheduleMeetings(null)).toBe(false);
  });

  it("any project has meetings; the org group does not", () => {
    expect(meetingsAvailableForGroup("theme_camp")).toBe(true);
    expect(meetingsAvailableForGroup("artwork")).toBe(true);
    expect(meetingsAvailableForGroup("mutant_vehicle")).toBe(true);
    expect(meetingsAvailableForGroup("org")).toBe(false);
  });
});

describe("who sees a meeting", () => {
  it("a whole-camp meeting: every current member, never a non-member", () => {
    expect(
      canViewMeeting(viewer(JABU, perms(MEMBER)), meeting(everyone), BASELINE),
    ).toBe(true);
    expect(
      canViewMeeting(viewer(JABU, null), meeting(everyone), BASELINE),
    ).toBe(false);
  });

  it("a meeting for chosen roles: holders of those roles and the leads", () => {
    const m = meeting(kitchenOnly, REN);
    expect(
      canViewMeeting(viewer(JABU, perms(MEMBER), [KITCHEN]), m, BASELINE),
    ).toBe(true);
    expect(
      canViewMeeting(viewer(JABU, perms(MEMBER), [SOUND]), m, BASELINE),
    ).toBe(false);
    expect(canViewMeeting(viewer(JABU, perms(MEMBER)), m, BASELINE)).toBe(
      false,
    );
    expect(canViewMeeting(viewer(ALICE, perms(LEAD)), m, BASELINE)).toBe(true);
    expect(canViewMeeting(viewer(ALICE, perms(ADMIN)), m, BASELINE)).toBe(true);
  });

  it("schedule_meetings alone does not open a meeting for other roles", () => {
    const m = meeting(kitchenOnly, REN);
    const scheduler = viewer(JABU, perms(MEMBER, { schedule_meetings: true }), [
      SOUND,
    ]);
    expect(canViewMeeting(scheduler, m, BASELINE)).toBe(false);
    expect(canEditMeeting(scheduler, m, BASELINE)).toBe(false);
    expect(canEditMeetingNotes(scheduler, m, BASELINE)).toBe(false);
  });

  it("whoever scheduled it keeps seeing it, even outside its roles", () => {
    const m = meeting(kitchenOnly, JABU);
    expect(
      canViewMeeting(viewer(JABU, perms(MEMBER), [SOUND]), m, BASELINE),
    ).toBe(true);
    // …but not once they have left the camp.
    expect(canViewMeeting(viewer(JABU, null), m, BASELINE)).toBe(false);
  });

  it("naming the baseline role is naming everyone", () => {
    const viaBaseline: MeetingAudience = {
      ...kitchenOnly,
      roleIds: [BASELINE],
    };
    expect(isInMeetingAudience(viaBaseline, new Set(), BASELINE)).toBe(true);
    expect(isInMeetingAudience(viaBaseline, new Set(), null)).toBe(false);
    expect(
      isInMeetingAudience(
        { ...kitchenOnly, roleIds: [] },
        new Set([KITCHEN]),
        BASELINE,
      ),
    ).toBe(false);
  });

  it("fails closed on an audience that is not this camp's", () => {
    const foreign: MeetingAudience = { ...everyone, groupId: OTHER_CAMP };
    expect(
      canViewMeeting(viewer(ALICE, perms(LEAD)), meeting(foreign), BASELINE),
    ).toBe(false);
  });

  it("agrees with the recipient resolver for every member", () => {
    // The page's "can I see it" and the notice's "who hears" must never
    // disagree for a plain member.
    const memberships = [
      { membershipId: "m-alice", userId: ALICE, groupId: CAMP, role: LEAD },
      { membershipId: "m-jabu", userId: JABU, groupId: CAMP, role: MEMBER },
      { membershipId: "m-ren", userId: REN, groupId: CAMP, role: MEMBER },
    ];
    const roleAssignments = [
      { membershipId: "m-jabu", projectRoleId: KITCHEN },
      { membershipId: "m-ren", projectRoleId: SOUND },
    ];
    const projectRoles = [
      {
        id: BASELINE,
        groupId: CAMP,
        kind: "baseline" as const,
        officerKey: null,
      },
      { id: KITCHEN, groupId: CAMP, kind: "custom" as const, officerKey: null },
      { id: SOUND, groupId: CAMP, kind: "custom" as const, officerKey: null },
    ];
    const ctx = { groupId: CAMP, memberships, roleAssignments, projectRoles };
    const recipients = resolveMeetingRecipients(kitchenOnly, ctx, null);
    expect(recipients).toEqual([JABU]);
    for (const [userId, roles] of [
      [JABU, [KITCHEN]],
      [REN, [SOUND]],
    ] as const) {
      expect(isInMeetingAudience(kitchenOnly, new Set(roles), BASELINE)).toBe(
        recipients.includes(userId),
      );
    }
    // The author never notifies themselves; an erased account never hears.
    expect(
      resolveMeetingRecipients(
        everyone,
        { ...ctx, excludedUserIds: new Set([REN]) },
        ALICE,
      ),
    ).toEqual([JABU]);
  });
});

describe("who edits", () => {
  it("details: a scheduler who sees it; notes: also the member who scheduled it", () => {
    const m = meeting(everyone, JABU);
    const jabu = viewer(JABU, perms(MEMBER));
    expect(canEditMeeting(jabu, m, BASELINE)).toBe(false);
    expect(canEditMeetingNotes(jabu, m, BASELINE)).toBe(true);
    const ren = viewer(REN, perms(MEMBER));
    expect(canEditMeetingNotes(ren, m, BASELINE)).toBe(false);
    const scheduler = viewer(REN, perms(MEMBER, { schedule_meetings: true }));
    expect(canEditMeeting(scheduler, m, BASELINE)).toBe(true);
    expect(canEditMeetingNotes(scheduler, m, BASELINE)).toBe(true);
    expect(canEditMeeting(viewer(ALICE, perms(LEAD)), m, BASELINE)).toBe(true);
    expect(canEditMeetingNotes(viewer(ALICE, null), m, BASELINE)).toBe(false);
  });

  it("refuses in order: unseen, not allowed, cancelled, stale", () => {
    const base = {
      canView: true,
      canEdit: true,
      cancelled: false,
      currentVersion: 2,
      expectedVersion: 2,
    };
    expect(decideMeetingEdit(base)).toBeNull();
    expect(decideMeetingEdit({ ...base, canView: false, canEdit: false })).toBe(
      "not_found",
    );
    expect(decideMeetingEdit({ ...base, canEdit: false })).toBe(
      "not_scheduler",
    );
    expect(decideMeetingEdit({ ...base, cancelled: true })).toBe("cancelled");
    expect(decideMeetingEdit({ ...base, expectedVersion: 1 })).toBe("stale");
  });

  it("notes: a cancelled meeting's notes may still be written; stale is refused", () => {
    const base = {
      canView: true,
      canEditNotes: true,
      currentVersion: 4,
      expectedVersion: 4,
    };
    expect(decideMeetingNotesSave(base)).toBeNull();
    expect(decideMeetingNotesSave({ ...base, canView: false })).toBe(
      "not_found",
    );
    expect(decideMeetingNotesSave({ ...base, canEditNotes: false })).toBe(
      "not_note_taker",
    );
    expect(decideMeetingNotesSave({ ...base, expectedVersion: 3 })).toBe(
      "stale",
    );
  });

  it("a lost response's retry is recognised; someone else's save is not", () => {
    const base = {
      currentVersion: 5,
      expectedVersion: 4,
      storedNotes: "## Transport",
      sentNotes: "## Transport",
      notesUpdatedByUserId: REN,
      actorUserId: REN,
    };
    expect(isRetryOfStoredNotes(base)).toBe(true);
    expect(isRetryOfStoredNotes({ ...base, notesUpdatedByUserId: ALICE })).toBe(
      false,
    );
    expect(isRetryOfStoredNotes({ ...base, sentNotes: "## Build" })).toBe(
      false,
    );
    expect(isRetryOfStoredNotes({ ...base, currentVersion: 6 })).toBe(false);
  });

  it("every refusal has its own sentence", () => {
    const reasons: MeetingRefusal[] = [
      "not_found",
      "not_scheduler",
      "not_note_taker",
      "cancelled",
      "stale",
      "no_roles",
      "unknown_role",
      "not_attendee",
    ];
    const messages = reasons.map(meetingRefusalMessage);
    expect(new Set(messages).size).toBe(reasons.length);
    for (const m of messages) expect(m.length).toBeGreaterThan(10);
  });
});

describe("the audience a write stores", () => {
  const camp = {
    groupId: CAMP,
    campRoleIds: new Set([BASELINE, KITCHEN, SOUND]),
    baselineRoleId: BASELINE,
  };

  it("whole camp, or this camp's roles, de-duplicated and sorted", () => {
    expect(
      decideMeetingAudience({ mode: "everyone", roleIds: [KITCHEN] }, camp),
    ).toEqual({
      ok: true,
      audience: everyone,
    });
    expect(
      decideMeetingAudience(
        { mode: "roles", roleIds: [SOUND, KITCHEN, SOUND] },
        camp,
      ),
    ).toEqual({
      ok: true,
      audience: {
        kind: "project",
        groupId: CAMP,
        mode: "roles",
        roleIds: [KITCHEN, SOUND],
      },
    });
  });

  it("refuses no roles and another camp's role; the baseline means everyone", () => {
    expect(decideMeetingAudience({ mode: "roles", roleIds: [] }, camp)).toEqual(
      {
        ok: false,
        reason: "no_roles",
      },
    );
    expect(
      decideMeetingAudience(
        { mode: "roles", roleIds: [KITCHEN, "elsewhere"] },
        camp,
      ),
    ).toEqual({ ok: false, reason: "unknown_role" });
    expect(
      decideMeetingAudience({ mode: "roles", roleIds: [BASELINE] }, camp),
    ).toEqual({
      ok: true,
      audience: everyone,
    });
  });
});

describe("who hears about an edit", () => {
  it("new people: scheduled; people already in it: moved only when the time moved", () => {
    expect(
      meetingUpdateNotices({
        before: [JABU],
        after: [JABU, REN],
        timingChanged: false,
      }),
    ).toEqual({ scheduled: [REN], moved: [] });
    expect(
      meetingUpdateNotices({
        before: [JABU, ALICE],
        after: [JABU, REN],
        timingChanged: true,
      }),
    ).toEqual({ scheduled: [REN], moved: [JABU] });
    expect(
      meetingUpdateNotices({ before: [JABU], after: [], timingChanged: true }),
    ).toEqual({
      scheduled: [],
      moved: [],
    });
  });

  it("timing is the day, the start and the length — nothing else", () => {
    const a = { date: "2027-03-21", startMinute: 1140, durationMinutes: 60 };
    expect(meetingTimingChanged(a, { ...a })).toBe(false);
    expect(meetingTimingChanged(a, { ...a, date: "2027-03-28" })).toBe(true);
    expect(meetingTimingChanged(a, { ...a, startMinute: 1110 })).toBe(true);
    expect(meetingTimingChanged(a, { ...a, durationMinutes: 90 })).toBe(true);
  });
});

describe("upcoming and past, on a South African clock", () => {
  // 21 Mar 2027 19:00 SAST is 17:00 UTC.
  const call = {
    id: "call",
    date: "2027-03-21",
    startMinute: 19 * 60,
    durationMinutes: 60,
    cancelledAt: null as Date | null,
  };

  it("reads now as SAST (UTC+2), across midnight too", () => {
    expect(sastWallClock(new Date("2027-03-21T17:00:00Z"))).toEqual({
      date: "2027-03-21",
      minute: 19 * 60,
    });
    expect(sastWallClock(new Date("2027-03-21T23:30:00Z"))).toEqual({
      date: "2027-03-22",
      minute: 90,
    });
  });

  it("is upcoming until it ends, then past", () => {
    expect(isMeetingUpcoming(call, new Date("2027-03-21T16:59:00Z"))).toBe(
      true,
    );
    // Started, not over: the call link is still wanted.
    expect(isMeetingUpcoming(call, new Date("2027-03-21T17:30:00Z"))).toBe(
      true,
    );
    expect(isMeetingUpcoming(call, new Date("2027-03-21T18:00:00Z"))).toBe(
      false,
    );
  });

  it("a cancelled meeting is never upcoming, even in the future", () => {
    expect(
      isMeetingUpcoming(
        { ...call, cancelledAt: new Date("2027-03-01") },
        new Date("2027-01-01"),
      ),
    ).toBe(false);
  });

  it("splits soonest-first and most-recent-first; next is the soonest", () => {
    const now = new Date("2027-03-25T10:00:00Z");
    const list = [
      { ...call, id: "kickoff", date: "2027-01-24" },
      { ...call, id: "pack", date: "2027-04-17", startMinute: 9 * 60 },
      { ...call, id: "kitchen", date: "2027-04-07" },
      { ...call, id: "budget", date: "2027-02-21" },
      { ...call, id: "walk", date: "2027-04-01", cancelledAt: new Date() },
      { ...call, id: "early", date: "2027-04-07", startMinute: 8 * 60 },
    ];
    const { upcoming, past } = splitMeetings(list, now);
    expect(upcoming.map((m) => m.id)).toEqual(["early", "kitchen", "pack"]);
    expect(past.map((m) => m.id)).toEqual(["walk", "budget", "kickoff"]);
    expect(nextMeeting(list, now)?.id).toBe("early");
    expect(nextMeeting([], now)).toBeNull();
  });
});

describe("the camp calendar", () => {
  const edition = { startDate: "2027-04-26", endDate: "2027-05-02" };

  it("marks build, the event and strike, and places meetings and my shifts by day", () => {
    const days = buildCampCalendar({
      edition,
      meetings: [
        {
          id: "m1",
          title: "Kitchen team",
          date: "2027-04-07",
          startMinute: 1110,
          durationMinutes: 60,
          cancelledAt: null,
        },
        {
          id: "m2",
          title: "Briefing",
          date: "2027-04-26",
          startMinute: 450,
          durationMinutes: 30,
          cancelledAt: new Date(),
        },
      ],
      shifts: [
        {
          id: "s1",
          name: "Tea bar",
          date: "2027-04-27",
          startMinute: 840,
          durationMinutes: 180,
        },
        {
          id: "s2",
          name: "Build crew",
          date: "2027-04-22",
          startMinute: 480,
          durationMinutes: 240,
        },
        {
          id: "s3",
          name: "Bad",
          date: "2027-02-30",
          startMinute: 0,
          durationMinutes: 60,
        },
      ],
    });
    const byDate = new Map(days.map((d) => [d.date, d]));
    expect(byDate.get("2027-04-22")?.phase).toBe("build");
    expect(byDate.get("2027-04-25")?.phase).toBe("build");
    expect(byDate.get("2027-04-26")?.phase).toBe("event");
    expect(byDate.get("2027-05-02")?.phase).toBe("event");
    expect(byDate.get("2027-05-03")?.phase).toBe("strike");
    expect(byDate.get("2027-04-07")).toEqual({
      date: "2027-04-07",
      phase: null,
      entries: [
        {
          kind: "meeting",
          id: "m1",
          title: "Kitchen team",
          startMinute: 1110,
          durationMinutes: 60,
          cancelled: false,
        },
      ],
    });
    expect(byDate.get("2027-04-26")?.entries[0]).toMatchObject({
      id: "m2",
      cancelled: true,
    });
    expect(byDate.get("2027-04-22")?.entries[0]).toMatchObject({
      kind: "shift",
      title: "Build crew",
    });
    // Only days with something on, in order; the unusable date is dropped.
    expect(days.map((d) => d.date)).toEqual(
      [...days.map((d) => d.date)].sort(),
    );
    expect(byDate.has("2027-02-30")).toBe(false);
    expect(byDate.has("2027-04-08")).toBe(false);
  });

  it("orders a day by time, a meeting before a shift at the same minute", () => {
    const [day] = buildCampCalendar({
      edition: null,
      meetings: [
        {
          id: "m",
          title: "Z call",
          date: "2027-04-07",
          startMinute: 600,
          durationMinutes: 30,
          cancelledAt: null,
        },
      ],
      shifts: [
        {
          id: "s",
          name: "A shift",
          date: "2027-04-07",
          startMinute: 600,
          durationMinutes: 60,
        },
        {
          id: "e",
          name: "Early",
          date: "2027-04-07",
          startMinute: 300,
          durationMinutes: 60,
        },
      ],
    });
    expect(day?.entries.map((e) => e.id)).toEqual(["e", "m", "s"]);
  });

  it("a six-week, Monday-first month grid (frame G4: April 2027 opens on Mon 29 Mar)", () => {
    const days = buildCampCalendar({ edition, meetings: [], shifts: [] });
    const weeks = calendarMonthGrid("2027-04", days);
    expect(weeks).toHaveLength(6);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0]![0]).toEqual({
      date: "2027-03-29",
      inMonth: false,
      day: null,
    });
    expect(weeks[0]![3]).toMatchObject({ date: "2027-04-01", inMonth: true });
    expect(weeks[5]![6]!.date).toBe("2027-05-09");
    // Strike spills into the grid's May days, as drawn.
    const may3 = weeks.flat().find((c) => c.date === "2027-05-03");
    expect(may3?.inMonth).toBe(false);
    expect(may3?.day?.phase).toBe("strike");
    expect(calendarMonthGrid("2027-13", days)).toEqual([]);
    expect(calendarMonthGrid("nonsense", days)).toEqual([]);
  });

  it("the phone agenda is the month's days with something on", () => {
    const days = buildCampCalendar({
      edition,
      meetings: [
        {
          id: "m",
          title: "Call",
          date: "2027-03-21",
          startMinute: 1140,
          durationMinutes: 60,
          cancelledAt: null,
        },
      ],
      shifts: [],
    });
    expect(calendarAgenda("2027-03", days).map((d) => d.date)).toEqual([
      "2027-03-21",
    ]);
    expect(calendarAgenda("2027-05", days).map((d) => d.date)).toEqual([
      "2027-05-01",
      "2027-05-02",
      "2027-05-03",
    ]);
  });

  it("the month switcher spans today to the last day with something on", () => {
    const days = buildCampCalendar({ edition, meetings: [], shifts: [] });
    expect(calendarMonths(days, "2027-01-15")).toEqual([
      "2027-01",
      "2027-02",
      "2027-03",
      "2027-04",
      "2027-05",
    ]);
    expect(calendarMonths([], "2026-12-01")).toEqual(["2026-12"]);
    expect(calendarMonths(days, "2027-06-01")).toEqual([
      "2027-04",
      "2027-05",
      "2027-06",
    ]);
  });
});

describe("the .ics file", () => {
  const input = {
    meetingId: "5e5e5e5e-0000-4000-8000-000000000001",
    version: 3,
    title: "Camp call: transport, build crew; tools",
    campName: "Mad Hatters",
    date: "2027-03-21",
    startMinute: 23 * 60 + 30,
    durationMinutes: 60,
    location: null,
    videoLink: "https://meet.example.com/mad-hatters",
    pageUrl: "https://app.example.com/camps/mad-hatters/meetings/5e5e",
    uidDomain: "app.example.com",
    now: new Date("2027-03-01T08:09:10.123Z"),
  };

  it("is RFC 5545: CRLF, a named zone with its definition, escaped text", () => {
    const ics = buildMeetingIcs(input)!;
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "").includes("\n")).toBe(false);
    const lines = ics.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines).toContain("TZID:Africa/Johannesburg");
    expect(lines).toContain("TZOFFSETTO:+0200");
    expect(lines).toContain("DTSTART;TZID=Africa/Johannesburg:20270321T233000");
    // Past midnight: ends the next day.
    expect(lines).toContain("DTEND;TZID=Africa/Johannesburg:20270322T003000");
    expect(lines).toContain("DTSTAMP:20270301T080910Z");
    expect(lines).toContain("SEQUENCE:2");
    expect(lines).toContain(`UID:meeting-${input.meetingId}@app.example.com`);
    expect(lines).toContain(
      "SUMMARY:Camp call: transport\\, build crew\\; tools",
    );
    expect(lines).toContain("LOCATION:Online");
    expect(lines).toContain("URL:https://meet.example.com/mad-hatters");
    for (const line of lines) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("uses the typed place, and leaves out what is not there", () => {
    const ics = buildMeetingIcs({
      ...input,
      location: "Storage unit",
      videoLink: null,
      pageUrl: null,
    })!;
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("LOCATION:Storage unit");
    expect(unfolded).not.toContain("URL:");
    expect(unfolded).toContain("DESCRIPTION:Mad Hatters meeting.\r\n");
    expect(
      buildMeetingIcs({ ...input, location: null, videoLink: null }),
    ).not.toContain("LOCATION");
    expect(buildMeetingIcs({ ...input, date: "2027-02-30" })).toBeNull();
  });

  it("escapes and folds", () => {
    expect(escapeIcsText("a\\b;c,d\ne\r\nf")).toBe("a\\\\b\\;c\\,d\\ne\\nf");
    const long = "SUMMARY:" + "é".repeat(80);
    const folded = foldIcsLine(long);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts)
      expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((p) => p.startsWith(" "))).toBe(true);
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join("")).toBe(long);
    expect(foldIcsLine("SHORT")).toBe("SHORT");
  });

  it("names the download safely", () => {
    expect(
      meetingIcsFilename("Camp call: transport & build crew", "2027-03-21"),
    ).toBe("2027-03-21-camp-call-transport-build-crew.ics");
    expect(
      meetingIcsFilename("Kombuis-vergadering — Désirée", "2027-04-07"),
    ).toBe("2027-04-07-kombuis-vergadering-desiree.ics");
    expect(meetingIcsFilename("🔥🔥", "2027-04-07")).toBe(
      "2027-04-07-meeting.ics",
    );
  });
});

describe("meeting notices", () => {
  const ctx = {
    campName: "Mad Hatters",
    campSlug: "mad-hatters",
    meetingId: "5e5e",
    title: "Camp call",
    date: "2027-03-21",
    startMinute: 19 * 60,
    durationMinutes: 60,
  };

  it("kind meeting, the camp as the body, linked to the meeting page", () => {
    const n = meetingScheduledNotification(ctx, "Alice Hatter");
    expect(n).toEqual({
      kind: "meeting",
      title: "Alice Hatter scheduled Camp call: Sun 21 Mar, 19:00–20:00",
      body: "Mad Hatters",
      link: "/camps/mad-hatters/meetings/5e5e",
    });
  });

  it("moved says from when to when; cancelled says which day", () => {
    const moved = meetingMovedNotification(
      ctx,
      { ...ctx, date: "2027-03-28", startMinute: 18 * 60 },
      "Alice Hatter",
    );
    expect(moved.title).toBe(
      "Alice Hatter moved Camp call (was Sun 21 Mar 19:00) to Sun 28 Mar, 18:00–19:00",
    );
    expect(meetingCancelledNotification(ctx, "Alice Hatter").title).toBe(
      "Alice Hatter cancelled Camp call on Sun 21 Mar",
    );
  });
});
