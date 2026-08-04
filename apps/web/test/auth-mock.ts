// A stand-in for @quagga/auth. Importing the real package constructs
// `betterAuth()` at module load, which wants a database and a signing secret,
// so anything that reaches for a session gets this instead.
//
// Same lazily-imported-factory shape as the other helpers:
//
//   vi.mock("@quagga/auth", async () => (await import("@/test/auth-mock")).authModuleMock());
//   beforeEach(() => authMock.reset());

export interface FakeSessionUser {
  id: string;
  email?: string | null;
  name?: string | null;
  emailVerified?: boolean | null;
}

class AuthMock {
  /** What `auth.api.getSession` answers. `null` is signed out. */
  session: { user: FakeSessionUser } | null = null;
  /** When set, `getSession` throws it — the provider being down. */
  sessionError: Error | null = null;
  /** Every `auth.api.*` call, so a test can assert a provider call was NOT
   * made (the "refuse before calling the provider" rule). */
  calls: Array<{ method: string; body: unknown }> = [];
  /** Queued outcomes for `changePassword` / `requestPasswordReset` etc. An
   * `Error` is thrown, anything else returned. */
  apiResults = new Map<string, unknown>();

  signedInAs(user: FakeSessionUser): void {
    this.session = { user };
  }

  reset(): void {
    this.session = null;
    this.sessionError = null;
    this.calls = [];
    this.apiResults = new Map();
  }
}

export const authMock = new AuthMock();

function apiMethod(name: string) {
  return async (body?: unknown) => {
    authMock.calls.push({ method: name, body });
    const result = authMock.apiResults.get(name);
    if (result instanceof Error) throw result;
    return result ?? {};
  };
}

export function authModuleMock(): Record<string, unknown> {
  return {
    auth: {
      api: new Proxy(
        {},
        {
          get(_target, prop) {
            if (typeof prop === "symbol") return undefined;
            if (prop === "getSession") {
              return async (body?: unknown) => {
                authMock.calls.push({ method: "getSession", body });
                if (authMock.sessionError) throw authMock.sessionError;
                return authMock.session;
              };
            }
            return apiMethod(prop);
          },
        },
      ),
    },
    // The real one marks the async context so @quagga/auth's sign-in hook knows
    // the session it is about to mint is a password CHECK, not a sign-in — and
    // therefore must not cancel a pending deletion. Nothing here depends on the
    // AsyncLocalStorage, only on the callback running.
    withReauth: async (fn: () => Promise<unknown>) => fn(),
  };
}
