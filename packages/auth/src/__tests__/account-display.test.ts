import { describe, it, expect } from "vitest";

import {
  deviceLabel,
  describeSignInMethods,
  type LinkedAccount,
} from "../account";

// THE TWO PURE FUNCTIONS THE ACCOUNT SECURITY PAGE PUTS IN FRONT OF A DECISION.
//
// `deviceLabel` is what makes "is this me?" answerable on a list whose buttons
// revoke sessions. Its ternary ordering is deliberate and fragile, and the
// source says so in a comment: Edge's user agent contains both `chrome` and
// `safari`, and Chrome's contains `safari`. One reordered branch relabels every
// Edge session as Chrome and every Chrome session as Safari — which is exactly
// the kind of wrongness that makes someone revoke the wrong row, and it needs
// no mocks whatsoever to pin.
//
// `describeSignInMethods` is the single source of truth for any surface that
// names a sign-in method, including the last-method guard. If it returns a
// label for a provider that cannot actually sign anyone in, the guard believes
// a way back into the account exists when it does not.

describe("deviceLabel", () => {
  it("says so plainly when there is no user agent at all", () => {
    // A blank cell in a list of revocable sessions is unreadable; an honest
    // "Unknown device" is at least something the reader can reason about.
    expect(deviceLabel(null)).toBe("Unknown device");
  });

  it("reports Edge as Edge and Chrome as Chrome — the documented fragility", () => {
    // Stated as an assertion because the source comment is the only thing
    // protecting it. Edge claims Chrome AND Safari; Chrome claims Safari. Match
    // in the wrong order and every row in the list is mislabelled.
    const edge =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0";
    const chrome =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

    expect(deviceLabel(edge)).toBe("Edge on Windows");
    expect(deviceLabel(chrome)).toBe("Chrome on Windows");
  });

  it("resolves every OS it models, and names the gap otherwise", () => {
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toContain(
      "Android",
    );
    expect(
      deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"),
    ).toContain("iOS");
    // An iPad is iOS too — a separate label here would split one person's two
    // Apple devices into two vocabularies for no benefit.
    expect(
      deviceLabel("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"),
    ).toContain("iOS");
    expect(
      deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"),
    ).toContain("macOS");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toContain(
      "Windows",
    );
    expect(deviceLabel("Mozilla/5.0 (X11; Linux x86_64)")).toContain("Linux");
    expect(deviceLabel("curl/8.5.0")).toContain("Unknown OS");
  });

  it("resolves every browser it models, and falls back to a lowercase noun", () => {
    expect(deviceLabel("Mozilla/5.0 (X11; Linux x86_64) Firefox/124.0")).toBe(
      "Firefox on Linux",
    );
    expect(
      deviceLabel(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      ),
    ).toBe("Safari on macOS");
    // Not "Unknown browser": the sentence reads "browser on Linux", which is
    // honest about knowing the platform and not the client.
    expect(deviceLabel("curl/8.5.0 (X11; Linux x86_64)")).toBe(
      "browser on Linux",
    );
  });

  it("is case-insensitive, because a user agent is not a controlled string", () => {
    expect(deviceLabel("MOZILLA/5.0 (WINDOWS NT 10.0) FIREFOX/124.0")).toBe(
      "Firefox on Windows",
    );
  });
});

// --- Sign-in methods ------------------------------------------------------

function linked(...providerIds: string[]): LinkedAccount[] {
  return providerIds.map((providerId, i) => ({
    id: `acct-${i}`,
    providerId,
    createdAt: null,
  }));
}

describe("describeSignInMethods", () => {
  it("returns null when nothing determinable is linked", () => {
    // null is what lets a caller render an honest "Not available". A literal
    // like "Email" here would name a way in that may not exist.
    expect(describeSignInMethods([])).toBeNull();
    expect(describeSignInMethods(linked("unknown"))).toBeNull();
    expect(describeSignInMethods(linked("unknown", "unknown"))).toBeNull();
  });

  it("orders Email, then Google, then anything else, whatever the input order", () => {
    // The order is the product's, not the database's: two accounts that linked
    // the same two methods in a different sequence must read identically.
    expect(describeSignInMethods(linked("google", "credential"))).toBe(
      "Email, Google",
    );
    expect(describeSignInMethods(linked("credential", "google"))).toBe(
      "Email, Google",
    );
    expect(
      describeSignInMethods(linked("github", "google", "credential")),
    ).toBe("Email, Google, Github");
  });

  it("de-duplicates two accounts on the same provider into one label", () => {
    // Better Auth can hold more than one `credential` row; "Email, Email" would
    // read as two independent ways in and make the last-method guard's warning
    // look wrong.
    expect(describeSignInMethods(linked("credential", "credential"))).toBe(
      "Email",
    );
  });

  it("title-cases an unmapped provider rather than dropping it", () => {
    // Dropping it would understate the ways into the account — the opposite of
    // what the last-method guard needs. "unknown" is the ONLY value discarded,
    // because it names an absence rather than a provider.
    expect(describeSignInMethods(linked("github"))).toBe("Github");
    expect(describeSignInMethods(linked("credential", "unknown"))).toBe(
      "Email",
    );
  });
});
