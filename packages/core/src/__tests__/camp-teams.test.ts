import { describe, expect, it } from "vitest";
import {
  MembershipRole,
  NotificationKind,
  TEAM_CHAT_TIMERS,
  TEAM_JOIN_MODES,
  TEAM_NAME_MAX,
} from "@quagga/types";
import {
  MESSAGE_TIMERS,
  SHIFT_TEAM_NAME_MAX,
  canArchiveTeam,
  canCreateTeam,
  canManageTeam,
  canReadTeamChat,
  canReportTeamMessages,
  canSeeCampTeams,
  canSendTeamMessage,
  canSetTeamChatTimer,
  decideAddTeamMember,
  decideJoinTeam,
  decideLeaveTeam,
  decideRemoveTeamMember,
  decideSetTeamLead,
  isTeamMessageVisible,
  reportedTeamSender,
  teamAddedNotification,
  teamInboxLine,
  teamRefusalMessage,
  visibleTeamMessages,
  type TeamChatAccess,
  type TeamFacts,
  type TeamViewer,
} from "../index";

// Camp teams (docs/camp-teams-spec.md). Every fixture value comes from the
// real vocabularies (MembershipRole, TEAM_JOIN_MODES): a role or join mode
// outside its enum would make the gate under test inert.

const [LEAD, ADMIN, MEMBER] = [
  MembershipRole.enum.lead,
  MembershipRole.enum.admin,
  MembershipRole.enum.member,
];
const [OPEN, LEADS_ADD] = TEAM_JOIN_MODES;

const ALICE = "u-alice";
const REN = "u-ren";
const JABU = "u-jabu";

const campLead: TeamViewer = { userId: JABU, campRole: LEAD };
const coLead: TeamViewer = { userId: JABU, campRole: ADMIN };
const member: TeamViewer = { userId: ALICE, campRole: MEMBER };
const stranger: TeamViewer = { userId: "u-x", campRole: null };

const open: TeamFacts = { joinMode: OPEN, archived: false };
const leadsAdd: TeamFacts = { joinMode: LEADS_ADD, archived: false };
const archived: TeamFacts = { joinMode: OPEN, archived: true };

describe("vocabularies stay in step", () => {
  it("the team chat timers are the direct-message timers", () => {
    expect([...TEAM_CHAT_TIMERS]).toEqual([...MESSAGE_TIMERS]);
  });
  it("the team name limit is the shifts team editor's (one list)", () => {
    expect(TEAM_NAME_MAX).toBe(SHIFT_TEAM_NAME_MAX);
  });
  it("`team` is a notification kind", () => {
    expect(NotificationKind.options).toContain("team");
  });
});

describe("who sees and manages a team", () => {
  it("every current camp member sees the teams; strangers do not", () => {
    expect(canSeeCampTeams(member)).toBe(true);
    expect(canSeeCampTeams(campLead)).toBe(true);
    expect(canSeeCampTeams(stranger)).toBe(false);
  });

  it("only camp leads and co-leads create and archive", () => {
    expect(canCreateTeam(campLead)).toBe(true);
    expect(canCreateTeam(coLead)).toBe(true);
    expect(canCreateTeam(member)).toBe(false);
    expect(canArchiveTeam(member)).toBe(false);
    expect(canArchiveTeam(coLead)).toBe(true);
  });

  it("camp leads manage every team; a team lead only their own", () => {
    expect(canManageTeam(campLead, open, null)).toBe(true);
    expect(canManageTeam(coLead, archived, null)).toBe(true);
    expect(canManageTeam(member, open, { isLead: true })).toBe(true);
    expect(canManageTeam(member, open, { isLead: false })).toBe(false);
    expect(canManageTeam(member, open, null)).toBe(false);
    // A team lead's rights end with the team's archive.
    expect(canManageTeam(member, archived, { isLead: true })).toBe(false);
    // A team row is nothing without a current camp membership.
    expect(canManageTeam(stranger, open, { isLead: true })).toBe(false);
  });
});

describe("joining, leaving, adding, removing", () => {
  it("a member joins an open team with one tap", () => {
    expect(decideJoinTeam(member, open, null)).toEqual({ ok: true });
  });

  it("a leads-add team refuses a member, but a camp lead may add themselves", () => {
    expect(decideJoinTeam(member, leadsAdd, null)).toEqual({
      ok: false,
      reason: "leads_add",
    });
    expect(decideJoinTeam(campLead, leadsAdd, null)).toEqual({ ok: true });
  });

  it("refuses strangers, archived teams and a second join", () => {
    expect(decideJoinTeam(stranger, open, null)).toMatchObject({
      reason: "not_member",
    });
    expect(decideJoinTeam(member, archived, null)).toMatchObject({
      reason: "archived",
    });
    expect(decideJoinTeam(member, open, { isLead: false })).toMatchObject({
      reason: "already_on_team",
    });
  });

  it("anyone on a team may leave it", () => {
    expect(decideLeaveTeam(member, { isLead: true })).toEqual({ ok: true });
    expect(decideLeaveTeam(member, null)).toMatchObject({
      reason: "not_on_team",
    });
  });

  it("adding: managers only, current camp members only, no duplicates", () => {
    const base = {
      team: open,
      targetIsCampMember: true,
      targetSeat: null,
    };
    expect(
      decideAddTeamMember({ ...base, viewer: member, viewerSeat: null }),
    ).toMatchObject({ reason: "not_manager" });
    expect(
      decideAddTeamMember({
        ...base,
        viewer: member,
        viewerSeat: { isLead: true },
      }),
    ).toEqual({ ok: true });
    expect(
      decideAddTeamMember({
        ...base,
        viewer: campLead,
        viewerSeat: null,
        targetIsCampMember: false,
      }),
    ).toMatchObject({ reason: "target_not_member" });
    expect(
      decideAddTeamMember({
        ...base,
        viewer: campLead,
        viewerSeat: null,
        targetSeat: { isLead: false },
      }),
    ).toMatchObject({ reason: "already_on_team" });
  });

  it("an archived team: team leads lose their rights, camp leads keep theirs", () => {
    // Spec, Archived teams. A team lead (seated, isLead) is refused every
    // management write; a camp lead and a co-lead may still add, remove and
    // appoint leads.
    const teamLead = { viewer: member, viewerSeat: { isLead: true } };
    for (const lead of [campLead, coLead]) {
      expect(
        decideAddTeamMember({
          viewer: lead,
          viewerSeat: null,
          team: archived,
          targetIsCampMember: true,
          targetSeat: null,
        }),
      ).toEqual({ ok: true });
      expect(
        decideRemoveTeamMember({
          viewer: lead,
          viewerSeat: null,
          team: archived,
          targetSeat: { isLead: false },
        }),
      ).toEqual({ ok: true });
      expect(
        decideSetTeamLead({
          viewer: lead,
          viewerSeat: null,
          team: archived,
          targetSeat: { isLead: false },
        }),
      ).toEqual({ ok: true });
    }
    expect(
      decideAddTeamMember({
        ...teamLead,
        team: archived,
        targetIsCampMember: true,
        targetSeat: null,
      }),
    ).toMatchObject({ reason: "archived" });
    expect(
      decideRemoveTeamMember({
        ...teamLead,
        team: archived,
        targetSeat: { isLead: false },
      }),
    ).toMatchObject({ reason: "archived" });
    expect(
      decideSetTeamLead({
        ...teamLead,
        team: archived,
        targetSeat: { isLead: false },
      }),
    ).toMatchObject({ reason: "archived" });
    // The same team lead on a live team may do all three.
    expect(
      decideSetTeamLead({
        ...teamLead,
        team: open,
        targetSeat: { isLead: false },
      }),
    ).toEqual({ ok: true });
  });

  it("removing and appointing leads: managers only, the person must be on it", () => {
    expect(
      decideRemoveTeamMember({
        viewer: member,
        team: open,
        viewerSeat: { isLead: false },
        targetSeat: { isLead: false },
      }),
    ).toMatchObject({ reason: "not_manager" });
    expect(
      decideRemoveTeamMember({
        viewer: campLead,
        team: open,
        viewerSeat: null,
        targetSeat: null,
      }),
    ).toMatchObject({ reason: "not_on_team" });
    expect(
      decideSetTeamLead({
        viewer: member,
        team: open,
        viewerSeat: { isLead: true },
        targetSeat: { isLead: false },
      }),
    ).toEqual({ ok: true });
    expect(
      decideSetTeamLead({
        viewer: member,
        team: open,
        viewerSeat: { isLead: false },
        targetSeat: { isLead: false },
      }),
    ).toMatchObject({ reason: "not_manager" });
  });

  it("every refusal has a sentence", () => {
    for (const r of [
      "not_member",
      "not_manager",
      "archived",
      "leads_add",
      "already_on_team",
      "not_on_team",
      "target_not_member",
    ] as const) {
      expect(teamRefusalMessage(r)).toMatch(/\.$/);
    }
  });
});

describe("the team chat — the direct-message law, extended", () => {
  const onTeam: TeamChatAccess = {
    viewerUserId: ALICE,
    participantUserIds: [ALICE, REN],
    viewerOnTeam: true,
  };

  it("a current team member who is a participant reads it", () => {
    expect(canReadTeamChat(onTeam)).toBe(true);
  });

  it("a camp lead NOT on the team is refused like a stranger", () => {
    // No role reaches this predicate: the camp lead is only a user id that is
    // neither a participant nor on the team.
    expect(
      canReadTeamChat({
        viewerUserId: JABU,
        participantUserIds: [ALICE, REN],
        viewerOnTeam: false,
      }),
    ).toBe(false);
    expect(
      canSetTeamChatTimer(
        {
          viewerUserId: JABU,
          participantUserIds: [ALICE, REN],
          viewerOnTeam: false,
        },
        campLead,
        open,
        null,
      ),
    ).toBe(false);
  });

  it("a stale participant row alone opens nothing (left the team)", () => {
    expect(canReadTeamChat({ ...onTeam, viewerOnTeam: false })).toBe(false);
  });

  it("a team row without a participant row opens nothing either", () => {
    expect(canReadTeamChat({ ...onTeam, participantUserIds: [REN] })).toBe(
      false,
    );
  });

  it("an archived team's chat is read-only", () => {
    expect(canSendTeamMessage(onTeam, open)).toBe(true);
    expect(canSendTeamMessage(onTeam, archived)).toBe(false);
    expect(canReadTeamChat(onTeam)).toBe(true);
  });

  it("the timer: team leads and camp leads on the team; not plain members", () => {
    expect(canSetTeamChatTimer(onTeam, member, open, { isLead: false })).toBe(
      false,
    );
    expect(canSetTeamChatTimer(onTeam, member, open, { isLead: true })).toBe(
      true,
    );
    expect(
      canSetTeamChatTimer(
        { ...onTeam, viewerUserId: JABU, participantUserIds: [JABU, REN] },
        campLead,
        open,
        { isLead: false },
      ),
    ).toBe(true);
    expect(
      canSetTeamChatTimer(onTeam, member, archived, { isLead: true }),
    ).toBe(false);
  });
});

describe("history cut and block hiding", () => {
  const joinedAt = new Date("2027-04-20T10:00:00Z");
  const viewer = { userId: ALICE, joinedAt };
  const before = { senderId: REN, createdAt: new Date("2027-04-20T09:59:59Z") };
  const at = { senderId: REN, createdAt: joinedAt };
  const after = { senderId: REN, createdAt: new Date("2027-04-20T11:00:00Z") };

  it("shows messages from the moment of joining on, never before", () => {
    expect(isTeamMessageVisible(before, viewer, [])).toBe(false);
    expect(isTeamMessageVisible(at, viewer, [])).toBe(true);
    expect(isTeamMessageVisible(after, viewer, [])).toBe(true);
  });

  it("a block in EITHER direction hides the other person's messages", () => {
    expect(
      isTeamMessageVisible(after, viewer, [
        { blockerId: ALICE, blockedId: REN },
      ]),
    ).toBe(false);
    expect(
      isTeamMessageVisible(after, viewer, [
        { blockerId: REN, blockedId: ALICE },
      ]),
    ).toBe(false);
    // An unrelated block hides nothing.
    expect(
      isTeamMessageVisible(after, viewer, [
        { blockerId: JABU, blockedId: REN },
      ]),
    ).toBe(true);
  });

  it("filters a list, keeping order", () => {
    const own = { senderId: ALICE, createdAt: after.createdAt, id: "own" };
    const list = [
      { ...before, id: "b" },
      { ...after, id: "a" },
      own,
      { senderId: JABU, createdAt: after.createdAt, id: "j" },
    ];
    expect(
      visibleTeamMessages(list, viewer, [
        { blockerId: JABU, blockedId: ALICE },
      ]).map((m) => m.id),
    ).toEqual(["a", "own"]);
  });
});

describe("reporting team messages", () => {
  const joinedAt = new Date("2027-04-20T10:00:00Z");
  const access: TeamChatAccess = {
    viewerUserId: ALICE,
    participantUserIds: [ALICE, REN, JABU],
    viewerOnTeam: true,
  };
  const msg = (
    id: string,
    over: Partial<{
      senderId: string;
      createdAt: Date;
      conversationId: string;
    }> = {},
  ) => ({
    id,
    conversationId: "c1",
    senderId: REN,
    createdAt: new Date("2027-04-21T10:00:00Z"),
    ...over,
  });

  it("accepts visible messages of this conversation", () => {
    expect(
      canReportTeamMessages({
        access,
        conversationId: "c1",
        joinedAt,
        blocks: [],
        selected: [msg("m1")],
      }),
    ).toBe(true);
  });

  it("refuses a message from before the reporter joined", () => {
    expect(
      canReportTeamMessages({
        access,
        conversationId: "c1",
        joinedAt,
        blocks: [],
        selected: [
          msg("m1"),
          msg("m0", { createdAt: new Date("2027-04-19T00:00:00Z") }),
        ],
      }),
    ).toBe(false);
  });

  it("refuses a message a block hides, and a foreign one", () => {
    expect(
      canReportTeamMessages({
        access,
        conversationId: "c1",
        joinedAt,
        blocks: [{ blockerId: REN, blockedId: ALICE }],
        selected: [msg("m1")],
      }),
    ).toBe(false);
    expect(
      canReportTeamMessages({
        access,
        conversationId: "c1",
        joinedAt,
        blocks: [],
        selected: [msg("m1", { conversationId: "c2" })],
      }),
    ).toBe(false);
  });

  it("refuses a reporter no longer on the team", () => {
    expect(
      canReportTeamMessages({
        access: { ...access, viewerOnTeam: false },
        conversationId: "c1",
        joinedAt,
        blocks: [],
        selected: [msg("m1")],
      }),
    ).toBe(false);
  });

  it("names the most-reported other sender, earliest on a tie", () => {
    const t = (h: number) => new Date(Date.UTC(2027, 3, 21, h));
    expect(
      reportedTeamSender(ALICE, [
        { senderId: JABU, createdAt: t(9) },
        { senderId: REN, createdAt: t(10) },
        { senderId: REN, createdAt: t(11) },
        { senderId: ALICE, createdAt: t(12) },
      ]),
    ).toBe(REN);
    expect(
      reportedTeamSender(ALICE, [
        { senderId: REN, createdAt: t(10) },
        { senderId: JABU, createdAt: t(9) },
      ]),
    ).toBe(JABU);
    expect(
      reportedTeamSender(ALICE, [{ senderId: ALICE, createdAt: t(9) }]),
    ).toBeNull();
  });
});

describe("copy", () => {
  it("the inbox line says who and how many, never what", () => {
    expect(teamInboxLine({ unread: 2, lastSenderName: "Thandi" })).toBe(
      "2 new messages · last from Thandi",
    );
    expect(teamInboxLine({ unread: 1, lastSenderName: null })).toBe(
      "1 new message",
    );
    expect(teamInboxLine({ unread: 0, lastSenderName: "Pieter" })).toBe(
      "Last message from Pieter",
    );
    expect(teamInboxLine({ unread: 0, lastSenderName: null })).toBe(
      "No messages yet",
    );
  });

  it("the added notice names the team and links to its page", () => {
    expect(
      teamAddedNotification({
        campName: "Mad Hatters",
        campSlug: "mad-hatters",
        teamId: "t1",
        teamName: "Kitchen",
      }),
    ).toEqual({
      kind: "team",
      title: "You were added to Kitchen",
      body: "Mad Hatters",
      link: "/camps/mad-hatters/teams/t1",
    });
  });
});
