#!/bin/bash
# =============================================================================
# AetherGuard One-Click Docker Installation (Linux)
#
# Installs Docker (if missing), generates .env with random secrets, then
# builds and starts the full stack from this repository's docker-compose.yml.
#
# Usage:   sudo bash scripts/install.sh
# Windows/macOS: install Docker Desktop, then run
#   node scripts/setup.mjs && docker compose up -d --build
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "==========================================="
echo "   AetherGuard One-Click Docker Install"
echo "   repo: ${PROJECT_ROOT}"
echo "==========================================="

if [[ ! -f "${PROJECT_ROOT}/docker-compose.yml" ]]; then
    echo "[ERROR] docker-compose.yml not found at ${PROJECT_ROOT} — run this script from a full checkout." >&2
    exit 1
fi

# ─── 1. Docker Engine ─────────────────────────────────────────────────────────
# SECURITY FIX (audit 2026-08, DP-012): never pipe a remote script straight
# into a root shell. Download over HTTPS first, then either
#   (a) verify it against a sha256 pin — export DOCKER_GET_SHA256=<reviewed
#       hash> (unattended installs; mismatch aborts), or
#   (b) if no pin is set, require an interactive review: the script's
#       sha256 and first lines are printed and the operator must confirm.
# There is no way to skip the trust decision.
if ! command -v docker &>/dev/null; then
    if [[ "${EUID}" -ne 0 ]]; then
        echo "[ERROR] Docker is not installed and this script is not running as root." >&2
        echo "        Re-run with sudo, or install Docker manually: https://docs.docker.com/engine/install/" >&2
        exit 1
    fi
    echo "--> Installing Docker Engine (get.docker.com)..."
    GET_DOCKER_TMP="$(mktemp /tmp/get-docker.XXXXXX.sh)"
    cleanup_get_docker() { rm -f "${GET_DOCKER_TMP}"; }
    trap cleanup_get_docker EXIT
    curl -fsSL https://get.docker.com -o "${GET_DOCKER_TMP}"
    GET_DOCKER_ACTUAL="$(sha256sum "${GET_DOCKER_TMP}" | awk '{print $1}')"
    if [[ -n "${DOCKER_GET_SHA256:-}" ]]; then
        if [[ "${GET_DOCKER_ACTUAL}" != "${DOCKER_GET_SHA256}" ]]; then
            echo "[ERROR] get.docker.com script failed sha256 verification — refusing to run it as root." >&2
            echo "        expected: ${DOCKER_GET_SHA256}" >&2
            echo "        actual:   ${GET_DOCKER_ACTUAL}" >&2
            exit 1
        fi
        echo "[OK] sha256 verified: ${GET_DOCKER_ACTUAL}"
    else
        echo "----------------------------------------------------------------"
        echo " Downloaded https://get.docker.com"
        echo " sha256: ${GET_DOCKER_ACTUAL}"
        echo " To run unattended, export DOCKER_GET_SHA256=<this hash> after review."
        echo " First lines of the script:"
        sed -n '1,12p' "${GET_DOCKER_TMP}" | sed 's/^/   | /'
        echo "----------------------------------------------------------------"
        if [[ ! -t 0 ]]; then
            echo "[ERROR] Not interactive and DOCKER_GET_SHA256 is not set — refusing to run an unreviewed script as root." >&2
            exit 1
        fi
        read -r -p " Review the script above, then type 'yes' to run it: " CONFIRM
        if [[ "${CONFIRM}" != "yes" ]]; then
            echo "[ERROR] Aborted by operator." >&2
            exit 1
        fi
    fi
    sh "${GET_DOCKER_TMP}"
    systemctl enable --now docker
else
    echo "[OK] Docker already installed: $(docker --version)"
fi

# Compose v2 plugin is required: docker-compose.yml uses the env_file long
# syntax (`required: false`), which the legacy docker-compose v1 binary and
# Compose < v2.24 cannot parse.
if ! docker compose version &>/dev/null; then
    echo "[ERROR] 'docker compose' (v2 plugin) is not available." >&2
    echo "        Install the compose plugin: https://docs.docker.com/compose/install/linux/" >&2
    echo "        (the legacy 'docker-compose' v1 binary is NOT sufficient for this stack)" >&2
    exit 1
fi
echo "[OK] $(docker compose version | head -1)"

# ─── 2. Environment file with random secrets ────────────────────────────────
cd "${PROJECT_ROOT}"
if [[ -f .env ]]; then
    echo "[OK] .env already exists — keeping it (delete it or run setup-env.sh to regenerate)."
else
    echo "--> Generating .env with random secrets..."
    bash deployment/production/setup-env.sh
fi

# ─── 3. Build and start ──────────────────────────────────────────────────────
echo "--> Building and starting all services (this builds backend, frontend and the Rust fastpath)..."
docker compose up -d --build

# ─── 4. Wait for control-plane readiness through the public edge ────────────
FRONTEND_PORT="$(grep -E '^FRONTEND_PORT=' .env | cut -d= -f2 || true)"
FRONTEND_PORT="${FRONTEND_PORT:-8080}"

READINESS_URL="http://localhost:${FRONTEND_PORT}/health/ready"
echo "--> Waiting for control-plane readiness at ${READINESS_URL} ..."
HEALTH_OK=0
for _ in $(seq 1 60); do
    if READINESS_RESPONSE="$(curl -fsS "${READINESS_URL}" 2>/dev/null)"; then
        if printf '%s' "${READINESS_RESPONSE}" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"'; then
            HEALTH_OK=1
            break
        fi
    fi
    sleep 2
done

echo ""
if [[ "${HEALTH_OK}" -eq 1 ]]; then
    echo "==========================================="
    echo "   Installation Complete — control plane ready"
    echo "==========================================="
else
    echo "==========================================="
    echo "   Containers started, but the backend did NOT report healthy within 120s."
    echo "   Inspect logs before using the system:  docker compose logs -f backend"
    echo "==========================================="
    exit 1
fi
echo ""
echo "  Frontend:  http://localhost:${FRONTEND_PORT}"
echo "  API:       proxied through http://localhost:${FRONTEND_PORT}/api"
echo "  Login:     ADMIN_EMAIL / ADMIN_PASSWORD from ${PROJECT_ROOT}/.env"
echo "             (setup-env.sh printed the generated admin password above)"
echo ""
echo "  Logs:      docker compose logs -f"
echo "  Stop:      docker compose down"
echo "  Restart:   docker compose restart"
echo ""
