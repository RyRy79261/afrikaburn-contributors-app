// Stand-ins for the Next.js request-scoped APIs.
//
// MEASURED, NOT ASSUMED: `after()` from next/server and `cookies()`/`headers()`
// from next/headers both throw "was called outside a request scope" under
// vitest, so any lib module that touches one has to be given a replacement.
// React's `cache()` is fine — it is callable outside a request and, usefully,
// does NOT memoize there, so a `cache()`-wrapped function like `getActiveEdition`
// cannot leak state from one test into the next.
//
// The same hoisting problem as db-mock.ts applies, so these are singletons a
// test file reaches through a lazily-imported factory:
//
//   vi.mock("next/server", async () => (await import("@/test/next-mocks")).nextServerMock());
//   beforeEach(() => resetNextMocks());

type AfterTask = () => unknown | Promise<unknown>;

/** Callbacks handed to `after()`, in the order they were scheduled. */
export const afterTasks: AfterTask[] = [];

/** Run everything `after()` deferred. Real `after()` runs the task once the
 * response is sent, so a test that cares about the audit row has to say when
 * that happens — and a test that does NOT flush proves the read never waited
 * on it. Errors thrown inside a task are swallowed here exactly as the runtime
 * swallows them, so a failing audit write cannot fail the test that read. */
export async function flushAfterTasks(): Promise<void> {
  const tasks = afterTasks.splice(0, afterTasks.length);
  for (const task of tasks) {
    try {
      await task();
    } catch {
      /* the runtime does not propagate these either */
    }
  }
}

export function nextServerMock(): Record<string, unknown> {
  return {
    after: (task: AfterTask) => {
      afterTasks.push(task);
    },
  };
}

export interface FakeCookie {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

class FakeCookieJar {
  private store = new Map<string, FakeCookie>();
  /** Set true to model a Server Component render, where `set`/`delete` throw. */
  readOnly = false;

  get(name: string): FakeCookie | undefined {
    return this.store.get(name);
  }

  set(name: string, value: string, options?: Record<string, unknown>): void {
    if (this.readOnly) {
      throw new Error("Cookies can only be modified in a Server Action.");
    }
    this.store.set(name, { name, value, options });
  }

  delete(name: string): void {
    if (this.readOnly) {
      throw new Error("Cookies can only be modified in a Server Action.");
    }
    this.store.delete(name);
  }

  /** Test-side view of what is in the jar. */
  entries(): FakeCookie[] {
    return [...this.store.values()];
  }

  seed(name: string, value: string): void {
    this.store.set(name, { name, value });
  }

  clear(): void {
    this.store.clear();
    this.readOnly = false;
  }
}

export const cookieJar = new FakeCookieJar();

/** Paths passed to `revalidatePath`, with the optional type argument. */
export const revalidated: Array<{ path: string; type?: string }> = [];

export function nextHeadersMock(): Record<string, unknown> {
  return {
    cookies: async () => cookieJar,
    headers: async () => new Headers(),
  };
}

export function nextCacheMock(): Record<string, unknown> {
  return {
    revalidatePath: (path: string, type?: string) => {
      revalidated.push({ path, type });
    },
    revalidateTag: () => undefined,
  };
}

/**
 * Where a call redirected to. `redirect()` is real here — it throws an error
 * carrying a `NEXT_REDIRECT;<kind>;<path>;<status>;` digest, and asserting only
 * "it threw" would pass for a TypeError just as happily, so the destination is
 * dug out and returned for the test to assert on.
 */
export async function redirectTarget(
  promise: Promise<unknown>,
): Promise<string> {
  const error = await promise.then(
    () => null,
    (err: unknown) => err,
  );
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT;")) {
    throw new Error(
      `expected a redirect, got ${error === null ? "no error" : String(error)}`,
    );
  }
  return digest.split(";")[2] ?? "";
}

export function resetNextMocks(): void {
  afterTasks.length = 0;
  revalidated.length = 0;
  cookieJar.clear();
}
