import { describe, expect, it } from "vitest";
import {
  NotificationKind,
  WAP_REQUEST_MAX,
  WapAllocateInput,
  WapApprovedPass,
  WapGrantInput,
  WapListReturnInput,
  WapListStatus,
  WapOverrideInput,
  WapRequestInput,
  WapRequestStatus,
  WapWindowInput,
} from "../index";

const ID = "6f1c1a52-7c0e-4b8a-9d8e-2f4a3b5c6d7e";

describe("WAP vocabularies", () => {
  it("lock the list and request statuses", () => {
    expect(WapListStatus.options).toEqual([
      "draft",
      "submitted",
      "approved",
      "returned",
    ]);
    expect(WapRequestStatus.options).toEqual([
      "pending",
      "granted",
      "declined",
    ]);
  });

  it("adds the `wap` notification kind", () => {
    expect(NotificationKind.safeParse("wap").success).toBe(true);
  });
});

describe("WapRequestInput", () => {
  it("accepts a positive whole number and blanks the reason to null", () => {
    expect(
      WapRequestInput.parse({ slug: "the-camp", requested: 4, reason: "  " }),
    ).toEqual({
      slug: "the-camp",
      requested: 4,
      reason: null,
    });
    expect(
      WapRequestInput.parse({ slug: "the-camp", requested: 4 }).reason,
    ).toBeNull();
  });

  it("refuses zero, negatives, fractions and absurd numbers", () => {
    for (const requested of [0, -1, 1.5, WAP_REQUEST_MAX + 1]) {
      expect(WapRequestInput.safeParse({ slug: "x", requested }).success).toBe(
        false,
      );
    }
  });

  it("is strict: a request cannot name who is asking", () => {
    expect(
      WapRequestInput.safeParse({
        slug: "x",
        requested: 2,
        requestedByUserId: ID,
      }).success,
    ).toBe(false);
    expect(
      WapAllocateInput.safeParse({ slug: "x", membershipId: ID, userId: ID })
        .success,
    ).toBe(false);
  });
});

describe("WapOverrideInput", () => {
  const base = {
    slug: "x",
    allocationId: ID,
    arrivalDate: null,
    departureDate: null,
    build: null,
    strike: null,
  };

  it("accepts all-null (follow the roster) and real dates", () => {
    expect(WapOverrideInput.safeParse(base).success).toBe(true);
    expect(
      WapOverrideInput.safeParse({
        ...base,
        arrivalDate: "2027-04-22",
        departureDate: "2027-05-03",
        build: true,
      }).success,
    ).toBe(true);
  });

  it("refuses a rolled-over date and arrival after departure", () => {
    expect(
      WapOverrideInput.safeParse({ ...base, arrivalDate: "2027-02-31" })
        .success,
    ).toBe(false);
    expect(
      WapOverrideInput.safeParse({ ...base, arrivalDate: "22/04/2027" })
        .success,
    ).toBe(false);
    expect(
      WapOverrideInput.safeParse({
        ...base,
        arrivalDate: "2027-05-04",
        departureDate: "2027-05-03",
      }).success,
    ).toBe(false);
  });
});

describe("org inputs", () => {
  it("grant is a positive whole number", () => {
    expect(WapGrantInput.safeParse({ requestId: ID, granted: 3 }).success).toBe(
      true,
    );
    expect(WapGrantInput.safeParse({ requestId: ID, granted: 0 }).success).toBe(
      false,
    );
    expect(
      WapGrantInput.safeParse({ requestId: "nope", granted: 3 }).success,
    ).toBe(false);
  });

  it("return needs a note", () => {
    expect(
      WapListReturnInput.safeParse({
        registrationId: ID,
        note: "Swap out one name.",
      }).success,
    ).toBe(true);
    expect(
      WapListReturnInput.safeParse({ registrationId: ID, note: "   " }).success,
    ).toBe(false);
  });

  it("window is open or close only", () => {
    expect(
      WapWindowInput.safeParse({ editionId: ID, action: "open" }).success,
    ).toBe(true);
    expect(
      WapWindowInput.safeParse({ editionId: ID, action: "pause" }).success,
    ).toBe(false);
  });

  it("an approved-pass snapshot entry carries ids and values, no name", () => {
    const entry = {
      membershipId: ID,
      userId: ID,
      arrivalDate: "2027-04-22",
      departureDate: null,
      build: true,
      strike: null,
    };
    expect(WapApprovedPass.parse(entry)).toEqual(entry);
    expect(Object.keys(WapApprovedPass.shape)).not.toContain("name");
  });
});
