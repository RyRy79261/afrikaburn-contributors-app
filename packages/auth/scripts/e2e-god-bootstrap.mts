// Create the E2E god account, if it does not already exist.
//
// TEST SETUP ONLY. Never run this against a real deployment: it marks an email
// address verified without the address holder doing anything, which is exactly
// the thing the product must never do. It lives here because the alternative is
// worse — see below.
//
// WHY THIS IS NEEDED. `elevateToGod` (e2e/personas/factories.ts:744) signs in
// with E2E_GOD_EMAIL/E2E_GOD_PASSWORD and expects the account to already exist.
// Nothing in the suite, the seed, or scripts/e2e-local.sh ever created it — so
// the 28 spec files behind `skipUnlessGod()` only ever ran on a database where
// somebody had made that account BY HAND, once, locally. On any fresh database
// (which is every CI run) they either skip silently or fail on sign-in, and
// since the org console is the hinge of every cross-app journey, that is most of
// the suite's real value.
//
// The email must be VERIFIED because the GOD_EMAILS bootstrap deliberately
// refuses an unverified address (apps/org/lib/god.ts canBootstrapGodEmail — an
// OIDC provider asserting an attacker-controlled `email` claim must never
// elevate). With E2E_MAIL_MODE=off there is no inbox to click, so the
// verification is applied directly here. That is the ONE step this script takes
// that the product would not.
//
// Idempotent: an existing account is left alone apart from ensuring the verified
// flag, so re-running is safe.
//
// Lives inside packages/auth rather than the repo's scripts/ directory purely so
// its imports resolve: @quagga/auth is the only package that depends on BOTH
// itself and @quagga/db. scripts/e2e-local.sh invokes it from here.

import { eq } from "drizzle-orm";
import { createHttpDb, schema, configureLocalProxy } from "@quagga/db";
import { auth } from "../src/index";

const email = process.env.E2E_GOD_EMAIL;
const password = process.env.E2E_GOD_PASSWORD;

if (!email || !password) {
  console.log(
    "[god-bootstrap] E2E_GOD_EMAIL / E2E_GOD_PASSWORD unset — nothing to do. " +
      "The god and org-staff suites will skip.",
  );
  process.exit(0);
}

const godEmails = (process.env.GOD_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
if (!godEmails.includes(email.toLowerCase())) {
  // Fail loudly: signing the account up but leaving it off the list produces a
  // console that refuses it, and 28 spec files failing for a reason that looks
  // like a permission bug.
  console.error(
    `[god-bootstrap] REFUSING: ${email} is not in GOD_EMAILS (${
      godEmails.join(", ") || "empty"
    }). The bootstrap only elevates a listed address, so the suite would fail ` +
      `with what looks like a permissions defect. Fix the env, not this script.`,
  );
  process.exit(1);
}

configureLocalProxy();
const db = createHttpDb();

const [existing] = await db
  .select({ id: schema.user.id, emailVerified: schema.user.emailVerified })
  .from(schema.user)
  .where(eq(schema.user.email, email))
  .limit(1);

if (!existing) {
  // Through the real sign-up API so the password hash and account row are
  // exactly what a genuine sign-up produces — a hand-built row would let the
  // suite pass against something the product cannot actually create.
  await auth.api.signUpEmail({
    body: { email, password, name: "E2E God" },
  });
  console.log(`[god-bootstrap] created ${email}`);
} else {
  console.log(`[god-bootstrap] ${email} already exists`);
}

const [row] = await db
  .select({ id: schema.user.id, emailVerified: schema.user.emailVerified })
  .from(schema.user)
  .where(eq(schema.user.email, email))
  .limit(1);

if (!row) {
  console.error(
    "[god-bootstrap] sign-up reported success but no user row exists — " +
      "refusing to continue, the suite would fail confusingly.",
  );
  process.exit(1);
}

if (!row.emailVerified) {
  await db
    .update(schema.user)
    .set({ emailVerified: true })
    .where(eq(schema.user.id, row.id));
  console.log(
    "[god-bootstrap] marked the address verified (no inbox with mail off; " +
      "GOD_EMAILS elevation requires a verified email by design)",
  );
}

console.log(
  "[god-bootstrap] ready — the org console will elevate this account to god " +
    "on its first load.",
);
