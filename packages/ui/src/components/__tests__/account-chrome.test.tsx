import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AccountShell } from "../account-shell";
import { AccountSecurityEvents } from "../account-security-events";
import { AccountCapabilityNotice } from "../account-capability-notice";
import { AccountDeleteElsewhere } from "../account-delete-elsewhere";
import { GateScreen } from "../gate-screen";
import { QuiltBand } from "../quilt-band";

// The chrome around the account suite. Individually small, and two of them
// carry recorded defects that fail SILENTLY:
//
//   - QuiltBand strips the colons out of `useId` because a raw useId is invalid
//     inside an SVG `url(#id)` reference. Remove the strip and the band renders
//     invisible in every app header, with no error anywhere.
//   - AccountCapabilityNotice returns null when `label` is null. That contract
//     is what lets callers pass a verdict unconditionally instead of branching
//     at every call site; if it starts rendering an empty box, three apps grow
//     a stray panel nobody asked for.

const SECTIONS = [
  { key: "profile", label: "Profile", href: "/account" },
  { key: "security", label: "Security", href: "/account/security" },
  { key: "delete", label: "Delete", href: "/account/delete" },
] as const;

describe("AccountShell", () => {
  it("marks exactly the active section, and nothing else", () => {
    render(
      <AccountShell
        sections={SECTIONS}
        active="security"
        title="Your account"
        description="Everything about how you sign in."
      >
        <p>body</p>
      </AccountShell>,
    );

    const current = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toBe("Security");
  });

  it("navigates with plain anchors so the active state survives a page load", () => {
    render(
      <AccountShell
        sections={SECTIONS}
        active="profile"
        title="Your account"
        description="d"
      >
        <p>body</p>
      </AccountShell>,
    );

    // @quagga/ui takes no dependency on Next: these are separate routes and
    // each one has to be a real, shareable URL.
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/account",
      "/account/security",
      "/account/delete",
    ]);
    expect(screen.getByRole("navigation", { name: "Account sections" }))
      .toBeDefined();
  });

  it("states the one-account promise by default and omits an absent footer", () => {
    const { container, rerender } = render(
      <AccountShell
        sections={SECTIONS}
        active="profile"
        title="Your account"
        description="d"
      >
        <p>body</p>
      </AccountShell>,
    );
    expect(
      screen.getByText(/One AfrikaBurn account, whichever door you come in by/),
    ).toBeDefined();
    // The footer block is a bordered rule; rendering it empty draws a line
    // under nothing.
    expect(container.querySelector(".border-t")).toBeNull();

    rerender(
      <AccountShell
        sections={SECTIONS}
        active="profile"
        title="Your account"
        description="d"
        eyebrow="Supplier portal"
        note={null}
        footer={<span>Signed in as alice@example.com</span>}
      >
        <p>body</p>
      </AccountShell>,
    );
    expect(screen.getByText("Supplier portal")).toBeDefined();
    expect(screen.getByText("Signed in as alice@example.com")).toBeDefined();
    expect(
      screen.queryByText(/One AfrikaBurn account/),
    ).toBeNull();
  });
});

describe("AccountSecurityEvents", () => {
  it("uses the caller's empty description rather than inventing one", () => {
    render(
      <AccountSecurityEvents
        events={[]}
        emptyDescription="Nothing has happened to this supplier account yet."
      />,
    );
    expect(screen.getByText("Nothing to report")).toBeDefined();
    expect(
      screen.getByText("Nothing has happened to this supplier account yet."),
    ).toBeDefined();
  });

  it("renders a dated row per event, and omits an absent body", () => {
    render(
      <AccountSecurityEvents
        events={[
          {
            id: "e1",
            title: "Password changed",
            body: "From Chrome on macOS",
            createdAt: new Date("2026-07-14T10:00:00.000Z"),
          },
          {
            id: "e2",
            title: "Signed out everywhere else",
            body: null,
            createdAt: new Date("2026-07-15T10:00:00.000Z"),
          },
        ]}
        note={<span>Sign-ins are not logged here.</span>}
      />,
    );

    expect(screen.getByText("Password changed")).toBeDefined();
    expect(screen.getByText("From Chrome on macOS")).toBeDefined();
    expect(screen.getByText("14 Jul 2026")).toBeDefined();
    // The closing note names what the feed does NOT contain — a log that
    // quietly omits a category teaches a completeness it does not have.
    expect(screen.getByText("Sign-ins are not logged here.")).toBeDefined();
    // The second row has no body paragraph at all.
    const second = screen.getByText("Signed out everywhere else")
      .parentElement as HTMLElement;
    expect(second.querySelectorAll("p")).toHaveLength(1);
  });
});

describe("AccountCapabilityNotice", () => {
  it("renders NOTHING when there is nothing to say", () => {
    const { container } = render(
      <AccountCapabilityNotice
        verdict={{ label: null, message: "ignored" }}
      />,
    );
    // The whole point of the null contract: a caller passes the verdict
    // unconditionally and never branches.
    expect(container.innerHTML).toBe("");
  });

  it("renders the badge and the explanation when there is", () => {
    render(
      <AccountCapabilityNotice
        verdict={{
          label: "Not available yet",
          message: "Our sign-in provider doesn't expose unlinking.",
        }}
      />,
    );
    expect(screen.getByText("Not available yet")).toBeDefined();
    expect(
      screen.getByText("Our sign-in provider doesn't expose unlinking."),
    ).toBeDefined();
  });
});

describe("AccountDeleteElsewhere", () => {
  it("hands over the right door and says what this app loses", () => {
    render(
      <AccountDeleteElsewhere
        href="https://app.example/account/delete"
        consequences={<p>Your System manager role would be vacated.</p>}
      />,
    );

    const link = screen.getByRole("link", {
      name: /Delete on the participant app/,
    });
    expect(link.getAttribute("href")).toBe("https://app.example/account/delete");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
    // Only this app knows what it holds; saying nothing would let someone
    // delete without learning what went with it.
    expect(
      screen.getByText("Your System manager role would be vacated."),
    ).toBeDefined();
  });

  it("lets the caller name the door", () => {
    render(
      <AccountDeleteElsewhere
        href="https://app.example/account/delete"
        consequences={<p>x</p>}
        linkLabel="Delete on app.quagga"
      />,
    );
    expect(
      screen.getByRole("link", { name: /Delete on app\.quagga/ }),
    ).toBeDefined();
  });
});

describe("GateScreen", () => {
  it("renders only the slots it was given", () => {
    const { container } = render(
      <GateScreen>
        <p>Fill this in before continuing.</p>
      </GateScreen>,
    );
    expect(screen.getByText("Fill this in before continuing.")).toBeDefined();
    // A blocking gate is fill + sign-out only; empty wrappers would add
    // spacing to a layout that is deliberately spare.
    expect(container.querySelectorAll("main > div")).toHaveLength(0);
  });

  it("renders the logo, eyebrow and sign-out when they are supplied", () => {
    render(
      <GateScreen
        logo={<span>QUAGGA</span>}
        eyebrow="AfrikaBurn Organiser Console"
        signOut={<button type="button">Sign out</button>}
      >
        <p>body</p>
      </GateScreen>,
    );
    expect(screen.getByText("QUAGGA")).toBeDefined();
    expect(screen.getByText("AfrikaBurn Organiser Console")).toBeDefined();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeDefined();
  });
});

describe("QuiltBand", () => {
  it("paints from the pattern it actually declared", () => {
    const { container } = render(<QuiltBand />);
    const pattern = container.querySelector("pattern") as SVGPatternElement;
    const rect = container.querySelector("rect") as SVGRectElement;
    const id = pattern.getAttribute("id")!;

    // If the rect's url(#…) and the pattern's id ever stop matching, the band
    // renders INVISIBLE in every app header and nothing errors anywhere.
    expect(rect.getAttribute("fill")).toBe(`url(#${id})`);
    // The id must also be a legal SVG reference. NOTE, measured: React 19's
    // useId returns "_r_0_" with no colons, so the `.replace(/:/g, "")` in the
    // source is a React-18-era guard this assertion can no longer falsify on
    // its own — it is here to catch a future id format, not to prove the strip.
    expect(id).not.toContain(":");
  });

  it("gives two bands different ids so one page can hold both", () => {
    const { container } = render(
      <>
        <QuiltBand />
        <QuiltBand />
      </>,
    );
    const [a, b] = [...container.querySelectorAll("pattern")].map((p) =>
      p.getAttribute("id"),
    );
    // Duplicate ids would make the second band pick up the first's pattern —
    // harmless here, but the same collision anywhere else is not.
    expect(a).not.toBe(b);
  });

  it("is decorative, and takes the caller's opacity", () => {
    const { container } = render(<QuiltBand opacity={0.4} className="mt-2" />);
    const band = container.firstElementChild as HTMLElement;
    expect(band.getAttribute("aria-hidden")).toBe("true");
    expect(band.style.opacity).toBe("0.4");
    expect(band.className).toContain("mt-2");
  });
});

describe("smoke: the chrome takes no router and no client hooks", () => {
  it("AccountShell renders with a single section and no crash on an unknown active key", () => {
    // Apps mount different section sets; an `active` that matches nothing must
    // simply mark nothing rather than throw.
    const onNothing = vi.fn();
    render(
      <AccountShell
        sections={[{ key: "profile", label: "Profile", href: "/a" }]}
        active="does-not-exist"
        title="t"
        description="d"
      >
        <p>body</p>
      </AccountShell>,
    );
    expect(
      screen.getByRole("link", { name: "Profile" }).getAttribute("aria-current"),
    ).toBeNull();
    expect(onNothing).not.toHaveBeenCalled();
  });
});
