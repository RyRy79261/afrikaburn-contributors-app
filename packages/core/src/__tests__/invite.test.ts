import { describe, it, expect } from "vitest";
import {
  canRedeemInvite,
  canRedeemInviteAs,
  inviteRejectionMessage,
  type InviteLike,
} from "../invite";

const NOW = new Date("2027-01-01T12:00:00Z");

function invite(overrides: Partial<InviteLike> = {}): InviteLike {
  return {
    kind: "member",
    expiresAt: null,
    usedAt: null,
    usedByUserId: null,
    ...overrides,
  };
}

describe("invite single-use", () => {
  it("accepts a fresh, unexpired invite", () => {
    expect(canRedeemInvite(invite(), NOW)).toEqual({ ok: true, reason: null });
  });

  it("rejects an invite already stamped used (usedAt)", () => {
    const used = invite({ usedAt: new Date("2026-12-31T00:00:00Z") });
    expect(canRedeemInvite(used, NOW)).toEqual({
      ok: false,
      reason: "already_used",
    });
  });

  it("rejects an invite claimed by a user (usedByUserId) even without usedAt", () => {
    const claimed = invite({ usedByUserId: "user-123" });
    expect(canRedeemInvite(claimed, NOW).reason).toBe("already_used");
  });

  it("used state wins over expiry — a spent invite reports used, not expired", () => {
    const spent = invite({
      usedAt: new Date("2026-01-01T00:00:00Z"),
      expiresAt: new Date("2026-06-01T00:00:00Z"),
    });
    expect(canRedeemInvite(spent, NOW).reason).toBe("already_used");
  });

  it("rejects an expired invite", () => {
    const expired = invite({ expiresAt: new Date("2026-12-01T00:00:00Z") });
    expect(canRedeemInvite(expired, NOW).reason).toBe("expired");
  });

  it("treats the exact expiry instant as expired (boundary)", () => {
    expect(canRedeemInvite(invite({ expiresAt: NOW }), NOW).reason).toBe(
      "expired",
    );
  });

  it("a null expiry never expires", () => {
    const future = new Date("2099-01-01T00:00:00Z");
    expect(canRedeemInvite(invite({ expiresAt: null }), future).ok).toBe(true);
  });
});

describe("invite redemption by a specific redeemer", () => {
  it("blocks an existing member from re-using a member invite", () => {
    const res = canRedeemInviteAs(invite(), { isMember: true }, NOW);
    expect(res).toEqual({ ok: false, reason: "self_member" });
  });

  it("allows an existing member to redeem a lead_transfer invite", () => {
    const res = canRedeemInviteAs(
      invite({ kind: "lead_transfer" }),
      { isMember: true },
      NOW,
    );
    expect(res.ok).toBe(true);
  });

  it("still enforces single-use before the membership check", () => {
    const res = canRedeemInviteAs(
      invite({ kind: "lead_transfer", usedAt: NOW }),
      { isMember: true },
      NOW,
    );
    expect(res.reason).toBe("already_used");
  });
});

describe("invite rejection messages", () => {
  it("has copy for every reason", () => {
    for (const reason of ["already_used", "expired", "self_member"] as const) {
      expect(inviteRejectionMessage(reason).length).toBeGreaterThan(0);
    }
  });
});
