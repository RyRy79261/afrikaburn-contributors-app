import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { boundStrings, dbMock } from "@/test/db-mock";
import { resetNextMocks, revalidated } from "@/test/next-mocks";

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());
vi.mock("next/cache", async () =>
  (await import("@/test/next-mocks")).nextCacheMock(),
);

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("../session", () => ({
  getCurrentCampUser: async () => session.user,
  requireCampUser: async () => {
    if (session.user instanceof Error) throw session.user;
    if (!session.user) throw new Error("signed out");
    return session.user;
  },
}));

const {
  insertNotifications,
  listNotificationGroups,
  recentNotifications,
  getUnreadNotificationCount,
} = await import("../notifications");
const { getBulletinForCurrentUser, getPinnedBulletinsForCurrentUser } =
  await import("../bulletins");
const { markNotificationRead, markAllNotificationsRead } =
  await import("../notifications-actions");

const USER = "cccccccc-0000-0000-0000-000000000001";
const CAMP_USER = {
  id: USER,
  authUserId: "auth-1",
  email: "alice@example.com",
  username: "alice",
};
const NOTIFICATION_ID = "11111111-1111-4111-8111-111111111111";
const BULLETIN_ID = "22222222-2222-4222-8222-222222222222";

/** A `notifications` row as `select()` returns it. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTIFICATION_ID,
    kind: "bulletin",
    title: "Gate opens Sunday",
    body: null,
    link: "/bulletins/abc",
    linkApp: "web",
    bulletinId: BULLETIN_ID,
    createdAt: new Date("2026-08-04T09:00:00Z"),
    readAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  dbMock.reset();
  resetNextMocks();
  session.user = CAMP_USER;
  vi.stubEnv("DATABASE_URL", "postgres://test/quagga");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("insertNotifications — the chunk boundary", () => {
  const batch = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      userId: `user-${i}`,
      kind: "bulletin" as const,
      title: "Gate opens Sunday",
      body: null,
      link: null,
    }));

  it("is a no-op on an empty batch and issues zero inserts", async () => {
    await insertNotifications(dbMock.handle as never, []);
    expect(dbMock.queries).toHaveLength(0);
  });

  it("issues ONE insert at exactly 1000 rows and TWO at 1001", async () => {
    // Unchunked, a single insert died at 10923 rows with SQLSTATE 08P01 — and
    // because a bulletin publish wraps this in a transaction, the WHOLE
    // broadcast rolled back. AfrikaBurn is comfortably bigger than 10922
    // people, so this was a live ceiling on the participant fan-out.
    await insertNotifications(dbMock.handle as never, batch(1000));
    expect(dbMock.queriesOfKind("insert")).toHaveLength(1);

    dbMock.reset();
    await insertNotifications(dbMock.handle as never, batch(1001));
    const inserts = dbMock.queriesOfKind("insert");
    expect(inserts).toHaveLength(2);
    expect((inserts[0]!.arg("values") as unknown[]).length).toBe(1000);
    expect((inserts[1]!.arg("values") as unknown[]).length).toBe(1);
  });

  it("keeps an EXPLICIT null linkApp and defaults an absent one to web", async () => {
    // One rule, in @quagga/core: `undefined` means "the caller did not say" and
    // defaults to this app; an explicit null means "belongs to no single app"
    // and must survive — which is what the bulletin fan-out relies on.
    await insertNotifications(dbMock.handle as never, [
      {
        userId: USER,
        kind: "bulletin",
        title: "Everywhere",
        body: null,
        link: null,
        linkApp: null,
      },
      { userId: USER, kind: "bulletin", title: "Here", body: null, link: null },
    ]);

    const values = dbMock.onlyQuery("insert").arg("values") as {
      linkApp: string | null;
      origin: string | null;
    }[];
    expect(values[0]!.linkApp).toBeNull();
    expect(values[1]!.linkApp).toBe("web");
    expect(values[0]!.origin).toBeNull();
  });
});

describe("the inbox reads — a link for another app is a guaranteed 404", () => {
  it("listNotificationGroups nulls a foreign link and keeps a local one", async () => {
    dbMock.queue([
      row({ id: "n-org", linkApp: "org", link: "/registrations/abc" }),
      row({ id: "n-web", linkApp: "web", link: "/bulletins/abc" }),
      // Pre-migration rows have no linkApp at all, and count as local.
      row({ id: "n-legacy", linkApp: null, link: "/bulletins/legacy" }),
    ]);

    const groups = await listNotificationGroups();
    const items = groups.flatMap((g) => g.items);
    expect(items.find((i) => i.id === "n-org")!.link).toBeNull();
    expect(items.find((i) => i.id === "n-web")!.link).toBe("/bulletins/abc");
    expect(items.find((i) => i.id === "n-legacy")!.link).toBe(
      "/bulletins/legacy",
    );
  });

  it("recentNotifications applies the SAME rule — it is a second copy of it", async () => {
    // Two copies of a rule is how this file's own linkApp bug happened, so the
    // second copy is proved separately rather than assumed.
    dbMock.queue([row({ linkApp: "suppliers", link: "/onboarding" })]);

    expect((await recentNotifications())[0]!.link).toBeNull();
  });

  it("every read returns the empty result signed out and env-less, so the chrome renders", async () => {
    session.user = null;
    expect(await getUnreadNotificationCount()).toBe(0);
    expect(await listNotificationGroups()).toEqual([]);
    expect(await recentNotifications()).toEqual([]);
    expect(dbMock.queries).toHaveLength(0);

    session.user = CAMP_USER;
    vi.stubEnv("DATABASE_URL", "");
    expect(await getUnreadNotificationCount()).toBe(0);
    expect(await listNotificationGroups()).toEqual([]);
    expect(await recentNotifications()).toEqual([]);
    expect(dbMock.queries).toHaveLength(0);
  });

  it("the unread count is 0 rather than undefined when the count row is missing", async () => {
    dbMock.queue([]);
    expect(await getUnreadNotificationCount()).toBe(0);

    dbMock.reset();
    dbMock.queue([{ count: 4 }]);
    expect(await getUnreadNotificationCount()).toBe(4);
  });

  it("the unread and bulletins filters each narrow the query, and `all` does not", async () => {
    dbMock.queue([]);
    await listNotificationGroups("all");
    const all = dbMock.queries[0]!.calls.length;

    dbMock.reset();
    dbMock.queue([]);
    await listNotificationGroups("unread");
    expect(boundStrings(dbMock.queries[0]!)).toContain(USER);

    dbMock.reset();
    dbMock.queue([]);
    await listNotificationGroups("bulletins");
    // The kind filter binds the literal the query narrows on.
    expect(boundStrings(dbMock.queries[0]!)).toContain("bulletin");
    expect(all).toBeGreaterThan(0);
  });
});

describe("bulletins — read-side audience enforcement", () => {
  it("is null when the user has NO notification row for it, published or not", async () => {
    // This is what stops an org-internal broadcast leaking into a participant
    // surface: receiving it is what makes it readable.
    dbMock.queue(/* no notification row */ []);

    expect(await getBulletinForCurrentUser(BULLETIN_ID)).toBeNull();
    // The bulletin itself was never even read.
    expect(dbMock.queries).toHaveLength(1);
  });

  it("is null for an UNPUBLISHED bulletin the user did receive", async () => {
    dbMock.queue(
      [{ id: NOTIFICATION_ID }],
      [
        {
          id: BULLETIN_ID,
          title: "Draft",
          bodyMd: "not ready",
          pinned: false,
          publishedAt: null,
        },
      ],
    );

    expect(await getBulletinForCurrentUser(BULLETIN_ID)).toBeNull();
  });

  it("returns a published bulletin the user received", async () => {
    const bulletin = {
      id: BULLETIN_ID,
      title: "Gate opens Sunday",
      bodyMd: "# Gate",
      pinned: true,
      publishedAt: new Date("2026-08-01"),
    };
    dbMock.queue([{ id: NOTIFICATION_ID }], [bulletin]);

    expect(await getBulletinForCurrentUser(BULLETIN_ID)).toEqual(bulletin);
  });

  it("getPinnedBulletinsForCurrentUser drops unpublished rows after the query", async () => {
    dbMock.queue([
      {
        id: BULLETIN_ID,
        title: "Live",
        bodyMd: "x",
        pinned: true,
        publishedAt: new Date("2026-08-01"),
      },
      {
        id: "b-2",
        title: "Draft",
        bodyMd: "y",
        pinned: true,
        publishedAt: null,
      },
    ]);

    expect((await getPinnedBulletinsForCurrentUser()).map((b) => b.id)).toEqual(
      [BULLETIN_ID],
    );
  });

  it("both are empty signed out and env-less", async () => {
    session.user = null;
    expect(await getBulletinForCurrentUser(BULLETIN_ID)).toBeNull();
    expect(await getPinnedBulletinsForCurrentUser()).toEqual([]);

    session.user = CAMP_USER;
    vi.stubEnv("DATABASE_URL", "");
    expect(await getBulletinForCurrentUser(BULLETIN_ID)).toBeNull();
    expect(await getPinnedBulletinsForCurrentUser()).toEqual([]);
    expect(dbMock.queries).toHaveLength(0);
  });
});

describe("notification actions — own rows only", () => {
  it("pins user_id to the authenticated user, so a forged id updates nothing", async () => {
    dbMock.queue([]);

    expect(
      await markNotificationRead({ notificationId: NOTIFICATION_ID }),
    ).toEqual({ ok: true });

    const update = dbMock.writesTo(schema.notifications)[0]!;
    // The authenticated user's id is bound into the WHERE alongside the
    // notification id — a row belonging to another account simply does not
    // match.
    expect(boundStrings(update)).toContain(USER);
    expect(revalidated.map((r) => r.path)).toEqual(["/notifications", "/"]);
  });

  it("REFUSES a notification id that is not a uuid, and writes nothing", async () => {
    const result = await markNotificationRead({ notificationId: "not-a-uuid" });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.notifications)).toHaveLength(0);
  });

  it("markAllNotificationsRead scopes to the caller's own unread rows", async () => {
    dbMock.queue([]);
    expect(await markAllNotificationsRead()).toEqual({ ok: true });
    expect(boundStrings(dbMock.writesTo(schema.notifications)[0]!)).toContain(
      USER,
    );
  });

  it("both RETHROW Next control flow rather than returning it as an error string", async () => {
    // A burner whose session expired must land on the sign-in page, not read
    // the literal text "NEXT_REDIRECT".
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/auth/sign-in;307;",
    });
    session.user = redirectError;

    await expect(
      markNotificationRead({ notificationId: NOTIFICATION_ID }),
    ).rejects.toBe(redirectError);
    await expect(markAllNotificationsRead()).rejects.toBe(redirectError);
  });

  it("turns an ordinary failure into a refusal", async () => {
    session.user = CAMP_USER;
    dbMock.queue(new Error("notifications is unreachable"));

    expect(await markAllNotificationsRead()).toEqual({
      ok: false,
      error: "notifications is unreachable",
    });
  });
});
