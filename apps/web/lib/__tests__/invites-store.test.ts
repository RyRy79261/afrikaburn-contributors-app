import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { boundStrings, dbMock } from "@/test/db-mock";

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

const {
  createInvite,
  revokeInvite,
  listInvites,
  getInvitePreview,
  previewAsInviteLike,
  redeemInvite,
} = await import("../invites-store");

const GROUP = "11111111-1111-4111-8111-111111111111";
const EDITION = "eeeeeeee-0000-4000-8000-000000000000";
const USER = "aaaaaaaa-0000-4000-8000-000000000001";
const INVITE_ID = "44444444-4444-4444-4444-444444444444";
const TOKEN = "abcdefghijklmnopqrstuvwx";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Clock is frozen here so a TTL can be asserted exactly, not as a bound. */
const FROZEN_NOW = new Date("2026-08-04T09:00:00.000Z").getTime();

const FUTURE = new Date(FROZEN_NOW + 30 * DAY_MS);
const PAST = new Date(FROZEN_NOW - 60 * 1000);

/** An `invites` row as `select()` returns it. */
function inviteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INVITE_ID,
    groupId: GROUP,
    token: TOKEN,
    kind: "member",
    createdByUserId: "someone",
    expiresAt: FUTURE,
    usedAt: null,
    usedByUserId: null,
    createdAt: new Date("2026-08-01"),
    ...overrides,
  };
}

/** The reads a redemption makes before it opens its transaction. */
function queueRedemption(input: {
  invite?: Record<string, unknown> | null;
  viewerRole?: string | null;
  group?: { name: string; slug: string } | null;
}) {
  dbMock.queue(input.invite === null ? [] : [inviteRow(input.invite)]);
  if (input.invite === null) return;
  dbMock.queue(input.viewerRole ? [{ role: input.viewerRole }] : []);
  dbMock.queue(
    input.group === null
      ? []
      : [input.group ?? { name: "Mad Hatters", slug: "mad-hatters" }],
  );
}

beforeEach(() => {
  dbMock.reset();
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createInvite / revokeInvite / listInvites", () => {
  it("mints a token of the expected grammar against the group", async () => {
    dbMock.queue([inviteRow()]);

    const invite = await createInvite({
      groupId: GROUP,
      createdByUserId: USER,
      kind: "member",
    });

    expect(invite.id).toBe(INVITE_ID);
    const values = dbMock.onlyQuery("insert").arg("values") as {
      token: string;
      groupId: string;
      expiresAt: Date;
    };
    expect(values.groupId).toBe(GROUP);
    // 18 random bytes, base64url — no padding, url-safe alphabet.
    expect(values.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    // EXACT, not `> now`. A one-sided bound passes for a TTL of one second as
    // readily as for thirty days, so it cannot see an off-by-one — and the
    // failure mode here is an invite that expires before the person opens the
    // email. Fake timers make the arithmetic checkable rather than approximate.
    expect(values.expiresAt.getTime() - FROZEN_NOW).toBe(DAY_MS * 30);
  });

  it("honours a custom TTL", async () => {
    dbMock.queue([inviteRow()]);
    await createInvite({
      groupId: GROUP,
      createdByUserId: USER,
      kind: "member",
      ttlDays: 1,
    });

    const { expiresAt } = dbMock.onlyQuery("insert").arg("values") as {
      expiresAt: Date;
    };
    expect(expiresAt.getTime() - FROZEN_NOW).toBe(DAY_MS);
  });

  it("throws rather than returning a half-invite when the insert returns nothing", async () => {
    dbMock.queue([]);
    await expect(
      createInvite({ groupId: GROUP, createdByUserId: USER, kind: "member" }),
    ).rejects.toThrow("Failed to mint invite");
  });

  it("revokeInvite is SCOPED to the group, so a token id from another camp misses", async () => {
    dbMock.queue([]);
    await revokeInvite(INVITE_ID, GROUP);

    const update = dbMock.writesTo(schema.invites)[0]!;
    // Both ids are bound into the WHERE — the group is not decoration.
    const bound = boundStrings(update);
    expect(bound).toContain(INVITE_ID);
    expect(bound).toContain(GROUP);
    // Revoking is stamping it used, so it can never be redeemed.
    expect(update.arg("set")).toMatchObject({ usedAt: expect.any(Date) });
  });

  it("listInvites returns the group's rows, projected", async () => {
    dbMock.queue([inviteRow(), inviteRow({ id: "inv-2", token: "second" })]);

    const invites = await listInvites(GROUP);
    expect(invites.map((i) => i.id)).toEqual([INVITE_ID, "inv-2"]);
    // The projection drops the group and the creator — this feeds the camp's
    // own settings list, not an audit view.
    expect(Object.keys(invites[0]!).sort()).toEqual([
      "createdAt",
      "expiresAt",
      "id",
      "kind",
      "token",
      "usedAt",
    ]);
    expect(boundStrings(dbMock.queries[0]!)).toContain(GROUP);
  });
});

describe("getInvitePreview", () => {
  const previewRow = {
    token: TOKEN,
    kind: "member",
    groupId: GROUP,
    groupName: "Mad Hatters",
    groupSlug: "mad-hatters",
    groupDescription: "Tea, all night.",
    expiresAt: FUTURE,
    usedAt: null,
    usedByUserId: null,
    createdByUserId: USER,
  };

  it("is null for an unknown token, and leaks no camp details for one", async () => {
    dbMock.queue([]);
    expect(await getInvitePreview("no-such-token")).toBeNull();
    // No follow-up query ran, so nothing about any camp was even read.
    expect(dbMock.queries).toHaveLength(1);
  });

  it("resolves the registration badge and the inviter's USERNAME when given an edition", async () => {
    // This card is the most widely-shared surface in the app — the link is
    // meant to be forwarded, so only a public handle is safe to put on it.
    dbMock.queue(
      [previewRow],
      /* an approved registration */ [{ id: "reg-1" }],
      [{ username: "alice", sanitizedAt: null }],
    );

    const preview = await getInvitePreview(TOKEN, EDITION);
    expect(preview).toMatchObject({
      groupName: "Mad Hatters",
      registered: true,
      inviterName: "alice",
    });
    expect(JSON.stringify(preview)).not.toContain("@");
  });

  it("drops the inviter's name when their account has been sanitized or has no handle", async () => {
    dbMock.queue(
      [previewRow],
      [],
      [{ username: "alice", sanitizedAt: new Date() }],
    );
    expect((await getInvitePreview(TOKEN, EDITION))?.inviterName).toBeNull();

    dbMock.reset();
    dbMock.queue([previewRow], [], [{ username: "   ", sanitizedAt: null }]);
    expect((await getInvitePreview(TOKEN, EDITION))?.inviterName).toBeNull();
  });

  it("skips both edition-scoped lookups when no edition is passed", async () => {
    dbMock.queue([previewRow]);

    const preview = await getInvitePreview(TOKEN);
    expect(preview?.registered).toBe(false);
    expect(preview?.inviterName).toBeNull();
    expect(dbMock.queries).toHaveLength(1);
  });

  it("previewAsInviteLike carries the expiry and the claimed flag through", async () => {
    const claimedAt = new Date("2026-08-02");
    dbMock.queue([{ ...previewRow, usedAt: claimedAt, usedByUserId: USER }]);

    const preview = (await getInvitePreview(TOKEN))!;
    expect(previewAsInviteLike(preview)).toEqual({
      kind: "member",
      expiresAt: FUTURE,
      usedAt: claimedAt,
      usedByUserId: USER,
    });
  });
});

describe("redeemInvite — the authorisation boundary for the whole round trip", () => {
  it("REFUSES an unknown token", async () => {
    queueRedemption({ invite: null });

    expect(await redeemInvite("no-such-token", USER)).toEqual({
      ok: false,
      error: "This invite link is not valid.",
    });
    expect(dbMock.transactions).toBe(0);
  });

  it("REFUSES an already-claimed token and an expired one, each with its own message", async () => {
    queueRedemption({
      invite: { usedAt: new Date(), usedByUserId: "someone" },
    });
    expect(await redeemInvite(TOKEN, USER)).toEqual({
      ok: false,
      error:
        "This invite link has already been used. Ask the camp for a fresh one.",
    });

    dbMock.reset();
    queueRedemption({ invite: { expiresAt: PAST } });
    expect(await redeemInvite(TOKEN, USER)).toEqual({
      ok: false,
      error: "This invite link has expired. Ask the camp for a fresh one.",
    });
    expect(dbMock.transactions).toBe(0);
  });

  it("sends an EXISTING member straight in rather than minting a duplicate membership", async () => {
    // A replayed action and a stale page both land here. The answer is the camp
    // they are already in, not an error and not a second membership row.
    queueRedemption({ viewerRole: "member" });

    expect(await redeemInvite(TOKEN, USER)).toEqual({
      ok: true,
      slug: "mad-hatters",
    });
    expect(dbMock.transactions).toBe(0);
    expect(dbMock.writesTo(schema.memberships)).toHaveLength(0);
  });

  it("REFUSES when the camp behind the invite has gone", async () => {
    queueRedemption({ group: null });

    expect(await redeemInvite(TOKEN, USER)).toEqual({
      ok: false,
      error: "Camp not found.",
    });
  });

  it("claims the row and grants the membership as ONE transaction", async () => {
    queueRedemption({});
    dbMock.queue(
      /* the atomic claim … returning */ [{ id: INVITE_ID }],
      /* nextMemberRefCode */ [{ refCode: "MAH-M001" }],
      /* the membership insert */ [],
    );

    expect(await redeemInvite(TOKEN, USER)).toEqual({
      ok: true,
      slug: "mad-hatters",
    });

    const claim = dbMock.writesTo(schema.invites)[0]!;
    expect(claim.tx).toBe(true);
    expect(claim.arg("set")).toMatchObject({ usedByUserId: USER });
    // An invite whose used_at is flipped must always yield the membership it
    // granted.
    expect(dbMock.writesTo(schema.memberships)[0]!.tx).toBe(true);
  });

  it("LOSES THE RACE gracefully: no claim, no membership", async () => {
    // The conditional UPDATE (`used_at IS NULL`) is what makes single-use real;
    // the predicate above it can be passed by two redeemers at once.
    queueRedemption({});
    dbMock.queue(/* nothing claimed */ []);

    expect(await redeemInvite(TOKEN, USER)).toEqual({
      ok: false,
      error:
        "This invite link has already been used. Ask the camp for a fresh one.",
    });
    expect(dbMock.writesTo(schema.memberships)).toHaveLength(0);
  });

  it("a lead_transfer demotes the sitting lead(s) and promotes an EXISTING member", async () => {
    queueRedemption({
      invite: { kind: "lead_transfer" },
      viewerRole: "member",
    });
    dbMock.queue(
      [{ id: INVITE_ID }],
      /* demote the current leads */ [],
      /* promote the redeemer */ [],
    );

    expect(await redeemInvite(TOKEN, USER)).toEqual({
      ok: true,
      slug: "mad-hatters",
    });

    const roleWrites = dbMock
      .writesTo(schema.memberships)
      .map((q) => q.arg("set"));
    // A camp always has exactly one lead: the sitting one drops to admin before
    // the redeemer takes it, and the redeemer keeps their existing ref code.
    expect(roleWrites).toEqual([{ role: "admin" }, { role: "lead" }]);
    expect(
      dbMock.writesTo(schema.memberships).every((q) => q.kind === "update"),
    ).toBe(true);
  });

  it("a lead_transfer to a NON-member mints the membership with a ref code", async () => {
    queueRedemption({ invite: { kind: "lead_transfer" }, viewerRole: null });
    dbMock.queue(
      [{ id: INVITE_ID }],
      /* demote the current leads */ [],
      /* nextMemberRefCode */ [{ refCode: "MAH-M001" }],
      /* the membership insert */ [],
    );

    expect(await redeemInvite(TOKEN, USER)).toEqual({
      ok: true,
      slug: "mad-hatters",
    });

    const insert = dbMock
      .writesTo(schema.memberships)
      .find((q) => q.kind === "insert")!;
    expect(insert.arg("values")).toMatchObject({
      userId: USER,
      groupId: GROUP,
      role: "lead",
      refCode: "MAH-M002",
    });
  });

  it("a lead_transfer is NOT refused for someone already in the camp", async () => {
    // `self_member` only applies to plain `member` invites — refusing a
    // lead_transfer for a member would make transferring the lead to an
    // existing member impossible, which is the normal case.
    queueRedemption({
      invite: { kind: "lead_transfer" },
      viewerRole: "admin",
    });
    dbMock.queue([{ id: INVITE_ID }], [], []);

    expect(await redeemInvite(TOKEN, USER)).toMatchObject({ ok: true });
  });

  it("REFUSES a self_member redemption when the camp row has vanished", async () => {
    dbMock.queue(
      [inviteRow()],
      /* already a member */ [{ role: "member" }],
      /* …but the group is gone */ [],
    );

    expect(await redeemInvite(TOKEN, USER)).toEqual({
      ok: false,
      error: "Camp not found.",
    });
  });
});
