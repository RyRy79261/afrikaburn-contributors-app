import { describe, it, expect } from "vitest";
import {
  activityLabel,
  activityTone,
  bucketSubmissionsByMonth,
  hasSeries,
  relativeTime,
} from "../status-board-format";

describe("bucketSubmissionsByMonth — real submissions only", () => {
  it("returns nothing when there are no submissions (the chart is omitted)", () => {
    expect(bucketSubmissionsByMonth([])).toEqual([]);
    expect(hasSeries(bucketSubmissionsByMonth([]))).toBe(false);
  });

  it("a single month is not a time series", () => {
    const points = bucketSubmissionsByMonth([
      new Date("2026-09-03T10:00:00Z"),
      new Date("2026-09-28T10:00:00Z"),
    ]);
    expect(points).toEqual([{ key: "2026-09", label: "Sep", count: 2 }]);
    expect(hasSeries(points)).toBe(false);
  });

  it("fills empty months so the axis is continuous", () => {
    const points = bucketSubmissionsByMonth([
      new Date("2026-09-03T10:00:00Z"),
      new Date("2026-12-01T10:00:00Z"),
      new Date("2026-12-20T10:00:00Z"),
    ]);
    expect(points).toEqual([
      { key: "2026-09", label: "Sep", count: 1 },
      { key: "2026-10", label: "Oct", count: 0 },
      { key: "2026-11", label: "Nov", count: 0 },
      { key: "2026-12", label: "Dec", count: 2 },
    ]);
    expect(hasSeries(points)).toBe(true);
  });

  it("crosses a year boundary without losing months", () => {
    const points = bucketSubmissionsByMonth([
      new Date("2026-11-15T10:00:00Z"),
      new Date("2027-01-10T10:00:00Z"),
    ]);
    expect(points.map((p) => p.key)).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(points.map((p) => p.count)).toEqual([1, 0, 1]);
  });

  it("never counts an invalid date", () => {
    const points = bucketSubmissionsByMonth([
      new Date("not a date"),
      new Date("2027-01-10T10:00:00Z"),
    ]);
    expect(points).toEqual([{ key: "2027-01", label: "Jan", count: 1 }]);
  });

  it("total counted equals the input length", () => {
    const dates = [
      new Date("2026-09-03T10:00:00Z"),
      new Date("2026-10-03T10:00:00Z"),
      new Date("2026-10-14T10:00:00Z"),
      new Date("2026-12-31T23:00:00Z"),
    ];
    const total = bucketSubmissionsByMonth(dates).reduce(
      (sum, p) => sum + p.count,
      0,
    );
    expect(total).toBe(dates.length);
  });
});

describe("relativeTime", () => {
  const now = new Date("2027-02-01T12:00:00Z");

  it("reads in the units a console operator thinks in", () => {
    expect(relativeTime(new Date("2027-02-01T11:59:40Z"), now)).toBe(
      "just now",
    );
    expect(relativeTime(new Date("2027-02-01T11:48:00Z"), now)).toBe(
      "12 min ago",
    );
    expect(relativeTime(new Date("2027-02-01T09:00:00Z"), now)).toBe("3 h ago");
    expect(relativeTime(new Date("2027-01-30T12:00:00Z"), now)).toBe("2 d ago");
    expect(relativeTime(new Date("2026-12-01T12:00:00Z"), now)).toBe(
      "2 mo ago",
    );
  });

  it("never renders a negative age for a clock-skewed future event", () => {
    expect(relativeTime(new Date("2027-02-01T12:05:00Z"), now)).toBe(
      "just now",
    );
  });
});

describe("activityLabel / activityTone", () => {
  it("labels the known console actions", () => {
    expect(activityLabel("registration.approve")).toBe(
      "approved a registration",
    );
    expect(activityLabel("category.create")).toBe("added a camp category");
  });

  it("falls back to the raw action rather than inventing copy", () => {
    expect(activityLabel("something.new")).toBe("something.new");
    expect(activityTone("something.new")).toBe("neutral");
  });

  it("tones decisions distinctly", () => {
    expect(activityTone("registration.approve")).toBe("approve");
    expect(activityTone("registration.reject")).toBe("reject");
    expect(activityTone("registration.request_changes")).toBe("attention");
    expect(activityTone("supplier.note")).toBe("neutral");
  });
});
