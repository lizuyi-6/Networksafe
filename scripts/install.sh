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
if ! command -v docker &>/dev/null; then
    if [[ "${EUID}" -ne 0 ]]; then
        echo "[ERROR] Docker is not installed and this script is not running as root." >&2
        echo "        Re-run with sudo, or install Docker manually: https://docs.docker.com/engine/install/" >&2
        exit 1
    fi
    echo "--> Installing Docker Engine (get.docker.com)..."
    curl -fsSL https://get.docker.com | sh
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

# ─── 4. Wait for backend health ──────────────────────────────────────────────
BACKEND_PORT="$(grep -E '^BACKEND_PORT=' .env | cut -d= -f2 || true)"
BACKEND_PORT="${BACKEND_PORT:-3005}"
FRONTEND_PORT="$(grep -E '^FRONTEND_PORT=' .env | cut -d= -f2 || true)"
FRONTEND_PORT="${FRONTEND_PORT:-8080}"

echo "--> Waiting for backend health at http://localhost:${BACKEND_PORT}/health ..."
HEALTH_OK=0
for _ in $(seq 1 60); do
    if curl -fsS "http://localhost:${BACKEND_PORT}/health" >/dev/null 2>&1; then
        HEALTH_OK=1
        break
    fi
    sleep 2
done

echo ""
if [[ "${HEALTH_OK}" -eq 1 ]]; then
    echo "==========================================="
    echo "   Installation Complete — backend healthy"
    echo "==========================================="
else
    echo "==========================================="
    echo "   Containers started, but the backend did NOT report healthy within 120s."
    echo "   Inspect logs before using the system:  docker compose logs -f backend"
    echo "==========================================="
fi
echo ""
echo "  Frontend:  http://localhost:${FRONTEND_PORT}"
echo "  Backend:   http://localhost:${BACKEND_PORT}"
echo "  Login:     ADMIN_EMAIL / ADMIN_PASSWORD from ${PROJECT_ROOT}/.env"
echo "             (setup-env.sh printed the generated admin password above)"
echo ""
echo "  Logs:      docker compose logs -f"
echo "  Stop:      docker compose down"
echo "  Restart:   docker compose restart"
echo ""
