import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { GroupKind } from "@quagga/types";
import { CONTACTABILITY_LEVELS, MESSAGE_TIMERS } from "@quagga/core";
import { boundStrings, dbMock } from "@/test/db-mock";

// Direct messaging store (epic #69). Asserts DECISIONS — who is refused before
// which table is touched, what is written — not SQL (see db-mock's header).
//
// Fixture values come from the real vocabularies: a contactable level or a
// timer outside its enum would make the gate under test inert.

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

const stubs = vi.hoisted(() => ({
  memberships: new Map<string, { groupId: string; groupKind: string }[]>(),
  rateLimit: { allowed: true, retryAfterSeconds: 0 },
}));

vi.mock("@quagga/db", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@quagga/db");
  return { ...actual, consumeRateLimit: async () => stubs.rateLimit };
});

vi.mock("../campmates-store", () => ({
  loadCampmateMemberships: async (ids: string[]) => {
    const out = new Map<string, unknown[]>();
    for (const id of ids) out.set(id, stubs.memberships.get(id) ?? []);
    return out;
  },
  resolveAvatarForViewer: async () => null,
}));

const store = await import("../messages-store");

const [NOBODY, CAMP_MATES, ANYONE] = CONTACTABILITY_LEVELS;
const [OFF, , SEVEN_DAYS] = MESSAGE_TIMERS;
const THEME_CAMP = GroupKind.enum.theme_camp;

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const REN = "aaaaaaaa-0000-4000-8000-000000000002";
const JABU = "aaaaaaaa-0000-4000-8000-000000000003"; // outsider / god / lead
const EDITION = "eeeeeeee-0000-4000-8000-000000000000";
const CONVO = "cccccccc-0000-4000-8000-000000000001";
const OTHER_CONVO = "cccccccc-0000-4000-8000-000000000002";
const CAMP_A = "11111111-0000-4000-8000-00000000000a";
const NOW = new Date("2027-04-27T12:00:00Z");

function participant(userId: string, over: Record<string, unknown> = {}) {
  return {
    userId,
    username: userId === ALICE ? "alice_hatter" : "ren_notfound",
    sanitizedAt: null,
    lastReadAt: null,
    hiddenAt: null,
    ...over,
  };
}
const PAIR = [participant(ALICE), participant(REN)];

function message(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    conversationId: CONVO,
    senderId: REN,
    kind: "text",
    body: `body of ${id}`,
    createdAt: new Date("2027-04-27T10:00:00Z"),
    expiresAt: null,
    ...over,
  };
}

beforeEach(() => {
  dbMock.reset();
  stubs.memberships = new Map();
  stubs.rateLimit = { allowed: true, retryAfterSeconds: 0 };
  process.env.DATABASE_URL = "postgres://test";
});

afterEach(() => {
  delete process.env.DATABASE_URL;
});

describe("getConversation — participants only", () => {
  it("refuses a non-participant BEFORE `messages` is touched", async () => {
    dbMock.queue(PAIR);
    const view = await store.getConversation({
      viewerUserId: JABU,
      conversationId: CONVO,
      editionId: EDITION,
      now: NOW,
    });
    expect(view).toBeNull();
    expect(dbMock.queriesTouching(schema.messages)).toHaveLength(0);
    // Nor did it mark anything read for them.
    expect(dbMock.writesTo(schema.conversationParticipants)).toHaveLength(0);
  });

  it("refuses an id with no participants the same way (no existence leak)", async () => {
    dbMock.queue([]);
    expect(
      await store.getConversation({
        viewerUserId: ALICE,
        conversationId: CONVO,
        editionId: EDITION,
      }),
    ).toBeNull();
    expect(dbMock.queriesTouching(schema.messages)).toHaveLength(0);
  });

  it("serves a participant, filters expiry, and marks it read", async () => {
    dbMock.queue(
      PAIR,
      /* conversation */ [{ timer: SEVEN_DAYS }],
      /* messages */ [message("m1"), message("m2", { senderId: ALICE })],
      /* blocks */ [],
    );
    const view = await store.getConversation({
      viewerUserId: ALICE,
      conversationId: CONVO,
      editionId: EDITION,
      now: NOW,
    });
    expect(view).not.toBeNull();
    expect(view!.timer).toBe(SEVEN_DAYS);
    expect(view!.other).toMatchObject({ userId: REN, name: "ren_notfound" });
    expect(view!.messages.map((m) => [m.id, m.mine])).toEqual([
      ["m1", false],
      ["m2", true],
    ]);
    expect(view!.canSend).toBe(true);
    expect(view!.blockedByViewer).toBe(false);
    // The read path binds `now` into the expiry filter.
    const read = dbMock.queriesTouching(schema.messages)[0]!;
    expect(read.calls.some((c) => c.method === "where")).toBe(true);
    expect(dbMock.writesTo(schema.conversationParticipants)).toHaveLength(1);
  });

  it("reports a block by the viewer and refuses sending", async () => {
    dbMock.queue(
      PAIR,
      [{ timer: OFF }],
      [],
      [{ blockerId: ALICE, blockedId: REN }],
    );
    const view = await store.getConversation({
      viewerUserId: ALICE,
      conversationId: CONVO,
      editionId: EDITION,
    });
    expect(view!.blockedByViewer).toBe(true);
    expect(view!.canSend).toBe(false);
  });
});

describe("startConversation", () => {
  /** No existing chat; then the facts `viewerMayStartConversation` loads. */
  function queueStart(contactable: string, blocks: unknown[] = []) {
    dbMock.queue(
      /* findDirectConversation */ [],
      /* users */ [
        { id: REN, sanitizedAt: null },
        { id: ALICE, sanitizedAt: null },
      ],
      /* bio */ [{ contactable, completedAt: new Date("2027-01-01") }],
      /* blocks */ blocks,
    );
  }

  it("refuses a target who is not contactable — nothing is created", async () => {
    queueStart(NOBODY);
    const result = await store.startConversation({
      viewerUserId: REN,
      targetUserId: ALICE,
      editionId: EDITION,
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.conversations)).toHaveLength(0);
  });

  it("refuses camp_mates without a shared theme camp, admits it with one", async () => {
    queueStart(CAMP_MATES);
    expect(
      (
        await store.startConversation({
          viewerUserId: REN,
          targetUserId: ALICE,
          editionId: EDITION,
        })
      ).ok,
    ).toBe(false);

    dbMock.reset();
    stubs.memberships.set(REN, [{ groupId: CAMP_A, groupKind: THEME_CAMP }]);
    stubs.memberships.set(ALICE, [{ groupId: CAMP_A, groupKind: THEME_CAMP }]);
    queueStart(CAMP_MATES);
    dbMock.queue(
      /* starter default timer */ [{ defaultMessageTimer: SEVEN_DAYS }],
      /* insert conversation */ [{ id: CONVO }],
      /* insert participants */ [],
    );
    const ok = await store.startConversation({
      viewerUserId: REN,
      targetUserId: ALICE,
      editionId: EDITION,
    });
    expect(ok).toEqual({ ok: true, conversationId: CONVO });
    const insert = dbMock.writesTo(schema.conversations)[0]!;
    // The starter's personal default timer is applied to the new chat.
    expect(insert.arg("values")).toMatchObject({ timer: SEVEN_DAYS });
    expect(dbMock.writesTo(schema.conversationParticipants)).toHaveLength(1);
  });

  it("refuses when EITHER side has blocked the other, even at `anyone`", async () => {
    queueStart(ANYONE, [{ blockerId: ALICE, blockedId: REN }]);
    expect(
      (
        await store.startConversation({
          viewerUserId: REN,
          targetUserId: ALICE,
          editionId: EDITION,
        })
      ).ok,
    ).toBe(false);
    expect(dbMock.writesTo(schema.conversations)).toHaveLength(0);
  });

  it("refuses when the start rate limit is spent", async () => {
    queueStart(ANYONE);
    stubs.rateLimit = { allowed: false, retryAfterSeconds: 60 };
    const result = await store.startConversation({
      viewerUserId: REN,
      targetUserId: ALICE,
      editionId: EDITION,
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.conversations)).toHaveLength(0);
  });

  it("reopens an existing chat for a participant without re-asking contactability", async () => {
    dbMock.queue([{ id: CONVO }], PAIR, []);
    const result = await store.startConversation({
      viewerUserId: ALICE,
      targetUserId: REN,
      editionId: EDITION,
    });
    expect(result).toEqual({ ok: true, conversationId: CONVO });
    expect(dbMock.writesTo(schema.conversations)).toHaveLength(0);
    // Un-hidden for the viewer only.
    const unhide = dbMock.writesTo(schema.conversationParticipants)[0]!;
    expect(unhide.arg("set")).toEqual({ hiddenAt: null });
    expect(boundStrings(unhide)).toContain(ALICE);
  });

  it("refuses self outright", async () => {
    expect(
      (
        await store.startConversation({
          viewerUserId: ALICE,
          targetUserId: ALICE,
          editionId: EDITION,
        })
      ).ok,
    ).toBe(false);
    expect(dbMock.queries).toHaveLength(0);
  });
});

describe("sendMessage", () => {
  it("stores the expiry from the timer in force at send time, and hints at a phone number", async () => {
    dbMock.queue(PAIR, /* blocks */ [], /* timer */ [{ timer: SEVEN_DAYS }]);
    const result = await store.sendMessage({
      viewerUserId: ALICE,
      conversationId: CONVO,
      body: "my number is 082 123 4567",
      now: NOW,
    });
    expect(result).toEqual({ ok: true, phoneHint: true });
    const insert = dbMock.writesTo(schema.messages)[0]!;
    expect(insert.tx).toBe(true);
    expect(insert.arg("values")).toMatchObject({
      senderId: ALICE,
      kind: "text",
      expiresAt: new Date("2027-05-04T12:00:00Z"),
    });
  });

  it("refuses a non-participant before anything is written", async () => {
    dbMock.queue(PAIR);
    const result = await store.sendMessage({
      viewerUserId: JABU,
      conversationId: CONVO,
      body: "hello",
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.messages)).toHaveLength(0);
  });

  it("refuses a blocked user", async () => {
    dbMock.queue(PAIR, [{ blockerId: ALICE, blockedId: REN }]);
    const result = await store.sendMessage({
      viewerUserId: REN,
      conversationId: CONVO,
      body: "hello",
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.messages)).toHaveLength(0);
  });

  it("refuses an empty or oversized body without querying", async () => {
    expect(
      (
        await store.sendMessage({
          viewerUserId: ALICE,
          conversationId: CONVO,
          body: "   ",
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await store.sendMessage({
          viewerUserId: ALICE,
          conversationId: CONVO,
          body: "x".repeat(2_001),
        })
      ).ok,
    ).toBe(false);
    expect(dbMock.queries).toHaveLength(0);
  });

  it("refuses when the send rate limit is spent", async () => {
    dbMock.queue(PAIR, []);
    stubs.rateLimit = { allowed: false, retryAfterSeconds: 10 };
    expect(
      (
        await store.sendMessage({
          viewerUserId: ALICE,
          conversationId: CONVO,
          body: "hi",
        })
      ).ok,
    ).toBe(false);
    expect(dbMock.writesTo(schema.messages)).toHaveLength(0);
  });
});

describe("setConversationTimer", () => {
  it("updates the timer and posts a system message into the chat", async () => {
    dbMock.queue(PAIR, []);
    const result = await store.setConversationTimer({
      viewerUserId: REN,
      conversationId: CONVO,
      timer: SEVEN_DAYS,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(dbMock.writesTo(schema.conversations)[0]!.arg("set")).toMatchObject({
      timer: SEVEN_DAYS,
    });
    const notice = dbMock.writesTo(schema.messages)[0]!.arg("values") as Record<
      string,
      unknown
    >;
    expect(notice).toMatchObject({ kind: "system", senderId: REN });
    expect(String(notice.body)).toContain("7 days");
    expect(dbMock.transactions).toBe(1);
  });

  it("refuses a non-participant", async () => {
    dbMock.queue(PAIR);
    expect(
      (
        await store.setConversationTimer({
          viewerUserId: JABU,
          conversationId: CONVO,
          timer: OFF,
        })
      ).ok,
    ).toBe(false);
    expect(dbMock.writesTo(schema.conversations)).toHaveLength(0);
  });
});

describe("reportMessages — copies only selected messages of the reporter's own chat", () => {
  it("copies the selected messages into a report with a 180-day expiry", async () => {
    dbMock.queue(
      PAIR,
      [message("m1"), message("m2")],
      [{ id: "report-1" }],
      [],
    );
    const result = await store.reportMessages({
      viewerUserId: ALICE,
      conversationId: CONVO,
      messageIds: ["m1", "m2"],
      reason: "  harassment ",
      now: NOW,
    });
    expect(result).toEqual({ ok: true, reportId: "report-1" });
    const report = dbMock
      .writesTo(schema.messageReports)[0]!
      .arg("values") as Record<string, unknown>;
    expect(report).toMatchObject({
      reporterId: ALICE,
      reportedUserId: REN,
      reason: "harassment",
      expiresAt: new Date("2027-10-24T12:00:00Z"),
    });
    const items = dbMock
      .writesTo(schema.messageReportItems)[0]!
      .arg("values") as { originalMessageId: string; body: string }[];
    expect(items.map((i) => i.originalMessageId)).toEqual(["m1", "m2"]);
    expect(items[0]!.body).toBe("body of m1");
  });

  it("refuses the WHOLE report when one message belongs to another conversation", async () => {
    dbMock.queue(PAIR, [
      message("m1"),
      message("m9", { conversationId: OTHER_CONVO }),
    ]);
    const result = await store.reportMessages({
      viewerUserId: ALICE,
      conversationId: CONVO,
      messageIds: ["m1", "m9"],
      reason: null,
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.messageReports)).toHaveLength(0);
  });

  it("refuses an id that no longer exists (expired or unknown)", async () => {
    dbMock.queue(PAIR, [message("m1")]);
    expect(
      (
        await store.reportMessages({
          viewerUserId: ALICE,
          conversationId: CONVO,
          messageIds: ["m1", "gone"],
          reason: null,
        })
      ).ok,
    ).toBe(false);
    expect(dbMock.writesTo(schema.messageReports)).toHaveLength(0);
  });

  it("refuses a non-participant BEFORE any message is read", async () => {
    dbMock.queue(PAIR);
    const result = await store.reportMessages({
      viewerUserId: JABU,
      conversationId: CONVO,
      messageIds: ["m1"],
      reason: null,
    });
    expect(result.ok).toBe(false);
    expect(dbMock.queriesTouching(schema.messages)).toHaveLength(0);
  });

  it("refuses an empty selection", async () => {
    dbMock.queue(PAIR);
    expect(
      (
        await store.reportMessages({
          viewerUserId: ALICE,
          conversationId: CONVO,
          messageIds: [],
          reason: null,
        })
      ).ok,
    ).toBe(false);
  });
});

describe("blocks", () => {
  it("blocks immediately and hides the shared conversation for the blocker only", async () => {
    dbMock.queue([{ id: REN }], [{ id: CONVO }]);
    expect(
      await store.blockUser({ viewerUserId: ALICE, targetUserId: REN }),
    ).toEqual({ ok: true });
    expect(dbMock.writesTo(schema.userBlocks)[0]!.arg("values")).toEqual({
      blockerId: ALICE,
      blockedId: REN,
    });
    const hide = dbMock.writesTo(schema.conversationParticipants)[0]!;
    expect(hide.arg("set")).toHaveProperty("hiddenAt");
    expect(boundStrings(hide)).toContain(ALICE);
    expect(boundStrings(hide)).not.toContain(REN);
  });

  it("refuses to block yourself or an unknown account", async () => {
    expect(
      (await store.blockUser({ viewerUserId: ALICE, targetUserId: ALICE })).ok,
    ).toBe(false);
    dbMock.queue([]);
    expect(
      (await store.blockUser({ viewerUserId: ALICE, targetUserId: REN })).ok,
    ).toBe(false);
    expect(dbMock.writesTo(schema.userBlocks)).toHaveLength(0);
  });

  it("unblocks only the viewer's own block", async () => {
    await store.unblockUser({ viewerUserId: ALICE, targetUserId: REN });
    const del = dbMock.writesTo(schema.userBlocks)[0]!;
    expect(del.kind).toBe("delete");
    expect(boundStrings(del)).toEqual(expect.arrayContaining([ALICE, REN]));
  });

  it("answers whether the viewer has blocked someone", async () => {
    dbMock.queue([{ blockerId: ALICE }]);
    expect(await store.viewerHasBlocked(ALICE, REN)).toBe(true);
    expect(await store.viewerHasBlocked(ALICE, REN)).toBe(false);
  });
});

describe("inbox and unread counts carry no message body", () => {
  it("lists conversations by sender and unread count only", async () => {
    dbMock.queue(
      [
        {
          conversationId: CONVO,
          lastReadAt: null,
          lastMessageAt: NOW,
          createdAt: NOW,
        },
      ],
      [
        {
          conversationId: CONVO,
          userId: REN,
          username: "ren_notfound",
          sanitizedAt: null,
        },
      ],
      [{ conversationId: CONVO, count: 3 }],
    );
    const inbox = await store.listInbox({
      viewerUserId: ALICE,
      editionId: EDITION,
    });
    expect(inbox).toEqual([
      {
        conversationId: CONVO,
        otherUserId: REN,
        otherName: "ren_notfound",
        showAvatar: false,
        unread: 3,
        lastMessageAt: NOW,
      },
    ]);
    // No select anywhere asked for a message body.
    for (const q of dbMock.queriesOfKind("select")) {
      expect(Object.keys((q.arg("select") as object) ?? {})).not.toContain(
        "body",
      );
    }
  });

  it("returns an empty inbox without further queries", async () => {
    dbMock.queue([]);
    expect(
      await store.listInbox({ viewerUserId: ALICE, editionId: EDITION }),
    ).toEqual([]);
    expect(dbMock.queries).toHaveLength(1);
  });

  it("totals unread across conversations and degrades to 0 on failure", async () => {
    dbMock.queue([
      { conversationId: CONVO, count: 2 },
      { conversationId: OTHER_CONVO, count: 1 },
    ]);
    expect(await store.getUnreadMessageCount(ALICE)).toBe(3);
    dbMock.queue(new Error("down"));
    expect(await store.getUnreadMessageCount(ALICE)).toBe(0);
  });
});

describe("default timer and the sweep", () => {
  it("saves and reads the personal default, failing closed to off", async () => {
    await store.saveDefaultMessageTimer(ALICE, SEVEN_DAYS);
    expect(dbMock.writesTo(schema.users)[0]!.arg("set")).toEqual({
      defaultMessageTimer: SEVEN_DAYS,
    });
    dbMock.queue([{ timer: "bogus" }]);
    expect(await store.getDefaultMessageTimer(ALICE)).toBe(OFF);
  });

  it("hard-deletes expired messages and expired reports", async () => {
    dbMock.queue([{ id: "m1" }, { id: "m2" }], [{ id: "r1" }]);
    expect(await store.sweepExpiredMessages(NOW)).toEqual({
      messagesDeleted: 2,
      reportsDeleted: 1,
    });
    expect(dbMock.writesTo(schema.messages)[0]!.kind).toBe("delete");
    expect(dbMock.writesTo(schema.messageReports)[0]!.kind).toBe("delete");
  });

  it("refuses every write env-less, without a query", async () => {
    delete process.env.DATABASE_URL;
    const refusals = await Promise.all([
      store.startConversation({
        viewerUserId: ALICE,
        targetUserId: REN,
        editionId: EDITION,
      }),
      store.sendMessage({
        viewerUserId: ALICE,
        conversationId: CONVO,
        body: "hi",
      }),
      store.setConversationTimer({
        viewerUserId: ALICE,
        conversationId: CONVO,
        timer: OFF,
      }),
      store.blockUser({ viewerUserId: ALICE, targetUserId: REN }),
      store.unblockUser({ viewerUserId: ALICE, targetUserId: REN }),
      store.reportMessages({
        viewerUserId: ALICE,
        conversationId: CONVO,
        messageIds: ["m1"],
        reason: null,
      }),
    ]);
    for (const r of refusals) expect(r.ok).toBe(false);
    expect(
      await store.getConversation({
        viewerUserId: ALICE,
        conversationId: CONVO,
        editionId: EDITION,
      }),
    ).toBeNull();
    expect(
      await store.viewerMayStartConversation({
        viewerUserId: ALICE,
        targetUserId: REN,
        editionId: EDITION,
      }),
    ).toBe(false);
    expect(await store.findDirectConversation(ALICE, REN)).toBeNull();
    expect(await store.viewerHasBlocked(ALICE, REN)).toBe(false);
    expect(await store.getDefaultMessageTimer(ALICE)).toBe(OFF);
    await store.saveDefaultMessageTimer(ALICE, SEVEN_DAYS);
    expect(dbMock.queries).toHaveLength(0);
  });

  it("nobody may post into a chat with a deleted account, and it shows as departed", async () => {
    dbMock.queue(
      [
        participant(ALICE),
        participant(REN, { sanitizedAt: new Date("2027-01-01") }),
      ],
      [{ timer: OFF }],
      [],
      [],
    );
    const view = await store.getConversation({
      viewerUserId: ALICE,
      conversationId: CONVO,
      editionId: EDITION,
    });
    expect(view!.other.departed).toBe(true);
    expect(view!.other.name).not.toBe("ren_notfound");
    expect(view!.canSend).toBe(false);
  });

  it("does nothing env-less", async () => {
    delete process.env.DATABASE_URL;
    expect(await store.sweepExpiredMessages(NOW)).toEqual({
      messagesDeleted: 0,
      reportsDeleted: 0,
    });
    expect(await store.getUnreadMessageCount(ALICE)).toBe(0);
    expect(
      await store.listInbox({ viewerUserId: ALICE, editionId: EDITION }),
    ).toEqual([]);
    expect(dbMock.queries).toHaveLength(0);
  });
});
