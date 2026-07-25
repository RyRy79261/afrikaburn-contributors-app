# Account Management & Security — Feature Spec

*Ryan, 24 Jul 2026. Full account-management suite across all three apps, plus the
supplier portal's missing sign-up and org-managed supplier documents. Grounded in NIST
SP 800-63B-4 (Jul 2025) and OWASP auth guidance; implementation rides Better Auth 1.4's
native plugins (2FA/TOTP, passkeys, password reset, email verification, delete-account).*

---

## ⚠️ Provider capability probe — 25 Jul 2026 (READ FIRST)

**This spec was written against stock Better Auth 1.4. We do not run stock Better
Auth.** We run **managed Neon Auth** ("Managed Better Auth"), which happens to run
better-auth 1.4.18 internally but where **Neon owns the server configuration and
does not allow custom Better Auth plugins**. Every plugin-delivered capability in
the spec above is therefore outside our reach until Neon ships it.

The machine-readable authority is `AUTH_CAPABILITIES` in
`packages/core/src/auth-capabilities.ts`; `assertCapability()` is the fail-closed
gate. **Nothing in the codebase may fake an unsupported capability** — a surface
for an unavailable flow renders an honest "not available yet" state and its action
refuses; it never silently no-ops and never emits a "your X changed" notification
for a change that did not happen.

| Capability | Verdict | Where it comes from |
| --- | --- | --- |
| Password change | ✅ **supported** | server `changePassword` |
| Password reset (request + reset) | ✅ **supported** | server `requestPasswordReset`, `resetPassword` |
| Email verification | ✅ **supported** | server `sendVerificationEmail`, `verifyEmail` |
| Session list | ✅ **supported** | server `listSessions` |
| Session revoke (one / others / all) | ✅ **supported** | server `revokeSession`, `revokeSessions`, `revokeOtherSessions` |
| Linked sign-in methods (list) | ✅ **supported** | server `listAccounts`, `accountInfo` |
| Account deletion (identity) | ✅ **supported** | server `deleteUser` |
| **Email change** | ⚠️ **client-only / unverified** | `changeEmail` exists on the browser client, is ABSENT from the server endpoint allowlist, and Better Auth gates it behind a server option we cannot set. Also has no 48h revocation window. |
| **Unlink sign-in method** | ⚠️ **client-only / unverified** | `unlinkAccount` on the client only; absent server-side |
| **2FA / TOTP** | ❌ **UNAVAILABLE** | no plugin on a managed instance |
| **Backup codes** | ❌ **UNAVAILABLE** | ships inside the 2FA plugin |
| **Passkeys** | ❌ **UNAVAILABLE** | no plugin; not on Neon's roadmap |

**Evidence** (`@neondatabase/auth` 0.4.1-beta, installed):

1. The SDK's `supportedBetterAuthClientPlugins` list is exactly: `anonymous-token`,
   `better-auth-client`, `admin(-client)`, `organization`, `email-otp`,
   `magic-link`, `jwt`. **No two-factor. No passkey.**
2. `grep -ric 'twoFactor|totp|backupCode|passkey|webauthn'` over the SDK's three
   type-declaration bundles returns **0 for every term**.
3. The server helper's typed endpoint allowlist (`API_ENDPOINTS`, the source of
   `NeonAuthServer = Pick<VanillaBetterAuthClient, ServerAuthMethods>`) contains
   change-password, request/reset-password, send-verification-email, verify-email,
   list-sessions, revoke-session(s), revoke-all-sessions, update-user, delete-user,
   list-accounts, account-info — and **not** change-email, link-social, or
   unlink-account.
4. `neon.com/docs/auth/guides/plugins`: supported plugins are Admin, Email OTP,
   JWT, Magic Link, Organization, Open API, Phone Number; "you **don't install or
   configure Better Auth plugins directly**".
5. `neon.com/docs/auth/roadmap`: **"MFA support — coming soon."**
6. `docs/platform-architecture-spec.md` Part 2 already recorded the same boundary
   from the IdP research.

### Consequences for this spec

- **2FA/TOTP + backup codes are DEFERRED, blocked on the provider**, not on us.
  The `/account/security` surface ships the seam and the honest unavailable state.
  When Neon ships MFA: re-run the probe, flip `twoFactor`/`backupCodes` to
  `supported` in `AUTH_CAPABILITIES`, and build the enrolment flow behind it.
- **Passkeys** (already phase 2) are likewise provider-blocked.
- **2FA-as-re-auth for deletion is not available**, so deletion re-auth is
  password-only.
- **Email change is OURS.** `email_change_requests` (migration 0011) records the
  request, the confirmation, and the 48h revocation window — all of which the
  provider would not give us anyway. The final commit at the identity provider is
  gated by `assertCapability("emailChange")` and currently **refuses**: the burner
  is told plainly that the switch isn't live, and no row is marked confirmed. When
  a server-side `change-email` appears, that one guard flips and the commit lands.
- **Deletion sanitization is ours regardless.** `deleteUser` removes the identity
  at Neon; erasing our application rows is the POPIA-relevant step and belongs to
  `@quagga/core` `buildSanitizationPlan` + `apps/web/lib/account-sanitize.ts`.

---

## Security principles (the law for every auth surface)

- **Passwords**: minimum 15 characters (single-factor), accept ≥64; **no composition
  rules, no forced rotation, no confirm-twice** — one password field with a
  show-password toggle and paste allowed; length-based strength feedback; breach
  blocklist check on set (haveibeenpwned k-anonymity or local list).
- **Rate limiting & lockout**: throttle with backoff, lockout after ≤10 consecutive
  failures; Better Auth's 2FA lockout (5 wrong codes) as shipped.
- **No user enumeration**: sign-in, sign-up, and forgot-password all return generic
  messages ("If that account exists, we've emailed it").
- **2FA**: TOTP via authenticator apps + one-time backup codes (regenerable, shown
  once). SMS explicitly excluded (SIM-swap + cost). **Passkeys** are the phase-2
  upgrade within this suite (plugin ready; synced passkeys = AAL2 per NIST).
- **Recovery**: email reset links — single-use, short-lived, enumeration-safe; all
  sessions invalidated on reset; notification sent on completion.
- **Email change**: confirm via the NEW address, notify the OLD address with a
  revocation link, changes revocable for 48h.
- **Sessions**: visible active-session list (device, approximate location, last seen);
  revoke one or all; new-device sign-in notification email.
- **Security notifications** (Resend): password changed, 2FA enabled/disabled, email
  change requested/completed, new device sign-in, deletion requested.
- **Deletion**: re-auth to request (password or 2FA) → **14-day grace period**
  (cancelable by simply signing in) → then **sanitization, not row deletion** (the Camp
  404 "Lost Cat" precedent): personal fields erased/anonymized to a stub so memberships,
  responses, and audit history keep referential integrity; POPIA erasure satisfied.
  Constraints: a sole camp lead must transfer leadership first (guided); a supplier
  account with in-flight onboarding warns the org. Org god accounts cannot self-delete
  while they are the only god.

## Surfaces (shared Account section, packaged once in @quagga/ui patterns, mounted in all three apps)

- **/account — Manage My Account**: display name, email (change flow per above), linked
  sign-in methods: password (set/change), Google (link/unlink — cannot unlink the last
  method), passkeys list (phase 2).
- **/account/security — Security**: 2FA setup (QR enrol → verify → backup codes shown
  once → regenerate), active sessions with revoke, recent security events feed.
- **/account/delete — Delete My Account**: consequences list (what is erased, what is
  anonymized, what the camp/supplier impact is), re-auth, grace-period explanation,
  final confirm. Calm, honest, not dark-patterned — but not accidental either.
- **Forgot password**: request page + reset page (both apps' auth areas).

## Supplier portal sign-up (currently missing — sign-in only exists)

Proper registration screen: business name, contact person, email, ONE password field
(show toggle, 15+ chars, strength feedback), service category select, rules
acknowledgement checkbox ("I've read the supplier basics"), then email verification →
lands in onboarding. Sign-in screen redesigned to match. No opt-in checkbox litter.

## Supplier documents — org-controlled (the "supplier sign-up management" section)

- **Org console → Supplier sign-up management**: CRUD the per-edition list of documents
  and links suppliers must read/download — title, source (external URL or uploaded file
  via Blob), `required_ack` flag, sort order, optional binding to an onboarding step
  (e.g. the Supplier Agreement doc binds to `agreement_signed`).
- **Supplier portal**: a Documents panel on the onboarding page — read/download links;
  `required_ack` docs carry an acknowledgement checkbox whose state feeds the bound
  onboarding step.
- Schema: `supplier_documents` (edition_id, title, url/blob_ref, required_ack, step_key
  nullable, sort) + `supplier_document_acks` (supplier_id × document_id, acked_at).
  **Landed in migration 0011.**
- **Binding rule (enforced in `@quagga/core` `validateDocumentBinding`):** a document
  may only bind to a step the supplier completes THEMSELVES. Binding to an
  org-confirmed step (deposit, briefing, registration fee) or an org-reviewed step
  (inventory, crew) is rejected — a supplier ticking a checkbox must never be able
  to confirm that money arrived or that they attended a briefing. Reconciliation
  (`applyDocumentAcksToSteps`) re-applies the same guard at apply time, and works in
  both directions: withdrawing an acknowledgement reverts the bound step, and adding
  a new required document re-opens it.

## Supplier reference code — `SUP-2027-0416`

`suppliers.code`, added in migration 0011. **Stored, not derived**: the code leaves
the platform (depot gate lists, delivery manifests, the supplier's own paperwork), so
once issued it is a promise — a derived code would silently re-key itself when a
business renamed or a sheet re-imported. Suppliers also carry no stable per-edition
ordinal to derive a sequence from. Format `SUP-{YYYY}-{NNNN}` is deterministic
(`@quagga/core formatSupplierCode`); only sequence allocation touches the database,
and `suppliers.code UNIQUE` is the arbiter of the allocation race.

## Rollout

1. Design pass (all frames, both accents + supplier sage): supplier sign-up + sign-in,
   Account/Manage, Account/Security (2FA enrolment states), Account/Delete, forgot
   password pair, org Supplier sign-up management, supplier Documents panel.
2. Implementation after design review: Better Auth plugin wiring (2FA server+client,
   requestPasswordReset, email verification, delete flow with grace job), shared
   account components, supplier docs schema + UIs, notification emails, tests
   (enumeration-safety, lockouts, sanitization integrity, sole-lead guard).
3. Phase 2 (queued, not now): passkeys.

## Build status (task #8, 25 Jul 2026)

**Landed — schema + backend + core logic:**

- Migration **0011** (append-only): `supplier_documents`, `supplier_document_acks`,
  `account_deletion_requests`, `email_change_requests`, `suppliers.code`,
  `users.sanitized_at`. Partial unique indexes keep exactly one *pending* deletion
  and one *pending* email-change per user, while allowing a burner who cancels to
  request again.
- `@quagga/core`: `auth-capabilities`, `account-security` (password policy,
  enumeration-safe messaging, deletion grace state machine, email-change state
  machine, the three guards), `account-sanitization` (the Lost Cat plan),
  `security-notifications` (inbox + Resend bodies), `supplier-code`,
  `supplier-documents`.
- `apps/web`: `lib/account.ts` (sessions, linked methods, guard context),
  `lib/account-actions.ts` (password change/reset, session revoke, email-change
  request/confirm/revoke, deletion request/cancel), `lib/account-sanitize.ts` (the
  sanitizer + sweeper), `lib/account-tokens.ts`, and the
  `POST /api/account/deletion-sweep` trigger (refuses to run without
  `ACCOUNT_SWEEP_SECRET` — it never runs unauthenticated, and never in a build).
- `apps/suppliers`: Documents panel wired live (the `supplier-documents-panel` seam
  is closed), ack action with step reconciliation, supplier-code issuance on
  self-registration.
- `apps/org`: supplier-document CRUD server actions (org-gated, audited) +
  `listSupplierDocuments` with ack counts.

**Open seams (deliberate, documented):**

- `/account`, `/account/security`, `/account/delete` **pages** and the shared
  `@quagga/ui` account patterns await the design pass (rollout step 1). The backend
  they call is complete; `accountCapabilities()` gives the security page its honest
  unavailable states.
- The **org "Supplier sign-up management" console page** likewise awaits design —
  its CRUD actions are built and gated.
- **Supplier portal sign-up screen** redesign (spec §"Supplier portal sign-up") is
  not part of this task.
- **New-device sign-in notification** builder exists but is not wired: it needs a
  per-account record of seen device fingerprints to avoid firing on every session,
  and that column does not exist yet. It fires on nothing rather than on everything.
- **2FA / backup codes / passkeys**: provider-blocked, see the probe above.
- **Mounting the account surfaces in `apps/org` and `apps/suppliers`**: `apps/web` is
  the reference implementation; the other two mount the same components once the
  shared UI patterns land.
