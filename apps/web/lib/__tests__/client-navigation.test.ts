// REGRESSION: `navigateOnwards` must not push/refresh on the caller's tick.
//
// Every caller reaches it from inside `startTransition(async () => …)` — the
// save runs in the transition and the navigation is what follows a successful
// save. Called synchronously from in there, the transition is left awaiting a
// navigation that the same-tick `refresh()` supersedes, so it never settles and
// `isPending` stays true for good: a Submit button stuck on "Saving…" on
// something that HAS been saved, and no redirect. On the blocking questionnaire
// gate that meant being held on a gate already cleared, with nothing to click.
//
// This pins the deferral at the one seam that all four call sites share
// (questionnaire runner, bio flow, auth form, invite resume). The first fix
// deferred it at ONE call site and left the identical dead end live in the
// profile bio editor — which is the failure mode this test exists to prevent.
import { describe, it, expect, vi } from "vitest";
import { navigateOnwards } from "../client-navigation";

function fakeRouter() {
  const calls: string[] = [];
  return {
    calls,
    router: {
      push: (href: string) => calls.push(`push:${href}`),
      refresh: () => calls.push("refresh"),
    },
  };
}

describe("navigateOnwards", () => {
  it("does not touch the router on the calling tick", () => {
    vi.useFakeTimers();
    const { router, calls } = fakeRouter();
    navigateOnwards(router, "/directory");
    expect(calls).toEqual([]); // the transition must be free to settle first
    vi.runAllTimers();
    expect(calls).toEqual(["push:/directory", "refresh"]);
    vi.useRealTimers();
  });

  it("keeps the refresh — it is what re-renders the shell above the route", () => {
    vi.useFakeTimers();
    const { router, calls } = fakeRouter();
    navigateOnwards(router, "/profile");
    vi.runAllTimers();
    // Dropping the refresh also "fixes" the hang, and would break the gate
    // clearing: AppShell reads `viewerIsGated()` in the layout, and only a
    // refresh re-renders it, so the nav would stay stripped after the gate goes.
    expect(calls).toContain("refresh");
    vi.useRealTimers();
  });
});
