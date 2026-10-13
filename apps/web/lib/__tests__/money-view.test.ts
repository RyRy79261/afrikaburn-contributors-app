import { describe, expect, it } from "vitest";
import {
  CLAIM_STATUS_BADGE,
  DUES_STATUS_BADGE,
  claimMetaLine,
  claimStatusLabel,
  duesStatusLabel,
  plural,
  duesBreakdown,
  moneyDayLabel,
  parseClaimFilter,
  parseMoneyTab,
  receiptHref,
  todayInSouthAfrica,
} from "@/lib/money-view";

// The money page's presentation helpers (frames M1–M4). The figures come from
// @quagga/core; these only decide how a day, a tab or a claim's line reads.

describe("money view helpers", () => {
  it("reads a calendar day as that day, and a timestamp as the day in South Africa", () => {
    expect(moneyDayLabel("2027-04-09")).toBe("9 Apr 2027");
    // 23:30 UTC on 2 Mar is already 3 Mar in Cape Town.
    expect(moneyDayLabel(new Date("2027-03-02T23:30:00Z"))).toBe("3 Mar 2027");
    expect(moneyDayLabel(null)).toBe("—");
  });

  it("gives today as the South African calendar day", () => {
    expect(todayInSouthAfrica(new Date("2027-04-13T22:30:00Z"))).toBe(
      "2027-04-14",
    );
    expect(todayInSouthAfrica(new Date("2027-04-13T21:59:00Z"))).toBe(
      "2027-04-13",
    );
  });

  it("only ever links a receipt through the authorised route", () => {
    expect(receiptHref("claim", "c1")).toBe("/api/money/receipts/claim/c1");
    expect(receiptHref("entry", "e1")).toBe("/api/money/receipts/entry/e1");
  });

  it("takes an unknown tab or filter as the default", () => {
    expect(parseMoneyTab("dues")).toBe("dues");
    expect(parseMoneyTab(["claims", "dues"])).toBe("claims");
    expect(parseMoneyTab("admin")).toBe("budget");
    expect(parseMoneyTab(undefined)).toBe("budget");
    expect(parseClaimFilter("repaid")).toBe("repaid");
    expect(parseClaimFilter("everything")).toBe("all");
  });

  it("writes each claim's line for its audience", () => {
    const approved = {
      status: "approved" as const,
      categoryName: "Transport",
      createdAt: new Date("2027-04-01T10:00:00Z"),
      decidedAt: new Date("2027-04-06T10:00:00Z"),
      decidedByName: "Alice Hatter",
      repaidOn: null,
    };
    expect(claimMetaLine(approved, "member")).toBe(
      "Transport · Approved 6 Apr 2027 · the camp repays you by EFT",
    );
    expect(claimMetaLine(approved, "money")).toBe(
      "Transport · Approved by Alice Hatter on 6 Apr 2027 · not repaid yet",
    );
    expect(
      claimMetaLine(
        { ...approved, status: "repaid", repaidOn: "2027-03-28" },
        "member",
      ),
    ).toBe("Transport · Repaid on 28 Mar 2027");
    expect(
      claimMetaLine(
        { ...approved, status: "submitted", categoryName: null },
        "money",
      ),
    ).toBe("No category yet · Submitted 1 Apr 2027");
  });

  it("breaks down who has not paid up (M2: 3 part paid · 3 awaiting · 1 waived)", () => {
    expect(
      duesBreakdown({
        paid: 13,
        part_paid: 3,
        awaiting: 3,
        waived: 1,
        no_fee: 0,
      }),
    ).toBe("3 part paid · 3 awaiting · 1 waived");
    expect(
      duesBreakdown({
        paid: 4,
        part_paid: 0,
        awaiting: 0,
        waived: 0,
        no_fee: 0,
      }),
    ).toBe("Nobody owes anything");
    expect(
      duesBreakdown({
        paid: 0,
        part_paid: 0,
        awaiting: 0,
        waived: 0,
        no_fee: 4,
      }),
    ).toBe("4 with no fee set");
  });

  it("labels and colours every status, and counts in words", () => {
    expect(duesStatusLabel("part_paid")).toBe("Part paid");
    expect(duesStatusLabel("no_fee")).toBe("No fee set");
    expect(claimStatusLabel("repaid")).toBe("Repaid");
    expect(DUES_STATUS_BADGE.paid).toBe("success");
    expect(CLAIM_STATUS_BADGE.rejected).toBe("destructive");
    expect(plural(1, "member")).toBe("1 member");
    expect(plural(6, "member")).toBe("6 members");
  });

  it("says who rejected a claim to the money people, and only when to the member", () => {
    const rejected = {
      status: "rejected" as const,
      categoryName: "Sound",
      createdAt: new Date("2027-03-30T10:00:00Z"),
      decidedAt: new Date("2027-04-02T10:00:00Z"),
      decidedByName: null,
      repaidOn: null,
    };
    expect(claimMetaLine(rejected, "member")).toBe(
      "Sound · Rejected 2 Apr 2027",
    );
    expect(claimMetaLine(rejected, "money")).toBe(
      "Sound · Rejected by a money person on 2 Apr 2027",
    );
    expect(moneyDayLabel("not a day")).toBe("not a day");
  });
});
