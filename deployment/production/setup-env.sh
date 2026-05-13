#!/usr/bin/env bash
# =============================================================================
# AetherGuard Production Environment Setup Script
# Usage: bash deployment/production/setup-env.sh
# Run from the project root directory.
# =============================================================================

set -euo pipefail

# Resolve project root (two levels up from this script's directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ENV_FILE="${PROJECT_ROOT}/.env"
ENV_EXAMPLE="${PROJECT_ROOT}/.env.example"

# ─── Color helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BOLD='\033[1m'
RESET='\033[0m'

# ─── Dependency check ─────────────────────────────────────────────────────────
if ! command -v openssl &>/dev/null; then
  echo -e "${RED}[ERROR]${RESET} 'openssl' is not available on this system." >&2
  echo "       Please install openssl and re-run this script." >&2
  exit 1
fi

# ─── .env.example existence check ────────────────────────────────────────────
if [[ ! -f "${ENV_EXAMPLE}" ]]; then
  echo -e "${RED}[ERROR]${RESET} Template file not found: ${ENV_EXAMPLE}" >&2
  echo "       Make sure you are running this script from the project root," >&2
  echo "       or that .env.example exists at the project root." >&2
  exit 1
fi

# ─── Overwrite guard ──────────────────────────────────────────────────────────
if [[ -f "${ENV_FILE}" ]]; then
  echo -e "${YELLOW}[WARNING]${RESET} A .env file already exists at: ${ENV_FILE}"
  read -r -p "         Do you want to overwrite it? This will replace all current values. [y/N] " REPLY
  case "${REPLY}" in
    [yY][eE][sS]|[yY])
      echo "         Overwriting existing .env ..."
      ;;
    *)
      echo -e "${YELLOW}[ABORTED]${RESET} .env was not modified. Configuration is incomplete."
      exit 1
      ;;
  esac
fi

# ─── Copy template ────────────────────────────────────────────────────────────
cp "${ENV_EXAMPLE}" "${ENV_FILE}"
echo -e "${GREEN}[OK]${RESET} Copied .env.example → .env"

# ─── Secret generation helper ─────────────────────────────────────────────────
# Usage: replace_secret <KEY> <VALUE>
# Replaces the value of KEY=<anything> in .env with KEY=<VALUE>
replace_secret() {
  local key="$1"
  local value="$2"
  # Use a delimiter unlikely to appear in the generated hex value
  sed -i "s|^${key}=.*|${key}=${value}|" "${ENV_FILE}"
}

# ─── Generate secrets ─────────────────────────────────────────────────────────
echo ""
echo "Generating cryptographically random secrets..."

JWT_SECRET_VAL="$(openssl rand -hex 32)"
AUDIT_LOG_SECRET_VAL="$(openssl rand -hex 32)"
DEVICE_COMMAND_SECRET_VAL="$(openssl rand -hex 32)"
ENCRYPTION_KEY_VAL="$(openssl rand -hex 32)"
ENCRYPTION_SALT_VAL="$(openssl rand -hex 32)"

replace_secret "JWT_SECRET"             "${JWT_SECRET_VAL}"
replace_secret "AUDIT_LOG_SECRET"       "${AUDIT_LOG_SECRET_VAL}"
replace_secret "DEVICE_COMMAND_SECRET"  "${DEVICE_COMMAND_SECRET_VAL}"
replace_secret "ENCRYPTION_KEY"         "${ENCRYPTION_KEY_VAL}"
replace_secret "ENCRYPTION_SALT"        "${ENCRYPTION_SALT_VAL}"

echo -e "${GREEN}[OK]${RESET} Secrets written to .env"

# ─── Checklist ────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD} AetherGuard .env Setup Checklist${RESET}"
echo -e "${BOLD}════════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${GREEN}✓${RESET}  JWT_SECRET              — auto-generated (64 hex chars)"
echo -e "  ${GREEN}✓${RESET}  AUDIT_LOG_SECRET        — auto-generated (64 hex chars)"
echo -e "  ${GREEN}✓${RESET}  DEVICE_COMMAND_SECRET   — auto-generated (64 hex chars)"
echo -e "  ${GREEN}✓${RESET}  ENCRYPTION_KEY          — auto-generated (64 hex chars)"
echo -e "  ${GREEN}✓${RESET}  ENCRYPTION_SALT         — auto-generated (64 hex chars)"
echo ""
echo -e "  ${YELLOW}⚠${RESET}  ADMIN_PASSWORD          — ${BOLD}must be set manually${RESET} (strong password, min 12 chars)"
echo -e "  ${YELLOW}⚠${RESET}  POSTGRES_PASSWORD       — ${BOLD}must be set manually${RESET} (strong password)"
echo -e "  ${YELLOW}⚠${RESET}  S3_SECRET_KEY           — ${BOLD}must be set manually${RESET} (if S3/MinIO is used)"
echo ""
echo -e "${BOLD}════════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "Next step: open ${BOLD}.env${RESET} and fill in the ⚠ fields above before"
echo -e "running ${BOLD}docker-compose up -d${RESET}."
echo ""
