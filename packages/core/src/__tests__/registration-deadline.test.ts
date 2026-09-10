import { describe, it, expect } from "vitest";

import {
  daysUntil,
  dueReminderMilestone,
  isRemindable,
  reminderMarkerSubject,
  registrationDeadlineNotification,
  REMINDER_MILESTONES,
} from "../registration-deadline";

describe("daysUntil", () => {
  it("counts whole calendar days in UTC", () => {
    expect(daysUntil("2026-09-30T00:00:00Z", "2026-09-23T00:00:00Z")).toBe(7);
  });

  it("ignores the time of day on both ends", () => {
    // The regression this exists for: a 03:00 cron must not decide a deadline
    // 23 hours away is "0 days" on one run and "1 day" on the next.
    expect(daysUntil("2026-09-30T23:59:00Z", "2026-09-29T03:00:00Z")).toBe(1);
    expect(daysUntil("2026-09-30T09:00:00Z", "2026-09-29T21:00:00Z")).toBe(1);
  });

  it("goes negative once the deadline has passed", () => {
    expect(daysUntil("2026-09-30T00:00:00Z", "2026-10-02T00:00:00Z")).toBe(-2);
  });
});

describe("dueReminderMilestone", () => {
  it.each(REMINDER_MILESTONES)("fires exactly on the %i-day mark", (days) => {
    const closesAt = new Date("2026-09-30T23:59:00Z");
    const now = new Date(closesAt);
    now.setUTCDate(now.getUTCDate() - days);
    expect(dueReminderMilestone(closesAt, now)).toBe(days);
  });

  it("stays quiet on every other day", () => {
    const closesAt = "2026-09-30T23:59:00Z";
    for (const offset of [30, 22, 20, 14, 8, 6, 2, 0, -1]) {
      const now = new Date("2026-09-30T23:59:00Z");
      now.setUTCDate(now.getUTCDate() - offset);
      expect(dueReminderMilestone(closesAt, now)).toBeNull();
    }
  });

  it("reminds nobody when no deadline is set", () => {
    // The seeded 2027 edition genuinely has no confirmed opening date yet.
    expect(dueReminderMilestone(null, "2026-09-23T00:00:00Z")).toBeNull();
    expect(dueReminderMilestone(undefined, "2026-09-23T00:00:00Z")).toBeNull();
  });

  it("does not fire every missed milestone at once after an outage", () => {
    // A job that misses the 21-day mark must not send it late alongside the
    // 7-day one; three reminders at once reads as a malfunction.
    const closesAt = "2026-09-30T23:59:00Z";
    expect(dueReminderMilestone(closesAt, "2026-09-23T00:00:00Z")).toBe(7);
  });
});

describe("isRemindable", () => {
  it("reminds a camp that still owes something", () => {
    expect(isRemindable("draft")).toBe(true);
    expect(isRemindable("changes_requested")).toBe(true);
  });

  it("leaves everyone else alone", () => {
    for (const status of [
      "submitted",
      "under_review",
      "approved",
      "rejected",
      "withdrawn",
    ]) {
      expect(isRemindable(status)).toBe(false);
    }
  });
});

describe("reminderMarkerSubject", () => {
  it("is unique per edition and milestone", () => {
    const edition = "8f1c2d3e-0000-4000-8000-000000000000";
    expect(reminderMarkerSubject(edition, 7)).toBe(`${edition}:deadline-7`);
    expect(reminderMarkerSubject(edition, 21)).not.toBe(
      reminderMarkerSubject(edition, 7),
    );
  });
});

describe("registrationDeadlineNotification", () => {
  it("says 'tomorrow' rather than 'in 1 days'", () => {
    const payload = registrationDeadlineNotification({
      campName: "Mad Hatters",
      campSlug: "mad-hatters",
      daysRemaining: 1,
      changesRequested: false,
    });
    expect(payload.title).toContain("tomorrow");
    expect(payload.title).not.toContain("1 days");
  });

  it("counts plural days otherwise", () => {
    const payload = registrationDeadlineNotification({
      campName: "Mad Hatters",
      campSlug: "mad-hatters",
      daysRemaining: 7,
      changesRequested: false,
    });
    expect(payload.title).toContain("in 7 days");
  });

  it("tells a changes-requested camp that the ball is theirs", () => {
    const payload = registrationDeadlineNotification({
      campName: "Mad Hatters",
      campSlug: "mad-hatters",
      daysRemaining: 7,
      changesRequested: true,
    });
    expect(payload.title).toContain("waiting on your changes");
    expect(payload.body).toContain("resubmit");
  });

  it("links to the camp's own registration and files under the registration lane", () => {
    const payload = registrationDeadlineNotification({
      campName: "Mad Hatters",
      campSlug: "mad-hatters",
      daysRemaining: 21,
      changesRequested: false,
    });
    expect(payload.link).toBe("/camps/mad-hatters/registration");
    expect(payload.kind).toBe("registration");
  });
});
