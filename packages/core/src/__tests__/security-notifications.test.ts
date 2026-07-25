import { describe, it, expect } from "vitest";
import {
  maskEmail,
  securityMessageLeaks,
  passwordChangedNotification,
  passwordResetCompletedNotification,
  emailChangeRequestedNotification,
  emailChangeCompletedNotification,
  emailChangeRevokedNotification,
  newDeviceSignInNotification,
  deletionRequestedNotification,
  deletionCancelledNotification,
  deletionCompletedNotification,
  passwordChangedEmail,
  passwordResetCompletedEmail,
  emailChangeConfirmEmail,
  emailChangeNotifyOldEmail,
  emailChangeCompletedEmail,
  emailChangeRevokedEmail,
  newDeviceSignInEmail,
  deletionRequestedEmail,
  deletionCancelledEmail,
  deletionCompletedEmail,
} from "../security-notifications";

const WHEN = new Date("2026-07-25T14:30:00.000Z");

const ALL_NOTIFICATIONS = [
  passwordChangedNotification(),
  passwordResetCompletedNotification(),
  emailChangeRequestedNotification({ newEmailMasked: "a…@example.com" }),
  emailChangeCompletedNotification({ newEmailMasked: "a…@example.com" }),
  emailChangeRevokedNotification(),
  newDeviceSignInNotification({ deviceLabel: "Chrome on macOS" }),
  deletionRequestedNotification({ daysRemaining: 14 }),
  deletionCancelledNotification(),
  deletionCompletedNotification(),
];

const ALL_EMAILS = [
  passwordChangedEmail({ when: WHEN }),
  passwordResetCompletedEmail({ when: WHEN }),
  emailChangeConfirmEmail({
    confirmUrl: "https://example.org/account/email/confirm?token=TOKEN",
    expiresInHours: 2,
  }),
  emailChangeNotifyOldEmail({
    newEmailMasked: "a…@example.com",
    revokeUrl: "https://example.org/account/email/revoke?token=REVOKE",
    revocationHours: 48,
  }),
  emailChangeCompletedEmail({
    newEmailMasked: "a…@example.com",
    revokeUrl: "https://example.org/account/email/revoke?token=REVOKE",
    revocationHours: 48,
  }),
  emailChangeRevokedEmail(),
  newDeviceSignInEmail({ deviceLabel: "Chrome on macOS", when: WHEN }),
  deletionRequestedEmail({ daysRemaining: 14, graceEndsAt: WHEN }),
  deletionCancelledEmail(),
  deletionCompletedEmail(),
];

describe("security notifications", () => {
  it("are all `security`-kind and carry a title", () => {
    for (const n of ALL_NOTIFICATIONS) {
      expect(n.kind).toBe("security");
      expect(n.title.length).toBeGreaterThan(0);
    }
  });

  it("NEVER carry a hard-locked private field or a secret", () => {
    // The privacy law: a security message says WHAT changed and WHEN. It never
    // echoes a password, an ID number, a phone, or an emergency contact.
    const forbidden = [
      "correct horse battery staple",
      "+27821234567",
      "8001015009087",
      "Penicillin allergy",
      "Ren Notfound",
    ];
    for (const n of ALL_NOTIFICATIONS) {
      expect(securityMessageLeaks(n, forbidden), n.title).toBe(false);
    }
    for (const e of ALL_EMAILS) {
      expect(securityMessageLeaks(e, forbidden), e.subject).toBe(false);
    }
  });

  it("never print a full email address in a notification body", () => {
    // Only masked forms reach a notification — the address it lands in may not
    // be the account holder's any more.
    const full = "alice@example.com";
    for (const n of ALL_NOTIFICATIONS) {
      expect(securityMessageLeaks(n, [full]), n.title).toBe(false);
    }
  });

  it("tell the reader what to do if it wasn't them", () => {
    // A security notice with no recourse is just anxiety.
    const actionable = [
      passwordChangedNotification(),
      passwordResetCompletedNotification(),
      emailChangeCompletedNotification({ newEmailMasked: "a…@example.com" }),
      newDeviceSignInNotification({ deviceLabel: "Chrome on macOS" }),
    ];
    for (const n of actionable) {
      expect(`${n.title} ${n.body ?? ""}`.toLowerCase()).toContain("wasn't you");
    }
  });

  it("phrases a REQUESTED email change without claiming anything changed", () => {
    const n = emailChangeRequestedNotification({ newEmailMasked: "a…@example.com" });
    expect(n.body?.toLowerCase()).toContain("nothing has changed yet");
    expect(n.title.toLowerCase()).toContain("requested");
  });

  it("includes the location in a new-device notice only when we have one", () => {
    expect(
      newDeviceSignInNotification({ deviceLabel: "Chrome on macOS" }).title,
    ).toBe("New sign-in on Chrome on macOS");
    expect(
      newDeviceSignInNotification({
        deviceLabel: "Chrome on macOS",
        approximateLocation: "Cape Town",
      }).title,
    ).toContain("from Cape Town");
  });
});

describe("security emails", () => {
  it("all carry a subject and a body", () => {
    for (const e of ALL_EMAILS) {
      expect(e.subject.length).toBeGreaterThan(0);
      expect(e.text.length).toBeGreaterThan(0);
    }
  });

  it("carry an actionable link ONLY on the two flows that need one", () => {
    // Confirmation and revocation are the only security emails whose recipient
    // must click something. Everything else is notice-only — a link in a "your
    // password changed" email is a phishing template.
    const withLinks = ALL_EMAILS.filter((e) => e.text.includes("http"));
    expect(withLinks.map((e) => e.kind).sort()).toEqual([
      "email_change_completed",
      "email_change_requested",
      "email_change_requested",
    ]);
  });

  it("stamps a UTC timestamp rather than a locale-dependent one", () => {
    expect(passwordChangedEmail({ when: WHEN }).text).toContain(
      "2026-07-25 14:30 UTC",
    );
  });

  it("tells a deleting burner exactly what survives and what doesn't", () => {
    const text = deletionRequestedEmail({
      daysRemaining: 14,
      graceEndsAt: WHEN,
    }).text.toLowerCase();
    expect(text).toContain("signing in is enough");
    expect(text).toContain("erased permanently");
    expect(text).toContain("camp memberships");
  });
});

describe("maskEmail", () => {
  it("keeps the first character and the whole domain", () => {
    expect(maskEmail("alice@example.com")).toBe("a…@example.com");
    expect(maskEmail("r@afrikaburn.com")).toBe("r…@afrikaburn.com");
  });

  it("masks on the LAST @, so a local part containing one can't confuse it", () => {
    expect(maskEmail('"weird@local"@example.com')).toBe('"…@example.com');
  });

  it("degrades safely on a malformed address rather than echoing it", () => {
    expect(maskEmail("not-an-email")).toBe("…");
    expect(maskEmail("@example.com")).toBe("…");
    expect(maskEmail("")).toBe("…");
  });
});
