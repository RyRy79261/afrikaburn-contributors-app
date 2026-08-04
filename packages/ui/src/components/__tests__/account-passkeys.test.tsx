import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

import { AccountPasskeys, type PasskeyRow } from "../account-passkeys";
import type { AccountAuthClient } from "../account-auth-client";

// The passkey card carries a fixed hydration bug in its own comments: support
// used to be computed during render, so the SERVER — where `window` does not
// exist — decided the answer was "no" and every visitor was served HTML saying
// "This browser doesn't support passkeys" with the button already disabled. A
// verdict on a browser nobody had consulted, wrong for most of them.
//
// The fix is `null = not asked yet`, and the only place that state is observable
// is the server render, which is why the first case below renders to a string.
//
// jsdom leaves `window.PublicKeyCredential` undefined, so the unsupported path
// is free and the supported path is the one that needs a stub.

function makeClient(over: { add?: unknown; remove?: unknown } = {}) {
  const addPasskey = vi
    .fn()
    .mockResolvedValue(over.add ?? { data: {}, error: null });
  const deletePasskey = vi
    .fn()
    .mockResolvedValue(over.remove ?? { data: {}, error: null });
  const client = {
    twoFactor: {
      enable: vi.fn(),
      verifyTotp: vi.fn(),
      verifyBackupCode: vi.fn(),
      disable: vi.fn(),
      generateBackupCodes: vi.fn(),
    },
    passkey: { addPasskey, deletePasskey },
  } satisfies AccountAuthClient;
  return { client, addPasskey, deletePasskey };
}

const ROW: PasskeyRow = {
  id: "pk-1",
  name: "My phone",
  deviceType: "multiDevice",
  createdAt: "2026-07-14T10:00:00.000Z",
};

function supportPasskeys() {
  Object.defineProperty(window, "PublicKeyCredential", {
    value: function PublicKeyCredential() {},
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  if ("PublicKeyCredential" in window) {
    // @ts-expect-error — removing the property this test installed.
    delete window.PublicKeyCredential;
  }
  vi.restoreAllMocks();
});

describe("support detection", () => {
  it("REGRESSION: the server render claims nothing about support", () => {
    const { client } = makeClient();
    const html = renderToStaticMarkup(
      <AccountPasskeys client={client} passkeys={[]} />,
    );

    // There is no browser on the server, so there is no honest answer yet.
    expect(html).not.toContain("support passkeys");
    // `disabled:opacity-50` is a Tailwind class; the ATTRIBUTE is what would
    // have shipped a dead button to every visitor.
    expect(html).not.toContain('disabled=""');
    expect(html).toContain("Add a passkey");
  });

  it("stays silent about support in a browser that has WebAuthn", async () => {
    supportPasskeys();
    const { client } = makeClient();
    render(<AccountPasskeys client={client} passkeys={[]} />);

    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Add a passkey" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(screen.queryByText(/doesn't support passkeys/)).toBeNull();
  });

  it("refuses AND names the alternative when WebAuthn is absent", async () => {
    const { client } = makeClient();
    render(<AccountPasskeys client={client} passkeys={[]} />);

    // A refusal with no way forward is a dead end; the password is the way in.
    await screen.findByText(
      /This browser doesn’t support passkeys\. You can still sign in with your password\./,
    );
    expect(
      (screen.getByRole("button", { name: "Add a passkey" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe("the list", () => {
  it("counts what is set up rather than claiming any is enough", () => {
    const { client } = makeClient();
    const { rerender } = render(
      <AccountPasskeys client={client} passkeys={[]} />,
    );
    expect(screen.getByText("None yet")).toBeDefined();
    expect(screen.getByText(/haven’t added any passkeys yet/)).toBeDefined();

    rerender(
      <AccountPasskeys client={client} passkeys={[ROW, { ...ROW, id: "pk-2" }]} />,
    );
    expect(screen.getByText("2 set up")).toBeDefined();
  });

  it.each([
    ["multiDevice", "Synced"],
    ["singleDevice", "This device"],
    ["hybrid", "Passkey"],
    [null, "Passkey"],
  ])("describes a %s credential as %s", (deviceType, label) => {
    const { client } = makeClient();
    render(
      <AccountPasskeys
        client={client}
        passkeys={[{ ...ROW, deviceType, createdAt: null }]}
      />,
    );
    // "Synced" versus "This device" is the difference between "losing this
    // phone loses the passkey" and "it is in my password manager".
    expect(screen.getByText(label)).toBeDefined();
  });

  it("dates a row in en-ZA, and shows no date at all when it cannot", () => {
    const { client } = makeClient();
    const { rerender } = render(
      <AccountPasskeys client={client} passkeys={[ROW]} />,
    );
    expect(screen.getByText(/· added 14 Jul 2026/)).toBeDefined();

    // An unparseable timestamp must not render "added Invalid Date".
    rerender(
      <AccountPasskeys
        client={client}
        passkeys={[{ ...ROW, createdAt: "yesterday-ish" }]}
      />,
    );
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
    expect(screen.getByText(/· added\s*$/)).toBeDefined();
  });

  it.each([[null], [""], ["   "]])(
    "labels an unnamed passkey %j as just 'Passkey'",
    (name) => {
      const { client } = makeClient();
      render(
        <AccountPasskeys
          client={client}
          passkeys={[{ ...ROW, name, deviceType: null, createdAt: null }]}
        />,
      );
      // Two of these render in the same row (label and device type); both are
      // the same honest fallback rather than a blank line.
      expect(screen.getAllByText("Passkey").length).toBeGreaterThan(0);
    },
  );
});

describe("adding", () => {
  it("keeps the form and the typed name when the device cancels", async () => {
    supportPasskeys();
    const { client, addPasskey } = makeClient({
      add: { data: null, error: {} },
    });
    const onChanged = vi.fn();
    render(
      <AccountPasskeys client={client} passkeys={[]} onChanged={onChanged} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add a passkey" }));
    fireEvent.change(screen.getByLabelText("Name this passkey"), {
      target: { value: "Work laptop" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create passkey" }));

    const alert = await screen.findByRole("alert");
    // Calm, not alarming: a cancelled Touch ID prompt is the usual cause.
    expect(alert.textContent).toBe(
      "That didn't complete. Your device may have cancelled it — try again.",
    );
    expect(addPasskey).toHaveBeenCalledWith({ name: "Work laptop" });
    // Retyping the name after a cancel would be pure friction.
    expect(
      (screen.getByLabelText("Name this passkey") as HTMLInputElement).value,
    ).toBe("Work laptop");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("sends no name at all when the field was left blank", async () => {
    supportPasskeys();
    const { client, addPasskey } = makeClient();
    const onChanged = vi.fn();
    render(
      <AccountPasskeys client={client} passkeys={[]} onChanged={onChanged} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add a passkey" }));
    fireEvent.change(screen.getByLabelText("Name this passkey"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create passkey" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    // A whitespace name would render as an unlabelled row forever.
    expect(addPasskey).toHaveBeenCalledWith({ name: undefined });
    // The form closes on success — the host re-reads the list.
    expect(screen.queryByLabelText("Name this passkey")).toBeNull();
  });
});

describe("removing", () => {
  it("marks only the clicked row busy", async () => {
    let release: ((v: unknown) => void) | undefined;
    const { client } = makeClient();
    client.passkey.deletePasskey = vi.fn(
      () => new Promise((resolve) => (release = resolve)),
    ) as never;
    render(
      <AccountPasskeys
        client={client}
        passkeys={[ROW, { ...ROW, id: "pk-2", name: "Tablet" }]}
      />,
    );
    const [first, second] = screen.getAllByRole("button", { name: /Remove/ });
    fireEvent.click(first!);

    await waitFor(() => expect(screen.getByText("Removing…")).toBeDefined());
    // The other row stays usable — one slow request must not freeze the card.
    expect((second as HTMLButtonElement).disabled).toBe(false);
    release?.({ data: {}, error: null });
  });

  it("renders the server's reason and does not claim a change happened", async () => {
    const { client, deletePasskey } = makeClient({
      remove: { data: null, error: { message: "That passkey is already gone." } },
    });
    const onChanged = vi.fn();
    render(
      <AccountPasskeys client={client} passkeys={[ROW]} onChanged={onChanged} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Remove/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("That passkey is already gone.");
    expect(deletePasskey).toHaveBeenCalledWith({ id: "pk-1" });
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("recovery honesty", () => {
  it("states that a passkey is never the only way in", () => {
    const { client } = makeClient();
    render(<AccountPasskeys client={client} passkeys={[ROW]} />);

    // A product law from the file's own header: an accelerator, not a
    // replacement. Losing a device is not a lockout, and the card says so.
    expect(
      screen.getByText(
        /your password stays\s+active, so losing a device never locks you out/,
      ),
    ).toBeDefined();
  });
});
