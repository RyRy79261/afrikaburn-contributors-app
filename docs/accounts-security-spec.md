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

## ID document — lawful purpose + bounded retention (Ryan, 26 Jul 2026)

SA ID / passport on `burner_bios` are collected for **one documented purpose:
on-site identity verification against the ticket at the gate** — confirming the
person arriving is the ticket holder. They are always private (hard-locked, never
public, never shown to other camps), AES-256-GCM encrypted at rest, and used for
nothing else. This is the lawful basis that makes the collection POPIA-defensible;
it is documented in `schema.ts` on the `sa_id_encrypted` / `passport_encrypted`
columns.

**Bounded retention.** Because the purpose is spent once the gate closes, this
data is **purgeable after an edition ends** (POPIA storage-limitation). The rule
lives in `@quagga/core` `id-retention` (pure, tested): an edition's ID data ages
out `ID_RETENTION_GRACE_DAYS` (30) after its end date — a small grace for late
arrivals and gate/access reconciliation — and `identifyPurgeableIdBios` returns
the bios still holding ID data for expired editions, to which a purge applies
`buildIdPurgePatch()` (`{ sa_id_encrypted: null, passport_encrypted: null }`).
**Wiring a scheduled purge job that applies this is a LATER task** — only the pure
rule + tests exist now (mirroring how the deletion sweeper stayed out of the build
until deliberately triggered).

**Medical notes** are also encrypted at rest now (POPIA s26/27 SPECIAL personal
information), fixing an earlier inversion where lower-risk ID data was encrypted
while medical was plaintext. Same treatment as ID: encrypted on write, decrypted
for the owner on read, and dropped rather than stored plaintext when no key is
configured. The `medical_notes` column stays `text`, so this needed **no
migration** — only the write/read code in `apps/web/lib/bio-store.ts`.

## Medical notes — consent at the point of entry (Ryan, 26 Jul 2026)

Medical notes are **never public**, but they are **visible** to the audience the
burner disclosed them to. Ryan's correction, which supersedes the short-lived
break-glass design of the same day: *"These would be similar to how burn currently
manages medical data — if you disclose it, aren't you consenting to that audience
to hold that data?"* AfrikaBurn already runs this on paper: you write your medical
info on a form knowing the safety team and your camp hold it. **The disclosure is
the consent.** A reason prompt adds friction at exactly the wrong moment — an
emergency — without adding protection, so there is none.

**What is still absolutely locked.** Phone, both emergency contacts, SA ID and
passport stay `HARD_LOCKED_PRIVATE_FIELDS` with **no access path of any kind** —
unchanged. Nothing here weakened them.

**The consent control is the field's own label.** `MEDICAL_AUDIENCE_NOTE`
(`@quagga/core` `bio.ts`) is the single string that states the audience — *"Your
camp leads and AfrikaBurn's safety team can see this. It's here so someone can help
you if something goes wrong on site."* It is rendered wherever medical is captured
or edited: the onboarding bio flow, the profile editor (same `BioFlow` component),
the privacy-review lock reason (`BIO_PRIVACY_FIELDS` → `medical.lockReason`), and
the code questionnaire definition's helper. Because that label is now the
load-bearing privacy control, a test asserts it names both audiences — if it stops
doing so, the consent basis is gone.

**Who may see it** (pure predicate `canViewMedicalNotes` in `@quagga/core`
`medical-access.ts`, fail-closed):
- the owner (their own notes);
- **org staff** (`org_staff` / `god`) — AfrikaBurn's safety/ops tier, any burner;
- a **camp lead/admin** — but only for a member of a camp *they* lead. A lead of
  camp A is refused for a member of camp B (the lead-camp id set must intersect the
  subject's camp ids). Custom project roles do NOT grant it — structural leads only.

Server-side authz is the boundary; UI hiding never is. The predicates are the same
ones the break-glass design used — only the ceremony around them is gone.

**Detail views only — never lists or exports, and no has/has-not signpost either.**
Notes render on a member's DETAIL view and nowhere else: `/burners/[id]` in
`apps/web` (resolved by `resolveMedicalNotesForViewer` in
`apps/web/lib/medical-access.ts`) and `/registrations/[id]/members/[userId]` in
`apps/org` (resolved by `getRosterMemberDetail`). Casual bulk exposure — forty
people down a roster, or a CSV — is a different risk from purposeful access, so the
roster query deliberately never selects the notes.

**Authorise, then select.** Both detail resolvers run the access predicate
*before* the query that would read the column, and pass the answer in:
`resolveMedicalNotesForViewer` checks `canViewMedicalNotes` and only then reads
`burner_bios`, and `getRosterMemberDetail` takes an explicit
`includeMedicalNotes` flag that its caller derives from the same predicate. On a
refusal the ciphertext is never loaded, so there is no plaintext in render scope
for a later careless edit — a debug dump, a widened props object — to ship in an
RSC payload. Deciding *after* the decrypt would leave correctness resting on a
conditional in the JSX.

The org roster briefly rendered a *"Medical notes on file" / "No medical notes"*
signpost per row. **That is gone** (26 Jul 2026), because it was the same leak in
miniature: whether a NAMED person has declared a health condition is itself
special-category-adjacent under POPIA s26, and a column of it hands a reviewer a
complete census of who has disclosed — obtained in one server-rendered page load,
with **no `bio.medical.view` audit row written for any of it**, which is exactly the
bulk scan the detail-view-only rule exists to prevent. AGENTS.md:108-111 already said
"never in a list, roster, **card** or export"; the code now agrees with it.
`RosterMemberRow` carries no medical field and `getRegistrationRoster` never selects
`medical_notes`, so there is nothing left for a later edit to leak
(`apps/org/lib/__tests__/roster-privacy.test.ts` fails if either returns).

The cost is real and was weighed: without the signpost, staff who want to know
whether a camp has disclosures must open member pages. That is the intended
friction — each of those opens is authorized and *recorded*, which the signpost was
not. **If Ryan rules the other way**, the amendment belongs in AGENTS.md:109 first
("the notes themselves are never listed; a has/has-not signpost is"), and the
signpost read should then write its own audit row; it must not reappear as a silent
divergence from the stated law.

**Encrypted at rest.** Unchanged: AES-256-GCM on write, decrypted on read, dropped
rather than stored plaintext when no key is configured, erased on account deletion
(POPIA erasure — `SANITIZED_BIO_NULL_FIELDS`).

**Every disclosing read is audited.** When a detail view resolves someone else's
non-empty notes it writes an `audit_events` row: `action = "bio.medical.view"`,
actor, subject, `meta.basis` (`self` / `org_staff` / `camp_lead`), timestamp. The
write happens in Next's `after()` — **off the critical path**, so the audit can
never block or slow the read (an emergency read must not wait on a log row), and a
failed insert is logged, not surfaced. Reading your own notes is not an access
event and is not audited; an empty field discloses nothing and is not audited.

**The audit FAILS OPEN, and that is deliberate — so the reader is the control.**
Because the insert runs in `after()`, the notes are already rendered and streamed
before the row is attempted, and a failed insert is swallowed to `console.error`: a
dropped serverless instance, a DB blip or a constraint failure yields a *silent,
unlogged disclosure*. Fail-open is the right call for this path (an emergency medic
read must never be blocked by an audit write), which means **prevention is not the
control here — detection is**, and detection only exists if something reads the rows.

Until 26 Jul 2026 nothing did. `getRegistrationDecisionLog` filters
`subject = registrationId`, and medical rows carry a *user* id, so they never appeared
there; the only other reader was the overview's six-row `getRecentActivity`, unfiltered
and unlabeled. "Enumeration stays detectable" was aspirational. What closes it:

- **`@quagga/core` `medical-audit.ts`** — pure derivations over the rows.
  `detectMedicalEnumeration` flags an actor who read **8 or more DISTINCT burners'**
  notes inside a **1-hour sliding window** (`MEDICAL_ENUMERATION_SUBJECT_THRESHOLD` /
  `_WINDOW_MS`). The signal is distinct subjects, never read volume — a medic
  re-opening one patient ten times is not enumeration, and flagging it would train
  staff to ignore the alert. `summarizeMedicalAccess` adds reads / actors / subjects /
  last-read.
- **`apps/org/lib/medical-audit.ts`** — `getMedicalAccessLog` (30-day window, actor
  email + subject display name resolved, capped at 500 rows), `getMedicalAccessGlance`
  (the cheap roll-up) and `getAuditTrail` (the whole trail).
- **`/audit` in the console** (`guardConsole` → god / org_staff) — the alert banner,
  the who/whose/when table, and the full activity list. It shows **who looked at whose
  notes, never the notes**; reading the trail is not a disclosure, so it writes no
  audit row of its own.
- **A standing alert on the Overview and Status board** (`MedicalAccessStrip`) so a
  burst is visible without anyone thinking to visit `/audit`.
- **Medical reads are excluded from the six-row glance feed** (`FEED_EXCLUDED_ACTIONS`
  in `apps/org/lib/status-board-format.ts`, applied in SQL). One roster walk emits
  dozens of rows in a minute and would evict every registration decision from that
  card. They are not hidden — `/audit` shows them with the alerts a six-row card could
  never carry — and `activityLabel` now renders `bio.medical.view` as English instead
  of leaking the raw key.

**No rate limit, on purpose.** The anti-enumeration limiter is not coming back: a
throttle on this path fails closed in an emergency, which is the outcome the whole
consent-at-entry model refuses. The trade is stated plainly — the read always
succeeds, and the abuse is *seen*.
(Regression: `packages/core/src/__tests__/medical-audit.test.ts` and
`apps/org/lib/__tests__/medical-audit-surface.test.ts`.)

**No per-view notification.** Removed deliberately. Notifying a burner every time
their camp lead opens their profile is noise, not consent — the consent was given
at entry, in writing, with the audience named.

## Security events log (the "recent security events" feed)

The `/account/security` feed reads a real append-only `security_events` table
(migration 0014), not the `notifications` table. Every already-firing account
action records an event thinly and best-effort (`recordSecurityEvent` in
`apps/web/lib/account-actions.ts` — a failed insert never breaks or rolls back the
primary action): password changed, password reset completed, single-session
revoke, sign-out-everywhere, email change requested/confirmed/revoked, deletion
requested/cancelled. Each row stores the typed `kind` plus request context
(`ip`, `user_agent`, both nullable); display titles come from `@quagga/core`
`describeSecurityEvent` so no strings live in the DB. The captured IP/user-agent
is personal data, so `security_events` is one of the sanitization **purged**
tables (erased with the account, POPIA erasure). New-device sign-in alerts remain
unwired (no device-fingerprint record); the active-session list is the check.

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
- Migration **0014** (append-only): `security_events` (the real security-events
  log the feed reads) + `section_review_replies` (camp-side replies under a section
  review). No column change was needed to encrypt medical notes — `medical_notes`
  was already `text`, so the encryption landed in code only.
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
