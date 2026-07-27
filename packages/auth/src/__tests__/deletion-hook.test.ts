import { describe, it, expect } from "vitest";
import { buildAuthOptions } from "../config";
import { isReauth, withReauth } from "../reauth";

// THE B1 REGRESSION PIN (audit, 27 Jul 2026).
//
// Four separate strings promise the burner that signing in cancels a pending
// account deletion. For the entire life of the feature nothing implemented that:
// the cancel function existed, documented itself as "the sign-in hook", and was
// called only by the explicit Cancel button. Anyone who believed the copy was
// irreversibly erased on day 14.
//
// The promise is now kept by a Better Auth `session.create.after` hook. These
// tests assert the WIRING exists, because the wiring is the exact thing that was
// missing — the cancellation logic itself was always fine.

describe("the sign-in deletion-cancellation hook is wired", () => {
  it("registers an after-hook on session creation", () => {
    const options = buildAuthOptions({});
    const after = options.databaseHooks?.session?.create?.after;
    expect(after).toBeTypeOf("function");
  });

  it("is present regardless of env — it is not gated on any optional var", () => {
    // The hook must not disappear when e.g. RESEND_API_KEY is unset. Deletion
    // rescue is a data-integrity guarantee; email is only the receipt.
    for (const env of [
      {},
      { RESEND_API_KEY: "re_test" },
      { BETTER_AUTH_SECRET: "x".repeat(40), DATABASE_URL: "postgres://x/y" },
    ]) {
      const after = buildAuthOptions(env).databaseHooks?.session?.create?.after;
      expect(after).toBeTypeOf("function");
    }
  });
});

describe("withReauth marks a password check so it is not read as a return", () => {
  it("is false outside, true inside, and restored after", async () => {
    expect(isReauth()).toBe(false);
    await withReauth(async () => {
      expect(isReauth()).toBe(true);
    });
    expect(isReauth()).toBe(false);
  });

  it("does not leak across concurrent async contexts", async () => {
    // Requesting deletion (inside) must not suppress the hook for an unrelated
    // burner signing in at the same moment (outside).
    let sawOutside: boolean | null = null;
    await Promise.all([
      withReauth(async () => {
        await new Promise((r) => setTimeout(r, 5));
        expect(isReauth()).toBe(true);
      }),
      (async () => {
        await new Promise((r) => setTimeout(r, 1));
        sawOutside = isReauth();
      })(),
    ]);
    expect(sawOutside).toBe(false);
  });

  it("clears the marker even when the wrapped call throws", async () => {
    // A wrong password throws out of signInEmail; the marker must not survive it.
    await expect(
      withReauth(async () => {
        throw new Error("bad password");
      }),
    ).rejects.toThrow("bad password");
    expect(isReauth()).toBe(false);
  });
});
