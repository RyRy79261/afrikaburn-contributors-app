#!/usr/bin/env bash
# Run the persona E2E suite against a full local stack, from cold.
#
#   ./scripts/e2e-local.sh                 # whole suite
#   ./scripts/e2e-local.sh specs/new-burner   # a slice
#
# Why this exists: `turbo run lint typecheck test build` never executed a single
# Playwright spec — it only linted and typechecked the @quagga/e2e package — so
# 141 specs across 8 personas were, in practice, documentation. Wiring `e2e` into
# the default gate is wrong (it needs a database and three running apps), so it
# is a deliberate, separate command. Run it before anything that touches auth,
# sessions, privacy projection or the invite round trip.
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.local.yml"
LOG_DIR="${TMPDIR:-/tmp}/quagga-e2e"
mkdir -p "$LOG_DIR"

# The local stack speaks to Postgres through two Neon proxies (see
# docker-compose.local.yml). The DB host is the COMPOSE SERVICE NAME because the
# proxy resolves it; the proxy endpoints are localhost because we resolve those.
export DATABASE_URL="postgres://postgres:postgres@postgres:5432/quagga"
export DATABASE_URL_UNPOOLED="$DATABASE_URL"
export NEON_LOCAL_PROXY=1
export PGCRYPTO_KEY="${PGCRYPTO_KEY:-local-dev-pgcrypto-key-not-a-secret}"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-local-dev-better-auth-secret-not-a-secret-32b}"
export ACCOUNT_SWEEP_SECRET="${ACCOUNT_SWEEP_SECRET:-local-dev-sweep}"
export CRON_SECRET="${CRON_SECRET:-local-dev-cron}"
export GOD_EMAILS="${GOD_EMAILS:-e2e-god@quagga.local}"
export NEXT_PUBLIC_APP_URL="http://localhost:3000"
export NEXT_PUBLIC_PARTICIPANT_APP_URL="http://localhost:3000"

# No mail provider locally, so email verification is derived OFF and the specs
# that need a real inbox skip themselves rather than failing.
# Raise the auth rate-limit ceiling FOR THIS LOCAL RUN ONLY. Every Playwright
# worker drives real sign-ups from 127.0.0.1, so the limiter correctly sees one
# client hammering /sign-up/email and starts returning 429 — which then looks
# exactly like broken auth. The limiter is doing its job; the test environment
# needs the higher ceiling. NEVER set these on a real deployment.
export AUTH_RATE_LIMIT_WINDOW_SECONDS="${AUTH_RATE_LIMIT_WINDOW_SECONDS:-60}"
export AUTH_RATE_LIMIT_MAX="${AUTH_RATE_LIMIT_MAX:-10000}"

# GOD CREDENTIALS, or the god and org-staff suites SILENTLY SKIP and the script
# still exits 0 — a green run that proves nothing, on exactly the two personas
# every permission change touches. Measured: without these,
# `E2E_RESET_DB=1 ./scripts/e2e-local.sh specs/god specs/org-staff` reports
# "37 skipped, 2 passed" and succeeds. A gate that cannot fail is not a gate.
#
# GOD_EMAILS above must contain this address: the bootstrap only elevates an
# account whose email is on that list AND is verified.
export E2E_GOD_EMAIL="${E2E_GOD_EMAIL:-e2e-god@quagga.local}"
export E2E_GOD_PASSWORD="${E2E_GOD_PASSWORD:-correct-horse-battery-staple-e2e}"

export E2E_MAIL_MODE="${E2E_MAIL_MODE:-off}"
export E2E_REQUIRE_EMAIL_VERIFICATION="${E2E_REQUIRE_EMAIL_VERIFICATION:-false}"

echo "==> database stack"
$COMPOSE up -d
until docker exec quagga-pg pg_isready -U postgres -d quagga >/dev/null 2>&1; do sleep 1; done

if [ "${E2E_RESET_DB:-0}" = "1" ]; then
  # Drops BOTH schemas. `drizzle` holds the migration-tracking table, so
  # dropping only `public` leaves the tracker behind and the migrator then
  # reports "up to date" against an empty database — a silent no-op that looks
  # like success and fails much later.
  echo "==> resetting database (public + drizzle)"
  docker exec quagga-pg psql -U postgres -d quagga \
    -c "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"
fi

echo "==> migrations + seed"
pnpm --filter @quagga/db db:migrate:deploy
pnpm --filter @quagga/db db:seed

# THE GOD ACCOUNT. `elevateToGod` signs in with E2E_GOD_EMAIL and expects the
# account to exist; nothing ever created it, so the 28 spec files behind
# `skipUnlessGod()` only ran on a database where somebody had made it by hand.
# On a fresh database — every CI run — they failed on sign-in instead, which is
# most of the cross-app surface.
echo "==> god account"
# Run from @quagga/auth: it is the only package that resolves BOTH
# @quagga/auth and @quagga/db, which the bootstrap needs.
pnpm --filter @quagga/auth exec tsx scripts/e2e-god-bootstrap.mts

echo "==> apps (web:3000 org:3001 suppliers:3002)"
# ALWAYS a fresh dev server. A long-lived one keeps a stale module graph after a
# file is deleted and then serves 500s while `turbo build` still passes, which
# once produced 104 phantom E2E failures that looked like product bugs.
pkill -f "next dev" >/dev/null 2>&1 || true
sleep 2
rm -rf apps/*/.next/cache
pnpm dev > "$LOG_DIR/dev.log" 2>&1 &
DEV_PID=$!
trap 'kill $DEV_PID 2>/dev/null || true; pkill -f "next dev" >/dev/null 2>&1 || true' EXIT

for port in 3000 3001 3002; do
  echo -n "    waiting for :$port"
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null "http://localhost:$port/"; then echo " ok"; break; fi
    echo -n "."; sleep 2
  done
done

if grep -qi "module not found" "$LOG_DIR/dev.log"; then
  echo "!! dev server reported Module not found — fix that before trusting any result:"
  grep -i "module not found" "$LOG_DIR/dev.log" | head -5
  exit 1
fi

echo "==> playwright"
cd e2e
# TWO workers by default. The suite is parallel-safe, but these journeys drive a
# real browser through a real database on one laptop, and the longest ones (full
# six-section registration, the two-user invite round trips) start timing out at
# four — a resource problem that reads exactly like a broken product. Override
# with E2E_WORKERS if the machine can take it.
# PROJECTS. This pinned `--project=desktop-chromium` unconditionally, so the
# `mobile-360` project defined in playwright.config.ts had never executed once —
# every mobile finding in every audit so far has been a code read, not a run.
# Default to BOTH; narrow with E2E_PROJECTS when iterating locally, e.g.
#   E2E_PROJECTS=desktop-chromium ./scripts/e2e-local.sh specs/god
PROJECT_ARGS=()
for project in ${E2E_PROJECTS:-desktop-chromium mobile-360}; do
  PROJECT_ARGS+=("--project=$project")
done

exec pnpm exec playwright test "${PROJECT_ARGS[@]}" \
  --workers="${E2E_WORKERS:-2}" "$@"
