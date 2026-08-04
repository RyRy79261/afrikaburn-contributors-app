import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The mapper every guard in this app sits on (lib/auth.ts).
//
// `emailVerified` is compared against a LITERAL `true` precisely so a truthy
// non-boolean from the provider — `1`, `"true"`, a Date — cannot be read as
// verified. lib/session.ts's email-overlap claim refuses to write
// `suppliers.user_id` unless that flag is true, so a loosening here silently
// re-opens the listing takeover that guard exists to close.

const getSession = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: "session=abc" }),
}));
vi.mock("@quagga/auth", () => ({ auth: { api: { getSession } } }));

const { getAuthenticatedUser } = await import("@/lib/auth");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getAuthenticatedUser", () => {
  it("returns null when auth is unconfigured, without attempting a session read", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");

    expect(await getAuthenticatedUser()).toBeNull();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("returns null when the session read throws, so the portal still renders", async () => {
    // Hard engineering rule 4. An unreachable auth server must degrade to
    // signed-out, not crash every page in the app at once.
    getSession.mockRejectedValue(new Error("auth server unreachable"));

    expect(await getAuthenticatedUser()).toBeNull();
  });

  it("returns null for a session whose user carries no id", async () => {
    getSession.mockResolvedValue({ user: { email: "alice@example.com" } });

    expect(await getAuthenticatedUser()).toBeNull();
  });

  it("returns null for no session at all", async () => {
    getSession.mockResolvedValue(null);

    expect(await getAuthenticatedUser()).toBeNull();
  });

  it("maps a missing email and name to null, never undefined", async () => {
    // `undefined` and `null` read the same in a template but not in a
    // comparison: `dbUser.email !== user.primaryEmail` in session.ts would fire
    // an email re-sync on every request for an account with no address.
    getSession.mockResolvedValue({ user: { id: "auth-alice" } });

    expect(await getAuthenticatedUser()).toEqual({
      id: "auth-alice",
      primaryEmail: null,
      displayName: null,
      emailVerified: false,
    });
  });

  it("treats emailVerified as true ONLY for a literal true", async () => {
    // Anything else — including values a provider might plausibly send for
    // "verified at this time" — must read as unverified. The claim in
    // lib/session.ts hands over a whole business on this one boolean.
    for (const value of [1, "true", "yes", new Date(), {}]) {
      getSession.mockResolvedValue({
        user: { id: "auth-alice", emailVerified: value },
      });

      const user = await getAuthenticatedUser();

      expect(user?.emailVerified).toBe(false);
    }

    getSession.mockResolvedValue({
      user: { id: "auth-alice", emailVerified: true },
    });
    expect((await getAuthenticatedUser())?.emailVerified).toBe(true);
  });

  it("carries the provider's identity through unchanged", async () => {
    getSession.mockResolvedValue({
      user: {
        id: "auth-alice",
        email: "alice@example.com",
        name: "Alice Hatter",
        emailVerified: true,
      },
    });

    expect(await getAuthenticatedUser()).toEqual({
      id: "auth-alice",
      primaryEmail: "alice@example.com",
      displayName: "Alice Hatter",
      emailVerified: true,
    });
  });

  it("passes this request's headers to the session read", async () => {
    getSession.mockResolvedValue({ user: { id: "auth-alice" } });

    await getAuthenticatedUser();

    expect(getSession).toHaveBeenCalledWith({ headers: expect.any(Headers) });
  });
});
