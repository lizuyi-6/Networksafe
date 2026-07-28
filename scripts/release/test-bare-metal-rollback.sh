#!/usr/bin/env bash

set -Eeuo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROLLBACK_SCRIPT="${REPOSITORY_ROOT}/deployment/bare-metal/rollback.sh"
TEST_ROOT="$(mktemp -d)"
DEPLOY_ROOT="${TEST_ROOT}/aetherguard"
FRONTEND_DIRECTORY="${TEST_ROOT}/frontend"
MOCK_BIN_DIRECTORY="${TEST_ROOT}/bin"
SYSTEMCTL_LOG="${TEST_ROOT}/systemctl.log"
CURL_LOG="${TEST_ROOT}/curl.log"
DEPLOY_LOCK_FILE="${TEST_ROOT}/deployment.lock"
ROLLBACK_CONFIG_FILE="${TEST_ROOT}/rollback.conf"

cleanup() {
  rm -rf "${TEST_ROOT}"
}
trap cleanup EXIT

fail() {
  printf 'test-bare-metal-rollback: %s\n' "$*" >&2
  exit 1
}

assert_equals() {
  local expected_value="$1"
  local actual_value="$2"
  local description="$3"
  [[ "${actual_value}" == "${expected_value}" ]] \
    || fail "${description}: expected ${expected_value}, got ${actual_value}"
}

create_release() {
  local release_id="$1"
  local compatibility_epoch="$2"
  local release_directory="${DEPLOY_ROOT}/releases/${release_id}"

  mkdir -p \
    "${release_directory}/backend/dist" \
    "${release_directory}/frontend/dist" \
    "${release_directory}/deployment/bare-metal"
  printf '%s\n' "${release_id}" > "${release_directory}/SOURCE_SHA"
  printf 'backend-%s\n' "${release_id}" > "${release_directory}/backend/dist/index.js"
  printf 'frontend-%s\n' "${release_id}" > "${release_directory}/frontend/dist/index.html"
  printf '%s\n' "${compatibility_epoch}" \
    > "${release_directory}/deployment/bare-metal/database-compatibility-epoch"
}

activate_fixture_release() {
  local release_id="$1"
  rm -f "${DEPLOY_ROOT}/current"
  ln -s "${DEPLOY_ROOT}/releases/${release_id}" "${DEPLOY_ROOT}/current"
  rm -rf "${FRONTEND_DIRECTORY}"
  cp -a "${DEPLOY_ROOT}/releases/${release_id}/frontend/dist" "${FRONTEND_DIRECTORY}"
}

mkdir -p "${DEPLOY_ROOT}/releases" "${DEPLOY_ROOT}/shared" "${MOCK_BIN_DIRECTORY}"
create_release release-a 1
create_release release-b 1
create_release release-c 2
create_release release-d 1
rm -f "${DEPLOY_ROOT}/releases/release-d/deployment/bare-metal/database-compatibility-epoch"
create_release release-e 1
mkdir -p "${TEST_ROOT}/outside-frontend"
printf '%s\n' 'outside-frontend' > "${TEST_ROOT}/outside-frontend/index.html"
rm -rf "${DEPLOY_ROOT}/releases/release-e/frontend/dist"
ln -s "${TEST_ROOT}/outside-frontend" "${DEPLOY_ROOT}/releases/release-e/frontend/dist"
activate_fixture_release release-b
printf 'persistent-data\n' > "${DEPLOY_ROOT}/shared/sentinel"

cat > "${MOCK_BIN_DIRECTORY}/systemctl" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${SYSTEMCTL_LOG}"
MOCK

cat > "${MOCK_BIN_DIRECTORY}/curl" <<'MOCK'
#!/usr/bin/env bash
active_release="$(basename "$(readlink -f "${AG_DEPLOY_ROOT}/current")")"
printf '%s|%s\n' "${active_release}" "$*" >> "${CURL_LOG}"
if [[ -n "${MOCK_FAIL_RELEASE:-}" && "${active_release}" == "${MOCK_FAIL_RELEASE}" ]]; then
  exit 22
fi
printf '%s\n' '{"status":"ready"}'
MOCK

chmod +x "${MOCK_BIN_DIRECTORY}/systemctl" "${MOCK_BIN_DIRECTORY}/curl"
export PATH="${MOCK_BIN_DIRECTORY}:${PATH}"
export SYSTEMCTL_LOG
export CURL_LOG
export AG_DEPLOY_ROOT="${DEPLOY_ROOT}"
export AG_FRONTEND_DIR="${FRONTEND_DIRECTORY}"
export AG_BACKEND_PORT=3005
export AG_ROLLBACK_HEALTH_ATTEMPTS=1
export AG_ROLLBACK_HEALTH_DELAY_SECONDS=0
export AG_ROLLBACK_TEST_MODE=1
export AG_DEPLOY_LOCK_FILE="${DEPLOY_LOCK_FILE}"
export AG_ROLLBACK_CONFIG_FILE="${ROLLBACK_CONFIG_FILE}"

if bash "${ROLLBACK_SCRIPT}"; then
  fail 'rollback without an explicit release identifier unexpectedly succeeded'
fi

bash "${ROLLBACK_SCRIPT}" release-a
assert_equals \
  "${DEPLOY_ROOT}/releases/release-a" \
  "$(readlink -f "${DEPLOY_ROOT}/current")" \
  'successful rollback current release'
assert_equals \
  'frontend-release-a' \
  "$(tr -d '\r\n' < "${FRONTEND_DIRECTORY}/index.html")" \
  'successful rollback frontend'
assert_equals \
  'persistent-data' \
  "$(tr -d '\r\n' < "${DEPLOY_ROOT}/shared/sentinel")" \
  'successful rollback shared data'

activate_fixture_release release-b
export MOCK_FAIL_RELEASE=release-a
FAILED_ROLLBACK_LOG="${TEST_ROOT}/failed-rollback.log"
if bash "${ROLLBACK_SCRIPT}" release-a 2>"${FAILED_ROLLBACK_LOG}"; then
  fail 'failed target readiness unexpectedly succeeded'
fi
unset MOCK_FAIL_RELEASE
if [[ "$(<"${FAILED_ROLLBACK_LOG}")" == *'CRITICAL:'* ]]; then
  printf '%s\n' '--- failed rollback log ---' >&2
  sed -n '1,200p' "${FAILED_ROLLBACK_LOG}" >&2
  printf '%s\n' '--- curl log ---' >&2
  sed -n '1,200p' "${CURL_LOG}" >&2
  fail 'starting release did not recover readiness after target failure'
fi
assert_equals \
  "${DEPLOY_ROOT}/releases/release-b" \
  "$(readlink -f "${DEPLOY_ROOT}/current")" \
  'failed rollback restored current release'
assert_equals \
  'frontend-release-b' \
  "$(tr -d '\r\n' < "${FRONTEND_DIRECTORY}/index.html")" \
  'failed rollback restored frontend'

if bash "${ROLLBACK_SCRIPT}" release-c; then
  fail 'database compatibility mismatch unexpectedly succeeded'
fi
assert_equals \
  "${DEPLOY_ROOT}/releases/release-b" \
  "$(readlink -f "${DEPLOY_ROOT}/current")" \
  'compatibility rejection preserved current release'
assert_equals \
  'persistent-data' \
  "$(tr -d '\r\n' < "${DEPLOY_ROOT}/shared/sentinel")" \
  'compatibility rejection preserved shared data'

if bash "${ROLLBACK_SCRIPT}" release-d; then
  fail 'missing compatibility metadata unexpectedly succeeded without an override'
fi
assert_equals \
  "${DEPLOY_ROOT}/releases/release-b" \
  "$(readlink -f "${DEPLOY_ROOT}/current")" \
  'missing metadata rejection preserved current release'

if bash "${ROLLBACK_SCRIPT}" release-e; then
  fail 'symlinked frontend payload unexpectedly succeeded'
fi
assert_equals \
  "${DEPLOY_ROOT}/releases/release-b" \
  "$(readlink -f "${DEPLOY_ROOT}/current")" \
  'symlink rejection preserved current release'

bash "${ROLLBACK_SCRIPT}" --allow-legacy-database-epoch release-d
assert_equals \
  "${DEPLOY_ROOT}/releases/release-d" \
  "$(readlink -f "${DEPLOY_ROOT}/current")" \
  'explicit legacy metadata override activated target release'

cat > "${ROLLBACK_CONFIG_FILE}" <<EOF
AG_CONFIG_DEPLOY_ROOT=${DEPLOY_ROOT}
AG_CONFIG_FRONTEND_DIR=${FRONTEND_DIRECTORY}
AG_CONFIG_BACKEND_PORT=3005
AG_CONFIG_DEPLOY_LOCK_FILE=${DEPLOY_LOCK_FILE}
EOF

env \
  -u AG_DEPLOY_ROOT \
  -u AG_FRONTEND_DIR \
  -u AG_BACKEND_PORT \
  -u AG_DEPLOY_LOCK_FILE \
  AG_ROLLBACK_CONFIG_FILE="${ROLLBACK_CONFIG_FILE}" \
  AG_ROLLBACK_TEST_MODE=1 \
  AG_ROLLBACK_HEALTH_ATTEMPTS=1 \
  AG_ROLLBACK_HEALTH_DELAY_SECONDS=0 \
  SYSTEMCTL_LOG="${SYSTEMCTL_LOG}" \
  CURL_LOG="${CURL_LOG}" \
  PATH="${PATH}" \
  bash "${ROLLBACK_SCRIPT}" --allow-legacy-database-epoch release-b
assert_equals \
  "${DEPLOY_ROOT}/releases/release-b" \
  "$(readlink -f "${DEPLOY_ROOT}/current")" \
  'persisted rollback configuration selected the custom deployment root'

LOCK_MARKER="${TEST_ROOT}/lock-acquired"
(
  flock 8
  touch "${LOCK_MARKER}"
  sleep 5
) 8>"${DEPLOY_LOCK_FILE}" &
LOCK_HOLDER_PROCESS_ID=$!
for _ in $(seq 1 50); do
  [[ -f "${LOCK_MARKER}" ]] && break
  sleep 0.1
done
[[ -f "${LOCK_MARKER}" ]] || fail 'test failed to acquire the deployment lock'
if bash "${ROLLBACK_SCRIPT}" --allow-legacy-database-epoch release-d; then
  fail 'concurrent rollback unexpectedly acquired the deployment lock'
fi
kill "${LOCK_HOLDER_PROCESS_ID}" 2>/dev/null || true
wait "${LOCK_HOLDER_PROCESS_ID}" 2>/dev/null || true

printf '%s\n' 'test-bare-metal-rollback: PASS'
