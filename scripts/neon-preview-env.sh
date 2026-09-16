#!/usr/bin/env bash
# Create (or reuse) a Neon branch for a git head ref and point all three
# Vercel apps' git-branch-scoped Preview env at it.
#
# Why manual (not the Vercel↔Neon integration): this monorepo deploys three
# Vercel projects against one shared Postgres. The integration is effectively
# one Neon project → one Vercel project, so only a single app ever received
# preview DATABASE_* injection. We create one Neon branch per git branch and
# attach the same pooled + unpooled URLs to web, org and suppliers.
#
# Required env:
#   NEON_API_KEY
#   NEON_PROJECT_ID
#   VERCEL_TOKEN
#   VERCEL_ORG_ID                          (team_…)
#   VERCEL_PROJECT_IDS                     (comma-separated prj_… list)
#   HEAD_REF                               (git head branch name)
#
# Optional:
#   NEON_DATABASE                          default: first non-system db
#   NEON_ROLE                              default: first login role on branch
#   DRY_RUN=1                              print actions only
#   SKIP_REDEPLOY=1                        do not trigger Vercel redeploys
#
# Safe to re-run: branch create is idempotent; env rows for this git branch
# are replaced; redeploy is best-effort.
set -euo pipefail

# NOT CONFIGURED IS NOT AN ERROR. This wiring is opt-in: until the five
# secrets exist the script exits 0 with a notice, so landing it does not turn
# every pull request red. Missing HEAD_REF *is* an error — that means the
# caller is broken, not unconfigured.
missing=""
for n in NEON_API_KEY NEON_PROJECT_ID VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_IDS; do
  if [ -z "${!n:-}" ]; then
    missing="${missing} ${n}"
  fi
done
if [ -n "$missing" ]; then
  echo "::notice::Neon preview wiring is not configured (missing:${missing}) — skipping."
  echo "Set these repository secrets to enable it; see docs/deploy.md."
  exit 0
fi

if [ -z "${HEAD_REF:-}" ]; then
  echo "::error::HEAD_REF is empty — the caller did not pass a git branch name" >&2
  exit 1
fi

DRY_RUN="${DRY_RUN:-0}"
SKIP_REDEPLOY="${SKIP_REDEPLOY:-0}"
BRANCH_NAME="preview/${HEAD_REF}"

neon_api="https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}"
vercel_api="https://api.vercel.com"
auth_neon=( -H "Authorization: Bearer ${NEON_API_KEY}" -H "Accept: application/json" -H "Content-Type: application/json" )
auth_vercel=( -H "Authorization: Bearer ${VERCEL_TOKEN}" -H "Accept: application/json" -H "Content-Type: application/json" )
curl_opts=( --connect-timeout 10 --max-time 60 --retry 3 --retry-delay 3 )

echo "Neon branch target: ${BRANCH_NAME}"
echo "Vercel org: ${VERCEL_ORG_ID}"
echo "Vercel projects: ${VERCEL_PROJECT_IDS}"

neon_get() {
  local path="$1"
  curl -sS "${curl_opts[@]}" "${auth_neon[@]}" "${neon_api}${path}"
}

neon_post() {
  local path="$1"
  local body="$2"
  curl -sS "${curl_opts[@]}" "${auth_neon[@]}" -d "$body" "${neon_api}${path}"
}

vercel_get() {
  local path="$1"
  curl -sS "${curl_opts[@]}" "${auth_vercel[@]}" "${vercel_api}${path}?teamId=${VERCEL_ORG_ID}"
}

vercel_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS "${curl_opts[@]}" "${auth_vercel[@]}" -X "$method" -d "$body" \
      "${vercel_api}${path}?teamId=${VERCEL_ORG_ID}"
  else
    curl -sS "${curl_opts[@]}" "${auth_vercel[@]}" -X "$method" \
      "${vercel_api}${path}?teamId=${VERCEL_ORG_ID}"
  fi
}

# --- Neon: find or create branch ------------------------------------------------

branches_json="$(neon_get "/branches?limit=10000")"
if ! printf '%s' "$branches_json" | jq -e '.branches' >/dev/null 2>&1; then
  echo "::error::failed to list Neon branches" >&2
  printf '%s\n' "$branches_json" >&2
  exit 1
fi

primary_id="$(printf '%s' "$branches_json" | jq -r '.branches[] | select(.primary == true) | .id' | head -n1)"
if [ -z "$primary_id" ] || [ "$primary_id" = "null" ]; then
  echo "::error::no primary Neon branch found" >&2
  exit 1
fi
echo "Neon primary branch id: ${primary_id}"

branch_id="$(printf '%s' "$branches_json" | jq -r --arg n "$BRANCH_NAME" \
  '.branches[] | select(.name == $n) | .id' | head -n1)"

if [ -z "$branch_id" ] || [ "$branch_id" = "null" ]; then
  echo "Creating Neon branch ${BRANCH_NAME} from primary…"
  if [ "$DRY_RUN" = "1" ]; then
    echo "DRY_RUN: would POST /branches name=${BRANCH_NAME} parent=${primary_id}"
    branch_id="dry-run-branch"
  else
    create_body="$(jq -n --arg name "$BRANCH_NAME" --arg parent "$primary_id" \
      '{branch:{name:$name,parent_id:$parent}}')"
    create_resp="$(neon_post "/branches" "$create_body")"
    branch_id="$(printf '%s' "$create_resp" | jq -r '.branch.id // empty')"
    if [ -z "$branch_id" ]; then
      # Race: another runner created it — re-list.
      branches_json="$(neon_get "/branches?limit=10000")"
      branch_id="$(printf '%s' "$branches_json" | jq -r --arg n "$BRANCH_NAME" \
        '.branches[] | select(.name == $n) | .id' | head -n1)"
    fi
    if [ -z "$branch_id" ] || [ "$branch_id" = "null" ]; then
      echo "::error::failed to create or find Neon branch ${BRANCH_NAME}" >&2
      printf '%s\n' "${create_resp:-}" >&2
      exit 1
    fi
    # Wait briefly for compute/endpoints to come up.
    sleep 3
  fi
else
  echo "Reusing existing Neon branch id: ${branch_id}"
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "DRY_RUN: skipping connection URI fetch and Vercel updates"
  exit 0
fi

# --- Neon: connection URIs ------------------------------------------------------

# Resolve database + role if not provided.
if [ -z "${NEON_DATABASE:-}" ]; then
  dbs_json="$(neon_get "/branches/${branch_id}/databases")"
  NEON_DATABASE="$(printf '%s' "$dbs_json" | jq -r \
    '[.databases[]? | select(.name != "postgres")][0].name // .databases[0].name // empty')"
fi
if [ -z "${NEON_ROLE:-}" ]; then
  roles_json="$(neon_get "/branches/${branch_id}/roles")"
  NEON_ROLE="$(printf '%s' "$roles_json" | jq -r \
    '[.roles[]? | select(.protected != true)][0].name // .roles[0].name // empty')"
fi
if [ -z "$NEON_DATABASE" ] || [ -z "$NEON_ROLE" ]; then
  echo "::error::could not resolve NEON_DATABASE/NEON_ROLE (got db='${NEON_DATABASE:-}' role='${NEON_ROLE:-}')" >&2
  exit 1
fi
echo "Using database=${NEON_DATABASE} role=${NEON_ROLE}"

uri_for() {
  local pooled="$1" # true|false
  local resp
  resp="$(curl -sS "${curl_opts[@]}" "${auth_neon[@]}" \
    "${neon_api}/connection_uri?branch_id=${branch_id}&database_name=${NEON_DATABASE}&role_name=${NEON_ROLE}&pooled=${pooled}")"
  local uri
  uri="$(printf '%s' "$resp" | jq -r '.uri // empty')"
  if [ -z "$uri" ]; then
    echo "::error::failed to fetch connection_uri pooled=${pooled}" >&2
    printf '%s\n' "$resp" >&2
    exit 1
  fi
  printf '%s' "$uri"
}

DATABASE_URL="$(uri_for true)"
DATABASE_URL_UNPOOLED="$(uri_for false)"

# Host-only log (never log full URI — contains password).
host_of() {
  printf '%s' "$1" | sed -nE 's#^postgres(ql)?://[^@]+@([^/?]+).*#\2#p' | grep . || printf '(unknown-host)'
}
echo "DATABASE_URL host: $(host_of "$DATABASE_URL")"
echo "DATABASE_URL_UNPOOLED host: $(host_of "$DATABASE_URL_UNPOOLED")"

# --- Vercel: upsert git-branch-scoped Preview env ------------------------------

upsert_env() {
  local project_id="$1"
  local key="$2"
  local value="$3"

  local list
  list="$(vercel_get "/v9/projects/${project_id}/env")"
  # Match existing row for this key + preview + this git branch.
  local existing_ids
  existing_ids="$(printf '%s' "$list" | jq -r --arg key "$key" --arg branch "$HEAD_REF" '
    .envs[]?
    | select(.key == $key)
    | select((.target // []) | index("preview"))
    | select((.gitBranch // "") == $branch)
    | .id
  ')"

  if [ -n "$existing_ids" ]; then
    while IFS= read -r eid; do
      [ -z "$eid" ] && continue
      echo "  deleting existing ${key} id=${eid}"
      vercel_json DELETE "/v9/projects/${project_id}/env/${eid}" >/dev/null
    done <<< "$existing_ids"
  fi

  local body
  body="$(jq -n --arg key "$key" --arg value "$value" --arg branch "$HEAD_REF" \
    '{key:$key, value:$value, type:"encrypted", target:["preview"], gitBranch:$branch}')"
  echo "  creating ${key} for preview gitBranch=${HEAD_REF}"
  local created
  created="$(vercel_json POST "/v10/projects/${project_id}/env" "$body")"
  if ! printf '%s' "$created" | jq -e '.created // .id // .key' >/dev/null 2>&1; then
    # Some API shapes return the env object at top level; accept either.
    if ! printf '%s' "$created" | jq -e 'if type=="object" then (.key? // .created?) else empty end' >/dev/null 2>&1; then
      echo "::error::failed to create ${key} on ${project_id}" >&2
      printf '%s\n' "$created" >&2
      exit 1
    fi
  fi
}

IFS=',' read -r -a project_ids <<< "$VERCEL_PROJECT_IDS"
for project_id in "${project_ids[@]}"; do
  project_id="$(echo "$project_id" | tr -d '[:space:]')"
  [ -z "$project_id" ] && continue
  echo "Updating Vercel project ${project_id}…"
  upsert_env "$project_id" "DATABASE_URL" "$DATABASE_URL"
  upsert_env "$project_id" "DATABASE_URL_UNPOOLED" "$DATABASE_URL_UNPOOLED"
done

# --- Vercel: redeploy latest preview deployment for this git branch ------------

if [ "$SKIP_REDEPLOY" = "1" ]; then
  echo "SKIP_REDEPLOY=1 — not triggering redeploys"
  exit 0
fi

redeploy_project() {
  local project_id="$1"
  local deps=""
  local dep_url=""
  local dep_id=""
  local resp=""
  local new_id=""

  deps="$(curl -sS "${curl_opts[@]}" "${auth_vercel[@]}" \
    "${vercel_api}/v6/deployments?projectId=${project_id}&limit=30&teamId=${VERCEL_ORG_ID}" || true)"

  if ! printf '%s' "$deps" | jq -e '.deployments' >/dev/null 2>&1; then
    echo "  warning: could not list deployments for ${project_id}; skip redeploy"
    printf '%s\n' "$deps" | head -c 300
    echo
    return 0
  fi

  # meta keys vary by git provider / Vercel version.
  dep_url="$(printf '%s' "$deps" | jq -r --arg ref "$HEAD_REF" '
    [.deployments[]?
      | select(
          (.meta.gitBranch // .meta.githubCommitRef // .meta.gitlabBranch // "") == $ref
        )
      | select((.target // "") != "production")
    ][0].url // empty
  ' || true)"
  dep_id="$(printf '%s' "$deps" | jq -r --arg ref "$HEAD_REF" '
    [.deployments[]?
      | select(
          (.meta.gitBranch // .meta.githubCommitRef // .meta.gitlabBranch // "") == $ref
        )
      | select((.target // "") != "production")
    ][0].uid // empty
  ' || true)"

  if [ -z "${dep_url}" ] && [ -z "${dep_id}" ]; then
    echo "  no existing preview deployment for ${HEAD_REF} on ${project_id} — skip redeploy"
    return 0
  fi
  echo "  redeploying ${dep_id:-unknown} (${dep_url:+https://${dep_url}}) on ${project_id}"

  # Prefer CLI when present (local one-shot); API otherwise (CI).
  if [ -n "${dep_url}" ] && command -v vercel >/dev/null 2>&1; then
    if vercel redeploy "https://${dep_url}" --scope "${VERCEL_ORG_ID}" --no-wait 2>&1; then
      return 0
    fi
    echo "  warning: vercel redeploy CLI failed; trying API"
  fi

  if [ -z "${dep_id}" ]; then
    echo "  warning: no deployment id to redeploy; next push will pick up env"
    return 0
  fi

  resp="$(curl -sS "${curl_opts[@]}" "${auth_vercel[@]}" -X POST \
    -d "$(jq -n --arg id "$dep_id" '{deploymentId:$id}')" \
    "${vercel_api}/v13/deployments?teamId=${VERCEL_ORG_ID}&forceNew=1" || true)"
  new_id="$(printf '%s' "$resp" | jq -r '.id // .uid // empty' || true)"
  if [ -z "${new_id}" ]; then
    echo "  warning: redeploy response did not include id (next push will pick up env)"
    printf '%s\n' "$resp" | head -c 400
    echo
  else
    echo "  new deployment: ${new_id}"
  fi
}

for project_id in "${project_ids[@]}"; do
  project_id="$(echo "$project_id" | tr -d '[:space:]')"
  [ -z "$project_id" ] && continue
  redeploy_project "$project_id"
done

echo "Done. Neon branch ${BRANCH_NAME} (${branch_id}) wired to Preview for ${HEAD_REF}."
