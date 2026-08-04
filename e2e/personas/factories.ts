// e2e/personas/factories.ts — the shared vocabulary the persona specs speak.
//
// Every factory DRIVES THE REAL UI (no DB back doors): a spec reads like the
// story it tests. Selectors prefer role/label over CSS (AGENTS.md; task STYLE).
// All are idempotent about navigation — they go to the page they need — so a
// spec can compose them in any order. Cross-app SSO does not span localhost /
// preview origins (different hosts), so an org/supplier factory signs in on ITS
// OWN app's page, not the web page's session.
//
// Selector provenance (verified against source on 2026-07-26):
//   sign-in/up ....... apps/{web,org}/components/auth/auth-form.tsx
//                      apps/suppliers/components/auth/{sign-in,sign-up}-form.tsx
//   Burner Bio ....... apps/web/components/onboarding/bio-flow.tsx
//   create camp ...... apps/web/components/create-camp-form.tsx
//   invites .......... apps/web/components/camp-invites.tsx  (invite URL in <code>)
//   join ............. apps/web/components/join-button.tsx
//   registration ..... apps/web/components/registration/{registration-wizard,field-kit}.tsx
//   supplier signup .. apps/suppliers/components/auth/sign-up-form.tsx

import { expect, type Page } from "@playwright/test";
import {
  requiresEmailVerification,
  godCredentials,
  type AppName,
} from "../lib/env";
import { requireMailbox, type Mailbox } from "../lib/mail";
import {
  TEST_PASSWORD,
  uniqueCampName,
  uniqueEmail,
  uniqueName,
  uniqueSupplierName,
  uniqueUsername,
} from "../lib/identity";

// --- Credentials returned by the sign-up factories -------------------------

export interface Account {
  email: string;
  password: string;
  /** Present only when the account was created against a real disposable inbox. */
  mailbox?: Mailbox;
  /** The display/business name used at sign-up. */
  name: string;
}

/** Path to each app's sign-in screen. Suppliers uses /signin; web+org /auth/sign-in. */
function signInPath(app: AppName): string {
  return app === "suppliers" ? "/signin" : "/auth/sign-in";
}

/**
 * True for a real camp-detail URL (/camps/<slug>) but NOT the /camps/new form.
 * `waitForURL` resolves synchronously when the CURRENT url already matches its
 * predicate, and camp flows start on /camps/new — whose pathname a bare
 * /\/camps\/[^/]+$/ would false-match ("new" is a valid slug segment). Excluding
 * the form route makes "we navigated to a real camp" the only accepted outcome.
 */
function isCampDetailUrl(url: URL): boolean {
  return (
    /\/camps\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith("/camps/new")
  );
}

/**
 * Block until the browser actually HOLDS a session cookie.
 *
 * Waiting for the sign-up response is not enough and the difference is not
 * theoretical — it produced an intermittent failure in every persona that signs
 * up. `waitForResponse` resolves on response headers; the cookie jar is updated
 * a beat later, and a `page.goto` issued in that gap carries no session, so the
 * gate correctly bounces to sign-in and the spec blames the product.
 *
 * It also turns a FAILED sign-up into an honest error here, instead of a
 * confusing "expected not to be on /auth/sign-in" fifteen seconds later.
 */
async function waitForSessionCookie(page: Page, what: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const cookies = await page.context().cookies();
    // Better Auth prefixes with "quagga" (advanced.cookiePrefix), and adds
    // "__Secure-" on https origins — match either.
    if (cookies.some((c) => /quagga\.session_token$/.test(c.name) && c.value)) {
      return;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(
    `[e2e] ${what} did not produce a session cookie within 15s. The request may ` +
      `have been refused (duplicate address, password policy, rate limit) — check ` +
      `the app log rather than treating this as a navigation problem.`,
  );
}

/** Fail loudly if a factory landed on a "not configured" preview surface. */
async function assertConfigured(page: Page): Promise<void> {
  const banner = page.getByText(/not configured|preview mode|isn['’]t set up/i);
  if (await banner.count()) {
    throw new Error(
      "[e2e] The deployment under test is not fully configured (auth/DB banner " +
        "visible). Point the E2E_*_URL at a wired preview.",
    );
  }
}

// --- Sign up ---------------------------------------------------------------

/**
 * Create a fresh participant account through the web sign-up form.
 *
 * When the deployment gates on email verification (RESEND present +
 * E2E_MAIL_MODE=mailtm), this provisions a disposable inbox, clicks the
 * verification link, and returns an already-verified, signed-in account. When
 * verification is off (the current default), sign-up auto-signs-in and no inbox
 * is used.
 *
 * @throws MailUnavailableError (from requireMailbox) if verification is required
 *   but E2E_MAIL_MODE is off — a spec should skip in that case.
 */
export async function signUpBurner(
  page: Page,
  opts: { onboard?: boolean; username?: string } = {},
): Promise<Account> {
  const needsVerification = requiresEmailVerification();
  let mailbox: Mailbox | undefined;
  let email: string;
  if (needsVerification) {
    mailbox = await requireMailbox("burner");
    email = mailbox.address;
  } else {
    email = uniqueEmail("burner");
  }
  const password = TEST_PASSWORD;
  const name = email.split("@")[0] ?? "burner";

  await page.goto("/auth/sign-up");
  await assertConfigured(page);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  // Wait for the REQUEST, not just the click. `.click()` resolves as soon as the
  // event is dispatched, so navigating straight to /onboarding raced the sign-up
  // POST: the session cookie had not been set yet, the gate quite correctly
  // bounced to sign-in, and the spec then blamed the product for it. Every
  // persona builds on this factory, so the race showed up as ~100 failures that
  // all looked like broken auth. A real person cannot click and navigate inside
  // the same 5ms; the harness could.
  const signUpResponse = await page.waitForResponse(
    (r) =>
      r.url().includes("/api/auth/sign-up") && r.request().method() === "POST",
    { timeout: 15_000 },
  );
  if (!signUpResponse.ok()) {
    throw new Error(
      `[e2e] sign-up POST returned ${signUpResponse.status()}: ` +
        `${(await signUpResponse.text().catch(() => "")).slice(0, 300)}`,
    );
  }
  // Only when verification is OFF. With it ON, Better Auth deliberately returns
  // no session until the emailed link is followed, so waiting here would be
  // waiting for something that must not exist yet.
  if (!needsVerification) await waitForSessionCookie(page, "sign-up");

  if (needsVerification && mailbox) {
    const link = await mailbox.waitForLink(/verify|verification|token/i);
    await page.goto(link); // autoSignInAfterVerification signs the session in
  }

  // Prove we actually hold a session: onboarding must NOT bounce to sign-in.
  await page.goto("/onboarding");
  await expect(page).not.toHaveURL(/\/auth\/sign-in/);

  const account: Account = mailbox
    ? { email, password, mailbox, name }
    : { email, password, name };
  if (opts.onboard) await completeBio(page, { username: opts.username });
  return account;
}

// --- Sign in / out ---------------------------------------------------------

/**
 * Sign an existing account into the given app (default: web). Leaves the page on
 * that app, signed in. Enumeration-safe copy means a wrong password shows the
 * SAME message as an unknown email — so this asserts SUCCESS by leaving the
 * sign-in route, never by message text.
 */
export async function signInAs(
  page: Page,
  account: Pick<Account, "email" | "password">,
  app: AppName = "web",
): Promise<void> {
  await page.goto(signInPath(app));
  await assertConfigured(page);
  // ANCHORED REGEX, NOT `{ exact: true }` — this helper serves all three apps,
  // and the suppliers sign-in marks both fields `required`, which @quagga/ui's
  // Field renders as a trailing "*". An exact match then waits 20s for "Email"
  // while "Email *" is on screen; that is why every supplier spin-up through
  // this helper timed out on a form it had already loaded.
  await page.getByLabel(/^Email/).fill(account.email);
  await page.getByLabel(/^Password/).fill(account.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page).not.toHaveURL(
    new RegExp(`${signInPath(app).replace(/\//g, "\\/")}`),
  );
  // WAIT FOR THE LANDING PAGE TO SETTLE. The assertion above passes the instant
  // the URL stops being the sign-in route — which is while the post-sign-in
  // navigation is still in flight. Sixteen specs call `page.goto(...)` on the
  // very next line, and that goto races ours: Playwright aborts the caller's
  // navigation in favour of the one already running and reports
  // `net::ERR_ABORTED at .../profile`, or the blunter "Navigation to /profile is
  // interrupted by another navigation to /directory". It reads as the app
  // failing to serve a page it serves perfectly well.
  await page.waitForLoadState("load");
}

/** End the current session (web/org header sign-out; supplier equivalent). */
export async function signOut(page: Page): Promise<void> {
  // Loud, not silent. This used to `return` when the control was missing, so a
  // spec that meant "sign out, now prove the session is gone" quietly asserted
  // against a STILL-SIGNED-IN browser and blamed the app for the result.
  // WAIT for the control, do not `count()` it. `count()` resolves immediately,
  // so arriving here straight after a redirect it reads 0 while the page is
  // still rendering — which the old code treated as "no button, nothing to do"
  // and returned silently, leaving later assertions to run against a live
  // session and blame the app. Wait, then fail loudly if it truly is not there.
  const btn = page.getByRole("button", { name: /sign out/i }).first();
  try {
    await btn.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    throw new Error(
      `[e2e] signOut(): no "Sign out" control on ${page.url()} after 10s. The ` +
        `factory did nothing, so anything asserted after this would be testing ` +
        `a live session.`,
    );
  }
  await btn.click();
  await expect(page).toHaveURL(/\/(auth\/sign-in|signin)?$|\/$/);

  // The click-vs-request race again, in its most misleading form: without this,
  // the very next navigation can still carry a live session cookie, so a spec
  // asserting "signed out means this route needs sign-in" lands on the ONBOARDING
  // GATE instead and reads as a broken sign-out. Wait for the cookie to actually
  // go away.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const cookies = await page.context().cookies();
    if (
      !cookies.some((c) => /quagga\.session_token$/.test(c.name) && c.value)
    ) {
      return;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(
    "[e2e] sign-out did not clear the session cookie within 10s.",
  );
}

// --- Burner Bio (onboarding) ----------------------------------------------

/**
 * Complete the 5-step Burner Bio and return the username it set.
 *
 * NOTHING in the bio is required any more — the username is an optional alias
 * (@quagga/core `username.ts`), and completion is the ACT of reaching the end
 * and saving (`isBioComplete`). The factory still sets a username because almost
 * every downstream assertion needs a name to find a burner BY; pass
 * `username: null` for the journeys that must prove the flow completes without
 * one.
 */
export async function completeBio(
  page: Page,
  opts: { username?: string | null; homeCity?: string } = {},
): Promise<{ username: string | null }> {
  const username =
    opts.username === null ? null : (opts.username ?? uniqueUsername("dusty"));
  await page.goto("/onboarding");
  await assertConfigured(page);

  // If a completed bio already exists the app redirects to /profile — treat as done.
  if (/\/profile/.test(page.url())) return { username };

  // Step 1 — Welcome.
  await page.getByRole("button", { name: "Get started" }).click();

  // Step 2 — Your details. Every field here is optional now.
  if (username !== null) {
    await page.getByRole("textbox", { name: /username/i }).fill(username);
  }
  if (opts.homeCity)
    await page.getByRole("textbox", { name: /home city/i }).fill(opts.homeCity);
  await page.getByRole("button", { name: "Save & continue" }).click();

  // Step 3 — Burns & volunteering (no required fields).
  await page.getByRole("button", { name: "Save & continue" }).click();

  // Step 4 — Privacy review → completes the bio.
  await page.getByRole("button", { name: "Complete my bio" }).click();

  // Step 5 — Done.
  await expect(page.getByText(/you['’]re all set/i)).toBeVisible();
  return { username };
}

// --- Camps -----------------------------------------------------------------

/**
 * Create a theme camp and return its slug. The creator becomes the structural
 * lead. Requires an onboarded session (the /camps/new route gates on it).
 */
export async function createCamp(
  page: Page,
  opts: {
    name?: string;
    description?: string;
    joinability?: "open" | "invite_only";
  } = {},
): Promise<{ slug: string; name: string }> {
  const name = opts.name ?? uniqueCampName();
  await page.goto("/camps/new");
  await assertConfigured(page);
  await expect(page).not.toHaveURL(/\/onboarding/); // gate would send us here if not onboarded

  await page.getByLabel(/camp name/i).fill(name);
  if (opts.description)
    await page.getByLabel(/short description/i).fill(opts.description);

  // Apply joinability when asked — the create-camp form's Joinability <Select>
  // (create-camp-form.tsx) defaults to "open"; an invite_only caller relies on
  // this actually being set, so drive the combobox rather than silently drop it.
  if (opts.joinability && opts.joinability !== "open") {
    // The SelectTrigger carries id="joinability" (create-camp-form.tsx); its
    // accessible name is ambiguous (label vs. current-value text), so target the
    // stable id directly, then pick the invite-only option.
    await page.locator("#joinability").click();
    await page.getByRole("option", { name: /invite-only/i }).click();
  }

  const createButton = page.getByRole("button", { name: /create camp/i });
  await createButton.click();

  // The form SOFT-WARNS on a near-duplicate name and requires a second,
  // confirming submit (`confirmWarnings`) — deliberate product behaviour, with
  // its own spec in camp-lifecycle. A factory that clicked once then waited for
  // a redirect simply hung whenever the fuzzy matcher fired, and it fires often
  // here: `uniqueCampName` varies a suffix, not the stem, so after a few runs a
  // database full of past camps makes a near-match almost certain. This is a
  // factory — its job is "get me a camp" — so it confirms and moves on. The spec
  // that actually asserts the warning drives the form directly.
  const warning = page.getByText(/similar to existing camp/i);
  await Promise.race([
    page.waitForURL(isCampDetailUrl).catch(() => undefined),
    warning
      .waitFor({ state: "visible", timeout: 10_000 })
      .catch(() => undefined),
  ]);
  if (await warning.count()) {
    await createButton.click();
  }

  // waitForURL resolves IMMEDIATELY when the CURRENT url already matches, and we
  // start on /camps/new — which a naive /\/camps\/[^/]+$/ matches ("new" is a
  // valid [^/]+ segment). Exclude the form's own route so only a real redirect to
  // a camp detail page counts. (Same predicate proven in camp-lead/support.ts.)
  await page.waitForURL(isCampDetailUrl);
  const slug = new URL(page.url()).pathname.split("/").filter(Boolean).pop()!;
  return { slug, name };
}

/**
 * Create an invite link on a camp the current user leads/admins, and return the
 * token + full URL. `kind` is a normal member invite by default; a
 * `lead_transfer` link is only offered to the lead.
 */
export async function inviteToCamp(
  page: Page,
  slug: string,
  kind: "member" | "lead_transfer" = "member",
): Promise<{ token: string; url: string }> {
  await page.goto(`/camps/${slug}`);
  await assertConfigured(page);
  const label =
    kind === "member" ? /new member invite/i : /lead-transfer link/i;
  await page.getByRole("button", { name: label }).click();

  // The freshly-created invite is prepended; its URL renders in a <code>.
  const code = page.locator("code").first();
  await expect(code).toContainText("/join/");
  const url = (await code.textContent())!.trim();
  const token = url.split("/join/").pop()!.trim();
  return { token, url };
}

/**
 * Redeem an invite as the currently-signed-in (onboarded) user, joining the
 * camp. Returns the joined camp's slug. The invitee must already be onboarded —
 * the join route enforces the onboarding gate and survives the round trip.
 */
export async function joinByInvite(
  page: Page,
  tokenOrUrl: string,
): Promise<{ slug: string }> {
  const token = tokenOrUrl.includes("/join/")
    ? tokenOrUrl.split("/join/").pop()!.trim()
    : tokenOrUrl;
  await page.goto(`/join/${token}`);
  await assertConfigured(page);
  await expect(page).not.toHaveURL(/\/auth\/sign-in/);

  // The JoinButton's label varies (member vs lead-transfer); it is the primary
  // action on the page and is never "Sign in".
  await page
    .getByRole("button", { name: /join|accept|redeem/i })
    .first()
    .click();

  // Same waitForURL-matches-immediately trap as createCamp: exclude non-detail
  // routes so we read the real joined-camp slug, never the route we started on.
  await page.waitForURL(isCampDetailUrl);
  const slug = new URL(page.url()).pathname.split("/").filter(Boolean).pop()!;
  return { slug };
}

/**
 * THE signed-out invite journey, end to end — the one an invite link actually
 * exists for. Opens `/join/<token>` with NO session, accepts it from the landing
 * page, creates the account there and then, clears the Burner-Bio gate, and
 * lands on the camp as a member. Returns the freshly-created account + slug.
 *
 * The invite is carried across the auth round trip by an httpOnly cookie set on
 * the accept click, so nothing in this journey ever puts the token back in a
 * url; the spec proves the OUTCOME (a membership on the far side), which is the
 * only thing a mechanism change should be allowed to break.
 *
 * @throws MailUnavailableError if the deployment requires verification but
 *   E2E_MAIL_MODE is off — the caller should skip in that case.
 */
export async function acceptInviteAsNewBurner(
  page: Page,
  tokenOrUrl: string,
  opts: { username?: string } = {},
): Promise<{ account: Account; slug: string }> {
  const token = tokenOrUrl.includes("/join/")
    ? tokenOrUrl.split("/join/").pop()!.trim()
    : tokenOrUrl;

  await page.goto(`/join/${token}`);
  await assertConfigured(page);
  // The whole point: a signed-out visitor is NOT bounced to the auth wall.
  await expect(page).not.toHaveURL(/\/auth\/sign-in/);

  await page
    .getByRole("button", { name: /^(join |accept lead role)/i })
    .first()
    .click();

  // Accepting carries them into account creation with the invite still live.
  await page.waitForURL(/\/auth\/sign-up/);

  const needsVerification = requiresEmailVerification();
  let mailbox: Mailbox | undefined;
  let email: string;
  if (needsVerification) {
    mailbox = await requireMailbox("invitee");
    email = mailbox.address;
  } else {
    email = uniqueEmail("invitee");
  }
  const password = TEST_PASSWORD;

  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  // Same click-vs-request race as signUpBurner — wait for the POST to land
  // before anything reads the session.
  const signUpResponse = await page.waitForResponse(
    (r) =>
      r.url().includes("/api/auth/sign-up") && r.request().method() === "POST",
    { timeout: 15_000 },
  );
  if (!signUpResponse.ok()) {
    throw new Error(
      `[e2e] sign-up POST returned ${signUpResponse.status()}: ` +
        `${(await signUpResponse.text().catch(() => "")).slice(0, 300)}`,
    );
  }
  // Only when verification is OFF. With it ON, Better Auth deliberately returns
  // no session until the emailed link is followed, so waiting here would be
  // waiting for something that must not exist yet.
  if (!needsVerification) await waitForSessionCookie(page, "sign-up");

  if (needsVerification && mailbox) {
    const link = await mailbox.waitForLink(/verify|verification|token/i);
    await page.goto(link); // autoSignInAfterVerification + the invite callback
  }

  // The Burner Bio gate stands between the new account and the join; it is NOT
  // bypassed, and the invite survives it.
  await page.waitForURL(/\/onboarding/);
  const username = opts.username ?? uniqueUsername("invitee");
  await completeBio(page, { username });

  // The done step's primary action finishes the invite rather than dumping them
  // on the directory — that copy is the visible proof the invite was preserved.
  await page.getByRole("button", { name: /continue to your camp/i }).click();

  // /join/continue is a CONFIRM page, not an auto-complete redirect: the join
  // writes a membership row and burns a single-use invite, so it must not happen
  // merely by landing on a url, and the page names the signed-in account first
  // in case a shared browser is about to spend someone else's link. Click
  // through it. (Kept tolerant of arriving straight on the camp, so this factory
  // does not silently depend on the confirm step existing.)
  const confirmJoin = page.getByRole("button", { name: /^join /i });
  await Promise.race([
    page.waitForURL(isCampDetailUrl).catch(() => undefined),
    confirmJoin
      .waitFor({ state: "visible", timeout: 20_000 })
      .catch(() => undefined),
  ]);
  if (await confirmJoin.count()) await confirmJoin.click();

  await page.waitForURL(isCampDetailUrl);
  const slug = new URL(page.url()).pathname.split("/").filter(Boolean).pop()!;

  const account: Account = mailbox
    ? { email, password, mailbox, name: username }
    : { email, password, name: username };
  return { account, slug };
}

// --- Registration (six-section wizard) -------------------------------------

/** Values the caller may override; anything omitted gets a valid default. */
export interface RegistrationInput {
  description?: string;
  contactEmail?: string;
  lntPlan?: string;
  lntLeadName?: string;
  lntLeadPhone?: string;
  lntLeadEmail?: string;
  participationPlan?: string;
  expectedPopulation?: number;
  firstArrivalDate?: string; // yyyy-mm-dd
  areaDimensions?: string;
  /**
   * Layout sketch links for section 4, added through the REAL FileUpload
   * control's URL-paste path (no deployment here has BLOB_READ_WRITE_TOKEN, and
   * a token in CI would mean the suite writes to a live blob store).
   *
   * Optional because most journeys do not care; when a spec does, it needs the
   * links to be part of the SUBMITTED registration, and the wizard is read-only
   * once submitted — so there is no adding them afterwards.
   */
  layoutUrls?: string[];
  soundPlan?: string;
  feeStructure?: string;
}

/** Click a wizard section by its label (@quagga/ui Wizard renders each as a button). */
async function goToSection(page: Page, label: string): Promise<void> {
  await page
    .getByRole("button", { name: new RegExp(label, "i") })
    .first()
    .click();
}

/**
 * Fill and SUBMIT the six-section theme-camp registration, driving the real
 * wizard. Returns nothing; assert the resulting state (`submitted`) in the spec.
 * The caller must lead/admin the camp and it must be a `theme_camp` (MV/art
 * register through their own forms — the wizard is camp-shaped by design).
 *
 * Completeness mirrors packages/core registration-sections.ts SECTION_PREDICATES
 * exactly, so the client submit gate opens and the server accepts.
 */
export async function submitRegistration(
  page: Page,
  slug: string,
  input: RegistrationInput = {},
): Promise<void> {
  await page.goto(`/camps/${slug}/registration`);
  await assertConfigured(page);
  await expect(page).not.toHaveURL(/\/onboarding|\/auth\/sign-in/);

  // Section 1 — Camp Identity (identity is the default active section).
  await page
    .getByLabel(/camp description/i)
    .fill(
      input.description ??
        "A dusty tea house on the Tankwa, gifting chai at dawn.",
    );
  await page
    .getByLabel(/^contact email/i)
    .fill(input.contactEmail ?? "lead@example.com");

  // Section 2 — Leave No Trace.
  await goToSection(page, "Leave No Trace");
  await page
    .getByLabel(/leave no trace plan/i)
    .fill(
      input.lntPlan ??
        "MOOP sweeps twice daily; grey water evaporated; all waste packed out.",
    );
  await page
    .getByLabel(/lnt lead name/i)
    .fill(input.lntLeadName ?? "Ren Notfound");
  await page
    .getByLabel(/lnt lead phone/i)
    .fill(input.lntLeadPhone ?? "+27 82 555 0100");
  await page
    .getByLabel(/lnt lead email/i)
    .fill(input.lntLeadEmail ?? "lnt@example.com");

  // Section 3 — Participation & Gifting.
  await goToSection(page, "Participation");
  await page
    .getByLabel(/participation plan/i)
    .fill(
      input.participationPlan ??
        "We gift tea, shade, and a quiet corner for burners to rest.",
    );
  await page.getByRole("button", { name: "Day", exact: true }).click(); // an operating-hours pill
  await page.getByRole("button", { name: "Yes", exact: true }).click(); // Gifting food? — the only Yes/No in this section

  // Section 4 — Size & Logistics.
  await goToSection(page, "Size & Logistics");
  await page
    .getByLabel(/expected population/i)
    .fill(String(input.expectedPopulation ?? 40));
  await page
    .getByLabel(/first arrival date/i)
    .fill(input.firstArrivalDate ?? "2027-04-20");
  await page
    .getByLabel(/camp area dimensions/i)
    .fill(input.areaDimensions ?? "20m x 15m");
  for (const [i, layoutUrl] of (input.layoutUrls ?? []).entries()) {
    await page.getByLabel("Paste a URL").fill(layoutUrl);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    // Each accepted link renders its own remove control — waiting on it means
    // the next fill cannot race the list re-render.
    await expect(
      page.getByRole("button", { name: `Remove upload ${i + 1}` }),
    ).toBeVisible();
  }

  // Section 5 — Sound & Placement. Pick a SOOP level AND fill a sound plan so
  // completeness holds regardless of which level is the "no amplified" one.
  await goToSection(page, "Sound & Placement");
  await page.getByRole("radio").first().click();
  await page
    .getByLabel(/sound plan/i)
    .fill(input.soundPlan ?? "One small speaker, off by quiet hours; no sub.");
  await page.getByRole("combobox").first().click(); // Placement — first choice
  await page.getByRole("option").first().click();
  await page.getByRole("button", { name: "Yes", exact: true }).click(); // Family-friendly?

  // Section 6 — Suppliers & Commerce.
  await goToSection(page, "Suppliers & Commerce");
  await page.getByRole("button", { name: "No", exact: true }).click(); // Paid performers?
  await page
    .getByLabel(/camp fee structure/i)
    .fill(
      input.feeStructure ??
        "Member contributions cover shared infrastructure only; no profit.",
    );
  await page.getByRole("checkbox", { name: /plug.*play/i }).check(); // anti-commerce ack (mandatory)

  // Let the autosave land BEFORE submitting. The wizard commits field changes
  // asynchronously, and the server re-checks completeness against what it has
  // stored — so clicking submit in the same tick can be judged against a draft
  // that is still missing the last answer. The button is enabled either way
  // (the CLIENT thinks it is complete), which is what makes this look like a
  // broken submit rather than a race.
  await expect(page.getByText(/saved just now/i)).toBeVisible({
    timeout: 15_000,
  });

  // Submit — the gate opens only when the client sees all six sections complete;
  // handleSubmit force-saves the draft before the server re-checks completeness.
  const submit = page.getByRole("button", { name: /submit registration/i });
  await expect(submit).toBeEnabled();
  await submit.click();
  // The post-submit surface is the SUMMARY, whose status header reads
  // "Submitted — awaiting review" (registration-summary.tsx). There is no
  // "Registration submitted" string anywhere in the app; the factory was
  // asserting copy that never shipped.
  await expect(
    page.getByText(/submitted\s+—\s+awaiting review/i),
  ).toBeVisible();
}

// --- Suppliers -------------------------------------------------------------

/**
 * Register an ART PROJECT and stop at the DRAFT, driving `/artworks/new`.
 *
 * The submit gate wants an artist, a description, a footprint, a burn intent
 * and two plans (`artworkSubmitGate`); a draft wants only the name, and the
 * page says so — "your project exists the moment you save". A draft is enough
 * to make the account an ART LEAD, which is what the `art_leads` audience
 * resolves against, so this is the cheap way to build one.
 *
 * Returns the artwork's name and slug. The artwork is a `groups` row of kind
 * `artwork`, so it lands on `/camps/<slug>` like any other project.
 */
export async function createArtProject(
  page: Page,
  opts: { name?: string } = {},
): Promise<{ name: string; slug: string }> {
  const name = opts.name ?? uniqueName("Whispering Baobab");
  await page.goto("/artworks/new");
  await assertConfigured(page);
  await expect(
    page.getByRole("heading", { name: /register an art project/i }),
  ).toBeVisible();

  await page.getByLabel("Artwork name").fill(name);
  await page.getByRole("button", { name: /^save draft$/i }).click();
  await page.waitForURL(isCampDetailUrl);

  const slug = new URL(page.url()).pathname.split("/").pop() ?? "";
  if (!slug) {
    throw new Error(
      `[factories] No slug in ${page.url()} after saving an artwork draft.`,
    );
  }
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return { name, slug };
}

/**
 * Self-register a supplier through the portal sign-up form and (when
 * verification is off) land on onboarding. `email` may be supplied to exercise
 * the claim-by-email path against a seeded catalog row (M3-28); omit it for a
 * fresh row.
 */
export async function registerSupplier(
  page: Page,
  opts: {
    email?: string;
    businessName?: string;
    contactPerson?: string;
    category?: string;
  } = {},
): Promise<Account> {
  const needsVerification = requiresEmailVerification();
  let mailbox: Mailbox | undefined;
  let email: string;
  if (opts.email) {
    email = opts.email;
  } else if (needsVerification) {
    mailbox = await requireMailbox("supplier");
    email = mailbox.address;
  } else {
    email = uniqueEmail("supplier");
  }
  const businessName = opts.businessName ?? uniqueSupplierName();
  const password = TEST_PASSWORD;

  await page.goto("/signup");
  await assertConfigured(page);
  await page.getByLabel(/business name/i).fill(businessName);
  await page
    .getByLabel(/contact person/i)
    .fill(opts.contactPerson ?? "Sam Supplier");
  // ANCHORED REGEX, NOT `{ exact: true }`. Every field on the suppliers sign-up
  // form is `required`, and @quagga/ui's Field appends a "*" to the label for
  // that — so the label text is "Email *" and an exact match waits 20s for an
  // element that is right there. `^` still excludes "Confirm password" and the
  // like. (The web app's sign-in fields are not required, which is why the
  // identical calls above have survived; mark one required and they break the
  // same way, so prefer this form.)
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByLabel(/service category/i).click();
  await page
    .getByRole("option", { name: opts.category ?? "Transport" })
    .click();
  await page
    .getByRole("checkbox", { name: /read the supplier basics/i })
    .check();
  await page.getByRole("button", { name: /create account/i }).click();

  // Same click-vs-request race as signUpBurner — wait for the POST to land
  // before anything reads the session.
  const signUpResponse = await page.waitForResponse(
    (r) =>
      r.url().includes("/api/auth/sign-up") && r.request().method() === "POST",
    { timeout: 15_000 },
  );
  if (!signUpResponse.ok()) {
    throw new Error(
      `[e2e] sign-up POST returned ${signUpResponse.status()}: ` +
        `${(await signUpResponse.text().catch(() => "")).slice(0, 300)}`,
    );
  }
  // Only when verification is OFF. With it ON, Better Auth deliberately returns
  // no session until the emailed link is followed, so waiting here would be
  // waiting for something that must not exist yet.
  if (!needsVerification) {
    await waitForSessionCookie(page, "sign-up");

    // AND WAIT FOR THE SUPPLIER ROW, which the sign-up POST does not create.
    // sign-up-form.tsx does three things in order: `authClient.signUp.email`,
    // then the `registerSupplier` SERVER ACTION that writes the supplier and
    // seeds its onboarding steps, then `router.push("/onboarding")`. Waiting on
    // the POST alone returns while step two is still in flight, so a caller that
    // navigates immediately gets "You're signed in as …, but we couldn't match
    // you to a supplier" — the portal is right, the row genuinely is not there
    // yet. standing.spec.ts hit exactly that and read as a product bug; the row
    // was in the database, linked to this very account, seconds later. Landing
    // on /onboarding is the observable proof the action finished.
    await page.waitForURL(/\/onboarding\/?$/, { timeout: 20_000 });
  }

  if (needsVerification && mailbox) {
    const link = await mailbox.waitForLink(/verify|verification|token/i);
    await page.goto(link);
  }
  return mailbox
    ? { email, password, mailbox, name: businessName }
    : { email, password, name: businessName };
}

// --- God / org access ------------------------------------------------------

/** Thrown when god journeys are requested but no god credentials are configured. */
export class GodUnavailableError extends Error {
  constructor() {
    super(
      "No god credentials configured (E2E_GOD_EMAIL / E2E_GOD_PASSWORD). God " +
        "bootstrap needs a VERIFIED email on the deployment's GOD_EMAILS list; " +
        "a fresh random sign-up is never verified when mail is off. Skip this spec.",
    );
    this.name = "GodUnavailableError";
  }
}

/**
 * Sign the pre-provisioned god account into the org console, triggering the
 * GOD_EMAILS bootstrap (resolveOrgSession grants `god` on first authenticated
 * load when the email is listed AND verified). Asserts the console is reachable.
 *
 * This is NOT a self-service elevation — by design god cannot be minted through
 * the UI. See e2e/README.md "Google & god access" for why and how to provision.
 */
export async function elevateToGod(orgPage: Page): Promise<{ email: string }> {
  const creds = godCredentials();
  if (!creds) throw new GodUnavailableError();
  await signInAs(orgPage, creds, "org");
  await orgPage.goto("/"); // resolveOrgSession runs here and bootstraps god
  await assertConfigured(orgPage);
  // Console reachable → we are not in the 'forbidden'/'unauthenticated' state.
  await expect(
    orgPage.getByText(/forbidden|not authorised|no access|sign in/i),
  ).toHaveCount(0);
  return { email: creds.email };
}
