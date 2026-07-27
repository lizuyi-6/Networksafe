#!/usr/bin/env bash

set -Eeuo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALLER_SCRIPT="${REPOSITORY_ROOT}/deployment/bare-metal/install.sh"
TEST_ROOT="$(mktemp -d)"
MOCK_BIN_DIRECTORY="${TEST_ROOT}/bin"
DOCKER_LOG="${TEST_ROOT}/docker.log"

cleanup() {
  rm -rf "${TEST_ROOT}"
}
trap cleanup EXIT

fail() {
  printf 'test-bare-metal-minio: %s\n' "$*" >&2
  exit 1
}

mkdir -p "${MOCK_BIN_DIRECTORY}" "${TEST_ROOT}/minio-data" "${TEST_ROOT}/credentials"

cat > "${MOCK_BIN_DIRECTORY}/docker" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${DOCKER_LOG}"

if [[ "$1 $2" == 'ps -a' ]]; then
  printf '%s\n' 'aetherguard-minio'
  exit 0
fi

if [[ "$1 $2" == 'inspect aetherguard-minio' ]]; then
  case "$*" in
    *'{{.Config.Image}}'*)
      printf '%s\n' "${MOCK_MINIO_IMAGE}"
      ;;
    *'.Destination "/data"'*)
      printf '%s\n' "${AG_MINIO_DATA_DIR}"
      ;;
    *'"9000/tcp"'*)
      printf '%s\n' "${MOCK_MINIO_API_BINDING}"
      ;;
    *'"9001/tcp"'*)
      printf '%s\n' "${MOCK_MINIO_CONSOLE_BINDING}"
      ;;
    *'{{range .Config.Env}}'*)
      printf '%s\n' \
        "MINIO_ROOT_USER=${MOCK_MINIO_ACCESS_KEY}" \
        "MINIO_ROOT_PASSWORD=${MOCK_MINIO_SECRET_KEY}"
      ;;
    *'{{.State.Running}}'*)
      printf '%s\n' "${MOCK_MINIO_RUNNING}"
      ;;
    *)
      printf 'unexpected docker inspect format: %s\n' "$*" >&2
      exit 2
      ;;
  esac
  exit 0
fi

if [[ "$1 $2" == 'start aetherguard-minio' ]]; then
  exit 0
fi

printf 'unexpected docker command: %s\n' "$*" >&2
exit 2
MOCK

cat > "${MOCK_BIN_DIRECTORY}/curl" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' '{}'
MOCK

chmod +x "${MOCK_BIN_DIRECTORY}/docker" "${MOCK_BIN_DIRECTORY}/curl"
export PATH="${MOCK_BIN_DIRECTORY}:${PATH}"
export DOCKER_LOG
export AG_DEPLOY_ROOT="${TEST_ROOT}/deploy"
export AG_FRONTEND_DIR="${TEST_ROOT}/frontend"
export AG_APP_USER="$(id -un)"
export AG_APP_GROUP="$(id -gn)"
export AG_MINIO_DATA_DIR="${TEST_ROOT}/minio-data"
export AG_MINIO_CREDENTIALS_DIR="${TEST_ROOT}/credentials"
export AG_MINIO_IMAGE='minio/minio:RELEASE.2025-02-18T16-25-55Z'
export MOCK_MINIO_IMAGE='minio/minio:latest'
export MOCK_MINIO_API_BINDING='127.0.0.1:9000'
export MOCK_MINIO_CONSOLE_BINDING='127.0.0.1:9001'
export MOCK_MINIO_ACCESS_KEY='container-access'
export MOCK_MINIO_SECRET_KEY='container-secret-value'
export MOCK_MINIO_RUNNING='true'

# shellcheck disable=SC1090
source "${INSTALLER_SCRIPT}"

AG_SOURCE_TARBALL='release.tar.gz'
AG_SOURCE_SHA='0123456789abcdef0123456789abcdef01234567'
[[ "$(resolve_target_sha)" == "${AG_SOURCE_SHA}" ]] \
  || fail 'tarball release identity did not preserve the supplied source SHA'
AG_SOURCE_TARBALL=''
AG_SOURCE_SHA=''

printf '%s' 'stale-access' > "${AG_MINIO_CREDENTIALS_DIR}/.minio-access"
printf '%s' 'stale-secret' > "${AG_MINIO_CREDENTIALS_DIR}/.minio-secret"

minio_connection="$(ensure_minio)"
expected_connection=$'http://127.0.0.1:9000\tcontainer-access\tcontainer-secret-value'
[[ "${minio_connection}" == "${expected_connection}" ]] \
  || fail "existing container connection tuple was incorrect: ${minio_connection}"
[[ "$(<"${AG_MINIO_CREDENTIALS_DIR}/.minio-access")" == 'container-access' ]] \
  || fail 'stale MinIO access key file was not repaired'
[[ "$(<"${AG_MINIO_CREDENTIALS_DIR}/.minio-secret")" == 'container-secret-value' ]] \
  || fail 'stale MinIO secret file was not repaired'

export MOCK_MINIO_RUNNING='false'
: > "${DOCKER_LOG}"
ensure_minio >/dev/null
[[ "$(<"${DOCKER_LOG}")" == *'start aetherguard-minio'* ]] \
  || fail 'stopped MinIO container was not started'

export MOCK_MINIO_RUNNING='true'
export MOCK_MINIO_API_BINDING='0.0.0.0:9000'
if (ensure_minio >/dev/null 2>&1); then
  fail 'public MinIO API binding unexpectedly passed validation'
fi
export MOCK_MINIO_API_BINDING='127.0.0.1:9000'

AG_MINIO_IMAGE='minio/minio:latest'
if (validate_minio_image_reference >/dev/null 2>&1); then
  fail 'mutable MinIO image unexpectedly passed validation'
fi
AG_ALLOW_UNPINNED_MINIO_IMAGE=1
validate_minio_image_reference >/dev/null

printf '%s\n' 'test-bare-metal-minio: PASS'
