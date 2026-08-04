import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ToggleGroup, ToggleGroupItem, toggleVariants } from "../toggle-group";

// Mostly a restyled Radix primitive, with one repo-owned decision worth pinning:
// ToggleGroupItem resolves its classes as `context.variant ?? variant`, so the
// GROUP's context WINS over an item's own prop. An author who writes
// <ToggleGroupItem variant="outline"> inside a default-variant group gets it
// silently ignored — no error, no warning, just the wrong chrome. That is
// surprising enough that changing it should be a deliberate act, which is what
// the last case here makes it.

describe("toggleVariants", () => {
  it("applies the documented defaults when called bare", () => {
    const classes = toggleVariants();
    expect(classes).toContain("bg-transparent"); // variant: default
    expect(classes).toContain("h-10"); // size: default
    // The on-state styling is what a toggle is FOR; losing it makes a pressed
    // item indistinguishable from an unpressed one.
    expect(classes).toContain("data-[state=on]:bg-primary/15");
  });

  it("swaps in the outline chrome and the small size on request", () => {
    const classes = toggleVariants({ variant: "outline", size: "sm" });
    expect(classes).toContain("border border-input");
    expect(classes).toContain("h-9");
    expect(classes).not.toContain("h-10 px-3");
  });
});

describe("ToggleGroup", () => {
  it("reports the pressed item through onValueChange", () => {
    const onValueChange = vi.fn();
    render(
      <ToggleGroup type="single" onValueChange={onValueChange}>
        <ToggleGroupItem value="bold">Bold</ToggleGroupItem>
        <ToggleGroupItem value="italic">Italic</ToggleGroupItem>
      </ToggleGroup>,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Italic" }));
    expect(onValueChange).toHaveBeenCalledWith("italic");
  });

  it("hands its variant and size down to every item through context", () => {
    render(
      <ToggleGroup type="single" variant="outline" size="lg">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
      </ToggleGroup>,
    );
    const item = screen.getByRole("radio", { name: "A" });
    // One prop on the group, one look across the row — that is the point of
    // the context.
    expect(item.className).toContain("border border-input");
    expect(item.className).toContain("h-11");
  });

  it("SURPRISING, AND DELIBERATE: the group's context beats an item's own prop", () => {
    render(
      <ToggleGroup type="single" variant="outline">
        <ToggleGroupItem value="a" variant="default" size="sm">
          A
        </ToggleGroupItem>
      </ToggleGroup>,
    );
    const item = screen.getByRole("radio", { name: "A" });

    // `context.variant ?? variant` — the item asked for "default" and got the
    // group's "outline" anyway. An author debugging that has nothing to go on.
    expect(item.className).toContain("border border-input");
    expect(item.className).not.toContain("bg-transparent");
    // Per AXIS, though: the group set no `size`, so the Provider publishes
    // `size: undefined` and the item's own "sm" DOES win. Precedence therefore
    // depends on which props the group happens to set, which is worth knowing
    // before changing either half.
    expect(item.className).toContain("h-9");
  });

  it("keeps a caller's own className alongside the resolved variant", () => {
    render(
      <ToggleGroup type="single">
        <ToggleGroupItem value="a" className="w-24">
          A
        </ToggleGroupItem>
      </ToggleGroup>,
    );
    expect(screen.getByRole("radio", { name: "A" }).className).toContain("w-24");
  });
});
