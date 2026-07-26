#!/bin/bash
# =============================================================================
# AetherGuard OFFLINE (air-gapped) installer — runs on the customer host.
#
# Zero network access required. Dependencies: bash + coreutils (sha256sum, od,
# sed, grep, tar). Docker is installed from the bundled static payload when the
# bundle was built with --include-docker; otherwise the host must already have
# Docker Engine + Compose v2.24+.
#
# Usage (from the extracted bundle directory, as root):
#   sudo bash install.sh [--origin http://<operator-host>:8080] [--skip-verify]
#
# What it does:
#   1. Verifies SHA256SUMS (USB/transfer integrity)
#   2. Ensures Docker Engine + Compose v2 (installs bundled static build if absent)
#   3. docker load images/images.tar
#   4. Generates .env with random secrets (openssl if present, /dev/urandom fallback)
#   5. docker compose up -d --no-build  (never builds, never pulls)
#   6. Waits for backend container health and prints access info
#
# Secret-generation key list mirrors deployment/production/setup-env.sh and
# scripts/setup.mjs (GENERATED_KEYS) — keep the three in sync.
# =============================================================================

set -euo pipefail

BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${BUNDLE_DIR}"

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; BOLD='\033[1m'; RESET='\033[0m'
say()  { echo -e "$@"; }
ok()   { say "${GREEN}[OK]${RESET} $*"; }
warn() { say "${YELLOW}[WARN]${RESET} $*"; }
fail() { say "${RED}[ERROR]${RESET} $*" >&2; exit 1; }

EXTRA_ORIGIN=""
SKIP_VERIFY=0
ENV_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --origin)      EXTRA_ORIGIN="${2:-}"; shift 2 ;;
    --skip-verify) SKIP_VERIFY=1; shift ;;
    --env-only)    ENV_ONLY=1; shift ;;
    *) fail "unknown option: $1 (supported: --origin <url>, --skip-verify, --env-only)" ;;
  esac
done

[[ -f docker-compose.yml && -f docker-compose.offline.yml && -f .env.example ]] \
  || fail "run this script from the extracted bundle directory (docker-compose.yml not found here)"

COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.offline.yml)

# ─── 1. Integrity check ───────────────────────────────────────────────────────
if [[ "${SKIP_VERIFY}" -eq 1 ]]; then
  warn "integrity verification SKIPPED by --skip-verify"
elif [[ -f SHA256SUMS ]]; then
  say "--> Verifying bundle integrity (SHA256SUMS)..."
  command -v sha256sum &>/dev/null || fail "sha256sum not found (coreutils required)"
  sha256sum -c SHA256SUMS --quiet || fail "integrity check FAILED — the bundle is corrupted or tampered with. Do not install."
  ok "integrity verified ($(wc -l < SHA256SUMS) files)"
else
  fail "SHA256SUMS missing from bundle (use --skip-verify only if you accept an unverified install)"
fi

# ─── Offline secret generation (no openssl required; usable via --env-only) ──
rand_hex() { # rand_hex <bytes>
  if command -v openssl &>/dev/null; then
    openssl rand -hex "$1"
  else
    head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}
rand_password() {
  if command -v base64 &>/dev/null; then
    echo "Ag!9-$(head -c 18 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n')"
  else
    echo "Ag!9-$(rand_hex 12)"
  fi
}

BUNDLE_VERSION="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' manifest.json 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)"
BUNDLE_VERSION="${BUNDLE_VERSION:-offline}"

ADMIN_PASSWORD_VAL=""
generate_env_file() {
  if [[ -f .env ]]; then
    # Backfill: append ONLY keys that are missing from the existing .env.
    # Non-destructive — existing values are never touched. This catches the
    # case where a bundle adds a new required key (e.g. SERIAL_HELPER_SHARED_SECRET)
    # that the operator's pre-existing .env doesn't have.
    local existing_pg existing_dev missing_any=0
    existing_pg="$(sed -n 's/^POSTGRES_PASSWORD=//p' .env | head -1)"
    existing_dev="$(sed -n 's/^DEVICE_COMMAND_SECRET=//p' .env | head -1)"

    backfill_key() {
      local key="$1" value="$2"
      if grep -q "^${key}=" .env; then
        return 0
      fi
      if [[ "${missing_any}" -eq 0 ]]; then
        echo "" >> .env
        echo "# --- backfilled by install.sh (keys were missing from the original .env) ---" >> .env
        missing_any=1
      fi
      echo "${key}=${value}" >> .env
      warn "backfilled missing key: ${key}"
    }

    # SERIAL_HELPER_SHARED_SECRET: avoid collision with existing DEVICE_COMMAND_SECRET
    local serial_val
    serial_val="$(rand_hex 32)"
    [[ -n "${existing_dev}" && "${serial_val}" = "${existing_dev}" ]] && serial_val="$(rand_hex 32)"

    # Generate one Postgres credential and bind both configuration keys to it.
    local pg_val shadow_val
    pg_val="${existing_pg:-$(rand_hex 16)}"
    shadow_val="postgres://aetherguard:${pg_val}@postgres:5432/aetherguard"

    backfill_key "JWT_SECRET"                  "$(rand_hex 32)"
    backfill_key "AUDIT_LOG_SECRET"            "$(rand_hex 32)"
    backfill_key "AUDIT_LOG_FAIL_CLOSED"       "true"
    backfill_key "AUDIT_SHADOW_REQUIRED"       "true"
    backfill_key "ENCRYPTION_KEY"              "$(rand_hex 32)"
    backfill_key "ENCRYPTION_SALT"             "$(rand_hex 16)"
    backfill_key "REDIS_PASSWORD"              "$(rand_hex 16)"
    backfill_key "DEVICE_COMMAND_SECRET"       "$(rand_hex 32)"
    backfill_key "SERIAL_HELPER_SHARED_SECRET" "${serial_val}"
    backfill_key "POSTGRES_PASSWORD"           "${pg_val}"
    backfill_key "SHADOW_DATABASE_URL"         "${shadow_val}"
    backfill_key "S3_SECRET_KEY"               "$(rand_hex 16)"
    backfill_key "DEVICE_API_KEYS"             "device_key_$(rand_hex 8)"
    backfill_key "ADMIN_PASSWORD"              "$(rand_password)"

    if [[ "${missing_any}" -eq 0 ]]; then
      ok ".env already exists and has all required keys — left untouched"
    else
      ok ".env backfilled with missing key(s)"
    fi
    return 0
  fi
  say "--> Generating .env with random secrets (version tag: ${BUNDLE_VERSION})..."
  cp .env.example .env
  chmod 600 .env

  replace_secret() {
    local key="$1" value="$2"
    grep -q "^${key}=" .env || fail ".env.example has no '${key}=' line — bundle template out of sync with installer"
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  }

  local POSTGRES_PASSWORD_VAL DEVICE_COMMAND_SECRET_VAL SERIAL_HELPER_VAL
  POSTGRES_PASSWORD_VAL="$(rand_hex 16)"
  DEVICE_COMMAND_SECRET_VAL="$(rand_hex 32)"
  SERIAL_HELPER_VAL="$(rand_hex 32)"
  [[ "${SERIAL_HELPER_VAL}" != "${DEVICE_COMMAND_SECRET_VAL}" ]] || fail "secret collision — re-run installer"
  ADMIN_PASSWORD_VAL="$(rand_password)"

  replace_secret "JWT_SECRET"                  "$(rand_hex 32)"
  replace_secret "AUDIT_LOG_SECRET"            "$(rand_hex 32)"
  replace_secret "ENCRYPTION_KEY"              "$(rand_hex 32)"
  replace_secret "ENCRYPTION_SALT"             "$(rand_hex 16)"
  replace_secret "REDIS_PASSWORD"              "$(rand_hex 16)"
  replace_secret "DEVICE_COMMAND_SECRET"       "${DEVICE_COMMAND_SECRET_VAL}"
  replace_secret "SERIAL_HELPER_SHARED_SECRET" "${SERIAL_HELPER_VAL}"
  replace_secret "POSTGRES_PASSWORD"           "${POSTGRES_PASSWORD_VAL}"
  replace_secret "SHADOW_DATABASE_URL"         "postgres://aetherguard:${POSTGRES_PASSWORD_VAL}@postgres:5432/aetherguard"
  replace_secret "S3_SECRET_KEY"               "$(rand_hex 16)"
  replace_secret "DEVICE_API_KEYS"             "device_key_$(rand_hex 8)"
  replace_secret "ADMIN_PASSWORD"              "${ADMIN_PASSWORD_VAL}"

  if [[ -n "${EXTRA_ORIGIN}" ]]; then
    sed -i "s|^ALLOWED_ORIGINS=.*|&,${EXTRA_ORIGIN}|" .env
    ok "added ${EXTRA_ORIGIN} to ALLOWED_ORIGINS"
  fi

  # Pin the compose image tags to this bundle's version
  echo "" >> .env
  echo "# Offline bundle image tag (written by install.sh)" >> .env
  echo "AETHERGUARD_VERSION=${BUNDLE_VERSION}" >> .env

  if grep -E '^[A-Za-z0-9_]+=.*change_me' .env >/dev/null; then
    grep -nE '^[A-Za-z0-9_]+=.*change_me' .env | sed 's/=.*/=.../' >&2
    fail "placeholder values remain in .env (installer/template drift) — do not deploy"
  fi
  ok ".env generated (no placeholder secrets remain)"
}

if [[ "${ENV_ONLY}" -eq 1 ]]; then
  generate_env_file
  if [[ -n "${ADMIN_PASSWORD_VAL}" ]]; then
    say "  ADMIN_PASSWORD (change after first login): ${BOLD}${ADMIN_PASSWORD_VAL}${RESET}"
  fi
  say "--env-only done. Run 'sudo bash install.sh' to perform the full installation."
  exit 0
fi

# ─── 2. Docker Engine + Compose v2 ───────────────────────────────────────────
install_bundled_docker() {
  local tgz
  tgz="$(ls docker/docker-*.tgz 2>/dev/null | head -1 || true)"
  [[ -n "${tgz}" ]] || fail "Docker is not installed and this bundle carries no docker/ payload.
       Rebuild the bundle with --include-docker, or install Docker Engine + Compose v2.24+ on this host first."
  [[ "${EUID}" -eq 0 ]] || fail "root required to install the bundled Docker engine (re-run with sudo)"

  say "--> Installing bundled Docker static engine (${tgz})..."
  tar -xzf "${tgz}" -C /tmp
  cp /tmp/docker/* /usr/local/bin/
  rm -rf /tmp/docker

  if command -v systemctl &>/dev/null; then
    cat > /etc/systemd/system/docker.service <<'UNIT'
[Unit]
Description=Docker Application Container Engine (AetherGuard offline bundle)
After=network.target

[Service]
ExecStart=/usr/local/bin/dockerd
Restart=always
RestartSec=5
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
    systemctl enable --now docker
  else
    warn "systemd not found — starting dockerd in the background (won't survive reboot; add it to your init system)"
    nohup /usr/local/bin/dockerd > /var/log/aetherguard-dockerd.log 2>&1 &
  fi

  # Wait for the daemon socket
  for _ in $(seq 1 30); do
    docker info &>/dev/null && break
    sleep 2
  done
  docker info &>/dev/null || fail "dockerd did not become ready within 60s (see journalctl -u docker / /var/log/aetherguard-dockerd.log)"
  ok "Docker engine installed: $(docker --version)"
}

install_bundled_compose_plugin() {
  [[ -f docker/docker-compose ]] || fail "'docker compose' (v2 plugin) is unavailable and the bundle carries no compose plugin.
       Rebuild the bundle with --include-docker, or install the Compose v2.24+ plugin on this host."
  local dir=/usr/local/lib/docker/cli-plugins
  mkdir -p "${dir}"
  cp docker/docker-compose "${dir}/docker-compose"
  chmod +x "${dir}/docker-compose"
  docker compose version &>/dev/null || fail "compose plugin installed to ${dir} but 'docker compose version' still fails"
  ok "Compose plugin installed: $(docker compose version | head -1)"
}

if ! command -v docker &>/dev/null; then
  install_bundled_docker
elif ! docker info &>/dev/null; then
  fail "docker exists but the daemon is not reachable (start it, or check permissions/group membership)"
else
  ok "Docker present: $(docker --version)"
fi

if ! docker compose version &>/dev/null; then
  install_bundled_compose_plugin
else
  ok "$(docker compose version | head -1)"
fi

# ─── 3. Load images ───────────────────────────────────────────────────────────
[[ -f images/images.tar ]] || fail "images/images.tar missing from bundle"
say "--> Loading container images (no registry access needed; this can take a few minutes)..."
docker load -i images/images.tar
ok "images loaded"

# ─── 4. Generate .env (offline, random secrets — generate_env_file above) ────
generate_env_file

# ─── 5. Start the stack (never build, never pull) ────────────────────────────
say "--> Starting AetherGuard (docker compose up -d --no-build)..."
docker compose "${COMPOSE_FILES[@]}" up -d --no-build

# ─── 6. Wait for backend health (uses docker itself — no curl/wget needed) ───
say "--> Waiting for backend container health..."
BACKEND_ID="$(docker compose "${COMPOSE_FILES[@]}" ps -q backend || true)"
HEALTH="unknown"
if [[ -n "${BACKEND_ID}" ]]; then
  for _ in $(seq 1 100); do
    HEALTH="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "${BACKEND_ID}" 2>/dev/null || echo unknown)"
    [[ "${HEALTH}" == "healthy" ]] && break
    sleep 3
  done
fi

FRONTEND_PORT="$(grep -E '^FRONTEND_PORT=' .env | cut -d= -f2 || true)"; FRONTEND_PORT="${FRONTEND_PORT:-8080}"

echo ""
if [[ "${HEALTH}" == "healthy" ]]; then
  say "${BOLD}===========================================${RESET}"
  say "${BOLD}   AetherGuard offline install complete — backend healthy${RESET}"
  say "${BOLD}===========================================${RESET}"
else
  say "${BOLD}===========================================${RESET}"
  warn "containers are up, but backend health is '${HEALTH}' after 5 minutes."
  warn "Inspect before use:  docker compose ${COMPOSE_FILES[*]} logs backend"
  say "${BOLD}===========================================${RESET}"
fi
echo ""
say "  Frontend:  http://<this-host>:${FRONTEND_PORT}"
say "  API:       proxied through the frontend origin; backend is not host-published"
if [[ -n "${ADMIN_PASSWORD_VAL}" ]]; then
  say "  Login:     ADMIN_EMAIL from .env / ${BOLD}${ADMIN_PASSWORD_VAL}${RESET}  (change after first login)"
else
  say "  Login:     ADMIN_EMAIL / ADMIN_PASSWORD from the existing .env"
fi
echo ""
say "  Accessing the console from another machine requires an explicit exposure decision:"
say "    set FRONTEND_BIND_ADDRESS and ALLOWED_ORIGINS in .env, then re-apply Compose"
echo ""
say "  Logs:  docker compose ${COMPOSE_FILES[*]} logs -f"
say "  Stop:  docker compose ${COMPOSE_FILES[*]} down"
echo ""
