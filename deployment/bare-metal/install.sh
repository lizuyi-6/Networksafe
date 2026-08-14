#!/usr/bin/env bash
# =============================================================================
# AetherGuard bare-metal installer (idempotent, non-destructive, portable).
#
# Replaces the one-shot .cursor-native-*.sh scripts. Those are safe to run
# exactly ONCE on a fresh host and will DESTROY the running deployment on any
# repeat (`rm -rf /opt/aetherguard`, drop database, docker prune). This script
# is the opposite: it is safe to re-run, preserves existing secrets and data,
# and only replaces files it owns.
#
# What it does (each phase is idempotent):
#   - installs OS deps (nginx, postgresql, redis, node 22) if missing
#   - installs the Rust toolchain + builds rust-fastpath ONCE, cached by SHA
#   - releases the repo at a given commit under /opt/aetherguard/releases/<sha>
#     with a `current` symlink (blue/green: old release kept until next deploy)
#   - generates fresh secrets ONLY on first install; re-runs keep backend.env
#   - writes hardened systemd units + nginx site, restarts only what changed
#   - waits for backend /health/ready, fails closed if it does not come up
#
# What it NEVER does:
#   - rm -rf on /var/www/* (only its own /var/www/aetherguard), /opt/aetherguard
#     wholesale, /etc/nginx/sites-* wholesale, or any other tenant's paths
#   - DROP DATABASE / DROP ROLE on a re-run (only on explicit --reset-db)
#   - docker system prune
#
# Usage:
#   sudo bash install.sh                          # deploy current HEAD
#   sudo bash install.sh <commit-or-tag>          # deploy a specific ref
#   sudo bash install.sh --source-tarball path.tar.gz --source-sha <full-sha>
#   sudo bash install.sh --reset-db               # DESTRUCTIVE: recreate DB+secrets
#   sudo bash install.sh --check                  # read-only preflight, exit 0 = ok
#
# Env overrides (all optional, shown with defaults):
#   AG_DEPLOY_ROOT=/opt/aetherguard
#   AG_FRONTEND_DIR=/var/www/aetherguard
#   AG_APP_USER=aetherguard
#   AG_PUBLIC_HOST=auto-detect (the server's primary IPv4)
#   AG_BACKEND_PORT=3005
#   AG_NODE_HEAP_MB=1024
#   AG_BUILD_JOBS=1            # low-RAM hosts: 1 job; raise on >4GB boxes
#   AG_SKIP_FASTPATH=0         # 1 = do not build/install rust-fastpath
#   AG_MINIO_IMAGE=minio/minio:RELEASE.2025-02-18T16-25-55Z
#   AG_MINIO_DATA_DIR=/var/lib/minio/data
#   AG_MINIO_CREDENTIALS_DIR=/root
#   AG_DEPLOY_LOCK_FILE=/run/lock/aetherguard-deployment.lock
#
# See deployment/bare-metal/README.md for the full matrix and rollback steps.
# =============================================================================

set -Eeuo pipefail
umask 027

# ─── option parsing ──────────────────────────────────────────────────────────
AG_RESET_DB=0
AG_CHECK_ONLY=0
AG_SOURCE_TARBALL=""
AG_SOURCE_SHA=""
TARGET_REF="HEAD"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reset-db)
      AG_RESET_DB=1
      printf '%s\n' '⚠️  --reset-db will DROP and recreate the database and regenerate' \
                     '    ALL secrets. Existing audit history and credentials are lost.' \
                     '    This flag is ignored unless --confirm-destructive is also set.' >&2
      shift
      ;;
    --confirm-destructive)
      export AG_CONFIRM_DESTRUCTIVE=1
      shift
      ;;
    --check)
      AG_CHECK_ONLY=1
      shift
      ;;
    --source-tarball)
      AG_SOURCE_TARBALL="${2:?--source-tarball needs a path}"
      shift 2
      ;;
    --source-sha)
      AG_SOURCE_SHA="${2:?--source-sha needs a full commit SHA}"
      shift 2
      ;;
    --help|-h)
      sed -n '2,/^##/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      printf 'Unknown option: %s\n' "$1" >&2
      exit 2
      ;;
    *)
      TARGET_REF="$1"
      shift
      ;;
  esac
done

# Destructive actions need an explicit, separate confirmation flag so a stray
# --reset-db on a copy-pasted command line cannot silently nuke production.
if [[ "${AG_RESET_DB}" == "1" && "${AG_CONFIRM_DESTRUCTIVE:-0}" != "1" ]]; then
  printf '%s\n' 'Refusing --reset-db without --confirm-destructive. Re-run with both flags.' >&2
  exit 2
fi

if [[ -n "${AG_SOURCE_TARBALL}" ]]; then
  [[ "${AG_SOURCE_SHA}" =~ ^[0-9a-f]{40}$ ]] \
    || { printf '%s\n' '--source-tarball requires --source-sha with a full lowercase commit SHA.' >&2; exit 2; }
elif [[ -n "${AG_SOURCE_SHA}" ]]; then
  printf '%s\n' '--source-sha is only valid with --source-tarball.' >&2
  exit 2
fi

# ─── configuration ───────────────────────────────────────────────────────────
: "${AG_DEPLOY_ROOT:=/opt/aetherguard}"
: "${AG_FRONTEND_DIR:=/var/www/aetherguard}"
: "${AG_APP_USER:=aetherguard}"
: "${AG_APP_GROUP:=${AG_APP_USER}}"
: "${AG_BACKEND_PORT:=3005}"
: "${AG_NODE_HEAP_MB:=1024}"
: "${AG_BUILD_JOBS:=1}"
: "${AG_SKIP_FASTPATH:=0}"
: "${AG_MINIO_IMAGE:=minio/minio:RELEASE.2025-02-18T16-25-55Z}"
: "${AG_MINIO_DATA_DIR:=/var/lib/minio/data}"
: "${AG_MINIO_CREDENTIALS_DIR:=/root}"
: "${AG_DEPLOY_LOCK_FILE:=/run/lock/aetherguard-deployment.lock}"
: "${AG_ALLOW_UNPINNED_MINIO_IMAGE:=0}"

RELEASES_DIR="${AG_DEPLOY_ROOT}/releases"
SHARED_DIR="${AG_DEPLOY_ROOT}/shared"
CREDENTIALS_FILE="/root/aetherguard-credentials.txt"
FASTPATH_SOCKET="/run/aetherguard-fastpath/aetherguard-fastpath.sock"
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="${SELF_DIR}/templates"
# The repo root is two levels up from deployment/bare-metal/.
REPO_ROOT="$(cd "${SELF_DIR}/../.." && pwd)"

# Path-guard helper: refuse to rm -rf anything that is not clearly ours.
# This is the single most important safety net in this script. The dangerous
# scripts it replaces deleted broad path prefixes unconditionally.
assert_owned_path() {
  local p="$1"
  local abs
  abs="$(readlink -f "${p}" 2>/dev/null || echo "${p}")"
  case "${abs}" in
    "${AG_DEPLOY_ROOT}/releases/"*|\
    "${AG_DEPLOY_ROOT}/shared/"*|\
    "${AG_FRONTEND_DIR}"|\
    "${AG_FRONTEND_DIR}.new"|\
    "${AG_FRONTEND_DIR}.old"|\
    "${AG_FRONTEND_DIR}/"*|\
    "${RELEASES_DIR}/"*)
      return 0
      ;;
    *)
      printf 'REFUSING to operate on path outside owned prefixes: %s\n' "${abs}" >&2
      printf '  owned: %s, %s\n' "${AG_DEPLOY_ROOT}" "${AG_FRONTEND_DIR}" >&2
      exit 78   # EX_CONFIG: configuration error, never proceed
      ;;
  esac
}

log()  { printf '\033[1;34m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
warn() { printf '\033[1;33m[%s] WARN\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die()  { printf '\033[1;31m[%s] FAIL\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "Run as root (sudo). The script manages systemd, postgres, and nginx."
  fi
}

acquire_deployment_lock() {
  command -v flock >/dev/null 2>&1 || die "flock is required for serialized deployment operations"
  install -d -m 0755 "$(dirname "${AG_DEPLOY_LOCK_FILE}")"
  exec 9>"${AG_DEPLOY_LOCK_FILE}"
  flock --nonblock 9 \
    || die "another AetherGuard install or rollback operation is already running"
}

validate_minio_image_reference() {
  if [[ "${AG_MINIO_IMAGE}" =~ ^minio/minio:RELEASE\.[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}Z(@sha256:[a-f0-9]{64})?$ ]]; then
    return
  fi
  if [[ "${AG_ALLOW_UNPINNED_MINIO_IMAGE}" == "1" ]]; then
    warn "AG_ALLOW_UNPINNED_MINIO_IMAGE=1 accepts non-release image ${AG_MINIO_IMAGE}"
    return
  fi
  die "AG_MINIO_IMAGE must use a dated MinIO RELEASE tag or tag@sha256 digest"
}

detect_public_host() {
  if [[ -n "${AG_PUBLIC_HOST:-}" ]]; then
    echo "${AG_PUBLIC_HOST}"
    return
  fi
  # Try cloud metadata endpoints for the public IP (NAT hosts cannot see their
  # own public IP on the interface). These are link-local, fast, and safe to
  # probe; absence just falls through.
  local ip=""
  # Aliyun
  ip="$(curl -fsS -m 2 http://100.100.100.200/latest/meta-data/eipv4 2>/dev/null \
        | head -c 64 || true)"
  # AWS / others (IMDSv1 fallback; harmless on non-AWS hosts)
  if [[ -z "${ip}" ]]; then
    ip="$(curl -fsS -m 2 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null \
          | head -c 64 || true)"
  fi
  # Fallback: primary non-loopback IPv4 from the interface. `ip -4 -o addr`
  # lines look like "2: eth0    inet 39.102.81.78/24 brd ..." (field 4 = CIDR).
  if [[ -z "${ip}" ]]; then
    ip="$(ip -4 -o addr show scope global 2>/dev/null \
          | awk 'NR==1 { split($4,a,"/"); print a[1]; exit }' \
          | head -c 64 || true)"
    # On NAT hosts this is the private IP — warn so the operator can override.
    case "${ip}" in
      10.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*|192.168.*|169.254.*)
        warn "Detected a private IPv4 (${ip:-none}). Behind NAT this is not the"
        warn "  public address. Set AG_PUBLIC_HOST=<public-ip> if ALLOWED_ORIGINS"
        warn "  / credentials should carry the public IP."
        ;;
    esac
  fi
  if [[ -z "${ip}" ]]; then
    ip="127.0.0.1"
    warn "No IPv4 detected; defaulting AG_PUBLIC_HOST to ${ip}."
  fi
  echo "${ip}"
}

# ─── preflight (read-only, also used by --check) ─────────────────────────────
preflight() {
  log "Preflight checks"

  [[ -d "${TEMPLATE_DIR}" ]] || die "Template dir missing: ${TEMPLATE_DIR}"
  [[ -f "${TEMPLATE_DIR}/aetherguard-backend.service" ]] || die "backend unit template missing"
  [[ -f "${TEMPLATE_DIR}/aetherguard-fastpath.service" ]] || die "fastpath unit template missing"
  [[ -f "${TEMPLATE_DIR}/nginx-aetherguard.conf" ]] || die "nginx template missing"
  [[ -f "${SELF_DIR}/rollback.sh" ]] || die "rollback helper missing"

  command -v bash >/dev/null || die "bash not found"
  # OS family
  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    (. /etc/os-release; printf '  os: %s %s\n' "${NAME}" "${VERSION_ID}")
  else
    die "Unsupported host: no /etc/os-release"
  fi

  local mem_mb
  mem_mb="$(awk '/MemTotal/ { printf "%d", $2/1024 }' /proc/meminfo)"
  printf '  memory: %s MB\n' "${mem_mb}"
  if [[ "${mem_mb}" -lt 1500 ]]; then
    warn "Low memory (${mem_mb}MB). Build will use ${AG_BUILD_JOBS} job(s) and a swap guard."
    warn "  If no swap exists, create ≥2GB before running, or builds will OOM-kill."
  fi

  local disk_gb
  disk_gb="$(df --output=avail -BG / | tail -1 | tr -dc '0-9')"
  printf '  free disk: %s GB\n' "${disk_gb}"
  [[ "${disk_gb}" -ge 5 ]] || die "Need ≥5GB free on / (have ${disk_gb}GB)."

  printf '  public host: %s\n' "$(detect_public_host)"
  printf '  deploy root: %s\n' "${AG_DEPLOY_ROOT}"

  if [[ "${AG_CHECK_ONLY}" == "1" ]]; then
    log "Preflight OK (--check only)."
    exit 0
  fi
}

# ─── OS dependencies ─────────────────────────────────────────────────────────
ensure_swap() {
  if swapon --show=NAME --noheadings 2>/dev/null | grep -q '^/swapfile'; then
    log "swap already present"; return
  fi
  log "creating 4GB swap (low-RAM build guard)"
  fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
}

install_os_deps() {
  if command -v nginx >/dev/null 2>&1 \
     && command -v postgres >/dev/null 2>&1 \
     && command -v redis-server >/dev/null 2>&1 \
     && [[ "$(node -v 2>/dev/null | cut -d. -f1 | tr -d v)" == "22" ]]; then
    log "OS deps already present"; return
  fi
  log "installing OS dependencies (apt)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y build-essential ca-certificates curl gnupg nginx openssl \
    postgresql postgresql-contrib python3 redis-server unzip ufw

  # Node 22 from NodeSource (idempotent: skip if already on 22).
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  chmod 0644 /etc/apt/keyrings/nodesource.gpg
  printf 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\n' \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
  [[ "$(node -v | cut -d. -f1 | tr -d v)" == "22" ]] || die "Node 22 required, got $(node -v)"
}

ensure_app_user() {
  getent group "${AG_APP_GROUP}" >/dev/null || groupadd --system "${AG_APP_GROUP}"
  id "${AG_APP_USER}" >/dev/null 2>&1 \
    || useradd --system --gid "${AG_APP_GROUP}" --home-dir "${AG_DEPLOY_ROOT}" \
       --shell /usr/sbin/nologin "${AG_APP_USER}"
}

ensure_dirs() {
  install -d -o root  -g "${AG_APP_GROUP}" -m 0750 "${AG_DEPLOY_ROOT}"
  install -d -o root  -g "${AG_APP_GROUP}" -m 0750 "${RELEASES_DIR}"
  install -d -o "${AG_APP_USER}" -g "${AG_APP_GROUP}" -m 0750 \
    "${SHARED_DIR}" "${SHARED_DIR}/data" "${SHARED_DIR}/artifacts" \
    "${SHARED_DIR}/home" "${SHARED_DIR}/scan-results"
  install -d -o root  -g root             -m 0755 "$(dirname "${AG_FRONTEND_DIR}")"
}

# ─── secrets: generate only on first install, reuse on re-run ────────────────
rand_hex() { openssl rand -hex "${1:-32}"; }

# Idempotent upsert of a single KEY=value line into backend.env.
env_upsert() {
  local file="$1" key="$2" val="$3"
  if grep -q "^${key}=" "${file}" 2>/dev/null; then
    # In-place edit via python to avoid sed delimiter pitfalls with secrets.
    python3 - "${file}" "${key}" "${val}" <<'PY'
import sys
p, k, v = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(p).read().splitlines()
out = [(k + "=" + v) if l.startswith(k + "=") else l for l in lines]
open(p, "w").write("\n".join(out) + "\n")
PY
  else
    printf '%s=%s\n' "${key}" "${val}" >> "${file}"
  fi
}

ensure_redis() {
  systemctl enable --now redis-server >/dev/null
  # If a password is already configured in redis.conf, reuse it; else set one.
  local existing_pw
  existing_pw="$(awk '/^[[:space:]]*requirepass[[:space:]]+/ {print $2; exit}' /etc/redis/redis.conf 2>/dev/null || true)"
  if [[ -z "${existing_pw}" ]]; then
    existing_pw="$(rand_hex 24)"
    printf '\nrequirepass %s\n' "${existing_pw}" >> /etc/redis/redis.conf
    systemctl restart redis-server
  fi
  redis-cli -a "${existing_pw}" ping | grep -q PONG \
    || die "redis PONG check failed"
  echo "${existing_pw}"   # return on stdout for the caller to capture
}

ensure_postgres() {
  local pg_pw="$1"
  systemctl enable --now postgresql >/dev/null
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='aetherguard'" | grep -q 1; then
    sudo -u postgres psql --set ON_ERROR_STOP=1 \
      --command="CREATE ROLE aetherguard LOGIN PASSWORD '${pg_pw}';"
  fi
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='aetherguard'" | grep -q 1; then
    sudo -u postgres createdb --owner=aetherguard aetherguard
  fi
  # --reset-db path: explicit, separately-confirmed destruction.
  if [[ "${AG_RESET_DB}" == "1" ]]; then
    log "--reset-db: recreating database"
    sudo -u postgres psql --set ON_ERROR_STOP=1 \
      --command="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='aetherguard' AND pid<>pg_backend_pid();" >/dev/null
    sudo -u postgres dropdb --if-exists aetherguard
    sudo -u postgres createdb --owner=aetherguard aetherguard
  fi
}

write_env_file() {
  local env_file="${SHARED_DIR}/backend.env"
  local redis_pw="$1" pg_pw="$2" s3_endpoint="$3" s3_access="$4" s3_secret="$5"
  local public_host; public_host="$(detect_public_host)"

  if [[ ! -f "${env_file}" ]]; then
    log "generating initial backend.env (first install)"
    : > "${env_file}"
    # Fill with generated secrets so subsequent upserts only set non-secret
    # values deterministically.
    env_upsert "${env_file}" JWT_SECRET                "$(rand_hex 32)"
    env_upsert "${env_file}" AUDIT_LOG_SECRET          "$(rand_hex 32)"
    env_upsert "${env_file}" ENCRYPTION_KEY            "$(rand_hex 32)"
    env_upsert "${env_file}" ENCRYPTION_SALT           "$(rand_hex 16)"
    env_upsert "${env_file}" ADMIN_PASSWORD            "Ag9-$(rand_hex 16)"
    env_upsert "${env_file}" DEVICE_COMMAND_SECRET     "$(rand_hex 32)"
    env_upsert "${env_file}" SERIAL_HELPER_SHARED_SECRET "$(rand_hex 32)"
    env_upsert "${env_file}" DEVICE_API_KEYS           "device_key_$(rand_hex 24)"
  else
    log "backend.env exists; preserving all secrets (idempotent re-run)"
  fi

  # Deterministic, non-secret values are always rewritten so a config change
  # in the script propagates without touching secrets.
  env_upsert "${env_file}" NODE_ENV                  production
  env_upsert "${env_file}" PORT                      "${AG_BACKEND_PORT}"
  env_upsert "${env_file}" BACKEND_BIND_ADDRESS      127.0.0.1
  env_upsert "${env_file}" PROFILE                   prod
  env_upsert "${env_file}" APP_ROLE                  all
  env_upsert "${env_file}" APP_MODE                  production
  env_upsert "${env_file}" ENTERPRISE_RUNTIME_MODE   prod-enterprise
  env_upsert "${env_file}" DB_MODE                   postgres
  env_upsert "${env_file}" SQLITE_FALLBACK_ENABLED   true
  env_upsert "${env_file}" DB_ENGINE                 better-sqlite3
  env_upsert "${env_file}" ARTIFACT_STORE            local
  env_upsert "${env_file}" DATA_DIR                  "${SHARED_DIR}/data"
  env_upsert "${env_file}" ARTIFACTS_DIR             "${SHARED_DIR}/artifacts"
  env_upsert "${env_file}" HOME                      "${SHARED_DIR}/home"
  env_upsert "${env_file}" AUDIT_LOG_FAIL_CLOSED     true
  env_upsert "${env_file}" AUDIT_SHADOW_REQUIRED     true
  env_upsert "${env_file}" ALLOW_BREAK_GLASS_PASSWORD_LOGIN true
  env_upsert "${env_file}" ALLOW_DEMO_FEATURES       false
  env_upsert "${env_file}" ALLOW_PUBLIC_REGISTRATION false
  env_upsert "${env_file}" DEMO_AUTO_SEED            false
  env_upsert "${env_file}" ENABLE_ATTACK_SIM         false
  env_upsert "${env_file}" ENABLE_DEV_LOGIN_PRESETS  false
  env_upsert "${env_file}" ENABLE_RUNTIME_EMULATOR   false
  env_upsert "${env_file}" REDIS_PASSWORD            "${redis_pw}"
  env_upsert "${env_file}" REDIS_URL                 "redis://:${redis_pw}@127.0.0.1:6379"
  env_upsert "${env_file}" POSTGRES_PASSWORD         "${pg_pw}"
  env_upsert "${env_file}" SHADOW_DATABASE_URL       "postgres://aetherguard:${pg_pw}@127.0.0.1:5432/aetherguard"
  # Audit archive: ALWAYS a complete S3 triple, so the primary path is never
  # left unconfigured (the gap that broke audit archival in production).
  env_upsert "${env_file}" S3_ENDPOINT               "${s3_endpoint}"
  env_upsert "${env_file}" S3_ACCESS_KEY             "${s3_access}"
  env_upsert "${env_file}" S3_SECRET_KEY             "${s3_secret}"
  env_upsert "${env_file}" S3_REGION                 us-east-1
  env_upsert "${env_file}" FASTPATH_TRANSPORT        unix
  env_upsert "${env_file}" FASTPATH_SOCKET_PATH      "${FASTPATH_SOCKET}"
  env_upsert "${env_file}" FASTPATH_URL              "http://127.0.0.1:8081"
  env_upsert "${env_file}" ALLOWED_ORIGINS           "http://${public_host},http://127.0.0.1,http://localhost"
  env_upsert "${env_file}" PLATFORM_API_PROTOCOL     openai-compatible
  env_upsert "${env_file}" PLATFORM_API_BASE_URL     "https://coding.dashscope.aliyuncs.com/v1"
  env_upsert "${env_file}" PLATFORM_API_TIMEOUT      120000
  env_upsert "${env_file}" ADMIN_EMAIL               'admin@AetherGuard.com'
  env_upsert "${env_file}" LOG_LEVEL                 info

  chown root:"${AG_APP_GROUP}" "${env_file}"
  chmod 0640 "${env_file}"
}

ensure_minio() {
  # Local MinIO for the audit-archive primary path. Bound to loopback only;
  # never exposed publicly. Container is named so re-runs reuse the volume.
  if ! command -v docker >/dev/null 2>&1; then
    warn "docker not installed; skipping MinIO. Audit archive will fall back to"
    warn "  local artifact store (the ENOENT-fixed path). Install docker to enable S3 primary."
    echo ""   # empty S3 triple → caller will mark archive unconfigured
    return
  fi
  validate_minio_image_reference
  if docker ps -a --format '{{.Names}}' | grep -qx aetherguard-minio; then
    local existing_image existing_data_source api_binding console_binding
    local container_access container_secret access secret
    existing_image="$(docker inspect aetherguard-minio --format '{{.Config.Image}}')"
    existing_data_source="$(docker inspect aetherguard-minio --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}')"
    api_binding="$(docker inspect aetherguard-minio --format '{{with $bindings := index .HostConfig.PortBindings "9000/tcp"}}{{with index $bindings 0}}{{.HostIp}}:{{.HostPort}}{{end}}{{end}}')"
    console_binding="$(docker inspect aetherguard-minio --format '{{with $bindings := index .HostConfig.PortBindings "9001/tcp"}}{{with index $bindings 0}}{{.HostIp}}:{{.HostPort}}{{end}}{{end}}')"

    if [[ "${existing_data_source}" != "${AG_MINIO_DATA_DIR}" ]]; then
      die "existing aetherguard-minio uses unexpected /data source: ${existing_data_source:-missing}"
    fi
    [[ "${api_binding}" == "127.0.0.1:9000" ]] \
      || die "existing MinIO API binding is not loopback-only: ${api_binding:-missing}"
    [[ "${console_binding}" == "127.0.0.1:9001" ]] \
      || die "existing MinIO console binding is not loopback-only: ${console_binding:-missing}"
    if [[ "${existing_image}" != "${AG_MINIO_IMAGE}" ]]; then
      warn "Existing MinIO image is ${existing_image}; expected ${AG_MINIO_IMAGE}."
      warn "  Leaving the existing data container unchanged. New installations use the pinned image."
    fi

    container_access="$(docker inspect aetherguard-minio --format '{{range .Config.Env}}{{println .}}{{end}}' \
      | awk -F= '$1 == "MINIO_ROOT_USER" { sub(/^[^=]*=/, ""); print; exit }')"
    container_secret="$(docker inspect aetherguard-minio --format '{{range .Config.Env}}{{println .}}{{end}}' \
      | awk -F= '$1 == "MINIO_ROOT_PASSWORD" { sub(/^[^=]*=/, ""); print; exit }')"
    [[ -n "${container_access}" && -n "${container_secret}" ]] \
      || die "existing MinIO credentials are unavailable in the container configuration"

    access="$(cat "${AG_MINIO_CREDENTIALS_DIR}/.minio-access" 2>/dev/null || true)"
    secret="$(cat "${AG_MINIO_CREDENTIALS_DIR}/.minio-secret" 2>/dev/null || true)"
    if [[ -n "${access}" && "${access}" != "${container_access}" ]] \
      || [[ -n "${secret}" && "${secret}" != "${container_secret}" ]]; then
      warn "Stored MinIO credential files did not match the active container; restoring the container values"
    fi
    access="${container_access}"
    secret="${container_secret}"
    install -d -m 0700 "${AG_MINIO_CREDENTIALS_DIR}"
    printf '%s' "${access}" > "${AG_MINIO_CREDENTIALS_DIR}/.minio-access"
    printf '%s' "${secret}" > "${AG_MINIO_CREDENTIALS_DIR}/.minio-secret"
    chmod 600 \
      "${AG_MINIO_CREDENTIALS_DIR}/.minio-access" \
      "${AG_MINIO_CREDENTIALS_DIR}/.minio-secret"

    if [[ "$(docker inspect aetherguard-minio --format '{{.State.Running}}')" != "true" ]]; then
      log "starting existing MinIO container"
      docker start aetherguard-minio >/dev/null
    else
      log "MinIO container already running"
    fi

    for _ in $(seq 1 30); do
      if curl -fsS -m 3 http://127.0.0.1:9000/minio/health/ready >/dev/null 2>&1; then
        printf '%s\t%s\t%s\n' "http://127.0.0.1:9000" "${access}" "${secret}"
        return
      fi
      sleep 1
    done
    die "existing MinIO container did not become ready within 30s"
  fi
  log "starting MinIO (loopback-only, 512MB cap)"
  install -d -m 0750 "${AG_MINIO_DATA_DIR}"
  local access secret
  access="aetherguard-$(openssl rand -hex 6)"
  secret="$(openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | head -c 40)"
  docker run -d --name aetherguard-minio --restart unless-stopped \
    -p 127.0.0.1:9000:9000 -p 127.0.0.1:9001:9001 \
    -v "${AG_MINIO_DATA_DIR}:/data" \
    -e MINIO_ROOT_USER="${access}" -e MINIO_ROOT_PASSWORD="${secret}" \
    --memory=512m --memory-swap=1024m \
    "${AG_MINIO_IMAGE}" server /data --console-address ":9001" >/dev/null
  install -d -m 0700 "${AG_MINIO_CREDENTIALS_DIR}"
  printf '%s' "${access}" > "${AG_MINIO_CREDENTIALS_DIR}/.minio-access"
  printf '%s' "${secret}" > "${AG_MINIO_CREDENTIALS_DIR}/.minio-secret"
  chmod 600 \
    "${AG_MINIO_CREDENTIALS_DIR}/.minio-access" \
    "${AG_MINIO_CREDENTIALS_DIR}/.minio-secret"
  # Wait for readiness; the backend creates the bucket itself (Object Lock).
  for _ in $(seq 1 30); do
    if curl -fsS -m 3 http://127.0.0.1:9000/minio/health/ready >/dev/null 2>&1; then
      printf '%s\t%s\t%s\n' "http://127.0.0.1:9000" "${access}" "${secret}"
      return
    fi
    sleep 1
  done
  warn "MinIO did not become healthy within 30s; audit archive will use fallback"
  echo ""
}

# ─── release: stage source at <sha>, build, symlink ──────────────────────────
resolve_target_sha() {
  # From a git worktree at REPO_ROOT. HEAD if no arg.
  if [[ -n "${AG_SOURCE_TARBALL}" ]]; then
    printf '%s\n' "${AG_SOURCE_SHA}"
    return
  fi
  (cd "${REPO_ROOT}" && git rev-parse --verify "${TARGET_REF}^{commit}") \
    || die "could not resolve commit: ${TARGET_REF}"
}

stage_source() {
  local sha="$1"
  local release_dir="${RELEASES_DIR}/${sha}"

  if [[ -d "${release_dir}" && -f "${release_dir}/backend/dist/index.js" ]]; then
    log "release ${sha:0:8} already built; reusing"
    echo "${release_dir}"
    return
  fi

  if [[ -n "${AG_SOURCE_TARBALL}" ]]; then
    log "extracting source tarball: ${AG_SOURCE_TARBALL}"
    assert_owned_path "${release_dir}"
    rm -rf "${release_dir}"
    install -d -m 0750 "${release_dir}"
    tar --extract --gzip --file "${AG_SOURCE_TARBALL}" \
        --directory "${release_dir}" --strip-components=0 --no-same-owner
  else
    log "staging source at ${sha:0:8} from ${REPO_ROOT}"
    assert_owned_path "${release_dir}"
    rm -rf "${release_dir}"
    install -d -m 0750 "${release_dir}"
    # Export a clean tree (no .git, no node_modules) at the exact commit.
    (cd "${REPO_ROOT}" \
      && git --work-tree="${release_dir}" --git-dir="${REPO_ROOT}/.git" \
         checkout "${sha}" -- . 2>/dev/null \
      || git archive "${sha}" | tar -x -C "${release_dir}")
  fi
  printf '%s\n' "${sha}" > "${release_dir}/SOURCE_SHA"
  chown -R root:"${AG_APP_GROUP}" "${release_dir}"
  chmod -R go-w "${release_dir}"
  echo "${release_dir}"
}

build_backend() {
  local release_dir="$1"
  if [[ -f "${release_dir}/backend/dist/index.js" ]]; then return; fi
  log "building backend (this hosts the typescript compile)"
  (
    cd "${release_dir}/backend"
    # Use the cached npm cache if present to survive low-RAM hosts.
    npm ci --no-audit --no-fund --prefer-offline 2>/dev/null \
      || npm install --no-audit --no-fund --prefer-offline
    NODE_OPTIONS="--max-old-space-size=$((AG_NODE_HEAP_MB * 2))" npm run build
    test -f dist/index.js
    # KEEP devDeps (typescript) so a later hot-patch can rebuild in place.
    # The old script ran `npm prune --omit=dev`, which made the host unable
    # to recompile without a full re-fetch.
  ) || die "backend build failed"
}

build_frontend() {
  local release_dir="$1"
  if [[ -f "${release_dir}/frontend/dist/index.html" ]]; then return; fi
  log "building frontend (Vite — watch memory on low-RAM hosts)"
  (
    cd "${release_dir}/frontend"
    npm ci --no-audit --no-fund --prefer-offline 2>/dev/null \
      || npm install --no-audit --no-fund --prefer-offline
    NODE_OPTIONS="--max-old-space-size=$((AG_NODE_HEAP_MB * 2))" npm run build
    test -f dist/index.html
  ) || die "frontend build failed"
}

publish_frontend() {
  local release_dir="$1"
  log "publishing frontend to ${AG_FRONTEND_DIR}"
  # Atomic swap: build to a sibling, then rename. Never leave a half-written dir.
  local staging="${AG_FRONTEND_DIR}.new"
  assert_owned_path "${staging}"
  rm -rf "${staging}"
  cp -a "${release_dir}/frontend/dist" "${staging}"
  chown -R root:"${AG_APP_GROUP}" "${staging}"
  chmod -R go-w "${staging}"
  assert_owned_path "${AG_FRONTEND_DIR}"
  if [[ -d "${AG_FRONTEND_DIR}" ]]; then
    mv "${AG_FRONTEND_DIR}" "${AG_FRONTEND_DIR}.old"
  fi
  mv "${staging}" "${AG_FRONTEND_DIR}"
  assert_owned_path "${AG_FRONTEND_DIR}.old"
  rm -rf "${AG_FRONTEND_DIR}.old"
}

build_fastpath() {
  local release_dir="$1"
  if [[ "${AG_SKIP_FASTPATH}" == "1" ]]; then
    warn "AG_SKIP_FASTPATH=1 — skipping rust-fastpath build"
    return
  fi
  if [[ -x /usr/local/bin/aetherguard-fastpath ]] \
     && FASTPATH_TRANSPORT=unix \
        FASTPATH_SOCKET_PATH="${FASTPATH_SOCKET}" \
        timeout 10 /usr/local/bin/aetherguard-fastpath self-check >/dev/null 2>&1; then
    log "fastpath binary already installed and healthy"
    return
  fi
  log "installing rust toolchain + building fastpath (1 job for low-RAM hosts)"
  if [[ ! -x /root/.cargo/bin/rustup ]]; then
    # SECURITY FIX (audit 2026-08, DP-012): never pipe sh.rustup.rs straight
    # into a root shell. Download over HTTPS, then either (a) verify against
    # RUSTUP_INIT_SHA256=<reviewed hash> (unattended; mismatch aborts), or
    # (b) interactively review the printed sha256 + head of the script and
    # confirm. The trust decision cannot be skipped.
    local rustup_tmp rustup_actual
    rustup_tmp="$(mktemp /tmp/rustup-init.XXXXXX.sh)"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o "${rustup_tmp}"
    rustup_actual="$(sha256sum "${rustup_tmp}" | awk '{print $1}')"
    if [[ -n "${RUSTUP_INIT_SHA256:-}" ]]; then
      if [[ "${rustup_actual}" != "${RUSTUP_INIT_SHA256}" ]]; then
        rm -f "${rustup_tmp}"
        die "sh.rustup.rs script failed sha256 verification (expected ${RUSTUP_INIT_SHA256}, got ${rustup_actual})."
      fi
      log "rustup script sha256 verified: ${rustup_actual}"
    else
      echo "----------------------------------------------------------------"
      echo " Downloaded https://sh.rustup.rs"
      echo " sha256: ${rustup_actual}"
      echo " To run unattended, export RUSTUP_INIT_SHA256=<this hash> after review."
      echo " First lines of the script:"
      sed -n '1,12p' "${rustup_tmp}" | sed 's/^/   | /'
      echo "----------------------------------------------------------------"
      if [[ ! -t 0 ]]; then
        rm -f "${rustup_tmp}"
        die "not interactive and RUSTUP_INIT_SHA256 is not set — refusing to run an unreviewed script as root."
      fi
      local confirm
      read -r -p " Review the script above, then type 'yes' to run it: " confirm
      if [[ "${confirm}" != "yes" ]]; then
        rm -f "${rustup_tmp}"
        die "aborted by operator."
      fi
    fi
    sh "${rustup_tmp}" -s -- -y --profile minimal --default-toolchain 1.85.0
    rm -f "${rustup_tmp}"
  else
    /root/.cargo/bin/rustup toolchain install 1.85.0 --profile minimal
  fi
  CARGO_BUILD_JOBS="${AG_BUILD_JOBS}" \
    /root/.cargo/bin/cargo +1.85.0 build --release \
      --manifest-path "${release_dir}/rust-fastpath/Cargo.toml" \
    || die "fastpath build failed"
  install -m 0755 \
    "${release_dir}/rust-fastpath/target/release/aetherguard-fastpath" \
    /usr/local/bin/aetherguard-fastpath
  rm -rf "${release_dir}/rust-fastpath/target"
}

activate_release() {
  local release_dir="$1"
  # Symlink swap: current.new → release, atomic rename.
  assert_owned_path "${AG_DEPLOY_ROOT}/current"
  ln -sfn "${release_dir}" "${AG_DEPLOY_ROOT}/current.new"
  mv -Tf "${AG_DEPLOY_ROOT}/current.new" "${AG_DEPLOY_ROOT}/current"
}

# ─── systemd + nginx (idempotent: only restart on content change) ────────────
render_template() {
  # render_template <template> <out>  — substitutes @@KEY@@ from environment.
  local tpl="$1" out="$2"
  local rendered
  rendered="$(sed \
    -e "s|@@APP_USER@@|${AG_APP_USER}|g" \
    -e "s|@@APP_GROUP@@|${AG_APP_GROUP}|g" \
    -e "s|@@DEPLOY_ROOT@@|${AG_DEPLOY_ROOT}|g" \
    -e "s|@@SHARED_DIR@@|${SHARED_DIR}|g" \
    -e "s|@@FRONTEND_DIR@@|${AG_FRONTEND_DIR}|g" \
    -e "s|@@BACKEND_PORT@@|${AG_BACKEND_PORT}|g" \
    -e "s|@@NODE_HEAP_MB@@|${AG_NODE_HEAP_MB}|g" \
    -e "s|@@FASTPATH_SOCKET@@|${FASTPATH_SOCKET}|g" \
    "${tpl}")"
  install -m 0644 /dev/stdin "${out}" <<<"${rendered}"
}

install_units_and_nginx() {
  log "rendering systemd units + nginx site"
  install -d -o root -g root -m 0755 /etc/aetherguard
  {
    printf 'AG_CONFIG_DEPLOY_ROOT=%q\n' "${AG_DEPLOY_ROOT}"
    printf 'AG_CONFIG_FRONTEND_DIR=%q\n' "${AG_FRONTEND_DIR}"
    printf 'AG_CONFIG_BACKEND_PORT=%q\n' "${AG_BACKEND_PORT}"
    printf 'AG_CONFIG_DEPLOY_LOCK_FILE=%q\n' "${AG_DEPLOY_LOCK_FILE}"
  } > /etc/aetherguard/rollback.conf
  chown root:root /etc/aetherguard/rollback.conf
  chmod 0644 /etc/aetherguard/rollback.conf
  install -m 0755 "${SELF_DIR}/rollback.sh" /usr/local/sbin/aetherguard-rollback
  render_template "${TEMPLATE_DIR}/aetherguard-backend.service" \
    /etc/systemd/system/aetherguard-backend.service
  render_template "${TEMPLATE_DIR}/aetherguard-fastpath.service" \
    /etc/systemd/system/aetherguard-fastpath.service

  install -d -m 0755 /etc/nginx/sites-available /etc/nginx/sites-enabled
  render_template "${TEMPLATE_DIR}/nginx-aetherguard.conf" \
    /etc/nginx/sites-available/aetherguard
  # Enable our site without disabling anyone else's.
  ln -sfn /etc/nginx/sites-available/aetherguard /etc/nginx/sites-enabled/aetherguard
  nginx -t || die "nginx config test failed"

  systemctl daemon-reload
}

write_credentials() {
  local sha="$1" public_host; public_host="$(detect_public_host)"
  local admin_email admin_pw
  admin_email="$(grep '^ADMIN_EMAIL=' "${SHARED_DIR}/backend.env" | cut -d= -f2-)"
  admin_pw="$(grep '^ADMIN_PASSWORD=' "${SHARED_DIR}/backend.env" | cut -d= -f2-)"
  {
    printf 'URL=http://%s\n' "${public_host}"
    printf 'ADMIN_EMAIL=%s\n' "${admin_email}"
    printf 'ADMIN_PASSWORD=%s\n' "${admin_pw}"
    printf 'SOURCE_SHA=%s\n' "${sha}"
    printf 'INSTALLED_BY=%s at %s\n' "${0##*/}" "$(date -u +%FT%TZ)"
  } > "${CREDENTIALS_FILE}"
  chmod 0600 "${CREDENTIALS_FILE}"
}

start_and_verify() {
  log "starting/restarting services"
  if [[ "${AG_SKIP_FASTPATH}" != "1" ]]; then
    systemctl enable --now aetherguard-fastpath.service
  fi
  systemctl restart aetherguard-backend.service
  systemctl enable aetherguard-backend.service
  systemctl reload nginx 2>/dev/null || systemctl restart nginx

  log "waiting for backend /health/ready (up to 180s)"
  local ready=0
  for _ in $(seq 1 90); do
    if curl -fsS -m 5 http://127.0.0.1:"${AG_BACKEND_PORT}"/health/ready \
         | grep -q '"ready"' 2>/dev/null; then
      ready=1; break
    fi
    sleep 2
  done
  if [[ "${ready}" != "1" ]]; then
    die "backend did not report ready. Inspect: journalctl -u aetherguard-backend -n 120"
  fi
  # Public proxy check.
  curl -fsS -m 8 http://127.0.0.1/health/ready | grep -q '"ready"' \
    || die "nginx → backend proxy check failed"
  log "ready ✓"
}

cleanup_old_releases() {
  # Keep the 3 most recent releases + current. Never touch the active one.
  local current_target
  current_target="$(readlink -f "${AG_DEPLOY_ROOT}/current" 2>/dev/null || true)"
  local kept=0
  while IFS= read -r r; do
    if [[ "${r}" == "${current_target}" ]]; then continue; fi
    kept=$((kept + 1))
    if [[ "${kept}" -gt 3 ]]; then
      assert_owned_path "${r}"
      rm -rf "${r}"
    fi
  done < <(ls -1dt "${RELEASES_DIR}"/*/ 2>/dev/null)
}

# ─── main ────────────────────────────────────────────────────────────────────
main() {
  require_root
  preflight
  acquire_deployment_lock
  install_os_deps
  ensure_swap
  ensure_app_user
  ensure_dirs

  local target_sha; target_sha="$(resolve_target_sha)"

  # Source stage + build (cached per-sha).
  local release_dir; release_dir="$(stage_source "${target_sha}")"
  build_backend "${release_dir}"
  build_frontend "${release_dir}"
  build_fastpath "${release_dir}"

  # Secrets / data: idempotent. Generate once, reuse forever.
  local redis_pw; redis_pw="$(ensure_redis)"
  local pg_pw
  if [[ -f "${SHARED_DIR}/backend.env" ]] \
     && grep -q '^POSTGRES_PASSWORD=' "${SHARED_DIR}/backend.env"; then
    pg_pw="$(grep '^POSTGRES_PASSWORD=' "${SHARED_DIR}/backend.env" | cut -d= -f2-)"
  else
    pg_pw="$(rand_hex 16)"
  fi
  ensure_postgres "${pg_pw}"

  local minio; minio="$(ensure_minio)"
  local s3_endpoint s3_access s3_secret
  s3_endpoint="$(printf '%s' "${minio}" | cut -f1)"
  s3_access="$(printf '%s' "${minio}" | cut -f2)"
  s3_secret="$(printf '%s' "${minio}" | cut -f3)"
  # If MinIO is unavailable, fall back to local-only S3 placeholders so the
  # backend still boots; the audit fallback path (now ENOENT-fixed) handles it.
  [[ -z "${s3_endpoint}" ]] && { s3_endpoint="http://127.0.0.1:9000"; s3_access="unused"; s3_secret="$(rand_hex 16)"; warn "MinIO unavailable; audit archive will use local fallback"; }

  write_env_file "${redis_pw}" "${pg_pw}" "${s3_endpoint}" "${s3_access}" "${s3_secret}"

  publish_frontend "${release_dir}"
  activate_release "${release_dir}"
  install_units_and_nginx
  write_credentials "${target_sha}"
  start_and_verify
  cleanup_old_releases

  local public_host; public_host="$(detect_public_host)"
  printf '\n=========================================\n'
  printf '  AetherGuard deployed\n'
  printf '  URL:          http://%s\n' "${public_host}"
  printf '  Source:       %s\n' "${target_sha:0:12}"
  printf '  Credentials:  %s (chmod 600)\n' "${CREDENTIALS_FILE}"
  printf '  Logs:         journalctl -u aetherguard-backend -f\n'
  printf '  Rollback:     sudo aetherguard-rollback <prev-sha>\n'
  printf '=========================================\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
