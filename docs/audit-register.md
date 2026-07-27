# Audit register — 27 July 2026

> **STATUS, 27 Jul 2026 (post-triage).** Two corrections to what follows, then
> the fix state.
>
> 1. **This deployment is LIVE.** Sections below (notably §2 and theme T1) were
>    written believing there was no Neon database yet and that
>    `ACCOUNT_SWEEP_SECRET` / `PGCRYPTO_KEY` were unset. All three are set and
>    everything is deployed. That makes B1 a live production defect rather than
>    a dormant one, and makes M3's "set the key first" advice moot.
> 2. **B1's second claim was overstated.** The Cancel control is reachable — the
>    Delete tab is in `account-shell.tsx:22`. The real defect was the missing
>    sign-in hook, which is what has been fixed.
>
> **Fixed and on main:** B1, B2, B3, M1, M2, M3, M4, M5, M6, M7, M8, M9, M10,
> M11, M14, M15, M16, M18, M19, M20, M21 (harness + first tests), M22.
>
> **Still open, deliberately — these need a decision, not a patch:** M12
> (a unique constraint on `questionnaire_responses` needs a migration and a
> call on what re-sending should mean), M13 (notification links need an origin
> column — a schema and fan-out change across three apps), M17 (supplier step
> reconciliation on the org side). The 45 minors and 57 design-parity items are
> untouched.


Read-only audit of the Quagga Portal at HEAD (`5300038`). Nine parallel dimensions
(design parity ×3 bands, authz, privacy, auth, data, deadcode, patterns, gaps) plus a
completeness critic. Every finding below was **verified** — the verifier either
reproduced it against the local stack or killed it. Refuted claims are dropped; the
short "already cleared" list at the end exists so nobody re-raises them.

Ordering is by what hurts most at the kickoff (28 July) and in the burn's real
operation — not by dimension.

---

## 1. Headline

**The codebase is in good structural health and its authorization core is genuinely
sound. The danger is not in the code that is written — it is in three time bombs that
are dormant only because three environment variables are unset, and that ordinary,
documented deployment setup arms.**

The parts a security reviewer would worry about most turned out to be the strongest
parts: org roles v1 department scoping was proven in a real browser (a Suppliers-lead
account reads zero email addresses in the console), every one of the 30 org server
actions carries a capability guard, both destructive actions correctly name their
domain, the schema and the migration chain agree exactly, and there is not a single
injection sink in the tree. The `authz` dimension returning nothing was not a miss —
a manual sweep found nothing to return.

**The single most dangerous thing** is account deletion. The product tells the user,
in four separate places (confirm screen, success toast, in-app notification, outbound
email — "Signing in is enough — that cancels it, no forms"), that signing in during the
14-day grace window cancels the deletion. It does not. `cancelDeletionOnSignInFor` has
exactly one caller: the explicit Cancel button on `/account/delete`, a page with no
in-app entry point once you leave it. A burner who follows the instruction is
irreversibly erased on day 14 — bio, ID document, medical notes, auth identity, all
hard-deleted in one transaction. It is not firing today only because
`ACCOUNT_SWEEP_SECRET` is unset, and `docs/deploy.md:116-124` instructs the operator to
set it as routine setup.

That is the shape of the top of this register: **latent, user-triggerable,
irreversible, and armed by the deploy checklist.**

---

## 2. Kickoff triage — the five things to settle before tomorrow

These are ordered for *the next 24 hours*, not by severity.

1. **Do not set `ACCOUNT_SWEEP_SECRET`** until B1 is fixed (one caller, or four copy
   changes). Today it is the safety catch on an irreversible erasure path.
2. **Do not set `RESEND_API_KEY`** until B2 is fixed. The first multi-recipient send
   discloses every recipient's address to every other recipient in the `To:` header.
3. **Set `PGCRYPTO_KEY` before any real bio data is entered.** Without it medical
   notes, SA ID and passport are silently discarded on save while the burner is told
   the save succeeded (M3), and `/system` tells the operator the opposite of the truth.
4. **Make the seed bootstrap idempotent before the first Neon deploy** (M9). There is
   no Neon database yet, so the very first production deploy runs this path; a failure
   mid-seed leaves the org console permanently unreachable and no redeploy repairs it.
5. **The registration wizard submit race** (M10) is the most likely thing to break a
   live demo of the flagship flow: header says "6 of 6 sections complete", Submit
   refuses with "Complete all six sections before submitting."

---

## 3. Blockers

### B1 — "Sign in and the deletion is cancelled" is false, in four places
**Where** `apps/web/lib/account-actions.ts:756,761,778`;
`packages/core/src/security-notifications.ts:114,283`;
`apps/web/components/account/delete-account-form.tsx:68`

**Failure** A burner requests deletion, is told signing in cancels it, and signs in
repeatedly. `cancelDeletionOnSignInFor` is called by nothing except the explicit Cancel
button — `packages/auth/src/config.ts` has no `databaseHooks`, no session-create hook,
no `onSignIn`; `ensureCampUser` never touches `account_deletion_requests`; there is no
app-wide "scheduled for deletion" banner. On day 14 `sweepDueDeletions` →
`sanitizeAccount` nulls every bio column and hard-deletes the Better Auth
session/account/user rows in one transaction. Irreversible, reached by obeying the
product's own instruction. Gated today only by `ACCOUNT_SWEEP_SECRET` being unset.

**Fix** Either call `cancelDeletionOnSignInFor(user.id)` from `ensureCampUser` in all
three apps, or change all four strings to name the Cancel button and add a persistent
banner linking to it. Do this before setting the sweep secret.

### B2 — Multi-recipient email puts every address in `To:`
**Where** `apps/web/lib/email.ts:52-64`; callers
`apps/org/lib/questionnaires/actions.ts:419-431`,
`apps/web/lib/questionnaire-store.ts:241-261`,
`apps/org/lib/actions/registrations.ts:74-87`

**Failure** One Resend POST, every address in `to`, no `bcc`, no chunking, anywhere in
the codebase. A camp-roster questionnaire send (the common case, under Resend's
50-address cap) mails every member a message whose `To:` header names every other
member. Reproduced independently: stubbed `fetch`, imported the real module — exactly
one POST, body keys `from,to,subject,text,html`, `bcc` absent. Latent only because
`RESEND_API_KEY` is unset; all three callers discard the result inside a `try/catch`,
so the first production send fails silently in both directions.

**Fix** In `sendEmail`, move multi-recipient lists to `bcc` with a no-reply `to`, and
chunk at 50.

### B3 — Supplier bulletin notifications link to a route the suppliers app does not have
**Where** `packages/core/src/notifications.ts:169`;
`apps/suppliers/components/notifications/notification-row.tsx:168`

**Failure** An org bulletin published to the `org_suppliers` audience mints rows with
link `/bulletins/<id>`. `apps/suppliers` has no `/bulletins` route — proven at runtime:
`GET /bulletins/<uuid>` → 404 "Page not found", while `/notifications`, `/onboarding`,
`/signin` all 200. The whole Bulletins tab in the supplier inbox is a dead end and the
bulletin body is unreadable in that app. This is the proven instance of a general
defect (M13): one notifications table, three apps, bare app-relative links.

**Fix** Make `bulletinNotification` take an app-relative base (or add a supplier
`/bulletins/[id]` route); see M13 for the general form.

---

## 4. Majors

### M1 — Forgot-password server actions bypass Better Auth's rate limiter entirely
**Where** `apps/web/lib/account-actions.ts:233`; `apps/org/lib/actions/password.ts:39`;
`apps/suppliers/lib/actions/password.ts:33`

**Failure** Executed against the local stack with the repo's real config: six HTTP POSTs
to `/api/auth/request-password-reset` from one IP → `200,200,200,429,429,429`. Fifteen
sequential `auth.api.requestPasswordReset({body})` calls → **15/15 accepted, 15 reset
emails queued**. The limiter lives in the router's `onRequest` hook, which only
`auth.handler()` enters; `auth.api.*` never passes through it. Once `RESEND_API_KEY` is
set, a scripted caller loops the Server Action and mail-bombs one inbox, burning the
Resend quota and the sending domain's reputation — which then breaks verification and
notification mail for everyone.

**Fix** Add an app-level throttle (IP + email, e.g. 3/hour) in front of the three
forgot-password actions, or route them through `auth.handler()`.

### M2 — A decryption failure renders as an affirmative "no medical notes on file"
**Where** `packages/db/src/crypto.ts:69` → `apps/org/lib/queries.ts:1385` →
`apps/org/app/(console)/registrations/[id]/members/[userId]/page.tsx:168-176`

**Failure** `decryptOrNull` swallows every failure and returns null; the page renders
null as the sentence *"No medical notes on file for this member."* A safety lead during
build week is told, in words, that a burner disclosed nothing. **No operator error is
needed**: `schema.ts:539-548` records that medical notes were switched to AES-256-GCM
with no data migration, so any pre-switch row is plaintext, and plaintext decrypts to
null — verified. A key mismatch between the web and org Vercel projects does the same.
The `bio.medical.view` audit row is written only inside `if (medicalNotes && …)`, so the
failed read leaves no trace either.

**Fix** Distinguish "no value stored" from "stored but undecryptable"; render the
second as a loud error and write an audit row for the attempt.

### M3 — Medical notes / ID / passport silently discarded when `PGCRYPTO_KEY` is unset
**Where** `apps/web/lib/crypto-guard.ts:13-17` with `apps/web/lib/bio-store.ts:281-290,
:317`; `apps/org/lib/system-status.ts:408-414`; dead flag at `bio-store.ts:43, :114`

**Failure** `safeEncrypt` returns null, null is persisted, the save reports success. The
burner is never told. `cryptoConfigured` exists on the bio-store interface, is assigned,
and is read by nothing. Worse, the one operator-facing surface misdescribes it:
`/system` says *"Without it, saving one throws rather than storing it in the clear —
which is the right failure."* It does not throw. The drop itself is deliberate and
correct; **the silence is the defect**, and the boot rule makes a `PGCRYPTO_KEY`-less
deployment a supported state graded merely "attention".

**Fix** Surface `cryptoConfigured` in the bio form (refuse the field, don't accept and
drop), and correct the `/system` detail copy — which should also name medical notes,
not just SA ID and passport.

### M4 — A Google-only account can never delete itself
**Where** `apps/web/lib/account-actions.ts:646-700` (re-auth at `:681`);
`apps/web/app/(app)/account/delete/page.tsx:210-222`;
`packages/core/src/account-security.ts:357`

**Failure** Deletion re-authenticates with `auth.api.signInEmail` — password only. A
burner who first signed in with Google has no credential row, so Better Auth throws
`INVALID_EMAIL_OR_PASSWORD` and the catch renders *"That password didn't match. Try
again."* forever. The eligibility guard reports the account as eligible
(`signInMethodCount === 1`), so the page shows a password field it knows cannot work,
and `sign-in-methods.tsx:117-121` tells the same user that adding a password "isn't
available yet". The POPIA erasure right is unreachable with no self-service remedy.

**Fix** Branch the delete page on `hasPassword`; for passwordless accounts re-auth via a
fresh-session/OAuth re-prompt instead of `signInEmail`.

### M5 — Account erasure leaves the deleted person's email in `audit_events.meta`
**Where** `packages/core/src/account-sanitization.ts:165-176`; writers
`apps/web/lib/session.ts:51`, `apps/org/lib/actions/accounts.ts:154-162`,
`apps/suppliers/lib/session.ts:171-176`

**Failure** `account.elevate` / `account.demote` / `supplier.link` write
`meta:{email:'…'}` verbatim. Sanitization preserves `audit_events`, so the address
survives, while the farewell email asserts *"audit records still exist … but nothing in
them identifies you"*. Confirmed against the live local database: 31 `account.elevate`
and 1 `account.demote` rows contain an `@`. Affects staff-tier and supplier-linked
accounts, not the general participant base.

**Fix** Stop writing email into `meta` (the `actor_id`/`subject_id` is enough), and add
a sanitization step that redacts `meta` email keys for the subject.

### M6 — No HTTP security headers on any app; the org console is framable
**Where** `apps/web/next.config.ts`, `apps/org/next.config.ts`,
`apps/suppliers/next.config.ts` (no `headers()`); no `middleware.ts` anywhere

**Failure** Measured on the real org app: the response carries `Vary`, `link`,
`Cache-Control`, `X-Powered-By`, `Content-Type` and nothing else — no
`X-Frame-Options`, no CSP `frame-ancestors`, no `X-Content-Type-Options`, no
`Referrer-Policy`. An attacker frames `https://org.<apex>/suppliers` and overlays a
decoy on the delete-confirm dialog. The click lands inside the genuine document, so the
Server Action carries the console's own Origin — Next's origin check passes, the
capability guard passes, and `deleteSupplier` destroys the row with no undo, with the
victim recorded as the actor. Same technique reaches `/system/roles` and registration
approve/reject. *Honest limit: measured on localhost. Vercel adds HSTS in production but
does not add X-Frame-Options or a CSP.*

**Fix** Add a `headers()` block to all three `next.config.ts`:
`frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `poweredByHeader: false`.

### M7 — Camp questionnaire activation notifies nobody in-app
**Where** `apps/web/lib/questionnaire-store.ts:163-169, :236-262` vs the correct org
path at `apps/org/lib/questionnaires/actions.ts:403-433`

**Failure** `activateProjectQuestionnaire` writes `required_actions` and calls
`notifyTargets`, which is a bare `sendEmail`. It never calls `insertNotifications` —
`grep` confirms apps/web has exactly three writers to that table, none in the
questionnaire store. With `RESEND_API_KEY` unset (the accepted state) a targeted member
gets **no signal at all**: bell at zero, `/notifications` empty. The only discovery
surface is the `PendingQuestionnaires` card, rendered on exactly two pages, neither of
them the participant home. Blocking questionnaires are partly rescued by the hard gate;
non-blocking ones are silent.

**Fix** Insert notification rows in the same transaction, mirroring the org path.

### M8 — Deletion-sweep failures are completely invisible
**Where** `apps/web/app/api/account/deletion-sweep/route.ts:60-77` with
`apps/web/lib/account-sanitize.ts:258-273`

**Failure** Each `sanitizeAccount` throw is caught and pushed into a `failed` array; the
route then returns HTTP 200 with `ok:true`. `console.` count is **zero** in both files.
Vercel records a 200 and does not persist the body. A persistently failing POPIA
erasure leaves the request pending, the data intact, no audit row (it is written inside
the successful transaction) and no operator signal, forever.

**Fix** Return a non-2xx when `failed.length > 0` and log each failure with the request
id.

### M9 — The deploy bootstrap uses its own first write as the "already seeded" sentinel
**Where** `packages/db/src/migrate.ts:184-190` with `packages/db/src/seed.ts:137-190`

**Failure** `seedReferenceData` inserts the edition *first*, then the org group, org
roles, categories, questionnaire definitions and suppliers — with **no transaction**.
`migrate.ts:184` then tests `SELECT 1 FROM editions`. A failure anywhere after the
edition insert leaves `editions=1` and nothing else, and every later deploy logs
"reference data present — not re-seeding". The only repair on that branch is
`ensureSeededOrgRoles` — org *roles*, not the org *group*. With no `kind:'org'` row,
`resolveOrgSession` returns `not_ready` for every account, permanently. Nothing else in
the tree ever creates that group (`grep 'kind: "org"'` → one hit, in the seed).

**Fix** Wrap `seedReferenceData` in a transaction, or make the sentinel the *last* write
(a `seed_complete` marker).

### M10 — Registration Submit is judged against a draft missing the last edit
**Where** `apps/web/components/registration/registration-wizard.tsx:149-176` (`saveNow`)
and `:203-211` (`handleSubmit`)

**Failure** The lead fills the fee textarea (blur → `saveNow`, which captures
`valuesRef.current` *before* the next answer and sets `savingRef`), then ticks the
plug-and-play ack (debounced 1500ms), then clicks Submit. `saveNow` short-circuits on
`savingRef`, so Submit runs against a row whose `completed_sections` came from the
stale snapshot: the toast reads *"Complete all six sections before submitting"* while
the header reads *"6 of 6 sections complete"*. The repo's own E2E factory documents this
outcome verbatim at `e2e/personas/factories.ts:628-634`. (Note: the mechanism is the
stale snapshot, **not** an un-awaited write — Next serialises server actions
client-side.)

**Fix** Have `saveNow` re-read `valuesRef.current` at flush time, and make `handleSubmit`
await the pending flush rather than the in-flight one.

### M11 — Bulletin fan-out breaks above ~10,900 recipients
**Where** `apps/org/lib/notifications.ts:111` via `apps/org/lib/actions/bulletins.ts:193`

**Failure** One multi-row INSERT at 6 bind params per row hits Postgres's 16-bit
parameter ceiling. Reproduced exactly against the local stack: n=10922 inserts fine,
n=10923 fails with SQLSTATE `08P01` ("bind message has 12464 parameter formats but 0
parameters"). The publish transaction rolls back — `publishedAt` is never stamped and no
bulletin reaches anyone. Fails loudly and cleanly, but it is a hard ceiling on the
flagship broadcast feature at real AfrikaBurn size (13k burners).

**Fix** Chunk `insertNotifications` at ~2,000 rows. (The camp-level path at 8 params/row
has an 8,191 ceiling no single camp can reach.)

### M12 — Re-sending an org questionnaire destroys the first activation's attribution
**Where** `packages/db/src/schema.ts:1225` (unique on `user_id, definition_key`) with
`apps/web/lib/questionnaire-store.ts:657-679` and
`apps/org/lib/questionnaires/queries.ts:333`

**Failure** The Send button is rendered unconditionally for every questionnaire and
`activateQuestionnaire` has no re-activation guard. A respondent who answers the second
send UPDATEs their existing row and repoints `activation_id`. The January activation
then lists them as completed with **no answers** — `getActivationResults` matches on
`activation_id`. Reproduced in a rolled-back transaction. Answer *content* survives if
unchanged (the fill view pre-fills across activations); attribution is destroyed
unconditionally.

**Fix** Make the unique key `(user_id, activation_id)`, or refuse re-activation of a key
with an open activation.

### M13 — One notifications table, three apps, app-relative links
**Where** `packages/core/src/notifications.ts:45,97,111,126,169`;
`apps/org/components/notifications/notification-row.tsx:45`;
`apps/suppliers/…/notification-row.tsx:68`

**Failure** All three apps read the table by `user_id` alone with no origin or kind
scoping, and every row component pushes the raw link. B3 is the proven supplier case;
the org case is the same shape — `registrationDecisionNotification` writes
`/camps/<slug>` and apps/org has no `/camps` route.

**Fix** Store an app key (or absolute URL) on the notification row and filter/route on it.

### M14 — Email change is a dead subsystem still wired to a live control
**Where** `apps/web/app/(app)/account/page.tsx:145-159`;
`apps/web/lib/account-actions.ts:379, 479, 580`; `apps/web/lib/account-tokens.ts`;
`email_change_requests` table

**Failure** Three server actions, a token module, a DB table and core builders, all with
zero callers (and absent from the server-reference manifest). The confirm/revoke URLs
they build point at `/account/email/confirm` and `/account/email/revoke`, which do not
exist. Meanwhile `/account` ships a **disabled "Change email" button with no tooltip and
no notice**: `title={emailChangeCap.userMessage}` is `undefined` because no capability in
the matrix defines `userMessage`, and `CapabilityNotice` returns null for a "supported"
capability. Help text below still promises the flow.
`docs/accounts-security-spec.md:85-86` lists it as shipped. This is the exact failure the
honest-degradation rule exists to prevent.

**Fix** Either finish the two routes, or delete the dead actions and give the button an
honest "Not available yet" notice (mark the capability `unavailable` with a
`userMessage`).

### M15 — Unlink Google is a permanently disabled button with an empty explanation
**Where** `apps/web/components/account/sign-in-methods.tsx:163-176, :193-198`

**Failure** No `auth.api.unlinkAccount` call exists anywhere; `canUnlinkSignInMethod`
has no production caller. The button is hard-disabled with an undefined tooltip and the
note renders `{unlinkCap.userMessage}` as an empty string, leaving a dangling sentence.
A burner whose linked Google account is compromised has no way to sever it — password
change doesn't help, and the deletion escape hatch is itself cancellable by whoever holds
the session. `docs/accounts-security-spec.md:101-103` lists link/unlink as built.

**Fix** Same as M14 — ship it or say so honestly, and mark the capability accurately.

### M16 — A suspended supplier can re-register itself clean
**Where** `apps/suppliers/lib/actions/register.ts:98` vs `packages/db/src/schema.ts:1269`
and `apps/web/lib/registration-store.ts:279-315`

**Failure** `registerSupplier`'s only duplicate guard is `eq(suppliers.userId, dbUser.id)`
— there is no name check (the live schema's `name` index is non-unique, while the seed
*does* dedupe on `lower(btrim(name))`) and no identity check of any kind. A suspended
supplier signs up with a different contact address, gets a fresh row with standing
`good`, and reappears in every camp's Section 6 picker immediately with no org review.
`deleteSupplier` then refuses to remove it because it has a `userId`.

**Fix** Introduce a `pending` standing for self-registrations that keeps them out of the
picker until org review, and flag name/contact collisions in the console.

### M17 — Org document changes never reconcile supplier onboarding steps
**Where** `apps/suppliers/lib/actions/documents.ts:95` (the only caller of
`applyDocumentAcksToSteps`) vs `apps/org/lib/actions/supplier-documents.ts:31, :160`

**Failure** The step map is reconciled only inside the supplier's own ack action — never
on page load, never when the org adds or deletes a bound document. Add a second
required-ack document to `agreement_signed` and the console's rollup still counts the
supplier as signed. Delete the last bound document and the stored `completed` becomes
permanent and unreachable. Two docstrings assert reconciliation that no code performs
(`supplier-documents.ts:97-99` claims "or page load"; core's own header claims it runs
"after the org edits the document list").

**Fix** Call `applyDocumentAcksToSteps` from the three org document mutations, and fix
both docstrings.

### M18 — Supplier sign-up silently drops the required Service category in production
**Where** `apps/suppliers/components/auth/sign-up-form.tsx:131-146`;
`apps/suppliers/lib/actions/register.ts:18-31, :103`

**Failure** With `RESEND_API_KEY` set, Better Auth's sign-up returns `{token:null}` and
no session (verified in the dependency source: `requireEmailVerification` ⇒
`shouldSkipAutoSignIn`). `registerSupplier` then refuses with "Sign in first." and the
category dies in React state. After verifying, the unlinked user is shown
`register-supplier-form.tsx`, which has **no category control**, and there is no org-side
supplier edit action either — so the field is unrecoverable for 100% of production
self-registrations.

**Fix** Persist the pending category (cookie or a pre-account row) across verification,
and add the field to the post-verification register form.

### M19 — The god bootstrap can be locked out by signing up with a password first
**Where** `packages/auth/src/config.ts:142`; `packages/auth/src/env.ts:220`;
`apps/org/lib/session.ts:181`

**Failure** With `RESEND_API_KEY` unset, no credential account can ever reach
`emailVerified=true`, and `canBootstrapGodEmail` requires it. Signing in with Google
afterwards does not rescue it: Better Auth's `requireLocalEmailVerified` defaults to
`true` and the config never sets it, so linking is refused. Every exit is out-of-band
(set Resend, scrape the console-logged verification link, or raw SQL). The documented
path (Google first) avoids it entirely, but there is no in-product recovery once you're
in it.

**Fix** Set `accountLinking.requireLocalEmailVerified: false` (Google is already trusted)
— one line, self-contained.

### M20 — Server-action wrappers swallow Next's redirect and show the user `NEXT_REDIRECT`
**Where** `apps/web/lib/account-actions.ts:75-87`;
`apps/web/lib/notifications-actions.ts:24-46, :52-74`

**Failure** `redirect()` throws an `Error` whose message is `NEXT_REDIRECT`. The
catch-all `run()` returns `{ok:false, error:'NEXT_REDIRECT'}` and the UI renders it — a
`role=alert` paragraph on the change-password form, a toast on session-list and
mark-all-read. `grep` for `unstable_rethrow`/`isRedirectError` returns zero hits outside
node_modules. Fires whenever the session dies between page render and action submit
(cookie expiry, sign-out in another tab, sanitized account inside the 300s cookie cache).

**Fix** Add `unstable_rethrow(err)` as the first line of every catch in the action
wrappers.

### M21 — `apps/web` has no unit tests at all, and the documented gate says nothing
**Where** `apps/web/package.json:6`

**Failure** `npx turbo run test --dry=json` resolves `vitest run` for auth, core, db, org,
suppliers, types and ui — and `<NONEXISTENT>` for web. `find apps/web` for any test or
vitest config returns nothing. An agent changing `medical-access.ts`, `bio-store.ts` or
`roles-store.ts` runs the documented gate (`turbo run lint typecheck test build`), sees
green, and commits with nothing having exercised the change. CI runs no Playwright
either.

**Fix** Add a `test` script and vitest config to apps/web, and start with `bio-store`,
`medical-access` and `roles-store`.

### M22 — The anti-lockout anchor spec cannot execute its own assertion
**Where** `e2e/specs/god/god-sole-god-cannot-self-delete.spec.ts:57` (force-enable at
`:58-60`)

**Failure** The spec exists to prove the sole-System-manager deletion block is *server*
enforced. It force-enables the submit button but not the password input, which
`/account/delete` also renders disabled — so `fill()` times out and the test dies before
issuing any POST. `TimeoutError: locator.fill … element is not enabled`, 41 waits, at
line 57. The guarantee that makes every other permission safe to edit ("a System manager
cannot be defined out of existence by editing a table") therefore has **no executing
runtime proof** — and M4 shows the same form refuses passwordless accounts outright.

**Fix** Force-enable the password input the same way the submit button already is.

---

## 5. Minors — code

Compact, grouped by cause. Each is real and verified; none needs prose.

| # | Where | Divergence / defect | Fix direction |
|---|---|---|---|
| **Privacy & retention** ||||
| m1 | `apps/web/lib/bio-store.ts:397` | `safeEncrypt(...) ?? plaintext` writes the Ed25519 private key in cleartext when `PGCRYPTO_KEY` is absent; contradicts the schema comment. Harmless today — nothing signs with it — but plaintext rows will be indistinguishable later | Drop instead of falling back, like every other SPECIAL field |
| m2 | `packages/core/src/id-retention.ts` | The whole module has zero callers; nothing purges SA ID / passport after the edition. Already documented as unwired; hard deadline **2027-06-02** | Wire into the existing daily cron before that date |
| m3 | `apps/web/app/api/blob/upload/route.ts` | Uploaded blobs are never deleted; the stored URL survives in preserved tables after erasure. Authenticated + random-suffixed, so a capability URL, not an open bucket | Record blob keys against the account and `del()` them in `sanitizeAccount` |
| **Auth** ||||
| m4 | `apps/web/lib/account-actions.ts:203`, org/suppliers `password.ts:18` | `redirectTo` is client-supplied and only length-checked; Better Auth's origin check no-ops without `ctx.request`. Proven: the emailed reset URL carried `callbackURL=https://evil.example/steal` (the link then 403s) | Drop the parameter — all three forms hardcode it |
| m5 | `packages/auth/src/env.ts:164-170` | `AUTH_RATE_LIMIT_MAX` customRules key `/forget-password` does not exist in 1.6.25; the real path is `/request-password-reset`. Also misses `/send-verification-email`, `/change-password`, `/change-email` | Fix the four path strings |
| m6 | `packages/core/src/auth-capabilities.ts:104-110` | Claims "the last-sign-in-method guard is still enforced by us"; nothing in this repo calls `unlinkAccount` and `canUnlinkSignInMethod` has no production caller. Only Better Auth's own check holds | Correct the reason string |
| m7 | `docs/auth-platform-spec.md:1106` | Threat matrix marks credential stuffing mitigated by "rate limit + lockout + HIBP + CAPTCHA"; only the rate limit exists. No sign-in events are recorded at all — a successful takeover is indistinguishable from a normal sign-in | Add `sign_in_succeeded/failed` to `SecurityEventLogKind` and correct the row |
| **Concurrency & query shape** ||||
| m8 | `apps/web/lib/registration-store.ts:577-582` | Camp-side status writes UPDATE by id with no status predicate, unlike the org side (`registrations.ts:157-168`). ~100ms window: a lead's Resubmit can overwrite a reviewer's Reject while the audit log says rejected | Copy the org side's `and(eq(id), eq(status))` + zero-row throw |
| m9 | `apps/suppliers/lib/actions/onboarding.ts:31-66` | `steps` is a whole-document rewrite from a snapshot read on a different connection; an org confirmation committed in between is erased. The org side has the same lost-update at READ COMMITTED, just a narrower window | Per-key jsonb update, or `SELECT … FOR UPDATE` on both sides |
| m10 | `apps/org/lib/queries.ts:1628` | `getStatusBoard` = 8 sequential unbounded reads, no `Promise.all`, no limits, to produce numbers that are all counts | `Promise.all` the 7 independent reads; replace with `count(*)` aggregates |
| m11 | `apps/org/lib/queries.ts` (officer coverage) | The officer-assignment query has **no edition filter**, so an assignment made in a past edition counts as filling this edition's slot — a correctness bug hiding inside a performance one | Scope by edition |
| m12 | `apps/org/lib/questionnaires/queries.ts:394-457` | `buildAudienceContext` reads four whole tables with no WHERE (memberships, groups, role assignments, project roles) on every audience change behind a 300ms debounce | Aggregate the count server-side instead of materialising |
| m13 | `apps/web/lib/questionnaire-store.ts:313-321` | N+1: one `required_actions` query per activation in a for-loop; the org side already batches the identical tally with `inArray` | Batch it |
| m14 | `apps/web/lib/groups-store.ts:227-255` | `nextMemberRefCode` reads every ref-coded membership on the platform (`ne(groupId, groupId)`, no limit) to derive a 3-letter prefix. Once per camp, not per join | Add a limit / derive the prefix from the camp name |
| m15 | `packages/db/src/schema.ts:1500-1507` | `audit_events` has no `created_at` index and is never pruned. Measured: 34ms at 200k rows — a nit. (The medical-access query *is* index-served; that half of the original claim was false) | Add the index when convenient |
| **Error handling & gates** ||||
| m16 | `apps/org/lib/session.ts:271-273`, `apps/suppliers/lib/session.ts:259` | `not_ready` absorbs every thrown DB error and renders the **signed-out** gate copy with a "Sign in" button to an already-signed-in user | Give `not_ready` its own branch in `GateScreen` |
| m17 | `apps/web/app/(app)/camps/[slug]/settings/roles/page.tsx:41-46` | `!campUser \|\| !edition` share one branch, so a signed-in burner can be told "the database has not been seeded" | Split the two conditions |
| m18 | 4 routes: `registrations/[id]`, `questionnaires/[key]/[activationId]`, web `questionnaires/[activationId]`, `camps/[slug]/questionnaires/[activationId]` | Unvalidated uuid path params reach the DB (`invalid input syntax for type uuid`, proven) and hit an error boundary that names the wrong cause instead of 404ing | Copy `burners/[id]/page.tsx:40-49` — zod uuid then `notFound()` |
| m19 | `apps/web/components/notifications/notification-row.tsx:50-59` | Marks read optimistically and discards the action result — no `ok` check, no rollback. Every sibling action checks | Check the result |
| m20 | `apps/org/lib/actions/accounts.ts:138-163` | Demoting an account with no org membership deletes nothing, returns ok, and still writes an `account.demote` audit row with `role: null` | Return early when `existing` is undefined |
| m21 | `apps/web/app/(app)/burners/[id]/page.tsx:53-64` | The one participant data page that never calls `enforceGate` — a hard-gated burner can open a third-party profile by direct URL. Authorization is intact; the *gate* is the hole | Call the gate (or use `requireOnboardedUser`) |
| m22 | `apps/web/lib/session.ts:230` | `requireOnboardedUser`, documented as "the app-wide gate", has zero callers; ~9 pages hand-roll `requireCampUser` + `enforceGate` separately (2 more can't, they serve signed-out visitors) | Adopt it where it fits — m21 is what the duplication costs |
| m23 | `apps/org/lib/gate.tsx:41` vs `apps/org/lib/actions/notifications.ts:26` | A role-less console account gets a working bell and popover for the inbox that `/notifications` refuses with `NoRolesScreen` — one inbox, two gates | Gate the bell the same way |
| **Dead code & stale claims** ||||
| m24 | `apps/web/app/(app)/profile/actions.ts:44` | `savePrivacyFlagsAction` has no caller but *is* a dispatchable server action (manifest-confirmed; a valid POST returns 303). Harmless — authenticated, self-only, re-forces hard locks | Delete it and its orphan `PrivacyForm` (`components/privacy-form.tsx:19`) |
| m25 | `apps/web/lib/account-actions.ts:291` | `notifyPasswordResetCompleted` uncalled ⇒ 4 of 9 `SecurityEventLogKind` values unwritable; the `/account/security` feed under-reports. The user *is* still emailed by Better Auth's `onPasswordReset` | Call it, or trim the enum and the spec |
| m26 | `apps/org/lib/status-board-format.ts:10` | `ACTIVITY_LABELS` is missing **12** written actions (incl. `account.sanitized`, `bulletin.create/update`, six supplier ones), so `/audit` renders raw dotted keys. `bulletin.pin` has a label no writer produces | Sync the map; drop `bulletin.pin` |
| m27 | `apps/org/lib/actions/bulletins.ts:210, :270`; `apps/web/app/(app)/profile/actions.ts:44` | `publishBulletin`, `setBulletinPinned` uncalled and absent from the action manifest. (Their authz is *identical* to the live path — the "stricter rule in dead code" claim was refuted) | Delete |
| m28 | `apps/web/components/notifications/format.ts:19` vs suppliers' copy | Byte-identical function differing by one `Yesterday` branch. (The org ones are deliberately coarser and say so — not drift) | Share one helper between web and suppliers |
| m29 | `apps/org/components/status-badges.tsx:6` | `RegistrationStatusBadge` duplicates the canonical `@quagga/ui` table and has no caller; the console renders the `@quagga/ui` one | Delete the duplicate |
| m30 | `packages/ui/src/components/payment-details-block.tsx:42`; `apps/org/lib/labels.ts:18` | Money-formatting code with no consumer. (Does *not* violate the payments law — it renders in no context at all) | Delete |
| m31 | `packages/core/package.json:20`, `packages/auth/package.json:22,:26`, `packages/ui/package.json:36` | Four declared-but-unimported deps (`zod`, `@quagga/types`, `drizzle-orm`, `libphonenumber-js`) tracked by the pin discipline for nothing | Remove |
| m32 | `apps/org/lib/god.ts:15` | `isGodEmail` is an uncalled export sitting eight lines above the live `canBootstrapGodEmail`, and omits its `emailVerified` gate | Delete |
| m33 | `packages/core/src/index.ts:112`; `apps/web/components/account/capability-notice.tsx:10` | Two files still describe "managed Neon Auth"; two more name `sendChangeEmailVerification`, a hook that does not exist in 1.6.25 (the real one, `sendChangeEmailConfirmation`, *is* correctly wired in code) | Fix the prose |
| m34 | `apps/org/lib/status-board-format.ts:76` | A live comment points readers at "`/audit`, with the enumeration alerts" — a detector deliberately removed. The guard test strips comments, so it can never catch this | Delete four words |
| m35 | `packages/core/src/__tests__/auth-capabilities.test.ts:65` | The loop body never executes (`unavailableCapabilities()` is empty). Correct-by-construction, not broken — but note app code renders `cap.userMessage` for *supported* capabilities, which the contract guarantees is undefined (see M14/M15) | Leave the test; fix the callers |
| m36 | `.github/workflows/ci.yml:31` | `--no-frozen-lockfile` under a comment claiming the lockfile isn't committed; it has been for a long time. (better-auth **cannot** drift — it's pinned exactly — so the residual is caret-ranged deps only) | Switch to `--frozen-lockfile`, delete the comment |
| m37 | `e2e/personas/registry.ts:332` | `ALL_CAPABILITIES` and `forbiddenMatrix` have no consumer, so adding a refusal to a persona adds zero executed assertions in a file that calls itself "THE single place the authz matrix lives" | Add a meta-test that iterates the product |
| m38 | `e2e/specs/camp-lead/review-loop.spec.ts:9-15, :100-127` | Header and TODO say the camp-side reply UI "is NOT yet built"; `SectionReplyThread` ships on both surfaces with a real composer. The two-way review conversation has zero E2E coverage | Un-skip (needs a click on the collapsed "Reply" toggle first) |
| m39 | `e2e/lib/env.ts:24` | `required()` and `isGoogleDriveable()` are dead, and `required()`'s message ("The harness never guesses a URL") contradicts `baseUrl()`, which defaults to localhost. (The `createMailbox` half of this claim was refuted — that path is live and load-bearing) | Delete both; fix the message |
| m40 | `AGENTS.md:35`, `scripts/e2e-local.sh:9`, `docs/execution-roadmap.md:27` | Stale spec counts: "141", "141", "137". Actual: **58 files, 156 tests** | Update all three |
| **Correctness nits** ||||
| m41 | `apps/org/lib/actions/org-roles.ts:152-200` | Renaming a department leaves its two seeded roles labelled from the old name ("Suppliers lead" inside "Supply Chain"). Fixable in the UI, so not a lockout | Rename the system roles in the same transaction |
| m42 | `apps/web/lib/invite-flow.ts:37`; `questionnaire-store.ts:258`; `account-actions.ts:427` | Three outbound emails embed bare relative paths ("Open your camp: /camps/<slug>") — inert text in a mail client. Three different answers to the same problem, no shared helper | One `absoluteUrl()` helper |
| m43 | `docs/notifications-spec.md:16` | "Membership events (invite accepted, lead transfer)" is a spec'd notification source with no builder and no call site — a lead learns a member joined by noticing a new roster row | Build it or drop it from the spec |
| m44 | `apps/org/lib/system-status.ts:334` | `/system` says bulletin **email** is delivered when Resend is configured. No bulletin email path exists (the digest route is an explicit stub). In-app delivery works, so no recipient misses it — only the operator's model is wrong | Correct the clause |
| m45 | `apps/org/lib/config.ts:22-24` | `NEXT_PUBLIC_PARTICIPANT_APP_URL` falls back to `http://localhost:3000` and appears in neither `turbo.json` globalEnv, `.env.example`, nor `docs/deploy.md` — so the gate wall's only exit points at a laptop in production. Being `NEXT_PUBLIC_` it must be set at **build** time | Document it and add to globalEnv |

---

## 6. Design parity

57 divergences across three bands. One (supplier bulletins) is a code defect and was
promoted to **B3**. Two frames came out clean and are called out in §8.

### Participant app (band y=5260) — 23

| Frame(s) | Route | Divergence | Sev |
|---|---|---|---|
| `l99dum` (AppShell Teal, 13 frames) | all participant | Nav draws Dashboard + My camps, both **404** (`/dashboard`, `/camps` proven); omits Create camp, Profile, Account, Sign out | major |
| `iCQgd`/`srY69`, `mm31G`, `C313E` | `/onboarding`, `/burners/[id]` | **Medical notes** — the one SAFETY_VISIBLE field and its consent note — is drawn nowhere in the band. Zero occurrences of "medical" in 50 frames | major |
| `SjInE` (`kLfyO`,`wpT9i`) | `/account` | Draws Change email as working with 48h-undo copy; ships an inert button with no tooltip and no notice (see M14) | major |
| `RBIDd`,`XAJSe`,`S8ZcWf`,`Qq5u0` | `/camps/[slug]/registration`, `/vehicles/new` | SOOP sound scale: 3 levels on canvas, **5** in `sound.ts:20-50`, three different label sets. "Level 3" means different things in each | major |
| `RBIDd` (`ZXGrw`,`D6yJo`,`krDCd`) | `/camps/[slug]/registration` | Every placement value drawn ("Binnekring (inner ring)", "3-ish", "Buitekring") is absent from `PLACEMENT_ZONES_2027` | major |
| `P0Tcl`/`QzpU6` | `/camps/[slug]/registration` post-submit | Draws the **one** post-submit state the route never serves (`changes_requested` reopens the wizard) and none of the five it does | major |
| `SjInE`,`G35eq`/`JbB35` | `/account`, `/account/security` | Passkeys drawn as "PHASE 2 — coming soon"; they ship, with a full managed card the Security frame doesn't draw at all | major |
| `SjInE` (`V3yr9`), `U6ixd` | `/account` | Still "DISPLAY NAME"; the page has rendered **Username** since the username commit (onboarding + profile were updated, account was not) | major |
| `RGcNS`/`EQW5G` (`Ke1zL`,`bUVi3`) | `/camps/[slug]` | "Only theme camps get this CTA" is stale — MV and artwork get an edit/resubmit CTA; `/vehicles/[slug]/edit` and `/artworks/[slug]/edit` have no frame | major |
| `RGcNS`/`EQW5G` (`EPu3f`) | `/camps/[slug]` | Members card omits Manage roles + outstanding badge, role chips and Assign; four whole page states undrawn (Questionnaires, consent banner, non-member read-only, free-camp/NOT STARTED) | major |
| `u87N7` + 13 shells | `/auth/sign-in`, all | Every frame renders the real AfrikaBurn logo banner; the app renders a lucide flame + "Contributors" and contains **no brand image** (`apps/web/public` = `icon.svg` only) | major |
| `iCQgd`/`srY69` | `/onboarding` | The "Held privately" card and the whole 15-row Privacy review step (step 4 of 5) are undrawn; the mobile frame drops 5 of 9 fields and all of step 3 | minor |
| `RBIDd`/`XAJSe` §5 | `/camps/[slug]/registration` | Shipped "Sound plan" textarea undrawn; drawn "Amplified music?" toggle doesn't ship; Neighbour request is a 60-word textarea on canvas, a single-line input in code | minor |
| `Q3pQj6`/`Ur0rS` | `/account/delete` | Promises erasure of "photo" and anonymised "posts and comments" — neither exists; omits the scheduled-for-deletion and "Worth knowing" states | minor |
| `u87N7`/`HCt1i`, `Gf1iJ`/`s2PAS` | `/auth/sign-in`, reset | No "Forgot your password?" link — the only entry point to the Forgot Password frames; reset's missing-token state undrawn | minor |
| `qhcHh`/`MttcT` | `/join/[token]` | Draws 2 of 3 states; "Invite not found" (deliberately camp-anonymous) undrawn | minor |
| — | `camps/[slug]/questionnaires/new`, `…/[activationId]`, `vehicles/[slug]/edit`, `artworks/[slug]/edit` | Four shipped routes with no frame anywhere | minor |
| `RGcNS` (`m1SUf`) vs `u7RSIJ`,`g5Uqfw` | all | Footer contradiction: payments-purged wording on one frame, older "AfrikaBurn collects" on others; the app renders one global footer with the older claim. **Needs a copy ruling** | minor |
| `D0LTCb`,`TIrbC`,`EQW5G`, all mobile | all | Edition banner (always rendered) absent from every mobile frame; three mobile frames drop whole shipped sections (free-camp directory block, create-a-role card, Invite links card) | minor |
| `u7RSIJ`,`X6YN3`,`RGcNS`,`Hameq` | `/directory`, `/notifications`, `/camps/[slug]` | **No empty state anywhere in the band** — though the seeding law makes empty the correct first-boot state and the code has carefully written copy for it | minor |
| `mm31G`/`lYUEe` | `/burners/[id]` | Titled `/burners/[handle]`; the route zod-validates a uuid and 404s anything else. Skills section and self-edit action undrawn | minor |
| `g5Uqfw`/`Evh1t` | `/camps/new` | Omits the sibling-registration line — the *only* discoverable path to `/vehicles/new` and `/artworks/new` | minor |
| `X6YN3`,`qLjMS`,`R6l2G`,`d7HlH` | `/notifications`, `/bulletins/[id]` | Carry the Profile page's footer sentence as their own — a copy paste-through | minor |

### Organiser console (band y=8660) — 16

| Frame(s) | Route | Divergence | Sev |
|---|---|---|---|
| `PRDdG`/`t4Ji4` | `/registrations/[id]` | Draws **six review fields with no column, query or render path** (FIRST-TIMERS, VEHICLES, POWER, STRUCTURES, MOOP BINS, OFFERING) while omitting ~20 that ship. Contradicts itself (JOINABILITY "Invite only" + OPEN TO ALL "Yes") | major |
| `PRDdG`/`t4Ji4` | `/registrations/[id]` | Officers card, **Members roster** and Decision-history card all undrawn. The roster is the only link to `/registrations/[id]/members/[userId]` — so the member-detail frames are orphaned and the `bio.medical.view` audit surface has no drawn route | major |
| `obd4x`/`pKW7z` vs `RTfFF`/`w6X0wA` | `/` and `/status` | Three different values for numbers a single `getStatusBoard()` feeds to **shared components** (32 vs 47 registrations, 20 vs 25 suppliers, 3 vs 2 sends). `RTfFF`'s own funnel sums to 48 against its stated 47 | major |
| `jgbtP` (all 19 desktop frames) | all console | 4-item nav vs the shipped **10** + sign-out + rank badge + org-roles line + a different wordmark. Frames needing a 5th item *overwrite* an existing one, so Overview or Accounts disappears | major |
| `AssNH`/`ZBw8O` | `/questionnaires/new` | Draws a Regex rule, PATTERN field and custom ERROR MESSAGE — none exist in the schema or editor, so they couldn't persist. Palette lists 14, ships 20, and names "File upload" for what is a URL field | major |
| `U8CqE`/`zW1uE` | `/bulletins/new` | 7 audience options vs the shipped **14**; the five officer audiences and org-internal appear nowhere, and four labels are wrong | major |
| `uj1wp`/`Ctdgd` | `/accounts` | Grant dialog titled "Elevate to org staff?" with pre-org-roles-v1 body copy that re-couples capabilities to the rank — contradicting the same frame's own correct annotations | major |
| `g4CzsM`, `AssNH` | `/categories`, `/questionnaires/new` | Draw drag-and-drop ("Drag to reorder", "Drag or click to insert"). There is **no drag-and-drop anywhere in apps/org** — reordering is chevron buttons. Categories table draws 3 columns; the page ships 4 | major |
| `AssNH` (`pX5W6`) | `/questionnaires/new` | "edits save automatically" — there is no autosave, no timer, no beforeunload guard. Ten minutes of work is lost on navigate | minor |
| `T7siQ9`/`E5Oip` | console gate | Draws 1 of 4 gate states; signed-out, preview/not-configured and the **no-org-roles** refusal are all undrawn | minor |
| `xRjgy` (`qSdtK`) | `/notifications` | Labels the older group "EARLIER"; `groupNotificationsByDay` never produces it — proven by test to emit raw `2027-02-10` ISO keys as headings | minor |
| `NkPRL` | `/registrations` mobile | Draws a "Submitted" value on every card; that column is `mobileHidden` and never rendered. Remaining fields are a `<dl>`, not a dot-joined meta line | minor |
| `JY7dF`/`XY8yO` | `/questionnaires` | Omits per-card Edit and Send — the only entry points to two routes that themselves have no frame. Also undrawn: `/bulletins/[id]/edit`, org auth screens, the ConsoleGate takeover. `RTfFF` is named "/" though the route is `/status` | minor |
| `Mjiqz`/`nRtO7` | `/questionnaires/[key]/[activationId]` | Attributes free-text answers to named camps **in the Summary tab**; the shipped summary is deliberately unattributed (attribution lives in Individual). Implementing the frame would move named responses into the aggregate view | minor |
| `U7929T`, `AssNH` | `/suppliers/signup-management`, builder | Upload limits contradict the code: 10 MB vs 25 MB; 5 MB PNG/JPG vs 8 MB PNG/JPEG/WebP/GIF | minor |
| 6 list screens ×2 | `/registrations`, `/accounts`, `/suppliers`, `/bulletins`, `/questionnaires`, `/categories` | None of the 12 frames draws the honest empty state each page ships — the correct first-boot state under the seeding law. Plus per-screen control drift (missing sign-up-management link, missing delete, missing audit tile) | minor |

### Supplier portal (band y=13560) + component library — 18

| Frame(s) | Route | Divergence | Sev |
|---|---|---|---|
| `swSq4`/`OSqoc` | `/notifications` | → **B3**: bulletin rows link to a route that does not exist | blocker |
| `lm3jO` (`bPneW`) | `/onboarding` mobile | Still carries the superseded fee copy ("You'll confirm payment here") that the desktop pair was corrected away from on 25 Jul. Trips the never-payments check and promises an action the authz model refuses | major |
| all 5 chrome frames (`jgbtP`) | all portal | **There is no supplier AppShell in the library** — every frame borrows the org apricot shell. Wrong wordmark, wrong nav, missing Notifications entry, phantom avatar and edition string, no business name / standing badges / sign-out | major |
| `K3zNk`,`OX6KJ`,`h83pUG`,`xgCd7` | `/signup`, `/signin` | Signed-out auth frames draw **authenticated chrome** — nav, avatar, bell with unread badge. Proven at runtime: zero of those strings render | major |
| `Di3Zv`, `Q4fye` | documents panel | Draw per-row file sizes, source hostnames, REQUIRED/OPTIONAL badges and an acknowledgement date — none of which the `supplier_documents` schema can produce | major |
| `Q4fye`,`lm3jO` | `/onboarding` | A "NOT STARTED" badge no code path can emit, and step-3 copy claiming the supplier marked the deposit paid — a transition the authz model forbids | major |
| — | `/`, `/auth/forgot-password`, `/auth/reset-password`, GateScreen | Four substantial shipped surfaces with **no frame anywhere** (the landing page includes the whole Supplier Depot rules hero and the unlinked-visitor register form) | major |
| `ABOHr`, `kv6ot` | component library | Ships three reusable **payment badges** (PENDING PAYMENT / RECONCILED / WAIVED) that `status-badge.tsx:11-12` explicitly refuses to ship per product law — and omits the `withdrawn` status it does ship | major |
| `ABOHr` | library | `Badge`'s `success`/`warning` variants — the two the supplier surfaces actually use — are absent | minor |
| `swSq4`, `kv6ot`, `tabs.tsx` | `/notifications` | Three mutually incompatible tab treatments (shipped segmented control, library underline, hand-drawn sage pills) | minor |
| all supplier frames | all portal | No sage accent token exists on canvas, so `.supplier-accent` is unrepresentable: header resolves to apricot/teal while the body hand-sets `$ab-sage` — brand disagreement inside one screen | minor |
| `swSq4`/`OSqoc` | `/notifications` | Four notification strings the code cannot produce, including a day-group heading ("EARLIER") and a whole notification type ("Onboarding started") | minor |
| all 4 pages | all portal | Every page heading and most body copy differs from the shipped reviewed strings — including a hardcoded **2026** registration deadline on a 2027 screen, and "camps" where the code deliberately says "creative projects" | minor |
| `K3zNk`/`h83pUG` | `/signup` | Stale 6-category list (ships 8, missing Water and Ice Delivery); redraws the `<label>`-nested-link a11y trap the code deliberately avoided; mislabels its own password-strength example | minor |
| — | all portal | Preview/degraded banner, 2FA challenge, error boundary, four loading skeletons and 2 of 3 inbox empty states are drawn nowhere | minor |
| `TXyLN` vs `R4wvO` | `/standing` | Mobile hardcodes raw hex where desktop uses `$success`/`$warning`/`$destructive` — the pair drifts the first time a semantic colour moves | minor |
| `ABOHr`, `kv6ot` | library | Both directions: canvas ships Avatar/Breadcrumb/Pagination/Tooltip/Radio/`Button org` that `packages/ui` does not have; ~15 shipped components (incl. **phone-input**, named in AGENTS.md rule 6) have no representation | minor |
| all 11 supplier frames | all portal | Almost every primitive is hand-drawn rather than instanced — which is the mechanism behind the raw hex, the third tab style and the invented badges | minor |

---

## 7. Themes — the root causes worth more than the items

**T1. Three environment variables are detonators, not switches.** B1 (irreversible
erasure), B2 (mass address disclosure), M1 (mail bomb), M18 (dropped category) and M19
(god lockout) are all dormant *only* because `ACCOUNT_SWEEP_SECRET`, `RESEND_API_KEY` and
`PGCRYPTO_KEY` are unset — and `docs/deploy.md` instructs the operator to set all three.
The deploy checklist is currently the most dangerous document in the repo. Fix the five
before following it.

**T2. The safety-critical path fails silently in three different ways.** M2 (decrypt
failure renders as "no notes on file"), M3 (save drops the value and reports success),
and the `/system` copy that misdescribes both. One system, three silences, all of them
in the direction of a medic being told a burner disclosed nothing. Everything *else*
about medical notes is right (see §8) — which makes these three the whole risk.

**T3. Half-built subsystems left wired to live controls.** Email change (M14), unlink
(M15), password-reset security events (m25), membership notifications (m43): dead
actions, disabled buttons with `undefined` tooltips, and `docs/accounts-security-spec.md`
listing all of them as shipped. The honest-degradation rule is well served everywhere
*except* the account page, which is the one place a user goes when something is wrong.

**T4. The server-action layer has no shared error contract.** M20 (`NEXT_REDIRECT`
rendered to users), m18 (unvalidated uuids reaching the DB), m19 (results discarded),
m16/m17 (wrong-audience error copy). Four apps' worth of ad-hoc `try/catch` around a
framework that signals control flow by throwing.

**T5. Read-a-snapshot, write-the-whole-document.** M10 (registration submit), m8 (camp
status without a predicate while the org side has one), m9 (supplier steps, both sides),
m20 (demote deleting nothing but auditing anyway). The org registration path already has
the correct pattern — it just isn't applied anywhere else.

**T6. One notifications table, three apps, relative links.** B3 and M13. A row's link
means something different depending on which app reads it, and nothing on the row says
which app minted it.

**T7. Design review is behind ship, and the canvas records the *pre*-change model.**
Username, org roles v1, passkeys, MV/artwork CTAs, placement zones, SOOP scale, department
domains — in each case the code moved and the frame didn't. Six of the eight org majors
are this. The inverse (canvas drawing what was never built) is rarer but sharper: the six
phantom review fields and the drag-and-drop.

**T8. The supplier band has no shell and no accent token of its own.** That single
omission generates six of its eighteen findings, and the hand-drawn primitives generate
most of the rest. Two structural fixes collapse the list.

**T9. `apps/web` gates are hand-rolled per page.** `requireOnboardedUser` exists,
documented as "the app-wide gate", and has zero callers (m22) — which is precisely how
`/burners/[id]` ended up without one (m21). apps/org has exactly one gate and a test
pinning it; apps/web has nine copies and a hole.

**T10. Both halves of the gate have blind spots.** The unit gate does not cover apps/web
at all (M21); CI runs no browser (AGENTS.md says so); and the one runtime spec guarding
the anti-lockout invariant cannot execute its assertion (M22). The day's authorization
rewrite shipped past both — and, as it happens, was correct anyway.

---

## 8. What is genuinely good

Proportion matters. These are the parts to stop worrying about.

- **Authorization is sound, and now proven in a browser.** All 30 org server actions
  carry a capability guard; both destructive actions name their domain, so department
  scoping is live rather than fail-open. `requireOrgSession` always routes
  department-scoped capabilities through `orgCanInDomain`. Every PII call site gates per
  domain *before* the select — `searchAccounts` drops email from both the select and the
  WHERE so it isn't an existence oracle. The camp side scopes every write by `groupId`
  and verifies membership: no IDOR found. And the runtime pass `ad5069d` said it owed was
  run: a real Suppliers-department lead signs in and reads **zero** email addresses.
- **No schema drift.** `drizzle-kit generate` against the real schema and the 0000–0019
  chain: *"No schema changes, nothing to migrate"* across 38 tables. The append-only rule
  is being followed.
- **No injection surface.** `dangerouslySetInnerHTML` / `innerHTML` / `eval`: zero hits
  repo-wide. Bulletin markdown renders through Tiptap with `html:false` and a protocol
  allow-list. `publicBioView` is an allow-list projection in which hard-locked fields do
  not appear in the returned shape at all.
- **The privacy model itself is well designed.** Hard locks are re-forced on every write
  (`enforcePrivacyFlags`), medical notes are dropped rather than stored in the clear (the
  drop is right; only the silence is wrong), `security_events` is purged on erasure with a
  written POPIA rationale, and the medical audit trail is deliberately fail-open-with-
  attribution — which is the correct trade for a safety field.
- **The org design band's two newest frames are exemplary.** `bNbLs`/`qhCyJ` (System
  panel) and `IXwNt`/`gsiE0` (Roles & Departments) match the code one-for-one including
  degraded states and refusal copy. Both shipped ahead of their frames as a recorded
  AGENTS.md exception — and the exception is paid off. `P6mXrX`/`lYlbW` (Member detail)
  is likewise faithful, empty state and all.
- **The payments law holds in code.** No payment surface exists in any reachable
  registration context. The only money-shaped code in the tree renders nowhere (m30), and
  the org band contains no forbidden payment surface at all.
- **Better Auth is pinned exactly** (`1.6.25`, no caret, in all four manifests), so the
  lockfile weakness (m36) cannot touch the one dependency AGENTS.md rule 3 cares about.
- **The empty-state and degraded copy is carefully written** — every list screen in both
  apps has purpose-built, honest text. It is simply undrawn on the canvas; the code got
  this right first.
- **The E2E persona suite is real.** 32 of 41 passed in the two hardest personas,
  including all four engineer-rank refusals, all five system-panel tests, and both
  department-domain scoping tests.

---

## 9. Unproven — do not act on these yet

**U1 (unproven, would-be minor) — Questionnaire free text is an uncontrolled channel for
health data.** `questionnaire_responses.responses` is plaintext jsonb, listed
per-respondent beside the email address, CSV-exportable, unaudited, and survives account
erasure (preserved table; the cascade never fires because sanitization tombstones the
user row). Every mechanical claim was verified. What is **not** established is the
premise: no code path routes medical data here — it requires a burner to volunteer a
health disclosure into a general free-text box such as *"Anything the safety team should
know?"*. Audience is also narrower than it first appears (`god`/`org_staff` on the org
group only; `engineer` excluded), and the seed ships the definition unactivated.
**To settle:** decide whether that prompt (or any org free-text prompt) is likely to
elicit health data in practice. If yes, the cheap fix is prompt copy — *"do not include
health information here; use your Burner Bio's medical field"* — not encryption.

---

## 10. Already checked and cleared — do not re-raise

Each of these was investigated and **refuted**; the reasoning is recorded here so the
next audit doesn't spend the time again.

- **Sign-up is not an account-existence oracle in production.** With verification on,
  Better Auth returns a byte-identical 200 for existing and new addresses (it even hashes
  the password to equalise timing). The 422 exists only with `RESEND_API_KEY` unset, and
  `auth-form.tsx:130-144` already documents that trade explicitly.
- **`security_events` retention is not a gap.** It is in `SANITIZATION_PURGED_TABLES`
  with a written POPIA rationale and is deleted on erasure.
- **The pending-invite cookie `Secure` divergence is unreachable.** It needs a production
  *build* served over http; nothing runs one (`e2e-local.sh` runs `next dev`). Only a
  stale comment in `env.ts:113-116` survives.
- **`mobile-360` is not dead config.** `pnpm --filter @quagga/e2e e2e` runs both projects,
  `e2e/README.md:41-42` documents the split, and specs branch on it at runtime.
- **`publishBulletin` does not encode a stricter rule than the live path.**
  `assertOrgAudience` *is* the project refusal plus the same predicate, in the same order.
  (The functions are still dead code — see m27.)
- **`@simplewebauthn/server` is not a production-placement hazard.** It is a first-class
  dependency of `@better-auth/passkey` itself.
- **The medical-audit lookback is not a retention gap.** The caps are page-render caps by
  design; proposing thresholds or alerting is the misunderstanding the brief warns about.

---

## 11. What was NOT audited

Stated plainly, so nobody reads this register as complete.

- **Six of eight E2E personas never ran** — 36 of 58 spec files (anon, camp-lead,
  camp-member, new-burner, officer, supplier). The run that happened produced exactly 8
  failures in the two personas it covered, which matches the accepted "~8 pre-existing"
  baseline for the *whole* suite. Either every known failure clusters in god/org-staff, or
  the baseline is understated. **Do not read "8" as confirmation.**
- **The local DB was not reset** (`E2E_RESET_DB=1`). It now carries 179 users and 75
  groups of accumulated run state; four of the eight failures are pagination walks timing
  out against it in dev mode. Whether `e2e:local` should reset by default is Ryan's call —
  a gate whose noise floor rises every run is a gate people stop running.
- **Nothing was measured against the deployed Vercel origins** — the security-header
  finding (M6) is a localhost measurement, and no production env var set was inspected.
- **No production-scale performance measurement.** The data dimension downgraded the
  console query-shape items on "not at that scale yet"; that is an inference on both
  sides, not a measurement.
- **`apps/org/app/api/blob/upload/route.ts`** was never read (only apps/web's two upload
  routes were).
- **`packages/db/migrations/*` content** beyond the drift check.
- **Geometric / layout QA** on any band — all three parity passes were structure-and-copy,
  not `audit.py` defect mode. No overflow, overlap, contrast or type-scale findings exist
  in this register.
- **No pixel comparison at 360px.** Every mobile finding is a copy/section-set diff, not a
  rendered-layout comparison.
- **The CONCEPTS/ARCHIVE band (y=18000)** and most of the component-library band beyond
  what the supplier pass touched.
- **A live two-user proof that a camp lead sees medical notes on `/burners/[id]`** — that
  path rests on code reading, not an observed render.
- **The questionnaire gate and runner against a live activation** (compared statically).

---

## 12. Housekeeping

Nothing outside this file was written. `git status --porcelain` was empty at the start of
synthesis and this file is the only addition. All probe artefacts from the audit were
deleted by their authors: Playwright probes, a throwaway vitest in `packages/core`,
scratch drizzle configs, copied migrations, `e2e/test-results/`. Dev servers on :3000,
:3001 and :3002 are stopped; the docker stack (already running beforehand) is left up.

One operational note for whoever runs the suite next: `scripts/e2e-local.sh` does
`pkill -f "next dev"` by design, so it will restart any dev server another agent has
running.
