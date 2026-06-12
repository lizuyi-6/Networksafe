# AetherGuard Full-Stack Acceptance Runbook

This runbook executes the defect-finding acceptance plan against the Docker full stack.

## Command

```bash
npm run acceptance:full-stack
```

## Required Environment

- Docker Compose must be available.
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` or `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` must match the admin user created by the backend.
- The Docker acceptance stack enables `ALLOW_BREAK_GLASS_PASSWORD_LOGIN=true` by default so the documented admin login flow can be exercised in `prod-enterprise` runtime without enabling demo login presets.
- `PLATFORM_API_KEY` must be set for real AI acceptance. If it is missing, the runner records a P1 environment defect instead of passing AI checks.
- `DEVICE_COMMAND_SECRET` or `SERIAL_HELPER_SHARED_SECRET` should be set so helper and hardware-gate boundary checks can run.
- `VALID_API_KEYS` should be set so agent-authenticated investigation routes can run.
- The current backend primary `DatabaseManager` still initializes SQLite/sql.js, while Postgres is used by the shadow store. The Docker acceptance stack therefore enables `SQLITE_FALLBACK_ENABLED=true` unless overridden, and records that fact in `defects.json`. Treat a future pure-Postgres primary migration as a separate hardening task.

## What It Runs

- Starts the full Docker stack with `docker compose up -d --build`.
- Checks frontend nginx, backend health, readiness, dependencies, and Docker evidence logs.
- Runs backend typecheck, Jest suites, route DB guard, and frontend direct API guard.
- Runs non-AI API normal and abnormal checks across auth, agents, traffic, devices, scanner, alerts, rules, final-defense, deployment runs, and admin APIs.
- Runs real AI checks for `/api/ai-endpoints/chat`, prompt-injection blocking on `/api/smart-fix/ai-analyze`, complex smart-fix analysis, and agent-authenticated investigation if `VALID_API_KEYS` is configured.
- Runs Playwright acceptance on desktop Chrome, Pixel, and iPhone projects.
- Extracts Playwright failure screenshots, videos, traces, and `error-context.md` paths into the defect evidence list when a browser flow fails.

## Outputs

Artifacts are written under:

```text
artifacts/acceptance/<timestamp>/
```

Primary files:

- `defects.md`: human-readable defect list sorted by P0-P3.
- `defects.json`: machine-readable report with environment, defects, and step logs.
- `steps/*.log`: command output and Docker evidence.
- `e2e/test-results/`: Playwright screenshots, traces, and videos for failed or explicitly captured acceptance steps.

The runner exits non-zero when any defect is recorded.
