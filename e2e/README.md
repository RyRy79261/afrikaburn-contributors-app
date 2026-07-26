# @quagga/e2e — Playwright end-to-end harness

The shared harness for the three Quagga Portal apps. **Every persona agent depends
on this API.** Import from here; do not re-implement sign-up/onboarding/etc. Tests
drive the **real UI** against a **deployed** app (preview / localhost / prod) — no
database back doors for setup (roadmap M3-16). Nothing here has been run yet: there
is no deployed DB (roadmap §0). It is written correct-by-construction against
selectors verified in source on 2026-07-26.

## Running

```bash
pnpm --filter @quagga/e2e install:browsers   # once, installs chromium
cp e2e/.env.example e2e/.env                  # point at your deployment (see below)
pnpm --filter @quagga/e2e e2e                 # full suite, both projects
pnpm --filter @quagga/e2e e2e:smoke           # @smoke subset (PR gate)
pnpm --filter @quagga/e2e e2e:ui              # interactive
pnpm --filter @quagga/e2e e2e:report          # open last HTML report
```

Config is 100% env-driven (`e2e/lib/env.ts`). Base URLs default to local dev ports
(web 3000 / org 3001 / suppliers 3002); CI overrides all three with the preview.
The suite **refuses to run against a production apex host** unless
`E2E_ALLOW_PRODUCTION=true` — it creates real accounts and rows.

## Projects (viewports)

- `desktop-chromium` — 1280×800
- `mobile-360` — 360×780 (the design's mobile baseline)

Retries: 2 in CI only. Trace/video/screenshot: retained on failure only.

## Writing a spec

```ts
import { test, expect, skipUnlessMail, skipUnlessGod } from "../fixtures";
import {
  signUpBurner,
  createCamp,
  submitRegistration,
} from "../personas/factories";

test("a camp registers", async ({ webPage }) => {
  const lead = await signUpBurner(webPage, { onboard: true });
  const camp = await createCamp(webPage);
  await submitRegistration(webPage, camp.slug);
});
```

### Fixtures (`e2e/fixtures.ts`)

| Fixture            | Type                     | Notes                                                 |
| ------------------ | ------------------------ | ----------------------------------------------------- |
| `webPage`          | `Page`                   | Isolated context against the **web** app.             |
| `orgPage`          | `Page`                   | Isolated context against the **org** app.             |
| `suppliersPage`    | `Page`                   | Isolated context against the **suppliers** app.       |
| `makeAppPage(app)` | `(app) => Promise<Page>` | Make an extra isolated page for any app; auto-closed. |

Each app gets its **own** context/page because cross-subdomain SSO does **not**
span the different hosts of a preview — sign in on the app you are testing. All
pages inherit the running project's viewport and carry the Vercel protection
bypass header. **No shared mutable state** — every spec creates its own data.

Helpers: `skipUnlessMail()`, `skipUnlessGod()` — call at the top of a test to skip
cleanly when the capability is absent.

## Persona factories (`e2e/personas/factories.ts`)

All take a `Page` bound to the right app and drive the real UI. Emails are unique
per worker (`e2e/lib/identity.ts`) so parallel runs never collide.

| Factory              | Signature                                                       | Returns           | Notes                                                                                                                                                                                          |
| -------------------- | --------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signUpBurner`       | `(page, { onboard?, displayName? }?)`                           | `Account`         | web app. Handles verification-off (synthetic email, auto sign-in) **and** verification-on (disposable inbox + link) transparently. `onboard:true` chains `completeBio`.                        |
| `completeBio`        | `(page, { displayName?, homeCity? }?)`                          | `{ displayName }` | Walks the 5-step Burner Bio; releases the onboarding gate. Idempotent if already complete.                                                                                                     |
| `signInAs`           | `(page, { email, password }, app?)`                             | `void`            | `app` = `"web" \| "org" \| "suppliers"` (default web). Asserts success by leaving the sign-in route (copy is enumeration-safe).                                                                |
| `signOut`            | `(page)`                                                        | `void`            | Header sign-out.                                                                                                                                                                               |
| `createCamp`         | `(page, { name?, description?, joinability? }?)`                | `{ slug, name }`  | web. Creator becomes structural **lead**. Requires an onboarded session. Creates a `theme_camp`.                                                                                               |
| `inviteToCamp`       | `(page, slug, kind?)`                                           | `{ token, url }`  | `kind` = `"member"` (default) \| `"lead_transfer"`. Reads the invite URL from the rendered `<code>`.                                                                                           |
| `joinByInvite`       | `(page, tokenOrUrl)`                                            | `{ slug }`        | Redeems as the current onboarded user.                                                                                                                                                         |
| `acceptInviteAsNewBurner` | `(page, tokenOrUrl, { displayName? }?)`                    | `{ account, slug }` | The **signed-out** journey: opens the link with no session, accepts, creates the account, clears the Burner Bio gate, and lands on the camp. Handles verification-on/off like `signUpBurner`. |
| `submitRegistration` | `(page, slug, input?)`                                          | `void`            | Fills **all six** wizard sections and submits; asserts "Registration submitted". Completeness mirrors `packages/core` `SECTION_PREDICATES` exactly. Overridable fields in `RegistrationInput`. |
| `registerSupplier`   | `(page, { email?, businessName?, contactPerson?, category? }?)` | `Account`         | suppliers app. Pass `email` overlapping a seeded catalog row to exercise **claim-by-email**; omit for a fresh row.                                                                             |
| `elevateToGod`       | `(orgPage)`                                                     | `{ email }`       | Signs the **pre-provisioned** god account in and triggers the GOD_EMAILS bootstrap. **Not** self-service (see below). Throws `GodUnavailableError` if creds absent.                            |

`Account = { email, password, name, mailbox? }`. `mailbox` (a live disposable
inbox) is present only when the account was created against real mail capture.

## Mail capture (`e2e/lib/mail.ts`)

- `createMailbox(hint?)` / `requireMailbox(hint?)` → `Mailbox` with
  `waitForMessage(match?)` and `waitForLink(pattern, match?)`.
- Strategy: **mail.tm disposable inboxes** (roadmap M3-17 decision). It exercises
  the **real** delivery path (app → Resend → DNS → inbox) and needs **no product
  code change**. Email verification is currently **off**, so mail is unavailable
  by default and link-dependent flows skip (`skipUnlessMail()`); they light up the
  moment `E2E_MAIL_MODE=mailtm` and the deployment has a Resend key.
- **Rejected** alternatives, and the guardrail if one is ever adopted: a test-only
  "peek the latest token" endpoint (option c) is a product-code auth side-door — we
  do **not** ship it. If nightly flakiness ever forces it, it MUST be secret-gated,
  MUST hard-refuse when the secret is unset, and MUST arrive with a route-census
  entry and a test asserting the refusal. Mailpit/MailHog (option b) can't be
  reached from a Vercel preview, so it would stop testing the real deployment.
  `getTestInstance()`/`getOTP()` (option d) is in-process only — useless against a
  deployed preview.

## Google & god access — honest limitations

- **Google OAuth is NOT E2E-tested.** Real Google sign-in cannot be driven
  headlessly in CI (bot detection, consent screens, 2FA), and mocking the provider
  callback would require a product-code side-door we refuse to ship. The
  "Continue with Google" button's presence/wiring can be asserted, but a full
  OAuth round trip is **out of automated scope** — state this loudly rather than
  imply coverage. `E2E_GOOGLE_DRIVEABLE` exists only for a bespoke local run with a
  throwaway Google account you accept the fragility of.
- **God cannot be minted through the UI — by design.** `resolveOrgSession`
  bootstraps `god` only for an email that is on `GOD_EMAILS` **and** verified
  (`packages/core` `canBootstrapGod`). A fresh random sign-up is never verified
  when mail is off. So org-console (god) journeys need a **pre-provisioned**
  account: set `E2E_GOD_EMAIL`/`E2E_GOD_PASSWORD` for an account whose email is in
  the deployment's `GOD_EMAILS` and already verified (via Google once, or via mail
  capture on a `mailtm` deployment). Absent → `elevateToGod` throws and god specs
  `skipUnlessGod()`.

## Persona registry (`e2e/personas/registry.ts`)

The **single** source of the authz matrix. `PERSONAS[kind]` gives `{ allowed,
forbidden }` capabilities; `forbiddenMatrix()` yields every (persona, forbidden
capability) pair for the negative-path suite (M3-30). Each forbidden capability
carries a `refusalHint` naming the server guard to prove — the assertion is always
"the guard **refuses**", never "the link is hidden". `HARD_LOCKED_PRIVATE_FIELDS`
mirrors `packages/core/src/privacy.ts` (source of truth; the PII-projection guard
pins the canonical list).

## Cleanup / isolation

Isolation within a run is by construction: unique-per-worker emails and
per-spec-created data, no shared fixtures. Full teardown is **environmental**, not
per-test: E2E runs against a **throwaway Neon branch** behind a preview, and CI
**deletes the branch on completion** (auth-spec §5.2 / roadmap M3-31). Leaked rows
on that ephemeral branch are therefore acceptable and cheaper than a UI-driven
teardown that would itself need auth. There is no destructive DB helper here — the
only writer is the app, exactly as a real user.

## CI wiring (M3-31 — downstream of this harness)

- **PR:** `e2e:smoke` (`--grep @smoke`) against the preview — shells load, an auth
  round trip, a negative path.
- **Nightly:** full suite, both projects, on the `deployment_status` event (carries
  the preview URL); send `x-vercel-protection-bypass`; throwaway Neon branch,
  deleted on completion; upload traces/videos on failure.

## Selector traps (each of these cost a debugging session)

Every one of these produced a failure that *looked* like a product bug. The specs
were authored against source, never against a live DOM, so the whole class went
unnoticed until the suite was first executed.

- **`getByRole("alert")` can never resolve to one element.** Next injects
  `<div role="alert" id="__next-route-announcer__">` into every page, so a bare
  alert query always matches it too — and `toHaveCount(0)` can never pass. Use
  `appAlerts(page)` from `lib/dom.ts`.
- **A `required` field's label contains the asterisk.** `Labeled` renders
  `{label}<span aria-hidden>*</span>`, so the accessible name is
  `"Contact email *"` and `getByLabel("Contact email", { exact: true })` matches
  nothing. Use a prefix regex: `getByLabel(/^contact email/i)`.
- **Burner Bio text fields collide with their own privacy switch.** The switch's
  aria-label is `"Home city — public or private"`, so `getByLabel(/home city/i)`
  is a strict-mode violation. Scope to the control:
  `getByRole("textbox", { name: /home city/i })`.
- **`.click()` is not "the request finished".** It resolves when the event is
  dispatched. Navigating straight afterwards raced the sign-up POST and the
  session cookie did not exist yet, so the gate bounced to sign-in and ~100
  specs blamed the product. The sign-up factories now wait for the response AND
  for the cookie to actually land (`waitForSessionCookie`).
- **Create-camp soft-warns on a near-duplicate name** and needs a second,
  confirming submit. `uniqueCampName` varies a suffix rather than the stem, so
  once the database holds a few camps a near-match is close to certain.
