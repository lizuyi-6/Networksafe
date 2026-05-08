# AGENTS.md

This file provides guidance to OpenCode when working with code in this repository.

## Project Overview

AetherGuard — 智能服务器安全防御平台。Agent-based distributed security + physical hardware safety gate.

The core differentiator: **ESP32 hardware dongles act as an air-gapped physical confirmation gate**. Dangerous server operations (install/uninstall agents, wipe data, critical config changes) require a human to physically press buttons on the ESP32 device. The dongle communicates only via serial (UART), using an allow-list protocol (`AG:REQ:*` → `AG:BEGIN/*`, `AG:STEP/*`, `AG:OK/*`, `AG:ERR/*`). Even if the server is fully compromised, an attacker cannot execute destructive operations without physical presence.

| Component | Stack |
|-----------|-------|
| Backend | Node.js/TypeScript, Express, Socket.IO, SQLite (sql.js / better-sqlite3), Postgres (shadow writes) |
| Frontend | React 18, Vite, TailwindCSS, Recharts, Socket.IO Client, i18next |
| Fastpath | Rust sidecar for high-throughput traffic processing |
| E2E | Playwright |
| Hardware | ESP32-WROOM-32 + OLED + 3-button + RGB + buzzer, over USB-TTL serial |

## Quick Start

```bash
# Docker (all services)
docker-compose up -d --build
# Frontend: http://localhost:8080  Backend: http://localhost:3005
# Default credentials: admin / admin123

# Local dev (without Docker)
cd backend && npm install && npm run dev    # Backend on :8080 (or $PORT)
cd frontend && npm install && npm run dev   # Frontend on :5173
```

## Development Commands

### Backend (`backend/`)

```bash
npm run dev              # Auto-reload via ts-node-dev
npm run agent            # Run agent CLI separately
npm run build            # Production build (tsc -p tsconfig.build.json)
npm run typecheck        # TypeScript check (== tsc --noEmit -p tsconfig.build.json)
npm run lint             # eslint src/**/*.ts

npm test                 # All tests (maxWorkers:1, forceExit, REDIS disabled)
npm run test:module      # Modular test runner; set TEST_MODULE env var
npm run test:coverage    # With coverage
npm run test:agents       # AI agents only (excluded from npm test)

# DB seeding
npm run seed             # Seed demo data
npm run seed:clear       # Clear demo data

# Release guards (must pass before release)
node scripts/guards/check-route-db-access.mjs
node scripts/guards/check-no-direct-api-fetch.mjs
```

### Frontend (`frontend/`)

```bash
npm run dev              # Vite dev server (:5173)
npm run build            # tsc && vite build
npm run typecheck        # tsc --noEmit
npm run lint             # eslint (--max-warnings 0)
```

### E2E (`e2e/`)

```bash
npm install              # First time: also run `npx playwright install --with-deps chromium`
npm test                 # All E2E tests
npm run test:release     # Release verification subset
```

### Rust Fastpath (`rust-fastpath/`)

```bash
cargo test
cargo clippy -- -D warnings
cargo build --release
```

**Node.js**: v18+ (CI uses Node 18). **Rust**: 1.85.0.

## Critical Developer Rules

### Route-level DB access is FORBIDDEN

Files in `backend/src/api/routes/` must NEVER access the database directly. Use repositories in `backend/src/modules/` or services in `backend/src/services/` instead. A guard script enforces this: `scripts/guards/check-route-db-access.mjs`.

### Frontend API calls — single entry point

All frontend API calls MUST go through `frontend/src/services/api.ts`. Direct `fetch('/api...')` anywhere else in frontend source is forbidden. Guard: `scripts/guards/check-no-direct-api-fetch.mjs`.

### API response format

Every route handler MUST use `sendSuccess()` / `sendError()` from `backend/src/core/http/api-response.ts`:
- Success: `{ success: true, data, error: null, meta? }`
- Error: `{ success: false, data: null, error: { code, message }, meta? }`

### Schema initialization

Do NOT call `ensureSchema()` inside request handlers or WebSocket processors. Service-owned tables must be prepared in `backend/src/bootstrap/persistence.ts`. Runtime diagnostics must be read-only.

## Database Gotchas

The `DatabaseManager` (`backend/src/config/database.ts`) uses two backends:

1. **sql.js** (default): Loads entire DB into memory. **Saves to disk every 30 seconds** via `setInterval`. Final save on `close()`.
2. **better-sqlite3** (fallback): Opens file directly with WAL mode.

**Critical**: Since sql.js operates in-memory, direct file modifications (e.g. using `sqlite3` CLI or better-sqlite3 from a separate script) will be overwritten when the running backend saves. Always stop the backend before modifying the database file directly.

`DB_MODE` in production must be `postgres`. `DISABLE_REDIS` must NOT be enabled in production.

## Architecture

### Backend key directories (`backend/src/`)

| Directory | Purpose |
|-----------|---------|
| `bootstrap/` | Startup: `control-plane-app.ts` (app wiring, 23+ route mounts), `persistence.ts` (schema prep), `runtime-env.ts` (secret validation) |
| `core/` | `http/api-response.ts` (envelope helpers), `health/`, `tenant/` |
| `modules/` | Feature modules with repositories: admin, auth, agent-onboarding, deployments, scanner, sites, pipeline, announcements |
| `api/routes/` | Route handlers — must NOT access DB directly |
| `services/` | Integration services (scanner-task, detection-pipeline, etc.) |
| `websocket/` | AgentGateway and DeviceGateway (Socket.IO) |
| `config/` | `database.ts` (dual-backend DB), `platform-runtime.ts` (profiles/modes) |

Key entry points: `index.ts` (server startup), `app.ts` (re-exports for external use), `agent-cli.ts` (standalone agent).

### Frontend (`frontend/src/`)

- `services/api.ts`: Centralized API client — `fetchWithCredentials()` + cookie-based auth + `unwrapApiEnvelope()`. Demo mode branches to demo data generators.
- `context/`: 6 providers — WebSocket, Theme, Language (i18n), Demo, LiveMode, AttackStatus.
- Routes are in `pages/`. i18n in `locales/` (en.json, zh.json).

## Testing

```bash
# All tests (backend)
cd backend && npm test

# Single file
npx jest src/__tests__/agent-gateway.test.ts

# By module (modular config via TEST_MODULE env)
npm run test:core      # TEST_MODULE=core
npm run test:security  # TEST_MODULE=security
npm run test:scanner   # TEST_MODULE=scanner
npm run test:websocket # TEST_MODULE=websocket
npm run test:services  # TEST_MODULE=services
npm run test:agent     # TEST_MODULE=agent
npm run test:routes    # TEST_MODULE=routes

# Watch / verbose
npx jest --watch
npx jest --verbose --testNamePattern="should detect attacks"
```

**Jest config**: `maxWorkers: 1`, `forceExit: true`, `testTimeout: 30000`. AI agents investigation tests are excluded from `npm test`. Use `npm run test:agents` for those. Test env vars are set in `jest.setup.js` (`NODE_ENV=test`, `DISABLE_REDIS=true`, `DATA_DIR=./test-data`).

## Docker Compose

Services defined in `docker-compose.yml`: redis (7), postgres (16), minio (S3-compatible), fastpath (Rust sidecar), backend, frontend (nginx).

**Required env vars** (or compose will refuse to start): `JWT_SECRET`, `REDIS_PASSWORD`, `AUDIT_LOG_SECRET`, `DEVICE_COMMAND_SECRET`.

## ADR

Architecture Decision Records live in `docs/adr/`. Consult before making structural changes.

## CI

`.github/workflows/ci.yml`: single workflow with jobs: frontend-build → backend-test → rust-fastpath-check → docker-build → security-scan → release-verify. All run on push/PR to `master`. Node 18.
