import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  Skeleton,
  SkeletonCard,
  SkeletonCardGrid,
  SkeletonField,
  SkeletonForm,
  SkeletonRegion,
  SkeletonRow,
  SkeletonText,
} from "../skeleton";

// The skeleton kit's job is to hold a page's shape while it loads. Two
// properties have to hold or a loading boundary makes things worse rather than
// better, and both are easy to break by accident:
//
//   1. The placeholder blocks are DECORATIVE. A screen reader must not read out
//      a wall of empty boxes; it must hear one polite "Loading…" per boundary.
//   2. Container classes are pass-through, because each route's boundary reuses
//      the SAME classes as its page. Drop them and the skeleton stops matching
//      the destination, which is the entire point.

describe("Skeleton", () => {
  it("is hidden from assistive tech and keeps caller sizing", () => {
    const { container } = render(<Skeleton className="h-7 w-52" />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    expect(bar.className).toContain("h-7");
    expect(bar.className).toContain("w-52");
    expect(bar.className).toContain("animate-pulse");
  });
});

describe("SkeletonRegion", () => {
  it("announces once, politely, and marks itself busy", () => {
    const { container, getByText } = render(
      <SkeletonRegion>
        <Skeleton className="h-4 w-10" />
        <Skeleton className="h-4 w-10" />
      </SkeletonRegion>,
    );
    const region = container.firstElementChild as HTMLElement;
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(getByText("Loading…")).toBeDefined();
    // Exactly one announcement, however many bars are inside.
    expect(container.querySelectorAll(".sr-only")).toHaveLength(1);
  });

  it("exposes data-loading so a browser test can prove a boundary appeared", () => {
    const { container } = render(<SkeletonRegion />);
    expect((container.firstElementChild as HTMLElement).dataset.loading).toBe(
      "true",
    );
  });

  it("passes its container classes straight through", () => {
    const { container } = render(
      <SkeletonRegion className="mx-auto flex max-w-2xl flex-col gap-6" />,
    );
    expect((container.firstElementChild as HTMLElement).className).toBe(
      "mx-auto flex max-w-2xl flex-col gap-6",
    );
  });
});

describe("shape primitives", () => {
  it("SkeletonText ends on a short line, the way a paragraph does", () => {
    const { container } = render(<SkeletonText lines={3} />);
    const bars = [...container.querySelectorAll(".animate-pulse")];
    expect(bars).toHaveLength(3);
    expect(bars[0]?.className).toContain("w-full");
    expect(bars[2]?.className).toContain("w-2/3");
  });

  it("SkeletonRow renders one flexible column plus its trailing metadata", () => {
    const { container } = render(<SkeletonRow columns={4} />);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(4);
  });

  it("SkeletonCard renders a title bar plus the requested body lines", () => {
    const { container } = render(<SkeletonCard lines={4} />);
    // 1 title bar + 4 text bars.
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(5);
  });

  it("SkeletonCardGrid keeps the grid classes the page uses", () => {
    const { container } = render(
      <SkeletonCardGrid
        cards={2}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      />,
    );
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.className).toBe("grid gap-4 sm:grid-cols-2 lg:grid-cols-3");
    expect(grid.children).toHaveLength(2);
  });
});

describe("the composed shapes", () => {
  // The kit's whole justification is that a boundary shows the DESTINATION's
  // shape, so the counts ARE the behaviour: a stats strip that renders three
  // tiles in front of a four-tile dashboard makes the page jump on arrival.

  it("SkeletonCardGrid defaults to six cards of two lines each", () => {
    const { container } = render(<SkeletonCardGrid />);
    // 6 cards × (1 title bar + 2 text bars).
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(18);
    expect(container.firstElementChild?.children).toHaveLength(6);
  });

  it("SkeletonField renders a label bar above an input bar", () => {
    const { container } = render(<SkeletonField />);
    const bars = [...container.querySelectorAll(".animate-pulse")];
    expect(bars).toHaveLength(2);
    // Short label, full-width control — the shape of every field in the apps.
    expect(bars[0]?.className).toContain("w-28");
    expect(bars[1]?.className).toContain("w-full");
  });

  it("SkeletonForm renders its fields plus one submit-button placeholder", () => {
    const { container, rerender } = render(<SkeletonForm />);
    // 4 fields × 2 bars + 1 button bar.
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(9);

    rerender(<SkeletonForm fields={2} />);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(5);
  });

  it("keeps every pulse block out of the accessibility tree", () => {
    const { container } = render(
      <SkeletonRegion>
        <SkeletonCardGrid cards={2} />
        <SkeletonForm fields={2} />
      </SkeletonRegion>,
    );
    const bars = [...container.querySelectorAll(".animate-pulse")];
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars)
      expect(bar.getAttribute("aria-hidden")).toBe("true");
    // One announcement per boundary, not one per bar.
    expect(container.querySelectorAll(".sr-only")).toHaveLength(1);
  });
});
