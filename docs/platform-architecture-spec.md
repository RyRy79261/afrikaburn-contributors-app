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
