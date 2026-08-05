## 4. THE BACKEND WORK REQUIRED

None of this exists. There is no HTTP API, no API key, no capability document, no PII
stripper. What exists is 104 server actions, ~80 store/query functions, 14 route handlers
(of which 3 are real capability surfaces), and three permission layers that already resolve
correctly for cookie-session callers. This shard specifies the machinery that turns that
into something a stranger's process can call, and says which parts block v0.1.

It is written as a contract. Every claim about the current tree carries a path. Where the
architecture decision is silent I decide in its spirit and mark the choice
**(spec author's call)**.

**One verification caveat, stated once.** `node_modules/` is absent from this checkout, so
`@better-auth/api-key@1.6.25`'s field list, defaults and endpoint paths in §4.3 come from
the auth survey's read of the published tarball, not from an installed copy in this
session. Every one of those facts is marked ⚠ and must be re-verified against the installed
package before the migration is generated. Two things ARE verified in-repo and are not
marked ⚠: the pin (`packages/auth/package.json:26` declares `"better-auth": "1.6.25"`, and
`pnpm-lock.yaml:2667` resolves it — `@better-auth/passkey` is pinned to the same version at
`:22`), and the `userId` → `referenceId` rename on the API Key plugin, which
`docs/auth-platform-spec.md` §2.4 records in its 1.5 breaking-change list.

---

### 4.1 THE HTTP API

#### 4.1.1 Host and base path

There is no `apps/api` and there will not be one in v1. Decision 14 mounts each namespace
in the app that already owns its store, and `manifest.routes` carries namespace → origin as
**data**. That decision is what buys us out of the 6,938-line store extraction; the host
design has to make it invisible to the integrator.

| Namespace                                                                                                | Origin                                             | Owning store (verified)                                                                      |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `capabilities`, `editions`, `groups`, `categories`, `burners`, `suppliers` (directory)                   | `https://api.quagga.ryanjnoble.dev` → **apps/web** | `apps/web/lib/groups-store.ts`, `bio-store.ts`, `edition.ts:25`, `registration-store.ts:279` |
| `me`, `registrations`, `invites`, `roles`, `questionnaires` (project), `bulletins` (received-only, v0.2) | same origin, **apps/web**                          | `apps/web/lib/{registration,invites,roles,questionnaire}-store.ts`, `bulletins.ts`           |
| `org/*` (v0.2+)                                                                                          | `https://org.quagga.ryanjnoble.dev`                | `apps/org/lib/queries.ts`, `apps/org/lib/actions/*`                                          |
| `supplier-self/*` (v1.0)                                                                                 | `https://suppliers.quagga.ryanjnoble.dev`          | `apps/suppliers/lib/*`                                                                       |

**`api.quagga.ryanjnoble.dev` is a second Vercel domain alias on the existing `apps/web`
project, not a new deployment.** The apex is `AUTH_APEX_DOMAIN = "quagga.ryanjnoble.dev"`
(`packages/auth/src/env.ts:38`) and the three production origins are enumerated at
`env.ts:80-84`. Adding a fourth host is a DNS record and a Vercel alias — zero new
infrastructure, no new `BETTER_AUTH_SECRET` copy, no new lambda cold-start budget.

Why a dedicated host rather than `app.quagga.ryanjnoble.dev/api/v1`: the cookie `Domain=`
is scoped to `.quagga.ryanjnoble.dev` (`env.ts:72`), so **every request to any subdomain
carries the participant's session cookie**. An API host that shares an origin with the
participant app means a browser that is signed in sends both a cookie and an API key, and
the verifier has to decide which wins on every single request. On a distinct host the
answer is structural: `/api/v1/*` route handlers read **only** the `Authorization` header
and never call `auth.api.getSession`. Cookie and key never co-arrive at the same decision.

> `api.` is still under the apex, so the cookie _is_ sent. The rule above is a handler-side
> rule, pinned by a source-scanning test (§4.3.11), not a browser guarantee. The alternative
> — a host outside the apex — would need its own TLS cert and a second `trustedOrigins`
> story for no additional safety, because the handler never reads the cookie either way.

`manifest.routes` is emitted regardless, because the org tranche lands on a different origin
in v0.2 and the SDK must not hardcode that mapping:

```jsonc
"routes": {
  "capabilities": { "base": "https://api.quagga.ryanjnoble.dev/v1" },
  "groups":       { "base": "https://api.quagga.ryanjnoble.dev/v1" },
  "org":          { "base": "https://org.quagga.ryanjnoble.dev/api/v1" }
}
```

The single well-known entry point an integrator configures is the **capabilities URL**.
Everything else the SDK learns from the manifest. Moving a namespace between apps later —
including the day `packages/data` and `apps/api` finally happen — is then a manifest change
and no SDK release. That is the whole point of decision 14.

#### 4.1.2 Versioning

Path-segment major only: `/v1/...`. No header negotiation, no date-pinned versions.

**Within `v1` the API is append-only, on exactly the same law as
`packages/db/migrations/`** (`packages/db/src/schema.ts:26-31`: extend "ONLY by adding
tables/columns behind a new append-only migration, never by altering or regenerating an
earlier one"). Concretely, inside v1 you may add an endpoint, add an optional request field,
add a response field, add a scope. You may not remove a response field, tighten a request
type, or **change the scope an existing operation requires** — a scope change on a live
operation is the one thing that silently breaks a correctly-written integrator, because
their `ScopeContractError` diff passed at construction and their call now 403s. That is a
major, and CI enforces it: the operation registry is committed, and a scope change on an
existing operation fails the build unless the changeset is `major` (§4.8, task 22).

Deprecation is announced in-band with `Deprecation: <http-date>` and `Sunset: <http-date>`
on the deprecated operation's responses. **The sunset window is two editions, not six
months** — the product's clock is the burn (`packages/db/src/schema.ts:569-572`: "Years are
the root namespace"), and an integrator who built a camp tool touches it once a year. Six
months means a tool that worked in 2027 is broken before anyone opens it in 2028.

#### 4.1.3 Authentication headers

```
Authorization: Bearer ab_sk_live_<key>          # server-to-server; the API key
Authorization: Bearer abdt_<token>              # v0.2 delegation token (browser)
```

`Authorization: Bearer`, not `x-api-key`. ⚠ The plugin's default header is `x-api-key`
(`@better-auth/api-key@1.6.25`, `dist/index.mjs:2327`) and it accepts a
`customAPIKeyGetter`; we use the getter and read `Authorization`. Reason: the same header
carries both credential kinds, `WWW-Authenticate` on a 401/403 is then semantically correct
per RFC 6750, and every HTTP client, proxy and log scrubber already treats `Authorization`
as secret. `x-api-key` is not on anyone's redaction list by default.

Also accepted and **required** on every request:

| Header                           | Required          | Purpose                                                              |
| -------------------------------- | ----------------- | -------------------------------------------------------------------- |
| `Authorization`                  | yes               | the credential                                                       |
| `Accept: application/json`       | no (assumed)      | —                                                                    |
| `Content-Type: application/json` | on request bodies | the only accepted body type                                          |
| `X-AfrikaBurn-Manifest-Version`  | no                | the manifest `kernel`+`etag` the SDK preflighted against; see §4.1.5 |
| `Idempotency-Key`                | on v0.2 writes    | §4.1.10                                                              |

There is **no** query-parameter or cookie credential path. A key in a query string lands in
Vercel's access logs and in every `Referer` header; a cookie credential would collide with
the session cookie the apex already sets.

#### 4.1.4 Content types

Requests: `application/json` only. `multipart/form-data` is not accepted on `/v1` in v1.0 —
blob upload stays where it is (`apps/web/app/api/blob/upload/route.ts`), behind a session,
and is not an integrator surface.

Responses: `application/json; charset=utf-8` on success,
`application/problem+json; charset=utf-8` on every 4xx/5xx (RFC 9457). Two content types,
one per outcome class, so a client can branch on the header before parsing.

Every success body is an object, never a bare array — a top-level array cannot grow a
`nextCursor` without a breaking change:

```jsonc
{ "data": [ … ], "nextCursor": "eyJ…" | null }
{ "data": { … } }
```

#### 4.1.5 Response headers — on every response, success included

| Header                           | Value                                              | Why                                                                                                                               |
| -------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `X-AfrikaBurn-Accepted-Scopes`   | space-separated scopes this operation would accept | GitHub's `X-Accepted-OAuth-Scopes`. Lets the SDK build a live scope→operation map from ordinary traffic with no extra round trip. |
| `X-AfrikaBurn-Manifest-Version`  | `<kernel>.<manifestEtag>`                          | How a mid-session revocation reaches a rendered UI. The SDK compares; on mismatch it refetches the manifest and re-renders.       |
| `X-Request-Id`                   | uuid                                               | Echoed into every log line and every audit row's `meta.request_id`.                                                               |
| `RateLimit` / `RateLimit-Policy` | RFC 9331 form                                      | §4.6                                                                                                                              |

`X-AfrikaBurn-Accepted-Scopes` is emitted by the same wrapper that enforces the scope, from
the same array literal, so it cannot describe a different requirement than the one applied.
That is a direct application of the rule at `packages/core/src/org-permissions.ts:20-25`
(the second permissions table that was deleted "because a second source of truth for
permissions is how a console ends up refusing what it renders").

#### 4.1.6 Error format

RFC 9457 `application/problem+json`, with extension members. One envelope, everywhere.

```jsonc
// 403
{
  "type": "https://developers.afrikaburn.org/errors/insufficient-scope",
  "title": "This key is not authorised for that",
  "status": 403,
  "detail": "This key cannot change a supplier's standing. It holds org:read:suppliers but not org:update:suppliers.",
  "instance": "/v1/org/suppliers/SUP-0042/standing",
  "code": "insufficient_scope",
  "required_scopes": ["org:update:suppliers"],
  "held_scopes": ["org:read:suppliers", "public:camps:read"],
  "key_id": "key_01J…",
  "remediation_url": "https://org.quagga.ryanjnoble.dev/integrations/int_01J…/scopes",
  "request_id": "0d1c…",
}
```

`held_scopes` is deliberate and is the single line that kills the most common support
ticket. It is safe: the caller already holds the key, and `GET /v1/capabilities` returns the
same list. It is **omitted** from `insufficient_rights` and from every `notFound` response
(§4.1.8) — there, naming what you hold is a nudge toward guessing what exists.

#### 4.1.7 Three refusal codes, three different people to go ask

The order is not arbitrary. It mirrors `orgCapabilityRefusal`'s own ordering, which puts the
rank ceiling first "because for an engineer it is the whole answer and 'none of your roles
grant it' would send them to ask for a role edit that cannot work"
(`packages/core/src/org-permissions.ts:633-640`).

| Code                  | HTTP | Means                                                                                                                                                                    | Who fixes it                                                                   |
| --------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `insufficient_scope`  | 403  | the **key's ceiling** does not carry the scope                                                                                                                           | the integration owner, in the Integrations console                             |
| `rank_ceiling`        | 403  | the scope is in the ceiling, but the **service subject's rank** denies it unconditionally (`engineer` ∌ `delete`, `personal_information` — `org-permissions.ts:300-303`) | a System manager, by changing the subject's access — **not** by editing a role |
| `insufficient_rights` | 403  | the scope is in the ceiling, the rank permits it, but the **live guard refused** — wrong department, no role, relationship-level rule                                    | a System manager (role/department assignment) or a camp lead (project role)    |

Never one code for two causes. Cloudflare's error 9109 covers permission-denied, IP
restriction _and_ auth-failure lockout; that overloading is the thing to avoid.

`WWW-Authenticate` accompanies every 401 and every `insufficient_scope` 403:

```
WWW-Authenticate: Bearer error="insufficient_scope", scope="org:update:suppliers"
```

**401 is opaque.** ⚠ The plugin distinguishes `INVALID_API_KEY`, `KEY_DISABLED`,
`KEY_EXPIRED`, `USAGE_EXCEEDED`, `RATE_LIMIT_EXCEEDED`. The first three collapse to one 401
`code: "invalid_credential"` with no detail, exactly as sign-in already refuses uniformly.
`RATE_LIMIT_EXCEEDED` is a 429 and stays distinct — a rate limit that looks like a bad key
sends the integrator to rotate a working credential.

#### 4.1.8 Existence-privileged responses — the oracle rules

The product law is that free camps are undiscoverable to strangers, enforced today at
`apps/web/lib/groups-store.ts:187` (`if (!registered && !viewerRole) continue;`), at
`searchCampDirectory` (`groups-store.ts:453-500`), on the public profile
(`apps/web/components/profile-public/profile-camps.tsx:10-14`) and on the invite landing
page, which withholds even the camp's name (`apps/web/app/join/[token]/page.tsx:34`).

A 403 that says `required_scopes: ["camp:view_member_details"]` on a camp the key cannot see
**confirms the camp exists**. So the taxonomy splits, and the split is server-authored —
`Refusal.mode` in the manifest is `"explain" | "notFound"`, written by us, and the SDK's
`degrade` option may only narrow (decision 18).

| Situation                                                                                              | Response                                                                                           |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| right missing on a resource the key already legitimately knows about                                   | 403 + `insufficient_scope`, `required_scopes` present                                              |
| knowing the resource exists is itself privileged                                                       | **404**, `code: "not_found"`, **no `required_scopes`, no `held_scopes`, no `remediation_url`**     |
| camp capability probe: no such camp / free camp the key cannot see / camp exists and key holds nothing | **200**, `{"data":{"slug":"…","permissions":[],"backstop":false}}` — identical bytes for all three |

The 200-with-empty case closes the status channel _and_ the timing channel: the handler
resolves the slug, runs the same query path, and discards. Budget the discard — an early
`return` on "no row" is a measurable timing oracle over a few thousand probes.

`GET /v1/burners/{username}` has the same shape. A 404 for "no such username" and a 404 for
"username exists, everything is private" are the same 404. There is deliberately **no**
`GET /v1/burners` list endpoint at any scope (§4.2, and decision 17's reasoning:
`publicBioView` returns legalName/homeCity/contactEmail, so a list endpoint is a bulk
enumeration of Burn identities).

#### 4.1.9 CORS

There is no CORS anywhere in the tree today — grep for `Access-Control-Allow` across
`apps/`, `packages/` and the `next.config.ts` files returns nothing.

- **v0.1: no CORS headers at all.** The only credential is a secret key, the isomorphic SDK
  entry has no `apiKey` option in its type, and a browser that could call `/v1` with a key
  is a browser with a leaked key. A missing `Access-Control-Allow-Origin` is a second wall
  behind the type system.
- **v0.2: CORS on delegation-token routes only**, `Access-Control-Allow-Origin` echoed from
  a per-integration registered-origin allowlist (exact match, never a wildcard, never a
  scheme-less pattern — the same rule `trustedOrigins` already follows at
  `packages/auth/src/env.ts:75-79`). `Vary: Origin`. `Access-Control-Allow-Credentials`
  stays **false**: delegation tokens travel in a header, never a cookie.

`Origin` is not an authorisation input anywhere. It is a browser courtesy;
`curl -H 'Origin: …'` defeats it, which is why decision 17 killed the publishable-key design.

#### 4.1.10 Idempotency (v0.2, when writes land)

Every non-GET takes `Idempotency-Key: <uuid>`. Required, not optional — an integrator's
retry that double-submits a registration or double-mints an invite is a support incident
with a member in it.

Storage: reuse `action_rate_limit`'s discipline — our own single-statement table, never
better-auth's `rate_limit`, whose unfiltered sweep already cost the forgot-password budget
(`packages/db/src/schema.ts:453-461`, `packages/db/src/rate-limit.ts:13-35`). One row:
`(key, api_key_id, request_hash, status, response_body, created_at)`, 24h horizon, swept in
the same statement. A replay with a matching hash returns the stored response and
`Idempotency-Replayed: true`; a replay with a _different_ hash is a 422
`code: "idempotency_key_reuse"`.

This lands in the v0.2 write migration, not 0029.

#### 4.1.11 Pagination

Opaque cursor, forward-only: `?limit=<1-100, default 25>&cursor=<opaque>`. The cursor is a
base64url JSON `{k: <sort key>, id: <tiebreak uuid>}` signed with `BETTER_AUTH_SECRET`
(HMAC-SHA256, truncated to 16 bytes) so it cannot be hand-forged into an offset scan.
Never offset/limit: the directory is `ORDER BY` a mutable field and offsets skip rows under
concurrent writes.

---

### 4.2 THE ENDPOINT LIST

Scope column uses the vocabulary from §3.1. `personal_information` appears nowhere — it is
not an issuable integrator scope (decision 9). The org slice of that vocabulary is
8 domains × 5 capabilities = 40 cells, verified: `ORG_DOMAINS` is 8 entries
(`packages/core/src/org-domains.ts:72-81`) and `OrgCapabilityKey` is exactly
`create · read · update · delete · personal_information`
(`packages/types/src/roles.ts:141-147`, "Five keys … There is deliberately no sixth").

> **§3.1's total moves by one.** `public:bulletins:read` is deleted here (see below) and
> `self:bulletins:read` added, so the count is unchanged at 49 only if §3.1 already listed
> both. Reconcile before `packages/scopes` is written — the number is load-bearing for the
> console's scope grid and for §4.4's `never` copy.

#### v0.1 — the public tranche. **Blocking.**

| Method | Path                                         | Scope                    | Backing code (verified)                                                                     | Response DTO                       |
| ------ | -------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------- |
| GET    | `/v1/capabilities`                           | _(none — key auth only)_ | new: `manifestForKey()`                                                                     | `Manifest`                         |
| GET    | `/v1/capabilities/camps?slugs=a,b,c`         | _(none)_                 | new, over `groups-store.ts:953 getViewerRole`                                               | `CampGrant[]`, empty for invisible |
| GET    | `/v1/editions`                               | `public:editions:read`   | `apps/web/lib/edition.ts:25 getActiveEdition` + a new list query                            | `Edition[]`                        |
| GET    | `/v1/editions/{id}`                          | `public:editions:read`   | ditto                                                                                       | `Edition`                          |
| GET    | `/v1/groups?kind=&search=&category=&cursor=` | `public:camps:read`      | `apps/web/lib/groups-store.ts:103 listDirectory`, `:457 searchCampDirectory`                | `CampSummary[]`                    |
| GET    | `/v1/groups/{slug}`                          | `public:camps:read`      | `groups-store.ts:331 getCampBySlug`                                                         | `CampSummary`                      |
| GET    | `/v1/categories`                             | `public:categories:read` | `groups-store.ts:59 listCampCategories`                                                     | `Category[]`                       |
| GET    | `/v1/burners/{username}`                     | `public:profiles:read`   | `groups-store.ts:626 getPublicBurnerProfile` → `packages/core/src/bio.ts:359 publicBioView` | `PublicProfile`                    |
| GET    | `/v1/suppliers?cursor=`                      | `public:suppliers:read`  | `apps/web/lib/registration-store.ts:279 listSuppliersForPicker`                             | `SupplierDirectoryEntry[]`         |

Nine operations. Note what is _not_ here: no `POST` anywhere, no `/v1/burners` list, no
`/v1/groups/{slug}/members`. v0.1 is deliberately unable to write or to name a person the
caller was not already told about.

**`/v1/bulletins` was removed from this tranche, and there is no `public:bulletins:read`
scope.** A bulletin is not public content. `bulletins.audience` is the same jsonb
`AudienceSpec` the questionnaire machinery uses (`packages/db/src/schema.ts:1739-1759`), and
`apps/web/lib/bulletins.ts:9-14` states the read-side rule: _"A bulletin is only readable by
a participant who RECEIVED it — i.e. has a notification row for it … so previews/pages can't
leak org-internal broadcasts into participant surfaces."_ Both store functions
(`getBulletinForCurrentUser`, `bulletins.ts:25`; `getPinnedBulletinsForCurrentUser`, `:64`)
open by calling `getCurrentCampUser()` and return null/[] without a session. There is no
public projection to wrap, and a `viewerId = null` caller is entitled to exactly nothing.
Bulletins move to the v0.2 self tranche as `self:bulletins:read`, delegation-token only —
the same shape as `/v1/me/profile`. Building a stranger-visible bulletin feed would require
a _new_ audience predicate, which is a product decision, not an API decision.

**`GET /v1/burners/{username}` needs a resolution step that does not exist today.**
`getPublicBurnerProfile(userId, editionId)` (`groups-store.ts:626-628`) takes a `users.id`,
and the in-product route is `/burners/[id]` keyed on that id
(`apps/web/app/(app)/burners/[id]/page.tsx:66`). `users.username` is uniquely indexed
case-insensitively (`schema.ts:314-316`) but no exported username→id lookup exists —
`bio-store.ts:124 getUsername` goes the other way. Either add that lookup (and keep the
§4.1.8 identical-404 rule across "no such username" and "exists but private"), or address
the endpoint by id and accept that ids are not what an integrator holds. **(spec author's
call: add the lookup; a handle is the thing a partner tool has.)**

`GET /v1/groups` uses `listDirectory`'s projection, which is where the free-camp law is
compiled in (`groups-store.ts:187`). The API caller's `viewerId` is **`null`, always** — a
key is a stranger. There is no `viewerId` override parameter and never will be; that
parameter is the whole product law in one argument.

#### v0.2 — self + camp. **Deferrable past v0.1, blocking for v0.2.**

| Method   | Path                                      | Scope                        | Backing code                                                                                                                                                                                                | Notes                                                                                                                                                                                                                   |
| -------- | ----------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET      | `/v1/me`                                  | _(any)_                      | new                                                                                                                                                                                                         | the key's own subject: `{kind:"service", integrationSlug, rank}`                                                                                                                                                        |
| GET      | `/v1/me/profile`                          | `self:profile:read`          | `apps/web/lib/bio-store.ts:52 getBio`                                                                                                                                                                       | delegation token only — a service subject has no bio                                                                                                                                                                    |
| PATCH    | `/v1/me/profile`                          | `self:profile:write`         | `bio-store.ts:216 saveBio`                                                                                                                                                                                  | `enforcePrivacyFlags` (`privacy.ts:108`) runs regardless                                                                                                                                                                |
| GET      | `/v1/me/notifications`                    | `self:notifications:read`    | `apps/web/lib/notifications.ts:97 recentNotifications`                                                                                                                                                      | `link` emitted as `{app, path}`, never the raw column (`schema.ts:1860-1876` documents the proven 404)                                                                                                                  |
| POST     | `/v1/me/notifications/{id}/read`          | `self:notifications:write`   | `apps/web/lib/notifications-actions.ts:21 markNotificationRead` (`:54 markAllNotificationsRead`) — **not** `notifications.ts:134`, which is `insertNotifications`, a fan-out writer no integrator may reach |                                                                                                                                                                                                                         |
| GET      | `/v1/me/registrations`                    | `self:registrations:read`    | needs a new list query; `registration-store.ts:102 getRegistration` is the SINGLE-row read, `:52 getRegistrationCampContext` the per-camp one                                                               |                                                                                                                                                                                                                         |
| GET      | `/v1/me/bulletins?cursor=`                | `self:bulletins:read`        | `apps/web/lib/bulletins.ts:64 getPinnedBulletinsForCurrentUser` + a full list query                                                                                                                         | received-only; delegation token only — a service subject received nothing                                                                                                                                               |
| GET      | `/v1/me/bulletins/{id}`                   | `self:bulletins:read`        | `apps/web/lib/bulletins.ts:25 getBulletinForCurrentUser`                                                                                                                                                    | 404-safe by construction; audience is enforced by the notification-row join, never re-derived                                                                                                                           |
| GET      | `/v1/groups/{slug}/members`               | `camp:view_member_details`   | `apps/org/lib/queries.ts:1343` projection shape                                                                                                                                                             | roster only: userId + `publicMemberName` + structural role. **No email, no bio, no medical.**                                                                                                                           |
| GET      | `/v1/groups/{slug}/roles`                 | `camp:manage_roles`          | `apps/web/lib/roles-store.ts:149 listRoles`                                                                                                                                                                 | `manage_questionnaires` serialised as the object, never a boolean                                                                                                                                                       |
| POST     | `/v1/groups/{slug}/roles`                 | `camp:manage_roles`          | `roles-store.ts:215 createRole`                                                                                                                                                                             | `enforceKindPermissions` coerces captain (`project-permissions.ts:126`)                                                                                                                                                 |
| PATCH    | `/v1/groups/{slug}/roles/{id}`            | `camp:manage_roles`          | `roles-store.ts:261,306,342`                                                                                                                                                                                |                                                                                                                                                                                                                         |
| DELETE   | `/v1/groups/{slug}/roles/{id}`            | `camp:manage_roles`          | `roles-store.ts:367 removeRole`                                                                                                                                                                             | `UNDELETABLE_ROLE_KINDS` refuses 4 kinds                                                                                                                                                                                |
| PUT      | `/v1/groups/{slug}/members/{id}/roles`    | `camp:assign_roles`          | `roles-store.ts:400 setMemberRoles`                                                                                                                                                                         | **escalation clause re-run server-side**: `roleGrantsElevatedPrivileges` (`project-permissions.ts:142`) + `allowElevated` = `hasProjectPermission(m,"manage_roles")` (`apps/web/app/(app)/camps/[slug]/actions.ts:222`) |
| GET/POST | `/v1/groups/{slug}/invites`               | `camp:manage_members`        | `apps/web/lib/invites-store.ts:28,77`                                                                                                                                                                       | mint only                                                                                                                                                                                                               |
| DELETE   | `/v1/groups/{slug}/invites/{id}`          | `camp:manage_members`        | `invites-store.ts:60 revokeInvite`                                                                                                                                                                          |                                                                                                                                                                                                                         |
| PUT      | `/v1/groups/{slug}/registration`          | `self:registrations:write`   | `registration-store.ts:442 saveRegistrationDraft`                                                                                                                                                           | `isEditableStatus` (`:33`) gates                                                                                                                                                                                        |
| POST     | `/v1/groups/{slug}/registration/{action}` | `self:registrations:write`   | `registration-store.ts:586 applyCampAction`                                                                                                                                                                 | submit / withdraw / reopen; state machine `packages/core/src/registration-state.ts`                                                                                                                                     |
| POST     | `/v1/groups/{slug}/questionnaires`        | `camp:manage_questionnaires` | `apps/web/lib/questionnaire-store.ts:78`                                                                                                                                                                    | returns a **`QuestionnaireVerdict`** (4 arms, §3.5), always 200 — a refusal is data, not an error                                                                                                                       |

**`invites` redeem/preview is absent and stays absent.** The token is the credential; a key
that can mint _and_ redeem plants members in camps silently. Minting is defensible under
`manage_members`; redeeming on someone else's behalf is not.

#### v0.2/v1.0 — the org tranche. **Deferrable.**

Mounted on `org.quagga.ryanjnoble.dev`. Every one of these already funnels through
`requireOrgSession({capability, domain})` (`apps/org/lib/session.ts:304-346`), so the scope
maps 1:1 onto the existing `{capability, domain}` literal at each call site — the SDK adds
no new authorisation, only an address for it.

| Method                | Path                                       | Scope                                                  |
| --------------------- | ------------------------------------------ | ------------------------------------------------------ |
| GET                   | `/v1/org/registrations`                    | `org:read:registrations`                               |
| GET                   | `/v1/org/registrations/{id}`               | `org:read:registrations`                               |
| POST                  | `/v1/org/registrations/{id}/decision`      | `org:update:registrations`                             |
| POST                  | `/v1/org/registrations/{id}/reviews`       | `org:create:registrations`                             |
| PATCH                 | `/v1/org/registrations/{id}/reviews/{rid}` | `org:update:registrations`                             |
| PUT                   | `/v1/org/registrations/{id}/wrangler`      | `org:update:registrations`                             |
| GET                   | `/v1/org/suppliers`                        | `org:read:suppliers`                                   |
| POST                  | `/v1/org/suppliers`                        | `org:create:suppliers`                                 |
| PATCH                 | `/v1/org/suppliers/{code}`                 | `org:update:suppliers`                                 |
| DELETE                | `/v1/org/suppliers/{code}`                 | `org:delete:suppliers`                                 |
| GET/POST/PATCH/DELETE | `/v1/org/supplier-documents/…`             | `org:{c,r,u,d}:supplier_documents`                     |
| GET/POST/PATCH        | `/v1/org/bulletins/…`                      | `org:{r,c,u}:bulletins`                                |
| GET/POST/PATCH        | `/v1/org/questionnaires/…`                 | `org:{r,c,u}:questionnaires` + **`canAuthorAudience`** |

Two org-tranche traps that must not be lost between here and implementation:

1. **`org:*:questionnaires` needs two predicates, in order.** `orgCanInDomain(actor, cap,
"questionnaires")` **and** `canAuthorAudience(memberships, spec, orgGroupId)`
   (`packages/core/src/questionnaire-authz.ts:58-67`). The second is membership-role based
   and excludes `engineer` entirely (`questionnaire-authz.ts:30`) by a completely different
   mechanism than the rank carve-outs. An endpoint that calls only the first is **wider than
   the console**.
2. **`org:delete:*` advertises more than exists.** Only `deleteSupplier`
   (`apps/org/lib/actions/suppliers.ts:351`) and `deleteSupplierDocument` consume it today.
   `org:delete:registrations` would resolve `true` for a Theme-camps lead and hit no
   operation. The registry emits `delete` scopes only for domains that have a delete
   operation; the manifest reports the grant, and the SDK types no method. That asymmetry is
   honest and must be documented rather than hidden.

#### Never — no endpoint, at any scope, in any version

| Surface                                                                                                     | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| anything selecting `HARD_LOCKED_PRIVATE_FIELDS` (`packages/core/src/privacy.ts:39-47`)                      | no access path exists in-product; §9.4 decision 2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| medical notes (`SAFETY_VISIBLE_FIELDS`, `privacy.ts:57`)                                                    | consented audience is "your camp leads and AfrikaBurn safety staff" (`privacy.ts:12-21`). An integrator is neither, and an integrator's log would become the compliance record for `bio.medical.view`.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `getRegistrationOfficers` phone/email (`apps/org/lib/queries.ts:1248`)                                      | contact columns are selected only when `seesPersonalInformation(actor, "registrations")` (`queries.ts:1254`), behind **five ANDed conditions** — group, `kind = 'officer'`, `consentStatus = 'accepted'`, `orgVisible = true`, and `consentEditionId = editionId` (`queries.ts:1288-1299`). The core predicate is `officerContactVisibleToOrg` (`packages/core/src/officers.ts:196-201`), and it is deliberately narrow: `isOfficer && consent === "accepted"`, described there as "the single, explicit exception to the bio phone hard-lock". Widening breaks the consent actually given — it expires with its edition (migration 0023). |
| medical access log (`apps/org/lib/medical-audit.ts:112 getMedicalAccessLog`)                                | "a named list of those rows is a census of who has disclosed a health condition" (`org-permissions.ts:105-109`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `org_roles` / `org_departments` / `org_role_assignments` / `setOrgStaffRole` writes                         | `requireSystemManager` (`apps/org/lib/session.ts:364-375`). A key that can call `setAccountOrgRoles` is a privilege-escalation primitive by construction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/api/account/deletion-sweep`                                                                               | most destructive operation in the system; "triggered deliberately, by a scheduler or an operator" (route header)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| account-security writes (`changePassword`, `revokeSession`, `requestEmailChange`, `requestAccountDeletion`) | all require re-auth; a key holding them is an account-takeover primitive                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| raw `audit_events` read                                                                                     | `meta` is free-form jsonb with an unverified scrubber; an unbounded read is not shippable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `invites` preview/redeem                                                                                    | the token is the credential                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

---

### 4.3 THE API KEY SYSTEM

#### 4.3.1 What a key is

An **org-owned integration acting on its own behalf**, anchored on a synthetic service
`user` + `users` pair that holds its own `memberships` and `org_role_assignments`. That is
what lets `resolveOrgSession`'s resolution path, `orgCanInDomain`, `hasProjectPermission`
and `writeAuditEvent` run unmodified — a second authorisation path for a second caller class
is how the two drift.

The key's stored scopes are a **ceiling, never a source**:

```
effective(key, op) = resolveLiveSubject(key.serviceUserId) ∩ key.ceiling
```

Intersection, never union, resolved live per request. A key can only ever narrow what its
integration identity already holds. A revoked department assignment takes effect on the next
call, and a key can never carry a forgeable rank — `isSystemManager` reads
`memberships.role` and nothing else (`packages/core/src/org-permissions.ts:438-440`).

#### 4.3.2 Migration 0029

Latest on disk is `packages/db/migrations/0028_questionnaire_responses_group_scope.sql`, so
the next number is **0029**. Everything below is additive and backfill-free, which is what
the append-only law requires (`packages/db/src/schema.ts:26-31`, AGENTS.md rule 2). Generated
by `pnpm --filter @quagga/db db:generate` after hand-placing the tables in
`packages/db/src/schema.ts` — never by `npx auth migrate`, which is Kysely-only and would
fight the discipline (`docs/auth-platform-spec.md` §2.3).

**(1) `user_kind` enum + `users.kind`.** The cheapest item on this list and the one most
likely to be skipped. Without it a service row appears in the burner directory, in
`resolveAudience`, in member counts and in the deletion sweeper.

```ts
// APPEND-ONLY, like every enum here: `ALTER TYPE … ADD VALUE` only ever adds.
export const userKindEnum = pgEnum("user_kind", ["human", "service"]);
```

```ts
// added to the existing `users` table (schema.ts:283)
    /**
     * WHO THIS ROW IS (migration 0029). `service` rows are the identity anchor
     * for an `integrations` row and are NOT people: they are excluded from the
     * directory, from `resolveAudience`, from member counts, from the deletion
     * sweeper, and — load-bearing — from `bootstrapGod`, which would otherwise
     * self-elevate a service identity whose email happened to match GOD_EMAILS
     * (apps/web/lib/session.ts:62-103). Defaulted 'human' so every existing row
     * is correct without a backfill.
     */
    kind: userKindEnum("kind").notNull().default("human"),
```

**(2) `apikey` — adapter-owned shape.** ⚠ Field list from the plugin tarball; re-verify
against the installed package before generating. Hand-placed beside `twoFactor`/`passkey`
following the discipline stated at `schema.ts:320-328`: _the drizzle adapter looks columns
up by these camelCase property keys, so do not rename a field or drop a column to fit house
style._

```ts
// --- API keys (integrations) ---------------------------------------------
// Owned by the @better-auth/api-key plugin, wired in @quagga/auth (migration
// 0029). ADAPTER-OWNED SHAPE — the camelCase property keys ARE the Better Auth
// field names the drizzle adapter maps by; do not rename or drop one.
//
// `key` holds the SHA-256 hash of the presented secret, never the secret
// (defaultKeyHasher; `disableKeyHashing` stays false and is pinned by a test).
// `referenceId` points at a SERVICE `user.id` — never a person's. `permissions`
// is the plugin's Record<string,string[]> JSON; OUR ceiling lives in
// `integration_scopes` because a scope grant must be a diffable audit row, not a
// blob rewritten in place.
//
// The per-key rate-limit counters (rateLimitEnabled/TimeWindow/Max, requestCount,
// lastRequest) live HERE rather than in `rate_limit` deliberately: Better Auth's
// unfiltered sweep of that table (schema.ts:453-461) is exactly the bug that cost
// the forgot-password budget. Do not "consolidate" these into it.
export const apikey = pgTable(
  "apikey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    start: text("start"),
    prefix: text("prefix"),
    key: text("key").notNull(),
    // `referenceId`, NOT `userId`. This one is not ⚠: the rename is recorded in
    // this repo, at docs/auth-platform-spec.md §2.4 — "API Key plugin moved to
    // `@better-auth/api-key` (`userId`→`referenceId`)" — in the 1.5 breaking-
    // change list the pin was chosen against. TEXT, referencing `user.id`
    // (Better Auth's lean identity table, whose id is text), never `users.id`
    // (ours, uuid).
    referenceId: text("reference_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: timestamp("last_refill_at", { mode: "date" }),
    enabled: boolean("enabled").notNull().default(true),
    rateLimitEnabled: boolean("rate_limit_enabled").notNull().default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window"),
    rateLimitMax: integer("rate_limit_max"),
    requestCount: integer("request_count").notNull().default(0),
    remaining: integer("remaining"),
    lastRequest: timestamp("last_request", { mode: "date" }),
    expiresAt: timestamp("expires_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (k) => ({
    keyIdx: index("apikey_key_idx").on(k.key),
    referenceIdx: index("apikey_reference_id_idx").on(k.referenceId),
  }),
);
```

⚠ One shape question still to settle against the installed package before generating:
whether `configId` is present on 1.6.25. **Match whatever the CLI emits, exactly** — a
mismatch here is a silent adapter field-mapping failure, not a compile error. Note
`docs/auth-platform-spec.md` §2.3 is explicit about the procedure: `npx auth generate`
emits Drizzle table code, hand-place it into `packages/db/src/schema.ts`, then
`pnpm --filter @quagga/db db:generate` produces the append-only SQL — and **never**
`npx auth migrate`, "that is Kysely-only and never touches a Drizzle project".

**(3) `integrations` — ours.**

```ts
// --- Integrations --------------------------------------------------------
// A third party that holds API keys (migration 0029). OURS, not the plugin's:
// the plugin knows about credentials, not about who owns one or which
// department answers for it.
//
// `owner_department_id` is what makes an integration's reach expressible in the
// vocabulary the console already speaks — a department owns DOMAINS
// (org_department_domains, schema.ts:854), so "who signed off on this
// integration" and "what can it touch" are answered by the same row.
//
// `service_user_id` is the SYNTHETIC identity every key acts as. It is a
// `users` row with kind='service'; it holds its OWN memberships and
// org_role_assignments, which is what lets every existing predicate
// (orgCanInDomain, hasProjectPermission, writeAuditEvent) run unmodified for a
// key-authenticated caller. It must NEVER hold membership role 'god', 'lead' or
// 'admin' — the first resolves everything (org-permissions.ts:438-440), the
// other two are an irrevocable per-camp backstop (project-permissions.ts:23-25).
// Pinned by tests, not by convention (§4.3.11).
export const integrationStatusEnum = pgEnum("integration_status", [
  "active",
  "suspended",
]);

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    ownerDepartmentId: uuid("owner_department_id")
      .notNull()
      .references(() => orgDepartments.id, { onDelete: "restrict" }),
    serviceUserId: uuid("service_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    contactEmail: text("contact_email"),
    status: integrationStatusEnum("status").notNull().default("active"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    suspendedAt: timestamp("suspended_at", { mode: "date" }),
  },
  (i) => ({
    slugUniq: uniqueIndex("integrations_slug_idx").on(i.slug),
    serviceUserUniq: uniqueIndex("integrations_service_user_idx").on(
      i.serviceUserId,
    ),
    departmentIdx: index("integrations_department_idx").on(i.ownerDepartmentId),
  }),
);
```

`onDelete: "restrict"` on both FKs is deliberate: deleting a department or a service user
out from under a live integration would leave keys authenticating against nothing. The
console's delete path suspends first.

**(4) `integration_keys` — ours; the join. (spec author's call)**

The decision names three tables. A fourth is required and follows the repo's own established
pattern: `apikey` is adapter-owned and cannot grow an `integration_id` column without
breaking the field mapping, exactly as `user` cannot grow `sanitized_at` — which is why
`users` sits beside `user` joined by a logical, FK-less id (`schema.ts:330-356`, a 27-line
comment on precisely this trade). `integration_keys` is that same pattern one level down.

```ts
// --- Integration keys ----------------------------------------------------
// OUR row beside each adapter-owned `apikey` row (migration 0029), the same
// shape as `users` sitting beside Better Auth's `user` (schema.ts:330-356): the
// plugin's table shape is not ours to extend, so anything we need to know about
// a key that Better Auth does not lives here.
//
// `api_key_id` is TEXT and there is deliberately NO foreign key to `apikey.id`
// — the plugin DELETES rows (an exhausted `remaining` with no refill is a hard
// delete, not a disable), and a cascade would take our audit-bearing row with
// it. The join is logical, exactly like users.auth_user_id → user.id.
//
// `rotated_from_key_id` is what makes rotation-with-grace legible: two live rows
// on one integration, the older carrying an `expiresAt`, and a console that can
// say "this key replaced that one on 14 March".
export const integrationKeys = pgTable(
  "integration_keys",
  {
    apiKeyId: text("api_key_id").primaryKey(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    rotatedFromKeyId: text("rotated_from_key_id"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { mode: "date" }),
    revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (k) => ({
    integrationIdx: index("integration_keys_integration_idx").on(
      k.integrationId,
    ),
  }),
);
```

**(5) `integration_scopes` — ours; rows, validated in code.**

```ts
// --- Integration scopes --------------------------------------------------
// THE KEY'S CEILING (migration 0029). One ROW per granted scope, per key.
//
// WHY ROWS AND NOT A JSONB BLOB on `apikey.permissions`: a scope grant is a
// decision somebody made, and `git`-style diffability is the whole value —
// "who added org:delete:suppliers to this key, and when" is one indexed query
// against a row, and a rewrite-in-place blob cannot answer it at all. The
// plugin's own `permissions` column stays NULL; we never ask its `authorize()`.
//
// WHY NO `CHECK` CONSTRAINT AGAINST THE VOCABULARY: the scope vocabulary is a
// fact about the application code — the same reasoning that keeps
// org_department_domains.domain TEXT rather than an enum (schema.ts:850-852).
// A CHECK turns "add a domain" into production DDL forever, on a pipeline that
// auto-applies migrations. Validation is `assertScopeVocabulary()` in
// @quagga/core, called on every insert path, and a nightly reconciliation job
// that reports any row whose scope is no longer in the vocabulary.
//
// PER KEY, NOT PER INTEGRATION, so rotation can issue a NARROWED replacement and
// so the SDK's construction-time ScopeContractError diff is against the thing
// the integrator actually holds.
export const integrationScopes = pgTable(
  "integration_scopes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    apiKeyId: text("api_key_id").notNull(),
    /** A `Scope` string from @quagga/scopes. Validated in code, not by DDL. */
    scope: text("scope").notNull(),
    grantedByUserId: uuid("granted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (s) => ({
    keyScopeUniq: uniqueIndex("integration_scopes_key_scope_idx").on(
      s.apiKeyId,
      s.scope,
    ),
    keyIdx: index("integration_scopes_key_idx").on(s.apiKeyId),
  }),
);
```

Deferred to a later migration on purpose: the **per-key camp allowlist**
(`integration_key_camps`) lands with the v0.2 camp tranche, and the **idempotency table**
lands with the v0.2 write tranche. 0029 stays small enough to review in one sitting.

#### 4.3.3 Plugin registration and configuration

`packages/auth/src/config.ts:71-84` gains one adapter key; the plugin list at `:225-255`
gains one entry.

```ts
// packages/auth/src/config.ts — adapter schema map
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        rateLimit: schema.rateLimit,
        twoFactor: schema.twoFactor,
        passkey: schema.passkey,
        // Migration 0029. Plugin-owned; our own integration tables are NOT
        // registered here — the adapter must not see them.
        apikey: schema.apikey,
      },
```

```ts
// packages/auth/src/config.ts — plugins
    apiKey({
      // Authorization: Bearer, not x-api-key. One header for both credential
      // kinds, and it is on every proxy's and log scrubber's redaction list.
      customAPIKeyGetter: (ctx) => {
        const h = ctx.headers?.get("authorization") ?? "";
        return h.startsWith("Bearer ") ? h.slice(7) : null;
      },
      defaultPrefix: "ab_sk_live_",
      // Enough of the key to identify it in the console and in a log grep,
      // never enough to use. Prefix (11) + 8 random characters.
      startingCharactersConfig: { shouldStore: true, charactersLength: 19 },

      // NON-NEGOTIABLE, both pinned by tests (§4.3.11).
      //
      // enableSessionForAPIKeys: its before-hook turns any key presented on any
      // /api/auth/* path into a FULL session for the reference user, and calls
      // validateApiKey WITHOUT a `permissions` argument — the key's scopes are
      // not consulted at all. That is a total scope bypass wearing a
      // convenience flag.
      enableSessionForAPIKeys: false,
      // SHA-256 at rest. Correct for a 365-bit random secret (no dictionary to
      // attack) and the reason lookup can be an indexed equality. Turning this
      // off is the same class of mistake as storeBackupCodes:'plain'.
      disableKeyHashing: false,

      // Real limits, not the plugin's 10-per-24h demo defaults. §4.6.
      rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 300 },
    }),
```

**The plugin's own HTTP endpoints are not reachable.** ⚠ `/api-key/create`, `/delete`,
`/get`, `/list`, `/update` mount under `/api/auth` and are _session_-authenticated, so any
signed-in user of any of the three apps could mint themselves a key. There is no config flag
for this. The mitigation is an explicit exclusion in each app's catch-all handler, and it is
the single highest-value hardening decision in the whole design:

```ts
// apps/{web,org,suppliers}/app/api/auth/[...all]/route.ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

const handlers = toNextJsHandler(auth);

// The @better-auth/api-key plugin mounts /api-key/* under /api/auth and gates it
// on a SESSION. Any signed-in burner could mint themselves a key. Key lifecycle
// is a System-manager operation and goes through the Integrations console server
// actions ONLY (apps/org/lib/actions/integrations.ts). Refuse the plugin's own
// endpoints here rather than trusting that nobody finds them.
function blocked(request: Request): boolean {
  return new URL(request.url).pathname.includes("/api-key/");
}

export async function GET(request: Request) {
  if (blocked(request)) return new Response(null, { status: 404 });
  return handlers.GET(request);
}
export async function POST(request: Request) {
  if (blocked(request)) return new Response(null, { status: 404 });
  return handlers.POST(request);
}
```

Pinned by an integration test that POSTs `/api/auth/api-key/create` with a valid session
against all three apps and asserts 404. A comment is not the boundary.

#### 4.3.4 Key format

```
ab_sk_live_<64 chars, [a-zA-Z]>          production
ab_sk_test_<64 chars, [a-zA-Z]>          non-production
abdt_<opaque>                            v0.2 delegation token (different animal, §4.3.12)
```

⚠ `defaultKeyGenerator` is `prefix + generateRandomString(64, "a-z", "A-Z")` — 64 characters
over a 52-symbol alphabet, ≈365 bits. That is the plugin default and stays.

`ab_sk_`, matching the published package scope `@afrikaburn/*`, so a secret scanner rule and
a log-grep pattern are one unambiguous regex: `ab_sk_(live|test)_[A-Za-z]{64}`. Register
that pattern with GitHub secret scanning on day one — the repo already runs
`mcp__github__run_secret_scanning`-visible scanning, and a partner pasting a key into a
public issue is the most likely leak path, not a database dump.

The console displays `apikey.start` (`ab_sk_live_` + 8 chars). The plaintext is returned
**once**, at creation, and is never recoverable: lookup is by hash.

#### 4.3.5 Hashing

⚠ `defaultKeyHasher` = unpadded base64url SHA-256 of the UTF-8 key. Left alone.

SHA-256 is correct here and wrong in general, so the reason is written down: there is no
dictionary to attack a 365-bit uniformly random secret, and an indexed equality lookup is
what keeps verification to one Neon round trip on the stateless `neon-http` driver
(`packages/db/src/index.ts:37-39` — no transactions). **Do not "improve" this into bcrypt or
argon2**: the win is zero and the cost is a table scan per request. Pin
`defaultKeyLength >= 32` in a config assertion test so a future `customKeyGenerator`
producing a short or human-chosen key cannot silently make the hash brute-forceable from a
dump.

#### 4.3.6 Rotation with grace

The plugin has no rotation primitive and does not need one. Two `apikey` rows on one
`integrations.id` with different `expiresAt` **is** the grace window.

```
rotate(integrationId, oldKeyId, graceDays = 7):
  1. read integration_scopes for oldKeyId
  2. create a new apikey row (same referenceId / service user)
  3. copy the scope rows to the new key id      ← the ceiling survives rotation
  4. insert integration_keys { apiKeyId: new, integrationId, rotatedFromKeyId: old }
  5. UPDATE apikey SET expires_at = now() + graceDays WHERE id = oldKeyId
  6. audit: integration.key.rotated
  7. return the plaintext ONCE
```

⚠ The plugin deletes expired rows on the next verification, so cleanup is free — which is
exactly why `integration_keys` has **no FK** to `apikey.id` (§4.3.2 item 4). Our audit-bearing
row must outlive the plugin's.

The console shows both keys, the old one badged with its expiry and a countdown, and offers
"revoke now" so a compromised key's grace can be cut to zero.

#### 4.3.7 Revocation — three levels, all instant

| Level           | Mechanism                                                                          | Blast radius                    |
| --------------- | ---------------------------------------------------------------------------------- | ------------------------------- |
| one key         | `apikey.enabled = false` + `integration_keys.revoked_at`                           | that credential                 |
| one integration | `integrations.status = 'suspended'` — checked in **our** wrapper, not the plugin's | every key the integration holds |
| everything      | the existing kill switch (`docs/auth-platform-spec.md` §8.11)                      | all API traffic                 |

All three are instant because every verification is a database read against the hash. **The
cookie-cache caveat does not apply** — `AUTH_SESSION.cookieCacheMaxAgeSeconds = 300`
(`packages/auth/src/env.ts:56-60`) is about sessions, and there is no cached key path
because `enableSessionForAPIKeys` is false. Say that out loud in the console copy: "revoking
a key takes effect on the next request", which is a stronger promise than the one the
sessions screen can make.

The _manifest's_ 300s TTL is a separate, client-side staleness and is matched to
`cookieCacheMaxAgeSeconds` deliberately so there is one number and one staleness story to
explain (§7 risk 2).

#### 4.3.8 The verification path — one function, one place

```ts
// packages/auth/src/api-key.ts   →  exported as "@quagga/auth/api-key"
import "server-only";

export type ApiCallerResult =
  | { ok: true; caller: ApiCaller }
  | {
      ok: false;
      status: 401 | 403 | 429;
      code: string;
      retryAfterSeconds?: number;
    };

export interface ApiCaller {
  keyId: string;
  keyPrefix: string; // apikey.start — safe to log and to echo
  integrationId: string;
  integrationSlug: string;
  serviceUserId: string; // users.id — the audit actor
  ceiling: readonly Scope[]; // from integration_scopes
}

/** Authenticate an /api/v1 request. Reads ONLY the Authorization header —
 *  never a cookie, never a query parameter. */
export async function authenticateApiRequest(
  request: Request,
): Promise<ApiCallerResult>;
```

It lives in `@quagga/auth` because it needs the better-auth instance. The _authorisation_
half is pure and lives in `@quagga/core`:

```ts
// packages/core/src/integration-manifest.ts   (NEW — pure, no @quagga/db)
export function manifestForKey(input: {
  key: { id: string; prefix: string; name: string; integrationSlug: string };
  ceiling: readonly Scope[];
  actor: OrgActor | null; // from loadOrgActor()
  camps: readonly CampSubject[]; // from loadCampPermissions()
  routes: Record<string, { base: string }>;
  kernel: string;
}): Manifest;

export function assertScopes(
  m: Manifest,
  req: { scopes: readonly Scope[]; groupId?: string },
): void;
```

`manifestForKey` is **assembly, not policy**: every allow/deny inside it comes from
`summarizeOrgActor`, `orgCanInDomain`, `orgCapabilityRefusal` and `hasProjectPermission`.
The anti-drift test (§4.8 task 12) is what keeps that true.

**`loadOrgActor` is missing and must be extracted (spec author's call).** Building an
`OrgActor` (`packages/core/src/org-permissions.ts:428-432` — `{rank, roles, domains}`) from
a `users.id` is currently done inline inside `resolveOrgSession`
(`apps/org/lib/session.ts:135-291`), which reads cookies, and is _duplicated_ for the org
branch at `apps/web/lib/medical-access.ts:205-227`. The API route is the third caller, and
it has no cookie. Extract to `packages/db/src/actor.ts`:

```ts
export async function loadOrgActor(
  db: DbHandle,
  userId: string,
): Promise<OrgActor | null>;
export async function loadCampPermissions(
  db: DbHandle,
  userId: string,
  groupIds?: readonly string[],
): Promise<CampSubject[]>;
```

Extracting it also fixes a live fail-open: `apps/web/lib/medical-access.ts:215` does
`orgRankFromRole(actorOrgRole) ?? "org_staff"`, fabricating a rank the org app treats as
**forbidden** (`apps/org/lib/session.ts:234-235`). It is latent today because the console's
write path always sets a rank first, but any code that mints an actor from raw membership
rows — which is exactly what the API route does — hits it. See §4.9.

#### 4.3.9 The Integrations console screen

New route `apps/org/app/(console)/integrations/`, added to `NAV_ITEMS` in
`apps/org/components/console-header.tsx:35`. Behind **`requireSystemManager("manage
integrations and their API keys")`** — `apps/org/lib/session.ts:364-375` — not behind a
capability. The reasoning is the one already written there: _"Editable permissions are only
safe because the ability to edit them cannot itself be granted away."_ An API key is a
grant of rights; minting one must be the rank, and the rank alone.

| Screen                        | Shows                                                                                                        | Actions                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `/integrations`               | name, slug, owning department, status, key count, last request                                               | Create                                               |
| `/integrations/[id]`          | contact, service user, its memberships + org roles, **`summarizeOrgActor` output rendered as-is**, keys list | Suspend / Resume, Rotate, Revoke                     |
| `/integrations/[id]/scopes`   | the 49-scope grid, per key, with each cell's live verdict                                                    | Grant / Ungrant one scope (one row, one audit event) |
| `/integrations/[id]/activity` | `audit_events` filtered to `actor_id = service_user_id`                                                      | —                                                    |

Three UI rules that are not cosmetic:

1. **The scope grid renders each cell's verdict, not just its grant.** A scope that is
   granted on the key but denied by the live subject shows amber with
   `orgCapabilityRefusal(actor, cap, domain)` as its title — the manifest's `hollow` concept
   surfaced in the console. Granting a scope the subject cannot exercise is legal (the
   subject may gain it later) and must not look like it works.
2. **The plaintext key is shown once, in a modal, with a copy button and no persistence.**
   Same ceremony as 2FA backup codes.
3. **`personal_information` is not on the grid at all** (decision 9). Not greyed out —
   absent. A control that always refuses is the affordance that eventually gets a `true`.

Server actions in `apps/org/lib/actions/integrations.ts`, every one opening with
`requireSystemManager(...)` and closing with `writeAuditEvent`, exactly like
`apps/org/lib/actions/org-roles.ts`.

#### 4.3.10 Audit events

Reuse `audit_events` (`packages/db/src/schema.ts:1706-1737`) — it already indexes
`actor_id`, `action`, `subject` and `created_at DESC`. No new table.

**Lifecycle events** — `actor_id` = the acting System manager's `users.id`, `subject` =
`integration:<id>` or `apikey:<id>`:

| action                                   | meta                                                           |
| ---------------------------------------- | -------------------------------------------------------------- |
| `integration.created`                    | `{ slug, department_id, service_user_id }`                     |
| `integration.suspended` / `.resumed`     | `{ slug, reason? }`                                            |
| `integration.key.created`                | `{ key_id, key_prefix, scopes: [...] }`                        |
| `integration.key.rotated`                | `{ key_id, rotated_from, grace_until }`                        |
| `integration.key.revoked`                | `{ key_id, key_prefix }`                                       |
| `integration.scope.granted` / `.revoked` | `{ key_id, scope }` — **one row per scope**, never a diff blob |

**Call events** — `actor_id` = `integrations.service_user_id`, so the existing actor index
answers "everything this integration ever did":

| action                     | when      | meta                                                                    |
| -------------------------- | --------- | ----------------------------------------------------------------------- |
| `integration.call.refused` | any 403   | `{ key_id, code, operation, required_scopes, request_id }`              |
| `<existing action>`        | any write | the write's own action name, plus `{ key_id, integration, request_id }` |

Successful **reads are not audited** — one row per directory listing would bury the log that
`getMedicalAccessLog` and the POPIA erasure path depend on. Read volume is observable from
`apikey.requestCount` and `lastRequest`.

`bio.medical.view` is untouched and unreachable: no scope reaches medical notes.

**`apikey.metadata` is integrator-adjacent JSON and is never copied into `audit_events.meta`
unfiltered** — `docs/auth-platform-spec.md:692` requires the audit scrubber strip token-like
keys, and this is a new inbound path into `meta`.

#### 4.3.11 Invariant tests — each with a named assertion. **Blocking.**

These are the rails. Every one of them is cheap and every one of them fails loudly.

| Test                                  | Asserts                                                                                                               | Why                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service-user-is-never-god`           | `isSystemManager(loadOrgActor(integration.serviceUserId)) === false` for **every** `integrations` row                 | `god` resolves everything (`org-permissions.ts:438-440`)                                                                                                                                                                                                                                                                                      |
| `service-user-holds-no-camp-backstop` | no service user has `memberships.role ∈ {lead, admin}`                                                                | `isPermissionBackstop` is unconditional (`project-permissions.ts:23-25`) — a key that is a camp lead is a permanent un-narrowable skeleton key                                                                                                                                                                                                |
| `bootstrap-god-skips-service`         | `bootstrapGod` short-circuits on `users.kind = 'service'`                                                             | `apps/web/lib/session.ts:62-103`; a service email matching `GOD_EMAILS` would self-elevate on first request. Note `bootstrapGod` is module-private — the guard belongs inside `canBootstrapGod` (`@quagga/core`, called at `session.ts:66-72`) or at its call site in `getCurrentCampUser`, and the test asserts through the exported surface |
| `api-key-plugin-config`               | `enableSessionForAPIKeys === false`, `disableKeyHashing === false`, `defaultKeyLength >= 32`                          | ⚠ the session hook calls `validateApiKey` **without** `permissions` — a total scope bypass                                                                                                                                                                                                                                                    |
| `api-key-http-endpoints-blocked`      | `POST /api/auth/api-key/create` with a valid session → 404, on all three apps                                         | §4.3.3                                                                                                                                                                                                                                                                                                                                        |
| `v1-handlers-never-read-cookies`      | source scan: no file under `app/api/v1/**` references `getSession`, `cookies()` or `headers().get("cookie")`          | §4.1.1's structural claim. The idiom exists: `apps/org/lib/__tests__/org-rank-enforcement.test.ts` already reads ~20 source files                                                                                                                                                                                                             |
| `every-v1-handler-declares-scopes`    | source scan: every `app/api/v1/**/route.ts` exports a `scopes:` array                                                 | one gate, one throw site (§3.5)                                                                                                                                                                                                                                                                                                               |
| `manifest-anti-drift`                 | for a generated matrix of actors × keys, `assertScopes(manifestForKey(x), s)` passes ⟺ the corresponding guard passes | the manifest is assembly, not a second policy                                                                                                                                                                                                                                                                                                 |
| `integrator-refusal-leaks-nothing`    | no `ORG_DOMAIN_LABELS` value and no department name appears in an `audience:"integrator"` refusal                     | department names are the org chart (`org-permissions.ts:602`)                                                                                                                                                                                                                                                                                 |

#### 4.3.12 Delegation tokens (v0.2)

Not a key. Minted server-side by an integrator's backend, from a key, for one browser
session.

```
POST /v1/delegations                 Authorization: Bearer ab_sk_live_…
{ "subjectUserId": "…", "scopes": ["camp:view_member_details"], "audience": "https://their.app" }
→ { "token": "abdt_…", "expiresAt": "…" }   # ≤ 600 seconds
```

Four rules, all enforced server-side, all testable:

1. **Narrowing only.** `token.scopes ⊆ key.ceiling`. A request for a scope outside it is a
   422, not a silent trim.
2. **≤ 10 minutes.** Stored in `verification` (the table better-auth already uses for
   short-lived opaque values) or its own table; revocable either way.
3. **Audience-bound.** `aud` pinned to a registered origin; the CORS allowlist and the token
   audience are the same list.
4. **Never widened by refresh.** A refresh mints a token with the same or fewer scopes,
   never more, and a token cannot mint another token.

---

### 4.4 THE CAPABILITY / DISCOVERY ENDPOINT

#### `GET /v1/capabilities`

The one endpoint the SDK calls at construction. Returns the `Manifest` from §3.2.

```
Cache-Control: private, max-age=300
ETag: "k7f3…"
X-AfrikaBurn-Manifest-Version: <kernel>.<etag>
```

`If-None-Match` → `304` with no body. TTL is **300 seconds, matched to
`AUTH_SESSION.cookieCacheMaxAgeSeconds`** (`packages/auth/src/env.ts:59`) so the platform
has exactly one staleness number to explain. The ETag is a hash of the resolved manifest, so
a subject whose rights have not changed pays one round trip and no bytes.

Assembly, in order:

```
1. authenticateApiRequest()                    → ApiCaller (key, ceiling, serviceUserId)
2. integrations.status === 'active'            → else 403 integration_suspended
3. loadOrgActor(db, serviceUserId)             → OrgActor  (live rank, roles, domain ownership)
4. loadCampPermissions(db, serviceUserId)      → CampSubject[]  (bounded by the allowlist)
5. manifestForKey({...})                       → pure assembly in @quagga/core
6. ETag, 304, headers
```

Step 3 is why the ceiling can never be a source: the rank, the carve-outs and the backstop
are read from the database on every manifest fetch, not from the key.

**`refusals` is lazy** (decision 16): only scopes in `ceiling ∪ declared`. An exhaustive
40-cell refusal array serialised into a browser is a map of which department owns what — the
org chart, published. `orgCapabilityRefusal(actor, cap, domain, { audience: "integrator" })`
produces the sentence; the integrator arm names no department.

**`never` is informational and is not part of `Scope`.** It exists so `<RightsInspector />`
can say "medical notes and hard-locked contact details are outside every scope" without the
strings ever being addressable. A right that always denies is not in the vocabulary.

#### `GET /v1/capabilities/camps?slugs=a,b,c`

Up to 50 slugs per call. Returns `CampGrant[]`, with the §4.1.8 rule: a slug that does not
exist, a free camp the key cannot see, and a camp the key holds nothing on all return
**identical** entries (`permissions: []`, `backstop: false`).

`manage_roles ⇒ assign_roles` is materialised here, server-side, once
(`packages/core/src/project-permissions.ts:53`). The client evaluator never re-derives it —
two implementations of one rule is the failure this whole design exists to avoid.

#### `GET /.well-known/afrikaburn-scopes` (v1.0)

Unauthenticated. The scope catalogue: every scope string, its human label, its refusal
consequence, the operations that accept it. RFC 9728-shaped (`scopes_supported`), so a
generic OAuth-aware client can self-describe. Deferrable — it is documentation with a
content type, and the SDK ships the same table compiled in.

---

### 4.5 THE PII STRIPPER — §9.4 DECISION 2. **BLOCKING.**

`docs/auth-platform-spec.md:626-630` requires ONE unconditional strip helper in
`@quagga/core`, reused by first-party **and** integrator responses, so hard-locked fields can
never be scoped in, and says to _"build the stripper now even though only first-party calls
it — a per-caller filter is the failure mode that leaks PII when a scope or filter is
mistaken."_

**It does not exist.** `packages/core/src/privacy.ts` is 127 lines and holds only the two
field lists, their union, three membership predicates (`isHardLockedPrivate`,
`isSafetyVisibleField`, `isAlwaysPrivate`), `canBePublic`, `enforcePrivacyFlags` and
`privacyViolations`. Every one of them answers _"may this FIELD NAME be public?"_; not one
of them takes a payload. The nearest thing is
`publicBioView` (`packages/core/src/bio.ts:359`), which is a bio-only public projection
gated on per-field flags. Nothing covers org-facing shapes, and nothing covers
`registrations`.

#### The mechanism: a zod output schema whose `.parse()` is the stripper

Not a helper function. A **schema**, in `packages/types/src/responses/*`, and the response
body is whatever `.parse()` returns.

```ts
// packages/types/src/responses/camp.ts
import { z } from "zod";

export const CampSummaryResponse = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  kind: z.enum(["theme_camp", "artwork", "mutant_vehicle"]),
  description: z.string().nullable(),
  registered: z.boolean(),
  memberCount: z.number().int(),
  categories: z.array(
    z.object({ id: z.uuid(), label: z.string(), emoji: z.string() }),
  ),
});

export type CampSummaryResponse = z.infer<typeof CampSummaryResponse>;
```

(`z.uuid()` top-level rather than `z.string().uuid()`: the repo is on zod `^4.4.3` in every
workspace — `packages/{core,types}/package.json` and all three apps.)

**Plain `z.object()`, deliberately NOT `.strict()`.** In zod 4 they are opposite failure
modes and only one of them is a stripper: `z.object().parse()` **strips** unknown keys and
returns the trimmed object, while `.strict()` **throws** on an unknown key. A stripper that
throws is not a stripper — the day someone adds a column to `burner_bios` or `registrations`
and a store's `select()` picks it up, `.strict()` turns every read of that shape into a 500,
and the pressure to "just loosen the schema" arrives at exactly the wrong moment. Stripping
degrades to the _safe_ side without a decision. (`.strict()` is also deprecated in zod 4 in
favour of `z.strictObject()`, so writing it invites a codemod to change the semantics
silently.)

A field absent from the schema cannot be in the body, cannot be in the emitted type, and
cannot be in the generated documentation. **"Someone forgot to call the stripper" becomes
inexpressible** — which is precisely what "unconditional" has to mean.

Rejected: a `stripHardLockedFields(payload)` helper called per handler. That is the
per-caller filter §9.4 decision 2 forbids, and it cannot see the seven registration contact
columns at all (below).

#### Two build-failing assertions, in the emitter

**(a) Forbidden-field walk.** Recursive over every response schema's shape; any key matching
the forbidden set fails the build with a JSON pointer to the offending path.

```ts
// packages/types/src/responses/__tests__/no-forbidden-fields.test.ts
import {
  HARD_LOCKED_PRIVATE_FIELDS, // privacy.ts:39-47  — 7 fields
  SAFETY_VISIBLE_FIELDS, // privacy.ts:57     — medical
  REGISTRATION_CONTACT_KEYS, // promoted by task 4 (below)
} from "@quagga/core";

const FORBIDDEN = new Set<string>([
  ...HARD_LOCKED_PRIVATE_FIELDS,
  ...SAFETY_VISIBLE_FIELDS,
  ...REGISTRATION_CONTACT_KEYS,
  "medicalNotes",
  "medicalNotesUnreadable",
  "saIdEncrypted",
  "passportEncrypted",
]);
```

Two mechanical notes on that import, both load-bearing:

- **All three come from the package root.** `packages/core/package.json` declares exactly two
  export paths, `"."` and `"./report-server"`; a `@quagga/core/registration-contact` subpath
  would not resolve. Task 4 re-exports `REGISTRATION_CONTACT_KEYS` from
  `packages/core/src/index.ts` like everything else.
- **`legalName` is NOT in the forbidden set, and putting it there would fail the build on our
  own v0.1 endpoint.** `publicBioView` returns `legalName` (`packages/core/src/bio.ts:371`)
  whenever the burner has explicitly set that flag public — it is an opt-in public field, not
  a hard-locked one, and `HARD_LOCKED_PRIVATE_FIELDS` does not contain it (`privacy.ts:39-47`
  is `saId`, `passport`, `phone`, and the four emergency-contact fields). `PublicProfile` for
  `GET /v1/burners/{username}` carries it. The same applies to `contactEmail`. Forbidding a
  field the privacy module deliberately allows is the mirror image of the leak, and it would
  make the deliberately-red build red for the wrong reason.

**Imported, never retyped.** `HARD_LOCKED_PRIVATE_FIELDS` is keyed on `burner_bios`
privacy-flag names; the seven registration contact columns live on `registrations` and are
therefore outside `ALWAYS_PRIVATE_FIELDS` entirely. They are declared today as a
module-private constant at `apps/org/lib/queries.ts:952-960`:

```
s1ContactEmail, s1AltContactName, s1AltContactPhone, s1AltContactEmail,
s2LntLeadName, s2LntLeadPhone, s2LntLeadEmail
```

with the comment _"The `registrations` columns that are a HUMAN BEING'S contact details
rather than facts about a camp"_. **Task: promote that tuple into `@quagga/core` as
`REGISTRATION_CONTACT_KEYS`** and have `apps/org/lib/queries.ts` import it. Two consumers,
one list. This is the sharpest hole in the whole surface: a naive `registrations:read`
leaks third-party phone numbers that the privacy module has never seen.

**(b) Open-ended-zod ban.** No `z.any()`, `z.unknown()`, `z.record()`, `.passthrough()`, or
`unrepresentable: "any"` anywhere in a response schema tree. One `z.record()` disables
stripping for its whole subtree — a review-invisible one-line PII bypass in the exact
mechanism the safety argument rests on.

#### The deliberately-red build

Ship it in v0.1 and record the commit: add a `phone` to a response schema, watch CI fail,
revert, put the hash in `packages/sdk/README.md`. If that assertion ever becomes skippable,
the SDK is no longer safe to point at this database.

#### The other missing extraction: the free-camp predicate. **Blocking.**

The undiscoverability law is re-implemented in at least four places (`groups-store.ts:187`,
`groups-store.ts:453-500`, `profile-camps.tsx:10-14`, `join/[token]/page.tsx:34` +
`invite-view.ts:57`). Every SDK read endpoint becomes the fifth. Extract it first:

```ts
// packages/core/src/camp-visibility.ts   (NEW — pure)
export function campIsVisibleTo(input: {
  registrationStatuses: readonly RegistrationStatus[];
  viewerRole: MembershipRole | null;
}): boolean {
  return isRegistered(input.registrationStatuses) || input.viewerRole !== null;
}
```

One predicate, five call sites, one test file. For an API caller `viewerRole` is always
`null`, and there is no parameter that can make it otherwise.

---

### 4.6 RATE LIMITING AND ABUSE

Both existing limiters miss an API caller:

- Better Auth's fires only on HTTP requests to `/api/auth/*` and keys on `(ip, path)`
  (`packages/auth/src/config.ts:211-218`; ⚠ `createRateLimitKey(ip, path)`). `/v1` is not
  under `/api/auth`, so it sees nothing.
- `consumeRateLimit` keys on IP (`packages/db/src/rate-limit.ts:148-153`) and **fails open**
  on storage error (`:137-140`).

#### The layers

| #   | Layer         | Key                           | Budget                                   | Storage                                 | Failure mode                                                                              |
| --- | ------------- | ----------------------------- | ---------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| 0   | shape reject  | —                             | —                                        | none                                    | ⚠ the plugin already refuses a key shorter than `defaultKeyLength` before touching the DB |
| 1   | IP pre-filter | `api_ip:<ip>`                 | 600 / 60s                                | `action_rate_limit`                     | **fails open** — it is a shield, not the limit                                            |
| 2   | per-key limit | `apikey.id`                   | 300 / 60s, per-key overridable           | the `apikey` row's own guarded counters | fails closed                                                                              |
| 3   | per-operation | `apikey.id` + operation class | writes 60/60s, capability probes 120/60s | `action_rate_limit`                     | fails open                                                                                |

Layer 1 exists so an unauthenticated flood costs one cheap indexed write rather than a key
lookup plus an actor load. `rateLimitIp` (`rate-limit.ts:148-153`) already returns a stable
fallback so an unattributable caller shares one bucket rather than escaping.

Layer 2 is the real limit. ⚠ Its counters (`rateLimitEnabled`, `rateLimitTimeWindow`,
`rateLimitMax`, `requestCount`, `lastRequest`) live on the `apikey` row and are incremented
by the plugin's guarded single-statement `incrementOne`, so concurrent verifications cannot
overshoot. **Do not consolidate them into `rate_limit`** — that table's unfiltered sweep is
the bug documented at `packages/db/src/schema.ts:453-461` and re-explained at
`packages/db/src/rate-limit.ts:13-35`, and doing it again with a new name is the same
mistake.

**Do not use `remaining` / `refillInterval` for quotas.** ⚠ A key whose `remaining` hits zero
with no refill configured is **deleted** by the plugin, not disabled — which destroys the
`integration_keys` audit linkage and makes a quota exhaustion indistinguishable from a
revocation. If a quota is wanted later, implement it in our wrapper against
`apikey.requestCount`.

#### Response

```
429
RateLimit: limit=300, remaining=0, reset=41
RateLimit-Policy: 300;w=60
Retry-After: 41
```

`code: "rate_limited"`, distinct from `invalid_credential`. Never collapsed into the opaque
401 — a rate limit that looks like a bad key sends an integrator to rotate a working
credential.

#### Neon exposure

Every verification is one round trip on the stateless `neon-http` driver
(`packages/db/src/index.ts:37-39`, no transactions), so every statement here must stay
single-statement. Layer 1 is the compute shield. `docs/auth-platform-spec.md:721` says "No
Redis/Upstash at launch"; an external API is the volume argument that reopens it, and
`auth-platform-spec.md:744` records that Vercel WAF rate-limit rules are Pro+ and blocked on
an open decision. Neither blocks v0.1 — a `public:*`-only read API at v0.1 volumes is served
by layers 1–2.

---

### 4.7 OBSERVABILITY

`telemetry: { enabled: false }` at `packages/auth/src/config.ts:65` — "No outbound telemetry
from a POPIA-holding auth stack." That constraint holds for `/v1`. **No third-party APM, no
error-reporting SaaS, no request-body capture.** Everything below is either a database row or
a structured line in Vercel's own log drain.

#### Structured logs

One line per refused or failed request, never per successful read. JSON, one shape:

```jsonc
{
  "at": "api.v1",
  "request_id": "…",
  "op": "org.suppliers.setStanding",
  "key_id": "key_01J…",
  "key_prefix": "ab_sk_live_A7fQ2mZk",
  "integration": "dusty-tools",
  "status": 403,
  "code": "insufficient_scope",
  "required": ["org:update:suppliers"],
  "ms": 34,
  "kernel": "2027.03.14-a91c2",
}
```

`console.error` for 5xx, `console.warn` for 4xx — the same discipline as
`packages/db/src/rate-limit.ts:137` and the deletion-sweep route, which learned the hard way
that _"a failed erasure is not a successful run"_ and that a body-tucked failure looks like a
healthy cron entry.

**Never logged:** the presented credential (log `key_prefix`, which is `apikey.start`),
request bodies, response bodies, any value whose key is in the §4.5 forbidden set. The log
formatter runs the same forbidden-key walk as the response emitter, and is covered by the
same test.

#### Database-resident metrics

No new metrics store. Everything an operator needs is already queryable:

| Question                   | Query                                                                       |
| -------------------------- | --------------------------------------------------------------------------- |
| is this integration alive? | `apikey.lastRequest`, `requestCount`                                        |
| what did it do?            | `audit_events WHERE actor_id = service_user_id` (indexed, `schema.ts:1721`) |
| what is it being refused?  | `audit_events WHERE action = 'integration.call.refused'` (indexed, `:1722`) |
| is a key about to expire?  | `apikey.expiresAt`                                                          |

#### The System panel

`apps/org/lib/system-probe.ts` gains an **Integrations** probe, visible to `runsDeployment`
(engineer ∪ god, `org-permissions.ts:671-673`): active integrations, live keys, keys expiring
inside 14 days, refusals in the last 24h, and the **kernel stamp** — the build id
`manifestForKey` embeds and every response echoes. A kernel mismatch between two apps'
manifests is the loud version of the version-skew failure the whole manifest design exists to
avoid, and the panel is where it becomes visible.

#### Alert-worthy

| Condition                                                        | Why                                                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `integration.call.refused` rate > 20% for one key over 15 min    | a rights change broke an integrator; nobody else will tell you                            |
| any `rank_ceiling` refusal                                       | a service subject has been given an `engineer` rank — almost certainly a misconfiguration |
| any successful call by a subject where `isSystemManager` is true | the invariant test has been defeated at runtime; page someone                             |
| manifest `kernel` differs across apps                            | version skew                                                                              |

---

### 4.8 IMPLEMENTATION PLAN

Sizing for one engineer: **S** ≤ half a day · **M** 1–3 days · **L** 4–10 days · **XL** > 10
days. **[B]** blocks v0.1.

#### Phase 0 — unblock the repo (nothing merges without these)

| #   | Task                                                                                                                                                                                                                                                                                                                                                                | Size | Depends on |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------- |
| 1   | **[B]** `commitlint.config.mjs` `SCOPES` += `scopes`, `sdk`, `react`; mirror in `CONTRIBUTING.md:158-165`. The list is 10 entries today (`commitlint.config.mjs:16-31`), `scope-enum` is severity 2, and CI lints the PR title **and every commit in the range** (`commitlint.config.mjs:5-7`). Every SDK commit fails CI until this lands.                         | S    | —          |
| 2   | **[B]** `packages/scopes` (private, FSL, zero deps): the 49 scope strings + as-const vocabularies. Invert `packages/types/src/roles.ts:150` — today `ORG_CAPABILITY_KEYS = OrgCapabilityKey.options` derives the tuple from the zod enum; flip to `z.enum(ORG_CAPABILITY_KEYS)`. ~10 lines, gives a zod-free vocabulary to producer, SDK and `@quagga/types` alike. | S    | 1          |
| 3   | **[B]** CI coverage-matrix rows for the new workspaces — `.github/workflows/ci.yml` uses an explicit `include:` list, so a new workspace is **not** auto-enrolled.                                                                                                                                                                                                  | S    | 2          |

#### Phase 1 — the safety floor (build before anything is exposed)

| #   | Task                                                                                                                                                                                                                           | Size | Depends on |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---------- |
| 4   | **[B]** Promote `REGISTRATION_CONTACT_KEYS` from `apps/org/lib/queries.ts:952-960` into `@quagga/core`; `queries.ts` imports it.                                                                                               | S    | —          |
| 5   | **[B]** `packages/core/src/camp-visibility.ts` — the free-camp predicate; repoint all four existing call sites.                                                                                                                | M    | —          |
| 6   | **[B]** `packages/types/src/responses/*` — zod output schemas for the 9 v0.1 DTOs.                                                                                                                                             | L    | 2          |
| 7   | **[B]** The two emitter assertions (forbidden-field walk, open-ended-zod ban), both failing the build with a JSON pointer. **Plus the deliberately-red build**, recorded by hash.                                              | M    | 4, 6       |
| 8   | **[B]** `packages/db/src/actor.ts` — `loadOrgActor` / `loadCampPermissions`; repoint `apps/org/lib/session.ts` and `apps/web/lib/medical-access.ts:205-227`; delete the `?? "org_staff"` fail-open at `medical-access.ts:215`. | M    | —          |

#### Phase 2 — the key system

| #   | Task                                                                                                                                                                                                                                                      | Size | Depends on |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------- |
| 9   | **[B]** Add `@better-auth/api-key@1.6.25` to `packages/auth`; re-verify every ⚠ fact against the installed package; run the Better Auth CLI generate.                                                                                                     | S    | —          |
| 10  | **[B]** Migration **0029**: `apikey`, `integrations`, `integration_keys`, `integration_scopes`, `user_kind` + `users.kind`, `integration_status`. Hand-place, then `db:generate`. Neon preview branching means the PR exercises it on an isolated branch. | M    | 9          |
| 11  | **[B]** `packages/auth/src/api-key.ts` — `authenticateApiRequest`; plugin config; the `/api-key/*` HTTP block in all three catch-alls.                                                                                                                    | M    | 10         |
| 12  | **[B]** All nine invariant tests (§4.3.11).                                                                                                                                                                                                               | M    | 11         |

#### Phase 3 — the manifest

| #   | Task                                                                                                                                                                                                                  | Size | Depends on |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------- |
| 13  | **[B]** `packages/core/src/integration-manifest.ts` — `manifestForKey` + `assertScopes`, pure assembly over `summarizeOrgActor` / `orgCanInDomain` / `orgCapabilityRefusal` / `hasProjectPermission`.                 | L    | 2, 8       |
| 14  | **[B]** The anti-drift test: actors × keys matrix, `assertScopes(manifestForKey(x), s)` passes ⟺ the guard passes.                                                                                                    | M    | 13         |
| 15  | **[B]** `orgCapabilityRefusal(..., { audience: "integrator" })` — one extra arm on the existing generator at `org-permissions.ts:621`, never a second copy table (`:611-615` names that failure). Plus the leak test. | S    | 13         |
| 16  | **[B]** `GET /v1/capabilities` + `/v1/capabilities/camps` on `apps/web`, with ETag/304.                                                                                                                               | M    | 11, 13     |

#### Phase 4 — the v0.1 wire

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Size | Depends on |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------- |
| 17  | **[B]** The `/v1` handler wrapper: auth → scope gate → rate limit → handler → zod parse → headers → problem+json. One gate, one throw site.                                                                                                                                                                                                                                                                                                                                                                                     | M    | 11, 16     |
| 18  | **[B]** Rate limiting layers 1–3 (§4.6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | M    | 11         |
| 19  | **[B]** The 7 remaining v0.1 read endpoints.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | L    | 6, 17      |
| 20  | **[B]** `api.quagga.ryanjnoble.dev` Vercel alias; `routes` config; the oracle tests (identical bytes and timing for the three not-visible camp cases).                                                                                                                                                                                                                                                                                                                                                                          | M    | 19         |
| 21  | **[B]** Observability: structured logger with the forbidden-key walk, `X-Request-Id`, the System panel probe.                                                                                                                                                                                                                                                                                                                                                                                                                   | M    | 17         |
| 22  | **[B]** Docs/licence/release: `README.md:9`, `README.md:218-224`, `AGENTS.md:34-35` (all assert FSL repo-wide and become false); `packages/sdk/LICENSE` + `NOTICE`; changesets with `privatePackages: {version:false, tag:false}`; separate `release-pr.yml` / `publish.yml`; **never** `id-token: write` inside `ci.yml`; switch the publish leg to `--frozen-lockfile` (the 270 KB lockfile is committed and CI still installs `--no-frozen-lockfile`); the committed operation registry + `git diff --exit-code` drift gate. | L    | 20         |

**v0.1 total: ~7–9 weeks** for one engineer. Roughly half of that (tasks 4–8, 12, 14) is
safety machinery that ships no visible feature — which is precisely why §7 risk 1 names it as
the thing to defend hardest.

#### Deferred — v0.2

| #   | Task                                                                                                                | Size |
| --- | ------------------------------------------------------------------------------------------------------------------- | ---- |
| 23  | `integration_key_camps` (migration 0030) + the mint-time camp allowlist                                             | M    |
| 24  | Delegation tokens: `POST /v1/delegations`, narrowing-only, ≤10 min, audience-bound, + CORS on those routes only     | L    |
| 25  | Idempotency table + the `Idempotency-Key` contract                                                                  | M    |
| 26  | The camp read tranche + `self:*`                                                                                    | L    |
| 27  | The write tranche: registration draft/submit, roles, invites, questionnaire send (the `QuestionnaireVerdict` shape) | XL   |
| 28  | The org read tranche on `org.quagga.ryanjnoble.dev`                                                                 | L    |

#### Deferred — v1.0

| #   | Task                                                                                                                                   | Size |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 29  | The org write tranche                                                                                                                  | L    |
| 30  | The Integrations console (§4.3.9) — mint, rotate-with-grace, suspend, scope grid, activity                                             | L    |
| 31  | `GET /.well-known/afrikaburn-scopes` + the emitted OpenAPI document, committed with a drift gate                                       | M    |
| 32  | Deprecation metadata → generated `@deprecated`; the two-edition sunset policy                                                          | S    |
| 33  | Correct the stale prose at `org-permissions.ts:239-262`, `:195-211`, `org-roles.ts:239-251` — load-bearing once a third party reads it | S    |

#### Deferred indefinitely, on purpose

Extracting the 6,938-line stores into `packages/data` and standing up `apps/api`.
`manifest.routes` buys us out of it (decision 14). When it happens it is a refactor with no
SDK release, and it also stops moving stores out from under `coverage.include: lib/**`.

---

### 4.9 BLOCKING vs DEFERRABLE — the short version

**Blocking v0.1, in dependency order:** commitlint scope · `packages/scopes` + the
`roles.ts:150` inversion · CI matrix rows · `REGISTRATION_CONTACT_KEYS` promotion ·
`camp-visibility.ts` · zod response schemas + the two emitter assertions + the red build ·
`loadOrgActor` extraction · the api-key plugin + migration 0029 + the `/api-key/*` block ·
nine invariant tests · `integration-manifest.ts` + the anti-drift test · the integrator
refusal arm · `/v1/capabilities` · the handler wrapper · rate limiting · seven read endpoints ·
the `api.` alias + oracle tests · observability · docs/licence/release.

**Deferrable without weakening anything:** the Integrations console (System managers mint
keys by server action until it exists — ugly, safe) · delegation tokens and all CORS · every
write endpoint · the whole org tranche · idempotency · `/.well-known` · the emitted OpenAPI
document · Redis/WAF · `apps/api`.

**Not deferrable and frequently mistaken for deferrable:** the zod response schemas. They
produce no visible feature and will be offered up first in every deadline conversation, with
the plausible substitute "just call a `stripHardLockedFields()` helper in each handler."
That substitute is the per-caller filter §9.4 decision 2 forbids, and it cannot see the seven
`REGISTRATION_CONTACT_KEYS` at all — because `HARD_LOCKED_PRIVATE_FIELDS` is keyed on
`burner_bios` privacy-flag names and those columns live on `registrations`. Without the
schemas, the platform's PII guarantee is "we remembered."

---

### 4.10 CONTRADICTIONS AND OPEN ITEMS THE MAINTAINER MUST RULE ON

1. **`integration_keys` is a fourth table the decision does not name.** §4.3.2 item 4. It is
   forced by the same constraint that put `users` beside `user` (`schema.ts:330-356`): the
   adapter owns `apikey`'s shape, so we cannot add `integration_id` to it. If the maintainer
   would rather stuff `{"integrationId": …}` into `apikey.metadata`, say so — but that column
   is also the one the plugin lets an integrator-adjacent path write, and §4.3.10 already
   bans copying it into `audit_events.meta` unfiltered.
2. **`integration_scopes` is keyed per-key, not per-integration.** The decision's table name
   says "integration". Per-key is required for rotation-with-narrowing and for the SDK's
   construction-time diff to be against the credential the integrator actually holds.
   Rotation copies the rows.
3. **`personal_information` is absent from the console scope grid, not greyed out.** Decision
   9 says it is not issuable at v0.1/v0.2. Rendering a disabled control for it is the
   affordance that eventually gets a `true`.
4. **`loadOrgActor` extraction fixes a live fail-open.** `apps/web/lib/medical-access.ts:215`
   fabricates `org_staff` for a non-rank org membership; `apps/org/lib/session.ts:234-235`
   treats the same state as forbidden. Latent today (the console's write path always sets a
   rank first, `apps/org/lib/actions/accounts.ts:108-145`), live the moment anything mints an
   actor from raw membership rows — which is exactly what the API route does.
5. **⚠ Every remaining `@better-auth/api-key` fact needs re-verification.** `node_modules/`
   is absent from this checkout. The field defaults, endpoint paths and the
   `enableSessionForAPIKeys` bypass come from the auth survey's read of the published
   tarball. (The `userId`→`referenceId` rename is the one exception — it is recorded in this
   repo at `docs/auth-platform-spec.md` §2.4.) Task 9 is "install and re-verify" before task
   10 generates a migration that is append-only and therefore permanent.
6. **Bulletins are not a public surface, and `public:bulletins:read` is deleted.** They were
   in the v0.1 tranche in an earlier draft. `bulletins.audience` is the same jsonb
   `AudienceSpec` as a questionnaire's (`packages/db/src/schema.ts:1739-1759`), both store
   functions gate on `getCurrentCampUser()` plus a `notifications` row for that bulletin
   (`apps/web/lib/bulletins.ts:9-14, :25, :64`), and the module comment names the exact
   failure a public feed would be: leaking `org_internal` broadcasts into participant
   surfaces. They reappear at v0.2 as received-only `self:bulletins:read`. **If the org wants
   a genuinely public announcements feed, that is a new audience kind and a product decision
   — say so and it becomes a v0.2 item, not something the API layer can invent.**
7. **`/v1/burners/{username}` needs a username→id lookup that does not exist.** See §4.2.
   `getPublicBurnerProfile` takes a `users.id`. Ruling wanted: add the lookup (recommended)
   or address burners by id.
