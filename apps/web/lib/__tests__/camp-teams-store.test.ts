import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { GroupKind, MembershipRole, TEAM_JOIN_MODES } from "@quagga/types";
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
      expect(d.tx).toBe(true);
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
