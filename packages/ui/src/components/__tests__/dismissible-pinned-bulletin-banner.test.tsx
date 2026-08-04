import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { DismissiblePinnedBulletinBanner } from "../dismissible-pinned-bulletin-banner";

// The whole file is one state transition, and it is the only "use client"
// wrapper keeping the base banner server-safe. If dismissal stops sticking, a
// pinned bulletin the reader has already dismissed comes back on every render —
// which is how a helpful banner becomes an advert nobody can close.

describe("DismissiblePinnedBulletinBanner", () => {
  it("renders the bulletin, then nothing at all once dismissed", () => {
    const { container } = render(
      <DismissiblePinnedBulletinBanner
        title="Gate opens at 09:00 on Monday"
        href="/bulletins/gate-times"
      />,
    );
    expect(screen.getByText("Gate opens at 09:00 on Monday")).toBeDefined();
    expect(
      screen.getByRole("link", { name: /Read/ }).getAttribute("href"),
    ).toBe("/bulletins/gate-times");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    // Not hidden, not collapsed — gone. A zero-height leftover still takes the
    // parent's gap.
    expect(container.innerHTML).toBe("");
  });

  it("tells the caller once, so the choice can be persisted", () => {
    const onDismiss = vi.fn();
    render(
      <DismissiblePinnedBulletinBanner
        title="Gate opens at 09:00"
        href="/b/1"
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("stays dismissed when the parent re-renders with the same props", () => {
    const { container, rerender } = render(
      <DismissiblePinnedBulletinBanner title="Gate opens" href="/b/1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    rerender(<DismissiblePinnedBulletinBanner title="Gate opens" href="/b/1" />);
    // The dashboard around this re-renders constantly; a banner that came back
    // on every parent update would be unclosable in practice.
    expect(container.innerHTML).toBe("");
  });
});
