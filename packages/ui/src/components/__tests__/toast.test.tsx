import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { Toaster, toast } from "../toast";

// Every success and failure message in the product routes through this
// hand-rolled store. Two of its decisions are invisible until they are wrong:
//
//   - `normalizeDuration` decides whether a toast disappears in five seconds or
//     stays on screen forever. A NaN slipping through would schedule a timer
//     that fires immediately, so the message flashes and is gone.
//   - `dismiss(undefined)` clears EVERY toast, not one. A stray call from a
//     close handler would wipe messages the user has not read.
//
// The store is module-level and mutable, so each case resets it — otherwise a
// leftover toast lets a later assertion pass for the wrong reason.

beforeEach(() => {
  toast.dismiss();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the toast() entry points", () => {
  it("defaults to info and hands back an increasing id", () => {
    const first = toast("Saved");
    const second = toast.success("Saved again");
    expect(second).toBe(first + 1);

    render(<Toaster />);
    // info is a status, not an alert — it must not interrupt a screen reader.
    expect(screen.getByText("Saved").closest("[role]")?.getAttribute("role"))
      .toBe("status");
  });

  it("gives the error variant role=alert and the other three role=status", () => {
    toast.info("Info");
    toast.success("Success");
    toast.warning("Warning");
    toast.error("Error");
    render(<Toaster />);

    // This distinction decides whether a screen reader interrupts what it is
    // reading. A failure is worth interrupting for; a save confirmation is not.
    const roleOf = (title: string) =>
      screen.getByText(title).closest("[role]")?.getAttribute("role");
    expect(roleOf("Info")).toBe("status");
    expect(roleOf("Success")).toBe("status");
    expect(roleOf("Warning")).toBe("status");
    expect(roleOf("Error")).toBe("alert");
  });

  it("renders the description only when one was supplied", () => {
    toast.error("Upload failed", { description: "Token expired." });
    toast.error("Bare");
    render(<Toaster />);

    expect(screen.getByText("Token expired.")).toBeDefined();
    const bare = screen.getByText("Bare").closest("[role]") as HTMLElement;
    expect(bare.querySelectorAll("p")).toHaveLength(1);
  });
});

describe("normalizeDuration", () => {
  it("auto-dismisses on the default 5s when no duration is given", () => {
    vi.useFakeTimers();
    toast.success("Saved");
    render(<Toaster />);
    expect(screen.getByText("Saved")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(screen.queryByText("Saved")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("keeps an Infinity toast on screen indefinitely", () => {
    vi.useFakeTimers();
    toast.error("Your session ended", { duration: Infinity });
    render(<Toaster />);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    // The one thing a persistent toast is for: a message that must be read,
    // not one that can be missed by looking away.
    expect(screen.getByText("Your session ended")).toBeDefined();
  });

  it("honours a finite duration verbatim", () => {
    vi.useFakeTimers();
    toast("Quick", { duration: 1_000 });
    render(<Toaster />);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.queryByText("Quick")).toBeNull();
  });

  it.each([
    ["a negative number", -1],
    ["NaN", Number.NaN],
  ])("falls back to the default rather than scheduling a nonsense timer for %s", (
    _label,
    duration,
  ) => {
    vi.useFakeTimers();
    toast("Odd", { duration });
    render(<Toaster />);

    // Left as-is, a negative or NaN delay fires on the next tick and the
    // message is gone before anyone reads it.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByText("Odd")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.queryByText("Odd")).toBeNull();
  });
});

describe("dismiss", () => {
  it("removes exactly one toast by id and leaves the rest", () => {
    const keep = toast("Keep me", { duration: Infinity });
    const drop = toast("Drop me", { duration: Infinity });
    render(<Toaster />);

    act(() => toast.dismiss(drop));
    expect(screen.queryByText("Drop me")).toBeNull();
    expect(screen.getByText("Keep me")).toBeDefined();
    expect(keep).not.toBe(drop);
  });

  it("clears everything when called with no id", () => {
    toast("One", { duration: Infinity });
    toast("Two", { duration: Infinity });
    render(<Toaster />);

    act(() => toast.dismiss());
    expect(screen.queryByText("One")).toBeNull();
    expect(screen.queryByText("Two")).toBeNull();
  });

  it("closes the toast the user actually clicked", () => {
    toast("First message", { duration: Infinity });
    toast("Second message", { duration: Infinity });
    render(<Toaster />);

    // The close button is icon-only, so its accessible name is the only thing
    // distinguishing two stacked toasts for a screen-reader user.
    fireEvent.click(screen.getByRole("button", { name: "Dismiss: Second message" }));
    expect(screen.queryByText("Second message")).toBeNull();
    expect(screen.getByText("First message")).toBeDefined();
  });
});

describe("Toaster", () => {
  it("is a named region so the stack is reachable, and starts empty", () => {
    const { container } = render(<Toaster className="custom-anchor" />);
    const region = screen.getByRole("region", { name: "Notifications" });
    expect(region.className).toContain("custom-anchor");
    expect(container.querySelectorAll("[role='status'],[role='alert']"))
      .toHaveLength(0);
  });

  it("shows a toast raised after it mounted, without a provider", () => {
    render(<Toaster />);
    // The store is module-level on purpose: any module can call toast() without
    // being inside a context.
    act(() => {
      toast.warning("Heads up");
    });
    expect(screen.getByText("Heads up")).toBeDefined();
  });
});
