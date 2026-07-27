import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  Skeleton,
  SkeletonCard,
  SkeletonCardGrid,
  SkeletonRegion,
  SkeletonRow,
  SkeletonTable,
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

  it("SkeletonTable renders the asked-for number of rows", () => {
    const { container } = render(<SkeletonTable rows={6} columns={3} />);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(6 * 3);
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
