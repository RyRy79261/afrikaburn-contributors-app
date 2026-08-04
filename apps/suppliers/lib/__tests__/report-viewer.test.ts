import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupplierSessionState } from "@/lib/session";

// Who may file an in-app report from the supplier portal (lib/report-viewer.ts).
//
// THE DELIBERATE RULE IS THAT `unlinked` COUNTS. A supplier whose account did
// not match a company row sees only the registration form, and "the portal
// doesn't recognise me" is exactly the report worth having — not one to lock
// out. Tightening this to require an `ok` session would silence the reports that
// matter most, and nothing else in the suite would fail.
//
// The id is our `users.id` where the session resolved one, and the auth
// provider's id otherwise. Neither is published: it is the rate-limit key and
// the audit line, and an in-app report carries no reporter identity by design.

vi.mock("@/lib/session", () => ({ resolveSupplierSession: vi.fn() }));

const { resolveSupplierSession } = await import("@/lib/session");
const { reportViewer } = await import("@/lib/report-viewer");

const USER = {
  id: "auth-alice",
  primaryEmail: "alice@example.com",
  displayName: "Alice Hatter",
  emailVerified: true,
};

function inState(state: SupplierSessionState) {
  vi.mocked(resolveSupplierSession).mockResolvedValue(state);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reportViewer", () => {
  it("refuses an unauthenticated caller", async () => {
    inState({ kind: "unauthenticated" });

    expect(await reportViewer()).toBeNull();
  });

  it("reports an ok session under OUR users.id", async () => {
    inState({
      kind: "ok",
      user: USER,
      dbUserId: "user-alice",
      supplier: { id: "sup-1" },
      edition: { id: "ed-2027", name: "AfrikaBurn 2027", year: 2027 },
      steps: {},
      progress: { completed: 0, total: 7 },
    } as unknown as SupplierSessionState);

    expect(await reportViewer()).toEqual({ id: "user-alice" });
  });

  it("ALLOWS an unlinked session, and reports under our users.id", async () => {
    // The load-bearing case. This person can see nothing but the registration
    // form, which is the single most likely thing to be wrong for them.
    inState({ kind: "unlinked", user: USER, dbUserId: "user-alice" });

    expect(await reportViewer()).toEqual({ id: "user-alice" });
  });

  it("reports a not_ready session under the auth provider's id", async () => {
    // No `users` row resolved (no database, or the read failed), so there is no
    // internal id to use — and being unable to report because the database is
    // down is the worst possible time to be unable to report.
    inState({ kind: "not_ready", user: USER });

    expect(await reportViewer()).toEqual({ id: "auth-alice" });
  });
});
