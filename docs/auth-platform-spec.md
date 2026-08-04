# Auth & Security Spec — self-hosted Better Auth

Better Auth **1.6.25**, self-hosted in `packages/auth`, mounted per app at
`/api/auth/[...all]`. One account pool, auth tables owned by `packages/db`
(migration 0013), 2FA/TOTP and passkeys since 0015, DB-backed rate limiting.

This document is the **security and compliance contract**: the architecture, the
methods offered, the hardening that must hold, POPIA obligations and incident
runbooks, and the threat model. It is written as what exists and must keep
existing — not as a plan.

> **Section numbering has gaps, deliberately.** §1 (decision summary), §4
> (migration off managed Neon Auth), §5 (the CI suite to build) and §12 (phased
> task breakdown) described work that has since been done; they were removed
> rather than left to be read as outstanding. The surviving sections keep their
> original numbers so that the 75 internal cross-references remain valid. Git
> has the removed text at `044ea30`. The CI suite they specified now lives in
> `.github/workflows/ci.yml`; the architecture is mapped in
> [`architecture.md`](architecture.md).

---

## 2. ARCHITECTURE

### 2.1 Topology — shared config, mounted per app

Create **`@quagga/auth`** exporting one `betterAuth` config:
`drizzleAdapter(db, { provider: 'pg', schema })`, `emailAndPassword`, `socialProviders`
(Google), and plugins. Each app adds `app/api/auth/[...all]/route.ts` via
`toNextJsHandler(auth)` and calls `auth.api.*` directly server-side. All three point the
adapter at the **same Neon database** → one account pool. Because Better Auth is stateless
per-request (it reads the DB), running N copies against one DB is the _intended_ shape, not a
workaround. — https://better-auth.com/docs/integrations/next

**Do NOT** adopt the "one app hosts `/api/auth`, others point `baseURL` at it" proxy shape —
it forces cross-origin HTTP for every server-side authz check, breaks the `@quagga/core`
server-enforced predicate pattern (AGENTS.md rule 7), and reintroduces the exact "auth is a
remote REST service" friction we have with managed Neon today.
**Vercel specifics ** (https://better-auth.com/docs/concepts/cookies ·
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
  `sameSite: 'lax'` (current managed config) and a stable `cookiePrefix`. — https://better-auth.com/docs/concepts/cookies
- **Keep DATABASE sessions** (the default), _not_ stateless JWT. Database sessions give the
  revocable active-session list, revoke-one/others/all, and new-device tracking the
  accounts-security-spec relies on — pure JWT cannot revoke. — https://better-auth.com/docs/concepts/session-management
- Add `session.cookieCache` (e.g. `maxAge` 300s, strategy `compact`|`jwt`|`jwe`) so
  short-lived reads come from a signed cookie while the DB stays the source of truth for
  revocation — the serverless-friendly middle ground, no Redis/persistent process. Set
  `expiresIn` (e.g. 7d) + `updateAge`.
  **Trade-off :** a revoked session can still be honoured until `cookieCache`
  maxAge expires (up to 5 min). Acceptable for most surfaces; use a shorter maxAge for
  hard-locked-PII surfaces, or set UX expectations on the "revoke" button.

### 2.3 Schema ownership — the one near-irreversible decision

- Use `drizzleAdapter(db, { provider: 'pg', schema })`. Generate table definitions with the
  Better Auth CLI (`npx @better-auth/cli generate` on 1.4.x; `npx auth generate` on 1.5+) —
  it **emits Drizzle table code**; hand-place those tables into `packages/db/src/schema.ts`,
  then `pnpm --filter @quagga/db db:generate` produces the append-only SQL migration. **Do
  NOT use Better Auth's own `npx auth migrate`** — that is Kysely-only and never touches a
  Drizzle project, so it cannot fight our migration discipline. `packages/db` stays the single
  schema owner (AGENTS.md rule 2). — https://better-auth.com/docs/adapters/drizzle · https://better-auth.com/docs/concepts/cli
- Core tables: `user`, `session`, `account`, `verification`, plus one per plugin (`twoFactor`,
  `passkey`, and later `oauthApplication`). Each new plugin = new tables = one appended
  migration. Naming is fully customisable via `usePlural`, per-model `modelName`, per-field
  `fields`, or column `fieldName`.
- **THE decision to make before generating tables:** does Better Auth's `user` table _become_
  our existing app users table (map `modelName: 'users'`, declare app columns as
  `additionalFields`), or sit beside it joined by id? Given `users.sanitized_at` (migration
  0011), rich profile data, and the `@quagga/core` sanitization plan, the cleanest split is
  usually: **Better Auth owns a lean identity `user` table; app/profile data lives in our own
  table keyed by the same user id.** Near-irreversible; touches every downstream FK and the
  Lost-Cat deletion plan.
  https://github.com/better-auth/better-auth/blob/main/packages/core/src/db/adapter/get-field-name.ts

### 2.4 Version & secrets

- **Adopt 1.5.x** (1.5.0 released 28 Feb 2026; Context7 lists later 1.6.x tags e.g. 1.6.23 —
  confirm newest stable + React 19 / Next 16 compat at install). Budget for 1.5 breaking
  changes: `InferUser`/`InferSession` removed, `getMigrations` moved to
  `better-auth/db/migration`, API Key plugin moved to `@better-auth/api-key`
  (`userId`→`referenceId`), `/forget-password/email-otp` removed, after-DB-hooks now run
  post-transaction. **AGENTS.md rule 3 must be rewritten** to pin whatever 1.5/1.6 we
  validate — not silently violated. The gate `pnpm turbo run lint typecheck test build` re-run
  is the acceptance criterion. — https://better-auth.com/blog/1-5
- `BETTER_AUTH_SECRET`: `openssl rand -base64 32` (min 32 chars), identical across all three
  projects. **1.5 versioned-secret rotation**
  (`secret: [{version:2,value:NEW},{version:1,value:OLD}]`) rotates **without logging everyone
  out** — new data signs with the current entry, verification tries all, legacy bare-hex data
  falls back; data lazily re-encrypts on next write. On 1.4.18 (single secret) rotation forces
  a global logout. For a volunteer team that can't babysit a rotation, this is a concrete extra
  reason to run 1.5+ — and it is the containment primitive the incident runbooks depend on
  (§8.5). — https://better-auth.com/docs/reference/security

### 2.5 Email seam (reuse Resend, no new infra)

Wire `betterAuth` callbacks to the existing `@quagga/core` security-notification builders +
Resend sender: `emailAndPassword.sendResetPassword`, `emailVerification.sendVerificationEmail`,
`onPasswordReset` (password-changed notice), and `user.changeEmail.sendChangeEmailVerification`.
**Self-hosting finally unlocks server-side change-email** (absent from managed Neon's allowlist
— accounts-security-spec probe). The 48h email-change revocation window and POPIA sanitization
stay in `@quagga/core`; Better Auth owns the identity-side token, our code owns the app-side
state machine. — https://better-auth.com/docs/authentication/email-password ·
https://better-auth.com/docs/concepts/email

### 2.6 Neon branch-preview identity — the con that was BACKWARDS

The earlier analysis ("Option B loses branch identity / preview
auth") is **INCORRECT for self-hosted-in-our-own-DB and should be struck.** A Neon branch is a
copy-on-write clone of the _entire_ database — all schemas, all tables, all rows. If
self-hosted auth tables live in our Neon DB, every preview/dev branch automatically contains a
full, isolated copy of the auth tables _and_ their user/session rows, for free, by the same
mechanism that branches app tables. Neon's own docs say this for managed auth ("Users,
sessions, and auth configuration … branch with your data"); self-hosted gets the same benefit
more cleanly — a Vercel preview just needs `DATABASE_URL` pointed at the branch (Neon's Vercel
integration does this) and `betterAuth` reads that branch. — https://neon.com/docs/introduction/branching · https://neon.com/docs/auth/overview

---

## 3. AUTHENTICATION METHODS LADDER

**Recommended default for a non-technical, Android-dominant, device-fragmented volunteer base:**

> **Password (15+ char, breach-checked) primary + email-OTP / magic-link low-friction fallback
>
> - TOTP with backup codes as an opt-in second factor + passkeys as an optional
>   progressive-enhancement accelerator.** Passkey-_first_ is deferred.

Justification :

1. **Password + optional passkey, not passkey-first.** The sign-in field carries
   `autocomplete="username webauthn"` (the `webauthn` token MUST be last) so users who _have_ a
   passkey get one-tap conditional-UI autofill, while everyone else uses the familiar password
   / email-OTP path. On mount, feature-detect then preload:
   `if (PublicKeyCredential.isConditionalMediationAvailable?.) authClient.signIn.passkey({ autoFill: true })`.
   After first sign-in, a dismissable "add a passkey for faster sign-in" prompt.
   https://web.dev/articles/passkey-form-autofill
2. **Why not passkey-first:** it concentrates the recovery problem on a mostly-Android,
   budget-device, high-fragmentation base (global Android ~67% / iOS ~33%; SA skews further to
   Android; older builds like Android 11 still ~10%+ share). Conditional UI, cross-device
   hybrid sign-in, and sync each have narrower support boundaries. _(Directional: the
   per-version South African split is extrapolated from Africa-wide Android
   fragmentation data, not an authoritative SA source.)_
   https://mojoauth.com/blog/passkey-support-matrix-browser-os-feature-support ·
   https://www.corbado.com/passkey-benchmark-2026/web-passkey-readiness
3. **TOTP alongside passkeys, not instead of.** The `twoFactor` plugin bundles TOTP,
   email-OTP-as-2FA, and backup codes. TOTP works on the widest device range and is the
   pragmatic fallback for older Android. **Offer both.**
   https://better-auth.com/docs/plugins/two-factor

**Passkey specifics ** (https://better-auth.com/docs/plugins/passkey):

- `@better-auth/passkey` plugin (separate package, keeps WebAuthn deps out of the base bundle),
  one `passkey` table (id, name, publicKey, userId FK, credentialID, counter, deviceType,
  backedUp, transports, aaguid) owned by `packages/db`. Runs cleanly on Vercel serverless — the
  WebAuthn challenge is stored in a **signed cookie** (`better-auth-passkey`), not server
  memory, so no persistent process.
- **`rpID` MUST be the shared apex registrable domain, set from day one.** A passkey scoped to
  the apex works on every subdomain; a passkey scoped to a subdomain will NOT work on the
  others and **cannot be widened without re-enrolling every user** — rpID is effectively
  un-migratable once users enrol. rpID (WebAuthn credential layer) is _separate_ from
  `crossSubDomainCookies` (session cookie layer) — configure BOTH to the same apex. Truly
  different registrable domains would need Related Origin Requests (`/.well-known/webauthn`,
  max 5 domains) — but our subdomain-under-one-apex plan does NOT need ROR.
  https://web.dev/articles/webauthn-rp-id
- Discoverable credentials: `authenticatorSelection.residentKey: "required"` +
  `userVerification: "preferred"` + platform authenticator for the non-technical base.
- **Open fork _(unconfirmed — needs a spike)_:** whether the plugin `origin` option accepts an ARRAY
  of expected origins (as underlying SimpleWebAuthn does) or a single string. If single-string,
  the three-mounted-instances shape may need each instance to validate its own subdomain
  origin, or push toward one central auth service earlier. **Needs a spike (§11).** Also verify
  the credential counter/replay update is atomic in Postgres under concurrent sign-ins from
  different apps sharing one `passkey` table.

**TOTP / backup-code footgun :** the `twoFactor` factory's own default IS encrypted,
but the raw `backupCodeOptions` sub-option defaults to `storeBackupCodes: "plain"` — so **set it
to `"encrypted"` explicitly** rather than relying on the default, because plaintext recovery codes
in our Neon DB would be a POPIA and security failure. The plugin's built-in `accountLockout`
(10 fails → 15 min) and rate limit (3 req/10s) apply to the **`/two-factor/*` verification
endpoints only** — this is NOT sign-in lockout. General credential-stuffing lockout on password
sign-in (the spec's ≤10-consecutive-failure rule) remains **our own logic to build and test**
(§6, P1-6): do not read this line as "sign-in lockout ships for free" and skip P1-6.
`allowPasswordless: true` lets passkey-only users still manage 2FA.
https://better-auth.com/docs/plugins/2fa

**Recovery is the true assurance ceiling :** never let a single passkey be the only
recovery path. Layer: (1) nudge a _second_ passkey at enrolment (enforce for org/god accounts);
(2) backup codes; (3) email-OTP/magic-link as last resort — but an account recoverable by email
alone is only AAL1 on recovery. **For hard-locked-PII surfaces (phone, emergency contacts,
ID/passport, medical) require a strong factor, not just an email link, before exposure.** NIST
SP 800-63B-4: synced passkeys = AAL2 (phishing-resistant, provided the sync fabric is
MFA-protected); device-bound = AAL3-capable. AAL2 via synced passkeys is the right target for a
volunteer non-profit. https://www.corbado.com/blog/nist-passkeys

**Managed-Neon comparison :** managed Neon Auth _does_ support email-OTP and
magic-link (both on its allowlist), so the low-friction passwordless fallback is achievable
even without moving. But **2FA/TOTP, backup codes, passkeys, HIBP, and CAPTCHA are all plugins
that are impossible on managed** — that gap is the core reason to self-host.
https://neon.com/docs/auth/guides/plugins

---

## 6. SECURITY HARDENING CHECKLIST

- **Rate limiting **— easily missed, highest value**:** enable Better
  Auth's limiter with `storage:'database'` (writes to a rate-limit table in our Neon DB) — do
  **NOT** use the default `memory` storage: each Vercel Lambda gets its own ephemeral memory,
  so an in-memory counter is per-instance and effectively resets, letting an attacker spread
  attempts across instances. Keep shipped rules (`/sign-in/email` = 3 req/10s;
  `/request-password-reset` likewise). Periodically prune expired rows (issue #4472: keys can
  accumulate without TTL cleanup). Rate limiting is **off in dev by default — must be explicitly
  on in production.** Upstash Redis secondary storage only if DB write volume grows.
  https://better-auth.com/docs/concepts/rate-limit ·
  https://github.com/better-auth/better-auth/issues/4472
- **Account lockout :** the limiter throttles but does NOT lock out. The spec's
  ≤10-consecutive-failure lockout is **our logic to build and test** on top.
- **Breach blocklist :** `haveIBeenPwned` plugin (k-anonymity — first 5 SHA-1 chars
  only, full password never leaves the server; free, no key, no rate limit; enable response
  padding 800–1000 records). Do NOT ship a bundled local list. Adds ~100–300ms to
  password-set/sign-up — **define failure behaviour for a HIBP outage: fail-open on
  availability, never fail-open on match.** https://better-auth.com/docs/plugins/have-i-been-pwned
- **Enumeration safety :** sign-in and reset are generic by default. **Sign-up is
  only enumeration-safe when `emailAndPassword.requireEmailVerification:true`** — the default
  posture is easy to miss and silently violates the spec. Set it (it also matches the supplier
  sign-up flow). https://better-auth.com/docs/authentication/email-password
- **CSRF / callbacks / reset-poisoning :** CSRF handled by default (Origin-header +
  SameSite=Lax + Sec-Fetch). Set `trustedOrigins` tightly (absolute URLs, no wildcards); NEVER
  set `advanced.disableCSRFCheck`. `callbackURL` is validated against `trustedOrigins` — the
  historic bypass (GHSA-vp58-j275-797x, CVSS 7.1, one-click ATO) was fixed in 1.1.21; staying
  patched is the control. Session fixation is not a default gap (fresh token on login, sessions
  server-side). Set `baseURL` explicitly (prevents Host-header reset poisoning) and **enable
  `revokeSessionsOnPasswordReset:true` — it defaults to FALSE**, and the spec requires all
  sessions invalidated on reset. https://better-auth.com/docs/reference/security
- **Security headers + CSP :** Next adds none by default. Ship
  `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`, a locked-down `Permissions-Policy`
  (camera/microphone/geolocation/payment), and a per-request **nonce CSP**
  (`script-src 'self' 'nonce-<n>' 'strict-dynamic'; object-src 'none'; base-uri 'self'`)
  generated in middleware (renamed "Proxy" in Next 16) and passed via `x-nonce`. **Trade-off:**
  nonce CSP forces dynamic rendering (disables static/ISR) — fine for auth-gated shells; use the
  experimental SRI path for any public/marketing route that must stay static.
  https://nextjs.org/docs/app/guides/content-security-policy
- **CAPTCHA :** Cloudflare Turnstile via the `captcha` plugin on `/sign-up/email`
  (default also covers `/sign-in/email`, `/request-password-reset`; client sends token in an
  `x-captcha-response` header). Free plan with **no published hard volume cap for standard use**
  (do not bank on ~1M solves/mo as a guaranteed threshold; Cloudflare could change terms and the
  free→Enterprise jump is steep — ), privacy-friendly, invisible for most
  users — fits the "calm UX" product law and POPIA (no data to Google, unlike reCAPTCHA).
  Plugin is self-host-only. https://better-auth.com/docs/plugins/captcha
- **Vercel platform :** treat built-in DDoS mitigation as baseline only. Vercel KV
  was discontinued (migrated to Upstash Redis Dec 2024). Prefer Neon-DB rate-limit storage
  first; Upstash only if DB write volume grows (free to 500K commands/mo, then $0.20/100K).
  Vercel WAF custom rate-limit rules are Pro+. https://vercel.com/docs/redis
- **Dependency posture :** self-hosting _improves_ this — it removes the
  `@neondatabase/auth 0.4.1-beta` wrapper for the plain pinned library, and gives us version
  control managed Neon does not (a bad managed internal build would be un-opt-out-able).
  Subscribe to the better-auth GHSA feed; never auto-upgrade auth; keep the plugin set minimal.
  **But** self-hosting inherits the CVE-patch treadmill (§9.6) — document the emergency
  un-pin procedure and name a GHSA-watch owner.
- **Encryption-at-rest hardening (POPIA s19 — see §8.4):** AES-256-GCM is
  sufficient as the primitive; the real risk is key management. The current scheme collapses to
  a single shared `PGCRYPTO_KEY` with a static scrypt salt and **no rotation path** — design an
  **envelope/versioned-key scheme now** (store a key-id prefix on each ciphertext) so a leaked
  key can be rotated without a migration nightmare, and protect `PGCRYPTO_KEY` at least as hard
  as `BETTER_AUTH_SECRET`.

---

## 7. OBSERVABILITY — NOT BUILT

Recorded as a gap, because three sections below point at it.

There is no metrics backend, no dashboard and no alerting. Failures surface as
Vercel runtime logs and nothing watches them. The consequences are specific and
worth stating rather than implying:

- **No failed-login-spike detector.** §8.10A's credential-stuffing runbook opens
  with "confirm the signal"; today that means reading logs by hand.
- **No alert on a `BETTER_AUTH_SECRET` drift**, whose symptom is every session
  dying at once (§9.7).
- **No success-rate or error-budget signal** on any auth flow.

The previous version of this section specified a Grafana Cloud Free deployment
in detail. It was never built, and a specification nobody implemented reads as
a description of reality to the next person — which is why it is a stub now.
Pick it up from `roadmap.md` when it is real work rather than a preference.

## 8. COMPLIANCE (POPIA) & INCIDENT RESPONSE

_(Grounded in cited SA legal commentary,
not legal advice; have someone with a POPIA mandate review before relying on it.)_

### 8.1 Lawful basis — choose contract / legitimate-interest, NOT consent

Do **not** ground the auth account and safety PII (phone, emergency contacts) on **consent** as
the primary lawful basis. Use POPIA **s11(1)(b)** — processing necessary to carry out the
participation agreement — and **s11(1)(d)/(f)** — protection of the data subject's / your
legitimate interests (emergency contacts and medical notes exist for on-playa safety). Reserve
**explicit consent only** for the genuinely discretionary sharing flow already isolated in the
design — the **accepted-officer registration that shares a phone with the org**. Consent is a
poor default: the responsible party bears the burden of proving valid consent and the subject may
withdraw it at any time, which would force deletion of safety-critical data mid-event. Document
the chosen basis **per field** in a processing register (§8.7). — https://werksmans.com/privacy-day-2026-moving-beyond-the-consent-myth-under-popia/

### 8.2 ID / passport numbers

**Collected under a named purpose, encrypted, and destroyed on a schedule.** An
identity number is personal information under s1, and collecting a high-risk
identifier with no live purpose is the textbook s10 minimisation violation — it
enlarges the breach-notification blast radius for nothing.

The rules, in force:

1. **A documented purpose or no collection.** The purpose is recorded in
   `accounts-security-spec.md` §ID document; absent one, the columns stay empty.
2. **Bounded retention** (s14) — destroyed after the edition, by rule in
   `@quagga/core` `id-retention.ts`. The purge job that acts on that rule is not
   yet wired.
3. **Never a login identifier, never a cross-system linking key.**
4. Encrypted at rest via pgcrypto, like every other field in this class.

**s57 prior authorisation is not triggered.** It bites only when a unique
identifier is processed for a purpose _other_ than intended **and** to link with
data held by other responsible parties. AfrikaBurn using its own-collected ID for
its own purposes fails the second limb.
([1](https://idchecker.co.za/popia-and-id-numbers/) ·
[2](https://popia.co.za/section-57-processing-subject-to-prior-authorisation/))

### 8.3 Medical notes — SPECIAL personal information

`burner_bios.medical_notes` is **special personal information (health)** under
POPIA s26/s27 — a stricter class than an ID number. Processing is prohibited by
default; the workable grounds are the subject's explicit consent (s27(1)(a)) or
protection of a vital interest.

1. **Consent at the point of entry.** The field's own label states who will be
   able to read it and why (on-playa safety). Disclosing it to an audience is
   what consents to that audience holding it — see `accounts-security-spec.md`.
2. **Encrypted at rest**, at least as strongly as ID/passport. The inversion this
   section used to describe — medical in plaintext while lower-risk ID was
   encrypted — is fixed: `medical_notes` is ciphertext, and is **dropped rather
   than persisted** when `PGCRYPTO_KEY` is unset.
3. **Never public, never in a list or an export.** Visible only on a member
   detail view, to that burner's own camp leads and org staff, and **audited on
   every read** (`@quagga/core` `medical-access.ts`).
4. In the sanitization null-set, so a deleted account leaves none behind.

([POPIA overview](https://getterms.io/blog/south-africa-protection-of-personal-information-act-popia))

### 8.4 Encryption-at-rest & key management

POPIA **s19** requires "appropriate, reasonable technical and organisational measures" — no
specific algorithm, so AES-256-GCM is comfortably sufficient. The exposure is **key management**:
(1) the scheme collapses to a single shared `PGCRYPTO_KEY` with no rotation path — build a
**versioned/envelope key scheme now** (key-id prefix on each ciphertext); (2) `scryptSync` with
a **static salt** means the key is fully determined by the env var — protect `PGCRYPTO_KEY` at
least as hard as `BETTER_AUTH_SECRET`; (3) **POPIA has NO encryption safe-harbour** — unlike
GDPR Art.34(3)(a), s22 has no "it was encrypted so you needn't notify" exemption, so encrypted-
then-leaked ID data may still require notification. Treat encryption as risk-reduction, not an
exemption. — https://usercentrics.com/knowledge-hub/popia-vs-gdpr/

### 8.5 Breach notification — POPIA s22

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
  notice, or news media. — https://popia.co.za/section-22-notification-of-security-compromises/ ·
  https://www.clydeco.com/en/insights/2022/08/popia-update-not-sure-how-to-report-a-data-breach

### 8.6 Data-subject rights vs the 14-day-grace + Lost-Cat sanitization design

The design maps cleanly to POPIA **Condition 8 (Data Subject Participation, ss23–25)** — keep it,
with three additions:

- **ACCESS (s23):** build a self-service data-export path so a burner can obtain what we hold
  (we already decrypt ID/passport via `@quagga/db` crypto, so an authenticated export is
  feasible).
- **CORRECTION (s24):** the profile edit flow already covers this.
- **DELETION (s24/s25):** sanitization (null personal fields, keep referential shape, tombstone
  `authUserId`) **satisfies POPIA erasure** — "destruction or deletion" targets the personal
  _information_, not the row; nulling every personal column plus the encrypted ID/passport
  achieves "no personal information remains." **Additions:** (a) the 14-day grace is fine as a UX
  cancel window, but ensure sanitization actually fires after it and the encrypted ID/passport
  columns are in the nulled set (confirmed present via `HARD_LOCKED_PRIVATE_FIELDS`); (b)
  corrections/deletions must be actioned "as soon as reasonably practicable" — don't let the
  sweeper silently stall (prove it ran); (c) offer a **manual erasure path for someone who
  cannot log in** (email request) — s24 rights are not conditional on self-service. — https://popia.co.za/section-23-access-to-personal-information/

### 8.7 Accountability artefacts — non-profit status gives NO relief

POPIA applies to non-profits **in full**; there is **no automatic exemption** — relief needs an
active **s37** application (a deliberate process, likely not worth it here). Stand up three cheap
artefacts **before real data lands**:

1. A **Records of Processing register** (a spreadsheet is fine) listing each PII field, its
   lawful basis, purpose, retention period, and who it can be shared with — this is also the
   exact document that resolves the ID/passport minimisation question (§8.2).
2. **Register AfrikaBurn's Information Officer** with the Information Regulator (default the
   CEO/head, delegable).
3. Publish a **PAIA/POPIA manual** (template-driven). — https://www.michalsons.com/blog/how-a-popia-exemption-can-help-your-non-profit/72095 ·
   https://bowmanslaw.com/insights/south-africa-100-days-left-to-become-popia-compliant-information-officers-and-guidelines-on-applications-for-prior-authorisation/

### 8.8 Retention _(POPIA s14 applies; the window itself is our choice)_

POPIA **s14** requires not keeping personal information longer than necessary — **no fixed
statutory number for security logs.** Adopt a **defined, documented retention (a 6–12 month
window for security-investigation logs is a defensible default )** plus a purge job,
aligned with the Lost-Cat sanitization model so deleted-account audit rows are **anonymised, not
orphaned.** Confirm a retention period **per PII class** (especially ID/passport and medical) so
s14 can be enforced by an automated purge after each edition. **Ryan must set the numbers (§11).**

### 8.9 Public-repo disclosure — security.txt + SECURITY.md

- **`/.well-known/security.txt` (RFC 9116) :** serve from `public/.well-known/` on the
  participant app's custom domain once the apex exists. REQUIRED: `Contact` (≥1; a `mailto:` such
  as security@afrikaburn.org or an https report form) and `Expires` (single ISO-8601, ~1 year
  out — **a stale Expires makes the file invalid**, so tie its refresh to the monthly report
  cadence). RECOMMENDED: `Policy` (→ SECURITY.md), `Canonical`, `Preferred-Languages: en`,
  `Acknowledgments`. Skip PGP signing for a volunteer team.
  https://www.rfc-editor.org/rfc/rfc9116.pdf
- **`SECURITY.md` at repo root _(best practice, not a POPIA requirement)_:** GitHub surfaces it in the Security tab
  and the "Report a vulnerability" UI. Contents: (1) supported scope (the three apps + `@quagga`
  packages; explicitly out-of-scope: third-party Neon/Vercel/Resend infra, social-engineering,
  physical); (2) **prefer GitHub Private Vulnerability Reporting** (free, keeps reports off public
  issues) + a security@ mailbox fallback; (3) an explicit **no-money-but-credit** safe-harbour
  promise (good-faith research won't be pursued legally + an Acknowledgments page) — the proven
  low-cost incentive without a bounty; (4) response SLAs volunteers can actually meet (acknowledge
  ≤5 business days, triage ≤10); (5) ask reporters not to access other users' PII and to delete
  any incidentally retrieved data. Triage via GitHub PVR → security@ alias to 2–3 maintainers →
  GitHub Security Advisories to coordinate a fix.

### 8.10 Incident runbooks

**A. Suspected credential stuffing.** (1) confirm signal (failed-login spike / many IPs vs many
accounts — from `audit_events` + the §7 dashboard); (2) tighten rate-limit/backoff, temporarily
drop the lockout threshold; (3) force password reset + revoke-all-sessions for accounts showing
successful logins in the attack pattern; (4) verify no god/org_staff account was hit (query
memberships); (5) re-enforce the HIBP blocklist on next login for suspected accounts; (6) if any
takeover touched PII → jump to the PII-exposure + s22 path. **Detection gap [open question]:**
confirm a real failed-login-spike detector is actually wired (the §7 dashboard alert is the
intended mechanism).

**B. Leaked secret.** Handle each distinctly. (1) **`BETTER_AUTH_SECRET` leak:** rotate in Vercel
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
self-hosted move (which unblocks TOTP/passkeys), at least for org/god accounts.**
**D. Accidental PII exposure.** (1) contain — take down/limit the exposing surface (revoke a bad
Vercel Blob URL, roll back the deploy, or disable the route via the kill-switch, §8.11); (2)
scope — exactly which fields and which subjects (any hard-locked field — phone, emergency contact,
medical, ID/passport — escalates severity); (3) **preserve evidence (logs, access records) before
rotating anything**; (4) run the s22 assessment (no materiality threshold → notify Regulator on
the mandatory template + affected subjects with the four required content elements); (5) if
public/cached, request removal and note it in the subject notice.

### 8.11 Kill-switch — build it now

On Vercel serverless there is no long-lived process to signal, so a kill switch must be **state
the request path reads on every invocation** (a DB row or edge config), not an in-memory toggle.
Build: (1) a global **read-only / maintenance flag** (DB-backed single-row config checked in
middleware) that disables writes and hides PII surfaces (directory, profile, exports) app-wide
**without a redeploy**; (2) a **per-capability disable** reusing the existing
`AUTH_CAPABILITIES`/`assertCapability` pattern so an incident can instantly flip e.g. "account
export" or "officer phone-sharing" to unavailable — this is the concrete second life for the
capability layer described above; (3) an emergency **revoke-ALL-sessions** broadcast (rotating
`BETTER_AUTH_SECRET` is the blunt version); (4) reuse the `ACCOUNT_SWEEP_SECRET` pattern for any
incident-only endpoint so it never runs unauthenticated or in a build. **Prefer DB-flag over env
for anything you need to flip in seconds** — env changes on Vercel need a redeploy.

### 8.12 Monthly security/health report _(best practice, not a POPIA requirement)_

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

### 8.13 Audit logging _(OWASP-grounded best practice)_

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

_(Actors, attack
paths, the privilege-escalation review of our own role model, tenant isolation / RLS, the parked-
IdP decisions, offline implications, and the invariant tests that mechanise the controls.)_

### 9.1 Threat actors & attack paths

| #   | Actor                                                                                         | Likelihood / impact                                                                                                           | Primary controls                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Opportunistic credential stuffing / password spraying** (public sign-in, all 3 apps)        | HIGH / MEDIUM (HIGH if a god/org_staff/lead account)                                                                          | HIBP breach-blocklist on password set + 15-char min (the single biggest defence); **`rateLimit.storage:'database'`** (the default in-memory store is per-lambda on Vercel = effectively bypassable — §6); enumeration-safe generic messages; 2FA for privileged accounts (self-host unblocks it)                                                                                                                                    |
| 2   | **Disgruntled camp member escalating privileges within their camp**                           | MEDIUM / MEDIUM (camp-scoped)                                                                                                 | `hasProjectPermission` lead/admin irrevocable backstop; `roleGrantsElevatedPrivileges` + escalation clause stop an `assign_roles`-only holder handing out (or self-assigning) a role carrying `manage_roles`/`manage_members`/captain. **Residual gap: confirm the SERVER role-assignment action actually calls `roleGrantsElevatedPrivileges` — the pure predicate exists but UI hiding is never the boundary (AGENTS.md rule 7)** |
| 3   | **Compromised camp lead account**                                                             | MEDIUM / HIGH in-camp (lead holds ALL project permissions irrevocably, sees member PII, issues invites, transfers leadership) | 2FA once self-hosted; **wire the new-device sign-in notification (builder exists but is unwired — needs a device-fingerprint column; for a lead it is the primary compromise tripwire)**; session list + revoke; **single-use `lead_transfer` invites (`invite.ts`, already in place)**; enforce a "last lead" guard (always ≥1 lead) mirroring the sole-lead deletion guard                                                        |
| 4   | **Scraping the burner directory / camp pages for PII**                                        | HIGH (public unauth surface) / MEDIUM-HIGH if phone/emergency/ID leak                                                         | `enforcePrivacyFlags` forces all `HARD_LOCKED_PRIVATE_FIELDS` false on every write; `listDirectory` hides free (unregistered) camps from non-members. Harden: apply the SAME strip at the future `/api/me` IdP boundary; add rate-limiting/pagination to directory + search; test that type-aheads never return free camps to strangers; confirm no email emitted for non-members                                                   |
| 5   | **Malicious supplier account** (self-service sign-up is a new untrusted-registration surface) | MEDIUM / MEDIUM                                                                                                               | `validateDocumentBinding`/`applyDocumentAcksToSteps` forbid a supplier-ticked checkbox from confirming an org-owned step (deposit/briefing/fee) — a supplier can never self-attest that money arrived; email verification before onboarding; `suppliers.code` UNIQUE-index arbiter (race-safe); scope suppliers to their own row only                                                                                               |
| 6   | **Rogue / compromised third-party OAuth integrator** (the PARKED IdP)                         | LOW now (unbuilt) / HIGH (an integrator key is a skeleton key to Burn identities)                                             | Not a today-risk, but three decisions must be locked NOW (§9.4). Overarching control when built: `/api/me` unconditionally strips hard-locked PII regardless of scope; coarse role claims only                                                                                                                                                                                                                                      |

### 9.2 Privilege-escalation review of our OWN role model

- **The god bootstrap (`GOD_EMAILS` + verified email)** is correctly closed: `canBootstrapGod`
  requires `emailVerified === true` AND membership on the `GOD_EMAILS` list. Without the verified
  gate, a self-service sign-up / unverified email-change / attacker-controlled OIDC `email`
  claim matching an unregistered god address would silently elevate. **KEEP IT as a tripwire
  test.** **Self-hosted-specific risk:** when social login or the IdP arrives, an OAuth provider
  asserting a god email as verified would elevate — so **god bootstrap must trust OUR
  verification, not a federated `email_verified` claim.** Gate god bootstrap to
  password+our-own-verification identities, or explicitly whitelist which verification sources
  count.
- **`org_staff`, structural lead/admin backstop, custom-role grants:** the backstop is _correct_
  for anti-lockout (a lead/admin can never be dropped below full permissions —
  `isPermissionBackstop` is unconditional), but it means a compromised lead is maximally
  powerful in-camp, which is why detection (device notifications) and 2FA matter most there
  (actor 3). Captain permissions are always coerced to `allProjectPermissions`
  (`enforceKindPermissions`) on every write.
- **Officer consent exposing phone:** `officerContactVisibleToOrg` is the SOLE gate and must be
  false for pending/declined and any non-officer; `resolveAudience` must never return a
  pending/declined officer to an org_officer audience; a camp cannot delete/rename an officer
  role.

**Invariant tests that MUST exist (pure `@quagga/core` predicates, cheap) :** (1)
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

### 9.3 One Postgres, many camps — isolation & the RLS question

Today isolation is **100% app-layer**: every store query filters by `groupId`/`userId` and `db`
connects with a single Neon connection string (owner-equivalent via the serverless HTTP driver),
so there is **NO database-level backstop.** Acceptable at our scale IF discipline holds, but the
risk is a single missing `WHERE groupId=…` clause silently cross-leaking camp data (classic
multi-tenant IDOR), and the pure-authz predicates being _correct_ does not prove the read/write
paths _invoke_ them.

**Mitigations short of RLS :** (a) a mandatory `requireMembership(userId, groupId)`
funnel that every camp-scoped read/write goes through (returns the role), so no query hand-rolls
its own filter; (b) adversarial cross-camp tests (attempt reads as a non-member, assert empty/403);
(c) treat every store function taking a `groupId` as security-sensitive in review.

**Is Neon RLS worth it? NOT now.** Neon RLS only enforces if you connect with a
**non-owner** role carrying a per-request JWT (`authenticatedRole`); the owner/`neondb_owner`
role **bypasses RLS entirely.** We connect server-side with one owner-equivalent string and do
all authz in trusted server code, so RLS would give nothing unless we re-plumb every request to
mint a scoped JWT and open a per-request role-scoped connection — a large change to `db.ts` and
every store, fighting the stateless HTTP driver we deliberately use. **RLS's value is enforcing
isolation when the query issuer is UNTRUSTED** (a browser Data API, an external integrator) — we
have no such issuer. **Revisit RLS only if the deferred "platform Data API" (Option C) ever lets
external consumers query Postgres directly.** https://neon.com/docs/guides/row-level-security

### 9.4 Parked IdP — decisions to lock NOW so it stays cheap

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
tokens + refresh rotation + JWKS; least-privilege scopes with hard-locked PII outside _all_
scopes. Validate the OAuth 2.1 Provider with a dedicated spike when Part 2 revives — it is new
(1.5, Feb 2026) with reported early bugs (issue #7558 class). Because the IdP is a separate
deployment it can run its own newer better-auth version.
https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/oauth-provider.mdx

### 9.5 Offline / on-site implications

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
the session TTL and offline-refresh behaviour must be chosen deliberately.

### 9.6 Self-hosting inherits the CVE-patch treadmill

Better Auth has a real track record: trustedOrigins bypass → ATO (GHSA-vp58-j275-797x, patched
1.1.21) and an email-verification open-redirect (GHSA-8jhw-6pjj-8723). Our 1.4.18 pin is not
affected, and managed Neon patched these silently. Once self-hosted **we own the watch.** The
AGENTS.md hard-pin (frozen because newer breaks typecheck) collides with this — a future critical
CVE could force an emergency un-pin under time pressure. Controls: subscribe to the GHSA feed /
enable Dependabot on the auth dep; **document the emergency-upgrade path now and name the GHSA-
watch owner**; `trustedOrigins` = explicit absolute URLs only, never wildcards.

### 9.7 Threat → control → invariant-test matrix

| Threat                                         | Control                                            | Invariant test                                                                | Status |
| ---------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- | ------ |
| A new privilege ships default-open             | fail-closed `hasProjectPermission`                 | authz completeness meta-test over `ProjectPermissionKey.options`              |        |
| Hard-locked PII leaks via a new public surface | projections strip off `HARD_LOCKED_PRIVATE_FIELDS` | run populated bio through every registered projection, assert no locked key   |        |
| A phone leaks outside the officer path         | `officerContactVisibleToOrg` sole gate             | assert only that fn surfaces phone, only on `{isOfficer,consent:'accepted'}`  |        |
| god silently self-elevates                     | `canBootstrapGod` verified-email gate              | assert false for any unverified email; refuse federated `email_verified`      |        |
| `assign_roles` holder self-grants admin        | `roleGrantsElevatedPrivileges` escalation clause   | assert an assign_roles-only member cannot assign an elevated role             |        |
| A new route ships with no authz check          | server-enforced predicates (AGENTS.md 7)           | route census: every route calls a predicate or is in reviewed `PUBLIC_ROUTES` |        |
| Camp A reads Camp B                            | app-layer `requireMembership` funnel               | adversarial cross-camp read test asserts empty/403                            |        |
| An existing migration is edited/deleted        | append-only discipline                             | git-diff status check M/D fails                                               |        |
| A build script runs migrate against prod       | AGENTS.md rule 1                                   | grep build scripts + turbo build task                                         |        |
| Credential stuffing / brute force              | DB-backed rate limit + lockout + HIBP + CAPTCHA    | Better Auth flow tests + lockout test                                         |        |
| In-memory rate limit silently non-functional   | `rateLimit.storage:'database'`                     | assert config; integration test lockout survives across instances             |        |
| User enumeration                               | generic messages + `requireEmailVerification`      | enumeration-safety tests on sign-in/sign-up/reset                             |        |
| Password reset doesn't kill sessions           | `revokeSessionsOnPasswordReset:true`               | flow test: reset invalidates all sessions                                     |        |
| Plaintext backup codes at rest                 | `storeBackupCodes:'encrypted'`                     | assert config + no plaintext in DB                                            |        |
| `BETTER_AUTH_SECRET` drift logs users out      | single documented source                           | operational — observability alert on success-rate drop (§7.5)                 |        |
| Passkey scoped to subdomain, un-widenable      | rpID = apex from day one                           | config assertion rpID === apex                                                |        |
| Audit `meta` captures tokens/PII               | scrubbing boundary                                 | assert scrubber strips known-sensitive keys                                   |        |
| Supplier self-attests an org-owned step        | `validateDocumentBinding`                          | assert a supplier ack can't confirm a deposit/briefing/fee step               |        |

---

## 10. WHAT WE DELIBERATELY DO NOT BUILD

- **No stateless-JWT-only sessions.** Breaks revocation the security spec requires.
- **No proxy/central-auth-server topology** (one app hosting `/api/auth` for the others). Breaks
  server-enforced authz and adds a single point of failure.
- **No Postgres RLS now.** A no-op under our owner-role connection; a full re-plumb for no threat
  we actually have. App-layer authz + adversarial tests instead. Revisit only for a future direct
  -to-Postgres external consumer (Option C).
- **No bundled local breach-password list.** HIBP range API is free, current, keyless.
- **No SMS 2FA.** SIM-swap + cost. TOTP + backup codes only.
- **No passkey-first / passkey-only** at launch — device fragmentation + recovery hazard.
  Passkeys are an optional accelerator.
- **No device-held attestation keypairs in the MVP.** Keep the `profile_keys` placeholder; do NOT
  ship the QR handshake until the logistics phase — a half-built non-repudiation system on a
  server-held key gives false assurance.
- **No self-hosted secrets/HSM for the key-encryption-key.** Use the platform env / Vercel-managed
  secret; don't hand-roll KMS.
- **No custom crypto anywhere.** Rely on Better Auth + WebAuthn/TOTP standards.
- **No collecting more PII to "enable" security features.** Fewer forms is a product law; e.g. no
  SMS-requiring flows.
- **No self-hosted LGTM observability stack, and no paid Vercel Observability Plus** for auth.
  Grafana Cloud free tier.
- **No dependency on UptimeRobot Free** for production monitoring — non-commercial-only TOS.

- **No Redis/Upstash at launch.** DB-backed rate limiting first; Redis only if volume demands.

- **No OAuth 2.1 Provider / "Sign in with AfrikaBurn" IdP on the critical path now.** Parked
  (Part 2); a separate deployment on its own newer better-auth version when Part 2 revives.

- **No storing ID/passport numbers by default** — collect only on an explicit, documented,
  minimised decision with a named downstream purpose (§8.2).
- **No pursuing a POPIA s37 non-profit exemption** — likely cheaper and lower-risk to just comply
  with baseline duties for a data-holding auth platform.

---

## 11. OPEN DECISIONS

Still open, and each one blocks or shapes something below. Items resolved since
this list was written have been removed rather than left ticking.

| #   | Decision                                                                                                                                                                                                                    | Blocks                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | **A custom apex domain.** `*.vercel.app` is on the Public Suffix List, so it can carry neither a shared session cookie nor a passkey `rpID` wider than one subdomain.                                                       | Cross-app sign-on; cross-app passkeys (§9.4)          |
| 2   | **Retention windows per PII class** (§8.8). POPIA s14 gives no statutory number; 6–12 months is suggested for security logs. Needs numbers plus a purge job.                                                                | Automated purge; the accountability artefacts in §8.7 |
| 3   | **CAPTCHA scope** — sign-up only, or sign-in and reset too.                                                                                                                                                                 | The rate-limit story in §6                            |
| 4   | **Whether org and god accounts MUST enrol a second factor.** Policy, not capability: 2FA and passkeys both ship today.                                                                                                      | §9.2                                                  |
| 5   | **Vercel plan (Hobby vs Pro).** Determines WAF custom rules, Attack Challenge Mode, and Protection-Bypass-for-Automation — without which Playwright-against-preview is a paid dependency. Hobby is also non-commercial-use. | CI; the WAF half of §6                                |
| 6   | **Passkey `origin`: single string or array.** Decides whether three mounted instances share one passkey table or need a central auth service. Needs a spike.                                                                | §9.4                                                  |
| 7   | **Named owner for the GHSA watch** (§9.6). Self-hosting inherits the CVE-patch treadmill; a treadmill with no name on it stops.                                                                                             | Emergency un-pin procedure                            |

**Closed since:** the identity/profile table boundary (Better Auth's `user`
table sits beside `users`); the version pin (1.6.25); rate-limit storage
(database, shared across lambdas); whether to keep the capability layer (kept,
as the kill-switch surface in §8.11); whether 2FA and passkeys are launch
requirements (both shipped); ID/passport storage (collected under a documented
lawful purpose, pgcrypto-encrypted); and the medical-notes encryption inversion
(fixed — `medical_notes` is ciphertext, and is dropped rather than persisted
when `PGCRYPTO_KEY` is unset).
