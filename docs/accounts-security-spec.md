# Account Management & Security — Feature Spec

*Ryan, 24 Jul 2026. Full account-management suite across all three apps, plus the
supplier portal's missing sign-up and org-managed supplier documents. Grounded in NIST
SP 800-63B-4 (Jul 2025) and OWASP auth guidance; implementation rides Better Auth 1.4's
native plugins (2FA/TOTP, passkeys, password reset, email verification, delete-account).*

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

## Rollout

1. Design pass (all frames, both accents + supplier sage): supplier sign-up + sign-in,
   Account/Manage, Account/Security (2FA enrolment states), Account/Delete, forgot
   password pair, org Supplier sign-up management, supplier Documents panel.
2. Implementation after design review: Better Auth plugin wiring (2FA server+client,
   requestPasswordReset, email verification, delete flow with grace job), shared
   account components, supplier docs schema + UIs, notification emails, tests
   (enumeration-safety, lockouts, sanitization integrity, sole-lead guard).
3. Phase 2 (queued, not now): passkeys.
