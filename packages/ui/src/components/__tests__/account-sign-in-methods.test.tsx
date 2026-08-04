import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { AccountSignInMethods } from "../account-sign-in-methods";
import type { PasswordAssessment } from "../account-change-password";

// Every branch in this file is a claim about what the account can DO: whether a
// password exists, whether Google is linked, whether this is the last way in.
//
// The file's header is explicit that setting a FIRST password is not offered,
// because the only endpoint we have (`change-password`) needs the current one.
// A Google-only account must therefore see an explanation, not a form that
// would always fail. If that branch inverts we ship a control that cannot work.
//
// This list is NOT the security boundary — the last-method rule is enforced in
// @quagga/core. What is tested here is that the list never advertises an action
// the server would refuse.

const assess = (password: string): PasswordAssessment =>
  password.length >= 12
    ? { ok: true, error: null }
    : { ok: false, error: "Too short." };

function renderMethods(
  over: Partial<React.ComponentProps<typeof AccountSignInMethods>> = {},
) {
  const onChangePassword = vi.fn().mockResolvedValue({ ok: true });
  render(
    <AccountSignInMethods
      hasPassword
      passwordAddedAt={null}
      googleEmail={null}
      googleLinked={false}
      methodCount={2}
      securityHref="/account/security"
      unlinkNotice="Unlinking isn't available yet."
      passwordMinLength={12}
      assessPassword={assess}
      onChangePassword={onChangePassword}
      {...over}
    />,
  );
  return { onChangePassword };
}

describe("the password row", () => {
  it("explains why a Google-only account cannot add one, and offers no button", () => {
    renderMethods({ hasPassword: false, googleLinked: true });

    expect(screen.getByText("Not set")).toBeDefined();
    expect(
      screen.getByText(/Adding a password isn’t available\s+yet/),
    ).toBeDefined();
    // A "Set a password" control here would always fail: change-password needs
    // a password to start from.
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
  });

  it("dates the credential when it knows, and admits it never tracked changes", () => {
    renderMethods({ passwordAddedAt: "2026-07-14T10:00:00.000Z" });

    expect(screen.getByText("Active")).toBeDefined();
    expect(screen.getByText(/Added\s*14 Jul 2026/)).toBeDefined();
    // Saying "last changed" when we only stored "added" would be an invented
    // fact about someone's account security.
    expect(
      screen.getByText(/We don’t record when it last changed/),
    ).toBeDefined();
  });

  it("falls back to the generic sentence when no date was stored", () => {
    renderMethods({ passwordAddedAt: null });
    expect(
      screen.getByText("You sign in with your email address and a password."),
    ).toBeDefined();
    expect(
      screen.queryByText(/We don’t record when it last changed/),
    ).toBeNull();
  });

  it("toggles the change form in and out, threading the injected policy through", () => {
    renderMethods({ passwordMinLength: 14 });
    expect(screen.queryByLabelText("Current password")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByLabelText("Current password")).toBeDefined();
    // The SAME policy the server action enforces reaches the embedded form.
    expect(screen.getByText(/At least 14 characters/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByLabelText("Current password")).toBeNull();
  });
});

describe("the Google row", () => {
  it("shows the linked address when it has one", () => {
    renderMethods({ googleLinked: true, googleEmail: "alice@example.com" });
    expect(screen.getByText("Connected")).toBeDefined();
    expect(screen.getByText("Connected · alice@example.com.")).toBeDefined();
  });

  it("omits the separator entirely when there is no address", () => {
    renderMethods({ googleLinked: true, googleEmail: null });
    // "Connected · ." is the kind of stray punctuation that survives review.
    expect(screen.getByText("Connected.")).toBeDefined();
  });

  it("disables Unlink and carries the capability's own words", () => {
    renderMethods({ googleLinked: true });
    const unlink = screen.getByRole("button", {
      name: "Unlink",
    }) as HTMLButtonElement;

    // Unlink is exposed on the browser client but absent server-side and
    // unverifiable, so the control must not pretend.
    expect(unlink.disabled).toBe(true);
    expect(unlink.getAttribute("title")).toBe("Unlinking isn't available yet.");
  });

  it("offers no Unlink control at all when Google is not linked", () => {
    renderMethods({ googleLinked: false });
    expect(screen.getByText("Not connected")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Unlink" })).toBeNull();
  });
});

describe("the last-method note", () => {
  it("says it plainly when this is the only way in", () => {
    renderMethods({ methodCount: 1 });
    expect(
      screen.getByText(
        /This is your only way to sign in — it can't be removed/,
      ),
    ).toBeDefined();
    // The capability notice is appended in BOTH states, because the reason
    // unlink is unavailable does not depend on how many methods there are.
    expect(screen.getByText(/Unlinking isn't available yet\./)).toBeDefined();
  });

  it("softens to the general rule when there is more than one", () => {
    renderMethods({ methodCount: 3 });
    expect(
      screen.getByText(/At least one sign-in method must stay active/),
    ).toBeDefined();
    expect(screen.getByText(/Unlinking isn't available yet\./)).toBeDefined();
  });
});

describe("the passkeys row", () => {
  it("links to the app's own Security page rather than a hardcoded path", () => {
    // The three apps mount the account suite at their own paths, so a
    // hardcoded /account/security would 404 in two of them.
    renderMethods({ securityHref: "/portal/account/security" });
    expect(
      screen.getByRole("link", { name: "Manage" }).getAttribute("href"),
    ).toBe("/portal/account/security");
  });
});
