#!/usr/bin/env bash
# =============================================================================
# AetherGuard Production Environment Setup Script (bash + openssl, no Node)
# Usage: bash deployment/production/setup-env.sh
# Run from the project root directory.
#
# Cross-platform alternative (Windows/macOS/Linux, requires Node):
#   node scripts/setup.mjs
# Keep the generated-key list below in sync with scripts/setup.mjs (GENERATED_KEYS).
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
  echo "       Please install openssl and re-run this script," >&2
  echo "       or use the Node alternative: node scripts/setup.mjs" >&2
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
  if ! grep -q "^${key}=" "${ENV_FILE}"; then
    echo -e "${RED}[ERROR]${RESET} .env.example has no '${key}=' line — template and setup script are out of sync." >&2
    exit 1
  fi
  # Use a delimiter unlikely to appear in the generated hex value
  sed -i "s|^${key}=.*|${key}=${value}|" "${ENV_FILE}"
}

# ─── Generate secrets ─────────────────────────────────────────────────────────
echo ""
echo "Generating cryptographically random secrets..."

JWT_SECRET_VAL="$(openssl rand -hex 32)"
AUDIT_LOG_SECRET_VAL="$(openssl rand -hex 32)"
DEVICE_COMMAND_SECRET_VAL="$(openssl rand -hex 32)"
SERIAL_HELPER_SHARED_SECRET_VAL="$(openssl rand -hex 32)"
ENCRYPTION_KEY_VAL="$(openssl rand -hex 32)"
ENCRYPTION_SALT_VAL="$(openssl rand -hex 16)"
REDIS_PASSWORD_VAL="$(openssl rand -hex 16)"
POSTGRES_PASSWORD_VAL="$(openssl rand -hex 16)"
S3_SECRET_KEY_VAL="$(openssl rand -hex 16)"
DEVICE_API_KEYS_VAL="device_key_$(openssl rand -hex 8)"
# Readable-but-strong admin password (24+ chars, URL/shell-safe)
ADMIN_PASSWORD_VAL="Ag-$(openssl rand -base64 18 | tr '+/' '-_' | tr -d '=')"

if [[ "${SERIAL_HELPER_SHARED_SECRET_VAL}" == "${DEVICE_COMMAND_SECRET_VAL}" ]]; then
  echo -e "${RED}[ERROR]${RESET} Secret collision (SERIAL_HELPER == DEVICE_COMMAND); re-run the script." >&2
  exit 1
fi

replace_secret "JWT_SECRET"                  "${JWT_SECRET_VAL}"
replace_secret "AUDIT_LOG_SECRET"            "${AUDIT_LOG_SECRET_VAL}"
replace_secret "DEVICE_COMMAND_SECRET"       "${DEVICE_COMMAND_SECRET_VAL}"
replace_secret "SERIAL_HELPER_SHARED_SECRET" "${SERIAL_HELPER_SHARED_SECRET_VAL}"
replace_secret "ENCRYPTION_KEY"              "${ENCRYPTION_KEY_VAL}"
replace_secret "ENCRYPTION_SALT"             "${ENCRYPTION_SALT_VAL}"
replace_secret "REDIS_PASSWORD"              "${REDIS_PASSWORD_VAL}"
replace_secret "POSTGRES_PASSWORD"           "${POSTGRES_PASSWORD_VAL}"
# Keep the shadow-store URL password in sync with POSTGRES_PASSWORD (same value,
# same run) — the postgres container initializes with POSTGRES_PASSWORD and the
# backend authenticates with SHADOW_DATABASE_URL.
replace_secret "SHADOW_DATABASE_URL"         "postgres://aetherguard:${POSTGRES_PASSWORD_VAL}@postgres:5432/aetherguard"
replace_secret "S3_SECRET_KEY"               "${S3_SECRET_KEY_VAL}"
replace_secret "DEVICE_API_KEYS"             "${DEVICE_API_KEYS_VAL}"
replace_secret "ADMIN_PASSWORD"              "${ADMIN_PASSWORD_VAL}"

chmod 600 "${ENV_FILE}" 2>/dev/null || true

echo -e "${GREEN}[OK]${RESET} Secrets written to .env"

# ─── Verify no placeholders remain ───────────────────────────────────────────
# Only inspect KEY=value lines — template comments legitimately mention "change_me".
if grep -E '^[A-Za-z0-9_]+=.*change_me' "${ENV_FILE}" >/dev/null; then
  echo -e "${RED}[ERROR]${RESET} Placeholder values remain in .env (template/script drift):" >&2
  grep -nE '^[A-Za-z0-9_]+=.*change_me' "${ENV_FILE}" | sed 's/=.*/=.../' >&2
  echo "       Do not deploy this file. Fix the missing keys above." >&2
  exit 1
fi
echo -e "${GREEN}[OK]${RESET} No placeholder values remain"

# ─── Checklist ────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD} AetherGuard .env Setup Checklist${RESET}"
echo -e "${BOLD}════════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${GREEN}✓${RESET}  JWT_SECRET / AUDIT_LOG_SECRET            — auto-generated"
echo -e "  ${GREEN}✓${RESET}  ENCRYPTION_KEY / ENCRYPTION_SALT         — auto-generated"
echo -e "  ${GREEN}✓${RESET}  DEVICE_COMMAND_SECRET                    — auto-generated"
echo -e "  ${GREEN}✓${RESET}  SERIAL_HELPER_SHARED_SECRET              — auto-generated (distinct from DEVICE_COMMAND_SECRET)"
echo -e "  ${GREEN}✓${RESET}  REDIS_PASSWORD                           — auto-generated"
echo -e "  ${GREEN}✓${RESET}  POSTGRES_PASSWORD + SHADOW_DATABASE_URL  — auto-generated (kept in sync)"
echo -e "  ${GREEN}✓${RESET}  S3_SECRET_KEY / DEVICE_API_KEYS          — auto-generated"
echo ""
echo -e "  ${GREEN}✓${RESET}  ADMIN_PASSWORD — auto-generated. ${BOLD}Login password (change after first login):${RESET}"
echo -e "         ${BOLD}${ADMIN_PASSWORD_VAL}${RESET}"
echo ""
echo -e "  ${YELLOW}⚠${RESET}  PLATFORM_API_KEY — optional; empty means cloud AI routes start degraded."
echo ""
echo -e "${BOLD}════════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "Next step: ${BOLD}docker compose up -d --build${RESET}"
echo -e "(requires Docker Compose v2.24+; the compose file's env_file long syntax"
echo -e " is not supported by the legacy docker-compose v1 binary)"
echo ""
