import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as DbModule from "@/lib/db";
import { installFakeDb, pgTimestamp, type FakeDb } from "@/test/fakes/db";
import { refusal, success } from "@/test/fakes/expect";
import type { SupplierSession, SupplierSessionState } from "@/lib/session";

// The portal's notification mutations and header feed
// (lib/actions/notifications.ts).
//
// THE AUTHZ IS EXPRESSED ENTIRELY AS `WHERE` PREDICATES. Every update pins
// `user_id` to the gated session's `dbUserId`, so a forged notification id from
// somebody else's inbox simply matches nothing. That is invisible in a code
// review of a diff that "simplifies" the query — dropping one `eq` leaves every
// behavioural test passing and turns a supplier's own-inbox action into a
// cross-account write.
//
// `fetchRecentNotifications` returning empty for a non-ok session is what keeps
// the header chrome from erroring for a signed-out or env-less caller.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireSupplierSession: vi.fn(),
  resolveSupplierSession: vi.fn(),
}));
vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof DbModule>("@/lib/db");
  const { fakeDb: current } = await import("@/test/fakes/db");
  return { ...actual, getDb: () => current().handle };
});

const { revalidatePath } = await import("next/cache");
const { requireSupplierSession, resolveSupplierSession } = await import(
  "@/lib/session"
);
const {
  fetchRecentNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = await import("@/lib/actions/notifications");

const NOTIFICATION_ID = "8f14e45f-ceea-467a-9a3e-4d2b1a7c0001";

const SESSION = {
  user: {
    id: "auth-alice",
    primaryEmail: "alice@example.com",
    displayName: "Alice Hatter",
    emailVerified: true,
  },
  dbUserId: "user-alice",
  supplier: { id: "sup-1", name: "Karoo Tents", standing: "good" },
  edition: { id: "ed-2027", name: "AfrikaBurn 2027", year: 2027 },
  steps: {},
  progress: { completed: 0, total: 7 },
} as unknown as SupplierSession;

let db: FakeDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = installFakeDb();
  vi.stubEnv("DATABASE_URL", "postgres://stub/does-not-connect");
  vi.mocked(requireSupplierSession).mockResolvedValue(SESSION);
  vi.mocked(resolveSupplierSession).mockResolvedValue({
    kind: "ok",
    ...SESSION,
  } as SupplierSessionState);
});

describe("fetchRecentNotifications", () => {
  it("returns an empty list for EVERY non-ok session, rather than erroring the chrome", async () => {
    // The header panel is rendered on every page, including the ones a
    // signed-out or unlinked caller sees.
    for (const state of [
      { kind: "unauthenticated" },
      { kind: "not_ready", user: SESSION.user },
      { kind: "unlinked", user: SESSION.user, dbUserId: "user-alice" },
    ] as SupplierSessionState[]) {
      db = installFakeDb();
      vi.mocked(resolveSupplierSession).mockResolvedValue(state);

      expect(await fetchRecentNotifications()).toEqual([]);
      expect(db.queries).toEqual([]);
    }
  });

  it("projects rows through toRowItem against ONE fixed now", async () => {
    // Everything runs on the server so the relative-time string is computed
    // once and can never hydrate-mismatch. Two rows minutes apart must be
    // measured against the same instant.
    const now = new Date();
    db.rows("notifications", [
      {
        id: "n-1",
        userId: "user-alice",
        kind: "supplier",
        title: "Your standing changed",
        body: null,
        link: "/standing",
        origin: "org",
        linkApp: "suppliers",
        bulletinId: null,
        createdAt: pgTimestamp(new Date(now.getTime() - 2 * 60 * 60 * 1000)),
        readAt: null,
      },
    ]);

    const items = await fetchRecentNotifications();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "n-1",
      title: "Your standing changed",
      link: "/standing",
      read: false,
    });
    // The client only ever receives display text, never the raw row.
    expect(items[0]!.meta).toBe("2 hours ago · AfrikaBurn");
  });

  it("reads only the gated session's own inbox", async () => {
    db.rows("notifications", []);

    await fetchRecentNotifications();

    expect(db.queries[0]!.sql).toContain('"notifications"."user_id" = ');
    expect(db.queries[0]!.params).toContain("user-alice");
  });
});

describe("markNotificationRead", () => {
  it("refuses without an ok supplier session", async () => {
    vi.mocked(requireSupplierSession).mockRejectedValue(
      new Error("Sign in as a registered supplier to do that."),
    );

    expect(
      refusal(await markNotificationRead({ notificationId: NOTIFICATION_ID })),
    ).toBe("Sign in as a registered supplier to do that.");
    expect(db.queries).toEqual([]);
  });

  it("scopes the update by notification id AND user id AND unread", async () => {
    // A forged id from another inbox matches nothing. Losing the `user_id`
    // predicate turns this into a write against somebody else's row.
    success(await markNotificationRead({ notificationId: NOTIFICATION_ID }));

    const update = db.matching('update "notifications"')[0]!;
    expect(update.sql).toContain('"notifications"."id" = ');
    expect(update.sql).toContain('"notifications"."user_id" = ');
    expect(update.sql).toContain('"notifications"."read_at" is null');
    expect(update.params).toContain(NOTIFICATION_ID);
    expect(update.params).toContain("user-alice");
  });

  it("refuses an id that is not a uuid, at the boundary", async () => {
    expect(
      refusal(await markNotificationRead({ notificationId: "1 OR 1=1" })),
    ).toMatch(/uuid/i);
    expect(db.queries).toEqual([]);
  });

  it("revalidates the inbox AND the layout the bell count lives in", async () => {
    success(await markNotificationRead({ notificationId: NOTIFICATION_ID }));

    expect(revalidatePath).toHaveBeenCalledWith("/notifications");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});

describe("markAllNotificationsRead", () => {
  it("refuses without an ok supplier session", async () => {
    vi.mocked(requireSupplierSession).mockRejectedValue(
      new Error("Sign in as a registered supplier to do that."),
    );

    expect(refusal(await markAllNotificationsRead())).toMatch(/Sign in/);
    expect(db.queries).toEqual([]);
  });

  it("scopes the sweep to this user's unread rows only", async () => {
    success(await markAllNotificationsRead());

    const update = db.matching('update "notifications"')[0]!;
    expect(update.sql).toContain('"notifications"."user_id" = ');
    expect(update.sql).toContain('"notifications"."read_at" is null');
    expect(update.params).toContain("user-alice");
    // No id predicate — this is a sweep, but a sweep of ONE inbox.
    expect(update.sql).not.toContain('"notifications"."id" = ');
  });

  it("revalidates the inbox AND the layout", async () => {
    success(await markAllNotificationsRead());

    expect(revalidatePath).toHaveBeenCalledWith("/notifications");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});
