import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import {
  AccountSessions,
  type SessionActionResult,
  type SessionView,
} from "../account-sessions";
import { Toaster, toast } from "../toast";

// This is the surface a person uses to answer one question: "do I recognise
// this device?". Two deliberate honesty decisions live here and both fail
// silently if they break —
//
//   1. We show the IP, never an invented city. A wrong city defeats the whole
//      point of the list.
//   2. "Sign out everywhere else" keeps THIS device signed in. Signing yourself
//      out while securing your account is a hostile outcome.
//
// `relative()` is unguarded arithmetic with five boundaries. A session from
// yesterday reading "Active now" would make the list worse than useless.

const MINUTE = 60_000;

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function session(over: Partial<SessionView> = {}): SessionView {
  return {
    token: "tok-other",
    label: "Firefox on Linux",
    ipAddress: "196.25.1.1",
    lastSeen: ago(5 * MINUTE),
    current: false,
    ...over,
  };
}

type RevokeOne = (token: string) => Promise<SessionActionResult>;
type RevokeRest = () => Promise<SessionActionResult>;

function renderSessions(
  sessions: SessionView[],
  over: {
    onRevoke?: Mock<RevokeOne>;
    onRevokeOthers?: Mock<RevokeRest>;
    onChanged?: Mock<() => void>;
  } = {},
) {
  const onRevoke =
    over.onRevoke ?? vi.fn<RevokeOne>().mockResolvedValue({ ok: true });
  const onRevokeOthers =
    over.onRevokeOthers ?? vi.fn<RevokeRest>().mockResolvedValue({ ok: true });
  const onChanged = over.onChanged ?? vi.fn<() => void>();
  render(
    <>
      <AccountSessions
        sessions={sessions}
        onRevoke={onRevoke}
        onRevokeOthers={onRevokeOthers}
        onChanged={onChanged}
      />
      <Toaster />
    </>,
  );
  return { onRevoke, onRevokeOthers, onChanged };
}

beforeEach(() => {
  // The toast store is module-level; a leftover message would let a later
  // assertion pass for the wrong reason. Reset BEFORE the render, so nothing
  // mutates the store while a <Toaster/> is still mounted.
  toast.dismiss();
});

describe("relative()", () => {
  it.each([
    ["null", null, "Last seen unknown"],
    ["an unparseable string", "sometime tuesday", "Last seen unknown"],
  ])("says so plainly for %s", (_label, lastSeen, expected) => {
    // "Last seen unknown" is information; a fabricated timestamp is not.
    renderSessions([session({ lastSeen })]);
    expect(screen.getByText(new RegExp(expected))).toBeDefined();
  });

  it.each([
    [30_000, "Active now"],
    [5 * MINUTE, "5 minutes ago"],
    [59 * MINUTE, "59 minutes ago"],
    [60 * MINUTE, "1 hour ago"],
    [5 * 60 * MINUTE, "5 hours ago"],
    [24 * 60 * MINUTE, "1 day ago"],
    [3 * 24 * 60 * MINUTE, "3 days ago"],
  ])("renders %ims ago as %s", (elapsed, expected) => {
    renderSessions([session({ lastSeen: ago(elapsed) })]);
    // The singular/plural forks are the ones that read as a bug when wrong.
    expect(screen.getByText(new RegExp(expected))).toBeDefined();
  });
});

describe("what a row shows", () => {
  it("shows the IP, and says when there is none", () => {
    renderSessions([
      session({ ipAddress: "196.25.1.1" }),
      session({ token: "tok-2", ipAddress: null, label: "Safari on iPhone" }),
    ]);

    expect(screen.getByText(/IP 196\.25\.1\.1/)).toBeDefined();
    // Omitting the line would read as "we're not telling you"; inventing a
    // city would be a security lie.
    expect(screen.getByText(/IP not recorded/)).toBeDefined();
  });

  it("badges this device and offers it no Revoke button", () => {
    renderSessions([
      session({ token: "tok-current", current: true, label: "Chrome on macOS" }),
      session(),
    ]);

    expect(screen.getByText("This device")).toBeDefined();
    // You cannot sign yourself out from your own row — that is what the
    // sign-out control at the top is for, and it is labelled honestly.
    expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(1);
  });

  it("says the list is unavailable, not that nothing is signed in", () => {
    renderSessions([]);
    // An empty array here means the read failed. "No active sessions" would be
    // a false all-clear on the one screen where that matters.
    expect(
      screen.getByText(/the list is unavailable, not that nothing is signed in/),
    ).toBeDefined();
  });
});

describe("sign out everywhere else", () => {
  it("is disabled when this device is the only session", () => {
    renderSessions([session({ token: "tok-current", current: true })]);
    expect(
      (screen.getByRole("button", {
        name: "Sign out everywhere else",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("enables as soon as another device exists", () => {
    renderSessions([session({ token: "tok-current", current: true }), session()]);
    expect(
      (screen.getByRole("button", {
        name: "Sign out everywhere else",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("uses its own wording when the server sends none", async () => {
    const { onRevokeOthers, onChanged } = renderSessions([
      session({ token: "tok-current", current: true }),
      session(),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Sign out everywhere else" }));

    expect(
      await screen.findByText("Every other device has been signed out."),
    ).toBeDefined();
    expect(onRevokeOthers).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("reports the server's refusal and refreshes nothing", async () => {
    const onRevokeOthers = vi
      .fn<RevokeRest>()
      .mockResolvedValue({ ok: false, error: "Your session expired." });
    const { onChanged } = renderSessions([session()], { onRevokeOthers });
    fireEvent.click(screen.getByRole("button", { name: "Sign out everywhere else" }));

    expect(await screen.findByText("Your session expired.")).toBeDefined();
    // Re-reading the page after a failure would swap a real error for a stale
    // list that looks like it worked.
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("revoking one session", () => {
  it("passes that row's token and reports the server's message", async () => {
    const onRevoke = vi
      .fn<RevokeOne>()
      .mockResolvedValue({ ok: true, message: "That device is signed out." });
    const { onChanged } = renderSessions(
      [
        session({ token: "tok-current", current: true }),
        session({ token: "tok-phone", label: "Safari on iPhone" }),
      ],
      { onRevoke },
    );
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    expect(await screen.findByText("That device is signed out.")).toBeDefined();
    expect(onRevoke).toHaveBeenCalledWith("tok-phone");
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("falls back to a plain confirmation when the server sends none", async () => {
    renderSessions([session()]);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(await screen.findByText("Session ended.")).toBeDefined();
  });

  it("surfaces a refusal and leaves the list alone", async () => {
    const onRevoke = vi
      .fn<RevokeOne>()
      .mockResolvedValue({ ok: false, error: "That session is already gone." });
    const { onChanged } = renderSessions([session()], { onRevoke });
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    expect(await screen.findByText("That session is already gone.")).toBeDefined();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
