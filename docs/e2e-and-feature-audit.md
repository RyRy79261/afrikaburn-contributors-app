# E2E & feature audit — 28 July 2026

Read-only audit of the Quagga Portal at HEAD (`5300038` + working tree). Eleven
domain passes and nine coverage passes were commissioned; each domain verdict was
adversarially challenged by a second reader before reaching synthesis. Every claim
below carries a `file:line` anchor. Findings are marked **CONFIRMED** (the path was
traced end to end and must behave this way) or **SUSPECTED** (it looks wrong but
could not be fully closed). Suspicions are never laundered into facts.

Findings closed on 27 Jul (`docs/audit-register.md`: B1–B3, M1–M22) were excluded
from scope — **with one exception, documented as §2.1 below, where the register is
wrong about its own first entry.**

> **Input completeness.** Only 5 of the 11 domain verdicts reached synthesis
> (auth-session, account-security, onboarding-bio-privacy, camps-membership-roles,
> and registration-projects — the last truncated mid-finding), plus 1 of 9
> per-persona coverage reports (officer), the cross-domain coverage report, and the
> completeness critique. The per-persona table in §5 is therefore built partly from
> a first-hand read of all 58 spec files during synthesis rather than from dedicated
> per-persona passes; rows are labelled accordingly. See §9.

---

## 1. Headline

**A signed-out attacker who knows a burner's email can take over their account
end to end: Better Auth's `/change-email` is mounted over HTTP in all three apps
and this codebase addresses *both* hops of the confirmation to the attacker-chosen
new address, and step 2 mints a full session for whoever clicks it** — while
separately, the register's first "fixed" entry, B1, is still live and now throws a
type error on *every* sign-in in all three apps.

The second-order headline is process, not code: **`.github/workflows/ci.yml:34`
never runs the E2E suite, and the only runner that exists pins
`--project=desktop-chromium`** — so 58 spec files gate nothing on merge, and the
`mobile-360` project (`e2e/playwright.config.ts:66`) has never executed once.

---

## 2. Triage — in order of consequence

### 2.1 Fix today

| # | What | Why first |
|---|---|---|
| 1 | **Disable Better Auth `/change-email`** — set `user.changeEmail.enabled: false` (or a `disabledPaths` entry) in `packages/auth/src/config.ts:119`. | Remote account takeover reachable by an unauthenticated clicker (§3.B2). The app's own `assertCapability` gate is irrelevant: the endpoint is mounted by `toNextJsHandler(auth)` regardless of what the app's server actions do. This is a one-line change and it closes the worst hole in the product. |
| 2 | **Fix B1's id space** — `packages/auth/src/config.ts:162` passes `session.userId` (Better Auth `text`) where a `users.id` (`uuid`) is required. | Two costs: the deletion rescue the product promises in writing never fires, *and* every session creation in every app raises `22P02` and logs. `docs/audit-register.md:81` still says not to set `ACCOUNT_SWEEP_SECRET` until B1 is fixed — that gate is still correct, and the register's line 15 claiming it is fixed is not. |
| 3 | **Stop `saveBio` nulling unreadable ciphertext** — pre-read the existing columns, or refuse, at `apps/web/lib/bio-store.ts:290`. | Silent destruction of medical notes and identity documents on an ordinary bio save, on the exact deployment state (rotated/wrong `PGCRYPTO_KEY`) where the data matters most. The product *instructs the owner* to trigger it (`apps/web/app/(app)/burners/[id]/page.tsx:153`). |
| 4 | **Scope `unassignOfficer` to its `groupId`** — `apps/web/lib/roles-store.ts:532`. | Cross-tenant destruction of another camp's officer consent record, silent in every direction: no notification, no audit row, no error. Three lines, and the sibling `assignOfficer` at `:463` already shows the correct shape. |
| 5 | **Add `e2e` to the CI gate and run both Playwright projects.** | Everything in §5 is worthless while nothing runs it. |

### 2.2 Fix this week

6. The `due` window (`apps/web/app/(app)/account/delete/page.tsx:96`) — every
   deletion passes through 0–24h in which the page lies, the Cancel button is
   hidden and no recovery exists.
7. The bio wizard's dead Save button (`apps/web/components/onboarding/bio-flow.tsx`)
   — every field except username renders no error, so a rejected save is
   indistinguishable from a broken app.
8. The `/onboarding ↔ /profile` deadlock (`apps/web/lib/bio-store.ts:372`).
9. Deletion guards counting erased and concurrent accounts as live ones — the
   sole-god and sole-lead invariants are both walkable (§3.B7).
10. `assignOfficer` as an unguarded second role-grant path — self-escalation to
    `manage_roles` (§3.D2).

### 2.3 Note on ordering

Severity labels were deliberately *not* the sort key. Several `minor`-labelled
items outrank `major`s: the org gate's `localhost:3000` link (§3.G4) is cosmetic in
a review but is the only escape hatch on a production wall, and the absent audit
trail for role mutations (§3.D3) is what makes finding #4 above undetectable rather
than merely possible.

---

## 3. Confirmed defects, by domain

Duplicates have been collapsed: one defect filed six times across two domains
(the password-reset notifier ×3, the supplier sign-up swallowed refusal ×3) is one
row here. Severity counts in §10 are post-dedupe.

### A. Auth & session

| Sev | Finding | Anchor | What breaks / who notices |
|---|---|---|---|
| **BLOCKER** | **B1 is live: the sign-in deletion-cancellation hook passes the wrong id space.** `session.userId` is Better Auth `text` → `user.id` (`schema.ts:383`); `cancelPendingDeletion` matches `account_deletion_requests.user_id`, `uuid` → `users.id` (`schema.ts:1703`), and the two spaces are deliberately unjoined (`schema.ts:328-341`). Postgres infers `$1` as uuid and raises `22P02`; the catch at `deletion.ts:147` logs and returns `{cancelled:false}`. The explicit Cancel button passes the *correct* id (`account-actions.ts:856`), so the two callers disagree. **CONFIRMED** (independently re-verified at synthesis). Blast radius wider than filed: `deletion.ts:59-79` runs the SELECT unconditionally before any existence check, so this errors on **every** session create in all three apps — password, Google, 2FA completion — making the "loud log" the design relies on permanent noise. | `packages/auth/src/config.ts:162` | A burner who believed "signing in cancels it" is erased at 03:00. Nobody notices until the data is gone. |
| MAJOR | Sign-up reports "we've sent a link to confirm your account" for failures that created no account. Only `msg.includes("password")` is branched (`:100`); 429s and adapter failures fall to `SIGN_UP_GENERIC` at `:115`, a past-tense claim. Identical in `apps/org/components/auth/auth-form.tsx:64`. `@quagga/core`'s hedged wording exists (`account-security.ts:106`) and neither app uses it. **CONFIRMED** | `apps/web/components/auth/auth-form.tsx:115` | A shared-wifi room (Better Auth's own per-IP rule on `/sign-up/email`) waits for an email that will never arrive. |
| MAJOR | An unverified email is reported as a wrong password, and no app offers a resend. `requireEmailVerification` is true whenever `RESEND_API_KEY` exists (`env.ts:220` → `config.ts:93`); all three forms collapse every `signInError` to one string. A repo-wide grep finds **no** resend control and **no** verification route in any app. **CONFIRMED.** Partial escape: Google sign-in on the same address sets `emailVerified`, so this is a hard dead end only where Google is unconfigured — which is also the configuration that produces the org lockout below. | `apps/web/components/auth/auth-form.tsx:167` | A new burner, and every invited stranger, is told their correct password is wrong. |
| MAJOR | "Continue with Google" renders whether or not Google is configured, and the org gate's only recovery depends on it. `isGoogleConfigured` is consumed only by `config.ts:176` and `system-status.ts:663` — never by a sign-in screen or `missingConfig()`. `handleGoogle` never inspects the returned `{error}` and clears `googlePending` only in `catch`, so a failure leaves the form stuck on "Redirecting…". **CONFIRMED.** Compounding lockout: the seed creates the org group with no memberships (`seed.ts:159`), GOD_EMAILS bootstrap requires `emailVerified` (`apps/org/lib/session.ts:192`), and with no email provider verification is impossible — **with Google unconfigured, no account can ever be elevated.** | `apps/org/components/gate-screen.tsx:55` | A fresh deployment can be permanently unadministrable, with a button that appears to offer a way in. |
| MAJOR | The org `not_ready` gate says "Restricted to AfrikaBurn staff" and offers a Sign-in button that loops. `resolveOrgSession` returns `not_ready` for an unseeded org group, a missing `users` row, *or any thrown query* (`session.ts:290`), all with `DATABASE_URL` set so the preview card never renders. `SignOutButton` exists only on the `forbidden` branch (`:88`), and `apps/org/app/auth/[...path]/page.tsx` never checks for an existing session. **CONFIRMED.** Correction to the filed version: the *supplier* gate's copy is neutral (`gate-screen.tsx:52`) — only the loop shape is shared. | `apps/org/components/gate-screen.tsx:70` | A legitimate organiser is told they lack a role they hold, and cannot sign out to try again. |
| MAJOR | Supplier sign-up swallows the real `registerSupplier` refusal and claims a verification link was sent. `:126-131` discards `registered.error` for the fixed "Account created. Confirm your email…" notice; `register.ts:98-105` raises two distinct name-collision messages plus "No active edition", and `register-supplier-form.tsx` surfaces them correctly. With `RESEND_API_KEY` unset, `sendOnSignUp` is false — no link exists. **CONFIRMED** | `apps/suppliers/components/auth/sign-up-form.tsx:126` | A supplier whose business name collides waits forever for an email, having been told their account exists. |
| MAJOR | Email-change and unlink refusals send people to an organiser control **nobody built** — and so does the supplier registration refusal. `apps/org/lib/actions/accounts.ts` exports exactly one action, `setOrgStaffRole` (`:59`); `auth.api.unlinkAccount` has zero call sites tree-wide; the only writer of `suppliers.user_id` on an existing row is the automatic email-overlap claim at `apps/suppliers/lib/session.ts:164`. Yet `register.ts:99` tells suppliers "Ask an administrator to link it to this account". **CONFIRMED** | `packages/core/src/auth-capabilities.ts:120` | Support tickets that no organiser can action; a mis-claimed supplier listing that no screen in any app can release. |
| MAJOR | Passkeys can be enrolled and are advertised as a sign-in method; no sign-in screen offers one. Plugin wired at `config.ts:219`, `passkeyClient()` in all three clients, card copy at `:120`. `signIn.passkey` appears only in comments; no email field carries `autoComplete="webauthn"`. **CONFIRMED** | `packages/ui/src/components/account-passkeys.tsx:120` | A burner enrols a passkey and can never use it. |
| MAJOR | Organisers and suppliers have no account or security surface at all — yet both sign-in forms handle a 2FA challenge only the participant app can enrol (`apps/org/.../auth-form.tsx:94`, `apps/suppliers/.../sign-in-form.tsx:55`). No `/account` route exists under either app tree. **CONFIRMED** | `apps/org/components/console-header.tsx:96` | An organiser cannot change their password, see their sessions, or enrol the second factor their sign-in screen asks for. |
| MAJOR | Signing in always discards where the user was going. `requireCampUser` redirects bare (`:188`, `:190`); `grep -c 'redirect("/auth/sign-in")' apps/web` = 29. The threaded `redirectTo` can only ever be `/` or the invite-resume path (`auth/[...path]/page.tsx:45`). Sessions expire at 7 days. **CONFIRMED** | `apps/web/lib/session.ts:188` | Every expired session dumps the burner on the home page, mid-task. |
| MAJOR | "Forgot your password?" is offered on deployments that structurally cannot send email; the refusal only appears after submit (`account-actions.ts:241`), and `missingConfig()` never mentions the email provider. **CONFIRMED** | `apps/web/components/auth/auth-form.tsx:254` | A locked-out user submits into a void. |
| MAJOR | Signed-in mobile chrome renders Account/Profile/Directory as unnamed 16px icons — icon `aria-hidden`, label in `hidden sm:inline`, no `aria-label` on the `<Link>`, no padding. **CONFIRMED** | `apps/web/components/nav-link.tsx:73` | Below 640px the primary nav has no accessible name and a ~16px tap target. Also filed independently by the camps domain. |
| MINOR | Supplier account linking matches the verified email as a **substring** of the free-text contact field (`ilike(contact, '%…%')`), so `…co` matches `…co.za` and claims the row outright with no confirmation. The guarded UPDATE at `:162` has no `.returning()` and no rowcount check, yet audits and returns the row regardless. **CONFIRMED** | `apps/suppliers/lib/session.ts:155` | Ownership of a catalog listing transfers to the wrong account. With no unlink tool (above), it is unrecoverable. |
| MINOR | **SUSPECTED** — that claim is a side-effecting write performed during a Server Component render. `apps/suppliers/app/(portal)/layout.tsx:19` calls `resolveSupplierSession` on every render, which performs the UPDATE + audit insert. No POST, no confirmation, no idempotency token guarding an irreversible ownership transfer. Marked SUSPECTED because whether Next's prefetch of a `force-dynamic` route executes the layout was not closed — but "a GET renders and the row is claimed forever" is the wrong shape regardless. | `apps/suppliers/lib/session.ts:162` | — |
| MINOR | Supplier portal session resolved twice per request; org and web `cache()` theirs with comments saying why. **CONFIRMED** | `apps/suppliers/lib/session.ts:218` | — |
| MINOR | Pending-invite cookie keys `Secure` off `NODE_ENV`, against `resolveUseSecureCookies` (`packages/auth/src/env.ts:123`) which derives it from the resolved origin precisely so a production build over http keeps its cookies. **CONFIRMED** | `apps/web/lib/pending-invite.ts:30` | — |
| MINOR | org and suppliers `runAction` wrappers still swallow Next control-flow errors — no `unstable_rethrow`, unlike `apps/web`'s `run()`. Latent: no action in either app calls `redirect()`/`notFound()` today. **CONFIRMED** | `apps/org/lib/actions/result.ts:13` | — |
| MINOR | Client-supplied `redirectTo` reaches `auth.api.requestPasswordReset` with `originCheck` disabled — better-auth's guard begins `if (!ctx.request) return;`, and this is an in-process call. Bounded correctly: the GET callback re-runs the check, so this is mail-shaping / targeted-recovery DoS, not an open redirect. Same code in all three apps. **CONFIRMED** | `apps/web/lib/account-actions.ts:270` | — |
| MINOR | Sign-up forms enforce only minimum password length; `PASSWORD_TOO_LONG` is mislabelled as a password-policy error by `msg.includes("password")`. `assessPassword` exists and only `apps/suppliers` calls it. **CONFIRMED** | `apps/web/components/auth/auth-form.tsx:27` | — |
| MINOR | Two of three apps hand-write the enumeration-safe copy `@quagga/core` owns, under a header that says "no one hand-writes" these. **CONFIRMED** | `apps/web/components/auth/auth-form.tsx:31` | — |
| MINOR | The password show/hide toggle carries `aria-label`, `aria-pressed` and a full focus-visible ring — and `tabIndex={-1}`. The ARIA can never fire, which is the evidence the negative tabindex is unintended. Backs every password field in all three apps. **CONFIRMED** | `packages/ui/src/components/password-input.tsx:79` | — |
| MINOR | The 2FA "Trust this device" control is a bare `<input type="checkbox">` inside a plain label, while `packages/ui` ships a 44px `AckRow`. Rendered by all three sign-in forms. **CONFIRMED** | `packages/ui/src/components/account-two-factor-challenge.tsx:100` | — |
| MINOR | `Field`'s documented `aria-describedby` contract is honoured by **zero** auth call sites; `PasswordInput` points its own `aria-describedby` at the strength meter, so the two wirings collide rather than being absent. **CONFIRMED** | `packages/ui/src/components/field.tsx:11` | — |
| MINOR | The supplier registration recovery form has four labels associated with nothing (`Field label` with no `htmlFor`, controls with no `id`). Correction to the filed count: four, not five — the Service category trigger carries `aria-label`. **CONFIRMED** | `apps/suppliers/components/register-supplier-form.tsx:79` | — |
| MINOR | The invite confirmation's "Switch account" link points at `/account`, which cannot switch accounts. Downgraded from major: both pages render inside `AppShell`, whose header carries `SignOutButton` — a misdirected link, not a dead end. **CONFIRMED** | `apps/web/app/join/continue/page.tsx:116` | — |

### B. Account security, deletion & erasure

| Sev | Finding | Anchor | What breaks / who notices |
|---|---|---|---|
| **BLOCKER** | **`/change-email` delivers the owner-approval link to the NEW address — account takeover, all three apps.** better-auth 1.6.25 `update-user.mjs:486` invokes `sendChangeEmailConfirmation` with **both** `user` (the current, verified identity) and `newEmail`; `packages/auth/src/config.ts:120-123` destructures only `newEmail` and sends there. Hop 2 (`email-verification.mjs:191`) mints a change-email token and calls `sendVerificationEmail` with `parsed.updateTo` — `config.ts:112` sends that to the new address too. **Both hops land in the requester's inbox.** The endpoint's only guard is `sensitiveSessionMiddleware`: no freshness, no password, no 2FA, and nothing sets `disabledPaths`. **CONFIRMED** (re-verified at synthesis). **Escalation nobody traced past step 1:** `email-verification.mjs:210-236` does `if (!activeSession) { createSession(user.id) }` then sets the cookie — so opening hop 2 in a clean browser hands the holder a full authenticated session as the victim, with `emailVerified: true` and the email already rewritten. | `packages/auth/src/config.ts:123` | Complete account takeover. The victim's only signal is that they can no longer sign in. |
| **BLOCKER** | **The `due` window is an unrecoverable dead end every deletion passes through.** Grace ends at `requestedAt + 14d` to the second; the sweep runs at `0 3 * * *` (`apps/web/vercel.json`), so every request sits in `due` for 0–24h. `canCancelDeletion` returns true only for `grace`, so `cancelPendingDeletion` returns `NOT_CANCELLED` with no notification, email or log. The page then says "being anonymised" (untrue — nothing is erased until 03:00), hides the Cancel button and hides the request form. **CONFIRMED.** Cron-bearer half also checks out: `route.ts:140` answers `200 {ok:true, enabled:true}` for an unauthorised GET with no `console.error`, so a mistyped `CRON_SECRET` reads green forever. | `apps/web/app/(app)/account/delete/page.tsx:96` | A burner who changes their mind on day 14 has no route at all and is told it is already too late. |
| **BLOCKER** | **Deletion guards can be walked past, leaving zero gods or zero camp leads — by two independent mechanisms.** (a) *Ghosts:* sanitization preserves `memberships` and `member_role_assignments` by design (`packages/core/src/account-sanitization.ts:165`), but `orgGodCount` (`apps/web/lib/account.ts:389`) and `leadCount` (`:347`) count them with no `sanitizedAt` filter, so a departed god still satisfies `ctx.orgGodCount <= 1` (`account-security.ts:349`). Two gods: A deletes and is swept, A's membership survives, B passes the sole-god guard and deletes too. **CONFIRMED.** (b) *Concurrency:* there is **no row locking anywhere in the product** — a repo-wide grep for `forUpdate`/`FOR UPDATE`/`isolationLevel`/`serializable` across `apps/` and `packages/` returns two comment hits and zero real ones (re-verified at synthesis). Both counts are plain `SELECT`s outside any transaction, so two co-leads deleting simultaneously both read 2, both pass. `apps/org/lib/queries.ts:780` computes `systemManagerCount` the same way, so the System panel's warning is suppressed by ghosts too. **CONFIRMED.** Note `redeemInvite` (`invites-store.ts:259`) uses the correct conditional-UPDATE + `.returning()` pattern — this is inconsistency, not ignorance. | `apps/web/lib/account.ts:389` | Exactly the unrecoverable state the guard exists to prevent: nobody can sign in with god, or a camp is permanently orphaned. |
| MAJOR | **Supplier contact details survive POPIA erasure.** `suppliers.contact` is 300 chars of supplier-typed free text (placeholder: "e.g. bookings@karootents.co.za · 021 555 0100"), on a row whose `user_id` links it to the account. `sanitizeAccount` touches nine tables and never `suppliers`; the FK is `set null` on `users.id` and the `users` row is never deleted, so the link survives too. Neither `suppliers` nor its contact column appears in `SANITIZATION_PRESERVED_TABLES` or `_PURGED_TABLES`, so no test catches the omission. **CONFIRMED** | `apps/web/lib/account-sanitize.ts:143` | `/account/delete` promises "Your email address · Erased for good"; the org console keeps rendering the departed person's email and phone (`apps/org/lib/queries.ts:1515`). |
| MAJOR | **POPIA-erased accounts appear in the org console as blank but fully-privileged live rows.** `searchAccounts` (`:395`) and `getOrgAccessRoster` (`:740`) are the only two account readers that select neither `sanitizedAt` nor call `publicMemberName` — compare `:1130`, `:1220`, `:1304`, `:1363`, which all do. The table renders italic "no email", "—" for username, and an unchanged Access badge and capability list. `searchAccounts` leftJoins from `users`, so it lists every erased burner in the database. **CONFIRMED** | `apps/org/lib/queries.ts:395` | Staff see privileged accounts with no identity and no explanation, and can act on them. |
| MAJOR | In-process `auth.api` password checks bypass Better Auth's rate limiter. The limiter is applied only by the HTTP router (`dist/api/index.mjs:163`); the default rule for `/sign-in` and `/change-password` is 3 per 10s. `requestAccountDeletion` calls `auth.api.signInEmail` in-process and reports the distinguishable "That password didn't match." No `security_events` row is written on failure. The file's own comment at `:250` states the bypass and adds `consumeRateLimit` for forgot-password only. **CONFIRMED.** Bounded: the attacker must already hold a valid session — escalation, not initial access. | `apps/web/lib/account-actions.ts:759` | An unmetered password oracle behind any stolen session. |
| MAJOR | 2FA disable, backup-code regeneration and passkey add/remove produce **no** security event, **no** inbox row and **no** email. `SecurityEventLogKind` has nine members and none covers 2FA or passkeys; the cards call the browser client directly and only `router.refresh()`, so no server action runs. The card above says "What's happened to your account. We email you when these occur." **CONFIRMED.** `revokeSession`/`revokeOtherSessions` call `recordSecurityEvent` with no `notifySecurity`, so "A device was signed out" appears having emailed nobody. | `apps/web/app/(app)/account/security/page.tsx:118` | An attacker who disables 2FA leaves no trace the owner can see. |
| MAJOR | A failed security-events read renders as the "Nothing to report" empty state. `listSecurityEvents` catches everything and returns `[]`; the consumer branches only on `length === 0`. `SessionList`, twelve lines above on the same page, solves the identical problem honestly ("That means the list is unavailable, not that nothing is signed in"). **CONFIRMED** | `apps/web/app/(app)/account/security/events.ts:69` | A false all-clear on the one page whose job is to raise alarms. |
| MAJOR | A scheduled account deletion is visible on exactly one page. Grep for `buildDeletionView\|getDeletionRequest` returns three call sites, all in the delete flow. `/account` renders a persistent "Email change on record" strip for the far less consequential state and nothing for a pending erasure. **CONFIRMED** | `apps/web/app/(app)/account/delete/page.tsx:85` | 14 days pass with one email and one inbox row as the only signals. |
| MAJOR | `cancelAccountDeletion` tells a user past the grace boundary "There's no deletion scheduled on this account." `cancelPendingDeletion` returns the same `NOT_CANCELLED` for "no pending row" and "pending row past grace" — one predicate, never distinguished in the result type. **CONFIRMED** | `apps/web/lib/account-actions.ts:866` | Compounds the `due` blocker: the recovery attempt is answered with a denial that the deletion exists. |
| MAJOR | The deletion rescue's inbox row is written with `origin` and `linkApp` NULL (migration 0021's columns), and its link is `/account`, which exists only in `apps/web`. `notificationLinkIsLocal(null, …)` returns true for every app, so all three render it. Every other security row goes through `notifySecurity` with `origin:"system", linkApp:"web"`. Extends further than filed: the in-app Cancel button produces the unstamped row too. **CONFIRMED** | `packages/db/src/deletion.ts:126` | An organiser or supplier gets a security notification whose link 404s in their app. |
| MAJOR | `revokeEmailChange` only flips a status column while reporting "Your sign-in email is back to what it was." `confirmEmailChange` writes `schema.user.email`, `email_change_requests` and `schema.users.email`; revoke's only write is `{status:"revoked"}`. **CONFIRMED, and latent** — no `/account/email/*` route exists and the three actions have no caller. Keep the severity: this becomes live the moment the flow ships, and it is the flow the takeover blocker sits under. | `apps/web/lib/account-actions.ts:657` | — |
| MAJOR | `requestEmailChange` reports **failure for a request that committed**, and skips the old address's revocation email. `:475` awaits `sendEmail` to the new address with no try/catch, *after* the transaction committed. A Resend failure throws out of the await, `run()` returns `{ok:false}`, and `:480`'s `notifySecurity` — the old address's revocation link, the inbox row and the `email_change_requested` event — never executes. Every other notification in the file is deliberately best-effort. Latent (no caller) for now. **CONFIRMED** | `apps/web/lib/account-actions.ts:475` | The exact inverse of the honesty rule the file states at `:61`. |
| MAJOR | The passkeys card server-renders "This browser doesn't support passkeys" for every visitor, then hydration-mismatches. `supported` is computed in the render body from `typeof window` with no mounted guard, in a plain client component with no `dynamic({ssr:false})`, on a `force-dynamic` page. **CONFIRMED** | `packages/ui/src/components/account-passkeys.tsx:69` | Every load of `/account/security` streams a disabled button and a denial. |
| MINOR | `revokeSession` reports "Session ended." and writes a `session_revoked` event for a token that was not revoked. better-auth returns `ctx.json({status:true})` unconditionally — the ownership check guards only the delete (`session.mjs:433`). A stale or foreign token produces no error. **CONFIRMED** | `apps/web/lib/account-actions.ts:357` | A burner revoking a device from a stale page is told it worked, and gets a log entry saying so. |
| MINOR | "Session ended." is reported for a session the cookie cache keeps alive for up to five more minutes (`cookieCacheMaxAgeSeconds` = 300). The repo states this internally (`auth-capabilities.ts:110`); no user-facing string does. **CONFIRMED** | `apps/web/lib/account-actions.ts:368` | — |
| MINOR | `assertCapability` ignores the `pending` flag — it returns `{ok:true}` on `support === "supported"` alone, while `capabilityIsUsable` (`:66`) has the correct predicate and the `pending` docstring says surfaces must refuse. **CONTESTED, see §4.R5.** What is not contested: the prose at `account-actions.ts:405` ("currently refuses") and `:513` ("Still gated") is false either way. | `packages/core/src/auth-capabilities.ts:212` | — |
| MINOR | Deletion re-auth strength is chosen from a read that fails soft to an empty list — `listLinkedAccounts` has a bare `catch { return []; }`, and `requestAccountDeletion` derives `hasPassword` from it, dropping to the type-your-own-address path. **SUSPECTED**: `isAuthConfigured()` is already checked, so only a transient throw on the first call and not the second opens the window. | `apps/web/lib/account-actions.ts:720` | — |
| MINOR | Forgot-password is throttled 3-per-15-min on **IP alone**, with no email dimension, one bucket shared by all three apps. The shared bucket is a documented deliberate choice (`rate-limit.ts:17`); the missing per-identity dimension is the defect, and it makes a shared egress IP (office, CGNAT) collide. **CONFIRMED** | `packages/db/src/rate-limit.ts:24` | — |
| MINOR | `notifyPasswordResetCompleted` and `deletionCompletedNotification()` both have **zero callers** (grep across `apps/`, `packages/`, `e2e/`, `docs/` returns definitions and tests only). `security/page.tsx:126` promises resets "land here — and in your inbox". The outbound email *is* sent by `onPasswordReset` — see §4.R1. **CONFIRMED** | `apps/web/lib/account-actions.ts:328`, `packages/core/src/security-notifications.ts:131` | — |
| MINOR | An erased account's honest explanation is written but never shown: `assertNotSanitized` has no call site; all three resolvers use the bare boolean and discard the reason. The window it was written for is real and documented in place. **CONFIRMED** | `packages/core/src/account-sanitization.ts:285` | — |
| MINOR | The supplier-onboarding deletion warning is wired end to end but nothing ever sets `hasInFlightSupplierOnboarding`, so `warnings` is always `[]` and `delete/page.tsx:203-216` is dead. Its text's "notifies the AfrikaBurn supplier team" is also unbacked. **CONFIRMED** | `apps/web/lib/account.ts:403` | — |
| MINOR | Removing a passkey is a single unconfirmed click, and the card's reassurance ("your password stays active, so losing a device never locks you out") renders unconditionally — `requiresPassword` is computed on the page and passed only to `TwoFactorCard`. **CONFIRMED** | `packages/ui/src/components/account-passkeys.tsx:158` | Wrong for Google-only accounts. |
| MINOR | Security-event rows show a date with no time, formatted **in the server's timezone** — a server component calling `toLocaleDateString("en-ZA")`, i.e. UTC on Vercel against a SAST audience. Any event between 22:00 and midnight SAST renders with the previous day's date. `SessionList` directly above renders to the minute, client-side, and is therefore correct. **CONFIRMED** | `apps/web/app/(app)/account/security/page.tsx:45` | The feed's one factual field is wrong for two hours of every day. See §3.G6 for the systemic version. |
| MINOR | Every active session's raw token is serialised into client props (`account.ts:97` → `security/page.tsx:100`). Informational only: better-auth signs the session cookie, so a stolen token cannot be replayed without `BETTER_AUTH_SECRET`. An opaque per-row id would cost nothing. **CONFIRMED** | `apps/web/lib/account.ts:97` | — |

### C. Onboarding, Burner Bio & privacy

| Sev | Finding | Anchor | What breaks / who notices |
|---|---|---|---|
| **BLOCKER** | **An ordinary bio save NULLs medical notes and the ID document whenever the stored ciphertext cannot be decrypted.** `getBio` reads both POPIA columns with `decryptOrNull`, which collapses "unreadable" → null by design (`crypto.ts:68-85`); `mapBioToResponses` omits the keys, so the editor renders empty boxes. On save, `carriesSensitive` is computed from the **inbound** fields only (`:290`), so the M3 refusal cannot fire, and all three columns are written null via `baseValues`, which is spread into both the insert and the update. No pre-read, no transaction. `idType` survives (derived from column presence), so the form shows a document type next to an empty number — which is what makes the destructive save look benign. **CONFIRMED** | `apps/web/lib/bio-store.ts:290` | On a rotated/wrong `PGCRYPTO_KEY`, `/burners/[id]:153` tells the owner "Re-save them from your profile"; following that instruction destroys them, after which the org console prints the affirmative "No medical notes on file for this member." |
| **BLOCKER** | **A final bio save that fails after the row is stamped leaves an unbreakable `/profile ↔ /onboarding` loop.** `completedAt` commits in the upsert; two failure points follow — the lost-username-race early return at `:371` and `ensureProfileKeypair` at `:376` — before `completeRequiredAction` at `:379`. `withTransaction` exists in this codebase and is not used here. The two gates then read different facts: `onboarding/page.tsx:39` routes on the bio row, `profile/page.tsx:130` routes on the required action. `ensureRequiredAction` is `onConflictDoNothing`, so the pending row is permanent. **CONFIRMED.** Correction to the filed impact: `/account`, `/account/security` and `/account/delete` use `requireCampUser` without `enforceGate`, so those three pages stay reachable — it is not literally every URL. | `apps/web/lib/bio-store.ts:372` | Account permanently unusable, with no explanation rendered (see next row). |
| **BLOCKER** | **Every bio field except the username renders no error, so a rejected save is a dead button.** `Field` renders its error paragraph only when passed one; in `DetailsStep` only the username Field passes it (`:582`). `legalName`, `homeCity`, `attendedYears`, `phone`, all four emergency-contact fields, `medicalNotes` and `id.number` all omit it. The banner at `:312` renders only `_form`/`_root`. `persist` sets `result.errors` and returns without `onOk`, so the step silently refuses to advance. Reachable: `PhoneInput` coerces partial E.164 to a string and the schema rejects under 7 digits; no `maxLength` on the medical Textarea (1000 cap) or the city Input (80). **CONFIRMED** | `apps/web/components/onboarding/bio-flow.tsx:582` | The gate cannot be passed and the app never says why. |
| MAJOR | **Structural root of three of the above: `saveBio` is a full column REPLACE, not a patch.** Every column in `baseValues` (`:314-340`) is recomputed from the inbound response map and spread into both branches, so any omitted response key nulls its column. Exactly two things are protected, both deliberately: the v3 extras (`rawExtras === undefined`) and `privacy_flags` (`resolvePrivacyFlagsUpdate`). That asymmetry is the single cause behind the unreadable-ciphertext blocker, the typeless-ID finding and the username-blanking finding. **Fixing the three symptoms individually will not close it.** **CONFIRMED** | `apps/web/lib/bio-store.ts:314` | A partial payload to `updateBioAction` wipes a whole bio. |
| MAJOR | The profile **private key** is stored in plaintext when `PGCRYPTO_KEY` is unset: `safeEncrypt(pair.privateKeyB64) ?? pair.privateKeyB64` — verbatim. `safeEncrypt` returns null exactly when crypto is unconfigured. This is the same file that refuses rather than drops for medical/ID 100 lines earlier, and `crypto-guard.ts:5` asserts the private key is "only ever stored encrypted". **CONFIRMED.** Bounded: nothing currently reads `encryptedPrivateKey`, and erasure hard-deletes `profile_keys` — at-rest only, but with no marker distinguishing it from ciphertext later. | `apps/web/lib/bio-store.ts:413` | — |
| MAJOR | **`/burners/[id]` is the one bio surface with no hard gate.** It calls `ensureCampUser` and never `enforceGate`/`pendingBlockingRoute` — unlike `/directory`, `/profile`, `/notifications`, `/camps/*`, `/bulletins/*` and `/camps/new`. **CONFIRMED** | `apps/web/app/(app)/burners/[id]/page.tsx:60` | A burner who never completed the Bio can browse third-party profiles and, holding a lead/admin membership on a shared camp, read that member's **medical notes** — while the gate claims they cannot reach the app. |
| MAJOR | **`bio` and `skills` are published with `defaultPublic: true` and have no privacy control anywhere in the current UI.** `PRIVACY_REVIEW_EXCLUDE` removes them from the Privacy review; `DetailsStep` has no input or toggle; `savePrivacyFlagsAction` is unwired; the profile summary does not list them. Yet `publicBioView` projects both and `/burners/[id]:84,:181` renders them, and `mapBioToResponses` round-trips their values through every save. **CONFIRMED** | `packages/core/src/bio.ts:171` | A burner carrying legacy v1/v2 bio text or skills has them on their public profile with no screen on which to turn either off. |
| MAJOR | **A disclosing read of an *unreadable* medical field is not audited, in either app.** Both apps gate the audit insert on the notes being non-empty (`medical-access.ts:79`; org `members/[userId]/page.tsx:108`), yet both deliberately show a loud alert stating **that this burner HAS medical notes on file**. `apps/org/lib/queries.ts`'s own comment argues at length that the fact a named person declared a health condition is itself special personal information. **CONFIRMED** | `apps/web/lib/medical-access.ts:79` | On the exact deployment state (wrong/rotated key) where you most want the trail, there is none. |
| MAJOR | **The unbounded `privacy_flags` payload is not confined to the dead endpoint.** `z.record(z.string(), z.boolean())` with no key whitelist and no size bound guards the two actions the editor actually calls (`onboarding/actions.ts:10`, `profile/actions.ts:12`). Both feed `initialPrivacyFlags`, which spreads the raw map verbatim before `enforcePrivacyFlags` overwrites only the eight always-private fields. Arbitrary keys of arbitrary count persist into the jsonb and are re-read on every `getBio` and every public profile render. Contrast `BioExtrasInput`, which is properly bounded. **CONFIRMED** | `apps/web/app/(app)/profile/actions.ts:12` | The one unbounded client-controlled write in this domain. |
| MAJOR | A save rejected on the Privacy step shows nothing at all, even for the one field that renders errors — the only render site for `errors["username"]` is inside `DetailsStep`, unmounted at that point, and nothing jumps back. **CONFIRMED** | `apps/web/components/onboarding/bio-flow.tsx:155` | Directly compounds the redirect-loop blocker: the same race both bricks the account and prints nothing. |
| MAJOR | The PGCRYPTO "refuse, don't drop" message never reaches the user. `saveBio` **throws** rather than returning `{ok:false, errors}` like every other refusal in the file; neither caller catches or wraps (no `unstable_rethrow`, unlike `account-actions.ts:97`), and `persist`'s bare catch substitutes `SAVE_FAILED`. **CONFIRMED.** `BioView.cryptoConfigured` is computed and consumed by nothing. | `apps/web/lib/bio-store.ts:294` | The user is told "try again in a moment" for a condition that will never resolve on its own. |
| MAJOR | "Save & finish later" saves, promises resumption, then bounces to step 1 of the same wizard: `final:false` leaves the required action pending, `app/page.tsx:50` redirects to `/onboarding`, and the route change remounts `BioFlow` at `stepIndex = 0`. The button renders only in `onboarding` mode — i.e. only where it cannot work. **CONFIRMED** | `apps/web/components/onboarding/bio-flow.tsx:245` | — |
| MAJOR | An identity-document number typed without picking a document type is silently discarded while the save reports success. The ToggleGroup starts unselected and is never validated; both encrypted columns are written null even when crypto is configured; `carriesSensitive` requires both, so the POPIA guard is silent. **CONFIRMED** | `apps/web/components/onboarding/bio-flow.tsx:765` | No surface anywhere reveals the loss — the profile summary omits both fields. |
| MAJOR | Camp-history entries typed but not "Add"ed are discarded when the step advances — the editor holds them in local state and only calls `onChange` from `addLinked`/`addFreetext`/`removeAt`; there is no flush-on-submit. Same class as closed item M10, in a wizard M10 did not cover. **CONFIRMED** | `apps/web/components/questionnaire/burns-step.tsx:220` | The "Add as text" control is a secondary outline button inside the card while the primary action sits in the footer bar. |
| MAJOR | "Cancel" on the profile editor does not cancel — every non-final step already committed the write, and the only Cancel is a page-level `<Link>`. **CONFIRMED.** Correction to the filed impact: `legalName` is rendered nowhere third-party (see §4.R4); the fields that genuinely go live prematurely are `homeCity` and `attendedYears`. | `apps/web/app/(app)/profile/page.tsx:146` | — |
| MAJOR | The Burner Bio hard gate is **per-account** while the bio row is **per-edition**, and nothing carries a bio forward. One `required_actions` row keyed `(user_id, action_key)` with no edition, `onConflictDoNothing`, satisfied forever; every bio read is edition-scoped; `required_actions.version` is never written, so a `BURNER_BIO_VERSION` bump re-gates nobody. **CONFIRMED.** Latent: there is no in-app way to activate a new edition (§3.G5). | `apps/web/lib/session.ts:163` | Next year, every burner's bio is empty and nothing asks them to fill it. |
| MAJOR | The participant burner-detail view has **no "no medical notes on file" state**; the console has one. `apps/web` renders the section only when `medical.visible && medical.notes`; `apps/org` reaches an explicit else branch. Both resolve the same predicate and both handle `unreadable` loudly — only the empty state diverges. **CONFIRMED** | `apps/web/app/(app)/burners/[id]/page.tsx:116` | An authorised viewer cannot tell "no notes" from "not authorised". |
| MAJOR | During the hard gate the whole nav stays live and every click discards the current step's unsaved answers. `AppShell` renders Directory, Create camp, Profile, Account, bell and Sign out with no gate awareness; all destinations redirect back; returning remounts at step 0. **CONFIRMED** | `apps/web/components/app-shell.tsx:66` | — |
| MINOR | **SUSPECTED** — a non-rank org membership resolves to rank `org_staff` in the participant app's medical predicate: `orgRankFromRole(actorOrgRole) ?? "org_staff"`, and `orgRankFromRole` returns null for any role that is not god/org_staff/engineer. `apps/org` refuses the same account outright via the identical helper. One such membership plus a role granting `read_personal_information` = a burner's medical notes readable via `/burners/[id]` by someone who cannot open the console, audited as `org_staff`. Marked SUSPECTED because no UI writes a non-rank role onto the org group today — a fail-open default, not a live path. **The fix is one character: drop the `?? "org_staff"`.** | `apps/web/lib/medical-access.ts:212` | — |
| MINOR | The privacy control's own explanation of "private" is false — "Only you and camps you join can see this." No camp surface can read a private bio field: `publicBioView` drops it, `apps/org` never reads `legalName`/`homeCity`, and the roster renders display name and role only. It also contradicts the same flow's step-2 copy. **CONFIRMED** | `apps/web/components/privacy-toggles.tsx:49` | — |
| MINOR | Blanking the username field silently releases a unique handle. `usernameFromResponses` returns null for a blank answer and `saveBio` patches `users.username` to null; NULLs are distinct under the unique index (which erasure relies on). Help text says only "Optional … You can change it later." No confirmation, no post-save notice; `publicMemberName` then falls back to "Unnamed burner". In edit mode this happens on step advance, before Cancel is reachable. **CONFIRMED** | `apps/web/lib/bio-store.ts:240` | — |
| MINOR | `savePrivacyFlagsAction` is a live, unreferenced endpoint that resets omitted flags to their **public** defaults, accepts arbitrary keys, and returns `{ok:true}` on a zero-row write. All three sub-claims verified. **CONFIRMED** | `apps/web/app/(app)/profile/actions.ts:10` | — |
| MINOR | The profile summary renders seven rows under "Everything you carry year to year." and omits medical notes, both ID fields and contact email — all of which are loaded and decrypted for the owner. The "Always private" badge variant exists and would fit. **CONFIRMED** | `apps/web/app/(app)/profile/page.tsx:244` | This is why the destruction in the blockers above is invisible. |
| MINOR | The account-deletion page's "Erased for good" list never mentions medical notes, though its header promises the columns are "the actual @quagga/core sanitization plan … written out in words" and `medicalNotes` is in `SANITIZED_BIO_NULL_FIELDS`. **CONFIRMED** | `apps/web/app/(app)/account/delete/page.tsx:40` | The erasure is real; only the statement is missing — for the one class the rest of the product treats as special. |
| MINOR | The medical-consent sentence is not announced to screen readers (`MEDICAL_AUDIENCE_NOTE` renders as `<p id="medicalNotes-help">` and nothing references it), and both emergency-contact `PhoneInput`s have no accessible name — `PhoneInputProps` has no `aria-label` passthrough and the Field's `htmlFor` points at the sibling name input. **CONFIRMED** | `apps/web/components/onboarding/bio-flow.tsx:749` | — |
| MINOR | The same field is called "Legal name" in `BIO_PRIVACY_FIELDS` and the questionnaire, and "Real name" in the input and the profile row — so the user fills "Real name" on step 2 and reviews "Legal name" on step 4. Granularity differs too. **CONFIRMED** | `packages/core/src/bio.ts:169` | — |
| MINOR | "Edit" beside Burns & volunteering opens "Your details" (both cards link to `/profile?edit=1`, no step param exists), and reaching that section requires committing a save. **CONFIRMED** | `apps/web/app/(app)/profile/page.tsx:233` | — |
| MINOR | "First AfrikaBurn" is used as the empty state for an optional field, so veterans who skipped it are told it is their first burn. The real flag, `firstTime`, has no input anywhere, and the public hero derives its label from that flag instead — same person, two surfaces, contradictory claims. **CONFIRMED** | `apps/web/app/(app)/profile/page.tsx:274` | — |
| MINOR | Composite bio values truncate on a phone with no way to reveal them — single `truncate` line, no `title`, no wrap, on the one screen where a burner would verify the number the safety team holds. **CONFIRMED** | `apps/web/app/(app)/profile/page.tsx:76` | — |
| MINOR | The console's member detail page renders an effectively empty page for an org actor without medical permission — the whole body is `{maySeeMedical && …}` and the file ends. `member-roster.tsx:47` links every member's name here regardless. **CONFIRMED** | `apps/org/app/(console)/registrations/[id]/members/[userId]/page.tsx:155` | — |

### D. Camps, membership & roles

| Sev | Finding | Anchor | What breaks / who notices |
|---|---|---|---|
| **BLOCKER** | **`unassignOfficer` ignores its `groupId` — cross-tenant officer-assignment deletion.** The DELETE is scoped only by `(membershipId, projectRoleId)`, with no join to `memberships.groupId` or `projectRoles.groupId` — the only sibling that does this. `assignOfficer` directly above (`:463`) validates both. The action gate resolves `groupId` from the **caller's** slug and never re-checks the payload ids, and any authenticated user gets lead of a camp they create. The victim ids are in the attacker's hands: `camps/[slug]/page.tsx:169` puts `membershipId` on every memberVM and `:313` passes the **unfiltered** roles array into a client component for any member viewer. LNT Lead and Safety Baron are unconditionally required. **CONFIRMED** (re-verified at synthesis) | `apps/web/lib/roles-store.ts:532` | A member of camp B who leads camp A silently unregisters camp B's Safety Baron. See §3.D3: no notification, no audit row, no error. |
| MAJOR | **`assignOfficer` is a second, completely unguarded role-grant path.** `assignOfficerAction` gates on `assign_roles` and — unlike `setMemberRolesAction` — never computes `allowElevated`; `assignOfficer` never calls `roleGrantsElevatedPrivileges`. Officer roles may legally carry any permissions (`enforceKindPermissions` locks only captain), `OfficerRow` embeds a full `PrivilegeEditor`, and the copy above it invites exactly this. Acceptance is self-serve, and `getMemberPermissions` folds accepted officer permissions into the viewer's grants. **So an `assign_roles`-only member self-assigns an officer role carrying `manage_roles`, accepts it themselves, and holds `manage_roles`.** This falsifies the mitigation claimed in `docs/auth-platform-spec.md:976`. **CONFIRMED** | `apps/web/app/(app)/camps/[slug]/actions.ts:279` | Full privilege escalation inside a camp, in three clicks. |
| MAJOR | `setMemberRoles`' escalation guard inspects **grants only, not revocations**. The guard evaluates `roleGrantsElevatedPrivileges` over `wanted`; the write deletes every assignment in `assignableIds`, which includes captain-kind roles. `roleIds: []` against the Captain's membershipId strips it from an `assign_roles`-only caller. **CONFIRMED** | `apps/web/lib/roles-store.ts:402` | — |
| MAJOR | `roleGrantsElevatedPrivileges` omits `view_member_details` and `manage_questionnaires`, so the seeded "Team lead" (kind `default`) is assignable by an `assign_roles`-only holder — to themselves. That yields ref-code visibility and questionnaire authorship. **CONFIRMED.** See §4.R7: the *blocking*-questionnaire half of the filed impact does not hold. | `packages/core/src/project-permissions.ts:146` | — |
| MAJOR | **No audit trail for any membership, role or officer-consent mutation.** `apps/web` writes `audit_events` in exactly four places — `session.ts:46`, `account-actions.ts:810`, `account-sanitize.ts:220`, `medical-access.ts:83` — none in `roles-store.ts`, `invites-store.ts` or `groups-store.ts`. Officer acceptance is documented as the single path that releases a burner's phone to the org under POPIA consent-based processing, yet neither granting nor destroying that consent record leaves a row. **CONFIRMED** | `apps/web/lib/roles-store.ts` (whole file) | Medical *access* is audited; consent *release* is not. This is what makes the blocker above undetectable rather than merely possible. |
| MAJOR | `manage_members` ("Can manage invites") is stored, displayed and documented but **enforced nowhere** — exhaustive grep finds it only in the privilege editor, the types, and two comments; zero authorization checks. Invite create/revoke both use the structural `PROJECT_ADMIN_ROLES` ladder. **CONFIRMED** | `apps/web/app/(app)/camps/[slug]/actions.ts:86` | A lead grants a privilege that does nothing, and believes they delegated invites. |
| MAJOR | `leaveCamp` lets the last member walk out; nothing can ever delete or reach the camp again. The lead guard only fires when `others > 0`, then the DELETE runs unconditionally. Repo-wide grep for `delete(schema.groups)` returns nothing in any app or package. The zero-member group fails the directory's visibility test and the camp page's member gate, its name stays taken by `checkCampName`, and no invite can be minted. **CONFIRMED** | `apps/web/lib/groups-store.ts:938` | A permanently orphaned row that blocks its own name forever. |
| MAJOR | `createCampAction` trusts a client-supplied group `kind` — `GroupKind.exclude(['org']).default('theme_camp')`, directly under a comment saying kind is not asked, reachable by hand-posting. `audience.ts:176` resolves `art_leads`/`mv_leads` as pure kind+membership with no registration filter, and org questionnaire sends feed through it. **CONFIRMED** | `apps/web/app/(app)/camps/new/actions.ts:14` | Self-selection into an org broadcast audience. |
| MAJOR | `respondToOfficer` verifies nothing and reports success when nothing was written. The membership lookup is correctly scoped, but the UPDATE matches on `(membershipId, projectRoleId)` with no check that the row exists, is still `pending`, or belongs to an officer-kind role of this group; no `.returning()`; `{ok:true}` unconditional; the acceptance notification fires regardless. **CONFIRMED** | `apps/web/lib/roles-store.ts:642` | Same shape in `unassignOfficer`, which toasts "Officer slot freed" on a no-op. |
| MAJOR | Declining an officer role deletes the row, notifies nobody, and leaves three dead UI states. Only `pending` and `accepted` are ever written, so `CONSENT_TAG.declined`, "· declined" and "Declined · the slot is free" are unreachable. Notification hooks exist only for assign and accept, both aimed at the member — nothing ever reaches the lead. **CONFIRMED** | `apps/web/lib/roles-store.ts:630` | A lead never learns their Safety Baron said no. |
| MAJOR | Expired invites stay in the lead's active list and the list shows no expiry at all — `listInvites` filters on `isNull(usedAt)` only (its own doc comment says "unexpired-or-not"), and `camp-invites.tsx` never touches `invite.expiresAt` though the row carries it. **CONFIRMED** | `apps/web/lib/invites-store.ts:77` | The lead copies a dead link and the recipient gets a camp-less "spent" card. |
| MAJOR | Pending-invite cookie expires in **1 hour** while the Burner Bio is the gate in front of it — the constant is documented on the same line as covering "sign-up + Burner Bio", `setPendingInvite` is the only writer and nothing re-issues it. On expiry `/join/continue` redirects to `/`, and a signed-in user is forwarded to `/directory`, where a free camp is invisible. **CONFIRMED** | `packages/core/src/invite-view.ts:143` | An invitee who takes longer than an hour over their bio loses the invite silently, and the wizard's final button still says "Continue to your camp". |
| MAJOR | Directory and create-camp promise "request to join" and a reversible joinability toggle; neither exists. `groups.joinability` is only ever INSERTed — the two `update(schema.groups)` call sites set only description/updatedAt. `/camps/[slug]/settings` contains only `roles/`. The camp page tells non-members "Ask a camp lead for an invite link to join." **CONFIRMED.** Three filed findings collapsed into one; see §4.R6 for the overstated third surface. | `apps/web/app/(app)/directory/page.tsx:280` | — |
| MAJOR | The sole-lead deletion block is unsatisfiable for a one-member camp: `account.ts:342` lists every group where the user holds `lead` with a correlated count, so a solo camp yields `leadCount 1` and is blocked. The CTA links to the plain dashboard; there is no walkthrough. The only escape, `leaveCamp`, is permitted for a sole member and is never mentioned in the delete flow — and it orphans the group permanently. **CONFIRMED** | `packages/core/src/account-security.ts:336` | A burner cannot delete their account, and the one action that would unblock them destroys a camp. |
| MAJOR | The camp dashboard hides the questionnaires link from the members authorised to use it. The route authorises on `manage_questionnaires`; the only in-app link to it is inside `{isAdmin && (` — the structural check. The seeded Team lead grants `manage_questionnaires` out of the box, and the members card next door **is** permission-gated. **CONFIRMED** | `apps/web/app/(app)/camps/[slug]/page.tsx:446` | — |
| MINOR | Every member's **ref code** crosses the client boundary regardless of `view_member_details` — `page.tsx:175` puts `refCode` on every memberVM and passes the array to a client component; `showRefCodes` only decides whether the chip renders. Ref codes are exactly what the gated privilege is defined to cover. Same class as the unfiltered `roles` array that arms the blocker: the page treats client-side conditional rendering as the authorization boundary in two places. **CONFIRMED** | `apps/web/app/(app)/camps/[slug]/page.tsx:175` | — |
| MINOR | `/join/continue` renders the full "You're about to join {camp}" card for a spent, revoked or expired token — `getInvitePreview` returns the row regardless and the page never calls `resolveInviteView`, violating the rule stated at `invite-view.ts:57` and enforced on the landing page. **CONFIRMED** | `apps/web/app/join/continue/page.tsx:62` | A revoked link still leaks the camp's name and description. |
| MINOR | `/join/continue` labels a lead transfer "Join {camp}" — `isTransfer` is computed and used only for the warning banner; the landing page picks "Accept lead role" for the same kind. **CONFIRMED** | `apps/web/app/join/continue/page.tsx:111` | — |
| MINOR | "You've joined X" email fires for a member who was already in the camp — the `self_member` branch returns `{ok:true}` without claiming the invite, `completeInviteJoin` checks only `!result.ok`, and nothing burns the invite, so it repeats per click. **CONFIRMED** | `apps/web/lib/invite-flow.ts:32` | — |
| MINOR | Invite copy says a week; invites are minted for 30 days, and the same route prints both. **CONFIRMED** | `apps/web/app/join/[token]/page.tsx:71` | — |
| MINOR | Revoking an invite is instant and irreversible with no confirmation, immediately beside the copy button; nothing anywhere clears `usedAt`. Both comparable destructive actions in this domain do confirm first. **CONFIRMED** | `apps/web/components/camp-invites.tsx:134` | — |
| MINOR | `redeemInvite`'s `lead_transfer` branch reads `currentRole` **outside** the transaction, then demotes all leads inside it; `ensureMembershipWithRefCode`'s `onConflictDoNothing` silently drops the requested `lead` role if a row appeared meanwhile. Downgraded to minor: needs two live invites for the same camp redeemed near-simultaneously. See §4.R8 for the overstated recovery claim. **CONFIRMED** | `apps/web/lib/invites-store.ts:231` | — |
| MINOR | `ensureDefaultRoles` cannot top up a partially seeded group: two booleans decide all-or-nothing, eight inserts run as separate round trips outside any transaction, and the Team-lead scope patch sits inside `if (!haveAny)`. A surviving Captain row suppresses Team lead + Burner forever; `createRole` only makes kind `custom`, so there is no repair path. Needs a mid-loop crash. **CONFIRMED** | `apps/web/lib/roles-store.ts:87` | — |
| MINOR | A first render of a new camp fires `ensureDefaultRoles` **three times concurrently** — `page.tsx:147` puts `listRoles`, `getMemberPermissions` and `getOfficerStatus` in one `Promise.all` and all three call it; on an unseeded group that is ~33 HTTP round trips. Correctness survives only on the `onConflictDoNothing` target. Note this means a **Server Component render performs writes on the read path**. **CONFIRMED** | `apps/web/app/(app)/camps/[slug]/page.tsx:147` | — |
| MINOR | Removing a custom role orphans the role ids stored inside questionnaire audiences and other roles' scopes — audiences are raw jsonb role ids (same `AudienceSpec` on bulletins), `manage_questionnaires` scopes hold raw ids, and nothing reconciles either. A live activation targeted at a deleted role silently resolves to an empty audience. The delete confirmation warns only about members. **CONFIRMED** | `apps/web/lib/roles-store.ts:337` | — |
| MINOR | Saving member roles wipes the baseline **and accepted-officer** chips from the roster row until `router.refresh()` repairs it. Correction to the filed premise: `page.tsx:171` filters chips on `consent === 'accepted'` only — it does not exclude officers. **CONFIRMED** | `apps/web/components/camp-members.tsx:233` | — |
| MINOR | Org review shows officer names with no way to tell "withheld" from "not supplied" — the query omits the contact columns entirely when `seesPersonalInformation` is false, and the UI renders `{o.email && …}` with no fallback, under copy claiming contact details appear for accepted officers. **CONFIRMED** | `apps/org/components/registration-review.tsx:186` | — |
| MINOR | Clearing a role's name makes the Save button disappear with no validation message; the input carries no `aria-invalid`/`required`, and the server's own message is unreachable from that state. **CONFIRMED** | `apps/web/components/roles/role-row.tsx:78` | — |
| MINOR | Camp-name similarity warning is not announced (no `role`/`aria-live`, no `aria-describedby`) and the confirm press reuses the same button label, while the error path immediately below **does** use `role="alert"`. `groups.name` has no UPDATE path anywhere, so a duplicate is permanent. **CONFIRMED** | `apps/web/components/create-camp-form.tsx:87` | — |
| MINOR | Inline destructive confirmations unmount the activated node, drop keyboard focus, and announce nothing — no `aria-live`, no `role="alertdialog"`. `AssignRolesDialog` in the same domain uses a proper Dialog. **CONFIRMED** | `apps/web/components/leave-camp-button.tsx:32` | — |
| MINOR | Role colour swatches and roster chips are ~20px tap targets (16px swatch + 2px padding). **CONFIRMED** | `apps/web/components/roles/appearance.tsx:89` | — |
| MINOR | The outstanding-officers count badge announces a bare number with no `aria-label` or qualifier, inside a link labelled "Manage roles"; the settings-page equivalent spells it out. **CONFIRMED** | `apps/web/components/camp-members.tsx:95` | — |

### E. Registration & projects

> The registration-projects domain verdict arrived **truncated mid-finding**. One
> defect is recorded here. This domain must be re-run — see §9.

| Sev | Finding | Anchor | What breaks / who notices |
|---|---|---|---|
| **BLOCKER** | **Withdrawing a registration is terminal for the edition, while the confirmation dialog promises the opposite.** `REGISTRATION_TRANSITIONS.withdrawn = []` (`registration-state.ts:28`); `EDITABLE_STATUSES` excludes it, so `saveRegistrationDraft` refuses with the wrong message ("locked while AfrikaBurn reviews it"); `applyCampAction` refuses every action; the insert-a-fresh-draft branch at `registration-store.ts:479` fires only when no row exists, and the withdrawn row still does. All four `registrations.status` writers were enumerated and none can move a row out of `withdrawn`; `resolveReviewActionPath` throws for every org action from it. **CONFIRMED** (re-verified at synthesis). **Correction to the filed finding:** it is *not* one-click — `registration-wizard.tsx:255` wraps it in a `window.confirm`. That makes it worse, not better: the confirm text reads *"Your camp stays, but it won't be considered for this edition **until you register again**"* — a promise the state machine cannot keep. | `apps/web/components/registration/registration-wizard.tsx:256` | A camp lead who withdraws to fix something is out of the burn, with no route back and no org action that can restore them. |

### F. Cross-cutting: identity, capability & copy

One theme recurs across three domains and is recorded once here rather than
three times: **six user-facing strings name a remedy that does not exist.** The
email-change refusal, the unlink refusal (`auth-capabilities.ts:119,143`), the
supplier registration refusal (`register.ts:99`), the directory's "request to
join" (`directory/page.tsx:280`), `create-camp-form.tsx:26`, and the withdraw
confirm (`registration-wizard.tsx:256`) all instruct the user to do something no
screen in any app can do. **CONFIRMED** for each. This is not a copy problem; it is
a spec-drift detector that nobody is reading.

### G. Platform, build & operations (from the completeness critique, re-verified)

| Sev | Finding | Anchor | What breaks / who notices |
|---|---|---|---|
| MAJOR | **CI never runs the E2E suite, and the only runner skips half of it.** The gate is `pnpm turbo run lint typecheck test build`; `turbo.json:70` defines an `e2e` task nothing invokes. `scripts/e2e-local.sh:108` execs `--project=desktop-chromium`, so the `mobile-360` project (`playwright.config.ts:66`) has **never executed** — 58 spec files × every mobile assertion. **CONFIRMED** (re-verified at synthesis) | `.github/workflows/ci.yml:34` | Every spec in §5 protects nothing on merge. |
| MAJOR | CI installs with `--no-frozen-lockfile` against a committed lockfile, under a comment saying to switch it "once pnpm-lock.yaml is committed" — which it is (`ed4ecdd`). CI is free to resolve versions the lockfile does not pin, including `better-auth`, which `AGENTS.md` hard rule 3 pins to 1.6.25 exactly and which two whole domains reasoned about at the `dist/` level. **CONFIRMED** | `.github/workflows/ci.yml:31` | A green CI does not prove the pinned auth library was tested. |
| MAJOR | `turbo.json` `globalEnv` omits every `NEXT_PUBLIC_*` var. `NEXT_PUBLIC_APP_URL` (used to build email-change links) and `NEXT_PUBLIC_PARTICIPANT_APP_URL` are absent, and `NEXT_PUBLIC_*` is inlined at build time — so changing either does not change turbo's hash and a cache hit replays a bundle carrying the old origin. Also absent: `ACCOUNT_SWEEP_SECRET`, `CRON_SECRET`, `VERCEL_ENV`. **CONFIRMED** | `turbo.json:8-24` | Emails pointing at a stale host, from a build that looks correct. |
| MAJOR | The org console's only escape hatch points at `localhost:3000` on a real deployment — `participantAppUrl()` defaults to it and `gate-screen.tsx:86` renders it as "Go to the participant app". `docs/deploy.md:104-125` documents three env vars and **never mentions `NEXT_PUBLIC_PARTICIPANT_APP_URL`**, so nothing tells the deployer to set it. **CONFIRMED** | `apps/org/lib/config.ts:23` | The one link on the wall a refused organiser is offered is dead in production. |
| MAJOR | **Every upload lands on a permanently world-readable origin, and the registration route's MIME allowlist is bypassable.** `apps/web/app/api/registration/upload/route.ts:56` sets `access: "public"`; `:46` reads `if (file.type && !ALLOWED.has(file.type))` — a `FormData` part with **no** `Content-Type` skips the check entirely, leaving only the 8 MB cap and a name sanitiser that preserves the extension. The org route (`apps/org/app/api/blob/upload/route.ts`) correctly requires `requireOrgSession({capability:"write"})` and uses `addRandomSuffix`, but its `supplier-documents` policy (25 MB, PDF/Word/Excel) is selected **from the client payload** (`resolvePolicy(clientPayload)`, `:48`), so any authorised console user can claim it — and the resulting blobs are unguessable but world-readable with no revocation and no expiry. **CONFIRMED** (re-verified at synthesis) | `apps/web/app/api/registration/upload/route.ts:46` | Supplier insurance and licence documents live on an unauthenticated origin forever. |
| MAJOR | **Edition rollover is impossible in-product.** `packages/db/src/seed.ts:142` is the only `insert(schema.editions)` in the repo and there is no update or delete anywhere (re-verified at synthesis); `apps/org/lib/actions/` has ten modules and none is `editions.ts`. Compounding: `editions.isActive` is a bare boolean with **no partial-unique index**, and both `apps/web/lib/edition.ts:30` and `apps/suppliers/lib/session.ts:85` resolve with `.limit(1)` and **no ORDER BY** — two active editions are representable and different apps can silently disagree about which year it is. `groups` has no `edition_id` and `groups_slug_idx` is a global unique, so a 2027 camp name permanently blocks the same camp in 2028. **CONFIRMED** | `packages/db/src/schema.ts:528` | Creating AfrikaBurn 2028 is a hand-run SQL statement against production, into a schema that cannot represent the result safely. |
| MINOR | **Timezone and locale are systemically split.** 27 `toLocale*` call sites; exactly two pass a `timeZone` (`apps/web/lib/edition.ts:58`, `apps/suppliers/lib/edition.ts:24`). Server components render in UTC, client components in SAST — the same instant shows as two dates between 22:00 and midnight. Two locales are in use for the same data: `en-GB` day-first (`notifications/format.ts:31`, `bulletins/[id]/page.tsx:59`) and `en-ZA` year-first (`apps/org/lib/labels.ts:23`, `security/page.tsx:46`). There is no shared date formatter. **CONFIRMED.** Good news for the record: drizzle 0.45.2 handles the 91 timestamp-without-timezone columns correctly, so **storage is sound** — the defect is purely at the formatting seam. | `apps/web/app/(app)/account/security/page.tsx:45` | An organiser and the burner they are talking to see the same timestamp in different formats, sometimes on different days. |
| MINOR | A fully-built money surface exists and is wired to nothing: the `payments` table with two indexes, the status/subject enums, `DEFAULT_CURRENCY`, `payment-reference.ts`, and `PaymentDetailsBlock`. Grep for `schema.payments` across `apps/` and `packages/`: **zero hits** (re-verified). `PaymentDetailsBlock` has no call site outside its own test. **CONFIRMED** | `packages/db/src/schema.ts:1485` | The "never holds funds" stance holds today, but the two invariants that will matter (no writer may record a *paid* state the platform did not observe; the reference must be stable per subject) are asserted nowhere. |
| MINOR | No Resend inbound/bounce webhook and no signature-verification code anywhere; one real cron (`deletion-sweep`) and one honest self-declaring stub (`notifications/digest/route.ts:27`). **CONFIRMED** | `apps/web/vercel.json` | A hard-bounced verification or deletion email is invisible to the product — which matters because several findings above rest on "an email was sent" as the compensating control. |
| MINOR | Migration `0020_past_morg.sql` is careful and correct (nullable → two-pass backfill → `SET NOT NULL`, and it `RAISE EXCEPTION`s rather than guessing when >1 edition exists), but its own header says **"HAND-EDITED from the generated version"**, against `AGENTS.md:65-67` ("A migration is NEVER hand-edited"). Nothing verifies the drizzle snapshot in `migrations/meta/` still matches. Its closing `CREATE UNIQUE INDEX` is non-`CONCURRENTLY`, i.e. a write lock during deploy. **CONFIRMED** | `packages/db/migrations/0020_past_morg.sql` | Either the rule text or the practice needs amending; right now the audit's own M12 fix broke a stated hard rule. |
| MINOR | `packages/ui` was reviewed only where auth touched it: 39 components, 6 test files, ~51 assertions. `responsive-data-table`, `file-upload`, `toggle-group`, `notification-bell`, `accordion`, `dialog`, `popover`, `tabs`, `table` had no reviewer. `design/qa/audit.py`, `whitelist.json` and `penctl.py` were never run — unchanged from 27 Jul. | `packages/ui/src/components/` | — |

---

## 4. Refuted claims

These were raised, argued, and did **not** survive verification. They are recorded
so the same false alarm is not re-raised.

**R1. "Password-reset completion is announced nowhere — no email, no inbox row, no
feed line" (filed as a blocker).** The code fact is real and is upheld at *minor*
in §3.B. This framing is refuted because its load-bearing impact claim is false:
**the email is sent.** `packages/auth/src/config.ts:100-105` wires
`emailAndPassword.onPasswordReset` to `sendAuthEmail`, and better-auth invokes it
inside the reset handler on every successful reset. A takeover via a compromised
inbox does not go unannounced to the victim's mailbox — which was the entire basis
for the blocker rating. One defect, filed three times at three severities.

**R2. "`rateLimitIp` trusts the leftmost `X-Forwarded-For` entry."** The code reads
as described (`packages/db/src/rate-limit.ts:103`), but the behaviour cannot occur
on this deployment: these apps run on Vercel, whose edge *sets* `x-forwarded-for`
to the client IP rather than appending to a client-supplied value, so the leftmost
entry is the proxy's own. Also note the proposed fix is wrong: if the header were
forgeable, `x-real-ip` would never be consulted anyway. Belt-and-braces would be to
take the **rightmost** entry, not the first.

**R3. "With no `PGCRYPTO_KEY`, a burner who types an allergy is permanently locked
out of the participant app / the onboarding gate cannot be satisfied."** The
underlying defect (the thrown message is replaced by "try again in a moment") is
real and upheld. This impact is wrong: `bio-store.ts:290` refuses only a save that
*carries* medical notes or an ID number; clearing those two fields makes the save —
including `final:true` — complete normally, exactly as the thrown sentence says.
The gate **is** satisfiable; the burner is simply never told how. Overstating it
mis-sizes the fix: return `{ok:false, errors}` with that sentence, do not loosen
the refusal.

**R4. "A burner experimenting with 'make my real name public' has already published
their legal name on `/burners/<id>`."** `legalName` is projected by `publicBioView`
but is **rendered by nothing**: `/burners/[id]` never reads `pf.legalName` (the hero
takes `displayName = publicMemberName(username)`), and grep for `legalName` across
all of `apps/org` returns zero hits. The premature-persistence mechanism is upheld;
the fields that actually go live early are `homeCity` and `attendedYears`.

**R5. "`assertCapability`'s `pending` no-op is the load-bearing premise under the
email-change findings."** **CONTESTED, deliberately unresolved.** Two domains read
the same lines and reached opposite verdicts: one calls it a live fail-open; the
other argues `packages/core/src/__tests__/auth-capabilities.test.ts:88-95`
explicitly pins `assertCapability("emailChange") === {ok:true}`, making it a
deliberate support-only gate. Neither asked the question that settles it: **was
that test written to lock the behaviour, or does it merely record it?** That needs a
human ruling, not a third code read. What is *not* contested and matters more: it is
**irrelevant to the takeover blocker**. `/change-email` is mounted over HTTP by
`toNextJsHandler(auth)` in all three apps regardless of what the app's own actions
do, and `buildAuthOptions` never sets `disabledPaths`. Fixing `assertCapability`
would not close §3.B's blocker. `user.changeEmail.enabled: false` would.

**R6. "Three surfaces promise 'request to join', and there is no way to reach the
lead."** Two of three are real (`directory/page.tsx:280`,
`create-camp-form.tsx:26`) and are upheld; the third, `app/page.tsx:29`, reads "See
who's registered, who's accepting members, and who's invite-only" — an accurate
description of the directory's joinability badge, not a promise of a request flow.
The dead-end claim is also wrong: a non-member on a registered camp page gets the
full roster with the lead badged and every name linked to `/burners/{userId}`.

**R7. "A self-assigned Team lead can send a BLOCKING questionnaire that hard-gates
every member out of the participant app."** Not reachable from the seeded state.
The seeded Team lead is `{audienceRoles:'all', mayBlock:false}` and is immediately
re-scoped to `[baselineId]` by `teamLeadScopePatch`;
`canManageQuestionnaireAudience` returns false for any blocking request unless a
granting role sets `mayBlock`, and creating such a role requires `manage_roles` —
the very privilege the escalation clause reserves. The escalation that *is* real
(`view_member_details` + non-blocking authorship) is upheld in §3.D.

**R8. "After the lead-transfer race the camp can never regain a lead through the
app."** Overstated. Any unspent `lead_transfer` link minted before the race still
works (with zero leads the demote UPDATE is a harmless no-op). Surviving admins are
not demoted in capability — `PROJECT_ADMIN_ROLES` is `['lead','admin']`, so the
permission backstop still grants them everything, and they are barred only from
minting a new `lead_transfer`. What is genuinely lost is that link and the
`leaveCamp` guard, which is why the finding is upheld at *minor*.

**R9. "`nextMemberRefCode`'s platform-wide scan runs per redemption, up to five
times."** The headline (a full memberships scan on camp creation) is correct and
upheld. This sub-claim is not: the scan is guarded by `establishedCampPrefix`
returning null, and `createCampWrites` always inserts the creator's membership
*with* a refCode — so every app-created camp has an established prefix from its
first member and the branch is dead on every subsequent join. The retry loop re-runs
only on a caught unique violation.

**R10. "The locked privacy state is called three things."** It is two.
`packages/ui/src/components/switch.tsx:87` sets the string to "Always private",
character-for-character identical to the profile badge; the all-caps appearance is
CSS. The only genuine divergence is "Locked private" in `privacy-toggles.tsx:57`.

**R11. "Withdraw is a one-click destruction."** Refuted as filed:
`registration-wizard.tsx:255` wraps it in a `window.confirm`. The defect is upheld
and is *worse* than filed — see §3.E — because the confirmation text itself makes
the false promise.

---

## 5. E2E coverage

58 spec files (55 under `e2e/specs/`, 3 legacy under `e2e/tests/`). **28 of them
call `skipUnlessGod()`** — on any run without `E2E_GOD_EMAIL`/`E2E_GOD_PASSWORD`,
essentially the entire cross-app surface is *skipped rather than failed*. The org
console is the hinge of every cross-domain chain, so the suite's effective size
depends entirely on deployment configuration, and nothing reports the difference.

### 5.1 Per-persona

| Persona | Files | What is genuinely proven | Gaps that matter | Weak specs |
|---|---|---|---|---|
| **anon** † | 8 | Landing/sign-in/sign-up shells; directory browsable without a session; every gated web surface redirects; the org console and supplier portal both refuse; a free camp is invisible by name and by direct slug; the **full signed-out invite chain** — invite → sign-up → bio gate → `/join/continue` → membership, with the token riding an httpOnly cookie and never appearing in a URL; spent/revoked/bogus links buy nothing. | The **positive** half of discoverability: nothing ever approves a registration and then checks a stranger can find the camp (§5.3 #2). | `free-camp-undiscoverable.spec.ts:69` — asserts only that a 404 page lacks "Members (" and an invite link, which is trivially true of any error page, a 500, or a redirect. Assert the response status. |
| **new-burner** † | 9 | Sign-up + password policy + enumeration-safe duplicate handling; the blocking onboarding gate on every route and its release; bio completion, per-field privacy toggles, years-attended, hard-locked fields un-toggleable; username absent / malformed / taken; privacy projection onto a third-party profile; session lifecycle; password change revoking other sessions; single-session revoke; delete-with-grace and restore. | **The B1 rescue** (sign in from any app cancels a deletion) — the in-app Cancel button is a different code path (§5.3 #1). The **sweep's consequences** — "Departed Burner" appears nowhere in `e2e/`. The **sole-lead deletion block** — `account-management.spec.ts` picks a burner who leads nothing precisely to avoid it. Bio-save error rendering (§5.3 #8). | `password-reset.spec.ts` is `skipUnlessMail()` and `mailMode()` defaults to `off` — zero effective coverage on a default run. |
| **camp-lead** † | 6 | Camp creation + exact-duplicate refusal + near-duplicate soft-warn; six-section registration submit; draft resume in a fresh session; submit refused until complete; invites (redeem, spent, revoked); custom role create with colour/emoji/privileges; a granted privilege unlocking and a revoked one re-locking; Captain privileges locked on; deleting every custom role leaves authority intact; no-abandon-without-transfer; the org review loop from the camp's side. | **No org decision ever reaches the lead's inbox** in any spec (§5.3 #6). **Mutant vehicles and artworks have zero coverage** — `e2e/` contains no reference to `vehicles` or `artworks` (§5.3 #9). **Withdraw is never exercised** (§5.3 #11). Expired-invite display, `manage_members`, the questionnaires-link gate: all unpinned. | `review-loop.spec.ts:103` is a `test.fixme`. |
| **camp-member** † | 4 | Join-by-invite + roster; read-only dashboard; server-side refusals on registration workspace, roles settings, questionnaire builder, invite tokens and the org console; cross-camp isolation for dashboard/registration/questionnaires; a camp-mate's hard-locked bio fields withheld; the **blocking questionnaire gate** trapping and releasing. | The camp questionnaire's **inbox row** (the M7 delivery) is never opened (§5.3 #12); `origin:'camp'` may be stored and never surfaced. | — |
| **officer** ‡ | 5 | The full consent chain: assign → pending → in-app notification → POPIA consent banner → accept → the lead's row flips → **the org review gains the phone only after acceptance** (both sides, one test); decline frees the slot; requirement counts (free camp none, submitting raises, assigning lowers, pending counts as filled); officer rows are fixed-catalog and control-less. | **Revocation is entirely unproven** — no spec calls `unassignOfficerAction`, so the suite proves the org *gains* the phone and never that it *loses* it, which is the half POPIA cares about (§5.3 #4). Cross-camp scoping of `unassignOfficer` (not E2E-reachable — §5.4). The **sound-officer conditional trigger** is invisible: `submitRegistration` picks `radio.first()` = level 0. Bystander cannot accept someone else's post. Stale-tab second response. MV/artwork officers. The `org_officer` broadcast audience. Engineer sees roster-but-no-contact. Officer leaving the camp. Two holders of one post. The success badge ("All required officers assigned") is rendered by no test. | `officer-decline-frees-slot.spec.ts` test 2 — its org-side assertions are satisfied identically by the *pending* state already asserted elsewhere, so it adds no discriminating power for a full two-context + god setup. Its page-wide `toHaveCount(0)` assertions can also pass because other officer rows are collapsed; scope them to the expanded row. `support.ts:69 setBioPhone` proves only that the wizard advanced, not that a phone was stored — a false-green risk under every absence-based privacy assertion. |
| **org-staff** † | 10 | Console gate (refused / cleared); the registration review loop end to end including an audited section comment the camp then reads, approve/reject with decision history, and a stale illegal transition refused server-side; bulletins targeted to theme-camp leads reaching them and nobody else; a branched questionnaire built, activated outbound, answered, and correctly aggregated; supplier standing/notes/onboarding-step confirmation; engineer rank reading everywhere and seeing nobody; the system panel's rank boundary; categories read-only for org_staff. | **The medical-read audit chain is unproven** — only the refusals are covered (§5.3 #3). No spec navigates to `/status` at all. Document *change* reconciliation (M17) is untested — only ack/un-ack of a static document. | `registration-review.spec.ts:175` signs in a second reviewer inline rather than via `signInAs` and never waits for the session cookie — the exact race the factories file documents as the cause of ~100 phantom failures. It also races one principal against itself, so it can pass on session caching rather than the TOCTOU guard. |
| **god** † | 7 | Bootstrap self-elevation for a GOD_EMAILS + verified account, and its refusal for unverified and for self-service sign-ups; elevate/demote lifecycle proved by real console access, both dismiss-dialog negatives, and durability across a fresh session; the ceiling (even a god cannot grant god through the panel; own row inert); departments/roles CRUD and what deleting costs; department domain scoping proved by a real departmental-lead sign-in; sole god cannot self-delete. | **Edition rollover** — unspeccable today, no product surface exists (§5.3 #13). **Multi-role humans** — every persona wears exactly one hat (§5.3 #10). | — |
| **supplier** † | 6 | Self-registration → onboarding step 1; one-password sign-up + basics acknowledgement; sign out/in resumes onboarding; agreement signing; inventory + crew submit and withdraw; org-confirmed steps show "awaiting AfrikaBurn" with no supplier control; standing Good → Watch → Suspended read in plain language and surviving a fresh sign-in; a bound required document ack completing a step and un-ack reverting it; **org-internal notes never reach any portal surface**, with a positive control. | **The B3 fix has no regression test** — no `bulletin` reference exists under `e2e/specs/supplier` (§5.3 #7). Org **document change/delete** reconciliation (§5.3 #14). Supplier-side notification delivery for standing changes and org-confirmed steps (the positive; only the negative is asserted). | `claim-by-email.spec.ts:19` is self-declared as "the least-verifiable spec in the suite … written correct-by-construction from source and has never executed" — both tests `skipUnlessMail()`, which defaults off. The claim-by-email chain decides whether the imported supplier catalog gets silently duplicated. |
| **legacy `e2e/tests/`** † | 3 | Three smoke specs (`app shells load`, `auth round trip`) that earn their place. | — | `negative-paths.spec.ts` — five of seven tests are `test.fixme` whose entire body asserts against the `PERSONAS` registry **constant**, not the application. They would pass green the instant `.fixme` were removed, while the server guard they name could be deleted entirely. Four are genuinely covered elsewhere; delete them. The fifth, `[reach-god-only-surface]`, has no real home and should become a real test in `specs/god/god-privilege-escalation-refused.spec.ts`. |

† Derived at synthesis from a first-hand read of the spec files and test titles, not
from a dedicated per-persona coverage pass — treat gap lists as indicative, not
exhaustive. ‡ From a full per-persona coverage report.

### 5.2 Cross-domain interaction matrix

| Chain | Status |
|---|---|
| camp lead submits → org queue → section comment → camp reads it → edits → resubmits → org sees `submitted` | **Proven** |
| org approve/reject → decision history → camp reads its own registration page → stale second reviewer refused | **Proven** |
| org bulletin → theme-camp-lead audience → targeted burner's web inbox, and nobody else's | **Proven** |
| org questionnaire built → activated outbound → burner answers in web → org aggregate correct | **Proven** |
| camp lead activates a blocking questionnaire → member trapped server-side → submit releases | **Proven** |
| invite minted → signed-out stranger → sign-up → bio gate → membership → lead's roster | **Proven** |
| officer assign → consent → **phone reaches org only after acceptance**; decline shares nothing | **Proven** |
| org sets supplier standing → supplier reads the verdict, survives re-sign-in | **Proven** |
| org publishes a bound document → supplier checklist to-do → ack completes → un-ack reverts | **Proven** |
| org-internal supplier notes → never on any portal surface (with positive control) | **Proven** |
| god elevates → the subject's own org session flips → demote reverses → persists | **Proven** |
| department owns domains → departmental lead's real session is scoped accordingly | **Proven** |
| bio written in web → camp-mate sees nothing hard-locked; camp lead sees medical notes | **Proven** |
| org decision → **notification in the lead's inbox** | **Unproven** — best-effort and swallowed by design |
| org approval → **camp becomes discoverable to a stranger** | **Unproven** — only the negative half is tested |
| medical note → org member detail → **audit row → `/audit` panel** | **Partial** — refusals proven, the positive chain and the trail are not |
| officer accepted → **consent revoked** (unassign, or officer leaves camp) → org loses the phone | **Unproven** |
| org bulletin → **suppliers-app inbox → `/bulletins/[id]` in that app** | **Unproven** — this is exactly what B3 fixed |
| org standing/step change → **supplier portal notification** | **Partial** — the page is proven, the notification is not |
| org document **changed or deleted** → supplier checklist reconciles (M17) | **Unproven** |
| camp questionnaire activation → **member's inbox row, `origin:'camp'`** (M7) | **Unproven** |
| deletion requested → sweep → **"Departed Burner" stub across every app** | **Unproven** — string absent from `e2e/` entirely |
| sign in from **any** app → pending deletion cancelled (B1) | **Unproven** — only the in-app button is tested |
| MV / artwork registration → org project-shaped review → decision → owner sees it | **Unproven** — `vehicles`/`artworks` absent from `e2e/` |
| web invite join → **org-side member roster** with correct role badges | **Unproven** |
| one human, several roles at once | **Unproven** — every persona wears one hat |
| edition N → edition N+1 rollover | **Unspeccable** — no product surface exists (§3.G) |

### 5.3 Specs to write, in priority order

Ordered by the consequence of the behaviour protected, not by effort.

**0. Prerequisite, before any of these are worth writing: add `e2e` to the CI gate
and run both Playwright projects.** `.github/workflows/ci.yml:34` +
`scripts/e2e-local.sh:108`. Everything below is inert until this lands.

---

**1. `e2e/specs/new-burner/sign-in-anywhere-cancels-deletion.spec.ts`** — new-burner.
No god needed, so it runs on every configuration.
*Steps:* `signUpBurner(webPage,{onboard:true})` → `/account/delete`, confirm
password, "Request deletion", assert `/scheduled for deletion/` → `signOut` →
`signInAs(await makeAppPage('org'), account, 'org')` (the console shows the staff
wall; that is fine — the point is that a **session was minted there**) → fresh web
context, `signInAs`, open `/account/delete`.
*Assertion that fails today:* `expect(getByText(/scheduled for deletion/i)).toHaveCount(0)`.
*Also pin the counterpart:* re-entering the password **on** `/account/delete` must
NOT count as coming back (`packages/auth/src/reauth.ts` `isReauth()`) — the
scheduled state must survive. Repeat the first half via the suppliers app.
*Why first:* it is the regression test for the register's first "fixed" entry, which
is not fixed, and it is unblocked by configuration.

**2. `e2e/specs/anon/approval-makes-a-camp-discoverable.spec.ts`** — anon + org-staff,
`skipUnlessGod()`.
*Steps:* onboarded burner creates an invite-only camp → **baseline control** in a
fresh anon context: `/directory?q=<name>` has zero hits and `/camps/<slug>`
redirects to sign-in → `submitRegistration` → `provisionOrgStaff` → walk the queue,
Approve, expect `/approve applied/`.
*Assertions that fail today:* in the **same anon context**,
`expect(getByRole('link',{name: camp.name})).toBeVisible()` on `/directory?q=…`, and
`/camps/<slug>` renders its heading without redirecting. Second consequence: the
lead's `/burners/<id>` now renders the camp **as a link**
(`groups-store.ts:573` — "link only when registered").
*Why:* this is the product's central entitlement flip
(`groups-store.ts:187`), and today only its negative half is tested — an approval
that silently failed to flip `registered` is invisible to every existing spec.

**3. `e2e/specs/org-staff/medical-read-is-audited.spec.ts`** — org-staff,
`skipUnlessGod()`, desktop-only.
*Steps:* lead + member; the member writes a unique medical sentinel via
`setHardLockedBioData`; submit the registration → `provisionOrgStaff`, open the
detail from the queue → assert the roster lists the member with a `Member` badge and
**no has-notes signpost** (this pins the census rule too) → click through to the
member detail → the sentinel is visible → `/audit`.
*Assertion that fails today:* the medical-access panel names the staff account as
reader and the member as subject, "just now".
*Why:* `apps/org/lib/medical-audit.ts` states that the trail is the only control
against a lead walking their whole roster, and that "a trail nothing ever reads is
not a control" — yet the write is inside `after()` and **fails open**, so it can rot
silently. Only the refusals are covered today.

**4. `e2e/specs/officer/officer-unassign-revokes-org-access.spec.ts`** — officer,
`skipUnlessGod()`.
*Steps:* `setUpCampWithMember` → assign LNT Lead → accept → **assert the phone
marker IS visible on the org review** (without this the revocation assertion is
vacuous) → as the lead, `/camps/<slug>/settings/roles`, expand the LNT row, click
`getByRole('button', {name: /Remove <username> from LNT Lead/})` (the `aria-label` at
`officer-row.tsx:228`) → the row reads `/not yet assigned/` and the outstanding badge
rose by one.
*Assertion that fails today:* re-fetch the org review —
`expect(getByText(marker)).toHaveCount(0)` and
`expect(getByText(/no officers have accepted a role/i)).toBeVisible()`.
*Why:* the suite proves the org **gains** the phone on consent and never that it
**loses** it on withdrawal — the half POPIA actually cares about, and the half a lead
uses when someone drops out. Pair it with an `officer-leaving-camp-revokes-contact`
sibling: the officer leaving is the only revocation route the officer themselves
controls, since the consent banner disappears the moment they accept.

**5. `e2e/specs/new-burner/deletion-blocked-and-transferable.spec.ts`** — new-burner,
no god needed.
*Steps:* lead + camp + a second burner joined by invite → the lead opens
`/account/delete`.
*Assertions that fail today (nothing exercises `blocked-projects.ts`):* the page
**refuses**, **names the camp**, and offers a working "Transfer leadership" link whose
`href` is `/camps/<slug>/settings/roles`; follow it, transfer, return, prove the
block is gone and "Request deletion" now succeeds.
*Companion, Part B — `sweep-leaves-a-departed-burner-stub.spec.ts`:* gate on a new
`skipUnlessSweepSecret()` reading `E2E_ACCOUNT_SWEEP_SECRET` and POST the **real**
sweep route with Playwright's `request` fixture (product surface, not a test side
door). Assert the lead's roster renders "Departed Burner" where the username was,
`/burners/<id>` no longer resolves it, and the org roster shows the same stub with
its role badge intact. **Blocked** unless the 14-day grace is configurable — if it is
not, that is itself the finding, and it belongs in `e2e/README.md`'s
honest-limitations section rather than being faked.

**6. `e2e/specs/camp-lead/decision-reaches-the-inbox.spec.ts`** — camp-lead + god,
`skipUnlessGod()`. (Or a second test inside `review-loop.spec.ts`, which already
holds both pages.)
*Steps:* submit → org requests changes.
*Assertions that fail today:* on the lead's `/notifications`, a row naming the camp
and reading as a registration decision is visible; it is **unread**
(`?filter=unread` still contains it); clicking it navigates to `/camps/<slug>`,
proving `linkApp:'web'` produced a link this app can serve. Then approve and assert a
**second** row.
*Why:* `notifyRegistrationDecision` is wrapped in a try/catch that logs and swallows —
a broken fan-out is silent by design.

**7. `e2e/specs/supplier/bulletin-reaches-the-portal.spec.ts`** — supplier + org-staff,
`skipUnlessGod()`, desktop-only.
*Steps:* `registerSupplier` (a portal account is what makes the supplier resolvable —
`audience.ts:300` reaches only suppliers with `user_id` set) + an onboarded burner as
the **negative control** → org publishes a bulletin to the audience named exactly
"Suppliers" with a marker body.
*Assertions that fail today:* the title appears on the suppliers app's
`/notifications` and under `?filter=bulletins`; clicking it navigates to
`/bulletins/<uuid>` **in the suppliers app** and the marker renders — delete that
route and it 404s, **which is exactly the defect B3 fixed and has no regression
test**; the plain burner's inbox does not contain it.

**8. `e2e/specs/new-burner/bio-save-errors-are-visible.spec.ts`** — new-burner, no god.
*Steps:* during onboarding, enter a phone below the 7-digit minimum (or a 100-char
home city) and press the primary button.
*Assertions that fail today:* an error message is rendered **adjacent to the
offending field** and the step does not silently stay put. Second test: trigger the
same rejection from the **Privacy** step and assert the wizard returns to Details with
the error shown.
*Why:* this is the blocker in §3.C that makes the other two bio blockers invisible,
and it is the cheapest of the high-consequence specs to write.

**9. `e2e/specs/camp-lead/mutant-vehicle-registration.spec.ts`** (+ an artworks sibling)
— camp-lead + org-staff, `skipUnlessGod()`.
*Prerequisite:* add `submitVehicleRegistration(page, input?)` to
`e2e/personas/factories.ts` mirroring `submitRegistration` — `/vehicles/new`, name,
base vehicle, mutation description, a SOOP sound-level radio, flame effects, night
driving, **all three `VEHICLE_ACK_KEYS` checkboxes** (`vehicleSubmitGate` refuses on a
smaller Set), near-duplicate-name handling as `createCamp` does.
*Assertions that fail today:* the vehicle name appears in the org `/registrations`
queue **at all**; the detail renders the **project** layout, not the camp one (subject
noun "mutant vehicle", camp section labels absent, no wrangler block); Approve flips
the owner's page.
*Why:* two of the three registerable project kinds have no end-to-end proof in either
app, and `apps/org/.../registrations/[id]/page.tsx:79` is a second, parallel review
implementation.

**10. `e2e/specs/org-staff/one-person-many-hats.spec.ts`** — `skipUnlessGod()`,
desktop-only.
*Steps:* one account, three hats — onboarded burner who creates and submits a camp
(lead), self-assigns and accepts an officer post (officer), then is elevated by a god
(org staff).
*Assertions:* (1) the participant app still works for them — `/profile` and
`/directory` render, no gate; (2) **their own camp appears in their own review queue
and the detail opens** — assert whatever the product intends: either an explicit
conflict-of-interest refusal, or, if none is intended, at minimum that the decision is
attributed to them in the decision history so the self-review is visible rather than
invisible; (3) their roster row on the org side reads "Lead", not "Org staff"; (4)
their self-consented officer phone appears on the org review exactly once.
*Why:* no conflict-of-interest guard exists anywhere in `apps/org` or
`packages/core`. **The current silence is the finding**, and this spec is where the
decision gets made.

**11. `e2e/specs/camp-lead/withdraw-is-terminal.spec.ts`** — camp-lead, no god.
*Steps:* submit a registration → withdraw, accepting the `window.confirm`.
*Assertion that fails today against the promise:* the confirm text says "until you
register again"; assert the actual behaviour — the wizard is read-only, "Submit" is
gone, and there is no route back. Whichever way the product resolves this (a
re-register path, or honest copy), the spec pins it. Today neither is pinned.

**12. `e2e/specs/officer/officer-consent-is-personal.spec.ts`** — three web contexts.
*Steps:* lead, assigned officer, and a **bystander** member.
*Assertions:* the bystander sees no consent heading and no Accept button; the request
survives untouched.
*Why:* widen `pendingOfficerConsents` by group instead of user — a plausible refactor —
and every member is offered someone else's Accept button, and `respondToOfficer`
returns `{ok:true}` after updating **zero** rows (`roles-store.ts:642`, no rowcount
check), so the impostor gets the success toast while the real request stays pending.
Nothing catches either half.

**13. `e2e/specs/god/edition-rollover.spec.ts`** — **blocked on a product prerequisite**,
recorded so it is not mistaken for a gap that can be closed by writing a test. The org
console needs a god-only edition surface; today only `seed.ts:142` can create one. When
it exists, the spec must run `test.describe.configure({mode:'serial'})` — flipping the
active edition is the one genuinely global act in the suite and would poison every
parallel worker. Until then, record it in `e2e/README.md`'s honest-limitations section
beside Google OAuth.

**14. Smaller, high-value additions** (each a few lines inside an existing spec):
- `supplier/documents.spec.ts` — org **deletes or re-binds** an acknowledged document;
  the supplier's step reverts to "To do" and the tally drops **without the supplier
  touching anything** (the M17 reconcile, currently untested in the direction that
  motivated it).
- `supplier/standing.spec.ts` — after `orgSetStanding`, the supplier's
  `/notifications` carries an unread row whose link resolves inside the portal.
- `camp-member/camp-member-lifecycle.spec.ts` — after a camp questionnaire
  activation, the member's inbox row names the **camp**, not "AfrikaBurn". This may go
  red immediately: `notifications/format.ts` `sourceLabel` gives every `questionnaire`
  kind the AfrikaBurn label regardless of `origin` — `origin:'camp'` stored but never
  surfaced. If it does, that is a real defect worth catching.
- `officer/officer-required-counts.spec.ts` — assign the **second** always-required
  officer and assert the success badge ("All required officers assigned") and
  `/\d+ outstanding/` at count 0. The success branch is rendered by no test today.
- `officer/officer-sound-trigger.spec.ts` — select "Level 3 — Small rig" in Sound &
  Placement (do **not** submit) and assert Sound Officer flips `recommended` →
  `required` and the outstanding count goes 2 → 3. `submitRegistration` picks
  `radio.first()` = level 0, so the only conditional officer trigger in the product is
  E2E-invisible — and this also pins that a *draft* raises requirements.
- `officer/officer-assignment-request-and-consent.spec.ts` — **click** the notification
  instead of `page.goto`, and assert it lands on the camp page carrying the banner.
  `campNameAndSlug` is best-effort and returns null on a miss, so the row can become an
  inert dead end that still passes today's text-only assertion.

### 5.4 Not E2E-reachable — write these as unit tests instead

Next server-action ids are build-hashed and no UI sends a foreign id, so the
cross-tenant cases cannot be driven through a browser. They belong in the vitest
harness added by M21 (`apps/web/lib/__tests__/`):

- **`roles-store-officer-scope.test.ts`** — seed two groups each with an officer role
  and an accepted assignment. `unassignOfficer(groupA.id, membershipInB.id, roleInB.id)`
  must return `{ok:false}` and camp B's row must survive. **Today it deletes the row and
  returns `{ok:true}`.** Mirror it for `respondToOfficer`'s pair scoping.
- **`account-guard-counts.test.ts`** — `orgGodCount` and `leadCount` must exclude
  sanitized accounts (§3.B blocker (a)).
- **`bio-store-partial-save.test.ts`** — a payload omitting `medicalNotes` must not null
  the column (§3.C blocker + the REPLACE root cause).

---

## 6. Weak existing specs — strengthen or delete

| Spec | Verdict |
|---|---|
| `e2e/tests/negative-paths.spec.ts` | **Delete four, promote one.** Five of seven tests are `test.fixme` whose bodies assert against the `PERSONAS` registry constant — a literal in `e2e/personas/registry.ts`, not the application. They would pass green the moment `.fixme` came off while the server guard they name could be deleted entirely. Four are genuinely covered elsewhere (`free-camp-undiscoverable`, `camp-member-cross-camp-isolation`, `supplier/isolation`, `anon/burner-profile-privacy`); the fifth, `[reach-god-only-surface]`, should become a real test in `specs/god/god-privilege-escalation-refused.spec.ts`. The file both understates real coverage and holds five assertions that can never fail. |
| `e2e/specs/supplier/claim-by-email.spec.ts` | **Keep, but stop counting it.** Self-declared at `:19` as "the least-verifiable spec in the suite … written correct-by-construction from source and has never executed." Both tests `skipUnlessMail()`; `mailMode()` defaults to `off`. Either wire mail into CI for this one chain or mark it explicitly in `e2e/README.md` as zero-coverage-by-default. Same structural caveat for `new-burner/password-reset.spec.ts`. |
| `e2e/specs/anon/free-camp-undiscoverable.spec.ts:69` | **Strengthen or drop test 3.** "No `Members (` text and no `/invite/i` link" is trivially true of any error page, a 500, or a redirect to the landing page. Assert the actual status from `page.goto()`. The two tests above it do real work. |
| `e2e/specs/org-staff/registration-review.spec.ts:175` | **Strengthen.** The second reviewer signs in inline rather than through `signInAs` and never waits for the session cookie — the exact race `personas/factories.ts` documents as the cause of ~100 phantom failures. It also races one principal against itself, so it can pass on session caching rather than on the TOCTOU status guard the comment claims it pins. Use two **different** org_staff accounts. |
| `e2e/specs/officer/officer-decline-frees-slot.spec.ts` (test 2) | **Fold in or sharpen.** Its two org-side assertions are satisfied identically by the *pending* state that `officer-phone-shared-with-org-only-after-consent.spec.ts:53` already asserts on the same fixture, so it buys no discriminating power for a two-context + god + queue-walk setup. Also, the page-wide `toHaveCount(0)` assertions can pass because other officer rows are **collapsed** rather than because the declined row cleared — scope them to the expanded row (the spec already imports `expandRow`). Make it prove re-assignment after decline, or fold the org check into the phone-sharing spec. |
| `e2e/specs/officer/support.ts:69` (`setBioPhone`) | **Add a positive anchor.** It types the phone and asserts the field left the DOM — i.e. that the wizard advanced, not that the server stored anything. Under any absence-based privacy assertion (`toHaveCount(0)`), a silently-dropped phone makes the assertion pass **for the wrong reason** — a false green on the single most important privacy assertion in the suite. Reload `/profile?edit=1` and assert the digits are held. |
| `e2e/specs/officer/officer-roles-not-aliasable.spec.ts` | **Halve it.** It asserts the *absence of affordances*; delete the officer guard in `renameRole` (`roles-store.ts:243`) or `setRoleAppearance` (`:285`) and this spec stays green — only `packages/core/src/__tests__/project-roles.test.ts` moves. Its second half (custom-role rename/delete) is camp-lead coverage sitting in the officer folder; `camp-lead/roles.spec.ts` is its home. What it uniquely earns is the fixed-catalog-name and lock-glyph assertions. |
| `e2e/specs/camp-lead/review-loop.spec.ts:103` | One `test.fixme`. Resolve or remove. |

---

## 7. Themes

**T1. The register's closed-list cannot be trusted, and that is the most expensive
finding here.** `docs/audit-register.md:15` says every blocker is fixed; `:81` in the
same file says not to set `ACCOUNT_SWEEP_SECRET` until B1 is fixed; B1 is not fixed
(§3.A). Eleven reviewers were instructed not to re-report it on the strength of line
15. A closed-list entry should be a link to a regression test, not a sentence.
Spec #1 in §5.3 exists for this reason.

**T2. Write paths reached by a GET, and authorization enforced in the render tree.**
`resolveSupplierSession` claims a supplier row during a Server Component render
(§3.A); `ensureDefaultRoles` performs eight inserts on the camp dashboard's read path,
three times concurrently (§3.D); `camps/[slug]/page.tsx` ships every member's
`refCode` and the unfiltered `roles` array into a client component and relies on
conditional rendering to hide them (§3.D). The pattern is the same each time: the
render is treated as a safe place to do a thing, and the client is treated as a place
to enforce one.

**T3. Success is reported for writes that did not happen.** `unassignOfficer`,
`respondToOfficer`, `revokeSession`, `savePrivacyFlagsAction`, the supplier
email-overlap claim, `applyCampAction`'s siblings — six mutations issue an UPDATE or
DELETE with no `.returning()` and no rowcount check, then return `{ok:true}` and
toast. `redeemInvite` (`invites-store.ts:259`) does it correctly, and
`cancelPendingDeletion` uses the status predicate as its own concurrency guard — the
team knows the pattern. This is drift, not ignorance, and it is the single most
mechanical class to fix.

**T4. Copy is written against an intended product, not the built one.** Six strings
name a remedy nobody built (§3.F); three security surfaces promise notifications that
are never sent (§3.B); the withdraw confirm promises a transition the state machine
forbids (§3.E); `/account/security` promises password-reset events from a notifier
with no caller. The strings are all honest in intent and all currently false, and no
mechanism connects a capability's real state to the words describing it. `pending`
in `auth-capabilities.ts` was designed to be that mechanism and is not wired to
`assertCapability` (§4.R5).

**T5. Counting invariants with no locking and no tombstone filter.** Sole god, sole
lead, sole system manager, officer coverage, supplier onboarding tallies — every
invariant in the product is a read-committed check-then-act over a `count(*)` that
includes erased accounts. Two independent mechanisms break the same guard (§3.B).
The fix is one predicate (`sanitizedAt IS NULL`) and one pattern (conditional UPDATE
+ `.returning()`), applied consistently.

**T6. `saveBio` is one root cause wearing four costumes.** Full-column REPLACE
(§3.C) produces the unreadable-ciphertext destruction, the typeless-ID discard, the
username release, and the partial-payload wipe. Fixing the four symptoms
individually will not close it.

**T7. The consent record has no audit trail, while the consent's *use* does.**
Medical reads are audited in both apps (`medical-access.ts:83`); granting,
accepting, declining and destroying an officer's consent record — the single
sanctioned path that releases a burner's phone to AfrikaBurn — leaves nothing
anywhere (§3.D). And a read of an *unreadable* medical field, which still discloses
that the person has notes, is audited in neither.

**T8. The suite is good and it is not wired to anything.** The specs that exist are
mostly excellent (§8) and none of them gate a merge (§3.G). Eight persona reviewers
analysed the coverage of a suite no command in the repo can fully run.

---

## 8. What is genuinely good

Specific, not generous.

- **The officer consent chain is the best-tested thing in the product, and it tests
  the right thing.** `officer-phone-shared-with-org-only-after-consent.spec.ts:53-69`
  asserts both sides in one test: a pending officer's phone digits are absent from
  the whole org review page, and the same page shows them after acceptance. Delete
  the `consent='accepted' AND org_visible` filter in `getRegistrationOfficers` and it
  goes red. That is a privacy boundary pinned by a real browser assertion, not a
  source-shape check.
- **The two-table identity split is correct and correctly documented.**
  `packages/db/src/schema.ts:328-341` explains in ten lines why there is deliberately
  no FK from `users.auth_user_id` to `user.id`, what a real FK would force, and why
  merging the tables would be worse. B1 is a bug *within* that design, not a
  consequence of it.
- **`cancelPendingDeletion` uses its status predicate as the concurrency guard**
  (`packages/db/src/deletion.ts:82-90`), commits the cancel and the audit atomically,
  and makes the inbox row and security event explicitly best-effort *after* the
  commit — with comments saying why each choice was made. It is the correct shape
  that T3 and T5 are measured against.
- **Migration `0020_past_morg.sql` is careful work**: nullable column → two-pass
  backfill → `SET NOT NULL`, and it `RAISE EXCEPTION`s rather than guessing when more
  than one edition exists. `0021` is correctly nullable on both columns for a
  three-app staggered deploy. (The hand-edit rule violation in §3.G is a process
  point, not a quality one.)
- **Timestamp storage is sound.** 91 `timestamp`-without-timezone columns, and
  drizzle 0.45.2 round-trips them correctly. The timezone defect is purely at the
  formatting seam — the data is right.
- **`SessionList` is the honest-degradation reference implementation**
  (`session-list.tsx:97-102`: "That means the list is unavailable, not that nothing
  is signed in"), and it sits twelve lines above `listSecurityEvents`, which does the
  opposite. The right answer already exists in the file.
- **The org blob upload route names its capability** — `requireOrgSession({capability:
  "write"})` rather than settling for "has a session", with a comment saying so
  (`apps/org/app/api/blob/upload/route.ts:81`). The participant upload route does not.
- **The E2E harness's discipline is real:** RUN_ID-namespaced identities, one
  isolated context per app, no DB back doors, and spec headers that state their own
  limitations out loud — `claim-by-email.spec.ts:19` volunteers that it has never
  executed. Several gaps in §5 were findable *only* because the harness refuses to
  fake them.
- **`packages/core` is genuinely pure and genuinely tested** — the audience
  resolution, officer requirements, registration state machine, sanitization plan and
  privacy projection all live there with unit tests, which is why so many findings
  above are "the app doesn't call it" rather than "the logic is wrong".

---

## 9. What this audit did NOT cover

**Inputs that did not arrive.** Only 5 of 11 commissioned domain verdicts reached
synthesis, and one of those (registration-projects) was truncated mid-finding —
§3.E therefore records a single defect from a domain that covers the six-section
wizard, the project kinds, autosave, section review and the org decision path. Only
1 of 9 per-persona coverage reports arrived (officer); the other eight rows in §5.1
were reconstructed at synthesis from a first-hand read of the spec files and test
titles, which is shallower than a dedicated pass. **The following were commissioned
and are unaccounted for: six domain verdicts and eight per-persona coverage
reports.** Treat §5.1's non-officer gap lists as indicative. Re-run
registration-projects first.

**Not attempted here.**
- Running anything. No app, no migration, no E2E suite, no `design/qa/audit.py`.
  Every finding is a code read.
- The production Vercel environment-variable set was never inspected — §3.G's
  `localhost:3000` gate link is a direct consequence and cannot be confirmed as live
  without it.
- Performance at production scale. The `ensureDefaultRoles` fan-out and the
  memberships scan are reasoned about, not measured.
- Geometric/layout QA on any band, and no 360px pixel comparison — and §3.G shows
  the harness for it has never run.
- The CONCEPTS/ARCHIVE band.
- `packages/ui` beyond the components auth touches: `responsive-data-table`,
  `file-upload`, `toggle-group`, `notification-bell`, `accordion`, `dialog`,
  `popover`, `tabs`, `table` had no reviewer.
- The 57 design-parity items from the 27 Jul register are untouched and out of scope.
- **§4.R5 is deliberately unresolved** and needs a human ruling on intent, not a
  third code read.

---

## 10. Counts

Post-dedupe (one defect filed six times across two domains is one row).

| Severity | Count |
|---|---|
| Blocker | **9** |
| Major | **56** |
| Minor | **45** |
| Refuted | 11 |
| Contested / needs a human ruling | 1 |
| **Total upheld** | **110** |

Of the 110, **106 are CONFIRMED** and **4 are SUSPECTED**
(`apps/suppliers/lib/session.ts:162` claim-during-render;
`apps/web/lib/medical-access.ts:212` org-rank fail-open;
`apps/web/lib/account-actions.ts:720` deletion re-auth soft failure; and the
concurrency half of the §3.B deletion-guard blocker, whose *mechanism* is confirmed
by the absence of any locking but whose exploitation was not reproduced).
