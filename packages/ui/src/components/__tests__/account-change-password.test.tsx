import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import {
  AccountChangePassword,
  type ChangePasswordResult,
  type PasswordAssessment,
} from "../account-change-password";
import { Toaster, toast } from "../toast";

// The password POLICY is injected here on purpose — the same `assessPassword`
// the server action enforces — precisely so this component cannot become a
// second, drifting definition of a good password. Nothing asserted that the
// injected function was actually consulted, so a refactor that dropped the call
// would leave the client happily accepting what the server refuses.
//
// `revokeOtherSessions` defaults to TRUE. That is a security default, and a
// default nobody guards is a default that quietly flips.

/** Stand-in for @quagga/core's assessPassword, with a spy on the call. */
function policy(minLength = 12) {
  return vi.fn(
    (password: string): PasswordAssessment =>
      password.length >= minLength
        ? { ok: true, error: null }
        : { ok: false, error: `Use at least ${minLength} characters.` },
  );
}

type SubmitFn = (input: {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions: boolean;
}) => Promise<ChangePasswordResult>;

function renderForm(
  over: {
    assess?: (p: string) => PasswordAssessment;
    onSubmit?: Mock<SubmitFn>;
    onDone?: () => void;
    onChanged?: () => void;
    minLength?: number;
  } = {},
) {
  const assess = over.assess ?? policy(over.minLength ?? 12);
  const onSubmit =
    over.onSubmit ?? vi.fn<SubmitFn>().mockResolvedValue({ ok: true });
  render(
    <>
      <AccountChangePassword
        minLength={over.minLength ?? 12}
        assess={assess}
        onSubmit={onSubmit}
        onDone={over.onDone}
        onChanged={over.onChanged}
      />
      <Toaster />
    </>,
  );
  return { assess, onSubmit };
}

const currentField = () =>
  screen.getByLabelText("Current password") as HTMLInputElement;
const newField = () =>
  screen.getByLabelText("New password") as HTMLInputElement;
const submitButton = () =>
  screen.getByRole("button", { name: "Change password" }) as HTMLButtonElement;

beforeEach(() => {
  // The toast store is module-level; a leftover message would let a later
  // assertion pass for the wrong reason. Reset BEFORE the render, so nothing
  // mutates the store while a <Toaster/> is still mounted.
  toast.dismiss();
});

describe("the injected policy", () => {
  it("is consulted with the typed password and gates the submit button", () => {
    const { assess } = renderForm({ minLength: 12 });

    fireEvent.change(currentField(), { target: { value: "old-password" } });
    fireEvent.change(newField(), { target: { value: "short" } });

    expect(assess).toHaveBeenCalledWith("short");
    // Both fields are filled — only the policy is holding this back. If the
    // call were dropped, the button would enable and the server would refuse.
    expect(submitButton().disabled).toBe(true);

    fireEvent.change(newField(), { target: { value: "a long enough passphrase" } });
    expect(submitButton().disabled).toBe(false);
  });

  it("keeps submit disabled while Current password is empty, however good the new one is", () => {
    // The ready predicate ANDs three clauses and every other test in this file
    // fills Current password first, so this clause was executed by all of them
    // and asserted by none — deleting it left the suite green. Re-authentication
    // is the whole point of this form: without it, a walk-up at an unlocked
    // laptop changes the password.
    const { assess } = renderForm({ minLength: 12 });

    fireEvent.change(newField(), {
      target: { value: "a long enough passphrase" },
    });

    expect(assess).toHaveBeenCalledWith("a long enough passphrase");
    expect(submitButton().disabled).toBe(true);

    fireEvent.change(currentField(), { target: { value: "old-password" } });
    expect(submitButton().disabled).toBe(false);
  });

  it("names the policy's own minimum rather than a hardcoded number", () => {
    renderForm({ minLength: 14 });
    // A second number in the copy is a number that drifts away from the server.
    expect(screen.getByText(/At least 14 characters/)).toBeDefined();

    // The same number reaches the strength meter inside PasswordInput.
    // (Note: PasswordInput consumes `minLength` for its meter and does NOT put
    // a `minlength` attribute on the input — the form is noValidate, so native
    // validation was never in play here anyway.)
    fireEvent.change(newField(), { target: { value: "short" } });
    expect(screen.getByText(/use at least 14 characters/)).toBeDefined();
  });

  it("renders the assessment's reason when a failing password is submitted", async () => {
    const { onSubmit } = renderForm({ minLength: 12 });
    fireEvent.change(currentField(), { target: { value: "old-password" } });
    fireEvent.change(newField(), { target: { value: "short" } });
    fireEvent.submit(currentField().closest("form")!);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Use at least 12 characters.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("still says something when the policy supplies no reason", async () => {
    const { onSubmit } = renderForm({
      assess: () => ({ ok: false }),
    });
    fireEvent.change(currentField(), { target: { value: "old-password" } });
    fireEvent.change(newField(), { target: { value: "whatever" } });
    fireEvent.submit(currentField().closest("form")!);

    // Silence on a refusal reads as a broken button.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("That password won't do.");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("submitting", () => {
  it("sends exactly what was typed, and revokes other sessions by default", async () => {
    const { onSubmit } = renderForm();
    fireEvent.change(currentField(), { target: { value: "old-password" } });
    fireEvent.change(newField(), { target: { value: "a long enough passphrase" } });
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        currentPassword: "old-password",
        newPassword: "a long enough passphrase",
        // The security default: a changed password should end the sessions of
        // whoever might have had the old one.
        revokeOtherSessions: true,
      }),
    );
  });

  it("passes false once the switch is turned off", async () => {
    const { onSubmit } = renderForm();
    fireEvent.change(currentField(), { target: { value: "old-password" } });
    fireEvent.change(newField(), { target: { value: "a long enough passphrase" } });
    fireEvent.click(screen.getByLabelText("Sign out my other devices"));
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ revokeOtherSessions: false }),
      ),
    );
  });

  it("clears both fields, confirms, and tells the host on success", async () => {
    const onDone = vi.fn();
    const onChanged = vi.fn();
    const onSubmit = vi
      .fn<SubmitFn>()
      .mockResolvedValue({ ok: true, message: "Password changed everywhere." });
    renderForm({ onSubmit, onDone, onChanged });
    fireEvent.change(currentField(), { target: { value: "old-password" } });
    fireEvent.change(newField(), { target: { value: "a long enough passphrase" } });
    fireEvent.click(submitButton());

    expect(await screen.findByText("Password changed everywhere.")).toBeDefined();
    // Leaving a used password in the DOM is a needless exposure on a shared
    // screen.
    await waitFor(() => expect(currentField().value).toBe(""));
    expect(newField().value).toBe("");
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("uses its own confirmation when the server sends none", async () => {
    renderForm();
    fireEvent.change(currentField(), { target: { value: "old-password" } });
    fireEvent.change(newField(), { target: { value: "a long enough passphrase" } });
    fireEvent.click(submitButton());

    expect(await screen.findByText("Password changed.")).toBeDefined();
  });

  it("keeps both fields populated when the server refuses", async () => {
    const onSubmit = vi
      .fn<SubmitFn>()
      .mockResolvedValue({ ok: false, error: "Your current password is wrong." });
    const onChanged = vi.fn();
    renderForm({ onSubmit, onChanged });
    fireEvent.change(currentField(), { target: { value: "wrong-password" } });
    fireEvent.change(newField(), { target: { value: "a long enough passphrase" } });
    fireEvent.click(submitButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Your current password is wrong.");
    // Retyping a passphrase because one of two fields was wrong is the kind of
    // friction that pushes people back to a weak password.
    expect(currentField().value).toBe("wrong-password");
    expect(newField().value).toBe("a long enough passphrase");
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("Cancel", () => {
  it("exists only when the host offered somewhere to go back to", () => {
    const onDone = vi.fn();
    const { unmount } = render(
      <AccountChangePassword
        minLength={12}
        assess={policy()}
        onSubmit={vi.fn()}
        onDone={onDone}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    unmount();

    // Standalone (a dedicated page), there is nothing to collapse back into.
    render(
      <AccountChangePassword
        minLength={12}
        assess={policy()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});
