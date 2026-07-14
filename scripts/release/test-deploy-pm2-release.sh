#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SCRIPT="$SCRIPT_DIR/deploy-pm2-release.sh"
TEST_ROOT="$(mktemp -d)"
MOCK_BIN="$TEST_ROOT/bin"
DEPLOY_ROOT="$TEST_ROOT/deploy"
FRONTEND_PATH="$TEST_ROOT/www/aetherguard"
PM2_LOG="$TEST_ROOT/pm2.log"
NPM_LOG="$TEST_ROOT/npm.log"
CURL_LOG="$TEST_ROOT/curl.log"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$MOCK_BIN" "$DEPLOY_ROOT/backend" "$FRONTEND_PATH"
printf 'JWT_SECRET=test-only\n' > "$DEPLOY_ROOT/backend/.env"
printf 'legacy frontend\n' > "$FRONTEND_PATH/index.html"

cat > "$MOCK_BIN/npm" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$MOCK_NPM_LOG"
if [[ "$*" == "run build" ]]; then
  mkdir -p dist
  printf 'compiled\n' > dist/index.js
fi
MOCK

cat > "$MOCK_BIN/pm2" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$MOCK_PM2_LOG"
MOCK

cat > "$MOCK_BIN/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
output=''
url=''
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --output)
      output="$2"
      shift 2
      ;;
    http://*|https://*)
      url="$1"
      shift
      ;;
    *)
      shift
      ;;
  esac
done
[[ -n "$output" ]]
printf '%s\n' "$url" >> "$MOCK_CURL_LOG"
if [[ "$url" == *"fail-readiness"* ]]; then
  exit 22
fi
printf '{"success":true,"data":{"status":"ready","blockers":[]}}\n' > "$output"
MOCK

cat > "$MOCK_BIN/node" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "-p" ]]; then
  printf '22\n'
  exit 0
fi
response_file="$2"
grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"' "$response_file"
MOCK

chmod +x "$MOCK_BIN/npm" "$MOCK_BIN/pm2" "$MOCK_BIN/curl" "$MOCK_BIN/node"

make_bundle() {
  local sha="$1"
  local label="$2"
  local source_dir="$TEST_ROOT/source-$sha"
  local bundle="$TEST_ROOT/aetherguard-$sha.tar.gz"

  mkdir -p "$source_dir/backend" "$source_dir/frontend/dist"
  printf '%s\n' "$sha" > "$source_dir/SOURCE_SHA"
  printf '{"name":"test"}\n' > "$source_dir/backend/package.json"
  printf '{"lockfileVersion":3}\n' > "$source_dir/backend/package-lock.json"
  printf 'module.exports={apps:[]}\n' > "$source_dir/backend/ecosystem.config.js"
  printf '%s frontend\n' "$label" > "$source_dir/frontend/dist/index.html"
  tar -czf "$bundle" -C "$source_dir" .
  (cd "$TEST_ROOT" && sha256sum "$(basename "$bundle")" > "$(basename "$bundle").sha256")
}

SHA_A="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
SHA_B="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
SHA_C="cccccccccccccccccccccccccccccccccccccccc"
SHA_D="dddddddddddddddddddddddddddddddddddddddd"
SHA_E="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
make_bundle "$SHA_A" "release-a"
make_bundle "$SHA_B" "release-b"
make_bundle "$SHA_C" "release-c"
make_bundle "$SHA_E" "release-e"
ln -s /etc/passwd "$TEST_ROOT/source-$SHA_E/backend/escape"
tar -czf "$TEST_ROOT/aetherguard-$SHA_E.tar.gz" -C "$TEST_ROOT/source-$SHA_E" .
(cd "$TEST_ROOT" && sha256sum "aetherguard-$SHA_E.tar.gz" > "aetherguard-$SHA_E.tar.gz.sha256")

export PATH="$MOCK_BIN:$PATH"
export MOCK_PM2_LOG="$PM2_LOG"
export MOCK_NPM_LOG="$NPM_LOG"
export MOCK_CURL_LOG="$CURL_LOG"
export DEPLOY_ROOT FRONTEND_PATH
export HEALTHCHECK_ATTEMPTS=1
export HEALTHCHECK_DELAY_SECONDS=0

PUBLIC_HEALTHCHECK_URL="http://public/readiness" \
  bash "$DEPLOY_SCRIPT" \
    "$SHA_A" \
    "$TEST_ROOT/aetherguard-$SHA_A.tar.gz" \
    "$TEST_ROOT/aetherguard-$SHA_A.tar.gz.sha256"

[[ "$(readlink -f "$DEPLOY_ROOT/current")" == "$DEPLOY_ROOT/releases/$SHA_A" ]]
grep -q '^release-a frontend$' "$FRONTEND_PATH/index.html"
[[ -f "$DEPLOY_ROOT/releases/$SHA_A/backend/dist/index.js" ]]
grep -q '^startOrReload ecosystem.config.js --update-env$' "$PM2_LOG"
grep -q '^save$' "$PM2_LOG"
[[ "$(sed -n '1p' "$NPM_LOG")" == "ci" ]]
[[ "$(sed -n '2p' "$NPM_LOG")" == "run build" ]]
[[ "$(sed -n '3p' "$NPM_LOG")" == "prune --omit=dev" ]]

if PUBLIC_HEALTHCHECK_URL="http://public/fail-readiness" \
  bash "$DEPLOY_SCRIPT" \
    "$SHA_B" \
    "$TEST_ROOT/aetherguard-$SHA_B.tar.gz" \
    "$TEST_ROOT/aetherguard-$SHA_B.tar.gz.sha256"; then
  printf 'expected the second deployment to fail readiness\n' >&2
  exit 1
fi

[[ "$(readlink -f "$DEPLOY_ROOT/current")" == "$DEPLOY_ROOT/releases/$SHA_A" ]]
grep -q '^release-a frontend$' "$FRONTEND_PATH/index.html"
grep -q '^startOrReload ecosystem.config.js --update-env$' "$PM2_LOG"
[[ "$(grep -c '127.0.0.1:3005/health/ready' "$CURL_LOG")" == "3" ]]

PM2_LINES_BEFORE_SHA_REJECT="$(wc -l < "$PM2_LOG")"
if PUBLIC_HEALTHCHECK_URL="http://public/readiness" \
  bash "$DEPLOY_SCRIPT" \
    "$SHA_D" \
    "$TEST_ROOT/aetherguard-$SHA_C.tar.gz" \
    "$TEST_ROOT/aetherguard-$SHA_C.tar.gz.sha256"; then
  printf 'expected mismatched SOURCE_SHA to be rejected\n' >&2
  exit 1
fi

[[ "$(readlink -f "$DEPLOY_ROOT/current")" == "$DEPLOY_ROOT/releases/$SHA_A" ]]
[[ "$(wc -l < "$PM2_LOG")" == "$PM2_LINES_BEFORE_SHA_REJECT" ]]

if PUBLIC_HEALTHCHECK_URL="http://public/readiness" \
  bash "$DEPLOY_SCRIPT" \
    "$SHA_E" \
    "$TEST_ROOT/aetherguard-$SHA_E.tar.gz" \
    "$TEST_ROOT/aetherguard-$SHA_E.tar.gz.sha256"; then
  printf 'expected symbolic-link bundle to be rejected\n' >&2
  exit 1
fi

[[ "$(readlink -f "$DEPLOY_ROOT/current")" == "$DEPLOY_ROOT/releases/$SHA_A" ]]
[[ "$(wc -l < "$PM2_LOG")" == "$PM2_LINES_BEFORE_SHA_REJECT" ]]

printf 'deploy-pm2-release tests: 4 passed, 0 failed\n'
