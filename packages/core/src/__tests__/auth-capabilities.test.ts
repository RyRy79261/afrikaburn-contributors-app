import { describe, it, expect } from "vitest";
import {
  AUTH_CAPABILITIES,
  assertCapability,
  capabilityUserMessage,
  isCapabilitySupported,
  isCapabilityUnavailable,
  unavailableCapabilities,
} from "../auth-capabilities";
import { AuthCapabilityKey } from "@quagga/types";

// These tests pin the SHIPPED reality of self-hosted Better Auth
// (docs/auth-platform-spec.md). They are not aspirational: when the twoFactor /
// passkey plugins are installed, the matrix changes here first and these
// assertions change with it — deliberately, in one place, with a reviewed diff.

describe("AUTH_CAPABILITIES", () => {
  it("covers every capability key exactly once", () => {
    const keys = Object.keys(AUTH_CAPABILITIES).sort();
    expect(keys).toEqual([...AuthCapabilityKey.options].sort());
    for (const [key, cap] of Object.entries(AUTH_CAPABILITIES)) {
      expect(cap.key).toBe(key);
    }
  });

  it("marks every core email/password + session + account capability supported", () => {
    for (const key of [
      "passwordChange",
      "passwordReset",
      "emailVerification",
      "sessionList",
      "sessionRevoke",
      "accountDeletion",
      "linkedAccounts",
      // Self-hosting unlocks these two — absent from managed Neon's allowlist.
      "emailChange",
      "unlinkAccount",
    ] as const) {
      expect(isCapabilitySupported(key)).toBe(true);
      expect(AUTH_CAPABILITIES[key].method).not.toBeNull();
    }
  });

  it("marks 2FA, backup codes and passkeys UNAVAILABLE — plugins not installed yet", () => {
    for (const key of ["twoFactor", "backupCodes", "passkeys"] as const) {
      expect(isCapabilityUnavailable(key)).toBe(true);
      expect(AUTH_CAPABILITIES[key].method).toBeNull();
    }
  });

  it("no capability is left in the interim client_only state", () => {
    for (const cap of Object.values(AUTH_CAPABILITIES)) {
      expect(cap.support).not.toBe("client_only");
    }
  });

  it("gives every non-supported capability honest user-facing copy", () => {
    for (const cap of unavailableCapabilities()) {
      expect(cap.userMessage, `${cap.key} needs a userMessage`).toBeTruthy();
      // The copy must never imply the thing worked.
      expect(cap.userMessage?.toLowerCase()).not.toMatch(
        /\b(success|succeeded|has been (changed|enabled|removed))\b/,
      );
    }
    expect(capabilityUserMessage("passwordChange")).toBeNull();
  });

  it("documents WHY for every capability", () => {
    for (const cap of Object.values(AUTH_CAPABILITIES)) {
      expect(cap.reason.length).toBeGreaterThan(20);
    }
  });
});

describe("assertCapability — fail closed", () => {
  it("passes a supported capability", () => {
    expect(assertCapability("passwordChange")).toEqual({ ok: true });
    expect(assertCapability("sessionRevoke").ok).toBe(true);
  });

  it("REFUSES an unavailable capability with an honest message", () => {
    const result = assertCapability("twoFactor");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.support).toBe("unavailable");
      expect(result.message).toContain("isn't available");
    }
  });

  it("passes email change and unlink now that self-hosting exposes them", () => {
    expect(assertCapability("emailChange")).toEqual({ ok: true });
    expect(assertCapability("unlinkAccount").ok).toBe(true);
  });

  it("never returns ok for anything the matrix does not call supported", () => {
    for (const key of AuthCapabilityKey.options) {
      expect(assertCapability(key).ok).toBe(isCapabilitySupported(key));
    }
  });
});
