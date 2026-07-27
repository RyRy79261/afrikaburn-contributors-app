# First deployment runbook

The codebase is deliberately deploy-ready-but-unconfigured: all three apps build and
boot with zero env vars. **Migrations apply automatically on deploy** — every app's
`build` runs `db:migrate:deploy` before `next build`, so as soon as the DB env is set
the committed migrations (`packages/db/migrations/0000_*` … `0017_*`) are applied by
the build. With no DB env (a fork, a preview without env, CI) the migrator prints a
skip line and exits 0, so the build still succeeds. This is the order of operations
for the first real deployment.

**There is no manual data step any more.** The same deploy runner also **bootstraps
the reference data** — it seeds only when it finds `editions` empty *(Ryan, 27 Jul
2026: the first real deployment came up with a perfect schema, working Google sign-in
and no active edition, so every DB-backed page fell through to "Preview mode" — which
reads as a configuration problem when the configuration was correct. Seeding was a
manual step nothing told you about, and the person who needed to run it could not:
the connection string is a secret they cannot copy out of Vercel.)*

**It is a bootstrap, not a sync.** A database that already has an edition is left
alone. Camp categories and supplier records are editable in the org console, and
re-asserting canonical rows on every deploy would quietly revert an organiser's edits
or resurrect something they deleted.

On the **first** deploy the migrator applies 0000–0017 and seeds, all in a single
advisory-locked run — **watch the Vercel build log** for the `[migrate]` lines to
confirm which connection it used, that every migration applied, and whether it printed
`no edition found — seeding reference data` or `reference data present — not re-seeding`.

## 1. Neon

1. Create a Neon project (e.g. `afrikaburn-contributors`). Copy the **pooled** connection string → `DATABASE_URL`, and the **direct/unpooled** connection string → `DATABASE_URL_UNPOOLED`. The deploy migrator needs the unpooled one (its advisory lock does not hold on Neon's pooled PgBouncer endpoint); the apps use the pooled one at runtime.
2. Auth is now **self-hosted Better Auth** (`@quagga/auth`, mounted per app at `/api/auth/[...all]`) against this same Neon DB — managed Neon Auth is not used. Generate one shared `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) and set the **identical** value on all three projects (a session signed by one app must verify in another). Set `BETTER_AUTH_URL` per app to its own apex origin in production (previews derive it from `VERCEL_URL`).
3. Add Google as an OAuth provider (Google Cloud Console OAuth client) and set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`; the callback is `<BETTER_AUTH_URL>/api/auth/callback/google`. Email+password works without this. Email verification and password-reset delivery switch on automatically once `RESEND_API_KEY` is set (until then verification is not required and reset presents as honestly unavailable).

## 2. Reference data — automatic, nothing to do

Neither migrations nor the seed are run by hand here any more: the deploy build
applies the migrations and bootstraps the reference data on an empty database (see
the top of this doc). **You should not need this section for a normal deployment.**

For a **local** database, run both explicitly:

```bash
docker compose -f docker-compose.local.yml up -d
pnpm --filter @quagga/db db:migrate:deploy
pnpm --filter @quagga/db db:seed          # reference data only — see below
```

Seeding is idempotent, so it is safe to re-run. `pnpm --filter @quagga/db db:migrate`
(drizzle-kit) also still exists for a local DB; it is **never** run against production
by a person.

### What the seed does and does not contain

**Binding principle (Ryan, 26 Jul 2026): seeds contain ONLY org-owned
reference/catalog data. Every burner, camp, membership, registration and
questionnaire response — in every environment, including the kickoff demo — is
created live through the app.**

Seeded: the **edition** (AfrikaBurn 2027, 26 Apr – 2 May 2027), the **org group**
"AfrikaBurn" (no memberships — staff elevate live via `GOD_EMAILS`), the **8
canonical camp categories**, the **supplier repository** (the scrubbed AB sheet
snapshot + each supplier's per-edition onboarding step map, `user_id` deliberately
`null` so a real supplier can self-register and claim the row by email overlap),
and **one org-authored questionnaire template** (`org-safety-checkin-2027` —
definition only, no activation, no audience, no responses).

Not seeded, ever: users, burner bios, theme camps / artworks / mutant vehicles,
memberships, invites, registrations, supplier declarations, section reviews,
questionnaire activations / required actions / responses, notifications,
bulletins, audit events, supplier notes. And **no payments** — AfrikaBurn never
receives payment from theme camps; registration is free. The `payments` table
stays frozen in the schema for future logistics apps.

Consequences worth knowing: an empty directory, an empty registrations queue and
an empty status board are the **correct** first-boot state. The first rows appear
when a human signs up.

## 3. Resend

Create an API key → `RESEND_API_KEY`. Without it, all email logs to the server console
(fine for local, not for the live demo). Verify a sending domain or use Resend's test
sender for the MVP.

## 4. Vercel — three projects, one repo

| Project | Root Directory | Port locally |
|---|---|---|
| `afrikaburn-contributors-web` | `apps/web` | 3000 |
| `afrikaburn-contributors-org` | `apps/org` | 3001 |
| `afrikaburn-contributors-suppliers` | `apps/suppliers` | 3002 |

All three depend on `@quagga/db`, so any committed migration invalidates all three
builds and each one applies migrations on deploy — that is intentional. Safety comes
from the advisory lock in `db:migrate:deploy`, not from nominating one owner app.

- Build command: leave default — each app's `build` script already runs
  `db:migrate:deploy && next build`. **Do not remove the migrate step.** Watch the
  `[migrate]` lines in the build log on the first deploy.
- Install command: `pnpm install` at repo root (Vercel detects the monorepo; if needed set it explicitly).
- Env vars on **all three** projects: `DATABASE_URL`, `DATABASE_URL_UNPOOLED` (the
  direct endpoint — the migrator's advisory lock does not hold on the pooled one),
  `BETTER_AUTH_SECRET` (identical across all three), `BETTER_AUTH_URL` (per app),
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PGCRYPTO_KEY`, `RESEND_API_KEY`,
  `GOD_EMAILS`, `BLOB_READ_WRITE_TOKEN` (web only, from a Vercel Blob store).
- **Never set `AUTH_RATE_LIMIT_WINDOW_SECONDS` / `AUTH_RATE_LIMIT_MAX` on a real
  deployment.** They exist to *raise* the auth limiter's ceiling for a test
  environment where every Playwright worker hammers sign-up from one address. Setting
  them in production disables the protection that is doing its job.

**Preview deployments.** Neon preview branching is enabled, so each preview/PR gets
its own Neon branch with its own `DATABASE_URL` / `DATABASE_URL_UNPOOLED`. The deploy
migrator runs against that branch — which is correct and desired: every preview
migrates its own isolated branch, never production.
- `GOD_EMAILS=ryanjnoble@gmail.com` — first sign-in with that (verified) email self-elevates to god.
- **Optional, web only — `ACCOUNT_SWEEP_SECRET`**: bearer token for
  `/api/account/deletion-sweep`, which sanitizes accounts whose 14-day deletion
  grace period has elapsed (docs/accounts-security-spec.md §Deletion). **Leave it
  unset until you want the sweeper live** — without it the route refuses to run and
  nothing is ever erased. A **Vercel Cron** entry (`apps/web/vercel.json`) hits the
  route daily at 03:00 UTC. Vercel Cron can only GET and authenticates by injecting
  `Authorization: Bearer $CRON_SECRET`, so **also set `CRON_SECRET`** (web only) for
  the cron to run — the same value as `ACCOUNT_SWEEP_SECRET` is fine. The route
  accepts either secret and still refuses any unauthenticated caller. Crons run on
  production deployments only. `NEXT_PUBLIC_APP_URL` (also optional) is the origin
  used to build email-change confirm/revoke links.

## 5. Smoke test — the live path

There are no seeded accounts to sign in as, by design. The smoke test **creates**
the data it verifies, which is also exactly the kickoff demo script.

1. **Web**: sign up as a real burner (real inbox, verify the email) → complete the
   Burner Bio (exercise a privacy toggle; confirm phone / emergency contacts /
   ID are hard-locked private) → **register Camp 404 through the wizard**, all six
   sections → submit.
2. **Org**: sign in with the `GOD_EMAILS` account (verified email self-elevates to
   god on first sign-in) → the org console lets you in.
3. **Org → Accounts**: elevate a second account to `org_staff`, and a third to
   `engineer`. Confirm the engineer sees no email addresses in the accounts table,
   gets no destructive controls, is refused the medical-access audit panel — and
   *does* reach `/system`, which `org_staff` does not. The ranks are jobs, not a
   ladder; this is the step that proves it.
3b. **Org → /system**: confirm every env check reads as expected and that the
   database probe reports a live round trip. It never prints a secret.
4. **Org → Registrations**: Camp 404 is in the queue on `submitted`. Walk the real
   review loop — request changes on a section, watch the notification land on the
   camp side, resolve it, approve.
5. **Suppliers**: self-register a supplier against an email that overlaps a seeded
   catalog row (claim-by-email) and one that doesn't (fresh row); walk the
   onboarding steps and a document acknowledgement.

Every smoke assertion is against **live-created** rows. Nothing is verified
against a seeded row, because no user-generated seeded row exists.
