import { describe, expect, it } from "vitest";
import {
  audienceChipLabel,
  displayLink,
  meetingDurationLabel,
  meetingLongDate,
  meetingMoveSummary,
  meetingReach,
  offeredAudienceRoleIds,
  meetingTimeRange,
  meetingWhenLine,
  monthLabel,
  pickCalendarMonth,
  type ReachMember,
} from "../meeting-view";

// The schedule form's "Shows to N members" guide must agree with the rule
// the server applies (`canViewMeeting`): the chosen roles' holders plus the
// camp's leads and co-leads. Role ids are UUID-shaped like the real ones.

const KITCHEN = "11111111-1111-4111-8111-111111111111";
const SOUND = "22222222-2222-4222-8222-222222222222";
const BASELINE = "33333333-3333-4333-8333-333333333333";

const members: ReachMember[] = [
  { role: "lead", roleIds: [] },
  { role: "admin", roleIds: [] },
  { role: "member", roleIds: [KITCHEN] },
  { role: "member", roleIds: [KITCHEN, SOUND] },
  { role: "member", roleIds: [SOUND] },
  { role: "member", roleIds: [] },
];

describe("meetingReach", () => {
  it("counts every current member for the whole camp", () => {
    expect(
      meetingReach(members, { mode: "everyone", roleIds: [] }, BASELINE),
    ).toEqual({ total: 6, leads: 2 });
  });

  it("counts the chosen roles' holders plus the leads, once each", () => {
    expect(
      meetingReach(members, { mode: "roles", roleIds: [KITCHEN] }, BASELINE),
    ).toEqual({ total: 4, leads: 2 });
    expect(
      meetingReach(
        members,
        { mode: "roles", roleIds: [KITCHEN, SOUND] },
        BASELINE,
      ).total,
    ).toBe(5);
  });

  it("reaches only the leads when no role is picked", () => {
    expect(
      meetingReach(members, { mode: "roles", roleIds: [] }, BASELINE).total,
    ).toBe(2);
  });

  it("treats the baseline role as everyone", () => {
    expect(
      meetingReach(members, { mode: "roles", roleIds: [BASELINE] }, BASELINE)
        .total,
    ).toBe(6);
  });
});

describe("meeting labels", () => {
  it("formats durations in words", () => {
    expect(meetingDurationLabel(60)).toBe("1 hour");
    expect(meetingDurationLabel(30)).toBe("30 minutes");
    expect(meetingDurationLabel(90)).toBe("1 hour 30 minutes");
    expect(meetingDurationLabel(120)).toBe("2 hours");
    expect(meetingDurationLabel(1)).toBe("1 minute");
  });

  it("formats a time range that may cross midnight", () => {
    expect(meetingTimeRange(19 * 60, 60)).toBe("19:00 – 20:00");
    expect(meetingTimeRange(23 * 60 + 30, 60)).toBe("23:30 – 00:30");
  });

  it("writes the next-meeting line and the long date", () => {
    expect(
      meetingWhenLine({
        date: "2027-03-21",
        startMinute: 1140,
        durationMinutes: 60,
      }),
    ).toBe("Sun 21 Mar · 19:00 – 20:00");
    expect(meetingLongDate("2027-03-21")).toBe("Sunday 21 March 2027");
    expect(meetingLongDate("nonsense")).toBe("nonsense");
  });

  it("shows a call link without its scheme", () => {
    expect(displayLink("https://meet.example.com/mad-hatters/")).toBe(
      "meet.example.com/mad-hatters",
    );
  });

  it("names exactly what moved on the edit form", () => {
    const before = {
      date: "2027-03-21",
      startMinute: 1140,
      durationMinutes: 60,
    };
    expect(meetingMoveSummary(before, { ...before })).toBeNull();
    expect(meetingMoveSummary(before, { ...before, startMinute: 1170 })).toBe(
      "You moved the start from 19:00 to 19:30.",
    );
    expect(meetingMoveSummary(before, { ...before, date: "2027-03-22" })).toBe(
      "You moved the day from Sun 21 Mar to Mon 22 Mar.",
    );
    expect(
      meetingMoveSummary(before, {
        date: "2027-03-22",
        startMinute: 1170,
        durationMinutes: 90,
      }),
    ).toBe(
      "You moved the day from Sun 21 Mar to Mon 22 Mar, the start from 19:00 to 19:30 and the length from 1 hour to 1 hour 30 minutes.",
    );
    // A half-typed start is not a move yet.
    expect(
      meetingMoveSummary(before, { ...before, startMinute: null }),
    ).toBeNull();
  });

  it("labels the audience chip", () => {
    expect(audienceChipLabel({ mode: "everyone", roleNames: [] })).toBe(
      "Whole camp",
    );
    expect(
      audienceChipLabel({ mode: "roles", roleNames: ["Kitchen", "Sound"] }),
    ).toBe("Kitchen, Sound");
    expect(audienceChipLabel({ mode: "roles", roleNames: [] })).toBe(
      "Chosen roles",
    );
  });
});

describe("calendar month", () => {
  const months = ["2027-03", "2027-04", "2027-05"];

  it("names a month", () => {
    expect(monthLabel("2027-04")).toBe("April 2027");
    expect(monthLabel("garbage")).toBe("garbage");
  });

  it("honours ?month= only when the switcher offers it", () => {
    expect(pickCalendarMonth(months, "2027-05", "2027-04-02")).toBe("2027-05");
    expect(pickCalendarMonth(months, "2031-01", "2027-04-02")).toBe("2027-04");
    expect(pickCalendarMonth(months, ["2027-05"], "2027-04-02")).toBe(
      "2027-04",
    );
  });

  it("falls back to the first month when today is outside the range", () => {
    expect(pickCalendarMonth(months, undefined, "2026-10-15")).toBe("2027-03");
    expect(pickCalendarMonth([], undefined, "2026-10-15")).toBe("2026-10");
  });
});

describe("offeredAudienceRoleIds", () => {
  const roles = [{ id: "kitchen" }, { id: "sound" }];

  it("keeps the roles the form still offers", () => {
    expect(offeredAudienceRoleIds(["kitchen", "sound"], roles)).toEqual([
      "kitchen",
      "sound",
    ]);
  });

  it("drops a role deleted since, so the meeting stays editable", () => {
    // A deleted role has no toggle: kept, it would be sent on every save and
    // refused as unknown, with no way to remove it.
    expect(offeredAudienceRoleIds(["kitchen", "deleted-role"], roles)).toEqual([
      "kitchen",
    ]);
    expect(offeredAudienceRoleIds(["deleted-role"], roles)).toEqual([]);
  });
});
