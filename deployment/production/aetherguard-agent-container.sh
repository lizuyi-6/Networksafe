#!/bin/sh
set -eu

INSTANCE_NAME="${1:?instance name is required}"
ENV_DIR="${AETHERGUARD_AGENT_ENV_DIR:-/etc/aetherguard/agents}"
ENV_FILE="${AETHERGUARD_ENV_FILE:-${ENV_DIR}/${INSTANCE_NAME}.env}"
IMAGE="${AETHERGUARD_AGENT_IMAGE:-app-backend:latest}"
CONTAINER_NAME="aetherguard-agent-${INSTANCE_NAME}"
SERVER_URL="${AETHERGUARD_SERVER:-http://127.0.0.1:3005}"
NODE_ENV_VALUE="${NODE_ENV:-production}"
LOG_LEVEL_VALUE="${LOG_LEVEL:-info}"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Agent env file not found: ${ENV_FILE}" >&2
  exit 1
fi

exec /usr/bin/docker run --rm \
  --name "${CONTAINER_NAME}" \
  --network host \
  --user 0:0 \
  -v "${ENV_DIR}:${ENV_DIR}" \
  -e "AETHERGUARD_ENV_FILE=${ENV_FILE}" \
  -e "NODE_ENV=${NODE_ENV_VALUE}" \
  -e "LOG_LEVEL=${LOG_LEVEL_VALUE}" \
  --env-file "${ENV_FILE}" \
  "${IMAGE}" \
  node dist/agent-cli.js --server="${SERVER_URL}"
