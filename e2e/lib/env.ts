// e2e/lib/env.ts — the single place the harness reads its environment.
//
// Everything is env-driven so the same suite can point at localhost, a Vercel
// preview, or production without a code change (M3-16). Nothing here has a
// hard-coded production URL as a *default* that could silently run destructive
// sign-ups against prod: the base URLs default to the local dev ports, and a CI
// run MUST set them explicitly to the preview it provisioned.
//
// Capability flags model the honest reality of the deployment under test:
//   - MAIL: does the deployment actually send email (RESEND_API_KEY set)? If
//     not, verification/reset flows are STRUCTURALLY unavailable and their specs
//     skip cleanly (email verification is currently OFF — auth config derives it
//     from RESEND_API_KEY's absence).
//   - GOOGLE: can we drive Google OAuth? Never in CI — see personas/registry.ts.
//   - GOD: do we have credentials for an account that is on the deployment's
//     GOD_EMAILS list, so org-console (god) journeys can run?

/** Which of the three apps a page/factory is operating against. */
export type AppName = "web" | "org" | "suppliers";

/** How the deployment under test handles verification email. */
export type MailMode = "off" | "mailtm";

function required(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(
      `[e2e] Missing required env ${name}. Set it to the deployment under test ` +
        `(see e2e/.env.example). The harness never guesses a URL.`,
    );
  }
  return value.replace(/\/$/, "");
}

/**
 * Base URL for each app. Defaults to the local dev ports (AGENTS.md: web 3000,
 * org 3001, suppliers 3002) so `pnpm dev` + `pnpm --filter @quagga/e2e e2e`
 * works with zero config. CI overrides all three with the preview subdomain.
 */
export function baseUrl(app: AppName): string {
  switch (app) {
    case "web":
      return (process.env.E2E_WEB_URL ?? "http://localhost:3000").replace(
        /\/$/,
        "",
      );
    case "org":
      return (process.env.E2E_ORG_URL ?? "http://localhost:3001").replace(
        /\/$/,
        "",
      );
    case "suppliers":
      return (process.env.E2E_SUPPLIERS_URL ?? "http://localhost:3002").replace(
        /\/$/,
        "",
      );
  }
}

export const APP_URLS: Record<AppName, string> = {
  get web() {
    return baseUrl("web");
  },
  get org() {
    return baseUrl("org");
  },
  get suppliers() {
    return baseUrl("suppliers");
  },
};

/**
 * Vercel Deployment Protection bypass. When a preview has protection on,
 * Playwright silently HANGS unless this header is sent on every request
 * (auth-spec §5.2). Returns the header bag to spread into `extraHTTPHeaders`.
 */
export function protectionBypassHeaders(): Record<string, string> {
  const secret = process.env.E2E_VERCEL_PROTECTION_BYPASS;
  if (!secret) return {};
  return {
    "x-vercel-protection-bypass": secret,
    // Ask Vercel to also set the bypass cookie so client-side navigations pass.
    "x-vercel-set-bypass-cookie": "true",
  };
}

/** Mail capture mode. Default 'off' — matching a deployment with no RESEND key. */
export function mailMode(): MailMode {
  const raw = (process.env.E2E_MAIL_MODE ?? "off").trim().toLowerCase();
  return raw === "mailtm" ? "mailtm" : "off";
}

/**
 * True when the deployment under test sends email AND the harness can read it.
 * Flows that need a real verification/reset link gate on this and skip when false.
 */
export function isMailCaptureAvailable(): boolean {
  return mailMode() !== "off";
}

/**
 * Whether the deployment gates sign-in on email verification. Derived from the
 * same signal as the app (auth env.ts resolveRequireEmailVerification): a mail
 * provider must exist for verification to be possible at all. Overridable with
 * E2E_REQUIRE_EMAIL_VERIFICATION for a deployment that has RESEND but keeps the
 * gate off (Ryan's decision 2).
 */
export function requiresEmailVerification(): boolean {
  if (!isMailCaptureAvailable()) return false;
  const override = (process.env.E2E_REQUIRE_EMAIL_VERIFICATION ?? "")
    .trim()
    .toLowerCase();
  if (["false", "0", "off", "no"].includes(override)) return false;
  return true;
}

/**
 * Credentials for a pre-provisioned GOD account. God bootstrap requires a
 * VERIFIED email that is on the deployment's GOD_EMAILS list (packages/core
 * canBootstrapGod). Because GOD_EMAILS is fixed at deploy time and a fresh
 * random sign-up is never verified when mail is off, org-console journeys need
 * these supplied out-of-band. Absent → god journeys skip.
 */
export function godCredentials(): { email: string; password: string } | null {
  const email = process.env.E2E_GOD_EMAIL;
  const password = process.env.E2E_GOD_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

/**
 * An email that IS on the deployment's `GOD_EMAILS` list but is DELIBERATELY
 * NOT verified on the branch under test (a fresh sign-up when mail is off). It
 * exists solely for the verified-email bootstrap guard (e2e/specs/god): signing
 * this address up through the UI and confirming it is still refused god isolates
 * `emailVerified` as the deciding variable — same list membership as the real
 * god, differing only in verification. Absent → that isolation case skips.
 *
 * WARNING: because this address is on GOD_EMAILS, it would bootstrap to god the
 * instant its email became verified. Only ever point it at a throwaway branch.
 */
export function unverifiedGodEmail(): string | null {
  const email = process.env.E2E_UNVERIFIED_GOD_EMAIL;
  return email && email.trim().length > 0 ? email.trim() : null;
}

/** Whether Google OAuth can be exercised. Practically always false — see registry. */
export function isGoogleDriveable(): boolean {
  return (
    (process.env.E2E_GOOGLE_DRIVEABLE ?? "").trim().toLowerCase() === "true"
  );
}

/** Standard test timeouts (ms), overridable for slow previews. */
export const TIMEOUTS = {
  /** Per-test cap. Journeys that create + submit a full registration need headroom. */
  test: Number(process.env.E2E_TEST_TIMEOUT ?? 90_000),
  /** Per-assertion / auto-retry expectation cap. */
  expect: Number(process.env.E2E_EXPECT_TIMEOUT ?? 15_000),
  /** Navigation/action cap. */
  action: Number(process.env.E2E_ACTION_TIMEOUT ?? 20_000),
  /** How long to poll a mailbox for a link. */
  mail: Number(process.env.E2E_MAIL_TIMEOUT ?? 45_000),
};

/** True in CI (GitHub Actions sets CI=true). Enables retries + single-worker safety. */
export const IS_CI = process.env.CI === "true" || process.env.CI === "1";

/** Guard: refuse to run the destructive suite against a production apex by accident. */
export function assertNotProductionUnlessAllowed(): void {
  const allow =
    (process.env.E2E_ALLOW_PRODUCTION ?? "").trim().toLowerCase() === "true";
  if (allow) return;
  const prodHosts = [
    "app.quagga.ryanjnoble.dev",
    "org.quagga.ryanjnoble.dev",
    "suppliers.quagga.ryanjnoble.dev",
  ];
  for (const app of ["web", "org", "suppliers"] as const) {
    const host = (() => {
      try {
        return new URL(baseUrl(app)).host;
      } catch {
        return "";
      }
    })();
    if (prodHosts.includes(host)) {
      throw new Error(
        `[e2e] Refusing to run against production host ${host}. The suite creates ` +
          `real accounts and rows. Point E2E_${app.toUpperCase()}_URL at a preview, ` +
          `or set E2E_ALLOW_PRODUCTION=true if you REALLY mean it.`,
      );
    }
  }
}

export { required };
