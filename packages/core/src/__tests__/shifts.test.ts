import { describe, expect, it } from "vitest";
import { MembershipRole, NotificationKind } from "@quagga/types";
import {
  canManageShifts,
  dayGapLabel,
  decideAcceptHandover,
  decideAssign,
  decideHandTo,
  decideShiftDays,
  decideSignUp,
  decideTakeOffered,
  formatClock,
  formatShiftTime,
  isoDateToMs,
  notificationMentionsAny,
  normalizeTeamName,
  openSpots,
  parseClock,
  shiftAssignedNotification,
  shiftChangedHandsNotification,
  shiftChangedNotification,
  ShiftCreateInput,
  shiftDateLabel,
  shiftDays,
  shiftHandedOnNotification,
  shiftRangeLabel,
  shiftRefusalMessage,
  shiftsOverlap,
  shiftTimingChanged,
  ShiftUpdateInput,
  summariseDays,
  summariseShifts,
  type ShiftFacts,
  type ShiftMemberFacts,
} from "..";

// Values from the real vocabularies (AGENTS.md "Verification").
const LEAD = MembershipRole.enum.lead;
const ADMIN = MembershipRole.enum.admin;
const MEMBER = MembershipRole.enum.member;

// AfrikaBurn 2027 (the seeded edition): 26 April – 2 May.
const EDITION = { startDate: "2027-04-26", endDate: "2027-05-02" };

const SOUND_ROLE = "0b0b0b0b-0000-4000-8000-000000000001";
const M_JABU = "22222222-0000-4000-8000-000000000001";
const M_LERATO = "22222222-0000-4000-8000-000000000002";
const M_REN = "22222222-0000-4000-8000-000000000003";

function shift(overrides: Partial<ShiftFacts> = {}): ShiftFacts {
  return {
    id: "shift-1",
    date: "2027-04-29",
    startMinute: 12 * 60,
    durationMinutes: 180,
    capacity: 2,
    signupMode: "open",
    requiredRoleId: null,
    assignments: [],
    ...overrides,
  };
}

function member(
  membershipId: string,
  overrides: Partial<ShiftMemberFacts> = {},
): ShiftMemberFacts {
  return {
    membershipId,
    heldRoleIds: new Set<string>(),
    otherShifts: [],
    ...overrides,
  };
}

const on = (
  membershipId: string,
  extra: Partial<ShiftFacts["assignments"][number]> = {},
) => ({
  id: `a-${membershipId}`,
  membershipId,
  offered: false,
  handoverToMembershipId: null,
  ...extra,
});

describe("shiftDays — every day of the burn, build and strike included", () => {
  const days = shiftDays(EDITION);

  it("runs from four build days before to one strike day after", () => {
    expect(days[0]).toEqual({ date: "2027-04-22", phase: "build" });
    expect(days.at(-1)).toEqual({ date: "2027-05-03", phase: "strike" });
    expect(days).toHaveLength(4 + 7 + 1);
  });

  it("labels the event days", () => {
    expect(days.filter((d) => d.phase === "event").map((d) => d.date)).toEqual(
      [
        "2027-04-26",
        "2027-04-27",
        "2027-04-28",
        "2027-04-29",
        "2027-04-30",
        "2027-05-01",
        "2027-05-02",
      ],
    );
  });

  it("returns nothing for unusable dates rather than inventing a week", () => {
    expect(shiftDays({ startDate: "2027-02-31", endDate: "2027-03-02" })).toEqual(
      [],
    );
    expect(shiftDays({ startDate: "2027-05-02", endDate: "2027-04-26" })).toEqual(
      [],
    );
  });

  it("rejects a picked day outside the burn", () => {
    expect(decideShiftDays(days, ["2027-04-29"])).toEqual({ ok: true });
    expect(decideShiftDays(days, ["2027-04-21"])).toEqual({
      ok: false,
      reason: "not_a_day",
    });
    expect(decideShiftDays(days, [])).toEqual({
      ok: false,
      reason: "not_a_day",
    });
  });
});

describe("time", () => {
  it("formats and parses the clock", () => {
    expect(formatClock(9 * 60)).toBe("09:00");
    expect(formatClock(24 * 60)).toBe("00:00");
    expect(parseClock("21:30")).toBe(21 * 60 + 30);
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("9am")).toBeNull();
  });

  it("formats a shift that runs past midnight and an all-day shift", () => {
    expect(formatShiftTime(21 * 60, 180)).toBe("21:00–00:00");
    expect(formatShiftTime(12 * 60, 180)).toBe("12:00–15:00");
    expect(formatShiftTime(0, 1440)).toBe("All day");
  });

  it("detects overlap across midnight, and not for touching ends", () => {
    const late = { date: "2027-04-29", startMinute: 22 * 60, durationMinutes: 240 };
    const early = { date: "2027-04-30", startMinute: 60, durationMinutes: 60 };
    expect(shiftsOverlap(late, early)).toBe(true);
    const lunch = { date: "2027-04-29", startMinute: 12 * 60, durationMinutes: 180 };
    const tea = { date: "2027-04-29", startMinute: 15 * 60, durationMinutes: 180 };
    expect(shiftsOverlap(lunch, tea)).toBe(false);
    expect(shiftsOverlap(lunch, { ...tea, startMinute: 14 * 60 })).toBe(true);
    expect(shiftsOverlap(lunch, { ...lunch, date: "2027-04-30" })).toBe(false);
  });

  it("labels dates without a time zone shift", () => {
    expect(shiftDateLabel("2027-04-29")).toMatchObject({
      weekday: "Thu",
      day: 29,
      short: "Thu 29",
      medium: "Thu 29 Apr",
      long: "Thursday 29 April",
    });
    expect(isoDateToMs("2027-02-29")).toBeNull();
  });
});

describe("canManageShifts — the structural lead and co-leads only", () => {
  it("lets a lead and a co-lead manage", () => {
    expect(canManageShifts({ structuralRole: LEAD, rolePermissions: [] })).toBe(
      true,
    );
    expect(canManageShifts({ structuralRole: ADMIN, rolePermissions: [] })).toBe(
      true,
    );
  });

  it("refuses a member, even one holding every custom privilege", () => {
    expect(
      canManageShifts({
        structuralRole: MEMBER,
        rolePermissions: [
          {
            manage_roles: true,
            manage_members: true,
            view_member_details: true,
          },
        ],
      }),
    ).toBe(false);
  });

  it("refuses a non-member (a lead of another camp, or a former member)", () => {
    expect(canManageShifts(null)).toBe(false);
  });
});

describe("decideSignUp", () => {
  it("lets a member take an open spot", () => {
    expect(decideSignUp(shift(), member(M_JABU))).toEqual({ ok: true });
  });

  it("refuses a non-member", () => {
    expect(decideSignUp(shift(), null)).toEqual({
      ok: false,
      reason: "not_member",
    });
  });

  it("refuses a lead-assigned shift", () => {
    expect(
      decideSignUp(shift({ signupMode: "assign" }), member(M_JABU)),
    ).toEqual({ ok: false, reason: "assign_only" });
  });

  it("refuses a full shift — an offered spot is still held", () => {
    const full = shift({
      assignments: [on(M_LERATO), on(M_REN, { offered: true })],
    });
    expect(openSpots(full)).toBe(0);
    expect(decideSignUp(full, member(M_JABU))).toEqual({
      ok: false,
      reason: "full",
    });
  });

  it("refuses signing up twice", () => {
    expect(
      decideSignUp(shift({ assignments: [on(M_JABU)] }), member(M_JABU)),
    ).toEqual({ ok: false, reason: "already_on" });
  });

  it("needs the shift's camp role, held", () => {
    const sound = shift({ requiredRoleId: SOUND_ROLE });
    expect(decideSignUp(sound, member(M_JABU))).toEqual({
      ok: false,
      reason: "needs_role",
    });
    expect(
      decideSignUp(
        sound,
        member(M_JABU, { heldRoleIds: new Set([SOUND_ROLE]) }),
      ),
    ).toEqual({ ok: true });
  });

  it("refuses a clash with the member's other shifts", () => {
    const other = { date: "2027-04-29", startMinute: 14 * 60, durationMinutes: 60 };
    expect(
      decideSignUp(shift(), member(M_JABU, { otherShifts: [other] })),
    ).toEqual({ ok: false, reason: "clash" });
  });
});

describe("decideAssign", () => {
  it("refuses a caller who cannot manage shifts", () => {
    expect(decideAssign(shift(), false, member(M_JABU))).toEqual({
      ok: false,
      reason: "not_manager",
    });
  });

  it("lets a lead assign to a lead-assigned shift", () => {
    expect(
      decideAssign(shift({ signupMode: "assign" }), true, member(M_JABU)),
    ).toEqual({ ok: true });
  });

  it("still enforces the role and the capacity for a lead", () => {
    expect(
      decideAssign(shift({ requiredRoleId: SOUND_ROLE }), true, member(M_JABU)),
    ).toEqual({ ok: false, reason: "needs_role" });
    expect(
      decideAssign(
        shift({ capacity: 1, assignments: [on(M_REN)] }),
        true,
        member(M_JABU),
      ),
    ).toEqual({ ok: false, reason: "full" });
  });

  it("refuses a former member (the store passes null)", () => {
    expect(decideAssign(shift(), true, null)).toEqual({
      ok: false,
      reason: "not_member",
    });
  });
});

describe("hand-on: hand to someone, then they accept", () => {
  const held = shift({ assignments: [on(M_JABU)] });

  it("only the holder can hand a shift on", () => {
    expect(decideHandTo(held, M_REN, member(M_LERATO))).toEqual({
      ok: false,
      reason: "not_on_shift",
    });
    expect(decideHandTo(held, M_JABU, member(M_LERATO))).toEqual({ ok: true });
  });

  it("refuses handing to yourself, to someone already on it, or to a non-member", () => {
    expect(decideHandTo(held, M_JABU, member(M_JABU))).toEqual({
      ok: false,
      reason: "self",
    });
    const both = shift({ assignments: [on(M_JABU), on(M_LERATO)] });
    expect(decideHandTo(both, M_JABU, member(M_LERATO))).toEqual({
      ok: false,
      reason: "already_on",
    });
    expect(decideHandTo(held, M_JABU, null)).toEqual({
      ok: false,
      reason: "not_member",
    });
  });

  it("refuses handing a role-locked shift to someone without the role", () => {
    const sound = shift({
      requiredRoleId: SOUND_ROLE,
      assignments: [on(M_JABU)],
    });
    expect(decideHandTo(sound, M_JABU, member(M_LERATO))).toEqual({
      ok: false,
      reason: "needs_role",
    });
  });

  it("only the person it was handed to can accept", () => {
    const pending = shift({
      assignments: [on(M_JABU, { handoverToMembershipId: M_LERATO })],
    });
    expect(decideAcceptHandover(pending, member(M_LERATO))).toEqual({
      ok: true,
    });
    expect(decideAcceptHandover(pending, member(M_REN))).toEqual({
      ok: false,
      reason: "no_request",
    });
    expect(decideAcceptHandover(held, member(M_LERATO))).toEqual({
      ok: false,
      reason: "no_request",
    });
  });

  it("re-checks at accept time: a clash booked since the request refuses", () => {
    const pending = shift({
      assignments: [on(M_JABU, { handoverToMembershipId: M_LERATO })],
    });
    const clash = { date: "2027-04-29", startMinute: 13 * 60, durationMinutes: 60 };
    expect(
      decideAcceptHandover(pending, member(M_LERATO, { otherShifts: [clash] })),
    ).toEqual({ ok: false, reason: "clash" });
  });
});

describe("hand-on: needs a replacement, anyone eligible takes it", () => {
  const offered = shift({
    capacity: 1,
    assignments: [on(M_JABU, { offered: true })],
  });

  it("an eligible member takes an offered spot even though the shift is full", () => {
    expect(decideTakeOffered(offered, `a-${M_JABU}`, member(M_LERATO))).toEqual(
      { ok: true },
    );
  });

  it("refuses a spot that is not offered (taken back, or already taken)", () => {
    const notOffered = shift({ assignments: [on(M_JABU)] });
    expect(
      decideTakeOffered(notOffered, `a-${M_JABU}`, member(M_LERATO)),
    ).toEqual({ ok: false, reason: "not_offered" });
    expect(decideTakeOffered(offered, "a-missing", member(M_LERATO))).toEqual({
      ok: false,
      reason: "not_offered",
    });
  });

  it("refuses the holder taking their own offer and a member without the role", () => {
    expect(decideTakeOffered(offered, `a-${M_JABU}`, member(M_JABU))).toEqual({
      ok: false,
      reason: "self",
    });
    const sound = { ...offered, requiredRoleId: SOUND_ROLE };
    expect(decideTakeOffered(sound, `a-${M_JABU}`, member(M_LERATO))).toEqual({
      ok: false,
      reason: "needs_role",
    });
  });

  it("refuses a non-member", () => {
    expect(decideTakeOffered(offered, `a-${M_JABU}`, null)).toEqual({
      ok: false,
      reason: "not_member",
    });
  });
});

describe("summaries", () => {
  const counts = [
    { date: "2027-04-29", capacity: 4, filled: 3 },
    { date: "2027-04-29", capacity: 2, filled: 2 },
    { date: "2027-04-30", capacity: 1, filled: 0 },
    { date: "2027-04-22", capacity: 2, filled: 2 },
  ];

  it("counts shifts, spots, gaps and days with gaps", () => {
    expect(summariseShifts(counts)).toEqual({
      shifts: 4,
      spots: 9,
      filled: 7,
      open: 2,
      daysWithGaps: 2,
      percentFilled: 77,
      firstDate: "2027-04-22",
      lastDate: "2027-04-30",
    });
    expect(summariseShifts([]).percentFilled).toBeNull();
  });

  it("never counts more filled than capacity", () => {
    expect(
      summariseShifts([{ date: "2027-04-29", capacity: 1, filled: 3 }]).open,
    ).toBe(0);
  });

  it("summarises each day of the week strip", () => {
    const days = summariseDays(shiftDays(EDITION), counts);
    const thu = days.find((d) => d.date === "2027-04-29")!;
    expect(thu).toMatchObject({ shifts: 2, open: 1, phase: "event" });
    expect(dayGapLabel(thu)).toBe("1 gap");
    expect(dayGapLabel(days.find((d) => d.date === "2027-04-22")!)).toBe(
      "Full",
    );
    expect(dayGapLabel(days.find((d) => d.date === "2027-04-23")!)).toBe(
      "No shifts",
    );
    expect(dayGapLabel({ shifts: 2, open: 3 })).toBe("3 gaps");
  });

  it("labels the range", () => {
    expect(shiftRangeLabel("2027-04-22", "2027-05-03")).toBe("22 Apr – 3 May");
    expect(shiftRangeLabel("2027-04-29", "2027-04-29")).toBe("29 Apr");
    expect(shiftRangeLabel(null, null)).toBeNull();
  });
});

describe("input", () => {
  const base = {
    slug: "camp-404",
    name: "Kitchen · lunch",
    teamId: null,
    startMinute: 720,
    durationMinutes: 180,
    capacity: 4,
    requiredRoleId: null,
    signupMode: "open" as const,
  };

  it("accepts a repeating shift", () => {
    expect(
      ShiftCreateInput.safeParse({ ...base, dates: ["2027-04-29", "2027-04-30"] })
        .success,
    ).toBe(true);
  });

  it("refuses a request naming a member or a group (strict)", () => {
    expect(
      ShiftCreateInput.safeParse({
        ...base,
        dates: ["2027-04-29"],
        groupId: "x",
      }).success,
    ).toBe(false);
    expect(
      ShiftUpdateInput.safeParse({
        ...base,
        id: SOUND_ROLE,
        date: "2027-04-29",
        membershipId: M_JABU,
      }).success,
    ).toBe(false);
  });

  it("bounds capacity, duration and the day", () => {
    const bad = [
      { capacity: 0 },
      { capacity: 51 },
      { durationMinutes: 10 },
      { durationMinutes: 1441 },
      { startMinute: 1440 },
      { name: "  " },
    ];
    for (const b of bad) {
      expect(
        ShiftCreateInput.safeParse({ ...base, dates: ["2027-04-29"], ...b })
          .success,
      ).toBe(false);
    }
    expect(
      ShiftCreateInput.safeParse({ ...base, dates: ["2027-02-31"] }).success,
    ).toBe(false);
  });

  it("normalises team names case- and space-insensitively", () => {
    expect(normalizeTeamName("  Tea   Bar ")).toBe(normalizeTeamName("tea bar"));
  });

  it("notices when an edit moved the shift", () => {
    const a = { date: "2027-04-29", startMinute: 720, durationMinutes: 180 };
    expect(shiftTimingChanged(a, { ...a })).toBe(false);
    expect(shiftTimingChanged(a, { ...a, startMinute: 780 })).toBe(true);
    expect(shiftTimingChanged(a, { ...a, date: "2027-04-30" })).toBe(true);
  });
});

describe("notifications", () => {
  const ctx = {
    campName: "Camp 404",
    campSlug: "camp-404",
    shiftName: "Kitchen · lunch",
    date: "2027-04-29",
    startMinute: 720,
    durationMinutes: 180,
  };

  it("uses the shift kind and links to the member's own schedule", () => {
    const n = shiftAssignedNotification(ctx, "Alice Hatter");
    expect(NotificationKind.parse(n.kind)).toBe("shift");
    expect(n.title).toBe(
      "Alice Hatter put you on Kitchen · lunch on Thu 29 Apr, 12:00–15:00",
    );
    expect(n.body).toBe("Camp 404");
    expect(n.link).toBe("/camps/camp-404/shifts/mine");
  });

  it("reads the design's hand-on copy", () => {
    expect(shiftHandedOnNotification(ctx, "Lerato", "accepted").title).toBe(
      "Lerato accepted your Kitchen · lunch on Thu 29 Apr — it's theirs now",
    );
    const lead = shiftChangedHandsNotification(ctx, "Jabu", "Lerato");
    expect(lead.title).toBe(
      "Kitchen · lunch on Thu 29 Apr changed hands — Jabu to Lerato",
    );
    expect(lead.link).toBe("/camps/camp-404/shifts?day=2027-04-29");
  });

  it("names the old and the new time when a shift moves", () => {
    const n = shiftChangedNotification(
      ctx,
      { ...ctx, date: "2027-05-01", startMinute: 960 },
      "Alice Hatter",
    );
    expect(n.title).toBe(
      "Alice Hatter moved Kitchen · lunch on Thu 29 Apr to Sat 1 May, 16:00–19:00",
    );
  });

  it("carries no private field", () => {
    const n = shiftAssignedNotification(ctx, "Alice Hatter");
    expect(notificationMentionsAny(n, ["+27 82 555 0100", "8001015009087"])).toBe(
      false,
    );
  });

  it("has a sentence for every refusal", () => {
    for (const r of [
      "not_member",
      "not_manager",
      "assign_only",
      "full",
      "already_on",
      "needs_role",
      "clash",
      "not_on_shift",
      "not_offered",
      "no_request",
      "self",
      "not_a_day",
    ] as const) {
      expect(shiftRefusalMessage(r).length).toBeGreaterThan(5);
    }
    expect(shiftRefusalMessage("needs_role", "Sound Officer")).toBe(
      "This shift needs the Sound Officer role.",
    );
  });
});
