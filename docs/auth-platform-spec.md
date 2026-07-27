# Auth Platform Spec — Self-Hosted Better Auth (Plan of Record)

> ## ✅ EXECUTED — read as the *reasoning*, not as a to-do list
>
> *Status added 27 Jul 2026.* The migration this document plans **has happened**.
> `@quagga/auth` runs Better Auth **1.6.25** (not the 1.5.x this text anticipates),
> mounted in all three apps at `/api/auth/[...all]`; the auth tables landed as
> migration 0013 and the two-factor + passkey tables as 0015. Managed Neon Auth is
> gone.
>
> So when you read a future tense here — "we will move off", "this unblocks 2FA",
> "P0-6 delete managed Neon Auth" — read it as the argument for a decision already
> taken. The threat model, the POPIA analysis, the observability plan and the
> [VERIFIED]/[INFERRED] discipline are all still live and still worth citing.
>
> **Not yet done from this plan:** the OAuth-provider / IdP track (§ on becoming an
> IdP for Camp 404) is still parked, and the observability wiring is partial.
> The current shipped-capability list is `AUTH_CAPABILITIES` in `@quagga/core` and
> `docs/accounts-security-spec.md` §"What we run" — those are the authorities on what
> exists today; this file is the authority on why.

*Synthesised from the COMPLETE seven-domain research set (better-auth-core, passkeys,
ci-regression, security-hardening, observability, compliance-reporting, threat-model —
82 findings). Ryan, rewritten 2026-07-26 from the full corpus. This is the plan of record
for moving the AfrikaBurn Contributors App off **managed Neon Auth** (Neon-hosted Better
Auth 1.4.18) onto **self-hosted Better Auth** — the library mounted in our own
`/api/auth/*` route handlers, auth tables owned by `packages/db`. It supersedes
`docs/platform-architecture-spec.md` Option A as the active path and promotes a controlled
form of Option B.*

> **Provenance & honesty rule.** Every claim carries **[VERIFIED]** (the research confirmed
> it against primary docs/source, citation inline) or **[INFERRED]** (reasoned, not directly
> confirmed — treat as a hypothesis to validate). Where a finding was explicitly marked
> unverified in the research, it is marked here too — uncertainty is never laundered. This
> rewrite draws on all seven domains; the earlier draft of this file only saw the first four
> and left observability partial and compliance + threat-model largely absent. Those three
> are now built in full.
>
> **This is not legal advice.** The POPIA sections are grounded in cited South African legal
> commentary but must be reviewed by someone with a POPIA mandate before an incident.

---

## 1. DECISION SUMMARY

**Recommended architecture (5 bullets):**

1. **One `@quagga/auth` package exporting ONE `betterAuth()` config**, mounted
   independently in each of the three Next.js apps at `app/api/auth/[...all]/route.ts`,
   all pointing `drizzleAdapter` at the **same Neon database**. Not a proxy, not a central
   auth server — each Vercel project runs its own in-process copy of the library against the
   shared DB, so every server component/action gets a zero-network-hop
   `auth.api.getSession()` and the `@quagga/core` server-enforced authz predicates keep
   working. This is the documented "multiple apps sharing the same database" pattern.
   **[VERIFIED]** https://www.answeroverflow.com/m/1369121288609730710 ·
   https://github.com/better-auth/better-auth/discussions/6055 ·
   https://better-auth.com/docs/integrations/next
2. **Move OFF the 1.4.18 pin to Better Auth 1.5.x** (the pin existed *only* to match managed
   Neon's internal version; self-hosting removes the reason). 1.5 unlocks non-destructive
   versioned secret rotation, the production OAuth 2.1 Provider for the parked IdP, and
   adapter repackaging. Budget for its breaking changes. **[VERIFIED]**
   https://better-auth.com/blog/1-5 ·
   https://github.com/better-auth/better-auth/releases/tag/v1.5.0
3. **Database sessions (Better Auth default) + `cookieCache`**, cross-subdomain cookies on a
   **custom apex domain** (`app.` / `org.` / `suppliers.`). Keeps the revocable session list
   the accounts-security-spec depends on; the apex is a hard prerequisite that `*.vercel.app`
   cannot satisfy (Public Suffix List). **[VERIFIED]**
   https://better-auth.com/docs/concepts/session-management ·
   https://better-auth.com/docs/concepts/cookies
4. **Auth-method ladder: password (15+ char, breach-checked) primary, email-OTP / magic-link
   low-friction fallback, TOTP + backup codes and passkeys as optional opt-in upgrades.**
   Passkey-first is deferred — the SA volunteer device mix (Android-dominant, fragmented)
   makes it a recovery hazard. TOTP, passkeys, HIBP, and CAPTCHA are all Better Auth
   *plugins* that are **structurally impossible on managed Neon Auth** — self-hosting is what
   unlocks them. **[VERIFIED]** https://neon.com/docs/auth/guides/plugins
5. **Do the migration NOW, greenfield.** No deployed database, no real users → data-migration
   cost is **zero**. Blast radius is small and mechanical: three route handlers added, three
   `neon-auth.ts` + client files rewritten, one dependency removed, one appended migration.
   `@quagga/core` account logic, migration 0011, and the branded auth form all survive.
   **[VERIFIED]** https://better-auth.com/docs/integrations/next ·
   https://better-auth.com/docs/installation

**Total cost — blunt version:**

- **The auth stack itself is $0.** Better Auth + all plugins (passkey, two-factor, HIBP,
  CAPTCHA) are MIT/open-source with **no per-MAU fee** — a real saving vs managed Neon Auth's
  MAU tiers. Auth tables live in the Neon DB we already run. **[VERIFIED]**
- **HIBP breach check: free** (range API, no key, no rate limit). **Cloudflare Turnstile
  CAPTCHA: free** (Turnstile free plan; **no hard volume cap is published for standard use** — do
  NOT treat ~1M solves/mo as a guaranteed verified threshold, and note Cloudflare could change
  terms, with a steep free→Enterprise jump). **CI: free** — public-repo GitHub Actions standard runners
  are *unmetered*; CodeQL, gitleaks, trufflehog all free on public repos. **Observability:
  free** on Grafana Cloud's free tier (10k metric series / 50GB logs / 50GB traces, **14-day
  retention**). **[VERIFIED]**
- **What is NOT free / has a threshold:** the **custom apex domain** (a real annual
  registration cost — the one unavoidable paid line, and a hard blocker for SSO *and*
  cross-app passkeys); **Neon free tier** is 0.5GB / 100 compute-hrs / 10 branches per project
  — aggressive branch-per-PR CI can exhaust the 10-branch include (then $1.50/branch-mo);
  **Vercel plan** — WAF custom rate-limit rules and possibly Protection-Bypass-for-Automation
  (needed for Playwright-against-preview) are Pro-only ($20/user/mo), and Hobby is
  non-commercial-use; **Grafana** past 14-day retention or 10k series costs money (we stay
  under at hundreds of users); **Upstash Redis** only if we outgrow DB-backed rate limiting
  (free to 500K commands/mo). **[VERIFIED]**
- **The invisible cost is operational.** Self-hosting transfers uptime, key custody,
  breach-blocklist, rate-limiting, **and CVE-patching** responsibility from Neon to us. Better
  Auth has a demonstrated history of high-severity auth advisories (trustedOrigins ATO
  GHSA-vp58-j275-797x; email-verify open-redirect GHSA-8jhw-6pjj-8723) that managed Neon
  patched for us silently. For a volunteer-run non-profit holding POPIA-hard-locked PII, that
  burden is real and must be owned deliberately. **[VERIFIED]**
  https://github.com/better-auth/better-auth/security/advisories/GHSA-vp58-j275-797x ·
  https://github.com/better-auth/better-auth/security/advisories/GHSA-8jhw-6pjj-8723

**Honest effort estimate — a sum of the §12 t-shirt sizes, not a separately-invented range.**
The research only ever gave t-shirt sizes (trivial/small/medium/large) and **no day counts**; the
day conversion here is the spec's own inference, applied consistently with the §12 legend
**S ≈ <1d (≈0.5–1d), M ≈ 1–2d, L ≈ 3–5d**. These figures are re-derived directly from the §12
phased table so the two sections cannot disagree. **[INFERRED sizing]**

- **Phase 0 (before kickoff demo): ~7–14 days** — 4 M + 6 S (§12). Core swap (package + config +
  three route handlers + client rewrite + one migration), 1.5 breaking-change absorption +
  re-greening the gate, and branded reset/verify views.
- **Phase 1 (before real users): ~21–40 days** — 2 L + 11 M + 8 S (+1 external, no eng size)
  (§12): TOTP + backup codes, security hardening, CI regression guards (**L, ~3–5d**),
  observability wiring (**L, ~3–5d** — those two L tasks alone are ~6–10 days), auth-flow tests,
  POPIA engineering artefacts, and the account surfaces the accounts-security-spec left as open
  seams. The external POPIA org/legal artefacts (P1-19b: Information Officer registration, PAIA
  manual) are **not** in this day range — they are a Regulator/organisational process with its
  own lead time (§8.7, decision 16).
- **Phase 2 (before third-party IdP): ~10–17 days** — 2 L + 2 M + 3 S (§12), separately deployed,
  revisited when Part 2 revives.

Total to a defensible "real users" state: **~28–54 engineering days** — the sum of Phase 0
(~7–14) and Phase 1 (~21–40) t-shirt sizes. This is a wide range because it is a t-shirt sum, not
a measured estimate: treat the spread as genuine uncertainty. (The earlier ~12–21-day headline
was inconsistent with the §12 table and is corrected here.)

**The single most dangerous silent regression in the whole migration** is rate-limit storage:
Better Auth's default in-memory store is per-lambda on Vercel and effectively non-functional
against credential stuffing. If we self-host without setting `rateLimit.storage:'database'`,
account-lockout protection **quietly does not exist while appearing configured.** This is the
highest-value, easiest-to-miss config in the move. **[VERIFIED]** (§6, §9)
https://better-auth.com/docs/concepts/rate-limit

---

## 2. ARCHITECTURE

### 2.1 Topology — shared config, mounted per app

Create **`@quagga/auth`** exporting one `betterAuth()` config:
`drizzleAdapter(db, { provider: 'pg', schema })`, `emailAndPassword`, `socialProviders`
(Google), and plugins. Each app adds `app/api/auth/[...all]/route.ts` via
`toNextJsHandler(auth)` and calls `auth.api.*` directly server-side. All three point the
adapter at the **same Neon database** → one account pool. Because Better Auth is stateless
per-request (it reads the DB), running N copies against one DB is the *intended* shape, not a
workaround. **[VERIFIED]** https://better-auth.com/docs/integrations/next

**Do NOT** adopt the "one app hosts `/api/auth`, others point `baseURL` at it" proxy shape —
it forces cross-origin HTTP for every server-side authz check, breaks the `@quagga/core`
server-enforced predicate pattern (AGENTS.md rule 7), and reintroduces the exact "auth is a
remote REST service" friction we have with managed Neon today. **[VERIFIED]**

**Vercel specifics [VERIFIED]** (https://better-auth.com/docs/concepts/cookies ·
https://better-auth.com/blog/1-5):
- All three Vercel projects **must share the identical `BETTER_AUTH_SECRET`** — a cookie
  signed by one app must verify in another. A drifted env silently logs users out. Needs a
  documented single source (Vercel team env or a runbook step). **This is risk #1 of the
  whole design** and the observability layer must alert on its symptom (§7).
- Set `baseURL` per app (its own domain); 1.5's dynamic base-URL resolution helps with Vercel
  preview URLs. `trustedOrigins` must enumerate all three production origins plus preview
  patterns — **explicit absolute URLs only, never wildcards** (the documented bypass class
  targets wildcard/scheme-less `callbackURL`).
- Google/social OAuth callbacks are **per-origin**. Either register a redirect URI per app, OR
  funnel all social sign-in through `apps/web` and rely on the shared cross-subdomain cookie
  to log the user into the others. **[Decision — §11]**

### 2.2 Apex domain, cookies, and sessions

- **Custom apex is mandatory.** Cross-subdomain SSO needs
  `advanced.crossSubDomainCookies = { enabled: true, domain: '<apex>' }` + `trustedOrigins`.
  Cannot work on `*.vercel.app`. Cookies are httpOnly+secure by default; keep
  `sameSite: 'lax'` (current managed config) and a stable `cookiePrefix`. **[VERIFIED]**
  https://better-auth.com/docs/concepts/cookies
- **Keep DATABASE sessions** (the default), *not* stateless JWT. Database sessions give the
  revocable active-session list, revoke-one/others/all, and new-device tracking the
  accounts-security-spec relies on — pure JWT cannot revoke. **[VERIFIED]**
  https://better-auth.com/docs/concepts/session-management
- Add `session.cookieCache` (e.g. `maxAge` 300s, strategy `compact`|`jwt`|`jwe`) so
  short-lived reads come from a signed cookie while the DB stays the source of truth for
  revocation — the serverless-friendly middle ground, no Redis/persistent process. Set
  `expiresIn` (e.g. 7d) + `updateAge`. **[VERIFIED]**
  **Trade-off [VERIFIED risk]:** a revoked session can still be honoured until `cookieCache`
  maxAge expires (up to 5 min). Acceptable for most surfaces; use a shorter maxAge for
  hard-locked-PII surfaces, or set UX expectations on the "revoke" button.

### 2.3 Schema ownership — the one near-irreversible decision

- Use `drizzleAdapter(db, { provider: 'pg', schema })`. Generate table definitions with the
  Better Auth CLI (`npx @better-auth/cli generate` on 1.4.x; `npx auth generate` on 1.5+) —
  it **emits Drizzle table code**; hand-place those tables into `packages/db/src/schema.ts`,
  then `pnpm --filter @quagga/db db:generate` produces the append-only SQL migration. **Do
  NOT use Better Auth's own `npx auth migrate`** — that is Kysely-only and never touches a
  Drizzle project, so it cannot fight our migration discipline. `packages/db` stays the single
  schema owner (AGENTS.md rule 2). **[VERIFIED]**
  https://better-auth.com/docs/adapters/drizzle · https://better-auth.com/docs/concepts/cli
- Core tables: `user`, `session`, `account`, `verification`, plus one per plugin (`twoFactor`,
  `passkey`, and later `oauthApplication`). Each new plugin = new tables = one appended
  migration. Naming is fully customisable via `usePlural`, per-model `modelName`, per-field
  `fields`, or column `fieldName`. **[VERIFIED]**
- **THE decision to make before generating tables:** does Better Auth's `user` table *become*
  our existing app users table (map `modelName: 'users'`, declare app columns as
  `additionalFields`), or sit beside it joined by id? Given `users.sanitized_at` (migration
  0011), rich profile data, and the `@quagga/core` sanitization plan, the cleanest split is
  usually: **Better Auth owns a lean identity `user` table; app/profile data lives in our own
  table keyed by the same user id.** Near-irreversible; touches every downstream FK and the
  Lost-Cat deletion plan. **[VERIFIED as a design fork — §11]**
  https://github.com/better-auth/better-auth/blob/main/packages/core/src/db/adapter/get-field-name.ts

### 2.4 Version & secrets

- **Adopt 1.5.x** (1.5.0 released 28 Feb 2026; Context7 lists later 1.6.x tags e.g. 1.6.23 —
  confirm newest stable + React 19 / Next 16 compat at install). Budget for 1.5 breaking
  changes: `InferUser`/`InferSession` removed, `getMigrations` moved to
  `better-auth/db/migration`, API Key plugin moved to `@better-auth/api-key`
  (`userId`→`referenceId`), `/forget-password/email-otp` removed, after-DB-hooks now run
  post-transaction. **AGENTS.md rule 3 must be rewritten** to pin whatever 1.5/1.6 we
  validate — not silently violated. The gate `pnpm turbo run lint typecheck test build` re-run
  is the acceptance criterion. **[VERIFIED]** https://better-auth.com/blog/1-5
- `BETTER_AUTH_SECRET`: `openssl rand -base64 32` (min 32 chars), identical across all three
  projects. **1.5 versioned-secret rotation**
  (`secret: [{version:2,value:NEW},{version:1,value:OLD}]`) rotates **without logging everyone
  out** — new data signs with the current entry, verification tries all, legacy bare-hex data
  falls back; data lazily re-encrypts on next write. On 1.4.18 (single secret) rotation forces
  a global logout. For a volunteer team that can't babysit a rotation, this is a concrete extra
  reason to run 1.5+ — and it is the containment primitive the incident runbooks depend on
  (§8.5). **[VERIFIED]** https://better-auth.com/docs/reference/security

### 2.5 Email seam (reuse Resend, no new infra)

Wire `betterAuth()` callbacks to the existing `@quagga/core` security-notification builders +
Resend sender: `emailAndPassword.sendResetPassword`, `emailVerification.sendVerificationEmail`,
`onPasswordReset` (password-changed notice), and `user.changeEmail.sendChangeEmailVerification`.
**Self-hosting finally unlocks server-side change-email** (absent from managed Neon's allowlist
— accounts-security-spec probe). The 48h email-change revocation window and POPIA sanitization
stay in `@quagga/core`; Better Auth owns the identity-side token, our code owns the app-side
state machine. **[VERIFIED]** https://better-auth.com/docs/authentication/email-password ·
https://better-auth.com/docs/concepts/email

### 2.6 Neon branch-preview identity — the con that was BACKWARDS

The earlier analysis (platform-architecture-spec: "Option B loses branch identity / preview
auth") is **INCORRECT for self-hosted-in-our-own-DB and should be struck.** A Neon branch is a
copy-on-write clone of the *entire* database — all schemas, all tables, all rows. If
self-hosted auth tables live in our Neon DB, every preview/dev branch automatically contains a
full, isolated copy of the auth tables *and* their user/session rows, for free, by the same
mechanism that branches app tables. Neon's own docs say this for managed auth ("Users,
sessions, and auth configuration … branch with your data"); self-hosted gets the same benefit
more cleanly — a Vercel preview just needs `DATABASE_URL` pointed at the branch (Neon's Vercel
integration does this) and `betterAuth()` reads that branch. **[VERIFIED]**
https://neon.com/docs/introduction/branching · https://neon.com/docs/auth/overview

---

## 3. AUTHENTICATION METHODS LADDER

**Recommended default for a non-technical, Android-dominant, device-fragmented volunteer base:**

> **Password (15+ char, breach-checked) primary + email-OTP / magic-link low-friction fallback
> + TOTP with backup codes as an opt-in second factor + passkeys as an optional
> progressive-enhancement accelerator.** Passkey-*first* is deferred.

Justification **[VERIFIED]**:

1. **Password + optional passkey, not passkey-first.** The sign-in field carries
   `autocomplete="username webauthn"` (the `webauthn` token MUST be last) so users who *have* a
   passkey get one-tap conditional-UI autofill, while everyone else uses the familiar password
   / email-OTP path. On mount, feature-detect then preload:
   `if (PublicKeyCredential.isConditionalMediationAvailable?.()) authClient.signIn.passkey({ autoFill: true })`.
   After first sign-in, a dismissable "add a passkey for faster sign-in" prompt.
   https://web.dev/articles/passkey-form-autofill
2. **Why not passkey-first:** it concentrates the recovery problem on a mostly-Android,
   budget-device, high-fragmentation base (global Android ~67% / iOS ~33%; SA skews further to
   Android; older builds like Android 11 still ~10%+ share). Conditional UI, cross-device
   hybrid sign-in, and sync each have narrower support boundaries. **[VERIFIED directionally;
   exact SA per-version percentages could NOT be pinned to an authoritative SA source —
   INFERRED from Africa-wide Android fragmentation data]**
   https://mojoauth.com/blog/passkey-support-matrix-browser-os-feature-support ·
   https://www.corbado.com/passkey-benchmark-2026/web-passkey-readiness
3. **TOTP alongside passkeys, not instead of.** The `twoFactor()` plugin bundles TOTP,
   email-OTP-as-2FA, and backup codes. TOTP works on the widest device range and is the
   pragmatic fallback for older Android. **Offer both.**
   https://better-auth.com/docs/plugins/two-factor

**Passkey specifics [VERIFIED]** (https://better-auth.com/docs/plugins/passkey):
- `@better-auth/passkey` plugin (separate package, keeps WebAuthn deps out of the base bundle),
  one `passkey` table (id, name, publicKey, userId FK, credentialID, counter, deviceType,
  backedUp, transports, aaguid) owned by `packages/db`. Runs cleanly on Vercel serverless — the
  WebAuthn challenge is stored in a **signed cookie** (`better-auth-passkey`), not server
  memory, so no persistent process.
- **`rpID` MUST be the shared apex registrable domain, set from day one.** A passkey scoped to
  the apex works on every subdomain; a passkey scoped to a subdomain will NOT work on the
  others and **cannot be widened without re-enrolling every user** — rpID is effectively
  un-migratable once users enrol. rpID (WebAuthn credential layer) is *separate* from
  `crossSubDomainCookies` (session cookie layer) — configure BOTH to the same apex. Truly
  different registrable domains would need Related Origin Requests (`/.well-known/webauthn`,
  max 5 domains) — but our subdomain-under-one-apex plan does NOT need ROR.
  https://web.dev/articles/webauthn-rp-id
- Discoverable credentials: `authenticatorSelection.residentKey: "required"` +
  `userVerification: "preferred"` + platform authenticator for the non-technical base.
- **Open fork [VERIFIED as unconfirmed]:** whether the plugin `origin` option accepts an ARRAY
  of expected origins (as underlying SimpleWebAuthn does) or a single string. If single-string,
  the three-mounted-instances shape may need each instance to validate its own subdomain
  origin, or push toward one central auth service earlier. **Needs a spike (§11).** Also verify
  the credential counter/replay update is atomic in Postgres under concurrent sign-ins from
  different apps sharing one `passkey` table.

**TOTP / backup-code footgun [VERIFIED]:** the `twoFactor()` factory's own default IS encrypted,
but the raw `backupCodeOptions` sub-option defaults to `storeBackupCodes: "plain"` — so **set it
to `"encrypted"` explicitly** rather than relying on the default, because plaintext recovery codes
in our Neon DB would be a POPIA and security failure. The plugin's built-in `accountLockout`
(10 fails → 15 min) and rate limit (3 req/10s) apply to the **`/two-factor/*` verification
endpoints only** — this is NOT sign-in lockout. General credential-stuffing lockout on password
sign-in (the spec's ≤10-consecutive-failure rule) remains **our own logic to build and test**
(§6, P1-6): do not read this line as "sign-in lockout ships for free" and skip P1-6.
`allowPasswordless: true` lets passkey-only users still manage 2FA.
https://better-auth.com/docs/plugins/2fa

**Recovery is the true assurance ceiling [VERIFIED]:** never let a single passkey be the only
recovery path. Layer: (1) nudge a *second* passkey at enrolment (enforce for org/god accounts);
(2) backup codes; (3) email-OTP/magic-link as last resort — but an account recoverable by email
alone is only AAL1 on recovery. **For hard-locked-PII surfaces (phone, emergency contacts,
ID/passport, medical) require a strong factor, not just an email link, before exposure.** NIST
SP 800-63B-4: synced passkeys = AAL2 (phishing-resistant, provided the sync fabric is
MFA-protected); device-bound = AAL3-capable. AAL2 via synced passkeys is the right target for a
volunteer non-profit. https://www.corbado.com/blog/nist-passkeys

**Managed-Neon comparison [VERIFIED]:** managed Neon Auth *does* support email-OTP and
magic-link (both on its allowlist), so the low-friction passwordless fallback is achievable
even without moving. But **2FA/TOTP, backup codes, passkeys, HIBP, and CAPTCHA are all plugins
that are impossible on managed** — that gap is the core reason to self-host.
https://neon.com/docs/auth/guides/plugins

---

## 4. MIGRATION PLAN — off managed Neon Auth

**The greenfield "do it now" argument [VERIFIED]:** no deployed database, no real users → data
-migration cost is **zero**. The same move after launch means migrating live identity + session
rows and re-enrolling any passkeys against a corrected rpID. Do it before the kickoff demo.

**Steps [VERIFIED]** (https://better-auth.com/docs/integrations/next ·
https://better-auth.com/docs/installation):

1. Add `better-auth` (1.5.x) + `@better-auth/drizzle-adapter` (+ `@better-auth/passkey`;
   two-factor is core) to a new **`@quagga/auth`** package.
2. Generate the auth tables via the CLI, place them in `packages/db/src/schema.ts`, run
   `db:generate` → **one appended migration**. Make the identity-vs-profile boundary decision
   (§2.3) *before* this step.
3. Define the shared `betterAuth()` config: `drizzleAdapter`, email/password, Google social,
   `crossSubDomainCookies`, Resend callbacks, `cookieCache`, plugins (twoFactor, passkey,
   haveIBeenPwned, captcha), rate-limit `storage: 'database'`.
4. In each app add `app/api/auth/[...all]/route.ts` via `toNextJsHandler`.
5. Replace `lib/auth-client.ts` with `createAuthClient` from `better-auth/react` (+ plugin
   clients: `passkeyClient`, `twoFactorClient`).
6. Replace the `@neondatabase/auth` `AuthView` usage in `app/auth/[...path]/page.tsx`. Our
   branded `AuthForm` already handles sign-in/sign-up; build reset/verify views ourselves
   (`apps/web/app/auth/forgot-password` + `reset-password` already exist).

**What DELETES [VERIFIED]** (confirmed present in the repo):
- `apps/{web,org,suppliers}/lib/neon-auth.ts` (the `createNeonAuth` files).
- The `@neondatabase/auth` imports in each `lib/auth-client.ts` and the `AuthView` import in
  the auth pages.
- The `@neondatabase/auth` dependency itself.
- The `NEON_AUTH_BASE_URL` / `NEON_AUTH_COOKIE_SECRET` env wiring in each `lib/config.ts` and
  in `turbo.json` globalEnv → replaced by `BETTER_AUTH_SECRET` + reuse of `DATABASE_URL`.
  Update each `isAuthConfigured()` to probe `BETTER_AUTH_SECRET`.

**What SURVIVES unchanged:** `@quagga/core` account logic (account-security,
account-sanitization, security-notifications), migration 0011, the branded auth form.

**Rules to honour during the swap [VERIFIED]:** AGENTS.md rule 4 (env-less boot) — keep the
build-time placeholder-secret pattern so all three apps still boot to a graceful "not
configured" state. AGENTS.md rule 1 — no migrate step enters any build script. AGENTS.md rule 3
— rewrite the better-auth pin to the validated 1.5/1.6 version rather than deleting the pin.

**Capability layer cleanup [VERIFIED as open question — §11]:** once self-hosted,
2FA/passkeys/change-email all become native, so `assertCapability('emailChange')` and the
`AUTH_CAPABILITIES` table may become dead code. Decide whether to flip every entry to
`supported` and retire the probe layer, or keep it as a defence-in-depth seam **and reuse it as
a kill-switch surface** (§8.6).

---

## 5. CI REGRESSION SUITE (GitHub Actions)

**Free-tier reality [VERIFIED]:** the repo is public, so standard `ubuntu-latest` runners are
**unmetered** — the private-repo 2,000 min/mo cap does not apply. The whole pipeline costs $0
on standard runners; the only real budget is Neon compute-hours (main+nightly only) and
wall-clock. **CodeQL is also free** for public repos and should be enabled.
https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions ·
https://github.com/github/codeql-action

### 5.1 DB engine for integration tests [VERIFIED]

Two-tier: (1) default DB integration tests to **PGlite** (`drizzle-orm/pglite`) — in-process
WASM Postgres, no Docker, ms startup, free; works because our sensitive columns are AES-GCM'd in
Node (`packages/db/src/crypto.ts`), not via pgcrypto, so there is no server-extension dependency
to emulate. (2) Add **one** Neon-branch / Neon-Local "driver-fidelity + migration-apply" job
that applies committed migrations to an empty DB and smoke-queries through the real
`@neondatabase/serverless` drivers. https://orm.drizzle.team/docs/connect-pglite ·
https://neon.com/docs/guides/branching-github-actions
**Caveat [VERIFIED]:** PGlite uses a *different* Drizzle driver than production (`pglite` vs
`neon-http`/`neon-serverless`), so it validates schema/query/authz logic but NOT the neon HTTP
no-transactions quirk or WebSocket pool behaviour — the Neon-Local job is required to cover the
transport. Transaction-heavy atomicity (sanitization, privilege-escalation guards) must also
run on Neon-Local, where a genuine WebSocket pool + real BEGIN/COMMIT exist. PGlite runs
Postgres single-user; v0.4+ (Mar 2026) added connection multiplexing but do not assert
HTTP-driver no-transaction behaviour on it.

### 5.2 The three workflows [VERIFIED]

- **PR (fast, blocking):** `pnpm turbo run lint typecheck test build` (switch install to
  `--frozen-lockfile` — currently `--no-frozen-lockfile` with a TODO) + Vitest incl. the
  regression guards below (PGlite for DB) + `pnpm audit` + gitleaks + CodeQL PR analysis + the
  **better-auth pin-guard** (assert the pin string still equals the validated version). Gate
  behind `concurrency` groups to cancel superseded runs.
- **main (post-merge):** same gate + Neon-Local/Neon-branch migration-apply + driver-fidelity
  integration job. **Neon-branch quota mitigation [VERIFIED]:** the Neon free tier is
  **100 compute-hrs + 10 branches per project/month** — so the CI branch job **MUST delete its
  branch on run completion and use scale-to-zero**, or run **Neon-Local** (Docker service, which
  consumes no branch from the 10-branch include), to avoid exhausting the cap (then $1.50/branch-
  mo). This is the concrete mitigation for the branch-exhaustion risk flagged in §1.
- **nightly (scheduled):** full Playwright E2E against a fresh Vercel preview (sign-up → verify
  → sign-in → 2FA → passkey → reset → delete-grace, using the `agent-inbox` skill for email +
  Better Auth's `getOTP`; WebAuthn via Playwright's CDP virtual authenticator), trufflehog
  full-history verified scan, `pnpm audit` trend. (CodeQL full scan runs on a **weekly** cadence,
  not nightly — see §5.4.)
  **Preview-URL wiring [VERIFIED]:** obtain the preview URL by triggering E2E on the GitHub
  **`deployment_status` event** (Vercel fires it per deploy with the preview URL in the payload)
  rather than racing the build; `patrickedqvist/wait-for-vercel-preview` polling is the fallback.
  **Gotcha [VERIFIED]:** Vercel Deployment Protection silently hangs Playwright unless the
  Protection-Bypass-for-Automation secret (`x-vercel-protection-bypass` header) is sent —
  and whether that bypass is free on Hobby is unconfirmed (§11).

Caching: keep `actions/setup-node` `cache: pnpm`; add turbo caching (Vercel Remote Cache, free,
or `actions/cache` on `.turbo`).

### 5.3 Regression guards (drive tests off the source-of-truth enums)

- **Authz completeness [VERIFIED]:** table-driven matrix over `PROJECT_PERMISSION_KEYS`
  (`view_member_details`, `manage_questionnaires`, `assign_roles`, `manage_roles`,
  `manage_members`) × role-shapes asserting (a) default-deny for non-backstop empty-grant
  members, (b) lead/admin/god backstop returns true irrevocably, (c) implications
  (`manage_roles`⇒`assign_roles`; `canManageQuestionnaireAudience` denies blocking-without-
  mayBlock and out-of-scope targets). **Plus a completeness meta-test** iterating
  `ProjectPermissionKey.options` (the Zod enum) that fails the build if any key is missing from
  the matrix — the guard that makes adding a privilege without a deny-by-default test a red
  build. This generalises the existing `privacy.test.ts` `HARD_LOCKED_PRIVATE_FIELDS`
  length-pin pattern. (`packages/core/src/project-permissions.ts`)
- **PII projection boundary [VERIFIED]:** drive off `HARD_LOCKED_PRIVATE_FIELDS` — build a
  fully-populated bio, run it through EVERY public projection (bio public projection from
  `BIO_FIELD_CATALOG` in `bio.ts`, directory/type-ahead/officer-org projections) and assert no
  hard-locked key appears; a catalog-integrity test asserting `locked === true` for every
  hard-locked key; assert `officerContactVisibleToOrg` is the only phone-surfacing path
  (`{isOfficer:true, consent:'accepted'}`). Register projections in one array and iterate so a
  new unregistered projection is caught. (`packages/core/src/privacy.ts`, `bio.ts`,
  `officers.ts`)
- **Route authz census [INFERRED — bespoke, needs its own tests]:** a Vitest test that globs
  `apps/*/app/**/route.ts` + server actions and fails any that neither call a known
  `@quagga/core` authz predicate NOR appear in an explicit reviewed `PUBLIC_ROUTES` allowlist.
  Converts "did someone remember the check" into a mechanical failure. **The allowlist needs
  human curation — consider a second-approver policy so "make it public" can't be a silent
  one-line diff (§11).**
- **Migration safety [INFERRED — bespoke]:** (a) append-only —
  `git diff --name-status origin/main...HEAD -- packages/db/migrations` fails on M/D of any
  existing migration or `_journal.json` entry; (b) sync — `db:generate` on clean checkout
  produces no diff (plus `drizzle-kit check`); (c) apply — `drizzle-kit migrate` against empty
  branch succeeds and is idempotent. **Base-ref handling needs care** — this repo had a history
  rewrite (24 Jul 2026), which breaks naive `origin/main...HEAD`.
- **No-migrate-in-build [VERIFIED]:** grep every `package.json` build script + `turbo.json`
  build task and fail on any `drizzle-kit migrate`/`db:migrate` reference (AGENTS.md rule 1).
- **Better Auth flow tests [VERIFIED]:** use
  `getTestInstance(options, {testWith:'postgres'})` — its `ctx.test` helpers give `login()`,
  `getOTP()`, `getCookies()` (Playwright-shaped, for injecting a session and skipping slow UI
  login). Test: sign-in sets cookie; session list/revoke; reset invalidates all sessions;
  verification token single-use; and the managed-impossible set — 2FA enrol+verify+backup,
  passkey register, change-email with the 48h window.
  https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/test-utils/test-instance.ts

### 5.4 Supply chain [VERIFIED]

`--frozen-lockfile`; pin-guard test on the better-auth override; `pnpm audit` (gate on
high/critical); GitHub native secret scanning + push protection; gitleaks (PR + pre-commit);
trufflehog (nightly full-history verified — matters because the repo history was rewritten once
to purge secrets); CodeQL (`javascript-typescript`, PR + weekly full). Renovate/Dependabot with
a cooldown (`minimumReleaseAge`/`cooldown`) to dodge freshly-published compromised versions
(Spring 2026 npm/pnpm worm incidents Miasma/TeamPCP), and ignore/pin better-auth +
`@radix-ui/react-slot` from auto-bumps. **Note [VERIFIED risk]:** `minimumReleaseAge` is a
pnpm 11 default; repo is on pnpm 10.30.0 — confirm 10.x honours it or plan the bump.
https://christian-schneider.net/blog/dependency-cooldowns-supply-chain-defense/

### 5.5 Sequencing note [VERIFIED conflict — §11]

Most auth-flow tests (2FA/passkey/change-email) are **meaningless on managed Neon Auth** — the
capabilities refuse. Recommended: build the provider-independent guards (authz matrix, PII
projection, route census, migration safety, no-migrate-in-build, pin-guard) **now**, and add
the auth-flow E2E **at migration time**.

---

## 6. SECURITY HARDENING CHECKLIST

- **Rate limiting [VERIFIED — the highest-value, easiest-to-miss config]:** enable Better
  Auth's limiter with `storage:'database'` (writes to a rate-limit table in our Neon DB) — do
  **NOT** use the default `memory` storage: each Vercel Lambda gets its own ephemeral memory,
  so an in-memory counter is per-instance and effectively resets, letting an attacker spread
  attempts across instances. Keep shipped rules (`/sign-in/email` = 3 req/10s;
  `/request-password-reset` likewise). Periodically prune expired rows (issue #4472: keys can
  accumulate without TTL cleanup). Rate limiting is **off in dev by default — must be explicitly
  on in production.** Upstash Redis secondary storage only if DB write volume grows.
  https://better-auth.com/docs/concepts/rate-limit ·
  https://github.com/better-auth/better-auth/issues/4472
- **Account lockout [VERIFIED]:** the limiter throttles but does NOT lock out. The spec's
  ≤10-consecutive-failure lockout is **our logic to build and test** on top.
- **Breach blocklist [VERIFIED]:** `haveIBeenPwned` plugin (k-anonymity — first 5 SHA-1 chars
  only, full password never leaves the server; free, no key, no rate limit; enable response
  padding 800–1000 records). Do NOT ship a bundled local list. Adds ~100–300ms to
  password-set/sign-up — **define failure behaviour for a HIBP outage: fail-open on
  availability, never fail-open on match.** https://better-auth.com/docs/plugins/have-i-been-pwned
- **Enumeration safety [VERIFIED]:** sign-in and reset are generic by default. **Sign-up is
  only enumeration-safe when `emailAndPassword.requireEmailVerification:true`** — the default
  posture is easy to miss and silently violates the spec. Set it (it also matches the supplier
  sign-up flow). https://better-auth.com/docs/authentication/email-password
- **CSRF / callbacks / reset-poisoning [VERIFIED]:** CSRF handled by default (Origin-header +
  SameSite=Lax + Sec-Fetch). Set `trustedOrigins` tightly (absolute URLs, no wildcards); NEVER
  set `advanced.disableCSRFCheck`. `callbackURL` is validated against `trustedOrigins` — the
  historic bypass (GHSA-vp58-j275-797x, CVSS 7.1, one-click ATO) was fixed in 1.1.21; staying
  patched is the control. Session fixation is not a default gap (fresh token on login, sessions
  server-side). Set `baseURL` explicitly (prevents Host-header reset poisoning) and **enable
  `revokeSessionsOnPasswordReset:true` — it defaults to FALSE**, and the spec requires all
  sessions invalidated on reset. https://better-auth.com/docs/reference/security
- **Security headers + CSP [VERIFIED]:** Next adds none by default. Ship
  `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`, a locked-down `Permissions-Policy`
  (camera/microphone/geolocation/payment), and a per-request **nonce CSP**
  (`script-src 'self' 'nonce-<n>' 'strict-dynamic'; object-src 'none'; base-uri 'self'`)
  generated in middleware (renamed "Proxy" in Next 16) and passed via `x-nonce`. **Trade-off:**
  nonce CSP forces dynamic rendering (disables static/ISR) — fine for auth-gated shells; use the
  experimental SRI path for any public/marketing route that must stay static.
  https://nextjs.org/docs/app/guides/content-security-policy
- **CAPTCHA [VERIFIED]:** Cloudflare Turnstile via the `captcha` plugin on `/sign-up/email`
  (default also covers `/sign-in/email`, `/request-password-reset`; client sends token in an
  `x-captcha-response` header). Free plan with **no published hard volume cap for standard use**
  (do not bank on ~1M solves/mo as a guaranteed threshold; Cloudflare could change terms and the
  free→Enterprise jump is steep — **[VERIFIED risk]**), privacy-friendly, invisible for most
  users — fits the "calm UX" product law and POPIA (no data to Google, unlike reCAPTCHA).
  Plugin is self-host-only. https://better-auth.com/docs/plugins/captcha
- **Vercel platform [VERIFIED]:** treat built-in DDoS mitigation as baseline only. Vercel KV
  was discontinued (migrated to Upstash Redis Dec 2024). Prefer Neon-DB rate-limit storage
  first; Upstash only if DB write volume grows (free to 500K commands/mo, then $0.20/100K).
  Vercel WAF custom rate-limit rules are Pro+. https://vercel.com/docs/redis
- **Dependency posture [VERIFIED]:** self-hosting *improves* this — it removes the
  `@neondatabase/auth 0.4.1-beta` wrapper for the plain pinned library, and gives us version
  control managed Neon does not (a bad managed internal build would be un-opt-out-able).
  Subscribe to the better-auth GHSA feed; never auto-upgrade auth; keep the plugin set minimal.
  **But** self-hosting inherits the CVE-patch treadmill (§1, §9) — document the emergency
  un-pin procedure and name a GHSA-watch owner.
- **Encryption-at-rest hardening [VERIFIED — from POPIA §19, see §8.4]:** AES-256-GCM is
  sufficient as the primitive; the real risk is key management. The current scheme collapses to
  a single shared `PGCRYPTO_KEY` with a static scrypt salt and **no rotation path** — design an
  **envelope/versioned-key scheme now** (store a key-id prefix on each ciphertext) so a leaked
  key can be rotated without a migration nightmare, and protect `PGCRYPTO_KEY` at least as hard
  as `BETTER_AUTH_SECRET`.

---

## 7. OBSERVABILITY

*(Full domain — the earlier draft had only the first two findings; this is the complete panel-
by-panel dashboard, alert routing, and the crux of how telemetry escapes Vercel serverless.)*

### 7.1 Backend — Grafana Cloud Free, not self-hosted, not Vercel Observability Plus [VERIFIED]

Use **Grafana Cloud Free** as the single observability backend (metrics + logs + traces +
synthetics + profiles in one free account, no credit card). **Do NOT self-host the
Prometheus/Loki/Grafana (LGTM) stack** — Vercel is serverless, and there is no free always-on
box that can reliably hold a Prometheus TSDB + Loki at the uptime you'd want; self-hosting means
paying for and operating a separate persistent box, the opposite of near-free for a volunteer
team. **Do NOT pay for Vercel Observability Plus** ($10/mo add-on, Pro-only) for auth
monitoring.

Free-tier envelope (verified 2026): **10,000 active metric series, 50 GB logs/mo, 50 GB
traces/mo, 50 GB profiles/mo, 14-day retention on everything, 3 seats**, plus k6 (500 VUh) and
synthetic monitoring. At hundreds of users an auth workload stays far under all limits → $0.
Paid only above 10k series (~$6.50 per 1k extra) or past 14-day retention. Vercel Hobby gives
only ~10k observability events/mo with short retention; the useful tier is Pro-only.
**The one real limiter is 14-day retention** — fine for incident response and "is credential
stuffing happening *now*", NOT for quarterly trend/capacity analysis or a campaign investigated
3 weeks later. **[VERIFIED]** https://grafana.com/products/cloud/free-tier/ ·
https://vercel.com/docs/observability/observability-plus
**Mitigation [INFERRED]:** export daily digest *summaries* (counts) to a cheap long-lived store
if longitudinal analysis is needed; do not treat the free backend as your system of record.

### 7.2 CRUX — how telemetry escapes Vercel serverless [VERIFIED]

**Push OTLP over HTTP directly from the Next.js runtime** to Grafana Cloud's OTLP gateway
(`https://otlp-gateway-<region>.grafana.net/otlp`, auth via
`OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Basic <base64 instanceID:token>'`). This sidesteps
two dead ends:

1. **Prometheus scraping cannot reach ephemeral serverless functions.** There is no stable
   target to pull and no cumulative counter state across invocations — you need *delta*
   temporality and a *push* model. OTel is push-based and works "behind firewalls, in
   serverless environments"; Prometheus is pull/scrape with no delta concept, so it is the
   wrong tool against FaaS.
2. **Vercel Log Drains are Pro-plan-only** — not a free path to ship logs off Vercel.
   Direct in-function OTLP push is free on Hobby and more reliable.

**IMPORTANT verified caveat:** `@vercel/otel` emits **TRACES only** out of the box — "the
no-code configuration currently only works for tracing, not metrics." So use `@vercel/otel` for
request/auth-endpoint traces + latency, but auth **metrics and logs must be pushed by us**: an
OTLP exporter with **delta temporality**, **SimpleSpanProcessor-style immediate export** (no
batching/BatchSpanProcessor delay), **HTTP transport**, **low span counts**, and an **explicit
flush before the handler returns** (serverless can't hold cumulative counters between invocations,
and anything batched or held is exactly what drops when a function returns before flush — the
immediate-export + HTTP-transport combo is the part most likely to be gotten wrong).
**[VERIFIED]** https://vercel.com/docs/tracing/instrumentation ·
https://www.npmjs.com/package/@vercel/otel · https://github.com/vercel/otel/issues/192

**Design recommendation [INFERRED, grounded in the codebase]:** treat **structured JSON log
lines in Loki as the primary signal source** and compute the dashboard metrics with **LogQL**
(`count_over_time` / `rate` over labelled JSON), rather than maintaining OTel counters across
ephemeral invocations. Neon's managed Better Auth exposes no native Prometheus/OTel metrics
endpoint, so a log-derived model is both simpler and more robust here. Reserve true OTel metrics
for endpoint latency histograms via traces. **[INFERRED]**

### 7.3 Structured logging + cross-app correlation + redaction [INFERRED best-practice]

Emit single-line JSON from all three apps with a shared schema:
`{timestamp, app, event, outcome, request_id, session_id (hashed), user_id (opaque, never
email), route, latency_ms, err_code}`. Generate/propagate a `request_id` (accept an incoming
W3C `traceparent` from `@vercel/otel`, else mint one) and stamp it on every log line AND return
it in responses, so a flow crossing apps (e.g. a supplier action hitting shared `@quagga/core`)
is traceable end-to-end. Label by `app` + `event` for LogQL.

**REDACT hard [VERIFIED against the PII the spec hard-locks]:** never log passwords, reset/verify
tokens, TOTP/backup codes, session tokens, Resend API keys, `PGCRYPTO_KEY`, or any hard-locked
PII (phone, emergency contacts, ID/passport, medical) — log opaque user ids and hashed
identifiers only. This is POPIA-relevant: logs shipped to Grafana Cloud (US region by default)
become a **cross-border data flow** (§8.3), so keep PII out entirely and/or choose an
appropriate region and document the transfer. **[INFERRED — Grafana's current region list and
whether an EU ingestion region is available on free was not verified.]**

### 7.4 Auth dashboard — panel by panel

**[INFERRED design; maps directly to accounts-security-spec principles. Query shapes are LogQL
over structured events unless noted.]**

1. **Sign-in success vs failure rate** — two series per app,
   `sum(count_over_time({app=~"web|org|suppliers", event="sign_in"} | json | outcome="success" [5m]))`
   vs `outcome="failure"`; failure ratio as a stat with a threshold.
2. **Failure-spike / credential-stuffing** — rate of `sign_in.failure` by source IP and by
   email-not-found, top-k table; the primary stuffing signal.
3. **Lockouts** — count of lockout events (our ≤10-consecutive-failure rule) over time.
4. **Password-reset volume** — `requestPasswordReset` events/hr (spike = targeted attack or
   email problem).
5. **Email delivery failures (Resend)** — count of `email.send.failure` by template (verify,
   reset, security-notification). **Critical** — a broken reset/verify email silently locks
   users out of the recovery path.
6. **Token/verification failures** — `verifyEmail` / reset-token failures, split expired vs
   invalid.
7. **Auth-endpoint latency** — p50/p95/p99 from `@vercel/otel` traces on `/api/auth/*` per app.
8. **Active session count / new-session rate** — from `listSessions`-backed events.
9. **New-device sign-ins** — once the device-fingerprint column exists (currently unwired per
   accounts-security-spec; it is the primary compromise tripwire for a camp lead — §9).
10. **2FA enrolment rate & passkey adoption** — **CURRENTLY ZERO/N/A on managed Neon Auth**
    (provider-blocked; no 2FA/passkey plugin). Keep the panels defined but expect them empty
    until self-hosted Better Auth lands them — **this empty panel is itself an argument for
    self-hosting.**
11. **HIBP dependency health** — outbound latency / error rate (informs the fail-open policy).
12. **Error budget / auth availability** — ratio of 5xx+timeouts on `/api/auth/*` vs total.

### 7.5 Alerting — what pages a human vs what is a daily digest [VERIFIED routing, INFERRED split]

Route free via **Grafana Alerting contact points** — email, Slack (webhook or bot), and Telegram
are all supported at no added cost. Telegram is the cheapest reliable "push to phone" for a
volunteer team. **Do NOT architect around Grafana OnCall** — its 2026 free-tier limits were not
confirmed; use plain contact points + notification policies for routing/severity.

**PAGE IMMEDIATELY** (near-instant, free):
- (a) auth-endpoint availability / error-budget burn — `/api/auth/*` 5xx or timeout ratio over
  threshold;
- (b) **credential-stuffing signature** — sign-in failure rate spikes above N× baseline, or many
  failures across many accounts from few IPs;
- (c) **Resend email-send failure rate spike** — a broken reset/verify email silently locks
  users out;
- (d) total auth outage — no successful sign-ins in X minutes during active hours;
- (e) uptime probe down (from synthetics).

**Sudden drop in sign-in success rate** → possible misconfiguration, especially
**`BETTER_AUTH_SECRET` drift across the three projects** (design risk #1, §2.1). Wire this alert
explicitly.

**DAILY DIGEST** (email, low urgency): lockout counts, password-reset volume, 2FA enrolment
trend (when available), new-device sign-in summary, error-budget remaining.

### 7.6 Uptime / synthetic checks [VERIFIED]

Two free layers. (1) **Grafana Cloud Synthetic Monitoring** free tier (~5 checks per sources;
confirm exact count in-console) — HTTP checks against each app's sign-in page and a lightweight
`/api/auth` health route, alerting via the same Grafana Alerting. (2) **Better Stack Free** (10
monitors @ 3-min, 1 status page, commercial use allowed) as an independent second opinion — an
external monitor matters because a Grafana-only setup can't tell you Grafana itself is down.
**AVOID UptimeRobot Free** — since Dec 2024 its free plan is restricted to personal,
non-commercial use, a poor fit and possible TOS violation for a non-profit monitoring its own
production service. https://betterstack.com/community/comparisons/better-stack-vs-uptimerobot/

**Observability open questions [carried from research]:** exact Grafana synthetic free-check
count for 2026; whether an EU/non-US Grafana ingestion region suitable for POPIA exists and at
what cost; whether logs (not just metrics/traces) are accepted over the same OTLP endpoint on
free at our volume; whether Neon's managed Better Auth exposes ANY structured auth event/webhook
to subscribe to (materially changes the effort of §7.2) — another data point for the self-host
decision.

---

## 8. COMPLIANCE (POPIA) & INCIDENT RESPONSE

*(Full domain — largely absent from the earlier draft. Grounded in cited SA legal commentary,
not legal advice; have someone with a POPIA mandate review before relying on it.)*

### 8.1 Lawful basis — choose contract / legitimate-interest, NOT consent [VERIFIED]

Do **not** ground the auth account and safety PII (phone, emergency contacts) on **consent** as
the primary lawful basis. Use POPIA **s11(1)(b)** — processing necessary to carry out the
participation agreement — and **s11(1)(d)/(f)** — protection of the data subject's / your
legitimate interests (emergency contacts and medical notes exist for on-playa safety). Reserve
**explicit consent only** for the genuinely discretionary sharing flow already isolated in the
design — the **accepted-officer registration that shares a phone with the org**. Consent is a
poor default: the responsible party bears the burden of proving valid consent and the subject may
withdraw it at any time, which would force deletion of safety-critical data mid-event. Document
the chosen basis **per field** in a processing register (§8.7). **[VERIFIED]**
https://werksmans.com/privacy-day-2026-moving-beyond-the-consent-myth-under-popia/

### 8.2 The ID / passport storage question — ANSWERED PROMINENTLY [VERIFIED]

**⚠️ Storing SA ID / passport numbers is DEFENSIBLE under POPIA only if a concrete, current
purpose can be named (s10 minimality + s13 purpose specification). The research CHALLENGES the
current design: the build-spec collects `sa_id`/`passport` on `burner_bios` but the research
found NO stated downstream use in the specs reviewed. If nothing consumes it during MVP, POPIA
minimisation says do not collect it yet.** An identity number is explicitly personal information
(s1); collecting a high-risk identifier with no live purpose is the textbook minimisation
violation and needlessly enlarges breach-notification blast radius.

Recommended options, in order **[VERIFIED]**:
1. **BEST — don't collect it until a specific feature needs it** (age/identity verification at
   gate, medical/next-of-kin matching, or a legal requirement). Defer populating the columns.
2. If a real need exists, collect it, **document the purpose**, and set a **retention limit
   (s14)** so it is destroyed after the edition.
3. **Never** use it as a login identifier or a cross-system linking key.

**Good news on s57 [VERIFIED]:** prior authorisation from the Regulator is **NOT** triggered —
s57(1)(a) only bites when a unique identifier is processed for a purpose *other* than intended
**AND** to link with data held by *other* responsible parties; AfrikaBurn using its own-collected
ID for its own purposes fails the second limb.
https://idchecker.co.za/popia-and-id-numbers/ · https://popia.co.za/section-57-processing-subject-to-prior-authorisation/

**This corrects the earlier draft's hedge.** The earlier draft said it could not assert storage
was indefensible because the report was missing; the full research now explicitly reaches the
minimisation conclusion. **Lead with: absent a named, documented purpose, do not collect the ID/
passport number.**

### 8.3 Medical notes are SPECIAL personal information — a HIGHER bar than ID [VERIFIED]

Treat `burner_bios.medical_notes` as **SPECIAL personal information (health)** under POPIA
s26/s27 — a stricter class than ID numbers. Processing is prohibited by default unless an s27
exception applies; the workable grounds are the subject's **explicit consent** (s27(1)(a)) or
processing necessary to protect a **vital interest / for medical purposes**. Actions: (1) collect
only with a clear on-screen explanation (on-playa safety); (2) **apply at least the same field-
level encryption as ID/passport — right now `medical_notes` is stored PLAINTEXT `text()` while
ID/passport are encrypted, which is backwards given medical is the higher-sensitivity class.
Fix this before any real data lands;** (3) keep it hard-locked private (already done) and in the
sanitization null-set (confirmed). **[VERIFIED]**
https://getterms.io/blog/south-africa-protection-of-personal-information-act-popia

### 8.4 Encryption-at-rest & key management [VERIFIED]

POPIA **s19** requires "appropriate, reasonable technical and organisational measures" — no
specific algorithm, so AES-256-GCM is comfortably sufficient. The exposure is **key management**:
(1) the scheme collapses to a single shared `PGCRYPTO_KEY` with no rotation path — build a
**versioned/envelope key scheme now** (key-id prefix on each ciphertext); (2) `scryptSync` with
a **static salt** means the key is fully determined by the env var — protect `PGCRYPTO_KEY` at
least as hard as `BETTER_AUTH_SECRET`; (3) **POPIA has NO encryption safe-harbour** — unlike
GDPR Art.34(3)(a), s22 has no "it was encrypted so you needn't notify" exemption, so encrypted-
then-leaked ID data may still require notification. Treat encryption as risk-reduction, not an
exemption. **[VERIFIED]** https://usercentrics.com/knowledge-hub/popia-vs-gdpr/

### 8.5 Breach notification — POPIA s22 [VERIFIED]

Bake s22 into the incident runbook as a hard step:
- **TRIGGER:** reasonable grounds to believe an unauthorised person **accessed OR acquired**
  personal information. **There is NO materiality threshold** — even one leaked record triggers
  it. A volunteer team cannot decide a small leak isn't worth reporting.
- **WHO:** notify **(1) the Information Regulator AND (2) each affected data subject**, unless the
  subject cannot be identified.
- **TIMING:** **"as soon as reasonably possible after discovery."** POPIA does **NOT** set a
  72-hour clock — that is GDPR. **Do not put 72h in the policy as a legal requirement** (it
  creates a self-imposed obligation you may miss), though acting within days is the practical
  expectation.
- **FORM:** you **MUST** use the Regulator's official Security Compromise notification template
  (mandatory since 12 Aug 2022). Data-subject notice must contain: description of likely
  consequences, measures taken/intended, a recommendation of what the subject should do to
  mitigate, and the attacker's identity if known. Delivery: mail, email, prominent website
  notice, or news media. **[VERIFIED]** https://popia.co.za/section-22-notification-of-security-compromises/ ·
  https://www.clydeco.com/en/insights/2022/08/popia-update-not-sure-how-to-report-a-data-breach

### 8.6 Data-subject rights vs the 14-day-grace + Lost-Cat sanitization design [VERIFIED]

The design maps cleanly to POPIA **Condition 8 (Data Subject Participation, ss23–25)** — keep it,
with three additions:
- **ACCESS (s23):** build a self-service data-export path so a burner can obtain what we hold
  (we already decrypt ID/passport via `@quagga/db` crypto, so an authenticated export is
  feasible).
- **CORRECTION (s24):** the profile edit flow already covers this.
- **DELETION (s24/s25):** sanitization (null personal fields, keep referential shape, tombstone
  `authUserId`) **satisfies POPIA erasure** — "destruction or deletion" targets the personal
  *information*, not the row; nulling every personal column plus the encrypted ID/passport
  achieves "no personal information remains." **Additions:** (a) the 14-day grace is fine as a UX
  cancel window, but ensure sanitization actually fires after it and the encrypted ID/passport
  columns are in the nulled set (confirmed present via `HARD_LOCKED_PRIVATE_FIELDS`); (b)
  corrections/deletions must be actioned "as soon as reasonably practicable" — don't let the
  sweeper silently stall (prove it ran); (c) offer a **manual erasure path for someone who
  cannot log in** (email request) — s24 rights are not conditional on self-service. **[VERIFIED]**
  https://popia.co.za/section-23-access-to-personal-information/

### 8.7 Accountability artefacts — non-profit status gives NO relief [VERIFIED]

POPIA applies to non-profits **in full**; there is **no automatic exemption** — relief needs an
active **s37** application (a deliberate process, likely not worth it here). Stand up three cheap
artefacts **before real data lands**:
1. A **Records of Processing register** (a spreadsheet is fine) listing each PII field, its
   lawful basis, purpose, retention period, and who it can be shared with — this is also the
   exact document that resolves the ID/passport minimisation question (§8.2).
2. **Register AfrikaBurn's Information Officer** with the Information Regulator (default the
   CEO/head, delegable).
3. Publish a **PAIA/POPIA manual** (template-driven).
**[VERIFIED]** https://www.michalsons.com/blog/how-a-popia-exemption-can-help-your-non-profit/72095 ·
https://bowmanslaw.com/insights/south-africa-100-days-left-to-become-popia-compliant-information-officers-and-guidelines-on-applications-for-prior-authorisation/

### 8.8 Retention [VERIFIED that s14 applies; specific window INFERRED]

POPIA **s14** requires not keeping personal information longer than necessary — **no fixed
statutory number for security logs.** Adopt a **defined, documented retention (a 6–12 month
window for security-investigation logs is a defensible default [INFERRED])** plus a purge job,
aligned with the Lost-Cat sanitization model so deleted-account audit rows are **anonymised, not
orphaned.** Confirm a retention period **per PII class** (especially ID/passport and medical) so
s14 can be enforced by an automated purge after each edition. **Ryan must set the numbers (§11).**

### 8.9 Public-repo disclosure — security.txt + SECURITY.md [VERIFIED / INFERRED]

- **`/.well-known/security.txt` (RFC 9116) [VERIFIED]:** serve from `public/.well-known/` on the
  participant app's custom domain once the apex exists. REQUIRED: `Contact` (≥1; a `mailto:` such
  as security@afrikaburn.org or an https report form) and `Expires` (single ISO-8601, ~1 year
  out — **a stale Expires makes the file invalid**, so tie its refresh to the monthly report
  cadence). RECOMMENDED: `Policy` (→ SECURITY.md), `Canonical`, `Preferred-Languages: en`,
  `Acknowledgments`. Skip PGP signing for a volunteer team.
  https://www.rfc-editor.org/rfc/rfc9116.pdf
- **`SECURITY.md` at repo root [INFERRED best-practice]:** GitHub surfaces it in the Security tab
  and the "Report a vulnerability" UI. Contents: (1) supported scope (the three apps + `@quagga`
  packages; explicitly out-of-scope: third-party Neon/Vercel/Resend infra, social-engineering,
  physical); (2) **prefer GitHub Private Vulnerability Reporting** (free, keeps reports off public
  issues) + a security@ mailbox fallback; (3) an explicit **no-money-but-credit** safe-harbour
  promise (good-faith research won't be pursued legally + an Acknowledgments page) — the proven
  low-cost incentive without a bounty; (4) response SLAs volunteers can actually meet (acknowledge
  ≤5 business days, triage ≤10); (5) ask reporters not to access other users' PII and to delete
  any incidentally retrieved data. Triage via GitHub PVR → security@ alias to 2–3 maintainers →
  GitHub Security Advisories to coordinate a fix.

### 8.10 Incident runbooks [VERIFIED unless noted]

**A. Suspected credential stuffing.** (1) confirm signal (failed-login spike / many IPs vs many
accounts — from `audit_events` + the §7 dashboard); (2) tighten rate-limit/backoff, temporarily
drop the lockout threshold; (3) force password reset + revoke-all-sessions for accounts showing
successful logins in the attack pattern; (4) verify no god/org_staff account was hit (query
memberships); (5) re-enforce the HIBP blocklist on next login for suspected accounts; (6) if any
takeover touched PII → jump to the PII-exposure + s22 path. **Detection gap [open question]:**
confirm a real failed-login-spike detector is actually wired (the §7 dashboard alert is the
intended mechanism).

**B. Leaked secret [INFERRED where noted].** *(The source finding is unverified specifically
because whether Neon lets us self-service-rotate the managed cookie secret is unknown — parked as
§11 decision 17. The rotation MECHANICS below — versioned secrets, `PGCRYPTO_KEY` re-encrypt — are
grounded in §2.4/§8.4 and verified there.)* Handle each distinctly. (1) **`BETTER_AUTH_SECRET` leak:** rotate in Vercel
env for all three apps simultaneously — invalidates all sessions/tokens signed with it (a global
forced re-login). On 1.5 use versioned rotation to soften this. (2) **`PGCRYPTO_KEY` leak — the
severe one:** every stored ID/passport ciphertext is now decryptable — (a) generate a new key,
(b) re-encrypt all rows, (c) **without key-versioning you cannot tell old from new ciphertext, so
build the versioned-key scheme BEFORE you need it (§8.4)**; (d) a leaked key protecting ID numbers
is **very likely a reportable s22 compromise even without proven exfiltration**, because
confidentiality can no longer be assured. Rotate on suspicion, not just proof.

**C. Compromised god-admin account.** (1) revoke-all-sessions + force password reset
immediately; (2) **because `GOD_EMAILS` grants god on first login, IMMEDIATELY remove the
affected email from the `GOD_EMAILS` env list (Vercel)** so a re-login can't silently re-grant god
— session revocation alone does NOT contain this; (3) audit `audit_events` for actions taken
while compromised (elevations, approvals, payment reconciliations) and reverse unauthorised
grants — a malicious god could have elevated others (structural roles hold irrevocable
permissions); (4) enumerate membership changes since the compromise window; (5) if PII was
viewed/exported → s22 path. **STRUCTURAL GAP:** with 2FA provider-blocked, a god account is
protected only by a password — **the strongest argument in the repo for prioritising the
self-hosted move (which unblocks TOTP/passkeys), at least for org/god accounts.** **[VERIFIED]**

**D. Accidental PII exposure.** (1) contain — take down/limit the exposing surface (revoke a bad
Vercel Blob URL, roll back the deploy, or disable the route via the kill-switch, §8.11); (2)
scope — exactly which fields and which subjects (any hard-locked field — phone, emergency contact,
medical, ID/passport — escalates severity); (3) **preserve evidence (logs, access records) before
rotating anything**; (4) run the s22 assessment (no materiality threshold → notify Regulator on
the mandatory template + affected subjects with the four required content elements); (5) if
public/cached, request removal and note it in the subject notice.

### 8.11 Kill-switch — build it now [VERIFIED]

On Vercel serverless there is no long-lived process to signal, so a kill switch must be **state
the request path reads on every invocation** (a DB row or edge config), not an in-memory toggle.
Build: (1) a global **read-only / maintenance flag** (DB-backed single-row config checked in
middleware) that disables writes and hides PII surfaces (directory, profile, exports) app-wide
**without a redeploy**; (2) a **per-capability disable** reusing the existing
`AUTH_CAPABILITIES`/`assertCapability` pattern so an incident can instantly flip e.g. "account
export" or "officer phone-sharing" to unavailable — this is the concrete second life for the
capability layer that §4 asks about; (3) an emergency **revoke-ALL-sessions** broadcast (rotating
`BETTER_AUTH_SECRET` is the blunt version); (4) reuse the `ACCOUNT_SWEEP_SECRET` pattern for any
incident-only endpoint so it never runs unauthenticated or in a build. **Prefer DB-flag over env
for anything you need to flip in seconds** — env changes on Vercel need a redeploy. **[VERIFIED]**

### 8.12 Monthly security/health report [INFERRED best-practice]

A one-page monthly digest a volunteer board can sign off: (1) **Auth health** — active accounts,
new sign-ups, failed-login/lockout counts, any stuffing spikes; (2) **Incidents** — any
s22-assessable events, whether notification triggered, status ("none" is a valid good line); (3)
**Data-subject requests** — count of access/correction/deletion received and whether actioned
within "reasonably practicable"; (4) **Access/authz** — current god/org_staff holders (from
memberships) and any elevations in `audit_events`, so privileged access is reviewed monthly (this
catches god-account creep); (5) **Secrets & dependencies** — last-rotation dates, outstanding
GHSA/Dependabot advisories; (6) **Compliance posture** — security.txt Expires still valid,
Information Officer registration + PAIA manual status; (7) **Provider watch** — has Neon shipped
MFA yet (would unblock 2FA/passkeys). Anchoring it to POPIA duties doubles as accountability
evidence if the Regulator asks.

### 8.13 Audit logging [INFERRED best-practice — OWASP-grounded]

Wire auth events into the existing `audit_events` table (`actor_id, action, subject, meta jsonb`)
— today only written on elevation/approval/payment, so auth events are net-new. **LOG:** sign-in
success/failure (reason category, IP, coarse user-agent), lockout, password change, reset
requested/completed, email-change requested/confirmed/revoked, session revoke, deletion
requested/cancelled/executed, OAuth link/unlink, 2FA enable/disable. **NEVER put in `meta`:**
plaintext passwords or hashes, session tokens, reset/verification tokens, TOTP secrets, backup
codes, or hard-locked PII — a log of reset tokens is a credential store, and the `meta` jsonb is a
genuine leak vector needing a **scrubbing boundary + review.** Align the audit-log purge with the
Lost-Cat model so deleted-account rows are anonymised (§8.8).
https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html

---

## 9. THREAT MODEL

*(Full domain — absent from the earlier draft beyond the invariant-test table. Actors, attack
paths, the privilege-escalation review of our own role model, tenant isolation / RLS, the parked-
IdP decisions, offline implications, and the invariant tests that mechanise the controls.)*

### 9.1 Threat actors & attack paths [VERIFIED]

| # | Actor | Likelihood / impact | Primary controls |
| --- | --- | --- | --- |
| 1 | **Opportunistic credential stuffing / password spraying** (public sign-in, all 3 apps) | HIGH / MEDIUM (HIGH if a god/org_staff/lead account) | HIBP breach-blocklist on password set + 15-char min (the single biggest defence); **`rateLimit.storage:'database'`** (the default in-memory store is per-lambda on Vercel = effectively bypassable — §6); enumeration-safe generic messages; 2FA for privileged accounts (self-host unblocks it) |
| 2 | **Disgruntled camp member escalating privileges within their camp** | MEDIUM / MEDIUM (camp-scoped) | `hasProjectPermission` lead/admin irrevocable backstop; `roleGrantsElevatedPrivileges` + escalation clause stop an `assign_roles`-only holder handing out (or self-assigning) a role carrying `manage_roles`/`manage_members`/captain. **Residual gap: confirm the SERVER role-assignment action actually calls `roleGrantsElevatedPrivileges` — the pure predicate exists but UI hiding is never the boundary (AGENTS.md rule 7)** |
| 3 | **Compromised camp lead account** | MEDIUM / HIGH in-camp (lead holds ALL project permissions irrevocably, sees member PII, issues invites, transfers leadership) | 2FA once self-hosted; **wire the new-device sign-in notification (builder exists but is unwired — needs a device-fingerprint column; for a lead it is the primary compromise tripwire)**; session list + revoke; **single-use `lead_transfer` invites (`invite.ts`, already in place)**; enforce a "last lead" guard (always ≥1 lead) mirroring the sole-lead deletion guard |
| 4 | **Scraping the burner directory / camp pages for PII** | HIGH (public unauth surface) / MEDIUM-HIGH if phone/emergency/ID leak | `enforcePrivacyFlags` forces all `HARD_LOCKED_PRIVATE_FIELDS` false on every write; `listDirectory` hides free (unregistered) camps from non-members. Harden: apply the SAME strip at the future `/api/me` IdP boundary; add rate-limiting/pagination to directory + search; test that type-aheads never return free camps to strangers; confirm no email emitted for non-members |
| 5 | **Malicious supplier account** (self-service sign-up is a new untrusted-registration surface) | MEDIUM / MEDIUM | `validateDocumentBinding`/`applyDocumentAcksToSteps` forbid a supplier-ticked checkbox from confirming an org-owned step (deposit/briefing/fee) — a supplier can never self-attest that money arrived; email verification before onboarding; `suppliers.code` UNIQUE-index arbiter (race-safe); scope suppliers to their own row only |
| 6 | **Rogue / compromised third-party OAuth integrator** (the PARKED IdP) | LOW now (unbuilt) / HIGH (an integrator key is a skeleton key to Burn identities) | Not a today-risk, but three decisions must be locked NOW (§9.4). Overarching control when built: `/api/me` unconditionally strips hard-locked PII regardless of scope; coarse role claims only |

### 9.2 Privilege-escalation review of our OWN role model [VERIFIED]

- **The god bootstrap (`GOD_EMAILS` + verified email)** is correctly closed: `canBootstrapGod`
  requires `emailVerified === true` AND membership on the `GOD_EMAILS` list. Without the verified
  gate, a self-service sign-up / unverified email-change / attacker-controlled OIDC `email`
  claim matching an unregistered god address would silently elevate. **KEEP IT as a tripwire
  test.** **Self-hosted-specific risk:** when social login or the IdP arrives, an OAuth provider
  asserting a god email as verified would elevate — so **god bootstrap must trust OUR
  verification, not a federated `email_verified` claim.** Gate god bootstrap to
  password+our-own-verification identities, or explicitly whitelist which verification sources
  count.
- **`org_staff`, structural lead/admin backstop, custom-role grants:** the backstop is *correct*
  for anti-lockout (a lead/admin can never be dropped below full permissions —
  `isPermissionBackstop` is unconditional), but it means a compromised lead is maximally
  powerful in-camp, which is why detection (device notifications) and 2FA matter most there
  (actor 3). Captain permissions are always coerced to `allProjectPermissions`
  (`enforceKindPermissions`) on every write.
- **Officer consent exposing phone:** `officerContactVisibleToOrg` is the SOLE gate and must be
  false for pending/declined and any non-officer; `resolveAudience` must never return a
  pending/declined officer to an org_officer audience; a camp cannot delete/rename an officer
  role.

**Invariant tests that MUST exist (pure `@quagga/core` predicates, cheap) [VERIFIED]:** (1)
`canBootstrapGod` returns false for any unverified email, always; (2) an `assign_roles`-only
member cannot assign a role where `roleGrantsElevatedPrivileges` is true; (3) no permission edit
drops a lead/admin below full permissions; (4) captain permissions always coerced to
`allProjectPermissions`; (5) `enforcePrivacyFlags` forces every hard-locked field false and
`privacyViolations` flags attempts; (6) `officerContactVisibleToOrg` false for pending/declined
and non-officers; (7) `resolveAudience` never returns a pending/declined officer to an
org_officer audience; (8) a camp cannot delete/rename an officer role. **Then ADD server-side
integration tests proving the write paths actually CALL these predicates** — the demonstrated
failure mode (AGENTS.md adversarial verification) is authz predicates existing but not being
invoked server-side.

### 9.3 One Postgres, many camps — isolation & the RLS question [VERIFIED]

Today isolation is **100% app-layer**: every store query filters by `groupId`/`userId` and `db()`
connects with a single Neon connection string (owner-equivalent via the serverless HTTP driver),
so there is **NO database-level backstop.** Acceptable at our scale IF discipline holds, but the
risk is a single missing `WHERE groupId=…` clause silently cross-leaking camp data (classic
multi-tenant IDOR), and the pure-authz predicates being *correct* does not prove the read/write
paths *invoke* them.

**Mitigations short of RLS [VERIFIED]:** (a) a mandatory `requireMembership(userId, groupId)`
funnel that every camp-scoped read/write goes through (returns the role), so no query hand-rolls
its own filter; (b) adversarial cross-camp tests (attempt reads as a non-member, assert empty/403);
(c) treat every store function taking a `groupId` as security-sensitive in review.

**Is Neon RLS worth it? NOT now [VERIFIED].** Neon RLS only enforces if you connect with a
**non-owner** role carrying a per-request JWT (`authenticatedRole`); the owner/`neondb_owner`
role **bypasses RLS entirely.** We connect server-side with one owner-equivalent string and do
all authz in trusted server code, so RLS would give nothing unless we re-plumb every request to
mint a scoped JWT and open a per-request role-scoped connection — a large change to `db.ts` and
every store, fighting the stateless HTTP driver we deliberately use. **RLS's value is enforcing
isolation when the query issuer is UNTRUSTED** (a browser Data API, an external integrator) — we
have no such issuer. **Revisit RLS only if the deferred "platform Data API" (Option C) ever lets
external consumers query Postgres directly.** https://neon.com/docs/guides/row-level-security

### 9.4 Parked IdP — decisions to lock NOW so it stays cheap [VERIFIED]

Three cheap-now / expensive-later decisions:
1. **OWN the users/auth tables in `packages/db` from day one** (already the plan). The IdP is a
   separate better-auth 1.5+ deployment reading the SAME Neon auth tables — getting table
   ownership + a stable session/user shape right now is what keeps Phase 2 a **bolt-on rather
   than a migration.**
2. **Design the `/api/me` + token-claims boundary as ONE unconditional PII-strip helper in
   `@quagga/core`**, reused by BOTH first-party and integrator responses, so hard-locked fields
   (phone/emergency/ID/medical) can never be scoped-in. **Build the stripper now** even though
   only first-party calls it — a per-caller filter is the failure mode that leaks PII when a
   scope or filter is mistaken.
3. **Decide the coarse-claim vs authoritative-endpoint split now** — minimal namespaced role
   claims in tokens; fresh data via scoped `/api/me` — so integrators never cache stale
   privileges.

IdP risk controls when built (mostly config, not novel crypto): `redirect_uri` EXACT-match
allowlist per client (better-auth's provider already does exact path match); require PKCE for all
new clients (`require_pkce` default on the new oauth-provider); client secret shown once + stored
hashed + rotation-with-grace + instant revocation (org "Integrations" console); short-lived access
tokens + refresh rotation + JWKS; least-privilege scopes with hard-locked PII outside *all*
scopes. Validate the OAuth 2.1 Provider with a dedicated spike when Part 2 revives — it is new
(1.5, Feb 2026) with reported early bugs (issue #7558 class). Because the IdP is a separate
deployment it can run its own newer better-auth version.
https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/oauth-provider.mdx

### 9.5 Offline / on-site implications [VERIFIED]

A real inconsistency to resolve before attestation flows are built: the offline attestation model
(synthesis.md) states "each device enrols a keypair at login; private key NEVER leaves the
device" (per-device signing key), but the CURRENT schema (`profile_keys`) stores ONE
**server-generated, server-held `encryptedPrivateKey` per user.** A server-held key **cannot
provide the non-repudiation the attestation handshake claims** (the server, or anyone with the
KEK, can forge either party's signature) and it is per-user not per-device. For MVP this is fine
(keys generate but sign nothing yet — build-spec scopes attestation OUT), but **decide now:**
attestations need DEVICE keypairs (private key in device secure storage, public key registered
server-side and shipped in the pre-event sync bundle) — a different table shape. **Auth
implications:** on-site there is zero connectivity, so **sessions must survive long offline
periods** (long-lived / offline-tolerant session or a cached credential) and handover roles
(container-collection person) should use magic-link/PIN + device key, NOT full accounts.
Self-hosted Better Auth supports magic-link and long session expiry, so this is achievable — but
the session TTL and offline-refresh behaviour must be chosen deliberately. **[VERIFIED]**

### 9.6 Self-hosting inherits the CVE-patch treadmill [VERIFIED]

Better Auth has a real track record: trustedOrigins bypass → ATO (GHSA-vp58-j275-797x, patched
1.1.21) and an email-verification open-redirect (GHSA-8jhw-6pjj-8723). Our 1.4.18 pin is not
affected, and managed Neon patched these silently. Once self-hosted **we own the watch.** The
AGENTS.md hard-pin (frozen because newer breaks typecheck) collides with this — a future critical
CVE could force an emergency un-pin under time pressure. Controls: subscribe to the GHSA feed /
enable Dependabot on the auth dep; **document the emergency-upgrade path now and name the GHSA-
watch owner**; `trustedOrigins` = explicit absolute URLs only, never wildcards.

### 9.7 Threat → control → invariant-test matrix

| Threat | Control | Invariant test | Status |
| --- | --- | --- | --- |
| A new privilege ships default-open | fail-closed `hasProjectPermission` | authz completeness meta-test over `ProjectPermissionKey.options` | [VERIFIED] |
| Hard-locked PII leaks via a new public surface | projections strip off `HARD_LOCKED_PRIVATE_FIELDS` | run populated bio through every registered projection, assert no locked key | [VERIFIED] |
| A phone leaks outside the officer path | `officerContactVisibleToOrg` sole gate | assert only that fn surfaces phone, only on `{isOfficer,consent:'accepted'}` | [VERIFIED] |
| god silently self-elevates | `canBootstrapGod` verified-email gate | assert false for any unverified email; refuse federated `email_verified` | [VERIFIED] |
| `assign_roles` holder self-grants admin | `roleGrantsElevatedPrivileges` escalation clause | assert an assign_roles-only member cannot assign an elevated role | [VERIFIED] |
| A new route ships with no authz check | server-enforced predicates (AGENTS.md 7) | route census: every route calls a predicate or is in reviewed `PUBLIC_ROUTES` | [INFERRED] |
| Camp A reads Camp B | app-layer `requireMembership` funnel | adversarial cross-camp read test asserts empty/403 | [VERIFIED design; test INFERRED] |
| An existing migration is edited/deleted | append-only discipline | git-diff status check M/D fails | [INFERRED] |
| A build script runs migrate against prod | AGENTS.md rule 1 | grep build scripts + turbo build task | [VERIFIED] |
| Credential stuffing / brute force | DB-backed rate limit + lockout + HIBP + CAPTCHA | Better Auth flow tests + lockout test | [VERIFIED] |
| In-memory rate limit silently non-functional | `rateLimit.storage:'database'` | assert config; integration test lockout survives across instances | [VERIFIED] |
| User enumeration | generic messages + `requireEmailVerification` | enumeration-safety tests on sign-in/sign-up/reset | [VERIFIED] |
| Password reset doesn't kill sessions | `revokeSessionsOnPasswordReset:true` | flow test: reset invalidates all sessions | [VERIFIED] |
| Plaintext backup codes at rest | `storeBackupCodes:'encrypted'` | assert config + no plaintext in DB | [VERIFIED] |
| `BETTER_AUTH_SECRET` drift logs users out | single documented source | operational — observability alert on success-rate drop (§7.5) | [VERIFIED risk] |
| Passkey scoped to subdomain, un-widenable | rpID = apex from day one | config assertion rpID === apex | [VERIFIED] |
| Audit `meta` captures tokens/PII | scrubbing boundary | assert scrubber strips known-sensitive keys | [VERIFIED as risk; test INFERRED] |
| Supplier self-attests an org-owned step | `validateDocumentBinding` | assert a supplier ack can't confirm a deposit/briefing/fee step | [VERIFIED] |

---

## 10. WHAT WE DELIBERATELY DO NOT BUILD

- **No stateless-JWT-only sessions.** Breaks revocation the security spec requires. [VERIFIED]
- **No proxy/central-auth-server topology** (one app hosting `/api/auth` for the others). Breaks
  server-enforced authz and adds a single point of failure. [VERIFIED]
- **No Postgres RLS now.** A no-op under our owner-role connection; a full re-plumb for no threat
  we actually have. App-layer authz + adversarial tests instead. Revisit only for a future direct
  -to-Postgres external consumer (Option C). [VERIFIED]
- **No bundled local breach-password list.** HIBP range API is free, current, keyless. [VERIFIED]
- **No SMS 2FA.** SIM-swap + cost. TOTP + backup codes only. [VERIFIED]
- **No passkey-first / passkey-only** at launch — device fragmentation + recovery hazard.
  Passkeys are an optional accelerator. [VERIFIED]
- **No device-held attestation keypairs in the MVP.** Keep the `profile_keys` placeholder; do NOT
  ship the QR handshake until the logistics phase — a half-built non-repudiation system on a
  server-held key gives false assurance. [VERIFIED]
- **No self-hosted secrets/HSM for the key-encryption-key.** Use the platform env / Vercel-managed
  secret; don't hand-roll KMS. [VERIFIED]
- **No custom crypto anywhere.** Rely on Better Auth + WebAuthn/TOTP standards. [VERIFIED]
- **No collecting more PII to "enable" security features.** Fewer forms is a product law; e.g. no
  SMS-requiring flows. [VERIFIED]
- **No self-hosted LGTM observability stack, and no paid Vercel Observability Plus** for auth.
  Grafana Cloud free tier. [VERIFIED]
- **No dependency on UptimeRobot Free** for production monitoring — non-commercial-only TOS.
  [VERIFIED]
- **No Redis/Upstash at launch.** DB-backed rate limiting first; Redis only if volume demands.
  [VERIFIED]
- **No OAuth 2.1 Provider / "Sign in with AfrikaBurn" IdP on the critical path now.** Parked
  (Part 2); a separate deployment on its own newer better-auth version when Part 2 revives.
  [VERIFIED]
- **No storing ID/passport numbers by default** — collect only on an explicit, documented,
  minimised decision with a named downstream purpose (§8.2). [VERIFIED — the full research reaches
  the minimisation conclusion]
- **No pursuing a POPIA s37 non-profit exemption** — likely cheaper and lower-risk to just comply
  with baseline duties for a data-holding auth platform. [VERIFIED, subject to §11]

---

## 11. DECISIONS RYAN MUST MAKE (conflicts & open questions)

1. **Apex domain — buy it.** Cross-subdomain SSO *and* cross-app passkeys (rpID) are both hard-
   blocked on a custom apex; `*.vercel.app` cannot do either. The one unavoidable paid line and
   gates the whole design. Which apex, and is it purchased?
2. **Identity-vs-profile table boundary (§2.3).** Does Better Auth's `user` table *become* our
   `users` table, or sit beside it? Near-irreversible; touches migration 0011's `sanitized_at` and
   the Lost-Cat plan. Decide before generating auth tables.
3. **Social sign-in topology.** Centralise Google through `apps/web` (one callback + shared
   cookie) or register a redirect URI per app?
4. **Better Auth version pin.** 1.5.0 confirmed; later 1.6.x tags exist. Confirm newest stable +
   React 19 / Next 16 compat and rewrite AGENTS.md rule 3 to that pin. **Also: document the
   emergency un-pin procedure for a critical CVE and name the GHSA-watch owner (§9.6).**
5. **Retire the capability-probe layer, or repurpose it?** Once self-hosted, `AUTH_CAPABILITIES`
   + `assertCapability` may be dead code — but §8.11 wants it kept as the per-capability
   kill-switch surface. Recommended: **keep and repurpose**, don't delete.
6. **Is 2FA/TOTP + passkeys a *launch* requirement, or phase 1?** Self-hosting unblocks both
   immediately. Given a god account is password-only today (§8.10C), consider requiring MFA for
   god/org_staff at launch even if optional for everyone else.
7. **Rate-limit storage:** Neon DB (free, needs a prune job) — recommended — vs Upstash now.
   Confirm DB-first and confirm the ≤10-failure lockout thresholds/backoff.
8. **CAPTCHA scope:** sign-up only, or also sign-in + reset (Turnstile default covers all three)?
9. **Audit-log & PII retention windows (§8.8).** No POPIA statutory number — set documented
   windows per PII class (6–12 months suggested for security logs) + purge jobs.
10. **ID/passport storage (§8.2).** The research says: absent a named downstream purpose, **do not
    collect it.** Confirm — is there a concrete MVP/near-roadmap use? If yes: documented lawful
    purpose, minimum retention, encryption-at-rest confirmed.
11. **Medical-notes encryption (§8.3).** `medical_notes` is currently plaintext while lower-risk
    ID is encrypted. Fix the inversion before real data lands — confirm the field-level encryption
    change.
12. **Vercel plan (Hobby vs Pro).** Determines WAF custom rules, Attack Challenge Mode, and
    whether **Protection-Bypass-for-Automation** (needed for free Playwright-against-preview) is
    available — if Pro-only, "free E2E" becomes a paid dependency. Hobby is also non-commercial-
    use. **[VERIFIED as unresolved]**
13. **passkey `origin` — single string or array? [VERIFIED as unconfirmed]** Determines whether
    three mounted instances can share the passkey table or whether we need one central auth
    service earlier. **Needs a spike.** Also verify cross-instance passkey counter atomicity.
14. **Should org/god accounts be REQUIRED to enrol two passkeys or passkey+TOTP**, enforced in
    `@quagga/core`? Policy, not technical.
15. **`requireMembership` funnel (§9.3).** Introduce the mandatory tenant-scoping gate before the
    surface expands, so no store function hand-rolls its own filter?
16. **POPIA accountability status (§8.7).** Has AfrikaBurn already registered an Information
    Officer and published a PAIA manual? If not, both are prerequisites before real data
    collection.
17. **Neon cookie-secret rotation self-service? [open question].** Can `NEON_AUTH_COOKIE_SECRET` /
    the managed signing secret be rotated by us or does it need Neon support? Moot after
    self-hosting, but relevant for the interim.
18. **PUBLIC_ROUTES allowlist policy (§5.3).** Who reviews additions — should "make it public"
    require a second approver so it can't be a silent one-line diff?

**Conflicts surfaced between reports:**
- **Branch-preview identity:** the better-auth-core report **disproves** platform-architecture-
  spec's "Option B loses branch identity" con. Resolved (§2.6) — the con is struck.
- **IdP topology:** platform-architecture-spec Part 2 assumes the IdP is a *separate deployment*;
  the research asks whether, now that auth lives in our own DB, the IdP becomes just another
  plugin on the same instance. Left open (§9.4 / decision 5) — not silently picked.
- **CI sequencing:** the ci-regression report flags most auth-flow tests are meaningless on
  managed Neon → surfaced as the §5.5 recommendation (guards now, flow-E2E at migration).
- **ID/passport:** the earlier draft hedged on whether storage is defensible; the full research
  reaches the minimisation conclusion — this rewrite leads with "don't collect absent a named
  purpose" (§8.2).

---

## 12. PHASED TASK BREAKDOWN

### Phase 0 — must be true before the kickoff demo

| Task | Scope (one line) | Size |
| --- | --- | --- |
| P0-1 Decide identity-vs-profile boundary | Pick: BA `user` = our `users`, or beside it (§2.3) | S (decision) |
| P0-2 Create `@quagga/auth` package | Shared `betterAuth()`: drizzleAdapter, email/password, Google, Resend callbacks, cookieCache, **DB rate-limit storage** | M |
| P0-3 Generate + place auth tables | CLI generate → `packages/db/schema.ts` → one appended migration | M |
| P0-4 Mount route handlers in all 3 apps | `app/api/auth/[...all]/route.ts` via `toNextJsHandler` | S |
| P0-5 Rewrite auth clients | `createAuthClient` in each `lib/auth-client.ts`; branded reset/verify views | M |
| P0-6 Delete managed Neon Auth | Remove `neon-auth.ts` ×3, `@neondatabase/auth` dep, `NEON_AUTH_*` env; `isAuthConfigured()`→`BETTER_AUTH_SECRET` | S |
| P0-7 Upgrade to 1.5.x + absorb breaks | Bump, fix `InferUser`/`getMigrations`/etc., rewrite AGENTS.md rule 3 pin | M |
| P0-8 Env-less boot preserved | Placeholder-secret pattern still boots all 3 apps to "not configured" (rule 4) | S |
| P0-9 Green the gate | `pnpm turbo run lint typecheck test build` passes | S |
| P0-10 Confirm apex domain purchased | The hard blocker for SSO + passkeys (decision) | S (external) |

### Phase 1 — before real users

| Task | Scope | Size |
| --- | --- | --- |
| P1-1 Cross-subdomain cookie SSO | `crossSubDomainCookies` + `trustedOrigins` on the apex across 3 apps | S |
| P1-2 TOTP + backup codes | `twoFactor()` plugin, `storeBackupCodes:'encrypted'`, enrol/verify/regenerate UI | M |
| P1-3 Account surfaces | Mount `/account`, `/account/security`, `/account/delete` (backend already built) | M |
| P1-4 HIBP breach check | `haveIBeenPwned` plugin + fail-open-on-outage (never on-match) policy | S |
| P1-5 CAPTCHA | Turnstile plugin on sign-up (+ sign-in/reset per decision 8) | S |
| P1-6 Rate limit + lockout | DB storage on in prod + ≤10-fail lockout logic + prune job | M |
| P1-7 Security headers + nonce CSP | HSTS/nosniff/frame-ancestors/Permissions-Policy + middleware nonce | M |
| P1-8 Enumeration + reset hardening | `requireEmailVerification:true`, `revokeSessionsOnPasswordReset:true`, explicit `baseURL`, no-wildcard `trustedOrigins` | S |
| P1-9 Auth audit events | Wire events into `audit_events` + `meta` scrubbing boundary + retention purge job | M |
| P1-10 CI regression guards | Authz matrix, PII projection, route census, migration safety, no-migrate-in-build, pin-guard, `--frozen-lockfile`, CodeQL, gitleaks | L |
| P1-11 Auth-flow tests | `getTestInstance` tests for 2FA/passkey/change-email/session/reset | M |
| P1-12 Observability wiring | `@vercel/otel` traces + hand-rolled OTLP metrics/logs push (delta + flush) → Grafana Cloud free; auth panels + alert rules + Telegram/Slack contact points; synthetics + Better Stack | L |
| P1-13 Secret-rotation runbook | 1.5 versioned-secret rotation documented; single-source env doc; `PGCRYPTO_KEY` versioned-key scheme | M |
| P1-14a Passkey `origin` spike (**GATES P1-14b**) | Resolve decision 13: does the plugin `origin` accept an ARRAY or only a single string? + verify cross-instance counter/replay atomicity. **A single-string result forces a topology revisit (one central auth service) that is OUT of the P1-14b budget** — sequence this first | S |
| P1-14b Passkey plugin | `@better-auth/passkey`, rpID=apex, discoverable + conditional UI. **Size is CONDITIONAL on the P1-14a spike:** M only if the array/multi-origin path holds; a single-string outcome invalidates the mounted-per-app shape (§2.1) and makes the size unknowable until re-scoped | M (conditional) |
| P1-15 Kill-switch | DB-backed maintenance/read-only flag + per-capability disable + revoke-all broadcast (§8.11) | M |
| P1-16 New-device notification | Wire the existing builder + add device-fingerprint column (compromise tripwire, actor 3) | M |
| P1-17 `requireMembership` funnel + cross-tenant tests | Single tenant-scoping gate; adversarial cross-camp read tests (§9.3) | M |
| P1-18 PII-strip helper (build now, IdP-reused) | One unconditional `@quagga/core` hard-lock stripper for `/api/me` and first-party (§9.4) | S |
| P1-19a POPIA engineering deliverables | `security.txt` (RFC 9116) + `SECURITY.md` + GitHub Private Vulnerability Reporting intake (§8.9). (Encryption fixes tracked separately in P1-20; ID/passport is decision 10.) | S |
| P1-19b POPIA org/legal artefacts (**EXTERNAL — not engineering**) | Processing register, **Information Officer registration with the SA Information Regulator**, PAIA manual (§8.7). **Blocked on §11 decision 16** (has AfrikaBurn already registered an IO?); IO registration is a **Regulator process with its own lead time**, not completable in an eng day-size | — (external / no eng day-size) |
| P1-20 Fix medical-notes encryption | Field-level encrypt `medical_notes` to match ID/passport (§8.3) | S |

### Phase 2 — before third-party IdP (parked; revisit when Part 2 revives)

| Task | Scope | Size |
| --- | --- | --- |
| P2-1 OAuth 2.1 Provider spike | Validate the 1.5 provider on a separate deployment; check issue #7558 class | M |
| P2-2 Decide IdP topology | Same-instance plugin vs separate deployment (conflict, §11) | S (decision) |
| P2-3 Client registration console | Org "Integrations" page: secrets hashed/rotated, redirect URIs, PKCE, scopes, consent, revoke, audit | L |
| P2-4 `/api/me` scoped endpoint | Least-privilege claims + the P1-18 hard-locked strip at the boundary | M |
| P2-5 god bootstrap federated-claim refusal | Ensure god elevation refuses federated `email_verified` (§9.2) | S |
| P2-6 Device-keypair attestation model | If logistics phase lands: device-held keypairs replacing server-held `profile_keys` (§9.5) | L |
| P2-7 Related Origin Requests (only if needed) | `/.well-known/webauthn` allowlist if truly different registrable domains must share passkeys | S |

*Sizes: S ≈ <1d, M ≈ 1–2d, L ≈ 3–5d. All INFERRED sizing.*

---

*End of plan of record. Where this document and `docs/platform-architecture-spec.md` conflict,
this document wins for the auth-platform decision; `docs/build-spec.md` still wins for general
engineering per AGENTS.md.*
