# Platform & Database Architecture — shared DB + accounts for all apps

*Ryan, 25 Jul 2026. Goal: the database is "its own thing" — one shared database +
one account pool for apps/web, apps/org, apps/suppliers and (later) Camp 404, with
migrations running in exactly one place. Research grounded in Neon + Better Auth
docs (citations inline); no deployed DB yet, so restructuring is at its cheapest.*

## The surprise finding: we're already ~90% there

1. **Neon Auth is already an external service.** It's "Managed Better Auth" — a
   Neon-hosted REST auth service (currently running better-auth **1.4.18**, exactly
   our pin). Our apps talk to it via `@neondatabase/auth` and proxy `/api/auth/*`
   same-origin. Neon **owns and migrates the auth tables** (a `neon_auth` schema in
   our database) — we never write auth migrations. The auth half of the DB is
   already "its own thing". (neon.com/docs/auth/overview, /authentication-flow)
2. **App migrations are already centralized.** `packages/db` is the sole owner of
   schema + append-only migrations; apps import the client/types and never migrate.
3. **One auth instance can back many apps.** All three apps already read a shared
   `NEON_AUTH_BASE_URL`; pointing every app (including Camp 404) at the same base
   URL yields ONE shared account pool. Caveat: Neon doesn't explicitly document the
   multi-app pattern — validate before production.

## What "shared login" actually requires (the real constraint)

- Cookie sessions only cross **subdomains of one apex**. `*.vercel.app` is on the
  Public Suffix List — browsers refuse a shared cookie there. **Live SSO therefore
  requires a custom apex** (e.g. `app.`, `org.`, `suppliers.` + later Camp 404 on
  the same apex) plus Better Auth's `crossSubDomainCookies` + `trustedOrigins`.
- Without the shared apex: same account pool (same email/password everywhere) but
  each app logs in separately. Different-domain SSO needs the OIDC route (Option B).

## Options (ranked)

**A. RECOMMENDED — single Neon project + shared Neon Auth + published schema package.**
Keep everything as wired; consolidate to ONE Neon project + ONE auth instance via
the shared base URL. Extract a thin versioned `@quagga/db-schema` (schema + inferred
types, no drizzle-kit) published to a registry so the separate Camp 404 repo gets
direct Neon access with pinned types. Deploy portals under one custom apex for
cookie SSO. Migrations: unchanged (`packages/db` owns app schema; Neon owns auth).
Keeps Neon's branchable identity (real auth on preview branches) and managed tiers.
Risks: multi-app single-instance is undocumented (validate); schema package couples
Camp 404 to the Postgres shape (pin discipline); SDK is beta.

**B. Later evolution — self-hosted Better Auth as our own OIDC provider.**
A dedicated auth service (better-auth 1.4.18 + oauthProvider plugin); every app —
any domain, any repo — becomes an OIDC client; auth tables move into `packages/db`
so ALL migrations unify under one owner. True federated SSO across arbitrary
domains. Costs: lose all Neon managed auth features (branch identity, preview auth,
MAU tiers), own uptime/keys/security. Our 1.4.18 pin equals Neon's version, so this
migration stays low-friction whenever cross-domain SSO becomes a hard requirement.

**C. Deferred — full platform API service (tRPC/REST/MCP) owning all data access.**
Cleanest decoupling for external consumers, but heaviest build, adds latency, and
conflicts with the offline/attestation model (needs direct/local data). Revisit when
untrusted external consumers need server-enforced access control. (The "platform as
backend for camp apps" idea stays parked as the API/MCP candidate from the roadmap.)

## Decision needed from Ryan

1. Confirm **Option A** now, Option B as the documented evolution path.
2. Pick the **apex domain** (SSO hinges on it — vercel.app cannot do it).

## Concrete pre-deploy checklist (once confirmed)

- [ ] One Neon project; enable Neon Auth once; all apps share `NEON_AUTH_BASE_URL`
- [ ] Validate multi-app auth against one instance (three local apps, one pool)
- [ ] Extract + publish `@quagga/db-schema` (schema + types only, pinned versions)
- [ ] Apex domain + Vercel domains per app; `crossSubDomainCookies` + `trustedOrigins`
- [ ] docs/deploy.md updated to the single-project shape
- [ ] Camp 404 integration note: same auth base URL + pinned schema package

## Markdown editor decision (bulletin compose)

**Pick: `minimal-tiptap`** (shadcn-registry component on Tiptap) + `tiptap-markdown`
for Markdown in/out — restyles directly to Tankwa Night tokens, React 19-compatible,
matches the vendored-shadcn pattern in `packages/ui`. Fallback if we prefer a pure
npm package: `@uiw/react-md-editor` (needs a scoped fix for Tailwind v4 Preflight
collisions). MDXEditor (heavy) and novel (Notion-style, opinionated) rejected.
Render side: react-markdown + typography plugin, sanitized.

---

# Part 2 — "Sign in with AfrikaBurn": third-party identity platform (Ryan, 25 Jul)

Requirement: ANY website (not just Camp 404) can use Burn accounts + roles, with
org-issued integrator credentials. That makes us an OAuth2/OIDC **identity
provider**. Integrator key = OAuth client_id + secret; users authenticate with US
(redirect + consent); third parties never see credentials and never touch Neon.

## Research verdicts (citations in task notes / agent report)

1. **Managed Neon Auth cannot be the IdP — confirmed.** It's first-party-only and
   Neon states it "doesn't yet support bringing your own Better Auth plugins or
   custom server-side handlers"; the entire provider capability is a server-side
   plugin. No roadmap signal for provider features. (Also confirmed: the old
   Stack-Auth-era multi-app features did NOT survive the Better Auth rebuild.)
2. **Hybrid (self-hosted head sharing the managed `neon_auth` pool): spike-only.**
   Schema-compatible (Neon stores stock Better Auth 1.4.18 table shapes; the Drizzle
   adapter can target the `neon_auth` schema), but session/cookie interop rests on
   undocumented internals and Neon migrates that schema at will. Fragile; not a
   foundation.
3. **The pinned better-auth 1.4.18 only has the pre-production `oidcProvider`
   plugin; the production-grade OAuth 2.1 Provider ships in 1.5+** (Feb 2026:
   client-secret rotation, discovery, custom claims). The IdP is a SEPARATE
   deployment, so it can run 1.5+ without touching the portals' 1.4.18 pin.
4. **Alternatives that keep users in Neon all lose**: Keycloak/Zitadel force their
   own user stores (sync hell); Ory Hydra is the closest headless option but means
   hand-building login/consent (keep as fallback); SaaS moves users off Neon (out).

## The plan (phased — first-party is NOT blocked)

- **Phase 1 (now, kickoff)**: unchanged Option A — managed Neon Auth for all
  first-party portals, one pool, apex-domain cookie SSO. Camp 404 first-party too.
- **Phase 2 (the IdP)**: a dedicated, separately-deployed **auth service on our
  Neon Postgres** running better-auth 1.5+ `oauthProvider`: /oauth2 authorize,
  token, userinfo, consent, JWKS + .well-known discovery. Client registration =
  the org-issued integrator keys. Whether it shares the managed pool live (the
  hybrid spike) or first-party auth migrates onto it (full Option B) is decided by
  the spike + Neon's answers below.
- **Roles/profile exposure (two layers)**: minimal namespaced claims in tokens
  (coarse roles for UX gating) + an authoritative scoped **`/api/me`** endpoint for
  fresh role/profile data. Scopes: `profile:basic`, `profile:camps`,
  `profile:volunteering`, `email` — least-privilege. **Hard-locked fields (phone,
  emergency contacts, ID/passport, medical) are unconditionally stripped at the
  response boundary — no scope can ever grant them.** Free-camp undiscoverability
  applies to integrator endpoints exactly as in the directory.
- **Org console "Integrations" page (future design frames)**: client registration
  (secret shown once, stored hashed), confidential vs public+PKCE, exact-match
  redirect URIs, scope selection, consent preview, secret rotation with grace
  window, instant revocation, per-client audit into `audit_events`, god/org_staff
  only. Later: user-facing "connected apps" management with revoke.

## Questions to put to Neon support before committing

(i) any "Neon Auth as OIDC provider / custom clients" roadmap; (ii) is a second
better-auth process reading `neon_auth` supported, with schema/cookie stability
commitments or change notice; (iii) the session-token/cookie contract; (iv) will
managed Better Auth track 1.4.18 or move; (v) any bring-your-own-plugin plans
(which would collapse Phase 2 into managed).

## STATUS: Part 2 PARKED (Ryan, 25 Jul 2026)

The "Sign in with AfrikaBurn" IdP / profile-sharing platform is deferred until after
the 28 Jul kickoff — no point building it before adoption is real. Nothing in Part 1
depends on it; Phase 1 (Option A) remains the active path. When it revives, this
document is the starting point (research is done and cited).
