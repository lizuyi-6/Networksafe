#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

cp "${ROOT_DIR}/deployment/offline/install-offline.sh" "${TMP_DIR}/install.sh"
touch "${TMP_DIR}/docker-compose.yml" "${TMP_DIR}/docker-compose.offline.yml" "${TMP_DIR}/.env.example"
printf 'EXISTING_SENTINEL=keep\n' > "${TMP_DIR}/.env"

(
  cd "${TMP_DIR}"
  bash ./install.sh --skip-verify --env-only >/dev/null
)

postgres_password="$(grep -E '^POSTGRES_PASSWORD=' "${TMP_DIR}/.env" | cut -d= -f2-)"
shadow_url="$(grep -E '^SHADOW_DATABASE_URL=' "${TMP_DIR}/.env" | cut -d= -f2-)"
shadow_password="${shadow_url#postgres://aetherguard:}"
shadow_password="${shadow_password%@postgres:5432/aetherguard}"

[[ -n "${postgres_password}" ]]
[[ "${shadow_password}" == "${postgres_password}" ]]
[[ "$(grep -c '^POSTGRES_PASSWORD=' "${TMP_DIR}/.env")" -eq 1 ]]
[[ "$(grep -c '^SHADOW_DATABASE_URL=' "${TMP_DIR}/.env")" -eq 1 ]]
[[ "$(grep -c '^EXISTING_SENTINEL=keep$' "${TMP_DIR}/.env")" -eq 1 ]]

printf 'offline env backfill: 1 passed, 0 failed (postgres password matches shadow URL)\n'
