import { describe, it, expect } from "vitest";

import { parseSetCookies } from "../account";

// REGRESSION: calling `auth.api.*` from a Next server action bypasses the
// /api/auth/* route handler, so Better Auth's response headers come back to the
// caller and are dropped. Harmless for a read; silently destructive for
// `changePassword`, which deletes every session including the caller's and
// issues a fresh one.
//
// Measured on the running stack before the fix: sign in on three devices, change
// the password with "sign out my other devices" on, and the security page showed
// ONE session, not flagged "This device", carrying a Revoke button — because the
// browser still held the cookie for a row that had been deleted, and was living
// on the 5-minute session cookie cache. Five minutes later: signed out, no
// explanation. Two devices happened not to reproduce it, which is why the
// participant app's existing spec never caught it.
//
// `parseSetCookies` is the seam that lets each app hand those cookies back. It
// is pure, so it is tested here rather than through three browsers.

function headersWith(...setCookie: string[]): Headers {
  const h = new Headers();
  for (const line of setCookie) h.append("set-cookie", line);
  return h;
}

describe("parseSetCookies", () => {
  it("reads a realistic Better Auth session cookie whole", () => {
    const [cookie] = parseSetCookies(
      headersWith(
        "quagga.session_token=abc123xyz; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800",
      ),
    );

    expect(cookie).toEqual({
      name: "quagga.session_token",
      value: "abc123xyz",
      options: {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 604800,
      },
    });
  });

  it("keeps every cookie in a multi-cookie response", () => {
    // changePassword sets the rotated session AND clears the session cache.
    const parsed = parseSetCookies(
      headersWith(
        "quagga.session_token=new-token; Path=/; HttpOnly",
        "quagga.session_data=; Path=/; Max-Age=0",
      ),
    );
    expect(parsed.map((c) => c.name)).toEqual([
      "quagga.session_token",
      "quagga.session_data",
    ]);
    // The EXPIRY one matters as much as the new one: dropping it would leave a
    // stale cached session sitting in front of the fresh token.
    expect(parsed[1]?.value).toBe("");
    expect(parsed[1]?.options.maxAge).toBe(0);
  });

  it("carries Domain and Secure, which cross-subdomain SSO depends on", () => {
    const [cookie] = parseSetCookies(
      headersWith(
        "quagga.session_token=t; Domain=.contributors.afrikaburn.com; Path=/; Secure; HttpOnly; SameSite=None",
      ),
    );
    // Losing Domain here would set a host-only cookie and silently break the
    // one-account-three-apps promise the account suite is built on.
    expect(cookie?.options.domain).toBe(".contributors.afrikaburn.com");
    expect(cookie?.options.secure).toBe(true);
    expect(cookie?.options.sameSite).toBe("none");
  });

  it("decodes a percent-encoded value", () => {
    const [cookie] = parseSetCookies(
      headersWith("quagga.state=a%2Bb%3Dc; Path=/"),
    );
    expect(cookie?.value).toBe("a+b=c");
  });

  it("parses Expires into a Date", () => {
    const [cookie] = parseSetCookies(
      headersWith(
        "quagga.session_token=t; Expires=Wed, 21 Oct 2026 07:28:00 GMT",
      ),
    );
    expect(cookie?.options.expires?.toISOString()).toBe(
      "2026-10-21T07:28:00.000Z",
    );
  });

  it("ignores an attribute it does not model rather than dropping the cookie", () => {
    // A cookie set with something we do not map is still SET — just without it.
    // Discarding the whole cookie would be the worse failure by far.
    const [cookie] = parseSetCookies(
      headersWith("quagga.session_token=t; Path=/; Partitioned; Priority=High"),
    );
    expect(cookie?.name).toBe("quagga.session_token");
    expect(cookie?.value).toBe("t");
    expect(cookie?.options.path).toBe("/");
  });

  it("skips malformed lines instead of throwing", () => {
    // This runs AFTER a password has already changed. Throwing here would
    // report a completed security change as a failure.
    const parsed = parseSetCookies(
      headersWith("not-a-cookie", "=novalue; Path=/", "good=1; Path=/"),
    );
    expect(parsed.map((c) => c.name)).toEqual(["good"]);
  });

  it("skips a line that is all attributes and no cookie", () => {
    // A header beginning with `;` splits to an empty first segment, which is
    // the `!first` guard. Reachable through a real Headers — it keeps the
    // value verbatim — so the guard is live code, not defensive decoration.
    const parsed = parseSetCookies(
      headersWith(";Path=/; HttpOnly", "good=1; Path=/"),
    );
    expect(parsed.map((c) => c.name)).toEqual(["good"]);
  });

  it("returns nothing for a response that set no cookies", () => {
    expect(parseSetCookies(new Headers())).toEqual([]);
  });

  // --- Malformed attributes, which the tests above never fed it -----------
  //
  // The rotated session cookie is handed straight to Next's cookie store. A NaN
  // maxAge or an Invalid Date expires is how that cookie silently fails to set
  // — which reintroduces the exact bug this file was written for, on the input
  // path nobody was exercising. An attribute we cannot parse is DROPPED; the
  // cookie itself is never lost with it.

  it("omits a Max-Age that is not a number rather than writing NaN", () => {
    const [cookie] = parseSetCookies(
      headersWith("quagga.session_token=t; Path=/; Max-Age=forever"),
    );
    expect(cookie?.value).toBe("t");
    expect(cookie?.options.maxAge).toBeUndefined();
  });

  it("omits an unparseable Expires rather than writing an Invalid Date", () => {
    const [cookie] = parseSetCookies(
      headersWith("quagga.session_token=t; Path=/; Expires=next Tuesday"),
    );
    expect(cookie?.value).toBe("t");
    expect(cookie?.options.expires).toBeUndefined();
  });

  it("omits a SameSite value the cookie store would refuse", () => {
    // Next's cookie store takes lax | strict | none. Passing "Whenever"
    // through would throw where the cookie is APPLIED — a page away from the
    // response that produced it.
    const [cookie] = parseSetCookies(
      headersWith("quagga.session_token=t; SameSite=Whenever"),
    );
    expect(cookie?.options.sameSite).toBeUndefined();
  });

  it("returns [] for a Headers-like object with no getSetCookie", () => {
    // Some fetch-Response polyfills and test doubles lack it. Reaching for it
    // blindly would throw on a path that runs AFTER a password has changed.
    const headerish = { get: () => null } as unknown as Headers;
    expect(parseSetCookies(headerish)).toEqual([]);
  });
});
