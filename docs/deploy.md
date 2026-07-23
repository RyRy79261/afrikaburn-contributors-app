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
pnpm --filter @quagga/db db:seed      # org group, edition 2027, camps, suppliers, payments
```

Seeding is idempotent — safe to re-run.

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

## 5. Smoke test

1. Web: sign up → Burner Bio → create a camp → see the directory.
2. Your account (GOD_EMAILS + verified email) → open the org app → you're in.
3. Org → Accounts: elevate a second account to org_staff.
4. Org → Registrations: Mad Hatters shows approved; Camp 404 under review — walk the review loop against a fictional camp.

## Known gap for the demo

Seeded camp leads are placeholder users (`authUserId = seed:<email>`), not real auth
accounts — you can't literally sign in as Mad Hatters' lead. Options for the 28th:
(a) live-create a camp in the demo (good theatre anyway), or (b) sign up a real
account and have god reassign it as lead of a seeded camp via a small linking action —
not built yet; say the word and it gets added.
