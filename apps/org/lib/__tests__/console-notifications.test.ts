import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { fakeDb, type FakeDb } from "./support/fake-db";

/**
 * THE CONSOLE INBOX. `insertNotifications` is the fan-out every broadcast in
 * this app depends on — a silent no-op here is a bulletin nobody receives — and
 * the read-marking actions are the only place in the console where a user id
 * SCOPES A WRITE. An unscoped update would let any staffer clear another's
 * inbox.
 */

import type * as QuaggaDb from "@quagga/db";

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const resolveOrgSession = vi.fn();
const requireOrgSession = vi.fn();
vi.mock("@/lib/session", () => ({
  resolveOrgSession: () => resolveOrgSession(),
  requireOrgSession: (options?: unknown) => requireOrgSession(options),
}));

import { getDb } from "@/lib/db";
import {
  getUnreadNotificationCount,
  insertNotifications,
  listNotificationGroups,
  recentNotifications,
} from "@/lib/notifications";
import {
  fetchRecentNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/actions/notifications";

const ENV = { ...process.env };
const NOTIFICATION_ID = "18181818-1818-4818-8818-181818181818";

const ROW = {
  id: NOTIFICATION_ID,
  kind: "bulletin" as const,
  title: "Gate opens Sunday",
  body: "Bring water.",
  link: "/bulletins/1",
  linkApp: "org" as const,
  bulletinId: "bul-1",
  createdAt: new Date("2026-11-01T09:00:00Z"),
  readAt: null,
};

beforeEach(() => {
  db = fakeDb();
  process.env.DATABASE_URL = "postgres://localhost/quagga";
  resolveOrgSession.mockReset();
  requireOrgSession.mockReset();
  resolveOrgSession.mockResolvedValue({ kind: "ok", dbUserId: "user-1" });
  requireOrgSession.mockResolvedValue({ dbUserId: "user-1" });
});

afterEach(() => {
  process.env = { ...ENV };
});

describe("getUnreadNotificationCount", () => {
  it("is 0 env-lessly, without touching the database", async () => {
    delete process.env.DATABASE_URL;
    await expect(getUnreadNotificationCount("user-1")).resolves.toBe(0);
    expect(db.calls).toEqual([]);
  });

  it("is 0 for a caller who has not cleared the gate", async () => {
    resolveOrgSession.mockResolvedValue({ kind: "forbidden" });
    await expect(getUnreadNotificationCount()).resolves.toBe(0);
    expect(db.calls).toEqual([]);
  });

  it("uses the id it was handed rather than re-resolving the session", async () => {
    // The header already holds the session; resolving it again per bell render
    // was the whole upsert + bootstrap + membership lookup, twice a page.
    db.seed("notifications", [{ count: 4 }]);

    await expect(getUnreadNotificationCount("user-1")).resolves.toBe(4);
    expect(resolveOrgSession).not.toHaveBeenCalled();
  });

  it("falls back to resolving the session when none was passed", async () => {
    db.seed("notifications", [{ count: 2 }]);
    await expect(getUnreadNotificationCount()).resolves.toBe(2);
    expect(resolveOrgSession).toHaveBeenCalled();
  });

  it("is 0 rather than undefined when the aggregate returns nothing", async () => {
    db.seed("notifications", []);
    await expect(getUnreadNotificationCount("user-1")).resolves.toBe(0);
  });
});

describe("listNotificationGroups / recentNotifications", () => {
  it("returns nothing env-lessly rather than crashing the chrome", async () => {
    delete process.env.DATABASE_URL;
    await expect(listNotificationGroups("user-1")).resolves.toEqual([]);
    await expect(recentNotifications("user-1")).resolves.toEqual([]);
  });

  it("groups the inbox by day", async () => {
    db.seed("notifications", [ROW]);
    const groups = await listNotificationGroups("user-1");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items[0]).toMatchObject({
      id: NOTIFICATION_ID,
      title: "Gate opens Sunday",
      link: "/bulletins/1",
    });
  });

  it("UNLINKS a row minted for another app", async () => {
    // A link minted for the participant app is a path this one cannot serve.
    // Rendering the row unlinked is better than a guaranteed 404.
    db.seed("notifications", [{ ...ROW, linkApp: "web" }]);
    const [row] = await recentNotifications("user-1");
    expect(row?.link).toBeNull();
    expect(row?.title).toBe("Gate opens Sunday");
  });

  it("treats a NULL linkApp as local — every pre-migration row", async () => {
    db.seed("notifications", [{ ...ROW, linkApp: null }]);
    const [row] = await recentNotifications("user-1");
    expect(row?.link).toBe("/bulletins/1");
  });

  it("narrows to unread and to bulletins when asked", async () => {
    db.seed("notifications", [ROW]);
    await listNotificationGroups("user-1", "unread");
    await listNotificationGroups("user-1", "bulletins");
    // Both filters are applied in the query rather than after the fetch, so the
    // 200-row cap counts the rows the user asked for.
    for (const call of db.recorded("select", "notifications")) {
      expect(call.methods).toContain("where");
    }
  });

  it("honours the panel's row limit", async () => {
    db.seed("notifications", [ROW]);
    await recentNotifications("user-1", 3);
    expect(db.recorded("select", "notifications")[0]?.methods).toContain(
      "limit",
    );
  });
});

describe("insertNotifications", () => {
  it("writes NOTHING for an empty recipient list", async () => {
    await insertNotifications(getDb(), []);
    expect(db.calls).toEqual([]);
  });

  it("writes ONE ROW PER RECIPIENT", async () => {
    // A silent no-op here is a bulletin nobody receives — and nothing else in
    // the system would report it.
    await insertNotifications(getDb(), [
      {
        userId: "user-1",
        kind: "bulletin",
        title: "Gate opens Sunday",
        body: null,
        link: null,
      },
      {
        userId: "user-2",
        kind: "bulletin",
        title: "Gate opens Sunday",
        body: null,
        link: null,
      },
    ]);

    const rows = db.inserted("notifications") as { userId: string }[];
    expect(rows.map((r) => r.userId)).toEqual(["user-1", "user-2"]);
  });

  it("defaults the optional columns rather than dropping them from the INSERT", async () => {
    await insertNotifications(getDb(), [
      {
        userId: "user-1",
        kind: "security",
        title: "Hello",
        body: null,
        link: null,
      },
    ]);

    const [row] = db.inserted("notifications") as Record<string, unknown>[];
    expect(row).toMatchObject({
      body: null,
      link: null,
      origin: null,
      bulletinId: null,
      // `undefined` means "the caller did not say" and defaults to THIS app.
      linkApp: "org",
    });
  });

  it("keeps an EXPLICIT null linkApp, which the bulletin fan-out relies on", async () => {
    // One rule, in @quagga/core: `undefined` is "unspecified", an explicit null
    // is "belongs to no single app" and must survive. A bulletin reaches
    // suppliers and burners at once, and null is the only value right for both.
    await insertNotifications(getDb(), [
      {
        userId: "user-1",
        kind: "bulletin",
        title: "Hello",
        body: null,
        link: null,
        linkApp: null,
      },
    ]);
    const [row] = db.inserted("notifications") as Record<string, unknown>[];
    expect(row?.linkApp).toBeNull();
  });

  it("CHUNKS a fan-out larger than the parameter ceiling", async () => {
    // Six bound parameters per row against Postgres' 65535-parameter ceiling
    // means one insert dies at 10923 rows with SQLSTATE 08P01 — and because a
    // bulletin publish wraps this in a transaction, the whole broadcast rolled
    // back. AfrikaBurn is comfortably bigger than 10922 people.
    const rows = Array.from({ length: 2500 }, (_, i) => ({
      userId: `user-${i}`,
      kind: "bulletin" as const,
      title: "Gate opens Sunday",
      body: null,
      link: null,
    }));

    await insertNotifications(getDb(), rows);

    const writes = db.recorded("insert", "notifications");
    expect(writes).toHaveLength(3); // 1000 + 1000 + 500
    const total = writes.reduce(
      (sum, w) => sum + (w.values as unknown[]).length,
      0,
    );
    expect(total).toBe(2500);
  });
});

describe("marking read — own inbox only", () => {
  it("SCOPES the single-row update to the caller's own user id", async () => {
    // A notification id belonging to somebody else must not be markable, and
    // the id is the only thing the client supplies.
    const result = await markNotificationRead({
      notificationId: NOTIFICATION_ID,
    });

    expect(result).toEqual({ ok: true });
    // The session is required with NO capability: every rank manages their own
    // notifications, and needing one would be a lockout dressed as a guard.
    expect(requireOrgSession).toHaveBeenCalledWith(undefined);
    const [update] = db.recorded("update", "notifications");
    expect(update?.values).toMatchObject({ readAt: expect.any(Date) });
    expect(update?.methods).toContain("where");
  });

  it("rejects a malformed notification id before writing", async () => {
    const result = await markNotificationRead({ notificationId: "nope" });
    expect(result.ok).toBe(false);
    expect(db.recorded("update", "notifications")).toHaveLength(0);
  });

  it("refuses when the session is gone rather than writing unscoped", async () => {
    requireOrgSession.mockRejectedValue(new Error("Not authorised."));
    await expect(markAllNotificationsRead()).resolves.toEqual({
      ok: false,
      error: "Not authorised.",
    });
    expect(db.recorded("update", "notifications")).toHaveLength(0);
  });

  it("marks the whole inbox read, still scoped to the caller", async () => {
    await expect(markAllNotificationsRead()).resolves.toEqual({ ok: true });
    const [update] = db.recorded("update", "notifications");
    expect(update?.methods).toContain("where");
  });
});

describe("fetchRecentNotifications", () => {
  it("returns an empty list for a caller who has not cleared the gate", async () => {
    // The panel degrades to an empty state rather than erroring the chrome.
    resolveOrgSession.mockResolvedValue({ kind: "unauthenticated" });
    await expect(fetchRecentNotifications()).resolves.toEqual([]);
    expect(db.calls).toEqual([]);
  });

  it("projects the display strings server-side, including the read flag", async () => {
    db.seed("notifications", [
      { ...ROW, readAt: new Date("2026-11-01T10:00:00Z") },
    ]);

    const [row] = await fetchRecentNotifications();

    expect(row).toMatchObject({
      id: NOTIFICATION_ID,
      title: "Gate opens Sunday",
      link: "/bulletins/1",
      read: true,
    });
    expect(typeof row?.timeAgo).toBe("string");
    expect(row?.source).toBeTruthy();
  });
});
