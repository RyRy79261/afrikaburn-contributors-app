import { describe, it, expect } from "vitest";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  assessPassword,
  ENUMERATION_SAFE_MESSAGES,
  enumerationSafeMessage,
  enumerationSafeResponse,
  leaksAccountExistence,
  DELETION_GRACE_PERIOD_DAYS,
  deletionGraceEndsAt,
  deletionPhase,
  deletionDaysRemaining,
  canCancelDeletion,
  isSanitizationDue,
  cancelDeletionOnSignIn,
  assessDeletionEligibility,
  canUnlinkSignInMethod,
  EMAIL_CHANGE_CONFIRM_TTL_HOURS,
  EMAIL_CHANGE_REVOCATION_HOURS,
  emailChangeExpiresAt,
  emailChangeRevocableUntil,
  emailChangePhase,
  canConfirmEmailChange,
  canRevokeEmailChange,
  isEmailChangeEffective,
  emailChangeHoursToRevoke,
  type DeletionGuardContext,
  type DeletionRequestState,
  type EmailChangeState,
} from "../account-security";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const T0 = new Date("2026-07-25T12:00:00.000Z");

// --- Password policy (NIST SP 800-63B-4) ---------------------------------

describe("assessPassword", () => {
  it("requires 15 characters and accepts 64", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(15);
    expect(PASSWORD_MAX_LENGTH).toBe(64);
    expect(assessPassword("a".repeat(14)).ok).toBe(false);
    expect(assessPassword("a".repeat(15)).ok).toBe(true);
    expect(assessPassword("a".repeat(64)).ok).toBe(true);
    expect(assessPassword("a".repeat(65)).ok).toBe(false);
  });

  it("imposes NO composition rules — a long all-lowercase passphrase passes", () => {
    const passphrase = "correct horse battery staple";
    const result = assessPassword(passphrase);
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
  });

  it("treats spaces as real characters rather than trimming them", () => {
    // 15 spaces is a terrible password but it is not SHORT, and the policy only
    // measures length — trimming here would silently reject a valid passphrase
    // that merely begins or ends with a space.
    expect(assessPassword(" ".repeat(15)).length).toBe(15);
    expect(assessPassword("  a passphrase here  ").ok).toBe(true);
  });

  it("counts a short password's shortfall so the UI can say how far to go", () => {
    const result = assessPassword("short");
    expect(result.remaining).toBe(PASSWORD_MIN_LENGTH - 5);
    expect(result.strength).toBe("too_short");
    expect(result.error).toContain("10 more characters");
  });

  it("bands strength by length only", () => {
    expect(assessPassword("a".repeat(15)).strength).toBe("fair");
    expect(assessPassword("a".repeat(18)).strength).toBe("good");
    expect(assessPassword("a".repeat(24)).strength).toBe("strong");
  });

  it("counts astral characters once, not twice (emoji passphrases)", () => {
    // Fifteen 4-byte emoji: .length would report 30 and wrongly pass a 15-char
    // check on a 15-grapheme value; the code-point count is the honest one.
    const emoji = "🔥".repeat(15);
    expect(emoji.length).toBe(30);
    expect(assessPassword(emoji).length).toBe(15);
    expect(assessPassword(emoji).ok).toBe(true);
    expect(assessPassword("🔥".repeat(14)).ok).toBe(false);
  });

  it("normalises to NFKC so the same typed passphrase measures the same everywhere", () => {
    const composed = "é".repeat(15); // single code point
    const decomposed = "é".repeat(15); // e + combining acute
    expect(composed).not.toBe(decomposed); // genuinely different strings…
    expect(assessPassword(composed).length).toBe(15);
    // …that must measure the same, or a macOS user's 15-character passphrase
    // would pass while the identical Windows one failed.
    expect(assessPassword(decomposed).length).toBe(
      assessPassword(composed).length,
    );
  });
});

// --- Enumeration safety ---------------------------------------------------

describe("enumeration-safe messaging", () => {
  it("returns an identical message whether or not the account existed", () => {
    for (const surface of [
      "sign_in",
      "sign_up",
      "forgot_password",
      "email_change_request",
    ] as const) {
      const existed = enumerationSafeResponse(surface, true);
      const missing = enumerationSafeResponse(surface, false);
      expect(existed.message).toBe(missing.message);
      expect(existed.message).toBe(enumerationSafeMessage(surface));
    }
  });

  it("ships copy that never leaks account existence", () => {
    for (const message of Object.values(ENUMERATION_SAFE_MESSAGES)) {
      expect(leaksAccountExistence(message)).toBe(false);
    }
  });

  it("detects the phrases that WOULD leak existence", () => {
    expect(leaksAccountExistence("No account with that email")).toBe(true);
    expect(leaksAccountExistence("That email is already registered")).toBe(
      true,
    );
    expect(leaksAccountExistence("User not found")).toBe(true);
    expect(leaksAccountExistence("That email address is already taken")).toBe(
      true,
    );
  });

  it("phrases forgot-password conditionally, per the spec's exact wording", () => {
    expect(ENUMERATION_SAFE_MESSAGES.forgot_password).toContain(
      "If that account exists",
    );
  });
});

// --- Deletion grace-period state machine ---------------------------------

function pending(
  overrides: Partial<DeletionRequestState> = {},
): DeletionRequestState {
  return {
    status: "pending",
    requestedAt: T0,
    graceEndsAt: deletionGraceEndsAt(T0),
    ...overrides,
  };
}

describe("deletion grace period", () => {
  it("is 14 days, and grace ends exactly 14 days after the request", () => {
    expect(DELETION_GRACE_PERIOD_DAYS).toBe(14);
    expect(deletionGraceEndsAt(T0).getTime() - T0.getTime()).toBe(14 * DAY);
  });

  it("walks none → grace → due", () => {
    expect(deletionPhase(null, T0)).toBe("none");
    expect(deletionPhase(pending(), T0)).toBe("grace");
    expect(deletionPhase(pending(), new Date(T0.getTime() + 13 * DAY))).toBe(
      "grace",
    );
    expect(deletionPhase(pending(), new Date(T0.getTime() + 14 * DAY))).toBe(
      "due",
    );
  });

  it("treats the exact boundary instant as due, not grace", () => {
    const at = deletionGraceEndsAt(T0);
    expect(deletionPhase(pending(), at)).toBe("due");
    expect(deletionPhase(pending(), new Date(at.getTime() - 1))).toBe("grace");
  });

  it("reports cancelled and completed terminally", () => {
    expect(
      deletionPhase(pending({ status: "cancelled", cancelledAt: T0 }), T0),
    ).toBe("cancelled");
    expect(
      deletionPhase(pending({ status: "completed", completedAt: T0 }), T0),
    ).toBe("sanitized");
  });

  it("counts whole days remaining, floored at zero", () => {
    expect(deletionDaysRemaining(pending(), T0)).toBe(14);
    expect(
      deletionDaysRemaining(pending(), new Date(T0.getTime() + 13.5 * DAY)),
    ).toBe(1);
    expect(
      deletionDaysRemaining(pending(), new Date(T0.getTime() + 20 * DAY)),
    ).toBe(0);
    expect(deletionDaysRemaining(null, T0)).toBe(0);
  });

  it("allows cancellation only during grace", () => {
    expect(canCancelDeletion(pending(), T0)).toBe(true);
    expect(
      canCancelDeletion(pending(), new Date(T0.getTime() + 14 * DAY)),
    ).toBe(false);
    expect(canCancelDeletion(pending({ status: "cancelled" }), T0)).toBe(false);
    expect(canCancelDeletion(null, T0)).toBe(false);
  });

  it("marks sanitization due ONLY for an elapsed pending request", () => {
    const elapsed = new Date(T0.getTime() + 15 * DAY);
    expect(isSanitizationDue(pending(), elapsed)).toBe(true);
    expect(isSanitizationDue(pending(), T0)).toBe(false);
    // Never re-process a resolved request, however long ago it resolved.
    expect(isSanitizationDue(pending({ status: "cancelled" }), elapsed)).toBe(
      false,
    );
    expect(isSanitizationDue(pending({ status: "completed" }), elapsed)).toBe(
      false,
    );
    expect(isSanitizationDue(null, elapsed)).toBe(false);
  });

  it("cancels on sign-in during grace", () => {
    const result = cancelDeletionOnSignIn(pending(), T0);
    expect(result).toEqual({ ok: true, status: "cancelled", at: T0 });
  });

  it("REFUSES to rescue a request whose grace already elapsed", () => {
    // A login must not race the sweeper into a half-deleted state.
    const result = cancelDeletionOnSignIn(
      pending(),
      new Date(T0.getTime() + 15 * DAY),
    );
    expect(result.ok).toBe(false);
  });

  it("is a no-op when nothing is pending", () => {
    expect(cancelDeletionOnSignIn(null, T0).ok).toBe(false);
    expect(
      cancelDeletionOnSignIn(pending({ status: "cancelled" }), T0).ok,
    ).toBe(false);
  });
});

// --- Deletion guards ------------------------------------------------------

function ctx(
  overrides: Partial<DeletionGuardContext> = {},
): DeletionGuardContext {
  return {
    ledProjects: [],
    isOrgGod: false,
    orgGodCount: 0,
    signInMethodCount: 1,
    ...overrides,
  };
}

describe("assessDeletionEligibility — the warnings nobody was getting", () => {
  // Every one of these is a live-data finding from 31 Jul 2026, on a deployed
  // product. The assessor knew only about `god`, so an org staffer and a
  // supplier contact could both delete through the participant app and be told
  // nothing about what it would take with them.

  it("warns that console access is revoked, without blocking", () => {
    // NOT a block: losing an org_staff account strands nobody, unlike the last
    // System manager. But the consequence copy never mentioned console access
    // at all, and the person deleting is usually the only one who knows they
    // had it.
    const result = assessDeletionEligibility(ctx({ orgRole: "org_staff" }));
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("org_access_revoked");
  });

  it("does not warn about console access for a plain member", () => {
    expect(
      assessDeletionEligibility(ctx({ orgRole: "member" })).warnings,
    ).toEqual([]);
    expect(assessDeletionEligibility(ctx({ orgRole: null })).warnings).toEqual(
      [],
    );
  });

  it("warns that a claimed supplier listing is released, and names it", () => {
    const result = assessDeletionEligibility(
      ctx({ claimedSupplierName: "Karoo Ice" }),
    );
    expect(result.ok).toBe(true);
    const warning = result.warnings.find(
      (w) => w.code === "supplier_listing_released",
    );
    expect(warning?.message).toContain("Karoo Ice");
    // THE HONEST HALF. `suppliers.contact` is a field on the BUSINESS record and
    // survives erasure — it is also what the claim path matches addresses
    // against. The delete page promises "your email address" is erased, so this
    // warning has to say plainly that the one on the business record is not.
    expect(warning?.message).toMatch(/contact address .* is not erased/i);
  });

  it("warns about an unfinished supplier onboarding — the field that was never set", () => {
    // `hasInFlightSupplierOnboarding` has been declared here and checked here
    // since it was written, and NOTHING populated it, so this card had never
    // rendered for anyone. The message was already written; only the value was
    // missing.
    const result = assessDeletionEligibility(
      ctx({ hasInFlightSupplierOnboarding: true }),
    );
    const warning = result.warnings.find(
      (w) => w.code === "supplier_onboarding_in_flight",
    );
    expect(warning).toBeDefined();
    // AND IT MUST NOT PROMISE A NOTIFICATION. The original copy said deleting
    // "notifies the AfrikaBurn supplier team" and nothing sends that — harmless
    // only for as long as the warning never rendered, which is exactly how long
    // nobody noticed.
    expect(warning?.message).not.toMatch(/notif/i);
  });

  it("reports every warning at once, like it reports every block", () => {
    const result = assessDeletionEligibility(
      ctx({
        orgRole: "engineer",
        claimedSupplierName: "Karoo Ice",
        hasInFlightSupplierOnboarding: true,
      }),
    );
    expect(result.warnings).toHaveLength(3);
  });
});

describe("assessDeletionEligibility", () => {
  it("permits deletion for an ordinary member", () => {
    expect(assessDeletionEligibility(ctx()).ok).toBe(true);
  });

  it("BLOCKS a sole camp lead and names the camp to hand over", () => {
    const result = assessDeletionEligibility(
      ctx({
        ledProjects: [{ groupId: "g1", name: "Mad Hatters", leadCount: 1 }],
      }),
    );
    expect(result.ok).toBe(false);
    const block = result.blocks.find((b) => b.code === "sole_camp_lead");
    expect(block?.message).toContain("Mad Hatters");
    expect(block?.groupIds).toEqual(["g1"]);
  });

  it("permits a lead who is NOT the only lead", () => {
    const result = assessDeletionEligibility(
      ctx({
        ledProjects: [{ groupId: "g1", name: "Mad Hatters", leadCount: 2 }],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("lists every camp when sole lead of several", () => {
    const result = assessDeletionEligibility(
      ctx({
        ledProjects: [
          { groupId: "g1", name: "Mad Hatters", leadCount: 1 },
          { groupId: "g2", name: "Camp 404", leadCount: 3 },
          { groupId: "g3", name: "Dust Bunnies", leadCount: 1 },
        ],
      }),
    );
    const block = result.blocks.find((b) => b.code === "sole_camp_lead");
    expect(block?.groupIds).toEqual(["g1", "g3"]);
    expect(block?.message).toContain("Mad Hatters");
    expect(block?.message).toContain("Dust Bunnies");
    expect(block?.message).not.toContain("Camp 404");
  });

  it("BLOCKS the sole org god from self-deleting", () => {
    const result = assessDeletionEligibility(
      ctx({ isOrgGod: true, orgGodCount: 1 }),
    );
    expect(result.ok).toBe(false);
    expect(result.blocks.map((b) => b.code)).toContain("sole_org_god");
  });

  it("permits a god when another god exists", () => {
    expect(
      assessDeletionEligibility(ctx({ isOrgGod: true, orgGodCount: 2 })).ok,
    ).toBe(true);
  });

  it("does not block a non-god just because only one god exists", () => {
    expect(
      assessDeletionEligibility(ctx({ isOrgGod: false, orgGodCount: 1 })).ok,
    ).toBe(true);
  });

  it("BLOCKS when there is no usable sign-in method left", () => {
    const result = assessDeletionEligibility(ctx({ signInMethodCount: 0 }));
    expect(result.blocks.map((b) => b.code)).toContain("no_sign_in_method");
  });

  it("returns EVERY block at once rather than the first", () => {
    const result = assessDeletionEligibility(
      ctx({
        ledProjects: [{ groupId: "g1", name: "Mad Hatters", leadCount: 1 }],
        isOrgGod: true,
        orgGodCount: 1,
        signInMethodCount: 0,
      }),
    );
    expect(result.blocks.map((b) => b.code).sort()).toEqual([
      "no_sign_in_method",
      "sole_camp_lead",
      "sole_org_god",
    ]);
  });

  it("WARNS (but does not block) on in-flight supplier onboarding", () => {
    const result = assessDeletionEligibility(
      ctx({ hasInFlightSupplierOnboarding: true }),
    );
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual([
      "supplier_onboarding_in_flight",
    ]);
  });
});

describe("canUnlinkSignInMethod", () => {
  it("refuses to unlink the last method", () => {
    expect(canUnlinkSignInMethod(1).ok).toBe(false);
    expect(canUnlinkSignInMethod(0).ok).toBe(false);
  });

  it("allows unlinking when another method remains", () => {
    expect(canUnlinkSignInMethod(2).ok).toBe(true);
  });
});

// --- Email change state machine ------------------------------------------

function change(overrides: Partial<EmailChangeState> = {}): EmailChangeState {
  return {
    status: "pending",
    expiresAt: emailChangeExpiresAt(T0),
    ...overrides,
  };
}

describe("email change", () => {
  it("uses a short confirm TTL and a 48h revocation window", () => {
    expect(EMAIL_CHANGE_CONFIRM_TTL_HOURS).toBe(2);
    expect(EMAIL_CHANGE_REVOCATION_HOURS).toBe(48);
    expect(emailChangeExpiresAt(T0).getTime() - T0.getTime()).toBe(2 * HOUR);
    expect(emailChangeRevocableUntil(T0).getTime() - T0.getTime()).toBe(
      48 * HOUR,
    );
  });

  it("walks none → awaiting_confirm → expired", () => {
    expect(emailChangePhase(null, T0)).toBe("none");
    expect(emailChangePhase(change(), T0)).toBe("awaiting_confirm");
    expect(emailChangePhase(change(), new Date(T0.getTime() + 3 * HOUR))).toBe(
      "expired",
    );
  });

  it("walks confirmed → revocable → settled", () => {
    const confirmed = change({
      status: "confirmed",
      confirmedAt: T0,
      revocableUntil: emailChangeRevocableUntil(T0),
    });
    expect(emailChangePhase(confirmed, T0)).toBe("revocable");
    expect(
      emailChangePhase(confirmed, new Date(T0.getTime() + 47 * HOUR)),
    ).toBe("revocable");
    expect(
      emailChangePhase(confirmed, new Date(T0.getTime() + 48 * HOUR)),
    ).toBe("settled");
  });

  it("permits confirmation only while awaiting and unexpired", () => {
    expect(canConfirmEmailChange(change(), T0)).toBe(true);
    expect(
      canConfirmEmailChange(change(), new Date(T0.getTime() + 3 * HOUR)),
    ).toBe(false);
    expect(canConfirmEmailChange(change({ status: "revoked" }), T0)).toBe(
      false,
    );
    expect(canConfirmEmailChange(null, T0)).toBe(false);
  });

  it("permits revocation only inside the 48h window", () => {
    const confirmed = change({
      status: "confirmed",
      confirmedAt: T0,
      revocableUntil: emailChangeRevocableUntil(T0),
    });
    expect(canRevokeEmailChange(confirmed, T0)).toBe(true);
    expect(
      canRevokeEmailChange(confirmed, new Date(T0.getTime() + 48 * HOUR)),
    ).toBe(false);
    expect(canRevokeEmailChange(change(), T0)).toBe(false);
  });

  it("counts whole hours left to revoke", () => {
    const confirmed = change({
      status: "confirmed",
      confirmedAt: T0,
      revocableUntil: emailChangeRevocableUntil(T0),
    });
    expect(emailChangeHoursToRevoke(confirmed, T0)).toBe(48);
    expect(
      emailChangeHoursToRevoke(confirmed, new Date(T0.getTime() + 47.5 * HOUR)),
    ).toBe(1);
    expect(
      emailChangeHoursToRevoke(confirmed, new Date(T0.getTime() + 60 * HOUR)),
    ).toBe(0);
  });

  it("NEVER reports a change as effective without a provider commit", () => {
    // The honesty check: our side of the handshake succeeding is not the change
    // happening. A confirmed row with no provider commit is not a changed email.
    const confirmedNoCommit = change({
      status: "confirmed",
      confirmedAt: T0,
      revocableUntil: emailChangeRevocableUntil(T0),
      providerCommittedAt: null,
    });
    expect(isEmailChangeEffective(confirmedNoCommit)).toBe(false);

    const committed = { ...confirmedNoCommit, providerCommittedAt: T0 };
    expect(isEmailChangeEffective(committed)).toBe(true);

    // And a commit stamp on a non-confirmed row proves nothing either.
    expect(
      isEmailChangeEffective(
        change({ status: "pending", providerCommittedAt: T0 }),
      ),
    ).toBe(false);
    expect(isEmailChangeEffective(null)).toBe(false);
  });
});
