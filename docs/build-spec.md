# Build Spec — MVP R0 (frozen for the build agents)

Engineering addendum to [`mvp-proposal.md`](mvp-proposal.md). Where they conflict, this
file wins. Reference implementation: the Camp 404 clone at
`/tmp/claude-1000/-home-ryan-repos-Personal-afrikaburn-contributors-app/69acba7e-19a2-4025-b746-e3bedea626b5/scratchpad/camp-404`
— mirror its conventions (workspace layout, drizzle patterns, auth wiring, Zod-at-boundaries).

## Hard constraints

1. **No migration step in the build.** `vercel-build` (if defined) is plain `next build`. There is no deployed DB yet — nothing to migrate from. Provide `db:generate` (offline, drizzle-kit generate) and `db:migrate` scripts; migrations are committed but only ever applied manually once `DATABASE_URL` exists.
2. Package namespace **`@quagga/`**. Node ≥ 22, pnpm 10, Turborepo.
3. Stack: Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui, Drizzle + Neon (HTTP driver in handlers, pooled for scripts), Neon Auth (Better Auth) exactly as Camp 404 wires it, Resend for email, Vercel Blob for uploads.
4. Apps must **boot without env/DB** to a landing page (graceful "not configured" state); DB-backed routes may error clearly but must not crash the build.
5. Schema below is **frozen** — feature agents do not add/alter tables. `packages/db/src/schema.ts` is the single source of truth; migrations are generated, append-only, never hand-edited.
6. TypeScript strict; Zod validation at every boundary; no `any` in committed code. Vitest for core logic. CI gate: `pnpm turbo run lint typecheck test build`.
7. UI: minimal, dusty, non-corporate. Tokens: sand `#E7DAC2`, bone `#F4EEE2`, rust `#C2431F` (accent), ochre `#D98324`, charcoal `#211D19`, night `#141210`. Dark-mode-first, light supported. System font stack or one clean grotesk. No lorem ipsum anywhere — realistic copy.

## Monorepo layout

```
apps/
  web/    participant app (port 3000)
  org/    org/admin app (port 3001) — separate deployment, own auth gate
packages/
  ui/     shared shadcn components + tailwind tokens (@quagga/ui)
  db/     drizzle schema + migrations (@quagga/db)
  core/   shared domain logic: entitlements, name-dedupe, statuses (@quagga/core)
  types/  zod schemas + shared types (@quagga/types)
  eslint-config/  typescript-config/
```

## Environment variables (`.env.example` at root; all optional for boot)

`DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `RESEND_API_KEY`,
`GOD_EMAILS` (comma list — grants god on first login), `BLOB_READ_WRITE_TOKEN`,
`PGCRYPTO_KEY`. Update turbo.json `globalEnv` in the same change (Camp 404 rule).

## Schema (frozen)

- `users` — auth join (`auth_user_id`), email, created_at. Minimal; no role columns.
- `burner_bios` — user × edition. Field set mirrored from Camp 404's burner profile (read its schema.ts) + `privacy_flags` jsonb (per-field public/private). **Hard-locked always-private fields** (`id_number`, `passport_number`, phone, emergency contact, medical): enforced in `@quagga/core` — flags for these cannot be set public, ever. pgcrypto-encrypt id/passport columns.
- `profile_keys` — user_id, public_key, encrypted_private_key, created_at. Generated server-side at onboarding; used for nothing yet except future QR attestations.
- `groups` — kind enum (`org|theme_camp|artwork|mutant_vehicle`), name, `name_normalized` (unique per kind, case/space/punct-insensitive), description (60-word limit for camps), joinability enum (`open|invite_only`), `visibility` reserved column (default `default`), created_by. Exactly one seeded `org` row ("AfrikaBurn").
- `memberships` — user × group, role enum (`god|org_staff|lead|admin|member`), unique(user, group). god only valid on the org group.
- `invites` — group_id, token, kind (`member|lead_transfer`), created_by, expires_at, used_by, used_at. One-time.
- `editions` — name, year, start_date, end_date, is_active. Seed: **AfrikaBurn 2027, 2027-04-26 → 2027-05-02, active**.
- `registrations` — group × edition, status enum (`draft|submitted|under_review|changes_requested|approved|rejected|withdrawn`), plus typed columns for the six sections per Finlay's field list in `docs/sources/scope-theme-camp-registration.txt` (identity/contact, LNT incl. lead contact, participation & gifting, size & logistics incl. layout upload URLs (max 4), sound & placement prefs, suppliers & commerce), `submitted_at`, `decided_at`. **A camp is "registered" for an edition iff an approved registration row exists** — that predicate lives in `@quagga/core` (`isRegistered`), and entitlements derive from it.
- `section_reviews` — registration_id, section key enum (six values), status (`open|resolved`), comment, reviewer_id.
- `questionnaire_definitions`, `questionnaire_responses`, `questionnaire_activations`, `required_actions` — ported 1:1 from Camp 404's pattern (keys map to code-side registry; Burner Bio dispatches through this).
- `suppliers` — name, services text, contact, website, vetting_status enum (`listed|registered|flagged`), source (`ab_sheet|manual`), imported_at.
- `supplier_declarations` — registration_id × supplier_id, note.
- `payments` — subject_type + subject_id (polymorphic by string key), amount_cents nullable, currency default ZAR, reference (human-readable, e.g. `QP-2027-MAH-001`), status enum (`pending|reconciled|waived`), details jsonb, recorded_by. **No processing, ever.**
- `audit_events` — actor_id, action, subject, meta jsonb. Written on: elevation, approval/rejection, payment reconciliation.

## apps/web routes

`/` landing (works env-less) · `/auth/*` (Neon Auth UI) · `/onboarding` Burner Bio
(questionnaire runner; gates the rest via `required_actions`) · `/directory` (registered
camps public; joinability badge; search) · `/camps/new` (create → instant free camp;
name dedupe: reject exact-normalized match, warn on trigram similarity ≥ 0.55) ·
`/camps/[slug]` dashboard (members, invite management for leads, registration status
tile, **disabled hint tiles**: Containers "separate app — for large camps" · Water/Ice/Gas
"pending AfrikaBurn input" · Placement & Art grants "entitlement — process TBC" · Shifts/
Budget/Layout "topics under exploration") · `/camps/[slug]/registration` (six-section
wizard: any order, autosave drafts, 60-word counter, Blob layout uploads, supplier
picker from repository, submit enabled only when all six sections complete; post-submit:
status + per-section feedback + resubmit) · `/profile` (bio edit, privacy toggles,
key fingerprint display).

## apps/org routes

Auth gate: only god or org_staff memberships may enter; everyone else sees a polite
wall. `/` overview · `/accounts` (search users; god elevates/demotes org_staff; audit
logged) · `/registrations` (table: status/sound/new-vs-returning filters) ·
`/registrations/[id]` (full submission read; per-section comment + open/resolve;
actions: approve / request changes / reject — approve flips the entitlement predicate) ·
`/suppliers` (imported list, vetting status editing, manual add) · `/payments`
(references list, mark reconciled/waived).

## Seeds (`packages/db/src/seed.ts`, runnable script, idempotent)

Org group "AfrikaBurn" · edition AfrikaBurn 2027 · camps: **Mad Hatters** (approved
registration, realistic content), **Camp 404** (submitted/under review), 6 fictional
camps in varied states (draft, changes_requested, free camps with no registration) ·
suppliers imported from the AB public sheet (CSV export of Google Sheet
`1XU2gAt5E9GczVHZWpcD0_CsEeE--iX9aWmnWd19bgMI`; committed as JSON snapshot so seeding
works offline) · a few payment references in mixed states. No real people: seed users
are obviously fictional (e.g. `dusty.prototype@example.com`).

## Core logic that MUST have vitest coverage (`packages/core`)

`isRegistered` entitlement predicate · registration submit-gate (all six complete) ·
60-word counter · name normalization + similarity (trigram) · privacy hard-lock
enforcement · registration + review state machines (legal transitions only) · payment
reference generator · supplier CSV→JSON import parser.

## Explicitly NOT in this build

Containers (hint tile only) · attestation QR flows (only `profile_keys` generation) ·
payment processing/checkout · water/ice/gas · placement maps · PWA/offline · Inngest ·
Storybook/pencil · carry-forward between editions (single seeded edition).
