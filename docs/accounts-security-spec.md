# Account Management & Security — Feature Spec

*Ryan, 24 Jul 2026; auth section rewritten 27 Jul 2026 to describe what we actually
run. Full account-management suite across all three apps, plus the supplier portal's
sign-up and org-managed supplier documents. Grounded in NIST SP 800-63B-4 (Jul 2025)
and OWASP auth guidance.*

---

## What we run (READ FIRST)

**Self-hosted Better Auth, pinned to 1.6.25 exactly.** It is configured once in
`packages/auth` and mounted in-process by each of the three apps at
`/api/auth/[...all]`, against our own Postgres. The auth tables are ours, owned by
`packages/db` (migration 0013 brought them in-house; 0015 added the two-factor and
passkey tables).

**Managed Neon Auth is gone.** Nothing imports `@neondatabase/auth` and no
`NEON_AUTH_*` variable is read anywhere. Self-hosting is what removed the managed
provider's fixed-subset limitation, and it is why every capability below is a real
server call rather than a deferral. The migration and its reasoning are in
[`auth-platform-spec.md`](auth-platform-spec.md); it has been executed.

`better-auth` must **never** be auto-bumped — it has a track record of high-severity
auth advisories and we now own the CVE-patch watch (AGENTS.md §3).

### Capability matrix — every one of these is supported

The machine-readable authority is `AUTH_CAPABILITIES` in
`packages/core/src/auth-capabilities.ts`; `assertCapability()` is the fail-closed
gate. Every key in it is currently `supported`.

| Capability | Backed by |
| --- | --- |
| Password change | `auth.api.changePassword` |
| Password reset (request + reset) | `auth.api.requestPasswordReset` / `resetPassword`; a reset ends every session |
| Email verification | `auth.api.sendVerificationEmail` / `verifyEmail` |
| Session list | `auth.api.listSessions` (database sessions) |
| Session revoke (one / others / all) | `auth.api.revokeSession` / `revokeSessions` / `revokeOtherSessions` |
| Linked sign-in methods | `auth.api.listUserAccounts` + `accountInfo` |
| Unlink sign-in method | `auth.api.unlinkAccount` — our own guard still refuses unlinking the last method. **NOT WIRED YET (27 Jul 2026):** nothing in the app calls it, so the control ships disabled with an honest explanation (`AUTH_CAPABILITIES.unlinkAccount.pending`). |
| Email change | `auth.api.changeEmail`, with our 48h revocation window and POPIA state machine on top. **NOT WIRED YET (27 Jul 2026):** the three server actions have no caller and the confirm/revoke links have no route, so the control ships disabled with an honest explanation (`AUTH_CAPABILITIES.emailChange.pending`). Organisers change an address from the console meanwhile. |
| **2FA / TOTP** | the `twoFactor` plugin (migration 0015) — enable → scan → verify; plugin lockout at 10 fails / 15 min |
| **Backup codes** | inside the `twoFactor` plugin, stored **encrypted**; ten single-use codes shown once, regenerable |
| **Passkeys** | `@better-auth/passkey` (migration 0015), `rpID` scoped to the apex so one passkey works across all three apps |
| Account deletion | ours: 14-day grace + sweeper, which sanitizes app rows **and** hard-deletes the Better Auth identity |

Two things that gate on **delivery**, not on capability: password-reset mail and the
email-change confirmation both need `RESEND_API_KEY`. Without a mail provider,
verification is derived OFF and those flows present as honestly unavailable — the
capability is supported, the delivery is not configured. `/system` in the org console
reports which of the two is the case.

**The rule this preserves: nothing in the codebase may fake an unsupported
capability.** A surface for an unavailable capability renders an honest "not available
yet" state and its action fails closed — never a silent no-op that looks like success,
and never a "your X changed" notification for a change that did not happen. Today
nothing is unavailable, so `assertCapability` is a guard with no live refusals; keep
it, because the next capability added starts life unsupported.

**Passkeys and 2FA are additive, never the only way in.** Password and Google stay
primary, so a lost authenticator or a lost passkey is never a dead end — recovery is a
password or a 2FA backup code.

---

## Security principles (the law for every auth surface)

- **Passwords**: minimum 15 characters (single-factor), accept ≥64; **no composition
  rules, no forced rotation, no confirm-twice** — one password field with a
  show-password toggle and paste allowed; length-based strength feedback; breach
  blocklist check on set (haveibeenpwned k-anonymity or local list).
- **Rate limiting & lockout**: DB-backed throttling in `@quagga/auth`, raisable for a
  test deployment via `AUTH_RATE_LIMIT_WINDOW_SECONDS` / `AUTH_RATE_LIMIT_MAX` (never
  set these on a real deployment); the `twoFactor` plugin's own account lockout at 10
  failed codes / 15 minutes guards the verify endpoints.
- **No user enumeration**: sign-in, sign-up, and forgot-password all return generic
  messages ("If that account exists, we've emailed it").
- **2FA**: TOTP via authenticator apps + one-time backup codes (regenerable, shown
  once, stored encrypted). SMS explicitly excluded (SIM-swap + cost). **Passkeys
  shipped** alongside it in migration 0015 (synced passkeys = AAL2 per NIST); both are
  additive to password/Google, never the only way in.
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

## Surfaces (built in `apps/web`; the 2FA/passkey pieces are shared from `@quagga/ui`)

- **/account — Manage My Account**: username, email (change flow per above), linked
  sign-in methods: password (set/change), Google (link/unlink — cannot unlink the last
  method), passkeys list.
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
- **org staff** (`org_staff` / `god`) — AfrikaBurn's safety/ops tier, any burner.
  **The `engineer` rank is deliberately NOT in this set** and must never be added: it is
  the console's IT rank, it holds no care duty that would need the notes, and the org
  capability matrix (`@quagga/core` `org-permissions`) refuses it personal information
  unconditionally;
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
unlogged disclosure*. Fail-open is the right call for this path: an emergency medic
read must never be blocked by an audit write.

**The trail is a record, not monitoring.** Its job is to answer *"who saw my medical
information?"* if a burner asks, and to let a real incident be reconstructed. That is
all it is for.

There is deliberately **no volume threshold, no per-actor profiling and no alerting**,
and none should be added. An earlier build shipped an enumeration detector that flagged
any account reading 8+ distinct burners' notes in an hour. It was removed on 26 Jul 2026
because the premise was wrong: **reading a lot of medical notes in one sitting is what
the job looks like.** A safety lead working out what to prepare for on site goes through
every member of a camp in one pass. Flagging that reports ordinary care as an incident,
buries any real signal in false positives, and — worst — teaches the people we most need
reading this information that the tool is watching them. That makes burners less safe,
not more. If a detector is ever wanted again it is a product decision with a stated
threat model, not a refactor.

What exists now:

- **`apps/org/lib/medical-audit.ts`** — `getMedicalAccessLog` (30-day window, actor
  email + subject display name resolved, capped at 500 rows) and `getAuditTrail` (the
  whole trail). Plain, chronological, no derived judgement.
- **`/audit` in the console** (`guardConsole` → any org rank) — the who/whose/when
  table and the full activity list. It shows **who looked at whose notes, never the
  notes**; reading the trail is not a disclosure, so it writes no audit row of its own.
  **The medical panel needs `read_personal_information` IN THE `audit` DOMAIN**
  (27 Jul 2026), so an `engineer` is refused it by their rank's carve-out and a
  department-scoped lead is refused it unless their department owns the audit log — the
  log spans every camp, so a grant over one department is not a grant over a
  console-wide census. Either way `bio.medical.view` rows are filtered out of their
  general trail too. A row only
  exists when its subject HAS notes, which makes the list a census of who has disclosed a
  health condition — the same bulk exposure the member roster refuses to carry. There is
  no redacted version of that list which is not still that list, so it is withheld whole
  and the page says so.
- **Medical reads are excluded from the six-row glance feed** (`FEED_EXCLUDED_ACTIONS`
  in `apps/org/lib/status-board-format.ts`, applied in SQL) — one camp's worth of reads
  would otherwise evict every registration decision from that card. They are not hidden;
  `/audit` carries them, and `activityLabel` renders `bio.medical.view` as English
  rather than leaking the raw key.

**No rate limit, on purpose.** A throttle on this path fails closed in an emergency,
which is the outcome the whole consent-at-entry model refuses.
(Regression: `apps/org/lib/__tests__/medical-audit-surface.test.ts`, which pins the
absence of aggregation/alerting as well as the presence of the record.)

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

## Rollout — done

1. ~~Design pass~~ — frames drawn and reviewed.
2. ~~Implementation~~ — Better Auth plugin wiring, shared account components, supplier
   docs schema + UIs, notification emails and the test suite all landed.
3. ~~Phase 2: passkeys~~ — shipped with 2FA in migration 0015, not deferred.

## Build status (updated 27 Jul 2026)

**Landed — schema + backend + core logic:**

- Migration **0013**: the Better Auth tables, brought in-house off managed Neon Auth.
- Migration **0015**: `two_factor` + `user.two_factor_enabled` + `passkey`. This is
  what turned 2FA, backup codes and passkeys from deferred into shipped.

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

**Closed since the 25 Jul snapshot:**

- `/account`, `/account/security`, `/account/delete` all ship in `apps/web`
  (`apps/web/components/account/*`), with the 2FA enrolment, passkey management and
  2FA sign-in challenge components shared from `@quagga/ui`
  (`account-two-factor.tsx`, `account-passkeys.tsx`, `account-two-factor-challenge.tsx`).
- The org **`/suppliers/signup-management`** console page is live.
- The supplier portal's **`/signup`** and redesigned **`/signin`** both exist.
- **2FA / backup codes / passkeys** — shipped (migration 0015). No longer blocked on
  anything.

**Open seams (still true, deliberate):**

- **New-device sign-in notification** builder exists but is not wired: it needs a
  per-account record of seen device fingerprints to avoid firing on every session,
  and that column does not exist yet. It fires on nothing rather than on everything.
- **The account surfaces are only mounted in `apps/web`.** Neither `apps/org` nor
  `apps/suppliers` has an `/account` route; both carry `/auth/*` only. Since SSO spans
  the apex, a burner manages their account on the web app and it applies everywhere —
  but an org-only or supplier-only user currently has no in-app way to change their
  password or enrol 2FA.
- **The ID-retention purge job** is unwired: only the pure rule and its tests exist
  (see §ID document below).
