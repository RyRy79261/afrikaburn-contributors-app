import { describe, it, expect } from "vitest";

import {
  canTransitionPayment,
  assertPaymentTransition,
  isSettled,
  paymentStatusLabel,
  assertRecordableAmount,
  PAYMENT_TRANSITIONS,
  PAYMENT_TRACKING_DISCLAIMER,
} from "../payment-tracking";

describe("payment transitions", () => {
  it("lets a staff member tick and untick", () => {
    // Every state here is a human's observation, and humans tick the wrong row.
    expect(canTransitionPayment("pending", "reconciled")).toBe(true);
    expect(canTransitionPayment("reconciled", "pending")).toBe(true);
    expect(canTransitionPayment("waived", "reconciled")).toBe(true);
  });

  it("has no terminal state", () => {
    for (const [from, to] of Object.entries(PAYMENT_TRANSITIONS)) {
      expect(to.length, `${from} should be reversible`).toBeGreaterThan(0);
    }
  });

  it("refuses a no-op transition", () => {
    expect(canTransitionPayment("pending", "pending")).toBe(false);
    expect(() => assertPaymentTransition("pending", "pending")).toThrow(
      /Illegal payment transition/,
    );
  });

  it("returns the target on a legal transition", () => {
    expect(assertPaymentTransition("pending", "reconciled")).toBe("reconciled");
  });
});

describe("isSettled", () => {
  it("treats paid and waived as nothing further owed", () => {
    expect(isSettled("reconciled")).toBe(true);
    expect(isSettled("waived")).toBe(true);
    expect(isSettled("pending")).toBe(false);
  });
});

describe("paymentStatusLabel", () => {
  it("reads as an observation, not a transaction", () => {
    expect(paymentStatusLabel("pending")).toBe("Awaiting payment");
    expect(paymentStatusLabel("reconciled")).toBe("Paid");
    expect(paymentStatusLabel("waived")).toBe("Waived");
  });
});

describe("the never-holds-funds posture", () => {
  it("states plainly who collected the money", () => {
    expect(PAYMENT_TRACKING_DISCLAIMER).toContain("own channels");
    expect(PAYMENT_TRACKING_DISCLAIMER).toContain("only records");
  });

  it("accepts an absent amount — the reference and the tick are the point", () => {
    expect(assertRecordableAmount(null)).toBeNull();
    expect(assertRecordableAmount(undefined)).toBeNull();
  });

  it("accepts a whole-cent note of what was invoiced elsewhere", () => {
    expect(assertRecordableAmount(85_000)).toBe(85_000);
    expect(assertRecordableAmount(0)).toBe(0);
  });

  it("refuses a negative amount, because a refund implies we took money", () => {
    expect(() => assertRecordableAmount(-1)).toThrow(/never negative/);
  });

  it("refuses fractional cents", () => {
    expect(() => assertRecordableAmount(12.5)).toThrow(/whole number/);
  });
});
