#!/usr/bin/env bash
# Run the persona E2E suite against a full local stack, from cold.
#
#   ./scripts/e2e-local.sh                 # whole suite
#   ./scripts/e2e-local.sh specs/new-burner   # a slice
#
# Why this exists: `turbo run lint typecheck test build` never executed a single
# Playwright spec — it only linted and typechecked the @quagga/e2e package — so
# 58 spec files across 8 personas were, in practice, documentation. Wiring `e2e` into
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

# HOW THE APPS ARE SERVED — and why CI does it differently.
#
#   dev   (default locally) — `next dev`, so a code change is picked up without
#         a rebuild. The right choice while you are iterating on a spec.
#   build (default in CI)   — `next build` once, then `next start`.
#
# THE COST OF `dev` IS NOT SMALL. Next compiles each route ON FIRST REQUEST, and
# there are 65 pages across the three apps. Every spec that visits a page nobody
# has visited yet pays a multi-second compile, several parallel workers can block
# on the SAME cold compile at once, and a compile that overruns the 20s
# navigation cap surfaces as a timeout that looks exactly like a product bug.
# That is most of why the first CI run crawled.
#
# `build` also tests what actually ships: the production bundle, with the same
# route handlers Vercel serves.
E2E_SERVE="${E2E_SERVE:-$([ "${CI:-}" = "true" ] && echo build || echo dev)}"
echo "==> apps (web:3000 org:3001 suppliers:3002) — serve mode: $E2E_SERVE"

# ALWAYS fresh. A long-lived dev server keeps a stale module graph after a file
# is deleted and then serves 500s while `turbo build` still passes, which once
# produced 104 phantom E2E failures that looked like product bugs.
pkill -f "next dev" >/dev/null 2>&1 || true
pkill -f "next start" >/dev/null 2>&1 || true
sleep 2

# …AND THEN CHECK, because those two pkills do not do what they say.
#
# Next renames its own process to `next-server (v16.2.11)` once it boots, so the
# pattern only ever matched the `sh -c next start --port 3001` wrapper — the
# process actually holding the port survived every time. An interrupted run
# therefore left a server listening, the next run's `next start` failed to bind,
# and the readiness loop below said "ok" because SOMETHING answered :3000. The
# suite then ran against the previous run's build. Measured 28 Jul 2026: five
# org-staff specs failed at sign-up in the shared factory, 15s timeouts on a
# route the live build serves in milliseconds — a foreign server, reported as a
# product bug.
#
# So: take the ports by pid, and refuse to continue if one will not come free.
for port in 3000 3001 3002; do
  for attempt in 1 2 3; do
    # `|| true`: the FREE case is grep finding nothing, which under
    # `set -euo pipefail` is a non-zero pipeline and would abort the script on
    # the happy path.
    holders=$(ss -ltnpH "sport = :$port" 2>/dev/null \
      | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true)
    [ -z "$holders" ] && break
    if [ "$attempt" = 3 ]; then
      echo "!! :$port is still held by pid(s) $holders after SIGTERM/SIGKILL."
      echo "   Refusing to run: the suite would silently test that server."
      exit 1
    fi
    # shellcheck disable=SC2086
    kill $([ "$attempt" = 2 ] && echo -9) $holders 2>/dev/null || true
    sleep 2
  done
done

if [ "$E2E_SERVE" = "build" ]; then
  # Each app's `build` also runs `db:migrate:deploy` first. That is three extra
  # migrate passes, but they are idempotent and serialised by the advisory lock,
  # and matching what Vercel actually runs is worth more than shaving them.
  echo "==> building (this replaces 65 on-demand route compiles)"
  # ONE AT A TIME (`--concurrency=1`). Three simultaneous `next build`s each
  # spawn a worker per core and hold a multi-GB heap; together they will thrash
  # or OOM a 4-core CI runner, and they took down a 32GB dev machine outright
  # while this script was being written. Serialising costs a couple of minutes
  # and removes a whole class of "CI died for no visible reason".
  pnpm exec turbo run build --concurrency=1 \
    --filter=@quagga/web --filter=@quagga/org --filter=@quagga/suppliers \
    > "$LOG_DIR/build.log" 2>&1 || {
      echo "!! build failed:"; tail -30 "$LOG_DIR/build.log"; exit 1; }
  # `start` is not a turbo task — run each app's own script directly. One log,
  # so a failure in any of the three is visible in the same place as before.
  ( pnpm --filter @quagga/web start & \
    pnpm --filter @quagga/org start & \
    pnpm --filter @quagga/suppliers start & \
    wait ) > "$LOG_DIR/dev.log" 2>&1 &
  DEV_PID=$!
else
  # `.next/dev` GOES TOO, and this is not housekeeping — it is damage control.
  #
  # Next 16's dev server writes its Turbopack state under `apps/*/.next/dev`,
  # and it GROWS without bound across runs: measured 29 Jul 2026 after a single
  # dev-mode run of this script, 5.7 GB for web and 4.6 GB for org.
  #
  # On its own that is merely wasteful. It became destructive because
  # `turbo.json` counted `.next/**` as a build output and excluded only
  # `.next/cache/**` — so every subsequent `turbo run build` ARCHIVED those ten
  # gigabytes into `.turbo/cache` under a fresh hash (any source edit changes
  # the hash), and wrote them back out again on every restore. A dozen
  # build-and-test cycles turned ~10 GB of throwaway dev state into hundreds of
  # gigabytes and filled the machine.
  #
  # Two things now stop that: `!.next/dev/**` in turbo.json's build outputs, and
  # this line. Both are needed — the exclusion stops it being copied, this stops
  # it accumulating in the first place.
  rm -rf apps/*/.next/cache apps/*/.next/dev
  pnpm dev > "$LOG_DIR/dev.log" 2>&1 &
  DEV_PID=$!
fi
trap 'kill $DEV_PID 2>/dev/null || true; pkill -f "next dev" >/dev/null 2>&1 || true; pkill -f "next start" >/dev/null 2>&1 || true' EXIT

# FAIL IF AN APP NEVER COMES UP. This loop used to fall through silently after
# 120s, and the suite then ran against a dead port: every spec failed on a
# navigation timeout, which is indistinguishable from the product being broken.
# That is exactly the confusion this script exists to prevent, so the readiness
# check now has to actually pass.
for port in 3000 3001 3002; do
  echo -n "    waiting for :$port"
  ready=0
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null "http://localhost:$port/"; then echo " ok"; ready=1; break; fi
    echo -n "."; sleep 2
  done
  if [ "$ready" -ne 1 ]; then
    echo " FAILED"
    echo "!! :$port never answered in 120s — the suite would report every spec as a"
    echo "   product failure. Last 30 lines of the server log:"
    tail -30 "$LOG_DIR/dev.log"
    exit 1
  fi
done

if grep -qi "module not found" "$LOG_DIR/dev.log"; then
  echo "!! dev server reported Module not found — fix that before trusting any result:"
  grep -i "module not found" "$LOG_DIR/dev.log" | head -5
  exit 1
fi

echo "==> playwright"
cd e2e
# TWO workers by default. The suite is parallel-safe; this is a hedge against a
# laptop also running three Next servers, Postgres and two proxies. Override with
# E2E_WORKERS if the machine can take it.
#
# It once said four workers made the long journeys "start timing out — a resource
# problem that reads exactly like a broken product", and CI quoted that as proof.
# It was never proven, and it was wrong: the timeouts were 152ms-per-statement
# through the dev SQL proxy (packages/db/src/index.ts), which is why they hit one
# page and spared the other sixty. Four has not been re-measured since.
# PROJECTS. This pinned `--project=desktop-chromium` unconditionally, so the
# `mobile-360` project defined in playwright.config.ts had never executed once —
# every mobile finding in every audit so far has been a code read, not a run.
# Default to BOTH; narrow with E2E_PROJECTS when iterating locally, e.g.
#   E2E_PROJECTS=desktop-chromium ./scripts/e2e-local.sh specs/god
PROJECT_ARGS=()
for project in ${E2E_PROJECTS:-desktop-chromium mobile-360}; do
  PROJECT_ARGS+=("--project=$project")
done

# SHARDING. Kept for hand-splitting a long local run across terminals
# (E2E_SHARD=2/4). CI does NOT use it — it splits by persona instead, one job per
# spec directory, which names what broke (.github/workflows/ci.yml).
SHARD_ARGS=()
if [ -n "${E2E_SHARD:-}" ]; then
  SHARD_ARGS+=("--shard=$E2E_SHARD")
fi

exec pnpm exec playwright test "${PROJECT_ARGS[@]}" "${SHARD_ARGS[@]}" \
  --workers="${E2E_WORKERS:-2}" "$@"
