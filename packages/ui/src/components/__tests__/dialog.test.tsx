import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogTitle } from "../dialog";

function contentOf(className?: string): HTMLElement {
  render(
    <Dialog open>
      <DialogContent className={className}>
        <DialogTitle>Roles</DialogTitle>
      </DialogContent>
    </Dialog>,
  );
  const el = screen.getByRole("dialog");
  expect(el.getAttribute("data-slot")).toBe("dialog-content");
  return el;
}

// jsdom has no layout, so this pins the classes, not the geometry. Twelve
// dialogs had no height cap: on a 360 phone a tall one put its Save button
// below the screen with no way to scroll to it.
describe("DialogContent height", () => {
  it("never grows past the screen and scrolls instead", () => {
    const el = contentOf();
    expect(el.className).toContain("max-h-[calc(100dvh-2rem)]");
    expect(el.className).toContain("overflow-y-auto");
  });

  it("lets a dialog set its own cap", () => {
    const el = contentOf("max-h-[85svh]");
    expect(el.className).toContain("max-h-[85svh]");
    expect(el.className).not.toContain("max-h-[calc(100dvh-2rem)]");
  });
});
