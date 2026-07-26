#!/bin/bash
# =============================================================================
# DEPRECATED — do not use.
#
# This legacy native-deployment script can no longer produce a bootable
# system. The backend's production startup validation
# (backend/src/bootstrap/runtime-env.ts) hard-rejects the configuration this
# script generates:
#
#   1. It wrote DISABLE_REDIS=true with NODE_ENV=production
#      → "DISABLE_REDIS cannot be enabled in production." (hard error)
#   2. It provisioned no Postgres and left DB_MODE unset
#      → "DB_MODE must be set to postgres in production." (hard error)
#   3. It never generated ENCRYPTION_KEY / ENCRYPTION_SALT /
#      SERIAL_HELPER_SHARED_SECRET → assertStrongSecret hard errors.
#   4. It expected artifacts/releases/backend-dist.tar.gz +
#      frontend-dist.tar.gz, which no current script produces.
#
# Supported installation paths:
#   Docker (recommended):   sudo bash scripts/install.sh
#     or manually:          node scripts/setup.mjs && docker compose up -d --build
#   Env generation only:    bash deployment/production/setup-env.sh
# =============================================================================

echo "ERROR: deploy.sh is deprecated and disabled." >&2
echo "" >&2
echo "It generated a configuration the backend now hard-rejects at startup" >&2
echo "(DISABLE_REDIS=true and DB_MODE != postgres are fatal in production," >&2
echo "see backend/src/bootstrap/runtime-env.ts)." >&2
echo "" >&2
echo "Use instead:" >&2
echo "  sudo bash scripts/install.sh                      # one-click Docker install" >&2
echo "  node scripts/setup.mjs && docker compose up -d --build" >&2
exit 1
