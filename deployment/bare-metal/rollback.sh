#!/usr/bin/env bash

set -Eeuo pipefail
umask 027

: "${AG_ROLLBACK_CONFIG_FILE:=/etc/aetherguard/rollback.conf}"
AG_CONFIG_DEPLOY_ROOT=""
AG_CONFIG_FRONTEND_DIR=""
AG_CONFIG_BACKEND_PORT=""
AG_CONFIG_DEPLOY_LOCK_FILE=""
if [[ -f "${AG_ROLLBACK_CONFIG_FILE}" ]]; then
  if [[ "${EUID}" -eq 0 ]]; then
    config_owner_id="$(stat --format='%u' "${AG_ROLLBACK_CONFIG_FILE}")"
    config_mode="$(stat --format='%a' "${AG_ROLLBACK_CONFIG_FILE}")"
    [[ "${config_owner_id}" == "0" ]] \
      || { printf 'Rollback config must be owned by root: %s\n' "${AG_ROLLBACK_CONFIG_FILE}" >&2; exit 78; }
    (( (8#${config_mode} & 8#022) == 0 )) \
      || { printf 'Rollback config must not be group/world writable: %s\n' "${AG_ROLLBACK_CONFIG_FILE}" >&2; exit 78; }
  fi
  # This root-owned file contains deployment paths and ports, never secrets.
  # shellcheck disable=SC1090
  source "${AG_ROLLBACK_CONFIG_FILE}"
fi

: "${AG_DEPLOY_ROOT:=${AG_CONFIG_DEPLOY_ROOT:-/opt/aetherguard}}"
: "${AG_FRONTEND_DIR:=${AG_CONFIG_FRONTEND_DIR:-/var/www/aetherguard}}"
: "${AG_BACKEND_PORT:=${AG_CONFIG_BACKEND_PORT:-3005}}"
: "${AG_DEPLOY_LOCK_FILE:=${AG_CONFIG_DEPLOY_LOCK_FILE:-/run/lock/aetherguard-deployment.lock}}"
: "${AG_ROLLBACK_HEALTH_ATTEMPTS:=60}"
: "${AG_ROLLBACK_HEALTH_DELAY_SECONDS:=2}"
: "${AG_ALLOW_LEGACY_DATABASE_EPOCH:=0}"

TARGET_RELEASE_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --allow-legacy-database-epoch)
      AG_ALLOW_LEGACY_DATABASE_EPOCH=1
      shift
      ;;
    --help|-h)
      printf 'Usage: sudo aetherguard-rollback [--allow-legacy-database-epoch] <release-id>\n'
      exit 0
      ;;
    -*)
      printf 'Unknown option: %s\n' "$1" >&2
      exit 2
      ;;
    *)
      [[ -z "${TARGET_RELEASE_ID}" ]] || {
        printf '%s\n' 'Only one release identifier may be provided.' >&2
        exit 2
      }
      TARGET_RELEASE_ID="$1"
      shift
      ;;
  esac
done

RELEASES_DIRECTORY="${AG_DEPLOY_ROOT}/releases"
CURRENT_LINK="${AG_DEPLOY_ROOT}/current"
ROLLBACK_PROCESS_ID="$$"
NEXT_CURRENT_LINK="${AG_DEPLOY_ROOT}/.rollback-current-${ROLLBACK_PROCESS_ID}"
FRONTEND_STAGING_DIRECTORY="${AG_FRONTEND_DIR}.rollback-new-${ROLLBACK_PROCESS_ID}"
FRONTEND_BACKUP_DIRECTORY="${AG_FRONTEND_DIR}.rollback-old-${ROLLBACK_PROCESS_ID}"

STARTING_RELEASE_DIRECTORY=""
TARGET_RELEASE_DIRECTORY=""
FRONTEND_BACKED_UP=0
FRONTEND_ACTIVATED=0
BACKEND_ACTIVATED=0
RESTORE_IN_PROGRESS=0
RESTORE_FAILED=0

log() {
  printf '[aetherguard-rollback] %s\n' "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

require_privileges() {
  if [[ "${EUID}" -eq 0 ]]; then
    return
  fi

  if [[ "${AG_ROLLBACK_TEST_MODE:-0}" == "1" && "${AG_DEPLOY_ROOT}" == /tmp/* ]]; then
    return
  fi

  die "run as root; rollback manages systemd, nginx, and the production frontend"
}

acquire_deployment_lock() {
  command -v flock >/dev/null 2>&1 || die "flock is required for serialized deployment operations"
  install -d -m 0755 "$(dirname "${AG_DEPLOY_LOCK_FILE}")"
  exec 9>"${AG_DEPLOY_LOCK_FILE}"
  flock --nonblock 9 \
    || die "another AetherGuard install or rollback operation is already running"
}

assert_owned_path() {
  local candidate_path="$1"
  local resolved_path
  resolved_path="$(readlink -f "${candidate_path}" 2>/dev/null || printf '%s' "${candidate_path}")"

  case "${resolved_path}" in
    "${RELEASES_DIRECTORY}"/*|\
    "${CURRENT_LINK}"|\
    "${AG_DEPLOY_ROOT}/.rollback-current-"*|\
    "${AG_FRONTEND_DIR}"|\
    "${AG_FRONTEND_DIR}.rollback-new-"*|\
    "${AG_FRONTEND_DIR}.rollback-old-"*)
      return
      ;;
    *)
      die "refusing to operate outside owned deployment paths: ${resolved_path}"
      ;;
  esac
}

resolve_release_directory() {
  local release_id="$1"
  local candidate_directory="${RELEASES_DIRECTORY}/${release_id}"
  local resolved_releases_directory resolved_candidate_directory

  [[ "${release_id}" =~ ^[A-Za-z0-9._-]+$ ]] \
    || die "invalid release identifier: ${release_id}"
  [[ -d "${candidate_directory}" ]] || die "release does not exist: ${candidate_directory}"

  resolved_releases_directory="$(readlink -f "${RELEASES_DIRECTORY}")"
  resolved_candidate_directory="$(readlink -f "${candidate_directory}")"
  [[ "$(dirname "${resolved_candidate_directory}")" == "${resolved_releases_directory}" ]] \
    || die "release must be a direct child of ${RELEASES_DIRECTORY}"

  printf '%s\n' "${resolved_candidate_directory}"
}

validate_release() {
  local release_directory="$1"
  local expected_release_id relative_path resolved_artifact_path
  expected_release_id="$(basename "${release_directory}")"

  for relative_path in \
    SOURCE_SHA \
    backend \
    backend/dist \
    backend/dist/index.js \
    frontend \
    frontend/dist \
    frontend/dist/index.html; do
    [[ ! -L "${release_directory}/${relative_path}" ]] \
      || die "release artifact must not be a symbolic link: ${expected_release_id}/${relative_path}"
    resolved_artifact_path="$(readlink -f "${release_directory}/${relative_path}" 2>/dev/null || true)"
    [[ "${resolved_artifact_path}" == "${release_directory}"/* ]] \
      || die "release artifact escapes its release directory: ${expected_release_id}/${relative_path}"
  done

  [[ -f "${release_directory}/SOURCE_SHA" ]] || die "release is missing SOURCE_SHA: ${release_directory}"
  [[ "$(tr -d '\r\n' < "${release_directory}/SOURCE_SHA")" == "${expected_release_id}" ]] \
    || die "release SOURCE_SHA does not match directory: ${expected_release_id}"
  [[ -f "${release_directory}/backend/dist/index.js" ]] \
    || die "release is missing backend/dist/index.js: ${expected_release_id}"
  [[ -f "${release_directory}/frontend/dist/index.html" ]] \
    || die "release is missing frontend/dist/index.html: ${expected_release_id}"
}

read_database_compatibility_epoch() {
  local release_directory="$1"
  local epoch_file="${release_directory}/deployment/bare-metal/database-compatibility-epoch"

  if [[ ! -f "${epoch_file}" ]]; then
    if [[ "${AG_ALLOW_LEGACY_DATABASE_EPOCH}" == "1" ]]; then
      log "WARNING: ${epoch_file} is missing; explicit legacy override treats it as epoch 1"
      printf '%s\n' '1'
      return 0
    fi
    die "release is missing database compatibility metadata: ${epoch_file}; use --allow-legacy-database-epoch only after reviewing schema compatibility"
  fi

  local compatibility_epoch
  compatibility_epoch="$(tr -d '[:space:]' < "${epoch_file}")"
  [[ "${compatibility_epoch}" =~ ^[1-9][0-9]*$ ]] \
    || die "invalid database compatibility epoch in ${epoch_file}"
  printf '%s\n' "${compatibility_epoch}"
}

assert_database_compatibility() {
  local starting_epoch target_epoch
  starting_epoch="$(read_database_compatibility_epoch "${STARTING_RELEASE_DIRECTORY}")"
  target_epoch="$(read_database_compatibility_epoch "${TARGET_RELEASE_DIRECTORY}")"

  [[ "${starting_epoch}" == "${target_epoch}" ]] \
    || die "database compatibility epoch differs (${starting_epoch} -> ${target_epoch}); deploy a forward fix or use a separately reviewed recovery plan"
}

wait_for_readiness() {
  local readiness_url="$1"
  local readiness_label="$2"
  local readiness_attempt

  for readiness_attempt in $(seq 1 "${AG_ROLLBACK_HEALTH_ATTEMPTS}"); do
    if curl --fail --silent --show-error --max-time 5 "${readiness_url}" \
      | grep -q '"ready"'; then
      return 0
    fi
    sleep "${AG_ROLLBACK_HEALTH_DELAY_SECONDS}"
  done

  log "${readiness_label} did not report ready: ${readiness_url}"
  return 1
}

restart_backend_and_verify_internal() {
  systemctl restart aetherguard-backend.service
  wait_for_readiness \
    "http://127.0.0.1:${AG_BACKEND_PORT}/health/ready" \
    'internal backend readiness'
}

start_nginx_and_verify_proxy() {
  systemctl start nginx.service
  wait_for_readiness \
    'http://127.0.0.1/health/ready' \
    'nginx proxied readiness'
}

restore_starting_state() {
  if [[ "${RESTORE_IN_PROGRESS}" == "1" ]]; then
    return
  fi
  RESTORE_IN_PROGRESS=1
  trap - ERR INT TERM
  set +e

  log "rollback activation failed; restoring the starting release"
  systemctl stop nginx.service >/dev/null 2>&1 || RESTORE_FAILED=1

  if [[ "${BACKEND_ACTIVATED}" == "1" ]]; then
    rm -f "${NEXT_CURRENT_LINK}" || RESTORE_FAILED=1
    ln -s "${STARTING_RELEASE_DIRECTORY}" "${NEXT_CURRENT_LINK}" || RESTORE_FAILED=1
    mv -Tf "${NEXT_CURRENT_LINK}" "${CURRENT_LINK}" || RESTORE_FAILED=1
  fi

  if [[ "${FRONTEND_ACTIVATED}" == "1" ]]; then
    rm -rf "${AG_FRONTEND_DIR}" || RESTORE_FAILED=1
  fi
  if [[ "${FRONTEND_BACKED_UP}" == "1" && -d "${FRONTEND_BACKUP_DIRECTORY}" ]]; then
    mv "${FRONTEND_BACKUP_DIRECTORY}" "${AG_FRONTEND_DIR}" || RESTORE_FAILED=1
  fi

  rm -rf "${FRONTEND_STAGING_DIRECTORY}" || RESTORE_FAILED=1
  rm -f "${NEXT_CURRENT_LINK}" || RESTORE_FAILED=1

  [[ "$(readlink -f "${CURRENT_LINK}" 2>/dev/null || true)" == "${STARTING_RELEASE_DIRECTORY}" ]] \
    || RESTORE_FAILED=1
  cmp --silent \
    "${STARTING_RELEASE_DIRECTORY}/frontend/dist/index.html" \
    "${AG_FRONTEND_DIR}/index.html" \
    || RESTORE_FAILED=1
  restart_backend_and_verify_internal || RESTORE_FAILED=1
  start_nginx_and_verify_proxy || RESTORE_FAILED=1

  if [[ "${RESTORE_FAILED}" == "1" ]]; then
    log "CRITICAL: the starting release was not fully restored; inspect current link, frontend files, systemd, and nginx logs"
  fi
}

handle_activation_failure() {
  local exit_code="$1"
  restore_starting_state
  exit "${exit_code}"
}

prepare_rollback() {
  require_privileges
  acquire_deployment_lock
  [[ -n "${TARGET_RELEASE_ID}" ]] \
    || die "a release identifier is required; automatic selection could choose a staged but never-activated build"
  [[ -d "${RELEASES_DIRECTORY}" ]] || die "release directory is missing: ${RELEASES_DIRECTORY}"
  [[ -L "${CURRENT_LINK}" ]] || die "current release link is missing: ${CURRENT_LINK}"
  [[ -d "${AG_FRONTEND_DIR}" ]] || die "frontend directory is missing: ${AG_FRONTEND_DIR}"
  [[ ! -L "${AG_FRONTEND_DIR}" ]] || die "frontend directory must not be a symbolic link: ${AG_FRONTEND_DIR}"

  STARTING_RELEASE_DIRECTORY="$(readlink -f "${CURRENT_LINK}")"
  validate_release "${STARTING_RELEASE_DIRECTORY}"

  TARGET_RELEASE_DIRECTORY="$(resolve_release_directory "${TARGET_RELEASE_ID}")"
  validate_release "${TARGET_RELEASE_DIRECTORY}"
  [[ "${TARGET_RELEASE_DIRECTORY}" != "${STARTING_RELEASE_DIRECTORY}" ]] \
    || die "target release is already active: ${TARGET_RELEASE_ID}"
  assert_database_compatibility

  assert_owned_path "${NEXT_CURRENT_LINK}"
  assert_owned_path "${FRONTEND_STAGING_DIRECTORY}"
  assert_owned_path "${FRONTEND_BACKUP_DIRECTORY}"
  [[ ! -e "${FRONTEND_STAGING_DIRECTORY}" ]] \
    || die "frontend staging path already exists: ${FRONTEND_STAGING_DIRECTORY}"
  [[ ! -e "${FRONTEND_BACKUP_DIRECTORY}" ]] \
    || die "frontend backup path already exists: ${FRONTEND_BACKUP_DIRECTORY}"
}

activate_target_release() {
  log "staging frontend for ${TARGET_RELEASE_ID}"
  cp -a "${TARGET_RELEASE_DIRECTORY}/frontend/dist" "${FRONTEND_STAGING_DIRECTORY}"

  trap 'handle_activation_failure $?' ERR
  trap 'handle_activation_failure 130' INT TERM

  systemctl stop nginx.service
  FRONTEND_BACKED_UP=1
  mv "${AG_FRONTEND_DIR}" "${FRONTEND_BACKUP_DIRECTORY}"
  FRONTEND_ACTIVATED=1
  mv "${FRONTEND_STAGING_DIRECTORY}" "${AG_FRONTEND_DIR}"

  BACKEND_ACTIVATED=1
  ln -s "${TARGET_RELEASE_DIRECTORY}" "${NEXT_CURRENT_LINK}"
  mv -Tf "${NEXT_CURRENT_LINK}" "${CURRENT_LINK}"

  restart_backend_and_verify_internal
  start_nginx_and_verify_proxy
  cmp --silent \
    "${TARGET_RELEASE_DIRECTORY}/frontend/dist/index.html" \
    "${AG_FRONTEND_DIR}/index.html"

  trap - ERR INT TERM
  assert_owned_path "${FRONTEND_BACKUP_DIRECTORY}"
  rm -rf "${FRONTEND_BACKUP_DIRECTORY}"
  log "activated release ${TARGET_RELEASE_ID}; shared stores were not restored and may contain compatible startup writes"
}

main() {
  prepare_rollback
  activate_target_release
}

main "$@"
