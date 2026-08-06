# The delegated-identity decision — "the relay ticket"

The synthesis that `01`–`06` implement, from a judged panel of four rival designs.

---

TOOL_LAYER_OK — precheck read, 4 lines, `packages:`. Facts below re-derived from source, not inherited.

---

# THE DECISION — "The Relay Ticket"

## 1. THE DESIGN IN ONE PARAGRAPH

An integrator holds one long-lived secret — its own key, `ab_ik_…`, which is a **ceiling with no principal** and reaches nothing but `public:*`. Every request that can name a burner must additionally carry a **relay ticket**, `abrt_…`, which is not a credential in itself but a 256-bit pointer at a row whose foreign key is the burner's live `session.id` (`packages/db/src/schema.ts:376-396`). The ticket is minted only on `app.quagga.ryanjnoble.dev`, behind the existing `requireCampUser()` gate, by a click on a consent screen we render — so presence is the browser's own httpOnly cookie reaching our own handler, not an assertion anyone can type. On every `/v1` request one SQL statement joins ticket → consent → integration → **`session`** → `users`, with the key's hash **inside the `WHERE` clause**, so a ticket minted for app A is structurally invisible to app B's key and "wrong app" and "no such ticket" are the same empty result set. That join yields a narrowed scope set — `ticket ∩ consent ∩ ceiling`, which can only ever _subtract_ — and the end user's `users.id`, which is then handed to the unchanged `@quagga/core` predicates that are the only thing in the system capable of _granting_ anything. Because `/v1` lives inside `apps/web`, the medical endpoint calls `resolveMedicalNotesForViewer` — the same exported function `apps/web/app/(app)/burners/[id]/page.tsx` calls — with one extra parameter that flips its `after()` fail-open audit into a blocking fail-closed one, so there is exactly one implementation of the sharpest read in the product and the API is a _caller_ of it, not a peer. Sign-out, `revokeSessionsOnPasswordReset`, and POPIA sanitization all hard-delete `session` rows, and `ON DELETE CASCADE` does the rest in the same statement: revocation is a foreign key, not a job.

---

## 2. DECISIONS TABLE

| #   | Decision                          | Choice                                                                                                                                                      | Rejected                                                                                                                                                      | Reason                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Delegation mechanism              | Relay ticket: opaque pointer at a live `session` row, presented **alongside** the integration key                                                           | OAuth 2.1 via `@better-auth/oauth-provider`                                                                                                                   | Zero new dependencies, so the 1.6.25 pin and the env-less boot law in `packages/auth/src/config.ts` are untouched by construction; and `node_modules` is absent here, so no plugin claim is verifiable                                                                                                                       |
| 2   | Where presence is proven          | `requireCampUser()` on a page inside `apps/web/app/(app)/`                                                                                                  | A new auth path, step-up plugin, or device flow                                                                                                               | Inherits password/passkey/2FA, existing rate limits and `security_events` writes for **zero new authentication code**                                                                                                                                                                                                        |
| 3   | Consent screen delivery           | Top-level navigation only                                                                                                                                   | iframe / silent-refresh frame                                                                                                                                 | `config/security-headers.mjs:18-19` sets `frame-ancestors 'none'` + `X-Frame-Options: DENY`; that header exists because the console was framable and must not be weakened                                                                                                                                                    |
| 4   | Audience binding                  | The key hash is a term in the resolver's `WHERE` clause                                                                                                     | A comparison after the lookup                                                                                                                                 | A check somebody can forget vs. a join that cannot return the wrong row — and it removes the wrong-app oracle for free                                                                                                                                                                                                       |
| 5   | Ticket renewal                    | **Server-to-server re-mint** (key + expiring ticket → new ticket), capped by `min(session.expires_at, granted_at + 24h)`                                    | session-bridge's browser navigation every ≤15 min                                                                                                             | A full-page navigation destroys SPA state silently; the session row is the authority either way, so the navigation bought friction and no security on non-disclosing scopes                                                                                                                                                  |
| 6   | Silent ticket minting on GET      | **Deleted.** Every ticket originates from an explicit click, or from a server re-mint                                                                       | session-bridge's `if (covered && !restricted)` silent 302                                                                                                     | A credential mint reachable by navigation, gated by a _denylist_, is one forgotten `RESTRICTED_SCOPES` entry from being wrong. Decision 5 removed the need for it entirely                                                                                                                                                   |
| 7   | Which scopes may be re-minted     | Positive allowlist `RENEWABLE_SCOPES`, table-tested over all 50 strings                                                                                     | Denylist                                                                                                                                                      | Same reasoning that keeps `personal_information` _absent_ from the console grid rather than greyed out                                                                                                                                                                                                                       |
| 8   | `org:*` delegability              | **Not expressible.** `isDelegableScope` rejects the prefix                                                                                                  | Delegable with a static ceiling (token-exchange, capability-tokens) or a consent screen (oauth-provider)                                                      | Deletes the service user, `users.kind` (a column that does not exist — verified `schema.ts:283-306`), both service-user invariants, the `personal_information`-on-the-grid problem, and the insider-issues-themselves-a-key path                                                                                             |
| 9   | Sponsor-rights staleness          | Live re-resolution of `loadOrgActor(sponsor)` is written as the **precondition on ever making `org:*` delegable**, not built now                            | Building it now                                                                                                                                               | With no rank-derived authority in a ceiling there is nothing to go stale; building the mechanism for a class that does not exist is speculative                                                                                                                                                                              |
| 10  | Scope vocabulary                  | 49 → **50**. One new string `bio:medical:read`, in a fifth namespace `bio:` with exactly one member                                                         | `camp:medical:read` (breaks the 1:1 derivation from `ProjectPermissionKey`; medical for a lead is decided by the _structural_ role, not a project permission) | A separate namespace makes "medical is a higher tier" structurally enforceable — its own tier, its own TTL rule, never renewable — rather than a convention in a list                                                                                                                                                        |
| 11  | Ticket tiers                      | Standard 900s, re-mintable · **Disclosing 120s, single-use, never re-mintable**                                                                             | One TTL                                                                                                                                                       | Friction lands exactly where it is justified and nowhere else                                                                                                                                                                                                                                                                |
| 12  | Key + ticket storage              | sha256 **hex** via `hashToken` from `apps/web/lib/account-tokens.ts:26`, reused verbatim                                                                    | New hashing, bcrypt/argon2, HMAC, HKDF                                                                                                                        | 256 uniform bits have no dictionary; the repo already has the primitive and the written reasoning. `auth-platform-spec.md`: no custom crypto anywhere                                                                                                                                                                        |
| 13  | Array columns                     | `jsonb().$type<string[]>()`                                                                                                                                 | `text[]`                                                                                                                                                      | Verified: **zero** `text[]` columns exist in `packages/db/src/schema.ts`. A foreign convention landing permanently on an append-only chain is a cost with no benefit                                                                                                                                                         |
| 14  | Ceiling representation            | `ceiling jsonb` on `integrations`, every change writing an `audit_events` row with `{before, after}`                                                        | A row-per-scope `integration_scopes` table                                                                                                                    | House pattern: `org_roles.permissions` is jsonb, and `org.department.domains` already audits `{before, after}`. Three tables instead of four                                                                                                                                                                                 |
| 15  | Scope → guard wiring              | `GUARDS: { readonly [S in Scope]: Guard }` — exhaustive mapped type                                                                                         | A CI source scan for `export const scopes`                                                                                                                    | A scope with no guard should fail `tsc`, not a grep. Keep the scan as belt                                                                                                                                                                                                                                                   |
| 16  | Liveness logic                    | Pure exhaustive `relayRefusal(facts, tier, now): RelayRefusal \| null` in `@quagga/core`, 100/100/100/100 floor                                             | Inline `if`s in the resolver                                                                                                                                  | A reviewer can enumerate every way a call dies with no DB and no mocking; fail-closed by construction because every arm is a refusal                                                                                                                                                                                         |
| 17  | Refusal codes on the wire         | **Two buckets**: `reconnect_required` (401) and `invalid_credentials` (401), plus `insufficient_scope` / `not_found` / `audit_unavailable` / `rate_limited` | Nine distinct codes (oracle) · one code for everything (undebuggable)                                                                                         | The four causes in `reconnect_required` all have the identical correct integrator response, so naming the bucket leaks nothing actionable; distinguishing _which_ would tell a thief whether the burner personally revoked                                                                                                   |
| 18  | Cookie on `/v1`                   | Deleted **twice**: `apps/web/middleware.ts` (does not exist today — verified) and again in the wrapper                                                      | One in-handler strip                                                                                                                                          | C3 is invisible in testing because cookie-subject and ticket-subject are usually the same person; two independent strips, one outside the handler                                                                                                                                                                            |
| 19  | Medical read implementation       | `/v1` **calls** `resolveMedicalNotesForViewer`, ~20-line `via?` diff                                                                                        | Reimplementing decrypt + three-state + audit in a route handler (all three losers do this)                                                                    | One implementation cannot drift from itself. No anti-drift test needed for the sharpest read in the system                                                                                                                                                                                                                   |
| 20  | Medical audit on the API path     | **Blocking, fail-closed.** No row, no body                                                                                                                  | `after()` fail-open, as first-party                                                                                                                           | The fail-open is justified by a medic at a screen (`apps/web/lib/medical-access.ts`, verbatim: _"nobody should wait on a log row to find out someone is diabetic"_). That does not transfer to an HTTP round trip retryable in 40ms, and the whole basis for disclosing to a party with no membership is that it is recorded |
| 21  | Audit action string               | `bio.medical.view`, unchanged                                                                                                                               | `bio.medical.view.api`                                                                                                                                        | A variant drops out of `getMedicalAccessLog`'s filter and back _into_ `getAuditTrail` for actors without `personal_information` in `audit` — creating an unfiltered disclosure census for the one rank that must not have one                                                                                                |
| 22  | Audit actor                       | The **end user's** `users.id`                                                                                                                               | The integration or a service user                                                                                                                             | `audit_events.actor_id` is `uuid REFERENCES users(id) ON DELETE SET NULL` (verified `schema.ts:1712-1714`) — the column type already enforces the law. The app goes in `meta`, ids only                                                                                                                                      |
| 23  | `meta` contents                   | ids, enums, `requestId` only                                                                                                                                | names, emails, counts, rates, risk scores, thresholds                                                                                                         | The POPIA scrubber is a literal three-key subtraction; anything else is permanent and un-scrubbed. And AGENTS.md forbids monitoring — an enumeration detector was built and deliberately removed                                                                                                                             |
| 24  | Burner-facing medical log         | `/account/medical-access` is a **blocking prerequisite** of `bio:medical:read`                                                                              | Ship the scope, add the page later                                                                                                                            | Verified: `apps/web` has no such reader; the only one is `getMedicalAccessLog` in `apps/org` behind `personal_information` in `audit`. Opening a third-party disclosure channel while the burner can only find out by emailing a volunteer is not shippable                                                                  |
| 25  | CORS                              | None. Integrators call `/v1` server-side only                                                                                                               | Per-integration origin allowlist                                                                                                                              | The browser half of the SDK only sets `location.href` and reads `location.hash`; it never calls `/v1`. A public-client tier is a separate, later, deliberate decision                                                                                                                                                        |
| 26  | Ticket delivery to the integrator | URL **fragment**, cleared via `replaceState`                                                                                                                | Query string                                                                                                                                                  | Never reaches a CDN, proxy or access log, and sidesteps referrer policy entirely                                                                                                                                                                                                                                             |
| 27  | Rate limiting                     | `action_rate_limit` via `consumeRateLimit`; keys `ip`, `integration`, **`integration:subject`**                                                             | better-auth's `rate_limit`                                                                                                                                    | `schema.ts:453-461` records that Better Auth sweeps that table unfiltered and it cost the password-reset budget. The third key exists because under delegation the resource is a _person_                                                                                                                                    |
| 28  | Migration shape                   | **One** migration, 0029, three tables, no `ALTER TABLE` on anything existing                                                                                | Two migrations · seven tables · `users.kind` · plugin-generated DDL                                                                                           | Latest is 0028 (verified). Applied at deploy against production, no staging, no second attempt                                                                                                                                                                                                                               |

---

## 3. THE THREE-WAY INTERSECTION — the definitive mechanism

### 3.1 It is two stages, and they are different in kind

The most important correction to how this has been described: **the end user's rights are not a set of scope strings**, and projecting them into one is exactly the second authorisation path we are avoiding.

```
STAGE 1 — THE SCOPE GATE.  Set math. Cheap. Can ONLY subtract.
  admissible = ticket.scopes ∩ consent.scopes(live) ∩ integration.ceiling(live)
  ⇒ 403 insufficient_scope

STAGE 2 — THE RIGHTS GATE.  The decision. Unchanged @quagga/core predicates,
  over an actor loaded LIVE from the DB for the END USER.
  canViewMedicalNotes / hasProjectPermission / orgCanInDomain
  ⇒ 404 not_found  (existence-opaque)
```

Scopes narrow; predicates decide; neither can widen the other. Because stage 1 only ever subtracts, the delegated answer is **provably a subset** of the first-party answer for the same human. That is Ryan's law as a structural property rather than a review promise.

### 3.2 Where each term is resolved, in order

| Term                  | Resolved     | From                                                                                                                      | Cacheable |
| --------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------- | --------- |
| **key ceiling**       | request time | `integrations.ceiling`, in the join                                                                                       | never     |
| **consented scopes**  | request time | `integration_consents.scopes`, `revoked_at IS NULL` in the join                                                           | never     |
| **ticket scopes**     | request time | `integration_tickets.scopes` — a _narrowing hint_, never an authority                                                     | never     |
| **presence**          | request time | `JOIN "session" s ON s.id = t.session_id`, `s.expires_at > now()`                                                         | never     |
| **END USER's rights** | request time | `loadOrgActor` / `loadCampPermissions` / `loadMedicalAccessContext` from `packages/db/src/actors.ts`, keyed on `users.id` | **never** |

Nothing is a token claim. Nothing is a manifest claim. There is no sweep job, and there must never be one — a job's schedule would become the security boundary.

### 3.3 The pure half — `packages/core/src/delegation.ts`

```ts
export const DELEGABLE_SCOPE_PREFIXES = [
  "self:",
  "camp:",
  "bio:",
  "public:",
] as const;

/** `org:*` IS NOT DELEGABLE — not "not issued by default", NOT EXPRESSIBLE.
 *  Org-rank authority is the console's authority, and the burner clicking a
 *  consent screen is not the party whose rights are at stake for an org
 *  capability. PRECONDITION, if this ever changes: the resolver must first
 *  recompute orgCanInDomain(loadOrgActor(sponsorUserId), cap, domain) LIVE on
 *  every request, or a demoted sponsor leaves a live ceiling that outlives them. */
export function isDelegableScope(s: string): boolean;

export type ScopeTier = "public" | "standard" | "disclosing";
export function scopeTier(s: Scope): ScopeTier; // total over all 50
export const RENEWABLE_SCOPES: readonly Scope[]; // positive allowlist; excludes bio:*

/** THE INTERSECTION. Returns a narrowed VOCABULARY, never an "allowed".
 *  Branchless set math: there is nothing here that can say yes. */
export function effectiveScopes(i: {
  ceiling: readonly Scope[];
  consented: readonly Scope[];
  requested: readonly Scope[];
}): Scope[];

export type RelayRefusal =
  | "no_ticket"
  | "unknown_ticket"
  | "ticket_expired"
  | "ticket_consumed"
  | "session_ended"
  | "consent_revoked"
  | "renewal_window_closed"
  | "key_revoked"
  | "integration_suspended"
  | "subject_sanitized"
  | "empty_intersection";

/** Total, exhaustive, fail-closed: every arm is a refusal, and the null default
 *  is reached only when all of them pass. 100/100/100/100 floor — a tripwire,
 *  not a measurement: anything that fails it is a predicate someone smuggled in. */
export function relayRefusal(
  f: RelayFacts,
  tier: ScopeTier,
  now: Date,
): RelayRefusal | null;
```

`RelayRefusal` is **internal**. On the wire it collapses to two buckets (§4.4). It surfaces in full in the org console's Activity tab and in server logs — the places where the reader is already trusted.

### 3.4 The impure half — one query, one file

`apps/web/lib/v1/relay.ts`, `resolveRelayCaller(headers)`. One statement:

```sql
SELECT t.*, c.scopes AS consent_scopes, c.revoked_at, i.*, s.expires_at AS session_expires_at,
       u.id AS end_user_id, u.sanitized_at
  FROM integration_tickets  t
  JOIN integration_consents c ON c.id = t.consent_id
  JOIN integrations         i ON i.id = c.integration_id
  JOIN "session"            s ON s.id = t.session_id      -- ← presence, as a join
  JOIN users                u ON u.id = c.user_id
 WHERE t.token_hash = $ticketHash
   AND ( i.key_hash = $keyHash
      OR ( i.previous_key_hash = $keyHash AND i.previous_key_expires_at > now() ) )
 LIMIT 1
```

The key term is in the `WHERE`, so audience binding is a join. `createHttpDb()` has no transactions (verified `packages/db/src/index.ts:34-39`), so every fact that must be mutually consistent is established in one statement rather than a sequence a concurrent revoke could split.

### 3.5 How it reaches the existing predicates without a second authz path

The wrapper's only power is `403` and `401`. It holds no rights, resolves no roles, reads no memberships. Every `200` still requires a `@quagga/core` predicate to return `true` inside the handler:

```ts
export const GUARDS: { readonly [S in Scope]: Guard } = {
  "bio:medical:read": async (c, t) => {
    const ctx = await loadMedicalAccessContext(
      db(),
      c.endUserId,
      t.subjectUserId,
    );
    return canViewMedicalNotes(ctx) ? allow({ ctx }) : refuse();
  },
  "camp:view_member_details": async (c, t) => {
    const m = await loadCampMembership(db(), t.groupId, c.endUserId);
    return m && hasProjectPermission(m, "view_member_details")
      ? allow()
      : refuse();
  },
  // … one line per scope, every line a call into @quagga/core
};
```

A scope added without a guard does not compile.

### 3.6 The prerequisite that makes the first term sound — `packages/db/src/actors.ts`

Three call sites want an `OrgActor` from a `users.id`, and two of them **disagree today**. Verified verbatim at `apps/web/lib/medical-access.ts`:

```ts
rank: orgRankFromRole(actorOrgRole) ?? "org_staff",
```

`apps/org/lib/session.ts` treats the same `null` as _forbidden_. Coercing it to the rank with no carve-outs is precisely how an `engineer` — for whom `ENGINEER_RANK_CARVE_OUTS` makes `personal_information` unreachable _by rank, however their roles are written_ — gets past a ceiling the console enforces.

And the fold above it, also verbatim:

```ts
// "the outcome does not depend on row order"   ← the comment
if (!isOrgStaffRole(actorOrgRole)) actorOrgRole = row.role;
```

`ORG_STAFF_ROLES` is `{god, org_staff}` (`packages/core/src/medical-access.ts:56-62`), so an `engineer` **is** overwritten by a later `member` row. The comment is false and the existing regression test uses `god`, so it structurally cannot fail on this.

`packages/db` already imports `@quagga/core` and the reverse is forbidden, so `packages/db/src/actors.ts` is the one place all three apps and `/v1` can share:

```ts
loadOrgActor(db, dbUserId): Promise<OrgActor | null>   // NULL when orgRankFromRole is null. FAILS CLOSED.
loadCampPermissions(db, dbUserId, groupIds?)
loadMedicalAccessContext(db, viewerUserId, subjectUserId)  // domain-scoping to "registrations" INTACT
```

`resolveOrgSession`, `buildMedicalAccessContext` and `/v1` all call these. **Fix, do not copy.** If the extraction preserves the coercion, this entire document is a scoping exercise around an open door.

---

## 4. PROOF OF PRESENCE

### 4.1 Established at mint time

| Leg                                                            | Proves                                                                                                 | Why it cannot be forged                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Top-level navigation to `app.quagga.ryanjnoble.dev/connect`    | the burner's own httpOnly cookie, on our origin, reached our handler                                   | no cookie spans registrable domains; Camp 404 can neither mint nor read it |
| `requireCampUser()`                                            | the full existing ladder — password / passkey / TOTP — plus existing rate limits and `security_events` | zero new authentication code exists to get wrong                           |
| Not an iframe                                                  | the burner sees our URL bar and our copy                                                               | `frame-ancestors 'none'` + `X-Frame-Options: DENY` on `/:path*`, verified  |
| `redirect_uri` exact `includes()` against the registered array | the ticket lands where a System manager registered it                                                  | `===` semantics only; no `startsWith`, no regex, no wildcard, CI-pinned    |
| Approve is a **server action**, never a GET                    | a credential mint is not reachable by navigation                                                       | decision 6                                                                 |
| `sanitized_at IS NULL` re-checked                              | the account is not a tombstone                                                                         | the same re-animation guard all three session resolvers carry              |

### 4.2 Re-established on every single request

`session.expires_at > now()`, as a `JOIN`. Not a claim to be checked — a table in the `FROM` clause. No join, no row, no answer. The 300s signed cookie cache is irrelevant because we read the row, not the cookie.

### 4.3 Established by a foreign key, not by code

```sql
ALTER TABLE integration_tickets ADD CONSTRAINT integration_tickets_session_id_fk
  FOREIGN KEY (session_id) REFERENCES "session"(id) ON DELETE CASCADE;
```

Verified, all three paths: sign-out and `revokeSessions` delete `session` rows; `revokeSessionsOnPasswordReset: true` is set explicitly in `packages/auth/src/config.ts`; and `SANITIZATION_IDENTITY_TABLES = ["session","account","user"]` are **hard-deleted** (`packages/core/src/account-sanitization.ts:211-215`). Postgres does the rest in the same statement. There is no propagation window and nothing to remember to call.

### 4.4 What we refuse

| Refused                                                 | Because                                                                                                                                                                                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any request body field naming a subject                 | the subject is a **column on a row the burner wrote**. CI scans for the absence of `subjectUserId` in request-parsing position anywhere under `app/api/v1/**`                                                                                                       |
| `Origin` / `Referer` as an authorisation input          | `curl -H 'Origin: …'` defeats it in one flag                                                                                                                                                                                                                        |
| The apex session cookie                                 | deleted twice — `middleware.ts` and the wrapper — with a **transitive import-graph** CI scan, because four stores reach `getCurrentCampUser` one call deeper                                                                                                        |
| A ticket presented without a key, or with the wrong key | the join returns nothing; indistinguishable from "no such ticket"                                                                                                                                                                                                   |
| Re-minting a `bio:*` ticket                             | not in `RENEWABLE_SCOPES`; every medical read costs a fresh, deliberate click                                                                                                                                                                                       |
| Re-minting after `renewable_until`                      | `min(session.expires_at, granted_at + 24h)`. One navigation a day, maximum                                                                                                                                                                                          |
| Distinguishing _why_ on the wire                        | two buckets: `reconnect_required` = {`ticket_expired`, `session_ended`, `consent_revoked`, `renewal_window_closed`} — all four have the identical correct integrator response, `startConnect()`. `invalid_credentials` = everything else, byte-identical, CI-pinned |

**What this does not prove, stated plainly:** that a human is at the keyboard at that millisecond. It proves the burner's session was alive at the instant of the read and that they clicked Approve within the ticket's lifetime — ≤120 seconds for medical. That is the strongest honest claim available without per-read re-authentication, which would make the emergency path unusable.

---

## 5. THE MEDICAL PATH END TO END

Nomsa leads Camp Dusty and runs her roster in Camp 404. A member collapses.

**Hop 1 — Camp 404's client.** Its own state says the current ticket carries `camp:view_member_details` only. `ab.as(ticket).bio.medical(id)` would be a compile error — the method is not on the type — so it calls `startConnect({ scopes: ["bio:medical:read"], returnTo: location.href })`, which persists an opaque caller blob and sets `location.href`.

**Hop 2 — `/connect` on our origin.** `requireCampUser()`. She is signed in; if not, `redirect("/auth/sign-in?next=…")`. Integration loaded by slug; `status === "active"`; `redirect_uri` exact-matched; every requested scope passes `isDelegableScope` and is present in `integrations.ceiling`. A scope outside the ceiling renders a generic refusal that never says _which_ — no ceiling probe.

**Hop 3 — the screen.** `scopeTier("bio:medical:read") === "disclosing"`, so there is no shortcut of any kind. The screen renders the integration's **registered** name and sponsoring department out of the database — never anything the request supplied — and the `MEDICAL_AUDIENCE_NOTE` copy the bio form already shows, verbatim:

> **Camp 404** wants to see medical information for members of camps you lead.
> This is the same information you can see on AfrikaBurn. Every time Camp 404 reads it, we record it against **your** name — not Camp 404's — because you are the one who is allowed to look, and the person can see that record. Access lasts two minutes and cannot run in the background.
> Camp 404 keeps its own copy of anything you share. Disconnecting stops new access; it cannot delete what they already have.

**Hop 4 — Approve.** A server action. Upserts `integration_consents` (unique on `(user_id, integration_id)`, `revoked_at → NULL`, scopes replaced not unioned — re-consenting to less genuinely reduces the grant). Inserts `integration_tickets` with `session_id` from `auth.api.getSession`, `single_use = true`, `expires_at = now + 120s`, `renewable_until = NULL`. Writes `audit_events` `integration.consent.granted` (ids only) and a `security_events` row. 302 to `redirect_uri#ticket=abrt_…&state=…&ctx=<blob>`.

**Hop 5 — relay.** Camp 404's JS reads `location.hash`, calls `replaceState` to clear it, POSTs the ticket to its **own** backend, discards it from the page.

**Hop 6 — the call.** `GET /v1/burners/<memberId>/medical`, `Authorization: Bearer ab_ik_…`, `X-AfrikaBurn-User: abrt_…`.

**Hop 7 — the wrapper.** `middleware.ts` has already deleted `Cookie`; the wrapper deletes it again. Prefix allowlist: anything not `ab_ik_`/`abrt_` is `invalid_credentials` **before** anything is hashed. Three rate-limit budgets in `action_rate_limit` (ip, integration, integration:subject). Then the single join.

**Hop 8 — `relayRefusal`.** Integration active; key not revoked; `sanitized_at` null; consent `revoked_at` null; ticket not expired, not consumed; `session.expires_at > now()` — **she is there**. Tier is `disclosing`, so `single_use` is enforced. `effectiveScopes` = `{bio:medical:read}` after intersecting ticket ∩ consent ∩ ceiling. Non-empty.

**Hop 9 — the predicate.** `GUARDS["bio:medical:read"]` calls `loadMedicalAccessContext(db(), Nomsa.usersId, memberId)` — three unchanged queries. `canViewMedicalNotes` returns true on the camp-lead branch: her `actorLeadCampIds` and the member's `subjectCampIds` intersect at Camp Dusty. Basis `camp_lead`.

**Hop 10 — the read.** The handler calls `resolveMedicalNotesForViewer({ viewerUserId: Nomsa.usersId, subjectUserId: memberId, editionId, via: { integrationId, consentId, ticketId, requestId } })` — the same function the burner detail page calls. It re-runs the predicate (authorise-then-select: on refusal no `burner_bios` query runs at all), decrypts, and produces the three-state `notes | null | unreadable` that the console's false-all-clear incident exists to preserve.

**Hop 11 — the record, before the body.**

```
audit_events
  actor_id : <Nomsa's users.id>              ← THE HUMAN. The column type
                                                (uuid → users.id) makes it
                                                impossible for it to be anything else.
  action   : bio.medical.view                 ← unchanged string
  subject  : <the member's users.id>
  meta     : { basis: "camp_lead",            ← unchanged closed union
               via: "integration",
               integrationId, consentId, ticketId,
               scope: "bio:medical:read", requestId }
```

`await`ed. If the insert throws: `console.error`, **503 `audit_unavailable`, no body**. This is the deliberate divergence from the first-party `after()` fail-open, and it must be written into `docs/accounts-security-spec.md` immediately beside the fail-open paragraph or the next reader will "fix" the inconsistency in the wrong direction. CI pins it: no `after(` in the `via` branch; the insert is `await`ed and precedes the response.

**Hop 12 — burn, then answer.** `consumeTicket` runs _after_ the predicate said yes and _before_ the body is built, so a refusal she did not cause never costs her the ticket. One `UPDATE … WHERE consumed_at IS NULL RETURNING id`, so two concurrent requests cannot both win. Response body is `MedicalNotesResponse.parse(...)` — a closed `z.object()` that strips unknown keys.

**Two minutes later** the ticket is dead and cannot be renewed.

### Every refusal on this path

| Condition                                                                                                                          | Response                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| No ticket, unknown ticket, ticket from another app, key revoked, integration suspended, account sanitized, ticket already consumed | **401 `invalid_credentials`** — byte-identical                                                                                       |
| Ticket expired · session ended · consent revoked                                                                                   | **401 `reconnect_required`**                                                                                                         |
| `bio:medical:read` not in ticket ∩ consent ∩ ceiling                                                                               | **403 `insufficient_scope`**, naming the scope string and nothing else — never a department name, never an `ORG_DOMAIN_LABELS` value |
| `canViewMedicalNotes` false · no such burner · a burner she may not see                                                            | **404 `not_found`** — identical bytes for all three, the API face of `apps/web/lib/groups-store.ts:187`                              |
| Audit insert failed                                                                                                                | **503 `audit_unavailable`**                                                                                                          |
| No active edition                                                                                                                  | **503**                                                                                                                              |

### The answer the member gets

`/account/medical-access` — new, blocking, in `apps/web`. `audit_events WHERE action='bio.medical.view' AND subject=<me>`, **unbounded in time** (the console's 30-day/500-row window is page ergonomics, not a legal answer), resolving actor → display name, `meta.basis` → English, `meta.integrationId` → app name:

> **Nomsa Dlamini** · camp lead · 4 Aug, 19:42 · **through Camp 404**

Not "Camp 404 read your medical notes." A person read them, through an app, and both facts are on the page. `apps/org/lib/medical-audit.ts`'s `MedicalReadRow` gains the same `viaIntegration` column. Adding the `meta` keys without adding the column satisfies the schema and fails the requirement.

The page states the caveat honestly: _reads inside AfrikaBurn's own apps are recorded on a best-effort basis; reads through a connected app are recorded before the data is released._

**No thresholds, no per-actor profiling, no alerting, no counts in `meta`.** An enumeration detector was built and deliberately removed. The row is a record.

---

## 6. DATA MODEL — migration 0029, append-only, one shot

Three tables. No `ALTER TABLE` on anything existing. No new column on `users`. Nothing touches a Better Auth table except one inbound FK.

### 6.1 Tables

```ts
export const integrationStatusEnum = pgEnum("integration_status", [
  "active",
  "suspended",
]);
export const consentRevokerEnum = pgEnum("consent_revoker", [
  "subject",
  "org",
  "integrator",
  "system",
]);

export const integrations = pgTable("integrations", {
  id: uuid().defaultRandom().primaryKey(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  contactEmail: text("contact_email").notNull(),
  // Provenance and the person a POPIA complaint is addressed through. NOT a live
  // authority: nothing is resolved through this column at request time, because
  // org:* is not delegable and there is therefore no rank-derived reach in a
  // ceiling to go stale. See DELEGABLE_SCOPE_PREFIXES for the precondition if
  // that ever changes.
  sponsorUserId: uuid("sponsor_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  status: integrationStatusEnum().notNull().default("active"),
  // THE CEILING. jsonb, matching org_roles.permissions — the house pattern for a
  // permission set. Every edit writes an audit_events row carrying {before, after},
  // exactly as org.department.domains already does, so "who changed this and when"
  // is answerable without a row-per-scope table.
  ceiling: jsonb().$type<string[]>().notNull().default([]),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull().default([]),
  // sha256 HEX via @quagga hashToken, reused verbatim from
  // apps/web/lib/account-tokens.ts:26. 256 uniform bits: no dictionary, so a slow
  // KDF buys nothing but latency on every request.
  keyHash: text("key_hash").notNull().unique(),
  previousKeyHash: text("previous_key_hash").unique(),
  previousKeyExpiresAt: timestamp("previous_key_expires_at", { mode: "date" }),
  createdAt,
  updatedAt,
});

export const integrationConsents = pgTable(
  "integration_consents",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "restrict" }),
    scopes: jsonb().$type<string[]>().notNull().default([]),
    grantedAt: timestamp("granted_at", { mode: "date" }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { mode: "date" }),
    // So the burner's card can say WHO cut it off. "You disconnected this" and
    // "AfrikaBurn suspended this app" are different sentences and a bare timestamp
    // cannot render either.
    revokedBy: consentRevokerEnum("revoked_by"),
    lastUsedAt: timestamp("last_used_at", { mode: "date" }),
  },
  (c) => ({
    pairIdx: uniqueIndex("integration_consents_pair_idx").on(
      c.userId,
      c.integrationId,
    ),
    userIdx: index("integration_consents_user_idx").on(c.userId),
  }),
);

export const integrationTickets = pgTable(
  "integration_tickets",
  {
    id: uuid().defaultRandom().primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    consentId: uuid("consent_id")
      .notNull()
      .references(() => integrationConsents.id, { onDelete: "cascade" }),
    // THE PRESENCE ANCHOR, and the reason this is not an IdP. text, because
    // session.id is text (schema.ts:379).
    sessionId: text("session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    // A SUBSET of the consent's scopes. Re-intersected with consent AND ceiling on
    // every request regardless — a narrowing hint, never an authority.
    scopes: jsonb().$type<string[]>().notNull(),
    singleUse: boolean("single_use").notNull().default(false),
    // NULL ⇒ never server-re-mintable (every bio:* ticket). Otherwise
    // min(session.expires_at, granted_at + 24h).
    renewableUntil: timestamp("renewable_until", { mode: "date" }),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    consumedAt: timestamp("consumed_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    expiresIdx: index("integration_tickets_expires_at_idx").on(t.expiresAt),
    sessionIdx: index("integration_tickets_session_idx").on(t.sessionId),
    consentIdx: index("integration_tickets_consent_idx").on(t.consentId),
  }),
);
```

### 6.2 Every `ON DELETE`, with its reason — the part with no second attempt

| FK                                                         | Choice              | Reason                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `integration_tickets.session_id → session.id`              | **CASCADE**         | The mechanism. Sign-out / password reset / sanitization all hard-delete `session`, and this makes revocation propagate in the same Postgres statement. `restrict` here would make sign-out _fail_. `set null` — which is what the oauth-provider plugin does — would turn revocation into "eventually, via TTL" |
| `integration_tickets.consent_id → integration_consents.id` | CASCADE             | A deleted consent takes its tickets                                                                                                                                                                                                                                                                             |
| `integration_consents.integration_id → integrations.id`    | **RESTRICT**        | The console must **suspend** before it can delete. A live integration cannot be orphaned into authenticating against nothing                                                                                                                                                                                    |
| `integration_consents.user_id → users.id`                  | CASCADE, **inert**  | `users` rows survive sanitization as tombstones, so this never fires for an erased account. The real mechanism is the purge list below — belt and braces, and the belt is the one that works                                                                                                                    |
| `integrations.sponsor_user_id → users.id`                  | RESTRICT, **inert** | Expresses "an integration must have a sponsor". Never fires today; fails safe if a hard delete is ever added                                                                                                                                                                                                    |

`session_id` is `NOT NULL` + CASCADE, so a signed-out burner's tickets vanish. Nothing user-visible is lost: the burner-facing object is the **consent**, which persists and renders "this app can no longer act for you — you signed out".

### 6.3 Code changes shipping in the same PR, no DDL

```ts
// packages/core/src/account-sanitization.ts — currently exactly three entries (verified)
export const SANITIZATION_PURGED_TABLES = [
  "profile_keys",
  "email_change_requests",
  "security_events",
  "integration_consents", // NEW — a live authorisation for a person who no longer exists
  "integration_tickets", // NEW — cascades from the above, listed because this list
  //       is what the tests assert over and what a reader checks
] as const;
```

`audit_events` stays in `SANITIZATION_PRESERVED_TABLES` (verified `:167-178`). The disclosure record survives erasure; the live authority does not.

Two `ALTER TYPE "security_event_kind" ADD VALUE` for `app_connected` / `app_disconnected` — their own statements, with nothing in 0029 inserting a row that uses them. `securityEventKindEnum` is a `pgEnum` at `schema.ts:212-222`; the display titles live in `packages/core/src/security-events.ts` (no strings in the DB). **Confirm the Neon server version before generating** — the in-transaction semantics of `ADD VALUE` are version-dependent and a wrong migration is permanent.

### 6.4 Not in 0029, deliberately

No `users.kind`. No service user. No `integration_keys` table. No `integration_scopes` table. No grant/token tables. No `text[]`. No plugin-generated DDL. Four of the five things the losing designs needed exist to support `org:*` delegation, which decision 8 refuses.

### 6.5 Sweep

The `session` cascade collects most expired tickets. The remainder ride the existing deletion-sweep cron: `DELETE FROM integration_tickets WHERE expires_at < now() - interval '1 day'`. Small, but it must exist and be watched.

---

## 7. WHAT CHANGES IN THE PRIOR SPEC (docs/sdk/00-05)

Sections not listed below stand unchanged.

### `README.md`

- The status paragraph — "proposal, not a commitment… `06-review.md` argues this should not be built yet" — is **replaced**: accepted, being built, consumer named (Camp 404). `06-review.md` is retained as the **security findings register**, not as a verdict on whether.
- "The one-paragraph version" states `effective = resolve(serviceUser) ∩ key.permissions` — a **two-way** intersection over a service identity. Superseded by §3 here.
- Reading order gains **`07-consent-and-delegation.md`** (this decision, expanded), placed immediately after `01`. `06-review.md` is not rewritten — it is a record of a review that happened, and its provenance is load-bearing.

### `00-decision.md`

- **§1 (architecture paragraph)** — replaced by §1 here.
- **§2 (decisions table)** — gains the rows in §2 here; no existing row is reversed.
- **§3.1 "The closed vocabulary (49 strings)"** → **50**, five namespaces. Every restatement of "49" across all files moves in the same commit.
- **§3.6 "Server — the only boundary"** — extended: the boundary is now also the relay join and the four blocking prerequisites.
- **§5 (backend work required)** and **§6 (staged delivery)** — superseded by §6 and §8 here.

### `01-overview-and-capability-model.md`

- **§1.4 "The capability model — the invariant everything hangs from"** — the invariant becomes the two-stage form in §3.1 here. This is the single most important edit in the set: the current text describes the model C1 broke.
- **§1.5 "The scope vocabulary — 49 closed strings"** — 50, with the `bio:` namespace and its one member, and the tier table.
- **§1.6 "What can never be a scope, and why"** — gains a new rule: **`org:*` is never delegable**, with the sponsor-re-resolution precondition attached.
- **§1.8 "Resolution order"** — superseded by §3.2 here.
- **§1.12 "Prerequisites this model depends on"** — gains all four blocking prerequisites (§8 stage 0).

### `02-core-api-reference.md`

- **§2 (scope vocabulary)**, **§4 (client construction)** — `createClient({ key })` yields a public-only client; `.as(ticket)` is the only route to anything that names a burner.
- **§5 (client object)**, **§6 (method surface)** — the credential-kind generic (grafted from token-exchange): methods reachable only through `.as()` do not exist on the bare client's type, and undeclared scopes are `Deny<…>` with no call signature. Impersonation and forgotten scopes are both **compile errors**.
- **§8 (error taxonomy)** — replaced by the two-bucket wire model plus 403/404/429/503. The full `RelayRefusal` union is documented as the _troubleshooting table_, explicitly marked as never appearing on the wire.
- **§13 "What the SDK does not promise"** — gains: **no background or offline access**; every read requires a burner with a live session.

### `03-react-reference.md`

- **§3 "The two credentials — there is no publishable key"** — becomes three artifacts (key, ticket, consent) and gains the browser half: `startConnect({ scopes, returnTo })` / `readTicket()`.
- **§4 (provider setup)**, **§5 (hooks)** — the provider takes a ticket, not a subject.
- **§10 (cache semantics)** — **H4 fix is mandatory**: the cache key must include the subject, never `manifest.key.id` alone, or a multi-tenant integrator cross-serves burners.

### `04-backend-work-required.md`

| Section                                      | Disposition                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §4.1.3 Authentication headers                | **Extended** — `X-AfrikaBurn-User: abrt_…` beside `Authorization`                                                                                                                                                                                                           |
| §4.1.7 Three refusal codes                   | **Superseded** by the two-bucket model                                                                                                                                                                                                                                      |
| §4.1.9 CORS                                  | **Confirmed as written**: none in v0.1. Reasoning strengthened — the browser half never calls `/v1`                                                                                                                                                                         |
| §4.2 endpoint list, "Never" tranche          | **Amended** — a medical _detail_ endpoint exists at `bio:medical:read`. Every "never" about lists, rosters, counts, exports and `hasMedicalNotes` **stands**                                                                                                                |
| §4.3.2 Migration 0029                        | **Superseded** by §6 here                                                                                                                                                                                                                                                   |
| §4.3.3 Plugin registration and configuration | **DELETED.** No `@better-auth/api-key`, no plugin, no `enableSessionForAPIKeys` footgun, no unverifiable claims                                                                                                                                                             |
| §4.3.4 / §4.3.5 Key format and hashing       | **Superseded** — `ab_ik_`/`abrt_`, 256 bits, sha256 **hex** via the existing `hashToken`                                                                                                                                                                                    |
| §4.3.6 Rotation with grace                   | **Retained**, reshaped onto two columns; "revoke now" sets `previous_key_expires_at = now()`                                                                                                                                                                                |
| §4.3.7 Revocation — three levels             | **Retained and extended to five**: burner (consent), org (suspend), key revoke, session death, expiry                                                                                                                                                                       |
| §4.3.8 The verification path                 | **Superseded** by §3.4 here                                                                                                                                                                                                                                                 |
| §4.3.9 Integrations console                  | **Retained.** `requireSystemManager` — rank, never a grantable capability                                                                                                                                                                                                   |
| §4.3.10 Audit events                         | **Extended** — `integration.consent.granted` / `.revoked`, `integration.ceiling.changed` `{before, after}`                                                                                                                                                                  |
| §4.3.11 Invariant tests                      | **Superseded.** `service-user-is-never-god`, `service-user-holds-no-camp-backstop`, `bootstrap-god-skips-service` are **deleted** — they reference `users.kind`, which does not exist, and the service user they guard no longer exists either. Replaced by the suite in §8 |
| **§4.3.12 Delegation tokens (v0.2)**         | **DELETED IN FULL.** This is C1's home. `POST /v1/delegations` with a `subjectUserId` does not exist in any version, and CI scans for the identifier's absence                                                                                                              |
| §4.4 Capability / discovery endpoint         | **Retained**, resolved per-ticket for the burner. **H1 fix mandatory**: the SDK hardcodes its base URL and never takes a route from the manifest                                                                                                                            |
| §4.5 The PII stripper                        | **Retained, still BLOCKING, unchanged.** `grep -rn stripHardLocked` = zero hits                                                                                                                                                                                             |
| §4.6 Rate limiting                           | **Extended** with the `integration:subject` key                                                                                                                                                                                                                             |
| §4.8 Implementation plan                     | **Superseded** by §8 here                                                                                                                                                                                                                                                   |

### `05-publishing-and-licensing.md`

Stands. Additions only: `commitlint.config.mjs` `SCOPES` gains `sdk`, `react`, `scopes`, `api` (and its doc-comment must be rewritten, not quietly falsified — two of those are not workspaces); the same list is copied in `CONTRIBUTING.md` and `.github/pull_request_template.md` and all three move together; `.github/CODEOWNERS` gains `/packages/sdk*/`, `/packages/scopes/`, `/apps/web/app/api/v1/`, `/.changeset/`, `/scripts/licence-*.mjs`, `/README.md`, `/commitlint.config.mjs` — all inert until branch protection is enabled, which is therefore a prerequisite of the workstream, not a follow-up; `pnpm sdk:local` mints a local key **and drives a local consent to produce a ticket**.

### `06-review.md`

Unchanged as a record. Its findings resolve as: **C1 closed structurally** (no field exists to constrain). **C2** — the medical DTO is written here and the stripper is blocking. **C3** — fix (c) is mandatory and doubled. **H1, H2, H4** — mandatory. **M4** (`audience` unenforceable) — moot; there is no audience concept, binding is a join. **M7** (successful reads unaudited) — answered for the disclosing path, **still open** for `public:*`, and the incident runbook must say so rather than imply a completeness the data lacks.

---

## 8. STAGED DELIVERY

### Stage 0 — the prerequisites. Nothing else starts.

1. `apps/web/lib/medical-access.ts`: `?? "org_staff"` **fails closed**; the strongest-role fold becomes rank-aware (`god > org_staff > engineer > none`).
2. Extract `packages/db/src/actors.ts`; `apps/org/lib/session.ts` and `apps/web/lib/medical-access.ts` both call it.
3. Build `stripHardLocked` as closed `z.object()` output schemas in `packages/types/src/responses/*`, plus the build-failing forbidden-field walk and the open-ended-zod ban.
4. Enable branch protection with code-owner review.

**Proof:** a new fixture — an `engineer` plus a later `member` row on a second org group, asserted in **both** row orders — goes red on the current code and green after; the existing `god` test cannot fail on this. A planted `phone` in a response schema fails the build, and the commit hash where it did is recorded in the README.

### Stage 1 — migration 0029 + issuance + `public:*`

Console screen behind `requireSystemManager`; key mint/rotate/revoke; suspend; the wrapper; both cookie strips; `relayRefusal`; rate limits.
**Proof:** `pnpm sdk:local` mints a local key (the minter refuses any non-compose target, no `--force`), reads `public:camps`, and 401s on everything else. `integration.ceiling.changed` audit row carries `{before, after}`.

### Stage 2 — `/connect` + consent + tickets + `self:*`

Consent screen, reconnect mode, server re-mint, `/account/connected-apps`.
**Proof:** end-to-end in `sdk:local` — consent, read own profile, re-mint without navigation, disconnect, **next call 401s with no expiry wait**. A ticket minted for app A presented with app B's key is byte-identical to a bogus ticket.

### Stage 3 — `camp:*`

**Proof:** two-camp fixture; lead of A gets `404` for a member of B, identical bytes to a nonexistent id.

### Stage 4 — the reading surfaces. Before any medical scope exists.

`/account/medical-access` (unbounded, honest caveat) and `viaIntegration` on `MedicalReadRow`.
**Proof:** a **first-party** medical read — no API involved — appears on the burner's own page with actor, basis and timestamp.

### Stage 5 — `bio:medical:read`

Vocabulary 49→50; the `via?` diff to `resolveMedicalNotesForViewer`; 120s single-use tickets; blocking audit.
**Proof:** the row names the human and the app; forcing the insert to throw returns 503 **and no body**; the ticket is dead on second use; the burner's page renders "…through Camp 404". `docs/accounts-security-spec.md` carries the divergence paragraph.

### Stage 6 — publish

`@afrikaburn/sdk` Apache-2.0, `"dependencies": {}`, both licence checks green, the discovery document at `/.well-known/afrikaburn-integration` so an integrator who is not on Node is not stranded on our SDK.

### The invariant suite, all inside `pnpm turbo run … test` under the single `CI pass` check

`no-subject-id-in-v1` (source scan) · `v1-never-reads-cookies` (**transitive import-graph**) · `v1-double-strips-cookie` · `guards-exhaustive-over-scopes` (compile-time) · `guards-call-core-only` · `every-scope-has-a-tier` (table over all 50) · `org-scopes-are-not-delegable` (50 × 2 table; its failure message _is_ the sponsor precondition) · `renewable-scopes-is-an-allowlist` · `bio-scopes-are-never-renewable` · `relay-refusal-exhaustive` (every union member reachable) · `refusals-are-two-bucket` (byte-identical within `invalid_credentials`) · `audience-binding-is-a-join` (`key_hash` appears inside the `WHERE`) · `redirect-uri-exact-match` · `medical-api-audits-before-response` · `medical-audit-actor-is-end-user` · `consent-tables-in-erasure` · `org-actor-fails-closed-on-non-rank` · `no-forbidden-fields` · `no-open-ended-zod` · `migration-append-only`.

---

## 9. THE THREE THINGS MOST LIKELY TO GO WRONG

**1. The extraction copies the coercion instead of fixing it.**
`packages/db/src/actors.ts` is a refactor with an obvious mechanical shape, and the fastest way to write it is to paste `apps/web/lib/medical-access.ts`'s org branch — `?? "org_staff"` and all. If that happens, `resolve(END USER, live)` — **the only term in the intersection that grants anything** — stays widened, and every other control in this document is a fence around an open gate. The failure is silent: the console keeps refusing, the API keeps allowing, and the audit row honestly records `basis: "org_staff"`, which is a true description of what the code decided and a false description of who the person is. _Mitigation:_ stage 0 gates everything; the fixture asserts both row orders; `org-actor-fails-closed-on-non-rank` reads the function body.

**2. The blocking medical audit gets reverted, correctly-looking, at the worst time.**
Two paths now write `bio.medical.view` with opposite failure semantics, and the first-party one carries a long, persuasive comment explaining why fail-open is right. When a camp lead on one bar of signal at 3am gets a 503 instead of a medical note, the cheapest and most sympathetic fix is to make the API path match — and it will be framed as removing an inconsistency. It removes the entire basis on which disclosure to a party with no membership was permitted. _Mitigation:_ the divergence paragraph lives immediately beside the fail-open paragraph in `docs/accounts-security-spec.md`, not in a spec nobody opens; `medical-api-audits-before-response` asserts the absence of `after(` in the `via` branch and goes red on the revert.

**3. `ON DELETE SET NULL` on `integration_tickets.session_id`.**
It is one word, it is what a schema generator or a plugin author would plausibly emit, and it is what `@better-auth/oauth-provider` actually does. With `set null`, sign-out no longer revokes: tickets survive their session and die only by TTL. The happy path is byte-identical, every test that does not specifically delete a `session` row still passes, and the property this entire design is built on — _revocation is a foreign key, not a job_ — is silently gone. It lands on an append-only chain, applied at deploy against production, with no staging. _Mitigation:_ every FK in 0029 is written by hand with its reason in the migration file, the migration is read line by line before commit, and a test asserts the constraint's delete rule by querying `information_schema.referential_constraints` rather than by trusting the Drizzle source.
