import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as DbModule from "@/lib/db";
import type * as AuthAccount from "@quagga/auth/account";
import { installFakeDb, type FakeDb } from "@/test/fakes/db";
import type { AuthenticatedUser } from "@/lib/auth";

// The portal's ACCOUNT surface (lib/account.ts) — everything a supplier needs
// to look after their own sign-in, as opposed to their business's onboarding.
//
// THE GUARD HERE IS DELIBERATELY NOT `resolveSupplierSession`, AND THAT IS THE
// POINT THE FILE'S OWN HEADER SPENDS FIFTEEN LINES ON. The portal gate asks a
// question about a BUSINESS: has this email claimed a supplier listing? That is
// the right question for onboarding, documents and standing — and the wrong one
// for a password. `unlinked` is an ordinary state in this app, and somebody
// sitting on the "register your business" screen may still be holding a stolen
// session. It must not mean "you may not secure your account".
//
// If a later change "tidies" this to reuse the portal gate, nothing else in the
// suite would fail. This is what fails.

const shared = {
  resolveAccountUser: vi.fn(),
  listAccountSessions: vi.fn(async () => []),
  listAccountPasskeys: vi.fn(async () => []),
  listLinkedAccounts: vi.fn(async () => []),
};
const cookieStore = { set: vi.fn() };

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-request-id": "req-1" }),
  cookies: async () => cookieStore,
}));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@quagga/auth/account", async () => {
  // `parseSetCookies` stays REAL — it is the thing `applyAuthCookies` is a
  // wrapper around, and mocking it would leave the wrapper asserting itself.
  const actual =
    await vi.importActual<typeof AuthAccount>("@quagga/auth/account");
  return { ...actual, ...shared };
});
vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof DbModule>("@/lib/db");
  const { fakeDb: current } = await import("@/test/fakes/db");
  return { ...actual, getDb: () => current().handle };
});

const { getAuthenticatedUser } = await import("@/lib/auth");
const {
  resolvePortalAccount,
  requirePortalAccount,
  listAccountSessions,
  listAccountPasskeys,
  listLinkedAccounts,
  getClaimedSupplier,
  applyAuthCookies,
} = await import("@/lib/account");

const SIGNED_IN: AuthenticatedUser = {
  id: "auth-alice",
  primaryEmail: "alice@example.com",
  displayName: "Alice Hatter",
  emailVerified: true,
};
const ACCOUNT = {
  id: "user-alice",
  authUserId: "auth-alice",
  email: "alice@example.com",
};

let db: FakeDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = installFakeDb();
  vi.stubEnv("DATABASE_URL", "postgres://stub/does-not-connect");
  vi.mocked(getAuthenticatedUser).mockResolvedValue(SIGNED_IN);
  shared.resolveAccountUser.mockResolvedValue(ACCOUNT);
});

describe("resolvePortalAccount", () => {
  it("returns null with no signed-in identity, and does not consult the account tables", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect(await resolvePortalAccount()).toBeNull();
    expect(shared.resolveAccountUser).not.toHaveBeenCalled();
  });

  it("resolves an account with NO supplier listing — the unlinked-can-still-secure rule", async () => {
    // The regression this pins: requiring a claimed listing here would lock a
    // supplier out of their own password at exactly the moment they need it.
    const account = await resolvePortalAccount();

    expect(account).toEqual(ACCOUNT);
    // Not one query against the supplier tables — the question is about the
    // ACCOUNT, and asking a business question would be the bug.
    expect(db.against("suppliers")).toEqual([]);
    expect(shared.resolveAccountUser).toHaveBeenCalledWith(
      "auth-alice",
      "alice@example.com",
    );
  });
});

describe("requirePortalAccount", () => {
  it("throws a caller-safe error rather than returning null", async () => {
    // Server actions surface this message verbatim.
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    await expect(requirePortalAccount()).rejects.toThrow(
      "Sign in to manage your account.",
    );
  });

  it("hands back the resolved account when there is one", async () => {
    expect(await requirePortalAccount()).toEqual(ACCOUNT);
  });
});

describe("the security-page list helpers", () => {
  it("pass THIS request's headers through to the shared auth helpers", async () => {
    // @quagga/auth deliberately does not import `next/headers` — it is also
    // used by scripts with no request — so each app passes its own. Passing the
    // wrong request's headers would show one person another's sessions.
    await listAccountSessions();
    await listAccountPasskeys();
    await listLinkedAccounts();

    for (const fn of [
      shared.listAccountSessions,
      shared.listAccountPasskeys,
      shared.listLinkedAccounts,
    ]) {
      expect(fn).toHaveBeenCalledTimes(1);
      const [headers] = fn.mock.calls[0]! as unknown as [Headers];
      expect(headers.get("x-request-id")).toBe("req-1");
    }
  });
});

describe("getClaimedSupplier", () => {
  it("returns the listing this account has claimed", async () => {
    // The Delete tab states what deletion RELEASES: the listing goes back to
    // unclaimed, and the next verified email matching its contact line takes it.
    db.rows("suppliers", [
      { id: "sup-1", name: "Karoo Tents", contact: "alice@example.com" },
    ]);

    expect(await getClaimedSupplier("user-alice")).toEqual({
      id: "sup-1",
      name: "Karoo Tents",
      contact: "alice@example.com",
    });
    expect(db.queries[0]!.sql).toContain('"suppliers"."user_id" = ');
    expect(db.queries[0]!.params).toContain("user-alice");
  });

  it("returns null when this account has claimed nothing", async () => {
    db.rows("suppliers", []);

    expect(await getClaimedSupplier("user-alice")).toBeNull();
  });

  it("returns null on a failed read, so the Delete tab degrades rather than breaking", async () => {
    db.failEverything = new Error("connection reset by peer");

    expect(await getClaimedSupplier("user-alice")).toBeNull();
  });
});

describe("applyAuthCookies", () => {
  it("sets every cookie parsed out of the response headers", async () => {
    // Calling `auth.api.*` from a server action bypasses the /api/auth route
    // handler, so these headers are handed to US and then dropped. For
    // `changePassword` — which deletes every session including the caller's —
    // dropping them signs the person out five minutes later with no explanation.
    const responseHeaders = new Headers();
    responseHeaders.append(
      "set-cookie",
      "quagga.session_token=abc; Path=/; HttpOnly; SameSite=Lax",
    );
    responseHeaders.append("set-cookie", "quagga.session_data=xyz; Path=/; Max-Age=300");

    await applyAuthCookies(responseHeaders);

    expect(cookieStore.set).toHaveBeenCalledTimes(2);
    expect(cookieStore.set).toHaveBeenNthCalledWith(
      1,
      "quagga.session_token",
      "abc",
      expect.objectContaining({ path: "/", httpOnly: true, sameSite: "lax" }),
    );
    expect(cookieStore.set).toHaveBeenNthCalledWith(
      2,
      "quagga.session_data",
      "xyz",
      expect.objectContaining({ maxAge: 300 }),
    );
  });

  it("swallows a read-only cookie store", async () => {
    // The password has ALREADY changed by the time this runs. A failure here
    // must not turn a completed security change into a reported failure; the
    // worst case without it is the pre-existing behaviour.
    cookieStore.set.mockImplementation(() => {
      throw new Error("Cookies can only be modified in a Server Action");
    });
    const responseHeaders = new Headers();
    responseHeaders.append("set-cookie", "quagga.session_token=abc; Path=/");

    await expect(applyAuthCookies(responseHeaders)).resolves.toBeUndefined();
  });

  it("does nothing at all when the response carried no cookies", async () => {
    await applyAuthCookies(new Headers());

    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});
