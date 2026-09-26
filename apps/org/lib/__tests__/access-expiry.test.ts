import { describe, it, expect } from "vitest";

import {
  expiryFromLastDay,
  formatLastDay,
  lastDayFromExpiry,
  resolveAssignmentExpiries,
  todayInSast,
} from "@/lib/access-expiry";

// ACCESS EXPIRY AS A DAY (SEC-019). The dialog asks for an inclusive "last day
// of access" in South African time; the column stores the instant access stops.
// The conversion is the whole risk: an off-by-one here quietly grants a day too
// many or removes one too early, and nobody notices until a volunteer is
// locked out of the console on the morning of build.

describe("expiryFromLastDay / lastDayFromExpiry", () => {
  it("a last day of 2 May 2027 stops access at 00:00 SAST on 3 May", () => {
    expect(expiryFromLastDay("2027-05-02")?.toISOString()).toBe(
      "2027-05-02T22:00:00.000Z",
    );
  });

  it("round-trips: the day a manager picked is the day the table shows", () => {
    for (const day of [
      "2027-01-01",
      "2027-05-02",
      "2027-12-31",
      "2028-02-29",
    ]) {
      const at = expiryFromLastDay(day);
      expect(at).not.toBeNull();
      expect(lastDayFromExpiry(at as Date)).toBe(day);
    }
  });

  it("refuses a day that does not exist instead of rolling it over", () => {
    expect(expiryFromLastDay("2027-02-30")).toBeNull();
    expect(expiryFromLastDay("2027-02-29")).toBeNull(); // not a leap year
    expect(expiryFromLastDay("2027-13-01")).toBeNull();
    expect(expiryFromLastDay("next tuesday")).toBeNull();
    expect(expiryFromLastDay("")).toBeNull();
  });

  it("today is judged in SAST, not UTC", () => {
    // 23:30 UTC on 1 May is already 01:30 on 2 May in Johannesburg.
    expect(todayInSast(new Date("2027-05-01T23:30:00Z"))).toBe("2027-05-02");
    expect(todayInSast(new Date("2027-05-01T21:30:00Z"))).toBe("2027-05-01");
  });

  it("formats a day the same way everywhere", () => {
    expect(formatLastDay("2027-05-02")).toMatch(/2 May 2027/);
  });
});

describe("resolveAssignmentExpiries — the write rule", () => {
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const NOW = new Date("2027-04-20T10:00:00Z");

  it("no expiries means no expiry on any assigned role", () => {
    const r = resolveAssignmentExpiries({
      roleIds: [A, B],
      expiries: [],
      stored: new Map(),
      now: NOW,
    });
    expect(r).toEqual({
      ok: true,
      expiries: new Map([
        [A, null],
        [B, null],
      ]),
    });
  });

  it("stores the instant for a future last day", () => {
    const r = resolveAssignmentExpiries({
      roleIds: [A],
      expiries: [{ roleId: A, lastDay: "2027-05-02" }],
      stored: new Map(),
      now: NOW,
    });
    expect(r.ok && r.expiries.get(A)?.toISOString()).toBe(
      "2027-05-02T22:00:00.000Z",
    );
  });

  it("refuses a NEW last day that has already passed", () => {
    const r = resolveAssignmentExpiries({
      roleIds: [A],
      expiries: [{ roleId: A, lastDay: "2027-04-01" }],
      stored: new Map(),
      now: NOW,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/already passed/);
  });

  it("today is still a valid last day — access runs to midnight", () => {
    const r = resolveAssignmentExpiries({
      roleIds: [A],
      expiries: [{ roleId: A, lastDay: todayInSast(NOW) }],
      stored: new Map(),
      now: NOW,
    });
    expect(r.ok).toBe(true);
  });

  it("KEEPS an unchanged expired expiry, exactly as stored", () => {
    // Editing someone's other roles must not force a decision about the
    // expired one — it stays, expired and renewable.
    const stored = new Date("2027-04-01T22:00:00Z");
    const r = resolveAssignmentExpiries({
      roleIds: [A],
      expiries: [{ roleId: A, lastDay: lastDayFromExpiry(stored) }],
      stored: new Map([[A, stored]]),
      now: NOW,
    });
    expect(r.ok && r.expiries.get(A)).toBe(stored);
  });

  it("…but refuses CHANGING an expired expiry to another past day", () => {
    const stored = new Date("2027-04-01T22:00:00Z");
    const r = resolveAssignmentExpiries({
      roleIds: [A],
      expiries: [{ roleId: A, lastDay: "2027-04-05" }],
      stored: new Map([[A, stored]]),
      now: NOW,
    });
    expect(r.ok).toBe(false);
  });

  it("clearing the expiry renews without an end date", () => {
    const r = resolveAssignmentExpiries({
      roleIds: [A],
      expiries: [{ roleId: A, lastDay: null }],
      stored: new Map([[A, new Date("2027-04-01T22:00:00Z")]]),
      now: NOW,
    });
    expect(r.ok && r.expiries.get(A)).toBeNull();
  });

  it("refuses an expiry for a role that is not being assigned", () => {
    const r = resolveAssignmentExpiries({
      roleIds: [A],
      expiries: [{ roleId: B, lastDay: "2027-05-02" }],
      stored: new Map(),
      now: NOW,
    });
    expect(r.ok).toBe(false);
  });

  it("refuses a day that does not exist", () => {
    const r = resolveAssignmentExpiries({
      roleIds: [A],
      expiries: [{ roleId: A, lastDay: "2027-02-30" }],
      stored: new Map(),
      now: NOW,
    });
    expect(r).toEqual({ ok: false, error: '"2027-02-30" is not a date.' });
  });
});
