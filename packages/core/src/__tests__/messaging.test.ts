import { describe, it, expect } from "vitest";
import { GroupKind } from "@quagga/types";
import {
  CONTACTABILITY_LEVELS,
  type CampmateContext,
  type CampmateMembership,
} from "../campmates";
import type { OrgActor, OrgRoleGrant } from "../org-permissions";
import { NO_DOMAIN_OWNERSHIP } from "../org-domains";
import {
  DEFAULT_MESSAGE_TIMER,
  MESSAGE_TIMERS,
  REPORT_COPY_RETENTION_DAYS,
  REPORT_MAX_MESSAGES,
  canReadConversation,
  canReportMessages,
  canResolveMessageReports,
  canReviewMessageReports,
  canSendMessage,
  canStartConversation,
  directConversationKey,
  dmRateLimitKey,
  isBlockedEitherWay,
  isMessageLive,
  messageExpiresAt,
  messageLooksLikePhoneNumber,
  readMessageTimer,
  reportCopyExpiresAt,
  timerChangeNotice,
  unreadMessagesLine,
  type UserBlock,
} from "../messaging";

// Fixture values come from the real vocabularies (AGENTS.md: a fixture outside
// the enum is inert). Ids are fictional.
const THEME_CAMP = GroupKind.enum.theme_camp;
const ORG = GroupKind.enum.org;
const [NOBODY, CAMP_MATES, ANYONE] = CONTACTABILITY_LEVELS;

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001"; // member, camp A
const REN = "aaaaaaaa-0000-4000-8000-000000000002"; // member, camp A
const JABU = "aaaaaaaa-0000-4000-8000-000000000003"; // LEAD of camp B
const GOD = "aaaaaaaa-0000-4000-8000-000000000004"; // the System manager
const CAMP_A = "11111111-0000-4000-8000-00000000000a";
const CAMP_B = "11111111-0000-4000-8000-00000000000b";
const ORG_GROUP = "11111111-0000-4000-8000-0000000000f0";
const CONVO = "cccccccc-0000-4000-8000-000000000001";
const OTHER_CONVO = "cccccccc-0000-4000-8000-000000000002";

const campA: CampmateMembership = { groupId: CAMP_A, groupKind: THEME_CAMP };
const campB: CampmateMembership = { groupId: CAMP_B, groupKind: THEME_CAMP };
const org: CampmateMembership = { groupId: ORG_GROUP, groupKind: ORG };

function ctx(
  viewer: string,
  viewerMemberships: CampmateMembership[],
  subject: string,
  subjectMemberships: CampmateMembership[],
): CampmateContext {
  return {
    viewerUserId: viewer,
    subjectUserId: subject,
    viewerMemberships,
    subjectMemberships,
  };
}

const NO_BLOCKS: UserBlock[] = [];

describe("canReadConversation — participants only, no role bypass", () => {
  const participants = [ALICE, REN];

  it("admits each participant", () => {
    expect(canReadConversation({ viewerUserId: ALICE, participantUserIds: participants })).toBe(true);
    expect(canReadConversation({ viewerUserId: REN, participantUserIds: participants })).toBe(true);
  });

  it("refuses a non-participant", () => {
    expect(canReadConversation({ viewerUserId: JABU, participantUserIds: participants })).toBe(false);
  });

  it("refuses the System manager (god) — there is no parameter through which a rank could pass", () => {
    // The god account is an ordinary non-participant here. That the predicate
    // takes no actor/rank at all is the point: an org role cannot widen it.
    expect(canReadConversation({ viewerUserId: GOD, participantUserIds: participants })).toBe(false);
    expect(canReadConversation.length).toBe(1);
  });

  it("refuses a camp lead of the participants' own camp who is not in the chat", () => {
    // JABU re-cast as a lead of camp A: still not a participant, still refused.
    expect(canReadConversation({ viewerUserId: JABU, participantUserIds: participants })).toBe(false);
  });

  it("refuses an empty viewer id", () => {
    expect(canReadConversation({ viewerUserId: "", participantUserIds: ["", ALICE] })).toBe(false);
  });
});

describe("canStartConversation", () => {
  const base = {
    subjectConfirmed: true,
    subjectSanitized: false,
    blocks: NO_BLOCKS,
  };

  it("anyone may start a chat with an `anyone` burner", () => {
    expect(
      canStartConversation({ ...base, ctx: ctx(JABU, [campB], ALICE, [campA]), contactable: ANYONE }),
    ).toBe(true);
  });

  it("camp_mates admits a shared theme camp and refuses a lead of another camp", () => {
    expect(
      canStartConversation({ ...base, ctx: ctx(REN, [campA], ALICE, [campA]), contactable: CAMP_MATES }),
    ).toBe(true);
    expect(
      canStartConversation({ ...base, ctx: ctx(JABU, [campB], ALICE, [campA]), contactable: CAMP_MATES }),
    ).toBe(false);
  });

  it("an org membership is not a shared camp — the god is refused at camp_mates", () => {
    expect(
      canStartConversation({ ...base, ctx: ctx(GOD, [org], ALICE, [campA, org]), contactable: CAMP_MATES }),
    ).toBe(false);
  });

  it("nobody (the default) refuses everyone, camp-mates included", () => {
    expect(
      canStartConversation({ ...base, ctx: ctx(REN, [campA], ALICE, [campA]), contactable: NOBODY }),
    ).toBe(false);
    expect(
      canStartConversation({ ...base, ctx: ctx(REN, [campA], ALICE, [campA]), contactable: undefined }),
    ).toBe(false);
  });

  it("a block refuses in BOTH directions, whatever the setting", () => {
    const c = ctx(REN, [campA], ALICE, [campA]);
    expect(
      canStartConversation({ ...base, ctx: c, contactable: ANYONE, blocks: [{ blockerId: ALICE, blockedId: REN }] }),
    ).toBe(false);
    expect(
      canStartConversation({ ...base, ctx: c, contactable: ANYONE, blocks: [{ blockerId: REN, blockedId: ALICE }] }),
    ).toBe(false);
    // Positive control: a block between OTHER people does not refuse.
    expect(
      canStartConversation({ ...base, ctx: c, contactable: ANYONE, blocks: [{ blockerId: JABU, blockedId: ALICE }] }),
    ).toBe(true);
  });

  it("refuses an unconfirmed bio, a sanitized subject, and self", () => {
    const c = ctx(REN, [campA], ALICE, [campA]);
    expect(canStartConversation({ ...base, ctx: c, contactable: ANYONE, subjectConfirmed: false })).toBe(false);
    expect(canStartConversation({ ...base, ctx: c, contactable: ANYONE, subjectSanitized: true })).toBe(false);
    expect(canStartConversation({ ...base, ctx: c, contactable: ANYONE, actorSanitized: true })).toBe(false);
    expect(
      canStartConversation({ ...base, ctx: ctx(ALICE, [campA], ALICE, [campA]), contactable: ANYONE }),
    ).toBe(false);
  });
});

describe("canSendMessage", () => {
  const people = [
    { userId: ALICE, sanitized: false },
    { userId: REN, sanitized: false },
  ];

  it("a participant may send while nothing blocks", () => {
    expect(canSendMessage({ senderUserId: ALICE, participants: people, blocks: NO_BLOCKS })).toBe(true);
  });

  it("a non-participant may not", () => {
    expect(canSendMessage({ senderUserId: JABU, participants: people, blocks: NO_BLOCKS })).toBe(false);
  });

  it("a blocked user may not, and neither may the blocker", () => {
    const blocks = [{ blockerId: ALICE, blockedId: REN }];
    expect(canSendMessage({ senderUserId: REN, participants: people, blocks })).toBe(false);
    expect(canSendMessage({ senderUserId: ALICE, participants: people, blocks })).toBe(false);
  });

  it("nobody may send into a chat with a deleted account", () => {
    expect(
      canSendMessage({
        senderUserId: ALICE,
        participants: [people[0]!, { userId: REN, sanitized: true }],
        blocks: NO_BLOCKS,
      }),
    ).toBe(false);
  });
});

describe("canReportMessages — only messages from the reporter's own conversation", () => {
  const participants = [ALICE, REN];
  const own = [
    { id: "m1", conversationId: CONVO },
    { id: "m2", conversationId: CONVO },
  ];

  it("admits a participant selecting messages of this conversation", () => {
    expect(
      canReportMessages({ reporterUserId: ALICE, conversationId: CONVO, participantUserIds: participants, selected: own }),
    ).toBe(true);
  });

  it("refuses a non-participant, however the ids were obtained", () => {
    expect(
      canReportMessages({ reporterUserId: JABU, conversationId: CONVO, participantUserIds: participants, selected: own }),
    ).toBe(false);
  });

  it("refuses the whole report when ONE message belongs to another conversation", () => {
    expect(
      canReportMessages({
        reporterUserId: ALICE,
        conversationId: CONVO,
        participantUserIds: participants,
        selected: [...own, { id: "m9", conversationId: OTHER_CONVO }],
      }),
    ).toBe(false);
  });

  it("refuses an empty or oversized selection", () => {
    expect(
      canReportMessages({ reporterUserId: ALICE, conversationId: CONVO, participantUserIds: participants, selected: [] }),
    ).toBe(false);
    const many = Array.from({ length: REPORT_MAX_MESSAGES + 1 }, (_, i) => ({
      id: `m${i}`,
      conversationId: CONVO,
    }));
    expect(
      canReportMessages({ reporterUserId: ALICE, conversationId: CONVO, participantUserIds: participants, selected: many }),
    ).toBe(false);
    expect(
      canReportMessages({
        reporterUserId: ALICE,
        conversationId: CONVO,
        participantUserIds: participants,
        selected: many.slice(0, REPORT_MAX_MESSAGES),
      }),
    ).toBe(true);
  });
});

describe("canReviewMessageReports — the safety tier, never a god-only shortcut", () => {
  function role(permissions: OrgRoleGrant["permissions"]): OrgRoleGrant {
    return {
      id: "r1",
      key: "org_staff",
      name: "Org staff",
      kind: "system",
      departmentId: null,
      permissions,
    };
  }
  const actor = (rank: OrgActor["rank"], roles: OrgRoleGrant[]): OrgActor => ({
    rank,
    roles,
    domains: NO_DOMAIN_OWNERSHIP,
  });

  it("admits org staff holding personal information (org-wide)", () => {
    const a = actor("org_staff", [role({ read: true, personal_information: true })]);
    expect(canReviewMessageReports(a)).toBe(true);
    expect(canResolveMessageReports(a)).toBe(false);
    const b = actor("org_staff", [role({ read: true, update: true, personal_information: true })]);
    expect(canResolveMessageReports(b)).toBe(true);
  });

  it("refuses org staff with read only, an engineer (carve-out) and no actor", () => {
    expect(canReviewMessageReports(actor("org_staff", [role({ read: true, update: true })]))).toBe(false);
    expect(
      canReviewMessageReports(actor("engineer", [role({ read: true, personal_information: true })])),
    ).toBe(false);
    expect(canReviewMessageReports(null)).toBe(false);
  });

  it("the System manager passes through the ordinary resolver", () => {
    expect(canReviewMessageReports(actor("god", []))).toBe(true);
  });
});

describe("disappearing messages", () => {
  const sent = new Date("2027-04-26T10:00:00Z");

  it("decodes unknown timers to off, and the default is off", () => {
    expect(DEFAULT_MESSAGE_TIMER).toBe("off");
    expect(readMessageTimer("7d")).toBe("7d");
    expect(readMessageTimer("1y")).toBe("off");
    expect(readMessageTimer(undefined)).toBe("off");
    for (const t of MESSAGE_TIMERS) expect(readMessageTimer(t)).toBe(t);
  });

  it("stores an expiry per message from the timer in force at send time", () => {
    expect(messageExpiresAt("off", sent)).toBeNull();
    expect(messageExpiresAt("24h", sent)?.toISOString()).toBe("2027-04-27T10:00:00.000Z");
    expect(messageExpiresAt("7d", sent)?.toISOString()).toBe("2027-05-03T10:00:00.000Z");
    expect(messageExpiresAt("90d", sent)?.toISOString()).toBe("2027-07-25T10:00:00.000Z");
  });

  it("hides a message at exactly its expiry (exclusive boundary)", () => {
    const expiresAt = messageExpiresAt("24h", sent)!;
    expect(isMessageLive({ expiresAt }, new Date(expiresAt.getTime() - 1))).toBe(true);
    expect(isMessageLive({ expiresAt }, expiresAt)).toBe(false);
    expect(isMessageLive({ expiresAt: null }, new Date("2099-01-01"))).toBe(true);
  });

  it("names the timer in the system notice, and says when it is off", () => {
    expect(timerChangeNotice("7d")).toContain("7 days");
    expect(timerChangeNotice("off")).toMatch(/turned off/);
  });

  it("keeps a report copy for the documented fixed period", () => {
    expect(REPORT_COPY_RETENTION_DAYS).toBe(180);
    expect(reportCopyExpiresAt(sent).toISOString()).toBe("2027-10-23T10:00:00.000Z");
  });
});

describe("helpers", () => {
  it("keys a pair the same way from either side, and refuses self", () => {
    expect(directConversationKey(ALICE, REN)).toBe(directConversationKey(REN, ALICE));
    expect(() => directConversationKey(ALICE, ALICE)).toThrow();
  });

  it("detects blocks in either direction only between the two named people", () => {
    const blocks = [{ blockerId: ALICE, blockedId: REN }];
    expect(isBlockedEitherWay(blocks, ALICE, REN)).toBe(true);
    expect(isBlockedEitherWay(blocks, REN, ALICE)).toBe(true);
    expect(isBlockedEitherWay(blocks, ALICE, JABU)).toBe(false);
  });

  it("hints at South African phone numbers without matching ordinary text", () => {
    expect(messageLooksLikePhoneNumber("call me on 082 123 4567")).toBe(true);
    expect(messageLooksLikePhoneNumber("+27 82 123 4567")).toBe(true);
    expect(messageLooksLikePhoneNumber("meet at 10:00 by the Clan fire, bring 2 chairs")).toBe(false);
  });

  it("previews unread messages by sender and count only", () => {
    expect(unreadMessagesLine(0, "ren")).toBe("");
    expect(unreadMessagesLine(1, "ren")).toBe("1 new message from ren");
    expect(unreadMessagesLine(3, "ren")).toBe("3 new messages from ren");
  });

  it("keys rate limits per account and action", () => {
    expect(dmRateLimitKey("start", ALICE)).toBe(`dm_start:${ALICE}`);
    expect(dmRateLimitKey("send", ALICE)).not.toBe(dmRateLimitKey("start", ALICE));
  });
});
