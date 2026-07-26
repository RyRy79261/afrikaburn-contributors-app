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
exec pnpm exec playwright test --project=desktop-chromium "$@"
