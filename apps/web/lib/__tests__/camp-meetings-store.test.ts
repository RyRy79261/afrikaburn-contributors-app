import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@quagga/db";
import { MEETING_AUDIT } from "@quagga/core";
import {
  GroupKind,
  MembershipRole,
  NotificationKind,
  type MeetingAudience,
  type ProjectPermissions,
} from "@quagga/types";
import { boundStrings, dbMock, nullChecksOn } from "@/test/db-mock";

// Camp meetings (docs/camp-meetings-spec.md) — the store. What these pin is
// the DECISION: who is refused (and that a refusal writes nothing), that a
// meeting outside the viewer's audience answers exactly as a missing one,
// that edits are compare-and-set on the version, that every write parses its
// input before the database is touched, what is audited, and who is told.
// The db mock cannot see a WHERE clause beyond what `boundStrings` /
// `nullChecksOn` read off it; the persona suite drives the real SQL.

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

const store = await import("../camp-meetings-store");

// Values from the real vocabularies (AGENTS.md "Verification").
const LEAD = MembershipRole.enum.lead;
const MEMBER = MembershipRole.enum.member;
const THEME_CAMP = GroupKind.enum.theme_camp;
const ORG = GroupKind.enum.org;
const MEETING_KIND = NotificationKind.enum.meeting;

const CAMP = "11111111-0000-4000-8000-00000000000a";
const EDITION = {
  id: "eeeeeeee-0000-4000-8000-000000000001",
  startDate: "2027-04-26",
  endDate: "2027-05-02",
};
const MEETING = "5e5e5e5e-0000-4000-8000-000000000001";
const BASELINE = "0b0b0b0b-0000-4000-8000-000000000000";
const KITCHEN = "0b0b0b0b-0000-4000-8000-000000000001";
const SCHEDULERS = "0b0b0b0b-0000-4000-8000-000000000002";
const ALICE = "aaaaaaaa-0000-4000-8000-000000000001"; // lead
const JABU = "aaaaaaaa-0000-4000-8000-000000000002"; // member, kitchen
const REN = "aaaaaaaa-0000-4000-8000-000000000003"; // member
const GONE = "aaaaaaaa-0000-4000-8000-000000000004"; // erased account

const camp = (kind: GroupKind = THEME_CAMP) => ({
  id: CAMP,
  name: "Mad Hatters",
  slug: "mad-hatters",
  kind,
});

const ROLES = [
  {
    id: BASELINE,
    name: "Everyone",
    kind: "baseline",
    permissions: {},
    officerKey: null,
  },
  {
    id: KITCHEN,
    name: "Kitchen wizard",
    kind: "custom",
    permissions: {},
    officerKey: null,
  },
  {
    id: SCHEDULERS,
    name: "Meeting planner",
    kind: "custom",
    permissions: { schedule_meetings: true } satisfies ProjectPermissions,
    officerKey: null,
  },
];

const EVERYONE: MeetingAudience = {
  kind: "project",
  groupId: CAMP,
  mode: "everyone",
  roleIds: [],
};
const KITCHEN_ONLY: MeetingAudience = {
  ...EVERYONE,
  mode: "roles",
  roleIds: [KITCHEN],
};

function meetingRow(over: Record<string, unknown> = {}) {
  return {
    id: MEETING,
    groupId: CAMP,
    title: "Camp call",
    date: "2027-03-21",
    startMinute: 19 * 60,
    durationMinutes: 60,
    location: null,
    videoLink: "https://meet.example.com/mad-hatters",
    audience: EVERYONE,
    agendaMd: "1. Transport",
    notesMd: "",
    version: 2,
    cancelledAt: null,
    cancelledByUserId: null,
    notesUpdatedAt: null,
    notesUpdatedByUserId: null,
    createdByUserId: ALICE,
    ...over,
  };
}

/** The camp's current members and their accepted roles, as
 * `loadCampMembers` reads them (two chains). */
function queueMembers() {
  dbMock.queue(
    [
      {
        membershipId: "m-alice",
        userId: ALICE,
        role: LEAD,
        username: "Alice Hatter",
        sanitizedAt: null,
      },
      {
        membershipId: "m-jabu",
        userId: JABU,
        role: MEMBER,
        username: "Jabu",
        sanitizedAt: null,
      },
      {
        membershipId: "m-ren",
        userId: REN,
        role: MEMBER,
        username: "Ren Notfound",
        sanitizedAt: null,
      },
      {
        membershipId: "m-gone",
        userId: GONE,
        role: MEMBER,
        username: null,
        sanitizedAt: new Date(),
      },
    ],
    [
      { membershipId: "m-jabu", projectRoleId: KITCHEN },
      { membershipId: "m-gone", projectRoleId: KITCHEN },
    ],
  );
}

/** `recipientsFor`: members (two chains), the camp's roles, then the
 * members' team seats (`loadCampMembers`' last chain). */
function queueRecipients(seats: unknown[] = []) {
  queueMembers();
  dbMock.queue(ROLES, seats);
}

/** A team as `loadCampTeams` reads it, and a seat as `loadTeamSeats` does. */
interface TeamRows {
  teams?: { id: string; name: string; archivedAt: Date | null; sort: number }[];
  seats?: { teamId: string; isLead: boolean; archivedAt: Date | null }[];
}

/** `loadMeetingsAccess` for one viewer. */
function queueAccess(
  role: MembershipRole | null,
  held: string[] = [],
  team: TeamRows = {},
) {
  dbMock.queue([camp()]);
  if (role === null) {
    dbMock.queue([]);
    return;
  }
  dbMock.queue(
    [{ id: "m-viewer", role }],
    ROLES,
    held.map((projectRoleId) => ({ projectRoleId })),
    // the camp's teams, then the viewer's seats
    team.teams ?? [],
    team.seats ?? [],
  );
}

/** The front half of every write: the camp, then the locked actor and its
 * roles. */
function queueActor(
  role: MembershipRole | null,
  held: string[] = [],
  username = "Alice Hatter",
  team: TeamRows = {},
) {
  dbMock.queue([camp()]);
  if (role === null) {
    dbMock.queue([]);
    return;
  }
  dbMock.queue(
    [{ membershipId: "m-actor", role, username, groupKind: THEME_CAMP }],
    ROLES,
    held.map((projectRoleId) => ({ projectRoleId })),
    // the camp's teams, then the actor's seats (both locked)
    team.teams ?? [],
    team.seats ?? [],
  );
}

async function access(
  role: MembershipRole,
  held: string[] = [],
  userId = ALICE,
) {
  queueAccess(role, held);
  const a = await store.loadMeetingsAccess("mad-hatters", userId);
  if (!a) throw new Error("expected access");
  dbMock.reset();
  return a;
}

const form = {
  slug: "mad-hatters",
  title: "Camp call",
  date: "2027-03-21",
  startMinute: 19 * 60,
  durationMinutes: 60,
  location: "",
  videoLink: "https://meet.example.com/mad-hatters",
  mode: "everyone" as const,
  roleIds: [],
  agendaMd: "1. Transport",
};

function notices() {
  return dbMock.writesTo(schema.notifications).flatMap(
    (q) =>
      q.arg("values") as Array<{
        userId: string;
        kind: string;
        title: string;
        link: string;
      }>,
  );
}

function audits() {
  return dbMock.writesTo(schema.auditEvents).map(
    (q) =>
      q.arg("values") as {
        action: string;
        subject: string;
        meta: Record<string, unknown>;
      },
  );
}

beforeEach(() => {
  dbMock.reset();
});

describe("access", () => {
  it("a current member of a project gets access; schedulers are told so", async () => {
    queueAccess(MEMBER, [SCHEDULERS]);
    const a = await store.loadMeetingsAccess("mad-hatters", JABU);
    expect(a?.canSchedule).toBe(true);
    expect(a?.baselineRoleId).toBe(BASELINE);
    expect(a?.roles.map((r) => r.name)).toContain("Kitchen wizard");
    // The membership read is the ACTIVE one and the account is not erased.
    const membershipRead = dbMock.queriesTouching(schema.memberships)[0]!;
    expect(nullChecksOn(membershipRead, schema.memberships.archivedAt)).toEqual(
      ["is null"],
    );
    expect(nullChecksOn(membershipRead, schema.users.sanitizedAt)).toEqual([
      "is null",
    ]);
  });

  it("a plain member cannot schedule", async () => {
    queueAccess(MEMBER, [KITCHEN]);
    expect(
      (await store.loadMeetingsAccess("mad-hatters", JABU))?.canSchedule,
    ).toBe(false);
  });

  it("non-members, unknown camps and the org group get nothing", async () => {
    queueAccess(null);
    expect(await store.loadMeetingsAccess("mad-hatters", REN)).toBeNull();
    dbMock.queue([]);
    expect(await store.loadMeetingsAccess("nowhere", REN)).toBeNull();
    dbMock.queue([camp(ORG)]);
    expect(await store.loadMeetingsAccess("afrikaburn", REN)).toBeNull();
  });
});

describe("reads", () => {
  it("lists only the meetings meant for the viewer, split upcoming / past", async () => {
    const a = await access(MEMBER, [], REN);
    dbMock.queue(
      [
        meetingRow({ id: "past", date: "2027-02-21", notesMd: "## Budget" }),
        meetingRow({
          id: "kitchen",
          date: "2027-04-07",
          audience: KITCHEN_ONLY,
          createdByUserId: JABU,
        }),
        meetingRow({ id: "next", date: "2027-04-18" }),
        meetingRow({
          id: "off",
          date: "2027-04-10",
          cancelledAt: new Date("2027-03-01"),
        }),
      ],
      [{ meetingId: "past", count: 12 }],
    );
    const { upcoming, past } = await store.listCampMeetings(
      a,
      EDITION,
      new Date("2027-03-25T10:00:00Z"),
    );
    expect(upcoming.map((m) => m.id)).toEqual(["next"]);
    expect(past.map((m) => m.id)).toEqual(["off", "past"]);
    expect(past[1]).toMatchObject({ attendeeCount: 12, hasNotes: true });
    expect(past[0]).toMatchObject({ attendeeCount: 0, hasNotes: false });
  });

  it("a lead sees a meeting for chosen roles, with the role names", async () => {
    const a = await access(LEAD);
    dbMock.queue(
      [meetingRow({ audience: KITCHEN_ONLY, date: "2027-04-07" })],
      [],
    );
    const { upcoming } = await store.listCampMeetings(
      a,
      EDITION,
      new Date("2027-03-25T10:00:00Z"),
    );
    expect(upcoming[0]?.audience).toEqual({
      mode: "roles",
      roleNames: ["Kitchen wizard"],
      teamNames: [],
    });
  });

  it("an empty list asks for no counts", async () => {
    const a = await access(MEMBER, [], REN);
    dbMock.queue([]);
    expect(await store.listCampMeetings(a, EDITION, new Date())).toEqual({
      upcoming: [],
      past: [],
    });
    expect(dbMock.pending).toBe(0);
    expect(dbMock.queries).toHaveLength(1);
  });

  it("the next meeting is the soonest the viewer may see", async () => {
    const a = await access(MEMBER, [], REN);
    dbMock.queue([
      meetingRow({
        id: "kitchen",
        date: "2027-04-01",
        audience: KITCHEN_ONLY,
        createdByUserId: JABU,
      }),
      meetingRow({ id: "call", date: "2027-04-18" }),
    ]);
    const next = await store.getNextCampMeeting(
      a,
      EDITION,
      new Date("2027-03-25T10:00:00Z"),
    );
    expect(next?.id).toBe("call");
    dbMock.queue([]);
    expect(await store.getNextCampMeeting(a, EDITION, new Date())).toBeNull();
  });

  it("a meeting outside the viewer's audience is the same null as a missing one", async () => {
    const a = await access(MEMBER, [], REN);
    dbMock.queue([
      meetingRow({ audience: KITCHEN_ONLY, createdByUserId: JABU }),
    ]);
    expect(await store.loadCampMeeting(a, EDITION, MEETING)).toBeNull();
    dbMock.queue([]);
    expect(await store.loadCampMeeting(a, EDITION, MEETING)).toBeNull();
    // A malformed id never reaches the database.
    dbMock.reset();
    expect(await store.loadCampMeeting(a, EDITION, "not-a-uuid")).toBeNull();
    expect(dbMock.queries).toHaveLength(0);
  });

  it("a member reads the page and who came, without the tick list", async () => {
    const a = await access(MEMBER, [], REN);
    dbMock.queue(
      [meetingRow({ notesMd: "## Transport", notesUpdatedByUserId: JABU })],
      [{ userId: JABU }, { userId: GONE }],
      [
        { id: ALICE, username: "Alice Hatter", sanitizedAt: null },
        { id: JABU, username: "Jabu", sanitizedAt: null },
        { id: GONE, username: null, sanitizedAt: new Date() },
      ],
    );
    const m = await store.loadCampMeeting(a, EDITION, MEETING);
    expect(m).toMatchObject({
      canEdit: false,
      canEditNotes: false,
      tickList: null,
      createdByName: "Alice Hatter",
      notesUpdatedByName: "Jabu",
      cancelledByName: null,
      attendeeCount: 2,
      version: 2,
      audienceRoleIds: [],
    });
    expect(m?.attendees.map((p) => p.userId).sort()).toEqual(
      [GONE, JABU].sort(),
    );
    // The erased account reads as departed, never by its old name.
    expect(m?.attendees.find((p) => p.userId === GONE)?.name).not.toBe("");
  });

  it("a note-taker gets the tick list: everyone who can see it, never an erased account", async () => {
    const a = await access(LEAD);
    dbMock.queue(
      [meetingRow({ audience: KITCHEN_ONLY })],
      [{ userId: JABU }],
      [
        { id: ALICE, username: "Alice Hatter", sanitizedAt: null },
        { id: JABU, username: "Jabu", sanitizedAt: null },
      ],
    );
    queueMembers();
    const m = await store.loadCampMeeting(a, EDITION, MEETING);
    expect(m?.canEdit).toBe(true);
    expect(m?.audienceRoleIds).toEqual([KITCHEN]);
    // Kitchen (Jabu) and the lead (Alice); not Ren, not the erased account.
    expect(m?.tickList).toEqual([
      { userId: ALICE, name: "Alice Hatter", came: false },
      { userId: JABU, name: "Jabu", came: true },
    ]);
  });

  it("the calendar holds the edition's days, my meetings and only my shifts", async () => {
    const a = await access(MEMBER, [], REN);
    dbMock.queue(
      [
        meetingRow({ date: "2027-04-07" }),
        meetingRow({ id: "k", audience: KITCHEN_ONLY, createdByUserId: JABU }),
      ],
      [
        {
          id: "s1",
          name: "Tea bar",
          date: "2027-04-27",
          startMinute: 840,
          durationMinutes: 180,
        },
      ],
    );
    const days = await store.loadCampCalendar(a, EDITION);
    const byDate = new Map(days.map((d) => [d.date, d]));
    expect(byDate.get("2027-04-07")?.entries).toHaveLength(1);
    expect(byDate.get("2027-04-27")?.entries[0]).toMatchObject({
      kind: "shift",
      title: "Tea bar",
    });
    expect(byDate.get("2027-04-22")?.phase).toBe("build");
    // The shift read is scoped to the viewer and their active membership.
    const shiftRead = dbMock.queriesTouching(schema.shifts)[0]!;
    expect(boundStrings(shiftRead)).toContain(REN);
    expect(nullChecksOn(shiftRead, schema.memberships.archivedAt)).toEqual([
      "is null",
    ]);
  });

  it("the .ics file: for a visible, live meeting only", async () => {
    const a = await access(MEMBER, [], REN);
    dbMock.queue([meetingRow()]);
    const file = await store.buildCampMeetingIcs(a, EDITION, MEETING, {
      now: new Date("2027-03-01T08:00:00Z"),
      origin: "https://app.example.com",
    });
    expect(file?.filename).toBe("2027-03-21-camp-call.ics");
    expect(file?.body).toContain(
      "DTSTART;TZID=Africa/Johannesburg:20270321T190000",
    );
    expect(file?.body).toContain(`UID:meeting-${MEETING}@app.example.com`);
    expect(file?.body.replace(/\r\n /g, "")).toContain(
      `https://app.example.com/camps/mad-hatters/meetings/${MEETING}`,
    );

    dbMock.queue([meetingRow({ cancelledAt: new Date() })]);
    expect(
      await store.buildCampMeetingIcs(a, EDITION, MEETING, {
        now: new Date(),
        origin: "x",
      }),
    ).toBeNull();
    dbMock.queue([
      meetingRow({ audience: KITCHEN_ONLY, createdByUserId: JABU }),
    ]);
    expect(
      await store.buildCampMeetingIcs(a, EDITION, MEETING, {
        now: new Date(),
        origin: "x",
      }),
    ).toBeNull();
    dbMock.queue([meetingRow({ date: "2027-02-30" })]);
    expect(
      await store.buildCampMeetingIcs(a, EDITION, MEETING, {
        now: new Date(),
        origin: "x",
      }),
    ).toBeNull();
    expect(
      await store.buildCampMeetingIcs(a, EDITION, "nope", {
        now: new Date(),
        origin: "x",
      }),
    ).toBeNull();
  });

  it("the .ics file without a usable origin has no page link", async () => {
    const a = await access(MEMBER, [], REN);
    dbMock.queue([meetingRow()]);
    const file = await store.buildCampMeetingIcs(a, EDITION, MEETING, {
      now: new Date(),
      origin: "not a url",
    });
    expect(file?.body.replace(/\r\n /g, "")).toContain(
      "@contributors.afrikaburn.invalid",
    );
    expect(file?.body).not.toContain("Agenda and notes");
  });
});

describe("scheduling", () => {
  it("refuses a bad form before the database is touched", async () => {
    const r = await store.createCampMeeting(ALICE, EDITION, {
      ...form,
      videoLink: "http://x.example.com",
    });
    expect(r.ok).toBe(false);
    expect(dbMock.queries).toHaveLength(0);
  });

  it("a plain member is refused and nothing is written", async () => {
    queueActor(MEMBER, [KITCHEN], "Jabu");
    const r = await store.createCampMeeting(JABU, EDITION, form);
    expect(r).toEqual({
      ok: false,
      error: expect.stringContaining("Only the camp's leads"),
    });
    expect(dbMock.queriesOfKind("insert")).toHaveLength(0);
  });

  it("a non-member, an erased account and an unknown camp all get not-found", async () => {
    queueActor(null);
    expect(await store.createCampMeeting(REN, EDITION, form)).toEqual({
      ok: false,
      error: "That meeting doesn't exist.",
    });
    dbMock.reset();
    dbMock.queue([]);
    expect((await store.createCampMeeting(REN, EDITION, form)).ok).toBe(false);
    expect(dbMock.transactions).toBe(0);
    // The actor lock is the active, not-erased membership, held FOR SHARE.
    dbMock.reset();
    queueActor(null);
    await store.createCampMeeting(REN, EDITION, form);
    const lock = dbMock.queriesTouching(schema.memberships)[0]!;
    expect(lock.called("for")).toBe(true);
    expect(nullChecksOn(lock, schema.memberships.archivedAt)).toEqual([
      "is null",
    ]);
    expect(nullChecksOn(lock, schema.users.sanitizedAt)).toEqual(["is null"]);
  });

  it("refuses roles from another camp", async () => {
    queueActor(LEAD);
    const r = await store.createCampMeeting(ALICE, EDITION, {
      ...form,
      mode: "roles",
      roleIds: ["0b0b0b0b-0000-4000-8000-0000000000ff"],
    });
    expect(r).toEqual({
      ok: false,
      error: expect.stringContaining("doesn't exist any more"),
    });
    expect(dbMock.queriesOfKind("insert")).toHaveLength(0);
  });

  it("a schedule_meetings holder schedules; the audience is told, never the author", async () => {
    queueActor(MEMBER, [SCHEDULERS], "Ren Notfound");
    dbMock.queue([{ id: MEETING }], /* audit */ []);
    queueRecipients();
    const r = await store.createCampMeeting(REN, EDITION, form);
    expect(r).toEqual({ ok: true, id: MEETING, version: 1 });

    const insert = dbMock.writesTo(schema.campMeetings)[0]!;
    expect(insert.tx).toBe(true);
    expect(insert.arg("values")).toMatchObject({
      groupId: CAMP,
      editionId: EDITION.id,
      meetingDate: "2027-03-21",
      location: null,
      audience: EVERYONE,
      version: 1,
      createdByUserId: REN,
    });
    expect(audits()).toEqual([
      expect.objectContaining({
        action: MEETING_AUDIT.create,
        subject: MEETING,
        meta: {
          meetingId: MEETING,
          groupId: CAMP,
          editionId: EDITION.id,
          audience: "everyone",
          roles: 0,
          teams: 0,
        },
      }),
    ]);
    const sent = notices();
    expect(sent.map((n) => n.userId).sort()).toEqual([ALICE, JABU].sort());
    expect(sent[0]).toMatchObject({
      kind: MEETING_KIND,
      title: "Ren Notfound scheduled Camp call: Sun 21 Mar, 19:00–20:00",
      link: `/camps/mad-hatters/meetings/${MEETING}`,
    });
    // After the commit, outside the transaction.
    expect(dbMock.writesTo(schema.notifications)[0]!.tx).toBe(false);
  });

  it("a meeting for chosen roles tells only those roles", async () => {
    queueActor(LEAD);
    dbMock.queue([{ id: MEETING }], []);
    queueRecipients();
    await store.createCampMeeting(ALICE, EDITION, {
      ...form,
      mode: "roles",
      roleIds: [KITCHEN],
    });
    expect(notices().map((n) => n.userId)).toEqual([JABU]);
  });

  it("a failed notice never fails the change", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    queueActor(LEAD);
    dbMock.queue([{ id: MEETING }], []);
    queueRecipients();
    dbMock.queue(new Error("notifications down"));
    const r = await store.createCampMeeting(ALICE, EDITION, form);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(
      "[notifications] meeting notice failed",
      expect.any(Error),
    );
    spy.mockRestore();
  });
});

describe("editing and cancelling", () => {
  const edit = { ...form, id: MEETING, expectedVersion: 2 };

  it("a stale version is refused and nobody is told", async () => {
    queueActor(LEAD);
    dbMock.queue([meetingRow({ version: 3 })]);
    const r = await store.updateCampMeeting(ALICE, EDITION, edit);
    expect(r).toEqual({
      ok: false,
      error: expect.stringContaining("Someone else saved"),
    });
    expect(dbMock.queriesOfKind("update")).toHaveLength(0);
    expect(notices()).toHaveLength(0);
  });

  it("a lost race on the UPDATE itself is stale too", async () => {
    queueActor(LEAD);
    dbMock.queue([meetingRow()]);
    queueRecipients();
    dbMock.queue(/* update returning */ []);
    const r = await store.updateCampMeeting(ALICE, EDITION, edit);
    expect(r.ok).toBe(false);
    expect(audits()).toHaveLength(0);
  });

  it("a member outside the audience gets not-found; a member inside it, not-allowed", async () => {
    queueActor(MEMBER, [], "Ren Notfound");
    dbMock.queue([
      meetingRow({ audience: KITCHEN_ONLY, createdByUserId: JABU }),
    ]);
    expect(await store.updateCampMeeting(REN, EDITION, edit)).toEqual({
      ok: false,
      error: "That meeting doesn't exist.",
    });
    dbMock.reset();
    queueActor(MEMBER, [], "Ren Notfound");
    dbMock.queue([meetingRow()]);
    expect(
      (await store.updateCampMeeting(REN, EDITION, edit)) as { error: string },
    ).toMatchObject({
      error: expect.stringContaining("Only the camp's leads"),
    });
    dbMock.reset();
    queueActor(LEAD);
    dbMock.queue([]);
    expect((await store.updateCampMeeting(ALICE, EDITION, edit)).ok).toBe(
      false,
    );
  });

  it("moving it: compare-and-set, audited, and the audience is told it moved", async () => {
    queueActor(LEAD);
    dbMock.queue([meetingRow()]);
    queueRecipients();
    dbMock.queue([{ version: 3 }], /* audit */ []);
    queueRecipients();
    const r = await store.updateCampMeeting(ALICE, EDITION, {
      ...edit,
      startMinute: 18 * 60,
    });
    expect(r).toEqual({ ok: true, version: 3 });
    const update = dbMock.writesTo(schema.campMeetings)[0]!;
    expect(update.arg("set")).toMatchObject({
      startMinute: 18 * 60,
      version: 3,
      updatedByUserId: ALICE,
    });
    expect(audits()[0]).toMatchObject({
      action: MEETING_AUDIT.update,
      meta: expect.objectContaining({ version: 3, timingChanged: true }),
    });
    const sent = notices();
    expect(sent.map((n) => n.userId)).toEqual([JABU, REN]);
    expect(sent[0]!.title).toBe(
      "Alice Hatter moved Camp call (was Sun 21 Mar 19:00) to Sun 21 Mar, 18:00–19:00",
    );
  });

  it("a title fix tells nobody; widening the audience tells the new people it was scheduled", async () => {
    queueActor(LEAD);
    dbMock.queue([meetingRow({ audience: KITCHEN_ONLY })]);
    queueRecipients();
    dbMock.queue([{ version: 3 }], []);
    queueRecipients();
    await store.updateCampMeeting(ALICE, EDITION, {
      ...edit,
      title: "Camp call (fixed)",
    });
    const sent = notices();
    expect(sent.map((n) => n.userId)).toEqual([REN]);
    expect(sent[0]!.title).toContain("scheduled Camp call (fixed)");
  });

  it("a cancelled meeting can't be edited", async () => {
    queueActor(LEAD);
    dbMock.queue([meetingRow({ cancelledAt: new Date() })]);
    expect(
      (await store.updateCampMeeting(ALICE, EDITION, edit)) as {
        error: string;
      },
    ).toMatchObject({
      error: expect.stringContaining("cancelled"),
    });
  });

  it("cancelling: stamped, audited, and everyone it was for is told", async () => {
    queueActor(LEAD);
    dbMock.queue([meetingRow()], [{ version: 3 }], /* audit */ []);
    queueRecipients();
    const r = await store.cancelCampMeeting(ALICE, EDITION, {
      slug: "mad-hatters",
      id: MEETING,
      expectedVersion: 2,
    });
    expect(r).toEqual({ ok: true, version: 3 });
    const set = dbMock.writesTo(schema.campMeetings)[0]!.arg("set") as Record<
      string,
      unknown
    >;
    expect(set.cancelledAt).toBeInstanceOf(Date);
    expect(set.cancelledByUserId).toBe(ALICE);
    expect(audits()[0]?.action).toBe(MEETING_AUDIT.cancel);
    expect(notices().map((n) => n.title)).toEqual([
      "Alice Hatter cancelled Camp call on Sun 21 Mar",
      "Alice Hatter cancelled Camp call on Sun 21 Mar",
    ]);
  });

  it("cancelling twice, stale, unseen or by a bad form is refused", async () => {
    expect(
      (await store.cancelCampMeeting(ALICE, EDITION, { slug: "x", id: "y" }))
        .ok,
    ).toBe(false);
    queueActor(LEAD);
    dbMock.queue([meetingRow({ cancelledAt: new Date() })]);
    expect(
      (
        await store.cancelCampMeeting(ALICE, EDITION, {
          slug: "mad-hatters",
          id: MEETING,
          expectedVersion: 2,
        })
      ).ok,
    ).toBe(false);
    dbMock.reset();
    queueActor(LEAD);
    dbMock.queue([meetingRow()], /* lost race */ []);
    expect(
      (
        await store.cancelCampMeeting(ALICE, EDITION, {
          slug: "mad-hatters",
          id: MEETING,
          expectedVersion: 2,
        })
      ).ok,
    ).toBe(false);
    dbMock.reset();
    queueActor(LEAD);
    dbMock.queue([]);
    expect(
      (
        await store.cancelCampMeeting(ALICE, EDITION, {
          slug: "mad-hatters",
          id: MEETING,
          expectedVersion: 2,
        })
      ).ok,
    ).toBe(false);
    expect(notices()).toHaveLength(0);
    expect(audits()).toHaveLength(0);
    expect(
      (await store.updateCampMeeting(ALICE, EDITION, { slug: "x" })).ok,
    ).toBe(false);
  });
});

describe("notes", () => {
  const save = {
    slug: "mad-hatters",
    id: MEETING,
    expectedVersion: 2,
    notesMd: "## Transport",
  };

  it("the person who scheduled it saves notes: compare-and-set, audited, nobody told", async () => {
    queueActor(MEMBER, [], "Jabu");
    dbMock.queue([meetingRow({ createdByUserId: JABU })], [{ version: 3 }], []);
    const r = await store.saveCampMeetingNotes(JABU, EDITION, save);
    expect(r).toEqual({ ok: true, version: 3 });
    const update = dbMock.writesTo(schema.campMeetings)[0]!;
    expect(update.arg("set")).toMatchObject({
      notesMd: "## Transport",
      notesUpdatedByUserId: JABU,
      version: 3,
    });
    expect(audits()[0]).toMatchObject({
      action: MEETING_AUDIT.notes,
      meta: { meetingId: MEETING, groupId: CAMP, version: 3 },
    });
    expect(notices()).toHaveLength(0);
  });

  it("a member who neither scheduled it nor may schedule is refused", async () => {
    queueActor(MEMBER, [], "Ren Notfound");
    dbMock.queue([meetingRow()]);
    expect(
      (await store.saveCampMeetingNotes(REN, EDITION, save)) as {
        error: string;
      },
    ).toMatchObject({
      error: expect.stringContaining("write its notes"),
    });
    expect(dbMock.queriesOfKind("update")).toHaveLength(0);
  });

  it("someone else's save first is stale; my own lost response is saved", async () => {
    queueActor(LEAD);
    dbMock.queue([
      meetingRow({ version: 3, notesMd: "theirs", notesUpdatedByUserId: REN }),
    ]);
    expect((await store.saveCampMeetingNotes(ALICE, EDITION, save)).ok).toBe(
      false,
    );
    dbMock.reset();
    queueActor(LEAD);
    dbMock.queue([
      meetingRow({
        version: 3,
        notesMd: "## Transport",
        notesUpdatedByUserId: ALICE,
      }),
    ]);
    expect(await store.saveCampMeetingNotes(ALICE, EDITION, save)).toEqual({
      ok: true,
      version: 3,
    });
    expect(dbMock.queriesOfKind("update")).toHaveLength(0);
  });

  it("a lost race on the UPDATE is stale; a missing meeting and a bad form are refused", async () => {
    queueActor(LEAD);
    dbMock.queue([meetingRow()], []);
    expect((await store.saveCampMeetingNotes(ALICE, EDITION, save)).ok).toBe(
      false,
    );
    dbMock.reset();
    queueActor(LEAD);
    dbMock.queue([]);
    expect((await store.saveCampMeetingNotes(ALICE, EDITION, save)).ok).toBe(
      false,
    );
    expect(
      (
        await store.saveCampMeetingNotes(ALICE, EDITION, {
          ...save,
          notesMd: 5,
        })
      ).ok,
    ).toBe(false);
  });
});

describe("who came", () => {
  const tick = { slug: "mad-hatters", id: MEETING, userId: JABU, came: true };

  it("a note-taker ticks a member who could see it", async () => {
    queueActor(LEAD);
    dbMock.queue([meetingRow({ audience: KITCHEN_ONLY })]);
    dbMock.queue([{ sanitizedAt: null }]);
    queueMembers();
    expect(await store.setCampMeetingAttendance(ALICE, EDITION, tick)).toEqual({
      ok: true,
    });
    // The ticked person's rows are held FOR SHARE first, so an account
    // erasure in flight is waited for and seen (account-sanitize.ts 2g).
    // The ticked person's lock, not the note-taker's own (same shape).
    const lock = dbMock
      .queriesTouching(schema.memberships)
      .find(
        (q) =>
          q.kind === "select" &&
          q.called("for") &&
          boundStrings(q).includes(JABU),
      )!;
    expect(lock).toBeDefined();
    expect(lock.tx).toBe(true);
    expect(lock.arg("for")).toBe("share");
    const of = (
      lock.calls.find((c) => c.method === "for")!.args[1] as {
        of: unknown;
      }
    ).of;
    expect([of].flat()).toEqual(
      expect.arrayContaining([schema.memberships, schema.users]),
    );
    const insert = dbMock.writesTo(schema.campMeetingAttendees)[0]!;
    expect(insert.arg("values")).toEqual({
      meetingId: MEETING,
      userId: JABU,
      markedByUserId: ALICE,
    });
    expect(insert.called("onConflictDoNothing")).toBe(true);
  });

  it("refuses someone outside the audience, an erased account and a stranger", async () => {
    const lockRow: Record<string, unknown[]> = {
      [REN]: [{ sanitizedAt: null }],
      // Erased while the tick was on its way: the lock reads it set.
      [GONE]: [{ sanitizedAt: new Date() }],
      "aaaaaaaa-0000-4000-8000-0000000000ff": [],
    };
    for (const userId of [REN, GONE, "aaaaaaaa-0000-4000-8000-0000000000ff"]) {
      dbMock.reset();
      queueActor(LEAD);
      dbMock.queue([meetingRow({ audience: KITCHEN_ONLY })]);
      dbMock.queue(lockRow[userId]!);
      queueMembers();
      expect(
        await store.setCampMeetingAttendance(ALICE, EDITION, {
          ...tick,
          userId,
        }),
      ).toEqual({
        ok: false,
        error: expect.stringContaining("isn't a member this meeting is for"),
      });
      expect(dbMock.writesTo(schema.campMeetingAttendees)).toHaveLength(0);
    }
  });

  it("no new ticks on a cancelled meeting; unticking always works", async () => {
    queueActor(LEAD);
    dbMock.queue([meetingRow({ cancelledAt: new Date() })]);
    // Jabu could see it, so only the cancellation stands in the way.
    queueMembers();
    expect(await store.setCampMeetingAttendance(ALICE, EDITION, tick)).toEqual({
      ok: false,
      error: expect.stringContaining("was cancelled"),
    });
    expect(dbMock.writesTo(schema.campMeetingAttendees)).toHaveLength(0);
    dbMock.reset();
    queueActor(LEAD);
    dbMock.queue([meetingRow({ cancelledAt: new Date() })]);
    expect(
      await store.setCampMeetingAttendance(ALICE, EDITION, {
        ...tick,
        came: false,
      }),
    ).toEqual({ ok: true });
    const del = dbMock.writesTo(schema.campMeetingAttendees)[0]!;
    expect(del.kind).toBe("delete");
    expect(boundStrings(del)).toEqual(expect.arrayContaining([MEETING, JABU]));
  });

  it("a plain member can't tick; outside the audience it doesn't exist", async () => {
    queueActor(MEMBER, [KITCHEN], "Jabu");
    dbMock.queue([meetingRow()]);
    expect(
      (await store.setCampMeetingAttendance(JABU, EDITION, tick)) as {
        error: string;
      },
    ).toMatchObject({
      error: expect.stringContaining("write its notes"),
    });
    dbMock.reset();
    queueActor(MEMBER, [], "Ren Notfound");
    dbMock.queue([
      meetingRow({ audience: KITCHEN_ONLY, createdByUserId: JABU }),
    ]);
    expect(
      (await store.setCampMeetingAttendance(REN, EDITION, tick)) as {
        error: string;
      },
    ).toMatchObject({
      error: "That meeting doesn't exist.",
    });
    dbMock.reset();
    queueActor(LEAD);
    dbMock.queue([]);
    expect(
      (await store.setCampMeetingAttendance(ALICE, EDITION, tick)).ok,
    ).toBe(false);
    expect(
      (
        await store.setCampMeetingAttendance(ALICE, EDITION, {
          ...tick,
          userId: "x",
        })
      ).ok,
    ).toBe(false);
    expect(dbMock.writesTo(schema.campMeetingAttendees)).toHaveLength(0);
  });
});

// --- Team audiences (docs/team-audiences-spec.md) ----------------------------

describe("team audiences", () => {
  const KITCHEN_TEAM = "7e7e7e7e-0000-4000-8000-000000000001";
  const BUILD_TEAM = "7e7e7e7e-0000-4000-8000-000000000002";
  const TEAMS = [
    { id: KITCHEN_TEAM, name: "Kitchen", archivedAt: null, sort: 0 },
    { id: BUILD_TEAM, name: "Build & strike", archivedAt: null, sort: 1 },
  ];
  const KITCHEN_TEAM_ONLY: MeetingAudience = {
    ...EVERYONE,
    mode: "teams",
    roleIds: [],
    teamIds: [KITCHEN_TEAM],
  };
  /** Ren leads the kitchen team, without `schedule_meetings`. */
  const renLeadsKitchen: TeamRows = {
    teams: TEAMS,
    seats: [{ teamId: KITCHEN_TEAM, isLead: true, archivedAt: null }],
  };
  const teamForm = {
    ...form,
    mode: "teams" as const,
    teamIds: [KITCHEN_TEAM],
  };

  it("a team lead may open the form, but not camp-wide", async () => {
    queueAccess(MEMBER, [], renLeadsKitchen);
    const a = await store.loadMeetingsAccess("mad-hatters", REN);
    expect(a?.canSchedule).toBe(true);
    expect(a?.canScheduleCampWide).toBe(false);
    expect(a?.viewer.ledTeamIds).toEqual(new Set([KITCHEN_TEAM]));
    expect(a?.teams.map((t) => t.name)).toEqual(["Kitchen", "Build & strike"]);
  });

  it("an archived team's seat is not a lead's reach", async () => {
    queueAccess(MEMBER, [], {
      teams: TEAMS,
      seats: [{ teamId: KITCHEN_TEAM, isLead: true, archivedAt: new Date() }],
    });
    const a = await store.loadMeetingsAccess("mad-hatters", REN);
    expect(a?.canSchedule).toBe(false);
    expect(a?.viewer.teamIds).toEqual(new Set([KITCHEN_TEAM]));
  });

  it("the list's chip names the teams", async () => {
    queueAccess(LEAD, [], { teams: TEAMS });
    const withTeams = await store.loadMeetingsAccess("mad-hatters", ALICE);
    dbMock.queue(
      [
        meetingRow({
          audience: {
            ...KITCHEN_TEAM_ONLY,
            teamIds: [BUILD_TEAM, KITCHEN_TEAM],
          },
          date: "2027-04-07",
        }),
      ],
      [],
    );
    const { upcoming } = await store.listCampMeetings(
      withTeams!,
      EDITION,
      new Date("2027-03-25T10:00:00Z"),
    );
    expect(upcoming[0]?.audience).toEqual({
      mode: "teams",
      roleNames: [],
      teamNames: ["Build & strike", "Kitchen"],
    });
  });

  it("a team lead schedules for their team; the seat read is held FOR SHARE", async () => {
    queueActor(MEMBER, [], "Ren Notfound", renLeadsKitchen);
    dbMock.queue([{ id: MEETING }], /* audit */ []);
    // recipients: members, assignments, roles, then seats (Jabu is on it)
    queueRecipients([
      { teamId: KITCHEN_TEAM, groupId: CAMP, userId: JABU },
      { teamId: KITCHEN_TEAM, groupId: CAMP, userId: REN },
    ]);
    const r = await store.createCampMeeting(REN, EDITION, teamForm);
    expect(r).toEqual({ ok: true, id: MEETING, version: 1 });
    expect(
      dbMock.writesTo(schema.campMeetings)[0]!.arg("values"),
    ).toMatchObject({ audience: KITCHEN_TEAM_ONLY, createdByUserId: REN });
    // The seat read is the one that joins team_members, inside the write.
    const seatRead = dbMock
      .queriesTouching(schema.teamMembers)
      .find((q) => q.tx && q.called("for"))!;
    expect(seatRead.arg("for")).toBe("share");
    expect(audits()[0]).toMatchObject({
      meta: { audience: "teams", roles: 0, teams: 1 },
    });
    // The team and the camp's lead hear of it; the scheduler does not.
    expect(
      notices()
        .map((n) => n.userId)
        .sort(),
    ).toEqual([ALICE, JABU].sort());
  });

  it("a camp lead's team pick reads the camp's team rows FOR SHARE, before any seat", async () => {
    // Alice is on no team, so her own seats lock nothing: only the camp-wide
    // team read can make a concurrent archive wait (or be what she sees).
    queueActor(LEAD, [], "Alice Hatter", { teams: TEAMS });
    dbMock.queue([{ id: MEETING }], /* audit */ []);
    queueRecipients();
    expect((await store.createCampMeeting(ALICE, EDITION, teamForm)).ok).toBe(
      true,
    );
    const inTx = dbMock.queries.filter((q) => q.tx);
    // The camp's teams: from shift_teams with no join to team_members.
    const teamRead = inTx.findIndex(
      (q) => q.arg("from") === schema.shiftTeams && !q.called("innerJoin"),
    );
    const seatRead = inTx.findIndex(
      (q) =>
        q.arg("from") === schema.teamMembers &&
        q.arg("innerJoin") === schema.shiftTeams,
    );
    expect(teamRead).toBeGreaterThanOrEqual(0);
    expect(inTx[teamRead]!.arg("for")).toBe("share");
    // Team rows before seats, the order camp-teams-store.ts locks in.
    expect(seatRead).toBeGreaterThan(teamRead);
  });

  it("a team lead may not schedule for another team, or the whole camp", async () => {
    queueActor(MEMBER, [], "Ren Notfound", renLeadsKitchen);
    expect(
      await store.createCampMeeting(REN, EDITION, {
        ...teamForm,
        teamIds: [BUILD_TEAM],
      }),
    ).toEqual({
      ok: false,
      error: "You can only schedule meetings for the teams you lead.",
    });
    dbMock.reset();
    queueActor(MEMBER, [], "Ren Notfound", renLeadsKitchen);
    expect(await store.createCampMeeting(REN, EDITION, form)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Only the camp's leads"),
    });
    expect(dbMock.queriesOfKind("insert")).toHaveLength(0);
  });

  it("a member who leads no team is refused before any write", async () => {
    queueActor(MEMBER, [], "Ren Notfound", { teams: TEAMS });
    expect((await store.createCampMeeting(REN, EDITION, teamForm)).ok).toBe(
      false,
    );
    expect(dbMock.queriesOfKind("insert")).toHaveLength(0);
  });

  it("a team lead edits their team's meeting, and cannot widen it", async () => {
    const edit = { ...teamForm, id: MEETING, expectedVersion: 2 };
    queueActor(MEMBER, [], "Ren Notfound", renLeadsKitchen);
    dbMock.queue([
      meetingRow({ audience: KITCHEN_TEAM_ONLY, createdByUserId: ALICE }),
    ]);
    expect(
      await store.updateCampMeeting(REN, EDITION, {
        ...edit,
        teamIds: [KITCHEN_TEAM, BUILD_TEAM],
      }),
    ).toEqual({
      ok: false,
      error: "You can only schedule meetings for the teams you lead.",
    });
    expect(dbMock.queriesOfKind("update")).toHaveLength(0);

    dbMock.reset();
    queueActor(MEMBER, [], "Ren Notfound", renLeadsKitchen);
    dbMock.queue([
      meetingRow({ audience: KITCHEN_TEAM_ONLY, createdByUserId: ALICE }),
    ]);
    queueRecipients();
    dbMock.queue([{ version: 3 }], /* audit */ []);
    queueRecipients();
    expect(
      await store.updateCampMeeting(REN, EDITION, { ...edit, title: "Menu" }),
    ).toEqual({ ok: true, version: 3 });
  });

  it("a camp lead may keep a team archived since on the meeting", async () => {
    const edit = { ...teamForm, id: MEETING, expectedVersion: 2 };
    queueActor(LEAD, [], "Alice Hatter", {
      teams: [{ ...TEAMS[0]!, archivedAt: new Date() }, TEAMS[1]!],
    });
    dbMock.queue([meetingRow({ audience: KITCHEN_TEAM_ONLY })]);
    queueRecipients();
    dbMock.queue([{ version: 3 }], []);
    queueRecipients();
    expect(await store.updateCampMeeting(ALICE, EDITION, edit)).toEqual({
      ok: true,
      version: 3,
    });
    // ...but may not add an archived team to a meeting that did not have it.
    dbMock.reset();
    queueActor(LEAD, [], "Alice Hatter", {
      teams: [{ ...TEAMS[0]!, archivedAt: new Date() }, TEAMS[1]!],
    });
    dbMock.queue([meetingRow()]);
    expect(await store.updateCampMeeting(ALICE, EDITION, edit)).toMatchObject({
      ok: false,
      error: expect.stringContaining("doesn't exist any more"),
    });
  });

  it("a team meeting shows to its team, and is hidden from everyone else", async () => {
    queueAccess(MEMBER, [], {
      teams: TEAMS,
      seats: [{ teamId: KITCHEN_TEAM, isLead: false, archivedAt: null }],
    });
    const onTeam = await store.loadMeetingsAccess("mad-hatters", JABU);
    dbMock.queue([meetingRow({ audience: KITCHEN_TEAM_ONLY })]);
    const seen = await store.loadCampMeeting(onTeam!, EDITION, MEETING);
    expect(seen?.audienceTeamIds).toEqual([KITCHEN_TEAM]);
    expect(seen?.canEdit).toBe(false);

    dbMock.reset();
    queueAccess(MEMBER, [], {
      teams: TEAMS,
      seats: [{ teamId: BUILD_TEAM, isLead: true, archivedAt: null }],
    });
    const offTeam = await store.loadMeetingsAccess("mad-hatters", JABU);
    dbMock.queue([meetingRow({ audience: KITCHEN_TEAM_ONLY })]);
    expect(await store.loadCampMeeting(offTeam!, EDITION, MEETING)).toBeNull();
  });
});

// The schedule form's reach count (docs/team-audiences-spec.md): every seat
// on THIS camp's teams, archived included — a meeting for an archived team
// still shows to its members, so the count must see them too.
describe("listCampTeamSeats", () => {
  it("joins seats to their team and keys the read on this camp", async () => {
    const seats = [{ teamId: "t-kitchen", groupId: CAMP, userId: "u-cook" }];
    dbMock.queue(seats);
    expect(await store.listCampTeamSeats(CAMP)).toEqual(seats);
    const [read] = dbMock.queries;
    expect(read!.arg("from")).toBe(schema.teamMembers);
    expect(read!.called("innerJoin")).toBe(true);
    expect(boundStrings(read!)).toContain(CAMP);
    expect(nullChecksOn(read!, schema.shiftTeams.archivedAt)).toEqual([]);
  });
});
