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

// These tests pin the PROBED reality of managed Neon Auth (25 Jul 2026,
// @neondatabase/auth 0.4.1-beta). They are not aspirational: when Neon ships MFA
// and the probe is re-run, the matrix changes here first and these assertions
// change with it — deliberately, in one place, with a diff someone reviews.

describe("AUTH_CAPABILITIES", () => {
  it("covers every capability key exactly once", () => {
    const keys = Object.keys(AUTH_CAPABILITIES).sort();
    expect(keys).toEqual([...AuthCapabilityKey.options].sort());
    for (const [key, cap] of Object.entries(AUTH_CAPABILITIES)) {
      expect(cap.key).toBe(key);
    }
  });

  it("marks the capabilities the server SDK genuinely exposes as supported", () => {
    for (const key of [
      "passwordChange",
      "passwordReset",
      "emailVerification",
      "sessionList",
      "sessionRevoke",
      "accountDeletion",
      "linkedAccounts",
    ] as const) {
      expect(isCapabilitySupported(key)).toBe(true);
      expect(AUTH_CAPABILITIES[key].method).not.toBeNull();
    }
  });

  it("marks 2FA, backup codes and passkeys UNAVAILABLE — no plugin on a managed instance", () => {
    for (const key of ["twoFactor", "backupCodes", "passkeys"] as const) {
      expect(isCapabilityUnavailable(key)).toBe(true);
      expect(AUTH_CAPABILITIES[key].method).toBeNull();
    }
  });

  it("marks email change and unlink as client-only / unverified, not supported", () => {
    // Both exist on the browser client but are absent from the server endpoint
    // allowlist, so we can neither perform nor verify them server-side.
    for (const key of ["emailChange", "unlinkAccount"] as const) {
      expect(AUTH_CAPABILITIES[key].support).toBe("client_only");
      expect(isCapabilitySupported(key)).toBe(false);
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

  it("REFUSES a client-only capability server-side", () => {
    // We will not pretend a server action performed something only the browser
    // might manage and that we cannot verify.
    const result = assertCapability("emailChange");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.support).toBe("client_only");
  });

  it("never returns ok for anything the matrix does not call supported", () => {
    for (const key of AuthCapabilityKey.options) {
      expect(assertCapability(key).ok).toBe(isCapabilitySupported(key));
    }
  });
});
