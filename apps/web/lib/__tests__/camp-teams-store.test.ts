import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { schema } from "@quagga/db";
import {
  GroupKind,
  MembershipRole,
  TEAM_JOIN_MODES,
  TEAM_MAX_LEADS,
} from "@quagga/types";
import { boundStrings, dbMock } from "@/test/db-mock";

// Camp teams store (docs/camp-teams-spec.md). Asserts DECISIONS — who is
// refused before which write, what is written and in which transaction — not
// SQL (see db-mock's header). Fixture roles, kinds and join modes come from
// the real vocabularies: a value outside its enum would make a gate inert.

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());
vi.mock("../campmates-store", () => ({
  loadCampmateMemberships: async () => new Map(),
  resolveAvatarForViewer: async () => null,
}));

const store = await import("../camp-teams-store");

const LEAD = MembershipRole.enum.lead;
const MEMBER = MembershipRole.enum.member;
const [OPEN, LEADS_ADD] = TEAM_JOIN_MODES;
const THEME_CAMP = GroupKind.enum.theme_camp;

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001"; // member
const REN = "aaaaaaaa-0000-4000-8000-000000000002"; // member
const JABU = "aaaaaaaa-0000-4000-8000-000000000003"; // camp lead
const CAMP = "11111111-0000-4000-8000-00000000000a";
const TEAM = "77777777-0000-4000-8000-000000000001";
const CONVO = "cccccccc-0000-4000-8000-000000000001";
const SLUG = "mad-hatters";

const campRow = [
  { id: CAMP, name: "Mad Hatters", slug: SLUG, kind: THEME_CAMP },
];
const person = (userId: string, role: string) => ({
  userId,
  role,
  username: userId === JABU ? "jabu" : userId === REN ? "ren" : "alice",
  sanitizedAt: null,
});
const team = (over: Record<string, unknown> = {}) => ({
  id: TEAM,
  name: "Kitchen",
  joinMode: OPEN,
  archivedAt: null,
  ...over,
});

/** The values of drizzle `Param`s bound anywhere in a WHERE expression. */
function boundParams(where: unknown): unknown[] {
  const out: unknown[] = [];
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 12 || typeof v !== "object" || v === null) return;
    if (seen.has(v)) return;
    seen.add(v);
    if (
      (v as { constructor?: { name?: string } }).constructor?.name === "Param"
    ) {
      out.push((v as { value: unknown }).value);
      return;
    }
    // Columns and tables are not parameters; do not descend into them.
    const name =
      (v as { constructor?: { name?: string } }).constructor?.name ?? "";
    if (/Column|Table/.test(name)) return;
    for (const inner of Object.values(v)) walk(inner, depth + 1);
  };
  walk(where, 0);
  return out;
}

beforeEach(() => {
  dbMock.reset();
  process.env.DATABASE_URL = "postgres://test";
});

afterEach(() => {
  delete process.env.DATABASE_URL;
});

describe("joining a team", () => {
  it("a member joins an open team: a seat AND a chat participant row, one transaction", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER)],
      [team()],
      /* seats */ [],
      /* insert seat */ [],
      /* ensure conversation */ [{ id: CONVO }],
    );
    const result = await store.joinCampTeam(ALICE, {
      slug: SLUG,
      teamId: TEAM,
    });
    expect(result).toEqual({ ok: true });
    const [seat] = dbMock.writesTo(schema.teamMembers);
    expect(seat!.tx).toBe(true);
    expect(seat!.arg("values")).toMatchObject({
      teamId: TEAM,
      userId: ALICE,
      isLead: false,
    });
    const [convo] = dbMock.writesTo(schema.conversations);
    expect(convo!.arg("values")).toMatchObject({ kind: "team", teamId: TEAM });
    const [participant] = dbMock.writesTo(schema.conversationParticipants);
    expect(participant!.tx).toBe(true);
    const values = participant!.arg("values") as {
      userId: string;
      joinedAt: Date;
    }[];
    expect(values.map((v) => v.userId)).toEqual([ALICE]);
    // The history cut starts now.
    expect(values[0]!.joinedAt).toBeInstanceOf(Date);
    // Joining yourself sends nothing.
    expect(dbMock.writesTo(schema.notifications)).toHaveLength(0);
  });

  it("locks the actor's membership AND account FOR SHARE before the team row", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER)],
      [team()],
      [],
      [],
      [{ id: CONVO }],
    );
    await store.joinCampTeam(ALICE, { slug: SLUG, teamId: TEAM });
    const locks = dbMock.queries.filter((q) => q.called("for"));
    expect(locks.map((q) => q.arg("for"))).toEqual(["share", "update"]);
    const of = (
      locks[0]!.calls.find((c) => c.method === "for")!.args[1] as {
        of: unknown[];
      }
    ).of;
    expect(of).toEqual([schema.memberships, schema.users]);
    // The share lock is the membership read for THIS person in THIS camp.
    expect(boundStrings(locks[0]!)).toEqual(
      expect.arrayContaining([ALICE, CAMP]),
    );
  });

  it("a leads-add team refuses a member, and writes nothing", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER)],
      [team({ joinMode: LEADS_ADD })],
      [],
    );
    const result = await store.joinCampTeam(ALICE, {
      slug: SLUG,
      teamId: TEAM,
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.teamMembers)).toHaveLength(0);
    expect(dbMock.writesTo(schema.conversationParticipants)).toHaveLength(0);
  });

  it("a stranger (no active membership) gets the camp's 404 before the team is read", async () => {
    dbMock.queue(campRow, /* nobody locked */ []);
    const result = await store.joinCampTeam(ALICE, {
      slug: SLUG,
      teamId: TEAM,
    });
    expect(result).toEqual({ ok: false, error: "That team doesn't exist." });
    expect(dbMock.queriesTouching(schema.shiftTeams)).toHaveLength(0);
  });

  it("rejects a malformed input before any query", async () => {
    const result = await store.joinCampTeam(ALICE, { slug: SLUG, teamId: "x" });
    expect(result.ok).toBe(false);
    expect(dbMock.queries).toHaveLength(0);
  });
});

describe("leaving and being removed", () => {
  it("leaving deletes the seat and the chat participation together", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER)],
      [team()],
      [{ userId: ALICE, isLead: false }],
    );
    const result = await store.leaveCampTeam(ALICE, {
      slug: SLUG,
      teamId: TEAM,
    });
    expect(result).toEqual({ ok: true });
    const deletes = dbMock.queriesOfKind("delete");
    expect(deletes.map((d) => d.arg("delete"))).toEqual([
      schema.teamMembers,
      schema.conversationParticipants,
    ]);
    for (const d of deletes) {
      expect(boundStrings(d)).toContain(ALICE);
    }
    // Shifts are separate sign-ups and stay.
    expect(dbMock.writesTo(schema.shiftAssignments)).toHaveLength(0);
  });

  it("a plain member cannot remove someone", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER)],
      [team()],
      [
        { userId: ALICE, isLead: false },
        { userId: REN, isLead: false },
      ],
    );
    const result = await store.removeCampTeamMember(ALICE, {
      slug: SLUG,
      teamId: TEAM,
      userId: REN,
    });
    expect(result.ok).toBe(false);
    expect(dbMock.queriesOfKind("delete")).toHaveLength(0);
  });

  it("a team lead removes someone from their team and its chat", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER)],
      [team()],
      [
        { userId: ALICE, isLead: true },
        { userId: REN, isLead: false },
      ],
    );
    const result = await store.removeCampTeamMember(ALICE, {
      slug: SLUG,
      teamId: TEAM,
      userId: REN,
    });
    expect(result).toEqual({ ok: true });
    const deletes = dbMock.queriesOfKind("delete");
    expect(deletes.map((d) => d.arg("delete"))).toEqual([
      schema.teamMembers,
      schema.conversationParticipants,
    ]);
    expect(boundStrings(deletes[0]!)).toContain(REN);
    expect(boundStrings(deletes[1]!)).toContain(REN);
  });
});

describe("adding people", () => {
  it("refuses someone who is not a current camp member — the whole add", async () => {
    dbMock.queue(
      campRow,
      /* only the lead locks: REN is archived or erased */ [person(JABU, LEAD)],
      [team()],
      [],
    );
    const result = await store.addCampTeamMembers(JABU, {
      slug: SLUG,
      teamId: TEAM,
      userIds: [REN],
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.teamMembers)).toHaveLength(0);
    expect(dbMock.writesTo(schema.conversationParticipants)).toHaveLength(0);
  });

  it("a camp lead adds a member: seat, chat from now on, and a notice after commit", async () => {
    dbMock.queue(
      campRow,
      [person(JABU, LEAD), person(REN, MEMBER)],
      [team({ joinMode: LEADS_ADD })],
      [],
      /* insert seats */ [],
      /* ensure conversation */ [{ id: CONVO }],
    );
    const result = await store.addCampTeamMembers(JABU, {
      slug: SLUG,
      teamId: TEAM,
      userIds: [REN],
    });
    expect(result).toEqual({ ok: true, added: 1 });
    // The lock named BOTH people (one statement), so an archive or erasure of
    // the person being added either waits or is seen.
    const share = dbMock.queries.find((q) => q.arg("for") === "share")!;
    expect(boundStrings(share)).toEqual(expect.arrayContaining([JABU, REN]));
    const [seat] = dbMock.writesTo(schema.teamMembers);
    expect(seat!.arg("values")).toEqual([
      expect.objectContaining({ userId: REN, addedByUserId: JABU }),
    ]);
    const [notice] = dbMock.writesTo(schema.notifications);
    expect(notice!.tx).toBe(false);
    const rows = notice!.arg("values") as {
      userId: string;
      title: string;
      kind: string;
    }[];
    expect(rows).toEqual([
      expect.objectContaining({
        userId: REN,
        kind: "team",
        title: "You were added to Kitchen",
      }),
    ]);
  });

  it("a plain member cannot add people", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER), person(REN, MEMBER)],
      [team()],
      [{ userId: ALICE, isLead: false }],
    );
    const result = await store.addCampTeamMembers(ALICE, {
      slug: SLUG,
      teamId: TEAM,
      userIds: [REN],
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.teamMembers)).toHaveLength(0);
  });
});

describe("creating and editing teams", () => {
  it("a plain member cannot create a team", async () => {
    dbMock.queue(campRow, [person(ALICE, MEMBER)]);
    const result = await store.createCampTeam(ALICE, {
      slug: SLUG,
      name: "Shade crew",
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.shiftTeams)).toHaveLength(0);
  });

  it("a camp lead creates a team with its chat", async () => {
    dbMock.queue(
      campRow,
      [person(JABU, LEAD)],
      /* count */ [{ n: 3 }],
      /* insert team */ [{ id: TEAM }],
      /* seeded-at stamp */ [],
      /* ensure conversation */ [{ id: CONVO }],
    );
    const result = await store.createCampTeam(JABU, {
      slug: SLUG,
      name: "Shade crew",
      joinMode: LEADS_ADD,
    });
    expect(result).toEqual({ ok: true, id: TEAM });
    const [insert] = dbMock.writesTo(schema.shiftTeams);
    expect(insert!.arg("values")).toMatchObject({
      groupId: CAMP,
      name: "Shade crew",
      joinMode: LEADS_ADD,
      description: null,
    });
    const [convo] = dbMock.writesTo(schema.conversations);
    expect(convo!.arg("values")).toMatchObject({ kind: "team", teamId: TEAM });
  });

  it("a team lead edits their own team; a plain member cannot", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER)],
      [team()],
      [{ userId: ALICE, isLead: false }],
    );
    const refusedEdit = await store.updateCampTeam(ALICE, {
      slug: SLUG,
      teamId: TEAM,
      name: "Kitchen",
      joinMode: OPEN,
    });
    expect(refusedEdit.ok).toBe(false);
    expect(dbMock.writesTo(schema.shiftTeams)).toHaveLength(0);

    dbMock.reset();
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER)],
      [team()],
      [{ userId: ALICE, isLead: true }],
    );
    const edited = await store.updateCampTeam(ALICE, {
      slug: SLUG,
      teamId: TEAM,
      name: "Kitchen",
      description: "We cook lunch.",
      joinMode: LEADS_ADD,
    });
    expect(edited).toEqual({ ok: true });
    const [update] = dbMock.writesTo(schema.shiftTeams);
    expect(update!.arg("set")).toMatchObject({
      description: "We cook lunch.",
      joinMode: LEADS_ADD,
    });
  });
});

describe("reads", () => {
  it("a stranger gets null for the list and the page", async () => {
    dbMock.queue(campRow, /* no membership */ []);
    expect(
      await store.listCampTeams({ slug: SLUG, viewerUserId: ALICE }),
    ).toBeNull();
    dbMock.queue(campRow, []);
    expect(
      await store.getCampTeam({
        slug: SLUG,
        teamId: TEAM,
        viewerUserId: ALICE,
      }),
    ).toBeNull();
    expect(dbMock.queriesTouching(schema.teamMembers)).toHaveLength(0);
  });

  it("an archived team is hidden from a member who is not on it", async () => {
    dbMock.queue(
      campRow,
      [{ role: MEMBER }],
      [{ ...team({ archivedAt: new Date() }), description: null }],
      /* seats */ [],
    );
    expect(
      await store.getCampTeam({
        slug: SLUG,
        teamId: TEAM,
        viewerUserId: ALICE,
      }),
    ).toBeNull();
  });

  it("the list shows leads, counts and Join for a member", async () => {
    dbMock.queue(
      campRow,
      [{ role: MEMBER }],
      [team(), { ...team({ joinMode: LEADS_ADD }), id: "t2", name: "Sound" }],
      [
        { teamId: TEAM, userId: REN, isLead: true, username: "ren" },
        { teamId: TEAM, userId: JABU, isLead: false, username: "jabu" },
      ],
    );
    const view = await store.listCampTeams({ slug: SLUG, viewerUserId: ALICE });
    expect(view!.canCreate).toBe(false);
    expect(
      view!.teams.map((t) => [
        t.name,
        t.memberCount,
        t.leads.length,
        t.canJoin,
      ]),
    ).toEqual([
      ["Kitchen", 2, 1, true],
      ["Sound", 0, 0, false],
    ]);
  });
});

describe("cleanup on leaving the camp, archive and erasure", () => {
  it("removeFromAllTeams deletes every seat and every TEAM chat row, never DMs", async () => {
    await store.removeFromAllTeams(dbMock.handle as never, ALICE);
    const deletes = dbMock.queriesOfKind("delete");
    expect(deletes.map((d) => d.arg("delete"))).toEqual([
      schema.teamMembers,
      schema.conversationParticipants,
    ]);
    // The participant delete is narrowed to team conversations.
    const sub = dbMock
      .queriesTouching(schema.conversations)
      .filter((q) => q.kind === "select");
    expect(sub).toHaveLength(1);
    // The BOUND value, not the column's enum list (which names both kinds,
    // so a plain string search would pass whichever kind was filtered on).
    expect(boundParams(sub[0]!.arg("where"))).toEqual(["team"]);
  });
});

describe("reads for the team pages and the team chat route", () => {
  it("New team's lead list is empty for a plain member, and the camp's members are never read", async () => {
    dbMock.queue(campRow, [{ role: MEMBER }]);
    expect(
      await store.listNewTeamLeadCandidates({
        slug: SLUG,
        viewerUserId: ALICE,
      }),
    ).toEqual([]);
    // Two reads only: the camp and the viewer's own role.
    expect(dbMock.queries).toHaveLength(2);
    expect(dbMock.pending).toBe(0);
  });

  it("a camp lead gets the camp's current members by name", async () => {
    dbMock.queue(
      campRow,
      [{ role: LEAD }],
      [
        { userId: REN, username: "ren" },
        { userId: ALICE, username: "alice" },
      ],
    );
    const people = await store.listNewTeamLeadCandidates({
      slug: SLUG,
      viewerUserId: JABU,
    });
    expect(people.map((p) => p.userId)).toEqual([ALICE, REN]);
  });

  it("the team page names the chat only to someone on the team", async () => {
    const row = { ...team(), description: null };
    dbMock.queue(campRow, [{ role: LEAD }], [row], /* seats */ []);
    const outsider = await store.getCampTeam({
      slug: SLUG,
      teamId: TEAM,
      viewerUserId: JABU,
    });
    // A camp lead NOT on the team: no chat id, and the conversation table is
    // never read for them.
    expect(outsider!.chatConversationId).toBeNull();
    expect(dbMock.queriesTouching(schema.conversations)).toHaveLength(0);

    dbMock.reset();
    dbMock.queue(
      campRow,
      [{ role: MEMBER }],
      [row],
      [{ teamId: TEAM, userId: ALICE, isLead: false, username: "alice" }],
      [{ id: CONVO }],
    );
    const member = await store.getCampTeam({
      slug: SLUG,
      teamId: TEAM,
      viewerUserId: ALICE,
    });
    expect(member!.chatConversationId).toBe(CONVO);
  });

  it("a conversation id that is no team chat opens nothing, and no message is read", async () => {
    dbMock.queue(/* no team conversation */ []);
    expect(
      await store.loadTeamChatByConversation({
        conversationId: CONVO,
        viewerUserId: ALICE,
      }),
    ).toBeNull();
    expect(dbMock.queries).toHaveLength(1);
    expect(dbMock.queriesTouching(schema.messages)).toHaveLength(0);
    // The lookup is narrowed to TEAM conversations, by the bound value.
    const [lookup] = dbMock.queries;
    expect(boundParams(lookup!.arg("where"))).toEqual([CONVO, "team"]);
  });

  it("a team chat found by id still goes through the team-chat gate", async () => {
    dbMock.queue(
      [{ teamId: TEAM, groupId: CAMP, campSlug: SLUG }],
      // getTeamChat's facts: the team in this camp …
      [
        {
          teamId: TEAM,
          teamName: "Kitchen",
          archivedAt: null,
          campName: "Mad Hatters",
        },
      ],
      // … NO seat for the viewer (a camp lead not on the team) …
      [],
      [{ role: LEAD }],
      [{ id: CONVO, timer: "off" }],
      // … but a STALE participant row, so only the seat check refuses.
      [{ userId: JABU, joinedAt: new Date(0) }],
      // What a broken gate would go on to read: blocks, messages.
      [],
      [],
    );
    expect(
      await store.loadTeamChatByConversation({
        conversationId: CONVO,
        viewerUserId: JABU,
      }),
    ).toBeNull();
    expect(dbMock.queriesTouching(schema.messages)).toHaveLength(0);
  });
});

// --- Refusals, validation and side effects -----------------------------------
//
// Every refusal below asserts the EXACT sentence, so it pins which reason
// fired — "refused for some reason" would pass if an earlier gate refused for
// the wrong one. Seats and locked people are queued in the order the store
// reads them: camp, people (FOR SHARE), team (FOR UPDATE), seats.

const MISSING = "That team doesn't exist.";
const INVALID = "Check the form and try again.";
const CHAT_MISSING = "That team chat isn't available.";
const NOT_MANAGER = "Only this team's leads and the camp's leads can do that.";
const ARCHIVED = "That team is archived.";
const ARCHIVED_AT = new Date("2027-04-20T10:00:00Z");
const ORG = GroupKind.enum.org;
const TEAM_B = "77777777-0000-4000-8000-000000000002";

/** Nothing was written anywhere a team write could write. */
function expectNoTeamWrites(): void {
  expect(dbMock.writesTo(schema.teamMembers)).toHaveLength(0);
  expect(dbMock.writesTo(schema.shiftTeams)).toHaveLength(0);
  expect(dbMock.writesTo(schema.conversationParticipants)).toHaveLength(0);
  expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  expect(dbMock.writesTo(schema.notifications)).toHaveLength(0);
}

describe("without a database, and for a camp that has no teams", () => {
  it("every read is empty and every write is the 404, with no query at all", async () => {
    delete process.env.DATABASE_URL;
    const self = { slug: SLUG, teamId: TEAM };
    expect(
      await store.listCampTeams({ slug: SLUG, viewerUserId: ALICE }),
    ).toBeNull();
    expect(
      await store.getCampTeam({ ...self, viewerUserId: ALICE }),
    ).toBeNull();
    expect(
      await store.listTeamCandidates({ ...self, viewerUserId: ALICE }),
    ).toEqual([]);
    expect(
      await store.listNewTeamLeadCandidates({
        slug: SLUG,
        viewerUserId: ALICE,
      }),
    ).toEqual([]);
    expect(
      await store.loadTeamChat({ ...self, viewerUserId: ALICE }),
    ).toBeNull();
    expect(
      await store.loadTeamChatByConversation({
        conversationId: CONVO,
        viewerUserId: ALICE,
      }),
    ).toBeNull();
    for (const write of [
      store.joinCampTeam(ALICE, self),
      store.leaveCampTeam(ALICE, self),
      store.createCampTeam(ALICE, { slug: SLUG, name: "Shade crew" }),
      store.updateCampTeam(ALICE, { ...self, name: "Kitchen", joinMode: OPEN }),
      store.setCampTeamArchived(ALICE, { ...self, archived: true }),
      store.addCampTeamMembers(ALICE, { ...self, userIds: [REN] }),
      store.removeCampTeamMember(ALICE, { ...self, userId: REN }),
      store.setCampTeamLead(ALICE, { ...self, userId: REN, isLead: true }),
    ]) {
      expect(await write).toEqual({ ok: false, error: MISSING });
    }
    expect(dbMock.queries).toHaveLength(0);
    expect(dbMock.transactions).toBe(0);
  });

  it("the org group (not a project) answers like an unknown slug, before anyone is read", async () => {
    const orgRow = [{ ...campRow[0]!, kind: ORG }];
    dbMock.queue(orgRow);
    expect(
      await store.joinCampTeam(JABU, { slug: SLUG, teamId: TEAM }),
    ).toEqual({ ok: false, error: MISSING });
    dbMock.queue(orgRow);
    expect(
      await store.listCampTeams({ slug: SLUG, viewerUserId: JABU }),
    ).toBeNull();
    dbMock.queue(orgRow);
    expect(
      await store.getCampTeam({ slug: SLUG, teamId: TEAM, viewerUserId: JABU }),
    ).toBeNull();
    dbMock.queue(orgRow);
    expect(
      await store.listNewTeamLeadCandidates({ slug: SLUG, viewerUserId: JABU }),
    ).toEqual([]);
    dbMock.queue(orgRow);
    expect(
      await store.loadTeamChat({
        slug: SLUG,
        teamId: TEAM,
        viewerUserId: JABU,
      }),
    ).toBeNull();
    // Only the four camp lookups ran: no membership, lock or transaction.
    expect(dbMock.queries).toHaveLength(5);
    expect(dbMock.queriesTouching(schema.memberships)).toHaveLength(0);
    expect(dbMock.transactions).toBe(0);
  });
});

describe("input validation", () => {
  it("malformed writes are refused before any query", async () => {
    const bad: [string, () => Promise<{ ok: boolean }>][] = [
      [
        "empty name",
        () => store.createCampTeam(JABU, { slug: SLUG, name: " " }),
      ],
      [
        "name too long",
        () => store.createCampTeam(JABU, { slug: SLUG, name: "x".repeat(41) }),
      ],
      [
        "eleven leads",
        () =>
          store.createCampTeam(JABU, {
            slug: SLUG,
            name: "Shade crew",
            leadUserIds: Array.from(
              { length: 11 },
              (_, i) =>
                `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`,
            ),
          }),
      ],
      [
        "a role smuggled into the payload",
        () =>
          store.createCampTeam(JABU, {
            slug: SLUG,
            name: "Shade crew",
            role: LEAD,
          }),
      ],
      [
        "unknown join mode",
        () =>
          store.updateCampTeam(JABU, {
            slug: SLUG,
            teamId: TEAM,
            name: "Kitchen",
            joinMode: "invite_only",
          }),
      ],
      [
        "archived not a boolean",
        () =>
          store.setCampTeamArchived(JABU, {
            slug: SLUG,
            teamId: TEAM,
            archived: "yes",
          }),
      ],
      ["leave without a team", () => store.leaveCampTeam(JABU, { slug: SLUG })],
      [
        "add nobody",
        () =>
          store.addCampTeamMembers(JABU, {
            slug: SLUG,
            teamId: TEAM,
            userIds: [],
          }),
      ],
      [
        "remove a non-id",
        () =>
          store.removeCampTeamMember(JABU, {
            slug: SLUG,
            teamId: TEAM,
            userId: "ren",
          }),
      ],
      [
        "lead without isLead",
        () =>
          store.setCampTeamLead(JABU, {
            slug: SLUG,
            teamId: TEAM,
            userId: REN,
          }),
      ],
    ];
    for (const [label, write] of bad) {
      expect(await write(), label).toEqual({ ok: false, error: INVALID });
    }
    expect(dbMock.queries).toHaveLength(0);
  });
});

describe("the actor's own lock", () => {
  it("an erased account that still comes back from the lock is treated as a stranger", async () => {
    dbMock.queue(campRow, [
      { ...person(ALICE, MEMBER), sanitizedAt: new Date() },
    ]);
    const result = await store.joinCampTeam(ALICE, {
      slug: SLUG,
      teamId: TEAM,
    });
    expect(result).toEqual({ ok: false, error: MISSING });
    // Refused before the team row is read or locked.
    expect(dbMock.queriesTouching(schema.shiftTeams)).toHaveLength(0);
    expectNoTeamWrites();
  });

  it("a team that is not this camp's answers like an unknown id", async () => {
    dbMock.queue(campRow, [person(JABU, LEAD)], /* no team here */ []);
    const result = await store.updateCampTeam(JABU, {
      slug: SLUG,
      teamId: TEAM_B,
      name: "Kitchen",
      joinMode: OPEN,
    });
    expect(result).toEqual({ ok: false, error: MISSING });
    // The team lookup was scoped to THIS camp and THIS id.
    const lookup = dbMock.queries.find((q) => q.arg("for") === "update")!;
    expect(boundStrings(lookup)).toEqual(
      expect.arrayContaining([TEAM_B, CAMP]),
    );
    expectNoTeamWrites();
  });

  it("every team write refuses an unknown team without writing", async () => {
    const self = { slug: SLUG, teamId: TEAM };
    const writes = [
      () => store.joinCampTeam(JABU, self),
      () => store.leaveCampTeam(JABU, self),
      () => store.setCampTeamArchived(JABU, { ...self, archived: true }),
      () => store.addCampTeamMembers(JABU, { ...self, userIds: [REN] }),
      () => store.removeCampTeamMember(JABU, { ...self, userId: REN }),
      () => store.setCampTeamLead(JABU, { ...self, userId: REN, isLead: true }),
    ];
    for (const write of writes) {
      dbMock.reset();
      dbMock.queue(campRow, [person(JABU, LEAD), person(REN, MEMBER)], []);
      expect(await write()).toEqual({ ok: false, error: MISSING });
      expectNoTeamWrites();
    }
  });
});

describe("creating a team: refusals and side effects", () => {
  it("named leads go on the team as leads, into its chat, and are told — never the creator", async () => {
    dbMock.queue(
      campRow,
      [person(JABU, LEAD), person(REN, MEMBER)],
      /* count */ [{ n: 2 }],
      /* insert team */ [{ id: TEAM }],
      /* seeded-at stamp */ [],
      /* ensure conversation */ [{ id: CONVO }],
    );
    const result = await store.createCampTeam(JABU, {
      slug: SLUG,
      name: "  Shade crew  ",
      leadUserIds: [REN, JABU, REN],
    });
    expect(result).toEqual({ ok: true, id: TEAM });
    // The lock named the actor and every lead, deduplicated, in one statement.
    const share = dbMock.queries.find((q) => q.arg("for") === "share")!;
    expect(boundStrings(share)).toEqual(expect.arrayContaining([JABU, REN]));
    const [insert] = dbMock.writesTo(schema.shiftTeams);
    expect(insert!.arg("values")).toMatchObject({
      name: "Shade crew",
      nameNormalized: "shade crew",
      sort: 2,
    });
    const [seats] = dbMock.writesTo(schema.teamMembers);
    expect(seats!.tx).toBe(true);
    const seatRows = seats!.arg("values") as {
      userId: string;
      isLead: boolean;
      addedByUserId: string;
    }[];
    expect(seatRows.map((s) => [s.userId, s.isLead, s.addedByUserId])).toEqual([
      [REN, true, JABU],
      [JABU, true, JABU],
    ]);
    const [participants] = dbMock.writesTo(schema.conversationParticipants);
    expect(
      (participants!.arg("values") as { userId: string }[]).map(
        (p) => p.userId,
      ),
    ).toEqual([REN, JABU]);
    const [auditRow] = dbMock.writesTo(schema.auditEvents);
    expect(auditRow!.arg("values")).toMatchObject({
      actorId: JABU,
      action: "camp.team.create",
      subject: TEAM,
      meta: { groupId: CAMP, leads: 2 },
    });
    // Making a team marks the camp's shift-team list as edited.
    const [stamp] = dbMock.writesTo(schema.groups);
    expect(stamp!.arg("set")).toEqual({
      shiftTeamsSeededAt: expect.any(Date),
    });
    const [notice] = dbMock.writesTo(schema.notifications);
    expect(notice!.tx).toBe(false);
    expect(
      (notice!.arg("values") as { userId: string; title: string }[]).map(
        (n) => [n.userId, n.title],
      ),
    ).toEqual([[REN, "You were added to Shade crew"]]);
  });

  it("a team with no leads puts nobody in its chat and tells nobody", async () => {
    dbMock.queue(
      campRow,
      [person(JABU, LEAD)],
      /* count: no row */ [],
      [{ id: TEAM }],
      [],
      [{ id: CONVO }],
    );
    const result = await store.createCampTeam(JABU, {
      slug: SLUG,
      name: "Shade crew",
    });
    expect(result).toEqual({ ok: true, id: TEAM });
    expect(dbMock.writesTo(schema.shiftTeams)[0]!.arg("values")).toMatchObject({
      sort: 0,
    });
    expect(dbMock.writesTo(schema.teamMembers)).toHaveLength(0);
    expect(dbMock.writesTo(schema.conversationParticipants)).toHaveLength(0);
    expect(dbMock.writesTo(schema.notifications)).toHaveLength(0);
  });

  it("a lead who is not a current camp member refuses the whole create", async () => {
    dbMock.queue(campRow, /* REN did not lock */ [person(JABU, LEAD)]);
    const result = await store.createCampTeam(JABU, {
      slug: SLUG,
      name: "Shade crew",
      leadUserIds: [REN],
    });
    expect(result).toEqual({
      ok: false,
      error: "Only current members of the camp can be added to a team.",
    });
    expectNoTeamWrites();
    expect(dbMock.writesTo(schema.conversations)).toHaveLength(0);
  });

  it("a camp at the team limit is refused before the insert", async () => {
    dbMock.queue(campRow, [person(JABU, LEAD)], [{ n: 30 }]);
    const result = await store.createCampTeam(JABU, {
      slug: SLUG,
      name: "Shade crew",
    });
    expect(result).toEqual({
      ok: false,
      error: "A camp can have up to 30 teams.",
    });
    expectNoTeamWrites();

    // One under the limit is allowed: the boundary is >=, not >.
    dbMock.reset();
    dbMock.queue(
      campRow,
      [person(JABU, LEAD)],
      [{ n: 29 }],
      [{ id: TEAM }],
      [],
      [{ id: CONVO }],
    );
    expect(
      await store.createCampTeam(JABU, { slug: SLUG, name: "Shade crew" }),
    ).toEqual({ ok: true, id: TEAM });
  });

  it("an insert that returns no row is refused, and nothing else is written", async () => {
    dbMock.queue(campRow, [person(JABU, LEAD)], [{ n: 0 }], /* returning */ []);
    const result = await store.createCampTeam(JABU, {
      slug: SLUG,
      name: "Shade crew",
    });
    expect(result).toEqual({ ok: false, error: INVALID });
    expect(dbMock.writesTo(schema.conversations)).toHaveLength(0);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });

  it("a name the camp already uses (unique violation, wrapped) is the friendly sentence", async () => {
    const wrapped = Object.assign(new Error("insert failed"), {
      cause: Object.assign(new Error("duplicate key"), { code: "23505" }),
    });
    dbMock.queue(campRow, [person(JABU, LEAD)], [{ n: 3 }], wrapped);
    const result = await store.createCampTeam(JABU, {
      slug: SLUG,
      name: "Kitchen",
    });
    expect(result).toEqual({
      ok: false,
      error: "The camp already has a team with that name.",
    });
    expect(dbMock.writesTo(schema.notifications)).toHaveLength(0);
  });

  it("any other database error is thrown, not swallowed as a refusal", async () => {
    const boom = Object.assign(new Error("connection reset"), {
      code: "08006",
    });
    dbMock.queue(campRow, [person(JABU, LEAD)], [{ n: 3 }], boom);
    await expect(
      store.createCampTeam(JABU, { slug: SLUG, name: "Kitchen" }),
    ).rejects.toThrow("connection reset");
  });

  it("a rename onto a name the camp already uses is the same sentence", async () => {
    dbMock.queue(
      campRow,
      [person(JABU, LEAD)],
      [team()],
      [],
      Object.assign(new Error("dup"), { code: "23505" }),
    );
    expect(
      await store.updateCampTeam(JABU, {
        slug: SLUG,
        teamId: TEAM,
        name: "Sound",
        joinMode: OPEN,
      }),
    ).toEqual({
      ok: false,
      error: "The camp already has a team with that name.",
    });
  });
});

describe("editing a team: who keeps the right on an archived team", () => {
  const edit = (actor: string) =>
    store.updateCampTeam(actor, {
      slug: SLUG,
      teamId: TEAM,
      name: "Kitchen",
      joinMode: OPEN,
    });

  it("a team lead loses it on an archived team", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER)],
      [team({ archivedAt: ARCHIVED_AT })],
      [{ userId: ALICE, isLead: true }],
    );
    expect(await edit(ALICE)).toEqual({ ok: false, error: NOT_MANAGER });
    expectNoTeamWrites();
  });

  it("a camp lead keeps it, and the edit is audited", async () => {
    dbMock.queue(
      campRow,
      [person(JABU, LEAD)],
      [team({ archivedAt: ARCHIVED_AT })],
      /* not on the team at all */ [],
    );
    expect(await edit(JABU)).toEqual({ ok: true });
    const [update] = dbMock.writesTo(schema.shiftTeams);
    expect(update!.arg("set")).toMatchObject({
      name: "Kitchen",
      nameNormalized: "kitchen",
      description: null,
    });
    expect(dbMock.writesTo(schema.auditEvents)[0]!.arg("values")).toMatchObject(
      { actorId: JABU, action: "camp.team.update", subject: TEAM },
    );
  });

  it("a team lead of ANOTHER team cannot edit this one", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER)],
      [team()],
      // This team's seats: REN leads it; ALICE is not on it.
      [{ userId: REN, isLead: true }],
    );
    expect(await edit(ALICE)).toEqual({ ok: false, error: NOT_MANAGER });
    expectNoTeamWrites();
  });
});

describe("archiving and restoring", () => {
  it("a team lead cannot archive their own team", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER)],
      [team()],
      [{ userId: ALICE, isLead: true }],
    );
    expect(
      await store.setCampTeamArchived(ALICE, {
        slug: SLUG,
        teamId: TEAM,
        archived: true,
      }),
    ).toEqual({ ok: false, error: NOT_MANAGER });
    expectNoTeamWrites();
  });

  it("a camp lead archives (stamped now) and restores (cleared), each audited as itself", async () => {
    dbMock.queue(campRow, [person(JABU, LEAD)], [team()], []);
    expect(
      await store.setCampTeamArchived(JABU, {
        slug: SLUG,
        teamId: TEAM,
        archived: true,
      }),
    ).toEqual({ ok: true });
    expect(dbMock.writesTo(schema.shiftTeams)[0]!.arg("set")).toEqual({
      archivedAt: expect.any(Date),
    });
    expect(dbMock.writesTo(schema.auditEvents)[0]!.arg("values")).toMatchObject(
      { action: "camp.team.archive", subject: TEAM },
    );

    dbMock.reset();
    dbMock.queue(
      campRow,
      [person(JABU, LEAD)],
      [team({ archivedAt: ARCHIVED_AT })],
      [],
    );
    expect(
      await store.setCampTeamArchived(JABU, {
        slug: SLUG,
        teamId: TEAM,
        archived: false,
      }),
    ).toEqual({ ok: true });
    expect(dbMock.writesTo(schema.shiftTeams)[0]!.arg("set")).toEqual({
      archivedAt: null,
    });
    expect(dbMock.writesTo(schema.auditEvents)[0]!.arg("values")).toMatchObject(
      { action: "camp.team.restore" },
    );
    // The chat and its people are kept: nothing is deleted.
    expect(dbMock.queriesOfKind("delete")).toHaveLength(0);
  });
});

describe("joining and leaving: refusals", () => {
  it("joining a team you are already on is refused, not inserted twice", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER)],
      [team()],
      [{ userId: ALICE, isLead: false }],
    );
    expect(
      await store.joinCampTeam(ALICE, { slug: SLUG, teamId: TEAM }),
    ).toEqual({ ok: false, error: "They're already on this team." });
    expectNoTeamWrites();
  });

  it("an archived team refuses a join even from a camp lead", async () => {
    dbMock.queue(
      campRow,
      [person(JABU, LEAD)],
      [team({ archivedAt: ARCHIVED_AT })],
      [],
    );
    expect(
      await store.joinCampTeam(JABU, { slug: SLUG, teamId: TEAM }),
    ).toEqual({ ok: false, error: ARCHIVED });
    expectNoTeamWrites();
  });

  it("a leads-add team says so to a member; a camp lead may put themselves on it", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER)],
      [team({ joinMode: LEADS_ADD })],
      [],
    );
    expect(
      await store.joinCampTeam(ALICE, { slug: SLUG, teamId: TEAM }),
    ).toEqual({ ok: false, error: "A team lead adds people to this team." });

    dbMock.reset();
    dbMock.queue(
      campRow,
      [person(JABU, LEAD)],
      [team({ joinMode: LEADS_ADD })],
      [],
      [],
      [{ id: CONVO }],
    );
    expect(
      await store.joinCampTeam(JABU, { slug: SLUG, teamId: TEAM }),
    ).toEqual({ ok: true });
    expect(dbMock.writesTo(schema.teamMembers)[0]!.arg("values")).toMatchObject(
      { userId: JABU, isLead: false, addedByUserId: null },
    );
  });

  it("leaving a team you are not on is refused and deletes nothing", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER)],
      [team()],
      [{ userId: REN, isLead: true }],
    );
    expect(
      await store.leaveCampTeam(ALICE, { slug: SLUG, teamId: TEAM }),
    ).toEqual({ ok: false, error: "They're not on this team." });
    expect(dbMock.queriesOfKind("delete")).toHaveLength(0);
  });

  it("the last lead may still leave (leaving is never gated), and it is not audited as a removal", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER)],
      [team({ archivedAt: ARCHIVED_AT })],
      [
        { userId: ALICE, isLead: true },
        { userId: REN, isLead: false },
      ],
    );
    expect(
      await store.leaveCampTeam(ALICE, { slug: SLUG, teamId: TEAM }),
    ).toEqual({ ok: true });
    const deletes = dbMock.queriesOfKind("delete");
    expect(deletes.map((d) => d.arg("delete"))).toEqual([
      schema.teamMembers,
      schema.conversationParticipants,
    ]);
    expect(boundStrings(deletes[0]!)).toEqual(
      expect.arrayContaining([TEAM, ALICE]),
    );
    expect(boundStrings(deletes[0]!)).not.toContain(REN);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });
});

describe("adding people: refusals, idempotency and notices", () => {
  const add = (actor: string, userIds: string[]) =>
    store.addCampTeamMembers(actor, { slug: SLUG, teamId: TEAM, userIds });

  it("a team lead loses the right on an archived team", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER), person(REN, MEMBER)],
      [team({ archivedAt: ARCHIVED_AT })],
      [{ userId: ALICE, isLead: true }],
    );
    expect(await add(ALICE, [REN])).toEqual({ ok: false, error: ARCHIVED });
    expectNoTeamWrites();
  });

  it("a camp lead keeps it on an archived team", async () => {
    dbMock.queue(
      campRow,
      [person(JABU, LEAD), person(REN, MEMBER)],
      [team({ archivedAt: ARCHIVED_AT })],
      [],
      [],
      [{ id: CONVO }],
    );
    expect(await add(JABU, [REN])).toEqual({ ok: true, added: 1 });
  });

  it("a team lead of another team cannot add to this one", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER), person(REN, MEMBER)],
      [team({ joinMode: LEADS_ADD })],
      // ALICE is a plain member of THIS team; her lead seat is elsewhere.
      [{ userId: ALICE, isLead: false }],
    );
    expect(await add(ALICE, [REN])).toEqual({ ok: false, error: NOT_MANAGER });
    expectNoTeamWrites();
  });

  it("an erased account that the lock still returns cannot be added", async () => {
    dbMock.queue(
      campRow,
      [person(JABU, LEAD), { ...person(REN, MEMBER), sanitizedAt: new Date() }],
      [team()],
      [],
    );
    expect(await add(JABU, [REN])).toEqual({
      ok: false,
      error: "Only current members of the camp can be added to a team.",
    });
    expectNoTeamWrites();
  });

  it("one person already on the team refuses the whole add", async () => {
    dbMock.queue(
      campRow,
      [person(JABU, LEAD), person(ALICE, MEMBER), person(REN, MEMBER)],
      [team()],
      [{ userId: REN, isLead: false }],
    );
    expect(await add(JABU, [ALICE, REN])).toEqual({
      ok: false,
      error: "They're already on this team.",
    });
    expectNoTeamWrites();
  });

  it("the same person named twice is added once, audited once and told once", async () => {
    dbMock.queue(
      campRow,
      [person(JABU, LEAD), person(REN, MEMBER)],
      [team()],
      [],
      [],
      [{ id: CONVO }],
    );
    expect(await add(JABU, [REN, REN])).toEqual({ ok: true, added: 1 });
    expect(
      (dbMock.writesTo(schema.teamMembers)[0]!.arg("values") as unknown[])
        .length,
    ).toBe(1);
    const audits = dbMock.writesTo(schema.auditEvents);
    expect(audits.map((a) => a.arg("values"))).toEqual([
      expect.objectContaining({
        action: "camp.team.member.add",
        subject: REN,
        meta: { groupId: CAMP, teamId: TEAM },
      }),
    ]);
    expect(
      dbMock.writesTo(schema.notifications)[0]!.arg("values") as unknown[],
    ).toHaveLength(1);
  });

  it("a camp lead adding themselves with someone else tells only the other", async () => {
    dbMock.queue(
      campRow,
      [person(JABU, LEAD), person(REN, MEMBER)],
      [team()],
      [],
      [],
      [{ id: CONVO }],
    );
    expect(await add(JABU, [JABU, REN])).toEqual({ ok: true, added: 2 });
    const [participants] = dbMock.writesTo(schema.conversationParticipants);
    expect(
      (participants!.arg("values") as { userId: string }[]).map(
        (p) => p.userId,
      ),
    ).toEqual([JABU, REN]);
    expect(
      (
        dbMock.writesTo(schema.notifications)[0]!.arg("values") as {
          userId: string;
          link: string;
        }[]
      ).map((n) => [n.userId, n.link]),
    ).toEqual([[REN, `/camps/${SLUG}/teams/${TEAM}`]]);
  });

  it("a failed notice never fails the add — it is logged instead", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMock.queue(
      campRow,
      [person(JABU, LEAD), person(REN, MEMBER)],
      [team()],
      /* seats */ [],
      /* insert seats */ [],
      /* ensure conversation */ [{ id: CONVO }],
      /* participants */ [],
      /* audit */ [],
      /* notification insert */ new Error("notifications down"),
    );
    try {
      expect(await add(JABU, [REN])).toEqual({ ok: true, added: 1 });
      expect(dbMock.pending).toBe(0);
      expect(errors).toHaveBeenCalledWith(
        "[notifications] team notice failed",
        expect.any(Error),
      );
    } finally {
      errors.mockRestore();
    }
  });
});

describe("removing people and appointing leads: refusals", () => {
  it("removing someone not on the team is refused", async () => {
    dbMock.queue(
      campRow,
      [person(JABU, LEAD)],
      [team()],
      [{ userId: ALICE, isLead: false }],
    );
    expect(
      await store.removeCampTeamMember(JABU, {
        slug: SLUG,
        teamId: TEAM,
        userId: REN,
      }),
    ).toEqual({ ok: false, error: "They're not on this team." });
    expect(dbMock.queriesOfKind("delete")).toHaveLength(0);
  });

  it("on an archived team a team lead cannot remove, a camp lead can (audited)", async () => {
    const seats = [
      { userId: ALICE, isLead: true },
      { userId: REN, isLead: false },
    ];
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER)],
      [team({ archivedAt: ARCHIVED_AT })],
      seats,
    );
    expect(
      await store.removeCampTeamMember(ALICE, {
        slug: SLUG,
        teamId: TEAM,
        userId: REN,
      }),
    ).toEqual({ ok: false, error: ARCHIVED });
    expect(dbMock.queriesOfKind("delete")).toHaveLength(0);

    dbMock.reset();
    dbMock.queue(
      campRow,
      [person(JABU, LEAD)],
      [team({ archivedAt: ARCHIVED_AT })],
      seats,
    );
    expect(
      await store.removeCampTeamMember(JABU, {
        slug: SLUG,
        teamId: TEAM,
        userId: REN,
      }),
    ).toEqual({ ok: true });
    expect(dbMock.writesTo(schema.auditEvents)[0]!.arg("values")).toMatchObject(
      { actorId: JABU, action: "camp.team.member.remove", subject: REN },
    );
  });

  it("a team lead makes someone on their team a lead (audited with the flag)", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER), person(REN, MEMBER)],
      [team()],
      [
        { userId: ALICE, isLead: true },
        { userId: REN, isLead: false },
      ],
    );
    expect(
      await store.setCampTeamLead(ALICE, {
        slug: SLUG,
        teamId: TEAM,
        userId: REN,
        isLead: true,
      }),
    ).toEqual({ ok: true });
    // The lock named the TARGET too, not only the actor.
    const share = dbMock.queries.find((q) => q.arg("for") === "share")!;
    expect(boundStrings(share)).toEqual(expect.arrayContaining([ALICE, REN]));
    const [update] = dbMock.writesTo(schema.teamMembers);
    expect(update!.kind).toBe("update");
    expect(update!.arg("set")).toMatchObject({ isLead: true });
    expect(boundStrings(update!)).toEqual(expect.arrayContaining([TEAM, REN]));
    expect(dbMock.writesTo(schema.auditEvents)[0]!.arg("values")).toMatchObject(
      {
        action: "camp.team.lead",
        subject: REN,
        meta: { groupId: CAMP, teamId: TEAM, isLead: true },
      },
    );
  });

  it("someone not on the team cannot be made a lead", async () => {
    dbMock.queue(
      campRow,
      [person(JABU, LEAD), person(REN, MEMBER)],
      [team()],
      [],
    );
    expect(
      await store.setCampTeamLead(JABU, {
        slug: SLUG,
        teamId: TEAM,
        userId: REN,
        isLead: true,
      }),
    ).toEqual({ ok: false, error: "They're not on this team." });
    expect(dbMock.writesTo(schema.teamMembers)).toHaveLength(0);
  });

  it("a team seat left over from someone no longer in the camp does not make them appointable", async () => {
    dbMock.queue(
      campRow,
      /* REN's membership is archived: only the actor locks */ [
        person(JABU, LEAD),
      ],
      [team()],
      [{ userId: REN, isLead: false }],
    );
    expect(
      await store.setCampTeamLead(JABU, {
        slug: SLUG,
        teamId: TEAM,
        userId: REN,
        isLead: true,
      }),
    ).toEqual({ ok: false, error: "They're not on this team." });
    expect(dbMock.writesTo(schema.teamMembers)).toHaveLength(0);
  });

  it("a team lead on an archived team cannot appoint; a plain member never can", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER), person(REN, MEMBER)],
      [team({ archivedAt: ARCHIVED_AT })],
      [
        { userId: ALICE, isLead: true },
        { userId: REN, isLead: false },
      ],
    );
    expect(
      await store.setCampTeamLead(ALICE, {
        slug: SLUG,
        teamId: TEAM,
        userId: REN,
        isLead: true,
      }),
    ).toEqual({ ok: false, error: ARCHIVED });

    dbMock.reset();
    dbMock.queue(
      campRow,
      [person(ALICE, MEMBER), person(REN, MEMBER)],
      [team()],
      [
        { userId: ALICE, isLead: false },
        { userId: REN, isLead: true },
      ],
    );
    expect(
      await store.setCampTeamLead(ALICE, {
        slug: SLUG,
        teamId: TEAM,
        userId: REN,
        isLead: false,
      }),
    ).toEqual({ ok: false, error: NOT_MANAGER });
    expect(dbMock.writesTo(schema.teamMembers)).toHaveLength(0);
  });
});

describe("reads: archived teams, the viewer's own seat and candidates", () => {
  const archivedTeam = {
    ...team({ archivedAt: ARCHIVED_AT }),
    id: TEAM_B,
    name: "Sound",
  };

  it("an archived team is listed for a camp lead (to restore it) but not for a member off it", async () => {
    dbMock.queue(campRow, [{ role: LEAD }], [team(), archivedTeam], []);
    const lead = await store.listCampTeams({ slug: SLUG, viewerUserId: JABU });
    expect(lead!.canCreate).toBe(true);
    expect(lead!.teams.map((t) => [t.name, t.archived, t.canJoin])).toEqual([
      ["Kitchen", false, true],
      ["Sound", true, false],
    ]);

    dbMock.reset();
    dbMock.queue(campRow, [{ role: MEMBER }], [team(), archivedTeam], []);
    const member = await store.listCampTeams({
      slug: SLUG,
      viewerUserId: ALICE,
    });
    expect(member!.teams.map((t) => t.name)).toEqual(["Kitchen"]);
  });

  it("a member still on an archived team sees it, marked as theirs, leads by name", async () => {
    dbMock.queue(
      campRow,
      [{ role: MEMBER }],
      [archivedTeam],
      [
        { teamId: TEAM_B, userId: REN, isLead: true, username: "ren" },
        { teamId: TEAM_B, userId: ALICE, isLead: true, username: "alice" },
      ],
    );
    const view = await store.listCampTeams({
      slug: SLUG,
      viewerUserId: ALICE,
    });
    const [only] = view!.teams;
    expect(only).toMatchObject({
      name: "Sound",
      archived: true,
      viewerOnTeam: true,
      canJoin: false,
      memberCount: 2,
    });
    expect(only!.leads.map((l) => l.userId)).toEqual([ALICE, REN]);
  });

  it("a camp with no teams never reads seats", async () => {
    dbMock.queue(campRow, [{ role: MEMBER }], []);
    const view = await store.listCampTeams({
      slug: SLUG,
      viewerUserId: ALICE,
    });
    expect(view!.teams).toEqual([]);
    expect(dbMock.queriesTouching(schema.teamMembers)).toHaveLength(0);
  });

  it("the team page: a team lead may manage but not archive; a camp lead may do both", async () => {
    const row = { ...team(), description: "We cook." };
    dbMock.queue(
      campRow,
      [{ role: MEMBER }],
      [row],
      [{ teamId: TEAM, userId: ALICE, isLead: true, username: "alice" }],
      [{ id: CONVO }],
    );
    const teamLead = await store.getCampTeam({
      slug: SLUG,
      teamId: TEAM,
      viewerUserId: ALICE,
    });
    expect(teamLead).toMatchObject({
      viewerOnTeam: true,
      viewerIsTeamLead: true,
      canManage: true,
      canArchive: false,
      canJoin: false,
      description: "We cook.",
    });

    dbMock.reset();
    dbMock.queue(campRow, [{ role: LEAD }], [row], []);
    const campLead = await store.getCampTeam({
      slug: SLUG,
      teamId: TEAM,
      viewerUserId: JABU,
    });
    expect(campLead).toMatchObject({
      viewerOnTeam: false,
      viewerIsTeamLead: false,
      canManage: true,
      canArchive: true,
      canJoin: true,
    });
  });

  it("an unknown team page is null, and its seats are never read", async () => {
    dbMock.queue(campRow, [{ role: LEAD }], []);
    expect(
      await store.getCampTeam({ slug: SLUG, teamId: TEAM, viewerUserId: JABU }),
    ).toBeNull();
    expect(dbMock.queriesTouching(schema.teamMembers)).toHaveLength(0);
  });

  it("a member on an archived team still gets its page, but may no longer manage it", async () => {
    dbMock.queue(
      campRow,
      [{ role: MEMBER }],
      [{ ...team({ archivedAt: ARCHIVED_AT }), description: null }],
      [{ teamId: TEAM, userId: ALICE, isLead: true, username: "alice" }],
      [{ id: CONVO }],
    );
    const view = await store.getCampTeam({
      slug: SLUG,
      teamId: TEAM,
      viewerUserId: ALICE,
    });
    expect(view).toMatchObject({
      archived: true,
      viewerIsTeamLead: true,
      canManage: false,
      chatConversationId: CONVO,
    });
  });

  it("candidates to add: nobody for a plain member, and the camp's members are never read", async () => {
    dbMock.queue(
      campRow,
      [{ role: MEMBER }],
      [{ ...team(), description: null }],
      [{ teamId: TEAM, userId: ALICE, isLead: false, username: "alice" }],
      [{ id: CONVO }],
    );
    expect(
      await store.listTeamCandidates({
        slug: SLUG,
        teamId: TEAM,
        viewerUserId: ALICE,
      }),
    ).toEqual([]);
    expect(dbMock.pending).toBe(0);
    // The only membership read is the viewer's own role.
    expect(dbMock.queriesTouching(schema.memberships)).toHaveLength(2);
  });

  it("candidates to add: the camp's members not already on the team, by name", async () => {
    dbMock.queue(
      campRow,
      [{ role: LEAD }],
      [{ ...team(), description: null }],
      [{ teamId: TEAM, userId: REN, isLead: false, username: "ren" }],
      /* the camp's current members */ [
        { userId: REN, username: "ren" },
        { userId: JABU, username: "jabu" },
        { userId: ALICE, username: "alice" },
      ],
    );
    const people = await store.listTeamCandidates({
      slug: SLUG,
      teamId: TEAM,
      viewerUserId: JABU,
    });
    expect(people.map((p) => p.userId)).toEqual([ALICE, JABU]);
    expect(people.every((p) => p.isLead === false)).toBe(true);
  });

  it("candidates for an unknown team: nothing, without reading the camp's members", async () => {
    dbMock.queue(campRow, [{ role: LEAD }], []);
    expect(
      await store.listTeamCandidates({
        slug: SLUG,
        teamId: TEAM,
        viewerUserId: JABU,
      }),
    ).toEqual([]);
    expect(dbMock.queries).toHaveLength(3);
  });
});

describe("cleanup when someone leaves one camp", () => {
  it("removeFromCampTeams deletes their seats and team-chat rows in THIS camp only", async () => {
    await store.removeFromCampTeams(dbMock.handle as never, {
      userId: ALICE,
      groupId: CAMP,
    });
    const deletes = dbMock.queriesOfKind("delete");
    expect(deletes.map((d) => d.arg("delete"))).toEqual([
      schema.teamMembers,
      schema.conversationParticipants,
    ]);
    for (const d of deletes) {
      expect(boundStrings(d)).toContain(ALICE);
    }
    // Both deletes are narrowed by ONE subquery: this camp's teams.
    const campTeams = dbMock
      .queriesTouching(schema.shiftTeams)
      .filter((q) => q.kind === "select");
    expect(campTeams).toHaveLength(1);
    expect(boundParams(campTeams[0]!.arg("where"))).toEqual([CAMP]);
    // The participant delete is narrowed to TEAM conversations.
    const convos = dbMock
      .queriesTouching(schema.conversations)
      .filter((q) => q.kind === "select");
    expect(boundParams(convos[0]!.arg("where"))).toEqual(["team"]);
  });
});

describe("team chat wrappers", () => {
  const MSG = "dddddddd-0000-4000-8000-000000000001";

  it("refuse malformed input before any query", async () => {
    expect(
      await store.postTeamMessage(ALICE, {
        slug: SLUG,
        teamId: TEAM,
        body: "",
      }),
    ).toEqual({ ok: false, error: INVALID });
    expect(
      await store.changeTeamChatTimer(ALICE, {
        slug: SLUG,
        teamId: TEAM,
        timer: "1h",
      }),
    ).toEqual({ ok: false, error: INVALID });
    expect(
      await store.reportTeamChatMessages(ALICE, {
        slug: SLUG,
        teamId: TEAM,
        messageIds: [],
      }),
    ).toEqual({ ok: false, error: INVALID });
    expect(dbMock.queries).toHaveLength(0);
  });

  it("an unknown or non-project camp is the chat's 404, before the chat is read", async () => {
    dbMock.queue([], [], [], []);
    expect(
      await store.postTeamMessage(ALICE, {
        slug: SLUG,
        teamId: TEAM,
        body: "hi",
      }),
    ).toEqual({ ok: false, error: CHAT_MISSING });
    expect(
      await store.changeTeamChatTimer(ALICE, {
        slug: SLUG,
        teamId: TEAM,
        timer: "24h",
      }),
    ).toEqual({ ok: false, error: CHAT_MISSING });
    expect(
      await store.reportTeamChatMessages(ALICE, {
        slug: SLUG,
        teamId: TEAM,
        messageIds: [MSG],
      }),
    ).toEqual({ ok: false, error: CHAT_MISSING });
    expect(
      await store.loadTeamChat({
        slug: SLUG,
        teamId: TEAM,
        viewerUserId: ALICE,
      }),
    ).toBeNull();
    // Four camp lookups and nothing after them.
    expect(dbMock.queries).toHaveLength(4);
    expect(dbMock.queriesTouching(schema.shiftTeams)).toHaveLength(0);
  });

  it("post and report hand the chat the camp's id resolved from the slug", async () => {
    dbMock.queue(campRow, /* team not in this camp */ []);
    expect(
      await store.postTeamMessage(ALICE, {
        slug: SLUG,
        teamId: TEAM,
        body: "hi",
      }),
    ).toEqual({ ok: false, error: CHAT_MISSING });
    const postLookup = dbMock.queriesTouching(schema.shiftTeams);
    expect(postLookup).toHaveLength(1);
    expect(boundStrings(postLookup[0]!)).toEqual(
      expect.arrayContaining([TEAM, CAMP]),
    );
    expect(dbMock.writesTo(schema.messages)).toHaveLength(0);

    dbMock.reset();
    dbMock.queue(campRow, []);
    expect(
      await store.reportTeamChatMessages(ALICE, {
        slug: SLUG,
        teamId: TEAM,
        messageIds: [MSG],
      }),
    ).toEqual({ ok: false, error: CHAT_MISSING });
    const reportLookup = dbMock.queriesTouching(schema.shiftTeams);
    expect(boundStrings(reportLookup[0]!)).toEqual(
      expect.arrayContaining([TEAM, CAMP]),
    );
    expect(dbMock.queriesTouching(schema.messages)).toHaveLength(0);
  });

  it("loadTeamChat for a team not in the camp is null", async () => {
    dbMock.queue(campRow, []);
    expect(
      await store.loadTeamChat({
        slug: SLUG,
        teamId: TEAM,
        viewerUserId: ALICE,
      }),
    ).toBeNull();
    expect(boundStrings(dbMock.queriesTouching(schema.shiftTeams)[0]!)).toEqual(
      expect.arrayContaining([TEAM, CAMP]),
    );
  });
});

describe("the team lead cap on appointments", () => {
  const leadSeats = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      userId: `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, "0")}`,
      isLead: true,
    }));
  const appoint = (isLead: boolean, userId = REN) =>
    store.setCampTeamLead(JABU, { slug: SLUG, teamId: TEAM, userId, isLead });

  it("an eleventh lead is refused, and nothing is written", async () => {
    dbMock.queue(
      campRow,
      [person(JABU, LEAD), person(REN, MEMBER)],
      [team()],
      [...leadSeats(TEAM_MAX_LEADS), { userId: REN, isLead: false }],
    );
    expect(await appoint(true)).toEqual({
      ok: false,
      error: `A team can have up to ${TEAM_MAX_LEADS} leads.`,
    });
    expect(dbMock.writesTo(schema.teamMembers)).toHaveLength(0);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });

  it("the tenth lead is allowed", async () => {
    dbMock.queue(
      campRow,
      [person(JABU, LEAD), person(REN, MEMBER)],
      [team()],
      [...leadSeats(TEAM_MAX_LEADS - 1), { userId: REN, isLead: false }],
    );
    expect(await appoint(true)).toEqual({ ok: true });
    expect(dbMock.writesTo(schema.teamMembers)[0]!.arg("set")).toMatchObject({
      isLead: true,
    });
  });

  it("at the cap, standing a lead down and re-confirming a lead still work", async () => {
    const full = leadSeats(TEAM_MAX_LEADS);
    const existing = full[0]!.userId;
    dbMock.queue(
      campRow,
      [person(JABU, LEAD), { ...person(existing, MEMBER), username: "x" }],
      [team()],
      full,
    );
    expect(await appoint(false, existing)).toEqual({ ok: true });

    dbMock.reset();
    dbMock.queue(
      campRow,
      [person(JABU, LEAD), { ...person(existing, MEMBER), username: "x" }],
      [team()],
      full,
    );
    expect(await appoint(true, existing)).toEqual({ ok: true });
  });
});
