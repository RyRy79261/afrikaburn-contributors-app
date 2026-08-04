import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  ROLE_COLOR_HEX,
  ROLE_COLOR_LABELS,
  RoleBadge,
  RoleSwatch,
} from "../role-badge";

// A typed exhaustive map keyed by RoleColor. TypeScript catches a MISSING key
// at compile time, but it cannot catch two colours sharing a hex, and it cannot
// stop the two maps drifting apart — a colour with a hex and no label renders a
// picker entry with no name.
//
// Same guard the repo already applies to NOTIFICATION_KIND_ICON in
// tier2-3.test.tsx.

describe("the palette maps", () => {
  it("cover exactly the same colours, with no gaps either way", () => {
    const hexKeys = Object.keys(ROLE_COLOR_HEX).sort();
    const labelKeys = Object.keys(ROLE_COLOR_LABELS).sort();
    expect(hexKeys).toEqual(labelKeys);
    expect(hexKeys.length).toBeGreaterThan(0);
  });

  it("give every colour a distinct, well-formed hex", () => {
    const values = Object.values(ROLE_COLOR_HEX);
    for (const hex of values) expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    // Two roles that tint identically are two roles a reader cannot tell apart
    // at a glance, which is the only thing the colour is for.
    expect(new Set(values).size).toBe(values.length);
  });

  it("give every colour a non-empty label for the picker", () => {
    for (const label of Object.values(ROLE_COLOR_LABELS)) {
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("RoleBadge", () => {
  it("tints from the role's hex with the documented alpha suffixes", () => {
    render(<RoleBadge name="Lead" color="teal" />);
    const chip = screen.getByText("Lead");

    // 22 background / 99 border is what keeps a chip legible in BOTH themes
    // without per-theme classes. jsdom normalises hex to rgb().
    expect(chip.style.backgroundColor).toBe("rgba(45, 118, 150, 0.133)");
    expect(chip.style.borderColor).toBe("rgba(45, 118, 150, 0.6)");
  });

  it("defaults to neutral when the caller has no colour to give", () => {
    render(<RoleBadge name="Unassigned" />);
    const chip = screen.getByText("Unassigned");
    // #ADB6B3 at 0x22.
    expect(chip.style.backgroundColor).toBe("rgba(173, 182, 179, 0.133)");
  });

  it.each([[null], [undefined], [""]])(
    "renders no emoji span for %j",
    (emoji) => {
      const { container } = render(
        <RoleBadge name="Lead" emoji={emoji} color="sage" />,
      );
      // An empty decorative span would still take the gap-1 spacing.
      expect(container.querySelectorAll("span[aria-hidden]")).toHaveLength(0);
    },
  );

  it("hides a supplied emoji from assistive tech", () => {
    const { container } = render(<RoleBadge name="Rangers" emoji="🛡" />);
    const decorative = container.querySelector("span[aria-hidden]");
    // The name is already read out; the emoji would be read as its CLDR name.
    expect(decorative?.textContent).toBe("🛡");
  });
});

describe("RoleSwatch", () => {
  it("is decorative and carries the role's solid colour", () => {
    const { container } = render(<RoleSwatch color="rust" />);
    const dot = container.firstElementChild as HTMLElement;
    expect(dot.getAttribute("aria-hidden")).toBe("true");
    expect(dot.style.backgroundColor).toBe("rgb(194, 68, 56)");
  });

  it("adds the selection ring only when selected", () => {
    const { container, rerender } = render(<RoleSwatch color="olive" />);
    expect(
      (container.firstElementChild as HTMLElement).className,
    ).not.toContain("ring-2");
    // In a palette picker the ring is the ONLY signal of which colour is
    // chosen — the dot itself never changes.
    rerender(<RoleSwatch color="olive" selected />);
    expect((container.firstElementChild as HTMLElement).className).toContain(
      "ring-2",
    );
  });
});
