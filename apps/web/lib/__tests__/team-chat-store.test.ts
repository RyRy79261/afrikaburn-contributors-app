import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { MembershipRole } from "@quagga/types";
import { MESSAGE_TIMERS } from "@quagga/core";
import { dbMock } from "@/test/db-mock";

// Team chats (docs/camp-teams-spec.md) — the team half of messages-store.
// Asserts DECISIONS — who is refused before which table is touched, what is
// written — not SQL (see db-mock's header). The SQL half of the history cut and
// block hiding is pinned by the core rule re-applied over what the query
// returns, and by the persona suite against a real database.
//
// Fixture roles and timers come from the real vocabularies.

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

const stubs = vi.hoisted(() => ({
  rateLimit: { allowed: true, retryAfterSeconds: 0 },
  rateLimitCalls: 0,
}));

vi.mock("@quagga/db", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@quagga/db");
  return {
    ...actual,
    consumeRateLimit: async () => {
      stubs.rateLimitCalls += 1;
      return stubs.rateLimit;
    },
  };
});

vi.mock("../campmates-store", () => ({
  loadCampmateMemberships: async () => new Map(),
  resolveAvatarForViewer: async () => null,
}));

const store = await import("../messages-store");

const [OFF, , SEVEN_DAYS] = MESSAGE_TIMERS;
const LEAD = MembershipRole.enum.lead;
const MEMBER = MembershipRole.enum.member;

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001"; // on the team
const REN = "aaaaaaaa-0000-4000-8000-000000000002"; // on the team
const JABU = "aaaaaaaa-0000-4000-8000-000000000003"; // camp lead, NOT on it
const CAMP = "11111111-0000-4000-8000-00000000000a";
const TEAM = "77777777-0000-4000-8000-000000000001";
const CONVO = "cccccccc-0000-4000-8000-000000000001";
const JOINED = new Date("2027-04-20T10:00:00Z");
const NOW = new Date("2027-04-27T12:00:00Z");

const teamRow = (over: Record<string, unknown> = {}) => ({
  teamId: TEAM,
  teamName: "Kitchen",
  archivedAt: null,
  campName: "Mad Hatters",
  ...over,
});
const PARTICIPANTS = [
  { userId: ALICE, joinedAt: JOINED },
  { userId: REN, joinedAt: JOINED },
];

/** The facts load for a viewer ON the team (seated). */
function queueSeated(
  seat: { role: string; isLead: boolean },
  over: { team?: Record<string, unknown>; timer?: string } = {},
) {
  dbMock.queue(
    [teamRow(over.team)],
    [seat],
    [{ id: CONVO, timer: over.timer ?? OFF }],
    PARTICIPANTS,
  );
}

/** The facts load for a viewer NOT on the team (not seated). */
function queueUnseated(campRole: string | null, participants = PARTICIPANTS) {
  dbMock.queue(
    [teamRow()],
    /* not on the team */ [],
    campRole ? [{ role: campRole }] : [],
    [{ id: CONVO, timer: OFF }],
    participants,
  );
}

function message(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    conversationId: CONVO,
    senderId: REN,
    kind: "text",
    body: `body of ${id}`,
    createdAt: new Date("2027-04-26T10:00:00Z"),
    expiresAt: null,
    ...over,
  };
}

const at = (viewerUserId: string) => ({
  groupId: CAMP,
  teamId: TEAM,
  viewerUserId,
  now: NOW,
});

beforeEach(() => {
  dbMock.reset();
  stubs.rateLimit = { allowed: true, retryAfterSeconds: 0 };
  stubs.rateLimitCalls = 0;
  process.env.DATABASE_URL = "postgres://test";
});

afterEach(() => {
  delete process.env.DATABASE_URL;
});

describe("reading a team chat — current team members only", () => {
  it("refuses a camp LEAD who is not on the team, before `messages` is touched", async () => {
    queueUnseated(LEAD);
    expect(await store.getTeamChat(at(JABU))).toBeNull();
    expect(dbMock.queriesTouching(schema.messages)).toHaveLength(0);
    expect(dbMock.writesTo(schema.conversationParticipants)).toHaveLength(0);
  });

  it("refuses a stale participant row without a team seat (left the team)", async () => {
    // ALICE still has a participant row, but no longer a team row.
    queueUnseated(MEMBER);
    expect(await store.getTeamChat(at(ALICE))).toBeNull();
    expect(dbMock.queriesTouching(schema.messages)).toHaveLength(0);
  });

  it("refuses a team seat with no participant row", async () => {
    dbMock.queue(
      [teamRow()],
      [{ role: MEMBER, isLead: false }],
      [{ id: CONVO, timer: OFF }],
      [{ userId: REN, joinedAt: JOINED }],
    );
    expect(await store.getTeamChat(at(ALICE))).toBeNull();
    expect(dbMock.queriesTouching(schema.messages)).toHaveLength(0);
  });

  it("refuses another camp's team (no team row in THIS camp)", async () => {
    dbMock.queue([]);
    expect(await store.getTeamChat(at(ALICE))).toBeNull();
    expect(dbMock.queriesTouching(schema.messages)).toHaveLength(0);
  });

  it("serves a member: only messages since they joined, none from a blocked person, and marks read", async () => {
    queueSeated({ role: MEMBER, isLead: false }, { timer: SEVEN_DAYS });
    dbMock.queue(
      /* blocks */ [{ blockerId: ALICE, blockedId: JABU }],
      // NEWEST first, as the query orders. Even if SQL let them through, the
      // core rule drops the pre-join and the blocked messages.
      /* messages */ [
        message("m3", { senderId: JABU }),
        message("m2", { senderId: ALICE }),
        message("m1"),
        message("m0", { createdAt: new Date("2027-04-19T00:00:00Z") }),
      ],
      /* names */ [
        { id: ALICE, username: "alice_hatter", sanitizedAt: null },
        { id: REN, username: "ren_notfound", sanitizedAt: null },
      ],
    );
    const view = await store.getTeamChat(at(ALICE));
    expect(view).not.toBeNull();
    expect(view!.messages.map((m) => [m.id, m.mine, m.senderName])).toEqual([
      ["m1", false, "ren_notfound"],
      ["m2", true, "alice_hatter"],
    ]);
    expect(view!.timer).toBe(SEVEN_DAYS);
    expect(view!.joinedAt).toEqual(JOINED);
    expect(view!.memberCount).toBe(2);
    expect(view!.canSend).toBe(true);
    // A plain member does not set the timer.
    expect(view!.canSetTimer).toBe(false);
    const read = dbMock.writesTo(schema.conversationParticipants);
    expect(read).toHaveLength(1);
    expect(read[0]!.arg("set")).toEqual({ lastReadAt: NOW });
  });
});

describe("posting into a team chat", () => {
  it("refuses a camp lead who is not on the team, and writes nothing", async () => {
    queueUnseated(LEAD);
    const result = await store.sendTeamMessage({ ...at(JABU), body: "hello" });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.messages)).toHaveLength(0);
    expect(stubs.rateLimitCalls).toBe(0);
  });

  it("refuses a member removed between the check and the lock", async () => {
    queueSeated({ role: MEMBER, isLead: false });
    // Inside the transaction: removed meanwhile, so no seat any more.
    queueUnseated(MEMBER);
    const result = await store.sendTeamMessage({ ...at(ALICE), body: "hi" });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.messages)).toHaveLength(0);
  });

  it("posts for a member, with the expiry of the timer in force, under the seat lock", async () => {
    queueSeated({ role: MEMBER, isLead: false });
    queueSeated({ role: MEMBER, isLead: false }, { timer: SEVEN_DAYS });
    const result = await store.sendTeamMessage({
      ...at(ALICE),
      body: "call me on 082 555 0100",
    });
    expect(result).toEqual({ ok: true, phoneHint: true });
    const [insert] = dbMock.writesTo(schema.messages);
    expect(insert!.tx).toBe(true);
    expect(insert!.arg("values")).toMatchObject({
      conversationId: CONVO,
      senderId: ALICE,
      kind: "text",
      expiresAt: new Date(NOW.getTime() + 7 * 86_400_000),
    });
    // The lock is taken on the SEAT query (team_members joined to the
    // membership and the account) — not some other select in the load.
    const locked = dbMock.queries.filter(
      (q) => q.tx && q.called("for") && q.arg("for") === "share",
    );
    expect(locked).toHaveLength(1);
    const of = (
      locked[0]!.calls.find((c) => c.method === "for")!.args[1] as {
        of: unknown[];
      }
    ).of;
    expect(of).toEqual([schema.memberships, schema.users, schema.teamMembers]);
    expect(
      locked[0]!.calls.some((c) => c.args.includes(schema.teamMembers)),
    ).toBe(true);
  });

  it("an archived team's chat is read-only", async () => {
    queueSeated({ role: MEMBER, isLead: false }, { team: { archivedAt: NOW } });
    queueSeated({ role: MEMBER, isLead: false }, { team: { archivedAt: NOW } });
    const result = await store.sendTeamMessage({ ...at(ALICE), body: "hi" });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.messages)).toHaveLength(0);
  });
});

describe("the team chat timer", () => {
  it("refuses a plain member", async () => {
    queueSeated({ role: MEMBER, isLead: false });
    const result = await store.setTeamChatTimer({
      ...at(ALICE),
      timer: SEVEN_DAYS,
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.conversations)).toHaveLength(0);
    expect(dbMock.writesTo(schema.messages)).toHaveLength(0);
  });

  it("refuses a camp lead who is not on the team", async () => {
    queueUnseated(LEAD);
    const result = await store.setTeamChatTimer({
      ...at(JABU),
      timer: SEVEN_DAYS,
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.conversations)).toHaveLength(0);
  });

  it("a team lead sets it, with a system line in the chat", async () => {
    queueSeated({ role: MEMBER, isLead: true });
    const result = await store.setTeamChatTimer({
      ...at(ALICE),
      timer: SEVEN_DAYS,
    });
    expect(result).toEqual({ ok: true });
    const [update] = dbMock.writesTo(schema.conversations);
    expect(update!.arg("set")).toMatchObject({ timer: SEVEN_DAYS });
    const [line] = dbMock.writesTo(schema.messages);
    expect(line!.arg("values")).toMatchObject({ kind: "system" });
  });

  it("a camp lead on the team sets it too", async () => {
    queueSeated({ role: LEAD, isLead: false });
    const result = await store.setTeamChatTimer({ ...at(ALICE), timer: OFF });
    expect(result).toEqual({ ok: true });
  });
});

describe("reporting team messages", () => {
  it("refuses a camp lead not on the team before any message is read", async () => {
    queueUnseated(LEAD);
    const result = await store.reportTeamMessages({
      ...at(JABU),
      messageIds: ["m1"],
      reason: null,
    });
    expect(result.ok).toBe(false);
    expect(dbMock.queriesTouching(schema.messages)).toHaveLength(0);
    expect(dbMock.writesTo(schema.messageReports)).toHaveLength(0);
  });

  it("refuses a message from before the reporter joined", async () => {
    queueSeated({ role: MEMBER, isLead: false });
    dbMock.queue(
      [message("m0", { createdAt: new Date("2027-04-19T00:00:00Z") })],
      /* blocks */ [],
    );
    const result = await store.reportTeamMessages({
      ...at(ALICE),
      messageIds: ["m0"],
      reason: null,
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.messageReports)).toHaveLength(0);
  });

  it("copies visible messages and names their sender as the reported person", async () => {
    queueSeated({ role: MEMBER, isLead: false });
    dbMock.queue(
      [message("m1"), message("m2", { senderId: ALICE })],
      /* blocks */ [],
      /* report insert */ [{ id: "r1" }],
    );
    const result = await store.reportTeamMessages({
      ...at(ALICE),
      messageIds: ["m1", "m2"],
      reason: "  ",
    });
    expect(result).toEqual({ ok: true, reportId: "r1" });
    const [report] = dbMock.writesTo(schema.messageReports);
    expect(report!.arg("values")).toMatchObject({
      conversationId: CONVO,
      reporterId: ALICE,
      reportedUserId: REN,
      reason: null,
    });
    const [items] = dbMock.writesTo(schema.messageReportItems);
    expect((items!.arg("values") as unknown[]).length).toBe(2);
  });
});

describe("the 1:1 paths refuse a team chat's id", () => {
  const teamParticipant = (userId: string) => ({
    userId,
    username: "someone",
    sanitizedAt: null,
    lastReadAt: null,
    hiddenAt: null,
    conversationKind: "team",
  });

  it("getConversation answers null, before `messages` is touched", async () => {
    dbMock.queue([teamParticipant(ALICE), teamParticipant(REN)]);
    expect(
      await store.getConversation({
        viewerUserId: ALICE,
        conversationId: CONVO,
        editionId: "e",
        now: NOW,
      }),
    ).toBeNull();
    expect(dbMock.queriesTouching(schema.messages)).toHaveLength(0);
  });

  it("sendMessage and reportMessages refuse and write nothing", async () => {
    dbMock.queue([teamParticipant(ALICE), teamParticipant(REN)]);
    expect(
      (
        await store.sendMessage({
          viewerUserId: ALICE,
          conversationId: CONVO,
          body: "hi",
        })
      ).ok,
    ).toBe(false);
    dbMock.queue([teamParticipant(ALICE), teamParticipant(REN)]);
    expect(
      (
        await store.reportMessages({
          viewerUserId: ALICE,
          conversationId: CONVO,
          messageIds: ["m1"],
          reason: null,
        })
      ).ok,
    ).toBe(false);
    expect(dbMock.writesTo(schema.messages)).toHaveLength(0);
    expect(dbMock.writesTo(schema.messageReports)).toHaveLength(0);
    expect(dbMock.queriesTouching(schema.messages)).toHaveLength(0);
  });
});

describe("the inbox lists team chats beside direct ones", () => {
  const SEEN_AT = new Date("2027-04-27T09:00:00Z");

  it("dates and sorts a team row by the newest message the viewer can SEE, not the conversation's last send", async () => {
    // The team conversation's last_message_at (NOW) was bumped by a message
    // ALICE cannot see (a blocked sender, or sent before she joined). Her
    // newest visible one is SEEN_AT; a DM sits between the two.
    const DM = "cccccccc-0000-4000-8000-000000000002";
    const DM_AT = new Date("2027-04-27T11:00:00Z");
    dbMock.queue(
      /* mine, in last_message_at order */ [
        {
          conversationId: CONVO,
          kind: "team",
          teamId: TEAM,
          joinedAt: JOINED,
          lastReadAt: null,
          lastMessageAt: NOW,
          createdAt: JOINED,
        },
        {
          conversationId: DM,
          kind: "direct",
          teamId: null,
          joinedAt: JOINED,
          lastReadAt: null,
          lastMessageAt: DM_AT,
          createdAt: JOINED,
        },
      ],
      /* the DM's other side */ [
        { conversationId: DM, userId: REN, username: "ren", sanitizedAt: null },
      ],
      /* unread */ [],
      /* teams */ [
        {
          teamId: TEAM,
          teamName: "Kitchen",
          campSlug: "mad-hatters",
          campName: "Mad Hatters",
        },
      ],
      /* last visible */ [
        { username: "carol", sanitizedAt: null, createdAt: SEEN_AT },
      ],
    );
    const inbox = await store.listInbox({
      viewerUserId: ALICE,
      editionId: "e",
      now: NOW,
    });
    expect(inbox.map((e) => [e.conversationId, e.lastMessageAt])).toEqual([
      [DM, DM_AT],
      [CONVO, SEEN_AT],
    ]);
  });

  it("shows no time for a team row with nothing visible yet", async () => {
    dbMock.queue(
      [
        {
          conversationId: CONVO,
          kind: "team",
          teamId: TEAM,
          joinedAt: JOINED,
          lastReadAt: null,
          lastMessageAt: NOW,
          createdAt: JOINED,
        },
      ],
      [],
      [
        {
          teamId: TEAM,
          teamName: "Kitchen",
          campSlug: "mad-hatters",
          campName: "Mad Hatters",
        },
      ],
      /* nothing visible */ [],
    );
    const [entry] = await store.listInbox({
      viewerUserId: ALICE,
      editionId: "e",
      now: NOW,
    });
    expect(entry).toMatchObject({ lastSenderName: null, lastMessageAt: null });
  });

  it("shows the team's name and the last sender, never a body", async () => {
    dbMock.queue(
      /* mine */ [
        {
          conversationId: CONVO,
          kind: "team",
          teamId: TEAM,
          joinedAt: JOINED,
          lastReadAt: null,
          lastMessageAt: NOW,
          createdAt: JOINED,
        },
      ],
      /* unread */ [{ conversationId: CONVO, count: 2 }],
      /* teams */ [
        {
          teamId: TEAM,
          teamName: "Kitchen",
          campSlug: "mad-hatters",
          campName: "Mad Hatters",
        },
      ],
      /* last sender */ [
        { username: "ren_notfound", sanitizedAt: null, createdAt: SEEN_AT },
      ],
    );
    const inbox = await store.listInbox({
      viewerUserId: ALICE,
      editionId: "e",
      now: NOW,
    });
    expect(inbox).toEqual([
      {
        kind: "team",
        conversationId: CONVO,
        teamId: TEAM,
        teamName: "Kitchen",
        campSlug: "mad-hatters",
        campName: "Mad Hatters",
        unread: 2,
        lastSenderName: "ren_notfound",
        // The visible message's time, NOT the conversation's NOW.
        lastMessageAt: SEEN_AT,
      },
    ]);
    for (const q of dbMock.queriesOfKind("select")) {
      expect(Object.keys((q.arg("select") as object) ?? {})).not.toContain(
        "body",
      );
    }
  });
});
