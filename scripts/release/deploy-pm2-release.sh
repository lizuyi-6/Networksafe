#!/usr/bin/env bash

set -Eeuo pipefail
umask 027

EXPECTED_SHA="${1:?usage: deploy-pm2-release.sh <sha> <bundle.tar.gz> <bundle.sha256>}"
BUNDLE_PATH="${2:?usage: deploy-pm2-release.sh <sha> <bundle.tar.gz> <bundle.sha256>}"
CHECKSUM_PATH="${3:?usage: deploy-pm2-release.sh <sha> <bundle.tar.gz> <bundle.sha256>}"

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/networksafe}"
FRONTEND_PATH="${FRONTEND_PATH:-/var/www/aetherguard}"
BACKEND_HEALTHCHECK_URL="${BACKEND_HEALTHCHECK_URL:-http://127.0.0.1:3005/health/ready}"
PUBLIC_HEALTHCHECK_URL="${PUBLIC_HEALTHCHECK_URL:-}"
PM2_APP_NAME="api-security-backend"
HEALTHCHECK_ATTEMPTS="${HEALTHCHECK_ATTEMPTS:-30}"
HEALTHCHECK_DELAY_SECONDS="${HEALTHCHECK_DELAY_SECONDS:-2}"

fail() {
  printf 'deployment error: %s\n' "$*" >&2
  return 1
}

[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "expected SHA must be a full lowercase commit SHA"
[[ "$DEPLOY_ROOT" == /* && "$DEPLOY_ROOT" != "/" ]] || fail "DEPLOY_ROOT must be a non-root absolute path"
[[ "$FRONTEND_PATH" == /* && "$FRONTEND_PATH" != "/" ]] || fail "FRONTEND_PATH must be a non-root absolute path"
[[ "$HEALTHCHECK_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || fail "HEALTHCHECK_ATTEMPTS must be a positive integer"
[[ "$HEALTHCHECK_DELAY_SECONDS" =~ ^[0-9]+$ ]] || fail "HEALTHCHECK_DELAY_SECONDS must be a non-negative integer"
[[ -f "$BUNDLE_PATH" ]] || fail "bundle not found: $BUNDLE_PATH"
[[ -f "$CHECKSUM_PATH" ]] || fail "checksum not found: $CHECKSUM_PATH"

for command in curl find grep node npm pm2 sha256sum tar; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
[[ "$NODE_MAJOR" == "22" ]] || fail "deployment host must use Node.js 22; found major version $NODE_MAJOR"

read -r EXPECTED_DIGEST CHECKSUM_FILE < "$CHECKSUM_PATH"
[[ "$EXPECTED_DIGEST" =~ ^[0-9a-f]{64}$ ]] || fail "checksum file does not contain a SHA-256 digest"
CHECKSUM_FILE="${CHECKSUM_FILE#\*}"
[[ "$CHECKSUM_FILE" == "$(basename "$BUNDLE_PATH")" ]] || fail "checksum filename does not match bundle"
ACTUAL_DIGEST="$(sha256sum "$BUNDLE_PATH" | awk '{print $1}')"
[[ "$ACTUAL_DIGEST" == "$EXPECTED_DIGEST" ]] || fail "bundle checksum mismatch"

RELEASES_ROOT="$DEPLOY_ROOT/releases"
RELEASE_DIR="$RELEASES_ROOT/$EXPECTED_SHA"
STAGING_DIR="$RELEASES_ROOT/.staging-$EXPECTED_SHA-$$"
CURRENT_LINK="$DEPLOY_ROOT/current"
SHARED_DIR="$DEPLOY_ROOT/shared"
SHARED_ENV="$SHARED_DIR/backend.env"

mkdir -p "$RELEASES_ROOT" "$SHARED_DIR"

if [[ ! -d "$RELEASE_DIR" ]]; then
  rm -rf "$STAGING_DIR"
  mkdir -p "$STAGING_DIR"
  tar --extract --gzip --file "$BUNDLE_PATH" --directory "$STAGING_DIR" --no-same-owner --no-same-permissions
  if find "$STAGING_DIR" -type l -print -quit | grep -q .; then
    fail "bundle contains a symbolic link"
  fi

  [[ -f "$STAGING_DIR/SOURCE_SHA" ]] || fail "bundle is missing SOURCE_SHA"
  [[ "$(tr -d '\r\n' < "$STAGING_DIR/SOURCE_SHA")" == "$EXPECTED_SHA" ]] || fail "bundle SOURCE_SHA does not match tested commit"
  [[ -f "$STAGING_DIR/backend/package-lock.json" ]] || fail "bundle is missing backend/package-lock.json"
  [[ -f "$STAGING_DIR/backend/ecosystem.config.js" ]] || fail "bundle is missing PM2 configuration"
  [[ -f "$STAGING_DIR/frontend/dist/index.html" ]] || fail "bundle is missing frontend/dist/index.html"

  if [[ ! -f "$SHARED_ENV" ]]; then
    LEGACY_ENV=""
    if [[ -f "$CURRENT_LINK/backend/.env" ]]; then
      LEGACY_ENV="$CURRENT_LINK/backend/.env"
    elif [[ -f "$DEPLOY_ROOT/backend/.env" ]]; then
      LEGACY_ENV="$DEPLOY_ROOT/backend/.env"
    fi
    [[ -n "$LEGACY_ENV" ]] || fail "shared backend environment is missing: $SHARED_ENV"
    install -m 600 "$LEGACY_ENV" "$SHARED_ENV"
  fi

  ln -s "$SHARED_ENV" "$STAGING_DIR/backend/.env"

  (
    cd "$STAGING_DIR/backend"
    npm ci
    npm run build
    npm prune --omit=dev
    [[ -f dist/index.js ]]
  )

  mv "$STAGING_DIR" "$RELEASE_DIR"
else
  [[ -f "$RELEASE_DIR/SOURCE_SHA" ]] || fail "existing release is missing SOURCE_SHA"
  [[ "$(tr -d '\r\n' < "$RELEASE_DIR/SOURCE_SHA")" == "$EXPECTED_SHA" ]] || fail "existing release SHA mismatch"
  [[ -f "$RELEASE_DIR/backend/dist/index.js" ]] || fail "existing release is missing backend build"
  [[ -f "$RELEASE_DIR/frontend/dist/index.html" ]] || fail "existing release is missing frontend build"
fi

PREVIOUS_RELEASE=""
LEGACY_BACKEND=""
if [[ -L "$CURRENT_LINK" ]]; then
  PREVIOUS_RELEASE="$(readlink -f "$CURRENT_LINK")"
elif [[ -e "$CURRENT_LINK" ]]; then
  fail "$CURRENT_LINK exists and is not a symlink"
elif [[ -f "$DEPLOY_ROOT/backend/ecosystem.config.js" ]]; then
  LEGACY_BACKEND="$DEPLOY_ROOT/backend"
fi

FRONTEND_BACKUP="${FRONTEND_PATH}.previous"
FRONTEND_STAGING="${FRONTEND_PATH}.staging-$EXPECTED_SHA-$$"
BACKEND_ACTIVATED=0
FRONTEND_ACTIVATED=0

start_backend() {
  local backend_dir="$1"
  (
    cd "$backend_dir"
    pm2 startOrReload ecosystem.config.js --update-env
  )
}

assert_ready() {
  local url="$1"
  local label="$2"
  local response_file
  response_file="$(mktemp)"

  if ! curl --fail --silent --show-error --max-time 10 "$url" --output "$response_file"; then
    rm -f "$response_file"
    return 1
  fi

  if ! node - "$response_file" "$label" <<'NODE'
const fs = require('node:fs');
const [file, label] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
const status = payload && payload.data ? payload.data.status : payload && payload.status;
if (status !== 'ready') {
  console.error(`${label} returned status=${JSON.stringify(status)} instead of ready`);
  process.exit(1);
}
NODE
  then
    rm -f "$response_file"
    return 1
  fi

  rm -f "$response_file"
}

wait_for_readiness() {
  local url="$1"
  local label="$2"
  local attempt
  for attempt in $(seq 1 "$HEALTHCHECK_ATTEMPTS"); do
    if assert_ready "$url" "$label"; then
      return 0
    fi
    sleep "$HEALTHCHECK_DELAY_SECONDS"
  done
  return 1
}

rollback() {
  local exit_code="$1"
  local backend_restored=0
  trap - ERR
  set +e
  printf 'deployment failed; rolling back activated paths\n' >&2

  if [[ "$FRONTEND_ACTIVATED" -eq 1 ]]; then
    rm -rf "$FRONTEND_PATH"
    if [[ -e "$FRONTEND_BACKUP" || -L "$FRONTEND_BACKUP" ]]; then
      mv "$FRONTEND_BACKUP" "$FRONTEND_PATH"
    fi
  fi

  if [[ "$BACKEND_ACTIVATED" -eq 1 ]]; then
    rm -f "$CURRENT_LINK"
    if [[ -n "$PREVIOUS_RELEASE" ]]; then
      ln -s "$PREVIOUS_RELEASE" "$CURRENT_LINK"
      if start_backend "$CURRENT_LINK/backend"; then
        backend_restored=1
      fi
    elif [[ -n "$LEGACY_BACKEND" ]]; then
      if start_backend "$LEGACY_BACKEND"; then
        backend_restored=1
      fi
    else
      pm2 delete "$PM2_APP_NAME"
    fi
  fi

  if [[ "$backend_restored" -eq 1 ]]; then
    if ! wait_for_readiness "$BACKEND_HEALTHCHECK_URL" "rollback backend readiness"; then
      printf 'rollback error: previous backend did not return ready\n' >&2
    fi
  fi

  if [[ "$FRONTEND_ACTIVATED" -eq 1 && ! -f "$FRONTEND_PATH/index.html" ]]; then
    printf 'rollback error: previous frontend index.html was not restored\n' >&2
  fi

  exit "$exit_code"
}

trap 'rollback $?' ERR

NEXT_LINK="$DEPLOY_ROOT/.current-$EXPECTED_SHA-$$"
ln -s "$RELEASE_DIR" "$NEXT_LINK"
mv -Tf "$NEXT_LINK" "$CURRENT_LINK"
BACKEND_ACTIVATED=1
start_backend "$CURRENT_LINK/backend"
wait_for_readiness "$BACKEND_HEALTHCHECK_URL" "backend readiness"

rm -rf "$FRONTEND_STAGING"
mkdir -p "$FRONTEND_STAGING"
cp -a "$RELEASE_DIR/frontend/dist/." "$FRONTEND_STAGING/"
[[ -f "$FRONTEND_STAGING/index.html" ]] || fail "frontend staging copy is missing index.html"

rm -rf "$FRONTEND_BACKUP"
if [[ -e "$FRONTEND_PATH" || -L "$FRONTEND_PATH" ]]; then
  mv "$FRONTEND_PATH" "$FRONTEND_BACKUP"
fi
mv "$FRONTEND_STAGING" "$FRONTEND_PATH"
FRONTEND_ACTIVATED=1

if [[ -n "$PUBLIC_HEALTHCHECK_URL" ]]; then
  wait_for_readiness "$PUBLIC_HEALTHCHECK_URL" "public readiness"
fi

pm2 save
trap - ERR
printf 'deployed tested commit %s\n' "$EXPECTED_SHA"
