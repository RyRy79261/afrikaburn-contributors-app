import { describe, it, expect, beforeEach, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { schema } from "@quagga/db";
import { ANNOUNCEMENT_MESSAGES } from "@quagga/core";
import { dbMock, type RecordedQuery } from "@/test/db-mock";
import type { SenderContext } from "@/lib/announcements-store";

// CAMP ANNOUNCEMENTS — the store's write paths (epic #56), ported from Camp
// 404's announcement-drafts / team-announcements / announcement-pins /
// broadcast-dispatch behaviour tests.
//
// WHAT THIS PROVES. The DECISIONS (a demoted sender is refused inside the
// transaction and nothing is claimed or delivered; a lost claim delivers
// nothing; a scheduled publish delivers nothing yet) and the CLAIM PREDICATES,
// rendered to real SQL by drizzle's own Postgres dialect — so "the draft write
// is keyed on its author" and "the pin is a compare-and-set on pinned_at" are
// asserted against the statement text, not a mock's say-so.
//
// WHAT IT CANNOT. Whether Postgres honours those statements under concurrency
// (the row locks, ON CONFLICT against the partial unique index). That is the
// camp-announcements persona spec's job, against a real database.

vi.mock("@/lib/db", async () =>
  (await import("@/test/db-mock")).dbModuleMock(),
);
const roles = vi.hoisted(() => ({
  membership: null as unknown,
  baselineRoleId: null as string | null,
  list: [] as { id: string }[],
  calls: [] as string[],
}));
vi.mock("@/lib/roles-store", () => ({
  getMemberPermissions: async () => {
    roles.calls.push("getMemberPermissions");
    return roles.membership;
  },
  getBaselineRoleId: async () => {
    roles.calls.push("getBaselineRoleId");
    return roles.baselineRoleId;
  },
  listRoles: async () => {
    roles.calls.push("listRoles");
    return roles.list;
  },
}));
const mail = vi.hoisted(() => ({ sent: [] as unknown[] }));
vi.mock("@/lib/email", () => ({
  sendEmail: async (input: unknown) => {
    mail.sent.push(input);
    return { ok: true, id: null, delivered: false };
  },
}));

const store = await import("@/lib/announcements-store");
const gate = await import("@/lib/announcement-gate");

const dialect = new PgDialect();
/** The SQL text + params of the condition a chain passed to `.where()`. */
function whereOf(q: RecordedQuery): { sql: string; params: unknown[] } {
  const cond = q.arg("where") as SQL | undefined;
  if (!cond) throw new Error("no where() on this chain");
  return dialect.sqlToQuery(cond);
}

const CAMP = "11111111-1111-4111-8111-111111111111";
const EDITION = "e0000000-0000-4000-8000-000000000001";
const AUTHOR = "a0000000-0000-4000-8000-000000000001";
const COOK = "a0000000-0000-4000-8000-000000000002";
const BUILDER = "a0000000-0000-4000-8000-000000000003";
const DRAFT = "d0000000-0000-4000-8000-000000000001";
const BASELINE = "b0000000-0000-4000-8000-000000000000";
const KITCHEN = "c0000000-0000-4000-8000-000000000001";
const POSTER_ROLE = "c0000000-0000-4000-8000-000000000009";

const KITCHEN_AUDIENCE = {
  kind: "project" as const,
  groupId: CAMP,
  mode: "roles" as const,
  roleIds: [KITCHEN],
};

/** The camp's roles as the locked read returns them. `posterGrants` controls
 * whether POSTER_ROLE still grants post_announcements (the demotion lever). */
function campRoles(posterGrants: boolean) {
  return [
    { id: BASELINE, kind: "baseline", permissions: {} },
    { id: KITCHEN, kind: "custom", permissions: {} },
    {
      id: POSTER_ROLE,
      kind: "custom",
      permissions: posterGrants
        ? {
            post_announcements: {
              audienceRoles: [KITCHEN],
              mayRequireAck: true,
            },
          }
        : {},
    },
  ];
}

/** Queue the three locked reads `lockSenderContext` makes. */
function queueSender(opts: { posterGrants: boolean }) {
  dbMock.queue(
    [{ id: "m-author", role: "member" }],
    campRoles(opts.posterGrants),
    [{ projectRoleId: POSTER_ROLE }],
  );
}

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DRAFT,
    title: "Kitchen shift change",
    bodyMd: "Breakfast crew now starts at 7.",
    audience: KITCHEN_AUDIENCE,
    presentation: "feed",
    meetingUrl: null,
    pinOnPublish: false,
    pinnedAt: null,
    sendAt: null,
    publishedAt: null,
    dispatchedAt: null,
    createdAt: new Date("2027-03-01T08:00:00Z"),
    updatedAt: new Date("2027-03-01T08:00:00Z"),
    createdByUserId: AUTHOR,
    editionId: EDITION,
    ...overrides,
  };
}

/** Queue the fan-out's reads: camp name, memberships, assignments, roles. */
function queueFanOutReads() {
  dbMock.queue(
    [{ name: "Mad Hatters" }],
    [
      {
        membershipId: "m-author",
        userId: AUTHOR,
        groupId: CAMP,
        role: "member",
        sanitizedAt: null,
      },
      {
        membershipId: "m-cook",
        userId: COOK,
        groupId: CAMP,
        role: "member",
        sanitizedAt: null,
      },
      {
        membershipId: "m-build",
        userId: BUILDER,
        groupId: CAMP,
        role: "member",
        sanitizedAt: null,
      },
    ],
    [
      { membershipId: "m-cook", projectRoleId: KITCHEN, consent: "accepted" },
      { membershipId: "m-author", projectRoleId: KITCHEN, consent: "accepted" },
    ],
    [
      { id: BASELINE, groupId: CAMP, kind: "baseline", officerKey: null },
      { id: KITCHEN, groupId: CAMP, kind: "custom", officerKey: null },
    ],
  );
}

function notificationInserts() {
  return dbMock
    .writesTo(schema.notifications)
    .filter((q) => q.kind === "insert");
}

function bulletinUpdates() {
  return dbMock.writesTo(schema.bulletins).filter((q) => q.kind === "update");
}

beforeEach(() => {
  dbMock.reset();
  mail.sent = [];
  roles.membership = null;
  roles.baselineRoleId = null;
  roles.list = [];
  roles.calls = [];
});

describe("publishCampAnnouncement", () => {
  it("delivers to the audience, never the author, inside the claim's transaction", async () => {
    queueSender({ posterGrants: true });
    dbMock.queue([draftRow()], [{ id: DRAFT }], /* audit */ []);
    queueFanOutReads();

    const result = await store.publishCampAnnouncement({
      groupId: CAMP,
      id: DRAFT,
      actorId: AUTHOR,
      activeEditionId: EDITION,
    });

    expect(result).toEqual({ ok: true, recipients: 1, scheduledFor: null });
    const [insert] = notificationInserts();
    expect(insert).toBeDefined();
    expect(insert!.tx).toBe(true);
    // ON CONFLICT DO NOTHING: the partial unique index makes a retry a no-op.
    expect(insert!.called("onConflictDoNothing")).toBe(true);
    const values = insert!.arg("values") as {
      userId: string;
      origin: string;
    }[];
    // The author holds the kitchen role too, and still receives nothing.
    expect(values.map((v) => v.userId)).toEqual([COOK]);
    expect(values[0]).toMatchObject({
      origin: "camp",
      linkApp: "web",
      bulletinId: DRAFT,
      title: "Mad Hatters: Kitchen shift change",
    });
    // A feed announcement sends no immediate email.
    expect(mail.sent).toHaveLength(0);
  });

  it("re-reads the sender's permission under lock and refuses a DEMOTED sender", async () => {
    // The draft was saved while POSTER_ROLE granted post_announcements; the
    // grant was removed before publish. The locked re-read sees the removal.
    queueSender({ posterGrants: false });
    dbMock.queue([draftRow()]);

    const result = await store.publishCampAnnouncement({
      groupId: CAMP,
      id: DRAFT,
      actorId: AUTHOR,
      activeEditionId: EDITION,
    });

    expect(result).toEqual({
      ok: false,
      error: ANNOUNCEMENT_MESSAGES.notAllowed,
    });
    expect(bulletinUpdates()).toHaveLength(0);
    expect(notificationInserts()).toHaveLength(0);
    // The permission rows were read FOR SHARE inside the transaction.
    const lockedReads = dbMock.queries.filter(
      (q) => q.kind === "select" && q.tx && q.called("for"),
    );
    expect(lockedReads.map((q) => q.arg("for"))).toEqual([
      "share",
      "share",
      "share",
      "update",
    ]);
  });

  it("claims with a compare-and-set keyed on camp, author and still-a-draft", async () => {
    queueSender({ posterGrants: true });
    dbMock.queue([draftRow()], /* the claim lost a race */ []);
    // explainDraft's post-transaction read: someone published it first.
    dbMock.queue([
      { groupId: CAMP, createdByUserId: AUTHOR, publishedAt: new Date() },
    ]);

    const result = await store.publishCampAnnouncement({
      groupId: CAMP,
      id: DRAFT,
      actorId: AUTHOR,
      activeEditionId: EDITION,
    });

    expect(result).toEqual({
      ok: false,
      error: ANNOUNCEMENT_MESSAGES.published,
    });
    expect(notificationInserts()).toHaveLength(0);
    const [claim] = bulletinUpdates();
    const where = whereOf(claim!);
    expect(where.sql).toContain('"bulletins"."group_id" = $');
    expect(where.sql).toContain('"bulletins"."created_by_user_id" = $');
    expect(where.sql).toContain('"bulletins"."published_at" is null');
    expect(where.params).toEqual(expect.arrayContaining([DRAFT, CAMP, AUTHOR]));
  });

  it("another member's draft answers exactly like a missing one", async () => {
    queueSender({ posterGrants: true });
    dbMock.queue(/* owned-draft read finds nothing */ []);
    dbMock.queue([{ groupId: CAMP, createdByUserId: COOK, publishedAt: null }]);

    const result = await store.publishCampAnnouncement({
      groupId: CAMP,
      id: DRAFT,
      actorId: AUTHOR,
      activeEditionId: EDITION,
    });
    expect(result).toEqual({ ok: false, error: ANNOUNCEMENT_MESSAGES.missing });
    expect(bulletinUpdates()).toHaveLength(0);
  });

  it("a scheduled publish is claimed but delivers nothing until dispatch", async () => {
    const later = new Date(Date.now() + 24 * 60 * 60 * 1000);
    queueSender({ posterGrants: true });
    dbMock.queue([draftRow({ sendAt: later })], [{ id: DRAFT }], []);

    const result = await store.publishCampAnnouncement({
      groupId: CAMP,
      id: DRAFT,
      actorId: AUTHOR,
      activeEditionId: EDITION,
      schedulingEnabled: true,
    });

    expect(result).toEqual({ ok: true, recipients: 0, scheduledFor: later });
    expect(notificationInserts()).toHaveLength(0);
    const set = bulletinUpdates()[0]!.arg("set") as Record<string, unknown>;
    expect(set.dispatchedAt).toBeNull();
    expect(set.publishedAt).toBeInstanceOf(Date);
  });

  // Regression: with no scheduler wired, a scheduled publish was claimed
  // (published, immutable) and then never delivered by anything.
  it("a scheduled draft is refused, unclaimed, while scheduling is off", async () => {
    const later = new Date(Date.now() + 24 * 60 * 60 * 1000);
    queueSender({ posterGrants: true });
    dbMock.queue([draftRow({ sendAt: later })], [{ id: DRAFT }], []);

    const result = await store.publishCampAnnouncement({
      groupId: CAMP,
      id: DRAFT,
      actorId: AUTHOR,
      activeEditionId: EDITION,
      schedulingEnabled: false,
    });

    expect(result).toEqual({
      ok: false,
      error: ANNOUNCEMENT_MESSAGES.schedulingOff,
    });
    expect(bulletinUpdates()).toHaveLength(0);
    expect(notificationInserts()).toHaveLength(0);
  });

  it("the scheduling flag defaults to the deployment env, off when unset", async () => {
    vi.stubEnv("ANNOUNCEMENT_DISPATCH_ENABLED", "");
    const later = new Date(Date.now() + 24 * 60 * 60 * 1000);
    queueSender({ posterGrants: true });
    dbMock.queue([draftRow({ sendAt: later })], [{ id: DRAFT }], []);

    const result = await store.publishCampAnnouncement({
      groupId: CAMP,
      id: DRAFT,
      actorId: AUTHOR,
      activeEditionId: EDITION,
    });
    vi.unstubAllEnvs();

    expect(result.ok).toBe(false);
    expect(bulletinUpdates()).toHaveLength(0);
  });

  it("a must-acknowledge publish emails the recipients after commit", async () => {
    queueSender({ posterGrants: true });
    dbMock.queue(
      [draftRow({ presentation: "acknowledge" })],
      [{ id: DRAFT }],
      [],
    );
    queueFanOutReads();
    dbMock.queue(
      /* notifications insert */ [],
      [{ email: "cook@example.com" }],
    );

    const result = await store.publishCampAnnouncement({
      groupId: CAMP,
      id: DRAFT,
      actorId: AUTHOR,
      activeEditionId: EDITION,
    });
    expect(result.ok).toBe(true);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: ["cook@example.com"] });
  });

  // Regression: the email linked the bare path "/bulletins/<id>", which no
  // email client can open.
  it("the must-acknowledge email links to the app's absolute URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://contributors.example.com");
    queueSender({ posterGrants: true });
    dbMock.queue(
      [draftRow({ presentation: "acknowledge" })],
      [{ id: DRAFT }],
      [],
    );
    queueFanOutReads();
    dbMock.queue(
      /* notifications insert */ [],
      [{ email: "cook@example.com" }],
    );

    await store.publishCampAnnouncement({
      groupId: CAMP,
      id: DRAFT,
      actorId: AUTHOR,
      activeEditionId: EDITION,
    });
    vi.unstubAllEnvs();

    expect(mail.sent).toHaveLength(1);
    expect((mail.sent[0] as { text: string }).text).toContain(
      `https://contributors.example.com/bulletins/${DRAFT}`,
    );
  });
});

describe("drafts are the author's", () => {
  it("an edit is keyed on camp, author and unpublished", async () => {
    dbMock.queue(
      /* claimed nothing */ [],
      [{ groupId: CAMP, createdByUserId: COOK, publishedAt: null }],
    );
    const result = await store.saveCampAnnouncementDraft({
      groupId: CAMP,
      editionId: EDITION,
      actorId: AUTHOR,
      id: DRAFT,
      fields: {
        title: "x",
        bodyMd: "y",
        audience: KITCHEN_AUDIENCE,
        presentation: "feed",
        pinOnPublish: false,
        meetingUrl: null,
        sendAt: null,
      },
    });
    expect(result).toEqual({ ok: false, error: ANNOUNCEMENT_MESSAGES.missing });
    const where = whereOf(bulletinUpdates()[0]!);
    expect(where.sql).toContain('"bulletins"."created_by_user_id" = $');
    expect(where.sql).toContain('"bulletins"."published_at" is null');
    expect(where.params).toContain(AUTHOR);
  });

  it("a delete is keyed the same way — a published one can never be deleted", async () => {
    dbMock.queue(
      [],
      [{ groupId: CAMP, createdByUserId: AUTHOR, publishedAt: new Date() }],
    );
    const result = await store.deleteCampAnnouncementDraft({
      groupId: CAMP,
      id: DRAFT,
      actorId: AUTHOR,
    });
    expect(result).toEqual({
      ok: false,
      error: ANNOUNCEMENT_MESSAGES.published,
    });
    const del = dbMock.queriesOfKind("delete")[0]!;
    expect(whereOf(del).sql).toContain('"bulletins"."published_at" is null');
  });
});

describe("setCampAnnouncementPinned — compare-and-set", () => {
  it("pinning claims only an unpinned, delivered row, and reports a lost race", async () => {
    queueSender({ posterGrants: true });
    dbMock.queue(
      [
        {
          groupId: CAMP,
          audience: KITCHEN_AUDIENCE,
          dispatchedAt: new Date(),
          pinnedAt: new Date(), // someone else pinned it after our page loaded
        },
      ],
      /* CAS claimed nothing */ [],
    );

    const result = await store.setCampAnnouncementPinned({
      groupId: CAMP,
      id: DRAFT,
      actorId: AUTHOR,
      pinned: true,
    });

    expect(result).toEqual({
      ok: false,
      error: ANNOUNCEMENT_MESSAGES.alreadyPinned,
    });
    const where = whereOf(bulletinUpdates()[0]!);
    expect(where.sql).toContain('"bulletins"."pinned_at" is null');
    expect(where.sql).toContain('"bulletins"."dispatched_at" is not null');
    // No audit row for a pin that did not happen.
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });

  it("a sender without authority over the audience is refused before any write", async () => {
    queueSender({ posterGrants: false });
    dbMock.queue([
      {
        groupId: CAMP,
        audience: KITCHEN_AUDIENCE,
        dispatchedAt: new Date(),
        pinnedAt: null,
      },
    ]);
    const result = await store.setCampAnnouncementPinned({
      groupId: CAMP,
      id: DRAFT,
      actorId: AUTHOR,
      pinned: true,
    });
    expect(result).toEqual({
      ok: false,
      error: ANNOUNCEMENT_MESSAGES.notAllowed,
    });
    expect(bulletinUpdates()).toHaveLength(0);
  });

  it("a successful pin writes its audit row in the same transaction", async () => {
    queueSender({ posterGrants: true });
    dbMock.queue(
      [
        {
          groupId: CAMP,
          audience: KITCHEN_AUDIENCE,
          dispatchedAt: new Date(),
          pinnedAt: null,
        },
      ],
      [{ id: DRAFT }],
      [],
    );
    const result = await store.setCampAnnouncementPinned({
      groupId: CAMP,
      id: DRAFT,
      actorId: AUTHOR,
      pinned: true,
    });
    expect(result).toEqual({ ok: true });
    const [auditWrite] = dbMock.writesTo(schema.auditEvents);
    expect(auditWrite!.tx).toBe(true);
    expect(auditWrite!.arg("values")).toMatchObject({
      action: "announcement.pin",
      actorId: AUTHOR,
      subject: DRAFT,
    });
  });
});

describe("dispatchDueCampAnnouncements — idempotent", () => {
  it("a claim another run already won delivers nothing", async () => {
    dbMock.queue(
      /* due */ [{ id: DRAFT }],
      /* active edition */ [{ id: EDITION }],
      /* claim returns nothing: already dispatched */ [],
    );
    const summary = await store.dispatchDueCampAnnouncements(
      new Date("2027-03-02T08:00:00Z"),
    );
    expect(summary).toMatchObject({ due: 1, dispatched: 0, deliveries: 0 });
    expect(notificationInserts()).toHaveLength(0);
    const claim = bulletinUpdates()[0]!;
    expect(whereOf(claim).sql).toContain('"bulletins"."dispatched_at" is null');
  });

  it("the due scan only ever selects scheduled CAMP rows", async () => {
    dbMock.queue([]);
    await store.dispatchDueCampAnnouncements(new Date());
    const scan = whereOf(dbMock.queries[0]!);
    expect(scan.sql).toContain('"bulletins"."group_id" is not null');
    expect(scan.sql).toContain('"bulletins"."send_at" is not null');
    expect(scan.sql).toContain('"bulletins"."dispatched_at" is null');
  });

  it("a sender demoted after scheduling is skipped, recorded, and never retried", async () => {
    dbMock.queue(
      [{ id: DRAFT }],
      [{ id: EDITION }],
      [
        draftRow({
          groupId: CAMP,
          publishedAt: new Date(),
          sendAt: new Date(),
        }),
      ],
    );
    queueSender({ posterGrants: false });
    dbMock.queue(/* audit */ []);

    const summary = await store.dispatchDueCampAnnouncements(new Date());

    expect(summary).toMatchObject({ dispatched: 0, skipped: 1, deliveries: 0 });
    expect(notificationInserts()).toHaveLength(0);
    expect(dbMock.writesTo(schema.auditEvents)[0]!.arg("values")).toMatchObject(
      {
        action: "announcement.dispatch_skipped",
        meta: { reason: "sender_not_allowed" },
      },
    );
  });

  it("an announcement scheduled in a previous edition never reaches this one's roster", async () => {
    dbMock.queue(
      [{ id: DRAFT }],
      [{ id: "e0000000-0000-4000-8000-000000000999" }],
      [
        draftRow({
          groupId: CAMP,
          publishedAt: new Date(),
          sendAt: new Date(),
        }),
      ],
    );
    queueSender({ posterGrants: true });
    dbMock.queue([]);

    const summary = await store.dispatchDueCampAnnouncements(new Date());
    expect(summary).toMatchObject({ dispatched: 0, skipped: 1 });
    expect(notificationInserts()).toHaveLength(0);
  });

  it("a due, still-authorised announcement is delivered once", async () => {
    dbMock.queue(
      [{ id: DRAFT }],
      [{ id: EDITION }],
      [
        draftRow({
          groupId: CAMP,
          publishedAt: new Date(),
          sendAt: new Date(),
        }),
      ],
    );
    queueSender({ posterGrants: true });
    queueFanOutReads();

    const summary = await store.dispatchDueCampAnnouncements(new Date());
    expect(summary).toMatchObject({ dispatched: 1, deliveries: 1, skipped: 0 });
    expect(notificationInserts()[0]!.called("onConflictDoNothing")).toBe(true);
  });
});

describe("the recipient side", () => {
  it("acknowledging stamps only the CALLER's own delivery", async () => {
    dbMock.queue([{ id: "n-1" }]);
    expect(
      await gate.acknowledgeAnnouncement({ userId: COOK, bulletinId: DRAFT }),
    ).toBe(true);
    const update = dbMock.queriesOfKind("update")[0]!;
    const where = whereOf(update);
    expect(where.sql).toContain('"notifications"."user_id" = $');
    expect(where.sql).toContain('"notifications"."acknowledged_at" is null');
    expect(where.params).toContain(COOK);
    expect(where.params).not.toContain(AUTHOR);
  });

  it("a member with no delivery gets the not-found answer", async () => {
    dbMock.queue([], []);
    expect(
      await gate.acknowledgeAnnouncement({
        userId: BUILDER,
        bulletinId: DRAFT,
      }),
    ).toBe(false);
  });

  it("the gate finds the OLDEST unacknowledged must-acknowledge delivery", async () => {
    dbMock.queue([{ bulletinId: DRAFT }]);
    expect(await gate.firstUnacknowledgedAnnouncement(COOK)).toBe(DRAFT);
    const q = dbMock.queries[0]!;
    const where = whereOf(q);
    expect(where.sql).toContain('"bulletins"."presentation" = $');
    expect(where.params).toContain("acknowledge");
    expect(where.params).toContain(COOK);
  });
});

// --- Author-side reads ------------------------------------------------------

const PUBLISHED = "d0000000-0000-4000-8000-000000000002";
const ORG_BULLETIN = "d0000000-0000-4000-8000-000000000003";

/** The page-side sender snapshot. `poster` decides whether the sender holds
 * post_announcements over the kitchen — the lever every read below turns on. */
function senderContext(poster: boolean): SenderContext {
  return {
    perms: {
      structuralRole: "member",
      rolePermissions: [
        {},
        poster
          ? {
              post_announcements: {
                audienceRoles: [KITCHEN],
                mayRequireAck: true,
              },
            }
          : {},
      ],
    },
    baselineRoleId: BASELINE,
    campRoleIds: new Set([BASELINE, KITCHEN, POSTER_ROLE]),
  };
}

/** A delivered announcement another member (the cook) wrote. */
function publishedRow(overrides: Record<string, unknown> = {}) {
  return draftRow({
    id: PUBLISHED,
    createdByUserId: COOK,
    publishedAt: new Date("2027-03-02T08:00:00Z"),
    dispatchedAt: new Date("2027-03-02T08:00:00Z"),
    ...overrides,
  });
}

function notificationReads() {
  return dbMock
    .queriesTouching(schema.notifications)
    .filter((q) => q.kind === "select");
}

describe("getSenderContext", () => {
  it("a non-member has no sender context, and the camp's roles are never read", async () => {
    roles.membership = null;
    roles.list = [{ id: BASELINE }];
    expect(await store.getSenderContext(CAMP, AUTHOR)).toBeNull();
    expect(roles.calls).toEqual(["getMemberPermissions"]);
  });

  it("a member's context carries their permissions, the baseline and every camp role id", async () => {
    const perms = { structuralRole: "member", rolePermissions: [{}] };
    roles.membership = perms;
    roles.baselineRoleId = BASELINE;
    roles.list = [{ id: BASELINE }, { id: KITCHEN }];
    const ctx = await store.getSenderContext(CAMP, AUTHOR);
    expect(ctx).not.toBeNull();
    expect(ctx!.perms).toBe(perms);
    expect(ctx!.baselineRoleId).toBe(BASELINE);
    expect([...ctx!.campRoleIds].sort()).toEqual([BASELINE, KITCHEN].sort());
  });
});

describe("listCampAnnouncementsForSender", () => {
  it("a sender without post_announcements sees only their own drafts, and nobody else's published", async () => {
    dbMock.queue(/* drafts */ [draftRow()], /* published */ [publishedRow()]);
    const result = await store.listCampAnnouncementsForSender({
      groupId: CAMP,
      editionId: EDITION,
      viewerId: AUTHOR,
      sender: senderContext(false),
    });
    expect(result.published).toEqual([]);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({
      id: DRAFT,
      isMine: true,
      canPin: false,
      tally: { sent: 0, read: 0, acknowledged: 0 },
    });
    // Nothing visible was published, so no tally was even asked for.
    expect(notificationReads()).toHaveLength(0);
    // The drafts read is keyed on the viewer as author.
    const draftsRead = dbMock.queriesOfKind("select")[0]!;
    expect(whereOf(draftsRead).sql).toContain(
      '"bulletins"."created_by_user_id" = $',
    );
    expect(whereOf(draftsRead).params).toContain(AUTHOR);
  });

  it("a sender with posting authority sees published announcements with read and acknowledged tallies", async () => {
    const ownPublished = publishedRow({
      id: "d0000000-0000-4000-8000-000000000004",
      createdByUserId: AUTHOR,
    });
    dbMock.queue(
      /* drafts */ [],
      /* published */ [
        publishedRow(),
        ownPublished,
        // An org bulletin in the same camp never renders as a camp announcement.
        publishedRow({
          id: ORG_BULLETIN,
          createdByUserId: AUTHOR,
          audience: { kind: "org_suppliers" },
        }),
      ],
      /* tallies */ [
        { bulletinId: PUBLISHED, sent: 5, read: 3, acknowledged: 2 },
        { bulletinId: null, sent: 9, read: 9, acknowledged: 9 },
      ],
    );
    const result = await store.listCampAnnouncementsForSender({
      groupId: CAMP,
      editionId: EDITION,
      viewerId: AUTHOR,
      sender: senderContext(true),
    });
    expect(result.drafts).toEqual([]);
    expect(result.published.map((a) => a.id)).toEqual([
      PUBLISHED,
      ownPublished.id,
    ]);
    expect(result.published[0]).toMatchObject({
      isMine: false,
      canPin: true,
      tally: { sent: 5, read: 3, acknowledged: 2 },
    });
    // No delivery rows yet for their own: the zero tally, not a missing one.
    expect(result.published[1]!.tally).toEqual({
      sent: 0,
      read: 0,
      acknowledged: 0,
    });
    // The tally read is scoped to exactly the visible announcements.
    const [tallyRead] = notificationReads();
    expect(whereOf(tallyRead!).params).toEqual(
      expect.arrayContaining([PUBLISHED, ownPublished.id]),
    );
  });

  it("a sender without authority still sees the announcements they wrote themselves", async () => {
    dbMock.queue(
      [],
      [
        publishedRow(),
        publishedRow({ id: ORG_BULLETIN, createdByUserId: AUTHOR }),
      ],
      [{ bulletinId: ORG_BULLETIN, sent: 2, read: 1, acknowledged: 0 }],
    );
    const result = await store.listCampAnnouncementsForSender({
      groupId: CAMP,
      editionId: EDITION,
      viewerId: AUTHOR,
      sender: senderContext(false),
    });
    expect(result.published.map((a) => [a.id, a.isMine, a.canPin])).toEqual([
      [ORG_BULLETIN, true, false],
    ]);
    expect(result.published[0]!.tally).toEqual({
      sent: 2,
      read: 1,
      acknowledged: 0,
    });
  });
});

describe("getCampAnnouncementForSender", () => {
  const read = (viewerId: string, poster: boolean, id = PUBLISHED) =>
    store.getCampAnnouncementForSender({
      groupId: CAMP,
      id,
      viewerId,
      sender: senderContext(poster),
    });

  it("an unknown id is null", async () => {
    dbMock.queue([]);
    expect(await read(AUTHOR, true)).toBeNull();
    expect(whereOf(dbMock.queries[0]!).params).toEqual(
      expect.arrayContaining([PUBLISHED, CAMP]),
    );
  });

  it("another member's draft reads as not-found, even to a sender with authority", async () => {
    dbMock.queue([draftRow({ createdByUserId: COOK })]);
    expect(await read(AUTHOR, true, DRAFT)).toBeNull();
    expect(notificationReads()).toHaveLength(0);
  });

  it("the author's own draft is served, with no tally", async () => {
    dbMock.queue([draftRow()]);
    const view = await read(AUTHOR, false, DRAFT);
    expect(view).toMatchObject({
      id: DRAFT,
      title: "Kitchen shift change",
      isMine: true,
      publishedAt: null,
      tally: { sent: 0, read: 0, acknowledged: 0 },
    });
    expect(notificationReads()).toHaveLength(0);
  });

  it("a sender without post_announcements gets nothing back for someone else's published announcement", async () => {
    dbMock.queue([publishedRow()]);
    expect(await read(AUTHOR, false)).toBeNull();
    // Refused before the delivery tallies were read.
    expect(notificationReads()).toHaveLength(0);
  });

  it("a published announcement returns its read and acknowledged tallies", async () => {
    dbMock.queue(
      [publishedRow({ presentation: "acknowledge" })],
      [{ bulletinId: PUBLISHED, sent: 12, read: 8, acknowledged: 5 }],
    );
    const view = await read(AUTHOR, true);
    expect(view).toMatchObject({
      id: PUBLISHED,
      isMine: false,
      canPin: true,
      presentation: "acknowledge",
      tally: { sent: 12, read: 8, acknowledged: 5 },
    });
  });

  it("the author's own published announcement with no deliveries tallies zero", async () => {
    dbMock.queue([publishedRow({ createdByUserId: AUTHOR })], []);
    const view = await read(AUTHOR, false);
    expect(view).toMatchObject({ isMine: true, canPin: false });
    expect(view!.tally).toEqual({ sent: 0, read: 0, acknowledged: 0 });
  });

  it("an org bulletin in the camp is not a camp announcement", async () => {
    // Even its own author, holding posting authority, gets null for it.
    dbMock.queue(
      [
        publishedRow({
          createdByUserId: AUTHOR,
          audience: { kind: "org_suppliers" },
        }),
      ],
      /* tallies */ [],
    );
    expect(await read(AUTHOR, true)).toBeNull();
  });
});

describe("draft writes — the success and error branches", () => {
  const fields = {
    title: "Build week",
    bodyMd: "Gate opens Tuesday.",
    audience: KITCHEN_AUDIENCE,
    presentation: "feed" as const,
    pinOnPublish: false,
    meetingUrl: null,
    sendAt: null,
  };

  it("a new draft is created in the camp and edition, authored by the actor", async () => {
    dbMock.queue([{ id: DRAFT }]);
    const result = await store.saveCampAnnouncementDraft({
      groupId: CAMP,
      editionId: EDITION,
      actorId: AUTHOR,
      fields,
    });
    expect(result).toEqual({ ok: true, id: DRAFT });
    const insert = dbMock.onlyQuery("insert");
    expect(insert.arg("values")).toMatchObject({
      groupId: CAMP,
      editionId: EDITION,
      createdByUserId: AUTHOR,
      title: "Build week",
    });
    expect(bulletinUpdates()).toHaveLength(0);
  });

  it("an insert that returns no row is reported, not claimed as saved", async () => {
    dbMock.queue([]);
    const result = await store.saveCampAnnouncementDraft({
      groupId: CAMP,
      editionId: EDITION,
      actorId: AUTHOR,
      fields,
    });
    expect(result).toEqual({ ok: false, error: "Could not save the draft." });
  });

  it("an edit of the author's own draft succeeds without an explain read", async () => {
    dbMock.queue([{ id: DRAFT }]);
    const result = await store.saveCampAnnouncementDraft({
      groupId: CAMP,
      editionId: EDITION,
      actorId: AUTHOR,
      id: DRAFT,
      fields,
    });
    expect(result).toEqual({ ok: true, id: DRAFT });
    expect(dbMock.queriesOfKind("select")).toHaveLength(0);
    expect(bulletinUpdates()[0]!.arg("set")).toMatchObject({
      title: "Build week",
    });
  });

  it("deleting the author's own draft succeeds", async () => {
    dbMock.queue([{ id: DRAFT }]);
    expect(
      await store.deleteCampAnnouncementDraft({
        groupId: CAMP,
        id: DRAFT,
        actorId: AUTHOR,
      }),
    ).toEqual({ ok: true });
    expect(dbMock.queriesOfKind("select")).toHaveLength(0);
  });

  it("deleting an id that does not exist answers missing", async () => {
    dbMock.queue([], []);
    expect(
      await store.deleteCampAnnouncementDraft({
        groupId: CAMP,
        id: DRAFT,
        actorId: AUTHOR,
      }),
    ).toEqual({ ok: false, error: ANNOUNCEMENT_MESSAGES.missing });
  });
});

describe("publishCampAnnouncement — refusals and side paths", () => {
  const publish = () =>
    store.publishCampAnnouncement({
      groupId: CAMP,
      id: DRAFT,
      actorId: AUTHOR,
      activeEditionId: EDITION,
    });

  it("a sender who is no longer a member is refused, nothing claimed", async () => {
    dbMock.queue(/* membership gone */ [], [draftRow()]);
    expect(await publish()).toEqual({
      ok: false,
      error: ANNOUNCEMENT_MESSAGES.notAllowed,
    });
    expect(bulletinUpdates()).toHaveLength(0);
    expect(notificationInserts()).toHaveLength(0);
  });

  it("a draft from an earlier edition is refused, nothing claimed", async () => {
    queueSender({ posterGrants: true });
    dbMock.queue([
      draftRow({ editionId: "e0000000-0000-4000-8000-000000000999" }),
    ]);
    const result = await publish();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/earlier edition/);
    expect(bulletinUpdates()).toHaveLength(0);
  });

  it("a row with a non-camp audience is explained, never published", async () => {
    queueSender({ posterGrants: true });
    dbMock.queue(
      [draftRow({ audience: { kind: "org_suppliers" } })],
      [{ groupId: CAMP, createdByUserId: AUTHOR, publishedAt: null }],
    );
    const result = await publish();
    expect(result.ok).toBe(false);
    expect(bulletinUpdates()).toHaveLength(0);
    expect(notificationInserts()).toHaveLength(0);
  });

  it("pin-on-publish pins the row and audits it inside the transaction", async () => {
    queueSender({ posterGrants: true });
    dbMock.queue([draftRow({ pinOnPublish: true })], [{ id: DRAFT }], []);
    // The camp has no name row: the payload falls back to a generic one.
    dbMock.queue(
      [],
      [
        {
          membershipId: "m-cook",
          userId: COOK,
          groupId: CAMP,
          role: "member",
          sanitizedAt: null,
        },
      ],
      [{ membershipId: "m-cook", projectRoleId: KITCHEN, consent: "accepted" }],
      [{ id: KITCHEN, groupId: CAMP, kind: "custom", officerKey: null }],
    );
    const result = await publish();
    expect(result).toEqual({ ok: true, recipients: 1, scheduledFor: null });
    const pin = bulletinUpdates().find(
      (q) => (q.arg("set") as { pinned?: boolean }).pinned === true,
    );
    expect(pin).toBeDefined();
    expect(pin!.tx).toBe(true);
    expect(pin!.arg("set")).toMatchObject({
      pinnedByUserId: AUTHOR,
      pinOnPublish: false,
    });
    const actions = dbMock
      .writesTo(schema.auditEvents)
      .map((q) => (q.arg("values") as { action: string }).action);
    expect(actions).toEqual(["announcement.publish", "announcement.pin"]);
    const [insert] = notificationInserts();
    expect((insert!.arg("values") as { title: string }[])[0]!.title).toContain(
      "Your camp",
    );
  });

  it("a must-acknowledge publish to recipients with no email sends nothing", async () => {
    queueSender({ posterGrants: true });
    dbMock.queue(
      [draftRow({ presentation: "acknowledge" })],
      [{ id: DRAFT }],
      [],
    );
    queueFanOutReads();
    dbMock.queue(/* notifications insert */ [], [{ email: null }]);
    const result = await publish();
    expect(result.ok).toBe(true);
    expect(mail.sent).toHaveLength(0);
  });

  it("an email failure never un-publishes the announcement", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    queueSender({ posterGrants: true });
    dbMock.queue(
      [draftRow({ presentation: "acknowledge" })],
      [{ id: DRAFT }],
      [],
    );
    queueFanOutReads();
    dbMock.queue(/* notifications insert */ [], new Error("mail lookup down"));
    const result = await publish();
    expect(result).toEqual({ ok: true, recipients: 1, scheduledFor: null });
    expect(mail.sent).toHaveLength(0);
    expect(errors).toHaveBeenCalledWith(
      "[announcements] must-acknowledge email failed",
      expect.any(Error),
    );
    errors.mockRestore();
  });
});

describe("setCampAnnouncementPinned — unpin and missing", () => {
  it("unpinning claims only a pinned row and audits the unpin", async () => {
    queueSender({ posterGrants: true });
    dbMock.queue(
      [
        {
          groupId: CAMP,
          audience: KITCHEN_AUDIENCE,
          dispatchedAt: new Date(),
          pinnedAt: new Date(),
        },
      ],
      [{ id: PUBLISHED }],
      [],
    );
    const result = await store.setCampAnnouncementPinned({
      groupId: CAMP,
      id: PUBLISHED,
      actorId: AUTHOR,
      pinned: false,
    });
    expect(result).toEqual({ ok: true });
    const claim = bulletinUpdates()[0]!;
    expect(claim.arg("set")).toMatchObject({
      pinned: false,
      pinnedAt: null,
      pinnedByUserId: null,
    });
    expect(whereOf(claim).sql).toContain('"bulletins"."pinned_at" is not null');
    expect(dbMock.writesTo(schema.auditEvents)[0]!.arg("values")).toMatchObject(
      { action: "announcement.unpin", subject: PUBLISHED },
    );
  });

  it("a missing announcement is refused with no write", async () => {
    queueSender({ posterGrants: true });
    dbMock.queue([]);
    const result = await store.setCampAnnouncementPinned({
      groupId: CAMP,
      id: PUBLISHED,
      actorId: AUTHOR,
      pinned: true,
    });
    expect(result.ok).toBe(false);
    expect(bulletinUpdates()).toHaveLength(0);
  });
});

describe("dispatchDueCampAnnouncements — skips and failures", () => {
  it("a scheduled org bulletin is claimed but never fanned out as a camp announcement", async () => {
    dbMock.queue(
      [{ id: DRAFT }],
      [{ id: EDITION }],
      [
        draftRow({
          groupId: CAMP,
          audience: { kind: "org_suppliers" },
          publishedAt: new Date(),
          sendAt: new Date(),
        }),
      ],
    );
    const summary = await store.dispatchDueCampAnnouncements(new Date());
    expect(summary).toMatchObject({ due: 1, dispatched: 0, skipped: 1 });
    expect(notificationInserts()).toHaveLength(0);
  });

  it("an announcement whose author is gone is skipped as author_gone", async () => {
    dbMock.queue(
      [{ id: DRAFT }],
      [{ id: EDITION }],
      [
        draftRow({
          groupId: CAMP,
          createdByUserId: null,
          publishedAt: new Date(),
          sendAt: new Date(),
        }),
      ],
      /* audit */ [],
    );
    const summary = await store.dispatchDueCampAnnouncements(new Date());
    expect(summary).toMatchObject({ dispatched: 0, skipped: 1 });
    expect(dbMock.writesTo(schema.auditEvents)[0]!.arg("values")).toMatchObject(
      { meta: { reason: "author_gone" } },
    );
    // No sender lock was taken for an author that no longer exists.
    expect(dbMock.queriesTouching(schema.memberships)).toHaveLength(0);
  });

  it("one that throws is reported by the database's own message and does not stop the rest", async () => {
    const second = "d0000000-0000-4000-8000-000000000005";
    dbMock.queue(
      [{ id: DRAFT }, { id: second }],
      [{ id: EDITION }],
      new Error("query text with member ids", {
        cause: new Error("deadlock detected"),
      }),
      new Error("connection reset"),
    );
    const summary = await store.dispatchDueCampAnnouncements(new Date());
    expect(summary.failures).toEqual([
      { bulletinId: DRAFT, error: "deadlock detected" },
      { bulletinId: second, error: "connection reset" },
    ]);
    expect(summary).toMatchObject({ due: 2, dispatched: 0, skipped: 0 });
  });
});
