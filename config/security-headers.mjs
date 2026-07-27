// Response security headers, shared by all three apps' next.config.ts.
//
// Added 27 Jul 2026 (audit M6): none of the three apps sent ANY of these. The
// org console was framable, so a clickjacked click could reach a destructive
// server action — `deleteSupplier` among them.
//
// Deliberately NOT a full Content-Security-Policy. A script-src policy strict
// enough to be worth having needs per-request nonces threaded through Next's
// inline bootstrap scripts, and getting it subtly wrong white-screens the app.
// `frame-ancestors` is the part that closes the reported hole and cannot break
// a page that was never meant to be framed. A full CSP is follow-up work, not a
// same-day change.

/** @type {{ key: string, value: string }[]} */
export const SECURITY_HEADERS = [
  // The clickjacking fix, twice: frame-ancestors is the modern control and
  // X-Frame-Options covers browsers/proxies that still only read the old one.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  // Stop a user-uploaded file being re-interpreted as script/HTML.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Never leak a full URL (which can carry ids) to a third-party origin.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here needs these; denying them by default costs nothing.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  // Two years, subdomains included — the apex serves all three apps over TLS.
  // Ignored by browsers over plain http, so local/E2E runs are unaffected.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

/** The `headers()` entry for a Next config: every route, same set. */
export async function securityHeaders() {
  return [{ source: "/:path*", headers: SECURITY_HEADERS }];
}
