import { describe, it, expect, beforeEach, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { schema } from "@quagga/db";
import { ANNOUNCEMENT_MESSAGES } from "@quagga/core";
import { dbMock, type RecordedQuery } from "@/test/db-mock";

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
vi.mock("@/lib/roles-store", () => ({
  getMemberPermissions: async () => null,
  getBaselineRoleId: async () => null,
  listRoles: async () => [],
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
    });

    expect(result).toEqual({ ok: true, recipients: 0, scheduledFor: later });
    expect(notificationInserts()).toHaveLength(0);
    const set = bulletinUpdates()[0]!.arg("set") as Record<string, unknown>;
    expect(set.dispatchedAt).toBeNull();
    expect(set.publishedAt).toBeInstanceOf(Date);
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
