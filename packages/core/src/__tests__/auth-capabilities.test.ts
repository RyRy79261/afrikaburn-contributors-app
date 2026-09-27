import { describe, it, expect } from "vitest";
import {
  AUTH_CAPABILITIES,
  assertCapability,
  capabilityUserMessage,
  capabilityVerdict,
  isCapabilitySupported,
  isCapabilityUnavailable,
  unavailableCapabilities,
} from "../auth-capabilities";
import { AuthCapabilityKey } from "@quagga/types";

// These tests pin the SHIPPED reality of self-hosted Better Auth
// (docs/auth-platform-spec.md). They are not aspirational: the twoFactor and
// passkey plugins are now installed (migration 0015), so the matrix marks them
// supported and these assertions moved with it — deliberately, in one place.

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

  it("marks 2FA, backup codes and passkeys SUPPORTED — plugins installed (migration 0015)", () => {
    for (const key of ["twoFactor", "backupCodes", "passkeys"] as const) {
      expect(isCapabilitySupported(key)).toBe(true);
      expect(isCapabilityUnavailable(key)).toBe(false);
      expect(AUTH_CAPABILITIES[key].method).not.toBeNull();
    }
  });

  it("leaves NOTHING unavailable — every capability now ships", () => {
    expect(unavailableCapabilities()).toEqual([]);
    for (const key of AuthCapabilityKey.options) {
      expect(isCapabilitySupported(key)).toBe(true);
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

  it("passes 2FA, passkeys, email change and unlink now that self-hosting ships them", () => {
    expect(assertCapability("twoFactor")).toEqual({ ok: true });
    expect(assertCapability("passkeys").ok).toBe(true);
    expect(assertCapability("backupCodes").ok).toBe(true);
    expect(assertCapability("emailChange")).toEqual({ ok: true });
    expect(assertCapability("unlinkAccount").ok).toBe(true);
  });

  it("never returns ok for anything the matrix does not call supported", () => {
    for (const key of AuthCapabilityKey.options) {
      expect(assertCapability(key).ok).toBe(isCapabilitySupported(key));
    }
  });
});

describe("capabilityVerdict — a pending feature is described, never the reader's account", () => {
  // Issue #34: beside a burner's own email address, "Changing your sign-in
  // email isn't finished yet" under a "Not finished yet" badge read as THEIR
  // change being half-done, to someone who had only ever signed in with Google.
  it("labels a supported-but-unwired capability as not built, not unfinished", () => {
    const verdict = capabilityVerdict(AUTH_CAPABILITIES.emailChange);
    expect(verdict.label).toBe("Not built yet");
    expect(verdict.message).not.toMatch(/finished/i);
    expect(verdict.message).toMatch(/still building/i);
  });

  it("says nothing at all once a capability is supported and wired", () => {
    expect(capabilityVerdict(AUTH_CAPABILITIES.sessionList).label).toBeNull();
  });

  it("keeps the unavailable wording for a capability the provider lacks", () => {
    const verdict = capabilityVerdict({
      ...AUTH_CAPABILITIES.emailChange,
      support: "unavailable",
    });
    expect(verdict.label).toBe("Not available yet");
  });
});
