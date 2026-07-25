import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  NotificationItem,
  NOTIFICATION_KIND_ICON,
  type NotificationKind,
} from "../notification-item";
import { BulletinCard } from "../bulletin-card";
import { PinnedBulletinBanner } from "../pinned-bulletin-banner";
import { Wizard } from "../wizard";
import { readRate } from "../../lib/bulletin";
import { deriveWizardProgress } from "../../lib/wizard";
import { roundTripMarkdown } from "../markdown-editor/markdown";

const ALL_KINDS: NotificationKind[] = [
  "registration",
  "wrangler",
  "role",
  "questionnaire",
  "supplier",
  "security",
  "bulletin",
];

describe("NotificationItem kind → icon map", () => {
  it("has a distinct icon for every kind (exhaustive, no gaps)", () => {
    for (const kind of ALL_KINDS) {
      // lucide icons are forwardRef components (objects) — assert renderable.
      expect(NOTIFICATION_KIND_ICON[kind]).toBeTruthy();
    }
    expect(Object.keys(NOTIFICATION_KIND_ICON).sort()).toEqual(
      [...ALL_KINDS].sort(),
    );
    const icons = Object.values(NOTIFICATION_KIND_ICON);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("derives the meta line and flags a blocking questionnaire", () => {
    render(
      <NotificationItem
        kind="questionnaire"
        title="Build week availability"
        timeAgo="2 hours ago"
        source="AfrikaBurn"
        blocking
      />,
    );
    expect(screen.getByText("2 hours ago · AfrikaBurn")).toBeDefined();
    expect(screen.getByText(/blocks registration/i)).toBeDefined();
    expect(screen.getByLabelText("Unread")).toBeDefined();
  });

  it("hides the unread dot when read", () => {
    render(<NotificationItem kind="bulletin" title="x" read />);
    expect(screen.queryByLabelText("Unread")).toBeNull();
  });
});

describe("readRate maths", () => {
  it("computes the percentage", () => {
    expect(readRate(12, 30)).toEqual({ read: 12, of: 30, percent: 40 });
    expect(readRate(1, 3).percent).toBe(33);
  });

  it("is 0% for a zero-recipient bulletin (no divide-by-zero)", () => {
    expect(readRate(0, 0)).toEqual({ read: 0, of: 0, percent: 0 });
  });

  it("clamps a stale read count into [0, of]", () => {
    expect(readRate(50, 30)).toEqual({ read: 30, of: 30, percent: 100 });
    expect(readRate(-5, 30).read).toBe(0);
  });

  it("BulletinCard renders the read-rate bar for the org list", () => {
    render(
      <BulletinCard
        title="Ticket resale window opens"
        audience="All burners"
        readRate={{ read: 12, of: 30 }}
      />,
    );
    expect(screen.getByText("12 of 30 read")).toBeDefined();
    expect(screen.getByText("40%")).toBeDefined();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "40",
    );
  });
});

describe("wizard state derivation", () => {
  const sections = [
    { id: "basics", label: "Basics", done: true },
    { id: "members", label: "Members", done: true },
    { id: "logistics", label: "Logistics" },
    { id: "safety", label: "Safety" },
    { id: "review", label: "Review", blocked: true },
  ];

  it("marks done, resolves current to the first actionable step, and counts", () => {
    const p = deriveWizardProgress(sections);
    expect(p.completed).toBe(2);
    expect(p.total).toBe(5);
    expect(p.label).toBe("2 of 5 complete");
    expect(p.currentId).toBe("logistics");
    expect(p.sections.map((s) => s.state)).toEqual([
      "done",
      "done",
      "current",
      "todo",
      "blocked",
    ]);
    expect(p.sections.map((s) => s.index)).toEqual([1, 2, 3, 4, 5]);
  });

  it("honours an explicit actionable currentId", () => {
    const p = deriveWizardProgress(sections, "safety");
    expect(p.currentId).toBe("safety");
    expect(p.sections.find((s) => s.id === "safety")?.state).toBe("current");
    expect(p.sections.find((s) => s.id === "logistics")?.state).toBe("todo");
  });

  it("falls back off a done/blocked currentId to the next actionable step", () => {
    expect(deriveWizardProgress(sections, "basics").currentId).toBe(
      "logistics",
    );
    expect(deriveWizardProgress(sections, "review").currentId).toBe(
      "logistics",
    );
  });

  it("Wizard renders the progress label in both variants", () => {
    const { rerender } = render(<Wizard sections={sections} variant="rail" />);
    expect(screen.getByText("2 of 5 complete")).toBeDefined();
    rerender(<Wizard sections={sections} variant="strip" />);
    expect(screen.getByText("2 of 5 complete")).toBeDefined();
  });
});

describe("PinnedBulletinBanner", () => {
  it("renders a Read link to the bulletin and no dismiss button by default", () => {
    render(
      <PinnedBulletinBanner
        title="Ticket resale window opens 1 March"
        href="/bulletins/resale"
      />,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/bulletins/resale");
    expect(screen.queryByLabelText("Dismiss")).toBeNull();
  });
});

describe("markdown round-trip", () => {
  it("preserves basic marks (bold / italic / heading / lists)", () => {
    expect(roundTripMarkdown("**bold**")).toContain("**bold**");
    expect(roundTripMarkdown("*italic*")).toContain("*italic*");
    expect(roundTripMarkdown("## Heading")).toContain("## Heading");

    const bullets = roundTripMarkdown("- one\n- two");
    expect(bullets).toContain("one");
    expect(bullets).toContain("two");
    expect(bullets).toMatch(/[-*]\s+one/);

    const ordered = roundTripMarkdown("1. first\n2. second");
    expect(ordered).toContain("first");
    expect(ordered).toMatch(/1\.\s+first/);
  });

  it("preserves a link's destination", () => {
    const out = roundTripMarkdown("[Quicket](https://quicket.co.za)");
    expect(out).toContain("https://quicket.co.za");
    expect(out).toContain("Quicket");
  });

  it("is idempotent on a second pass", () => {
    const once = roundTripMarkdown("**bold** and *italic*");
    expect(roundTripMarkdown(once)).toBe(once);
  });
});
