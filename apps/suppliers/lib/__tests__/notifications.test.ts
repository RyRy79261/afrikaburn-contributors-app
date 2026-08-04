import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationRow } from "@quagga/core";

import type * as DbModule from "@/lib/db";
import { installFakeDb, pgTimestamp, type FakeDb } from "@/test/fakes/db";

// The portal's notifications backend (lib/notifications.ts).
//
// Three things here are invisible until they break, and each breaks silently:
//
//  1. `getBulletinForSupplier` is authorised by the EXISTENCE of a notification
//     row tying the bulletin to this user, and by nothing else. Lose that
//     predicate and an org-internal or participant-targeted broadcast becomes
//     readable by any supplier who guesses an id.
//  2. `toView`'s cross-app link rule. A link minted for another app is a path
//     this one cannot serve, so every affected row is a guaranteed 404.
//  3. The insert chunking. Postgres' 65535-parameter ceiling has already caused
//     a real rollback of a whole bulletin fan-out — and because a publish wraps
//     the insert in a transaction, the failure took the entire broadcast with it.
//
// The fake compiles real drizzle SQL (test/fakes/db.ts); Postgres' own limits
// are not exercised here, only the chunking that respects them.

vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof DbModule>("@/lib/db");
  const { fakeDb: current } = await import("@/test/fakes/db");
  return { ...actual, getDb: () => current().handle };
});

const {
  getUnreadNotificationCount,
  listNotificationGroups,
  recentNotifications,
  insertNotifications,
  getBulletinForSupplier,
} = await import("@/lib/notifications");

const USER = "user-alice";
const AT = new Date("2026-07-14T09:00:00.000Z");

/** A stored notifications row, as the driver hands it back. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "n-1",
    userId: USER,
    kind: "supplier",
    title: "Your standing changed",
    body: null,
    link: "/standing",
    origin: "org",
    linkApp: "suppliers",
    bulletinId: null,
    createdAt: pgTimestamp(AT),
    readAt: null,
    ...overrides,
  };
}

let db: FakeDb;

beforeEach(() => {
  db = installFakeDb();
  vi.stubEnv("DATABASE_URL", "postgres://stub/does-not-connect");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the cross-app link rule", () => {
  it("drops a link minted for ANOTHER app rather than rendering a 404", async () => {
    db.rows("notifications", [row({ link: "/camps/404", linkApp: "web" })]);

    const [view] = await recentNotifications(USER);

    expect(view!.link).toBeNull();
    // The row itself still shows — it just does not pretend to be clickable.
    expect(view!.title).toBe("Your standing changed");
  });

  it("keeps a link minted for this app", async () => {
    db.rows("notifications", [
      row({ link: "/standing", linkApp: "suppliers" }),
    ]);

    expect((await recentNotifications(USER))[0]!.link).toBe("/standing");
  });

  it("treats a null linkApp — every pre-migration row — as local", async () => {
    // Null means "unknown, treat as local", which is the pre-migration
    // behaviour exactly. Reading it as foreign would blank every old row's link
    // at once.
    db.rows("notifications", [row({ link: "/standing", linkApp: null })]);

    expect((await recentNotifications(USER))[0]!.link).toBe("/standing");
  });
});

describe("listNotificationGroups", () => {
  it("adds the unread predicate ONLY for the 'unread' filter", async () => {
    db.rows("notifications", []);
    await listNotificationGroups(USER, "unread");
    expect(db.queries[0]!.sql).toContain('"notifications"."read_at" is null');

    db = installFakeDb();
    db.rows("notifications", []);
    await listNotificationGroups(USER, "all");
    expect(db.queries[0]!.sql).not.toContain('"read_at" is null');
  });

  it("adds the bulletin predicate ONLY for the 'bulletins' filter", async () => {
    db.rows("notifications", []);
    await listNotificationGroups(USER, "bulletins");
    const sql = db.queries[0]!.sql;
    expect(sql).toContain('"notifications"."kind" = ');
    expect(db.queries[0]!.params).toContain("bulletin");

    db = installFakeDb();
    db.rows("notifications", []);
    await listNotificationGroups(USER, "all");
    expect(db.queries[0]!.sql).not.toContain('"kind" = ');
  });

  it("always scopes to the caller's own user id, newest first", async () => {
    db.rows("notifications", []);

    await listNotificationGroups(USER);

    expect(db.queries[0]!.sql).toContain('"notifications"."user_id" = ');
    expect(db.queries[0]!.params).toContain(USER);
    expect(db.queries[0]!.sql).toContain(
      'order by "notifications"."created_at" desc',
    );
  });

  it("groups the projected views by day", async () => {
    db.rows("notifications", [
      row({ id: "n-1", createdAt: pgTimestamp(AT) }),
      row({
        id: "n-2",
        createdAt: pgTimestamp(new Date("2026-07-13T09:00:00Z")),
      }),
    ]);

    const groups = await listNotificationGroups(USER);

    expect(groups).toHaveLength(2);
    expect(groups[0]!.items[0]!.id).toBe("n-1");
  });
});

describe("getUnreadNotificationCount", () => {
  it("returns the counted value", async () => {
    // `count` is a raw SQL expression with no column name, so the row is
    // positional — see test/fakes/db.ts.
    db.rows("notifications", [[4]]);

    expect(await getUnreadNotificationCount(USER)).toBe(4);
  });

  it("coalesces a missing count row to 0, never NaN or undefined", async () => {
    // The header bell renders this straight into a badge.
    db.rows("notifications", []);

    expect(await getUnreadNotificationCount(USER)).toBe(0);
  });
});

describe("getBulletinForSupplier", () => {
  const BULLETIN = {
    id: "b-1",
    title: "Depot hours",
    bodyMd: "# Depot hours",
    pinned: false,
    publishedAt: pgTimestamp(AT),
  };

  it("returns the bulletin when a notification row ties it to this user", async () => {
    db.rows("notifications", [{ id: "n-1" }]);
    db.rows("bulletins", [BULLETIN]);

    const bulletin = await getBulletinForSupplier(USER, "b-1");

    expect(bulletin?.title).toBe("Depot hours");
  });

  it("returns null when NO notification row ties it to this user", async () => {
    // The authz. The bulletin exists and is published — an org-internal or
    // participant-targeted broadcast must still 404 for a supplier who guesses
    // its id, so the bulletin is not even read.
    db.rows("notifications", []);
    db.rows("bulletins", [BULLETIN]);

    expect(await getBulletinForSupplier(USER, "b-1")).toBeNull();
    expect(db.against("bulletins")).toEqual([]);
  });

  it("scopes the authorising read to BOTH the user and the bulletin", async () => {
    db.rows("notifications", [{ id: "n-1" }]);
    db.rows("bulletins", [BULLETIN]);

    await getBulletinForSupplier(USER, "b-1");

    const authz = db.against("notifications")[0]!;
    expect(authz.sql).toContain('"notifications"."user_id" = ');
    expect(authz.sql).toContain('"notifications"."bulletin_id" = ');
    expect(authz.params).toEqual([USER, "b-1", 1]);
  });

  it("returns null for an UNPUBLISHED bulletin even with a notification row", async () => {
    // A draft can already have rows against it from a previous publish cycle.
    db.rows("notifications", [{ id: "n-1" }]);
    db.rows("bulletins", [{ ...BULLETIN, publishedAt: null }]);

    expect(await getBulletinForSupplier(USER, "b-1")).toBeNull();
  });

  it("returns null when the bulletin row is gone", async () => {
    db.rows("notifications", [{ id: "n-1" }]);
    db.rows("bulletins", []);

    expect(await getBulletinForSupplier(USER, "b-1")).toBeNull();
  });
});

describe("insertNotifications", () => {
  function fanOut(count: number): NotificationRow[] {
    return Array.from({ length: count }, (_, i) => ({
      userId: `user-${i}`,
      kind: "bulletin" as const,
      title: "Depot hours",
      body: null,
      link: "/bulletins/b-1",
      linkApp: null,
      bulletinId: "b-1",
    }));
  }

  it("no-ops on an empty batch without touching the handle", async () => {
    await insertNotifications(db.handle, []);

    expect(db.queries).toEqual([]);
  });

  it("chunks a fan-out larger than the parameter ceiling into batches of 1000", async () => {
    // Eight bound columns per row against Postgres' 65535-parameter ceiling
    // means one insert dies around 8191 rows with SQLSTATE 08P01 — and the
    // publish wraps this in a transaction, so the whole broadcast rolled back.
    // AfrikaBurn is comfortably bigger than that, so this was a live ceiling.
    await insertNotifications(db.handle, fanOut(2500));

    const inserts = db.matching('insert into "notifications"');
    expect(inserts).toHaveLength(3);
    expect(inserts.map((q) => q.params.length / 8)).toEqual([1000, 1000, 500]);
  });

  it("keeps an EXPLICIT null linkApp, which the bulletin fan-out relies on", async () => {
    // `null ?? "suppliers"` is `"suppliers"` — the exact bug this rule exists
    // for. A bulletin stamped for one app renders inert in the other two.
    await insertNotifications(db.handle, fanOut(1));

    expect(db.queries[0]!.params).not.toContain("suppliers");
  });

  it("defaults an UNSTATED linkApp to this app", async () => {
    await insertNotifications(db.handle, [
      {
        userId: USER,
        kind: "security",
        title: "Your password was changed",
        body: null,
        link: "/account/security",
      },
    ]);

    expect(db.queries[0]!.params).toContain("suppliers");
  });
});

describe("with no database configured", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "");
  });

  it("every read degrades to its empty value, and none queries", async () => {
    // Hard engineering rule 4: all three apps boot env-less to a graceful state.
    expect(await getUnreadNotificationCount(USER)).toBe(0);
    expect(await listNotificationGroups(USER)).toEqual([]);
    expect(await recentNotifications(USER)).toEqual([]);
    expect(await getBulletinForSupplier(USER, "b-1")).toBeNull();
    expect(db.queries).toEqual([]);
  });
});
