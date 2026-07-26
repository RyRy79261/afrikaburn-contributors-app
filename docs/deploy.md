# First deployment runbook

The codebase is deliberately deploy-ready-but-unconfigured: both apps build and boot
with zero env vars, no build step runs migrations, and the initial migration
(`packages/db/migrations/0000_*.sql`) is committed but unapplied. This is the order of
operations for the first real deployment.

## 1. Neon

1. Create a Neon project (e.g. `afrikaburn-contributors`). Copy the pooled connection string → `DATABASE_URL`.
2. Enable **Neon Auth** on the project (Console → Auth). Copy `NEON_AUTH_BASE_URL`; generate `NEON_AUTH_COOKIE_SECRET` (`openssl rand -base64 32`).
3. Add Google as an OAuth provider in Neon Auth config (Google Cloud Console OAuth client; redirect URIs per Neon's instructions). Email+password works without this.

## 2. Apply the schema + seed (one-time, from your machine)

```bash
cp .env.example .env       # fill DATABASE_URL (+ PGCRYPTO_KEY: openssl rand -hex 32)
pnpm --filter @quagga/db db:migrate   # applies committed migrations
pnpm --filter @quagga/db db:seed      # reference data only — see below
```

Seeding is idempotent — safe to re-run.

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

## 4. Vercel — two projects, one repo

| Project | Root Directory | Port locally |
|---|---|---|
| `afrikaburn-contributors-web` | `apps/web` | 3000 |
| `afrikaburn-contributors-org` | `apps/org` | 3001 |

- Build command: leave default (`next build`). **Do not add a migrate step.**
- Install command: `pnpm install` at repo root (Vercel detects the monorepo; if needed set it explicitly).
- Env vars on **both** projects: `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `PGCRYPTO_KEY`, `RESEND_API_KEY`, `GOD_EMAILS`, `BLOB_READ_WRITE_TOKEN` (web only, from a Vercel Blob store).
- `GOD_EMAILS=ryanjnoble@gmail.com` — first sign-in with that (verified) email self-elevates to god.
- **Optional, web only — `ACCOUNT_SWEEP_SECRET`**: bearer token for
  `POST /api/account/deletion-sweep`, which sanitizes accounts whose 14-day deletion
  grace period has elapsed (docs/accounts-security-spec.md §Deletion). **Leave it
  unset until you want the sweeper live** — without it the route refuses to run and
  nothing is ever erased. Point a scheduler at the route once it is set; never a
  build step. `NEXT_PUBLIC_APP_URL` (also optional) is the origin used to build
  email-change confirm/revoke links.

## 5. Smoke test — the live path

There are no seeded accounts to sign in as, by design. The smoke test **creates**
the data it verifies, which is also exactly the kickoff demo script.

1. **Web**: sign up as a real burner (real inbox, verify the email) → complete the
   Burner Bio (exercise a privacy toggle; confirm phone / emergency contacts /
   ID are hard-locked private) → **register Camp 404 through the wizard**, all six
   sections → submit.
2. **Org**: sign in with the `GOD_EMAILS` account (verified email self-elevates to
   god on first sign-in) → the org console lets you in.
3. **Org → Accounts**: elevate a second account to `org_staff`.
4. **Org → Registrations**: Camp 404 is in the queue on `submitted`. Walk the real
   review loop — request changes on a section, watch the notification land on the
   camp side, resolve it, approve.
5. **Suppliers**: self-register a supplier against an email that overlaps a seeded
   catalog row (claim-by-email) and one that doesn't (fresh row); walk the
   onboarding steps and a document acknowledgement.

Every smoke assertion is against **live-created** rows. Nothing is verified
against a seeded row, because no user-generated seeded row exists.
