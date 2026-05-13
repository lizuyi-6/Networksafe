# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AetherGuard — 智能服务器安全防御平台。Agent-based distributed security with hardware-enforced safety gates for dangerous operations.

**Product claim**: "AetherGuard 完全最后防线". Engineering definition: **Final Defense Mode** is a detectable, auditable, fail-closed mode where the control plane can request and audit dangerous actions, but the final grant is enforced by hardware. The **root-resistant** variant moves the final network release decision outside the protected server into an external Network Isolation Gateway.

**Core Components:**
- **Control Plane**: Backend API + SQLite (sql.js / better-sqlite3) + Postgres (production) + Redis (pub/sub, caching)
- **Distributed Agents**: Node.js processes on Linux servers (attack detection, firewall control)
- **Local Companion**: Talks to Control Board v1 over serial; verifies signed local policies and hardware grants
- **Frontend Dashboard**: React SPA for monitoring and management
- **Rust Fastpath**: High-performance traffic processing sidecar
- **Hardware**: Control Board v1 (ESP32-S3 + ATECC608C) and Network Isolation Gateway v1 (external L2 bridge); legacy ESP32 serial deployer dongle still supported

## Quick Start

```bash
# Development with Docker Compose
docker-compose up -d --build

# Access points (Docker)
# Frontend: http://localhost:8080
# Backend API: http://localhost:3005
# Default credentials: admin / admin123

# Local development (without Docker)
cd backend && npm install && npm run dev    # Backend on :8080 (or $PORT)
cd frontend && npm install && npm run dev   # Frontend on :5173

# Note: Backend default port differs:
# - Docker: 3005 (mapped from container)
# - Local: 8080 (or PORT env var)
```

## Development Commands

### Backend (Node.js/TypeScript)

```bash
cd backend

# Install dependencies
npm install

# Development mode (auto-reload)
npm run dev

# Run agent CLI separately
npm run agent

# Build for production
npm run build

# Lint
npm run lint

# Type check (TypeScript validation)
npm run typecheck                 # Or: npx tsc --noEmit

# Security audit
npm audit --audit-level=high

# Tests
npm test                          # Run all tests (excludes AI agents tests)
npm run test:coverage             # With coverage
npm run test:agents               # AI agents tests only (excluded from npm test)
npm run test:core                 # Core module tests
npm run test:security             # Security module tests
npm run test:scanner              # Scanner module tests
npm run test:websocket            # WebSocket module tests
npm run test:services             # Services module tests
npm run test:agent                # Agent module tests
npm run test:utils                # Utility function tests
npm run test:routes               # Route tests
npm run test:controllers          # Controller tests
npm run demo:agents               # Run AI agents demo locally
npm run eval:owasp                # Run OWASP security evaluation

# Run specific test file
npx jest src/__tests__/agent-gateway.test.ts

# Run tests matching a pattern
npm test -- --testPathPattern="controller"

# Run tests in watch mode (development)
npx jest --watch

# Run with verbose output
npx jest --verbose --testNamePattern="should detect attacks"

# Database seeding (demo data)
npm run seed                      # Seed demo data
npm run seed:clear                # Clear demo data
npm run cleanup:demo:dry-run      # Preview cleanup
npm run cleanup:demo              # Execute cleanup
```

### Final Defense Focused Checks

These targeted Jest suites cover the hardware-gated path. Run them when touching final-defense, hardware, companion, or device-control code:

```bash
cd backend
npx jest src/__tests__/services/final-defense.service.test.ts
npx jest src/__tests__/services/hardware-authorization.service.test.ts
npx jest src/__tests__/services/deployment-run.service.test.ts
npx jest src/__tests__/services/device-control.service.test.ts
npx jest src/__tests__/companion/serial-device-companion.test.ts
```

### Frontend (React/Vite/TypeScript)

```bash
cd frontend

# Install dependencies
npm install

# Development mode
npm run dev

# Build for production
npm run build

# Lint
npm run lint

# Type check (TypeScript validation)
npm run typecheck                 # Or: npx tsc --noEmit

# Security audit
npm audit --audit-level=high

# Preview production build
npm run preview
```

### E2E Tests (Playwright)

```bash
cd e2e

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install --with-deps chromium

# Run all E2E tests
npm test

# Run release verification tests
npm run test:release

# Run with UI for debugging
npm run test:ui

# Debug specific test
npm run test:debug
```

### Rust Fastpath

```bash
cd rust-fastpath

# Run tests
cargo test

# Run linter
cargo clippy -- -D warnings

# Build release
cargo build --release
```

### Runtime Versions

- **Node.js**: v18+ (CI uses Node 18)
- **Rust**: 1.85.0 (for fastpath component)
- **TypeScript**: Configured in `tsconfig.json` (backend and frontend have separate configs)

## Database

The `DatabaseManager` (`backend/src/config/database.ts`) provides a dual-backend abstraction:

1. **sql.js** (priority): Loads entire DB into memory on startup. **Saves to disk every 30 seconds** via `setInterval`. Final save on `close()`. Uses `db.export()` + `fs.writeFileSync` for persistence.
2. **better-sqlite3** (fallback): Opens file directly with WAL mode and `foreign_keys = ON`.

Both are wrapped behind a unified `prepare()` / `run()` / `all()` / `get()` API.

**Important**: Since sql.js operates in-memory, direct file modifications (e.g. via `sqlite3` CLI or better-sqlite3 from a separate script) will be overwritten when the running backend saves. Always stop the backend process before modifying the database file directly, or modify it after startup via the running process's API.

### Key Environment Variables

Copy `.env.example` to `.env`:

**Required for Docker:**
- `JWT_SECRET` - JWT signing key (min 32 chars)
- `REDIS_PASSWORD` - Redis authentication
- `DEVICE_COMMAND_SECRET` - Device command signing key (min 24 chars)
- `ENCRYPTION_KEY` - Agent secrets encryption key (min 32 chars)
- `ENCRYPTION_SALT` - Agent secrets encryption salt (min 32 chars)

**Required for Production:**
- `AUDIT_LOG_SECRET` - Audit log signing key (min 32 chars, for tamper-evident logs)

**Optional:**
- `ADMIN_EMAIL`, `ADMIN_PASSWORD` - Initial admin credentials
- `VALID_API_KEYS` - Comma-separated API keys for agents
- `DEVICE_API_KEYS` - Keys for ESP32 devices
- `REDIS_URL` - Redis connection string (auto-set in Docker)
- `APP_MODE` - `production` or `demo`
- `ALLOWED_ORIGINS` - CORS origins (comma-separated)

**Agent CLI Variables** (for distributed agents):
- `AetherGuard_SERVER` - Control plane URL
- `AetherGuard_ONBOARDING_CODE` - One-time registration code
- `AetherGuard_AGENT_ID`, `AetherGuard_AGENT_API_KEY`, `AetherGuard_AGENT_SECRET_KEY` - Set after onboarding

## Architecture

### High-Level Structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Control Plane                                  │
│  ┌─────────────┐  ┌──────────────────┐  ┌─────────────────────────────┐ │
│  │   Backend   │  │  PostgreSQL/     │  │         Redis               │ │
│  │  (Node.js)  │  │    SQLite        │  │    (Pub/Sub + Cache)        │ │
│  └──────┬──────┘  └──────────────────┘  └─────────────────────────────┘ │
│         │                                                                │
│  ┌──────┴────────────────────────────────────────────────────────────┐  │
│  │                    WebSocket Gateways                              │  │
│  │  - AgentGateway (bi-directional with agents)                      │  │
│  │  - DeviceGateway (ESP32 dongles)                                  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────┐  ┌──────────────────────────────────────┐  │
│  │    Rust Fastpath       │  │       MinIO (S3-compatible)          │  │
│  │  (High-perf traffic)   │  │   (Artifacts + Audit Archives)       │  │
│  └────────────────────────┘  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                     │           │
           WebSocket │           │ HTTP/API
                     ▼           ▼
┌────────────────────────┐  ┌────────────────────────────────┐
│   Distributed Agents   │  │      Frontend Dashboard        │
│  (Node.js on servers)  │  │     (React + Vite)             │
│  - Attack Detection    │  │  - Real-time charts (Recharts) │
│  - Firewall Control    │  │  - Socket.IO for live updates  │
│  - Log Collection      │  │  - i18n support                │
│  - Traffic Monitoring  │  └────────────────────────────────┘
└────────────────────────┘
```

### AI Agents System (7-Layer Architecture)

The `ai-agents/` module implements a multi-agent decision system for AI-powered security analysis:

| Layer | Name | Purpose |
|-------|------|---------|
| L1 | Collaboration | Traffic routing to specialized agents |
| L2 | Role Playing | Socrates (Red Team), Plato (Blue Team), Aristotle (Analyst) |
| L3 | Scene Traversal | Distributed tracing and attack narrative |
| L4 | Capability | Safe tool execution |
| L5 | Debate | Multi-agent debate with arbitrator |
| L6 | Heterogeneous Model | Local (Ollama) + Cloud (Zhipu/GLM) model collaboration |
| L7 | Synthesis | Case files and self-evolution |

**Key Files:**
- `ai-agents/index.ts` - `MultiAgentDecisionSystem` main class
- `ai-agents/core/agent-orchestrator.ts` - Agent coordination
- `ai-agents/models/model-router.ts` - Routes between local/cloud models
- `ai-agents/investigation/` - Investigation agents (bug reproduction, code analysis, root cause)

### Backend Structure (`backend/src/`)

| Directory | Purpose |
|-----------|---------|
| `agent/` | Agent core logic: attack detection, firewall control, log collection, traffic monitoring |
| `ai-agents/` | Multi-agent AI system for threat analysis and decision making |
| `api/routes/` | REST API endpoints (agents, devices, auth, scanner, dashboard, etc.) |
| `config/` | App mode, database connection, runtime capabilities |
| `core/` | Core abstractions: API response utilities, tenant context, runtime health |
| `database/` | SQLite/PostgreSQL initialization, migrations, models, seeds |
| `middleware/` | Auth, rate limiting, request timing |
| `modules/` | Feature modules (modular architecture) |
| `scanner/` | Nuclei-based vulnerability scanning |
| `security/` | Input validation, authentication utilities |
| `services/` | Business logic (scanner-task, investigation, simulation, OWASP evaluation) |
| `websocket/` | AgentGateway and DeviceGateway for real-time communication |
| `traffic-interceptor/` | Traffic analysis and interception |
| `bootstrap/` | Application bootstrap and initialization |

**Key Entry Points:**
- `index.ts` - Server startup, WebSocket initialization, database connection
- `app.ts` - Express app configuration, middleware, route registration
- `agent-cli.ts` - Standalone agent CLI for distributed deployment

### Frontend Structure (`frontend/src/`)

| Directory | Purpose |
|-----------|---------|
| `components/` | Reusable UI components |
| `pages/` | Route pages (Dashboard, Agents, Sites, Devices, etc.) |
| `services/api.ts` | Centralized API client — **all backend calls must go through here** |
| `context/` | React context providers |
| `utils/` | Helper functions |
| `types/` | TypeScript type definitions |
| `locales/` | i18n translation files (`en.json`, `zh.json`) |

**Frontend API Pattern** (`services/api.ts`):
- `fetchWithCredentials()` wraps `fetch()` with `credentials: 'include'`. Auth tokens are in **httpOnly cookies**, not headers.
- `unwrapApiEnvelope<T>()` extracts `.data` from the standard `{ success, data, error, meta }` envelope.
- `extractErrorMessage()` extracts error messages from responses.
- Demo mode: many functions branch to `shouldUseDemoData()` with demo data generators.
- Error prefix convention: `FG-AUTH-LOGIN-401`, `FG-SYSTEM-MODE-500`, etc.
- All async functions accept optional `signal: AbortSignal`.

**Context Providers** (6 providers, wrapped in `App.tsx`):

| Provider | Purpose |
|----------|---------|
| `WebSocketProvider` | Socket.IO connection, event subscribe/emit, reconnection |
| `ThemeProvider` | Dark/light/system theme (`localStorage: vite-ui-theme`) |
| `LanguageProvider` | i18n toggle (en/zh), exposes `t()` and `toggleLanguage()` |
| `DemoProvider` | Demo mode toggle, `attackSimEnabled`, `dataSource` |
| `LiveModeProvider` | Live mode with auto-refresh (`localStorage: aetherguard-live-mode`) |
| `AttackStatusProvider` | Attack simulation status via WebSocket |

### Key Technologies

- **Backend:** Express, Socket.IO, SQLite (sql.js) / better-sqlite3, TypeScript, Jest
- **Frontend:** React 18, Vite, TailwindCSS, Recharts, Socket.IO Client, i18next
- **Performance:** Rust fastpath sidecar for high-throughput traffic processing
- **Infrastructure:** Docker, Redis, Nginx (for SSL/Let's Encrypt), MinIO (S3-compatible storage)
- **Hardware:** ESP32-WROOM-32 for deployment dongles

### WebSocket Communication

**AgentGateway** (`websocket/agent-gateway.ts`):
- Bi-directional Socket.IO connection between control plane and distributed agents
- Agent authentication via JWT or API key
- Rate limiting (Redis-backed with memory fallback)
- Command signing with HMAC for security
- Events: `agent:register`, `traffic:analyze`, `agent:command`, `threat:alert`

**DeviceGateway** (`websocket/device-gateway.ts`):
- ESP32 device registration and management
- Auto-registration when dongles are plugged into servers

## Testing Guidelines

```bash
# Run all tests
npm test

# Run specific test file
npx jest src/__tests__/agent-gateway.test.ts

# Run tests matching a pattern
npm test -- --testPathPattern="controller"

# Run tests in watch mode (development)
npx jest --watch

# Run with verbose output
npx jest --verbose --testNamePattern="should detect attacks"

# Run AI agents tests only
npm run test:agents
```

**Test Environment Variables** (auto-set by `jest.setup.js`):
- `NODE_ENV=test`
- `DISABLE_REDIS=true` (tests use in-memory fallback)
- `JWT_SECRET` and `AUDIT_LOG_SECRET` set to test values
- `DATA_DIR=./test-data` (isolated test database)

**Jest Configuration Notes:**
- AI agents investigation tests are excluded from `npm test` (see `testPathIgnorePatterns` in `jest.config.js`)
- Use `npm run test:agents` for AI-specific tests
- Tests run with `maxWorkers: 1` and `forceExit: true` for stability
- `testTimeout: 30000` (configured in `jest.config.js`)
- Database lifecycle: `jest.setup.db.js` provides `beforeAll`/`afterEach`/`afterAll` via `TestDatabaseManager`
- Modular test config: `jest.config.modular.js` — run by module via `TEST_MODULE` env var

Key test files:
- `agent-gateway.test.ts` - WebSocket communication
- `attack-detector.test.ts` - Attack detection logic
- `auth.test.ts` - Authentication and authorization
- `firewall-controller.test.ts` - Firewall operations
- `nuclei-scanner.test.ts` - Vulnerability scanning
- `ai-agents/investigation/__tests__/investigation.test.ts` - AI agent tests (run separately)

## Deployment

### Production Server

The production server at `39.102.81.78` runs:
- **Frontend**: Nginx serving `/var/www/aetherguard/dist/` (port 80)
- **Backend**: Node.js process started via `nohup node dist/index.js` (port 3005)
- **Database**: sql.js in-memory with 30-second disk persistence at `/opt/aetherguard/backend/data/newsecurity.db`
- **No systemd service** — manual process management

Deployment workflow:
```bash
# Build frontend, create tar, upload, extract
cd frontend && npm run build && rm -f dist.tar && tar -cvf dist.tar dist/
scp -i key.pem dist.tar root@server:/var/www/aetherguard/
ssh root@server "cd /var/www/aetherguard && rm -rf dist && tar -xvf dist.tar"

# Build backend, create tar, upload, extract, restart
cd backend && npm run build && rm -f dist.tar && tar -cvf dist.tar dist/
scp -i key.pem dist.tar root@server:/opt/aetherguard/backend/
ssh root@server "pkill -f 'node dist/index'; sleep 2; cd /opt/aetherguard/backend && rm -rf dist && tar -xvf dist.tar && nohup node dist/index.js > /var/log/aetherguard/backend.log 2>&1 &"
```

### Docker Compose (Development)

```bash
# Build and start all services
docker-compose up -d --build

# View logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Stop services
docker-compose down

# Stop and remove volumes (clean slate)
docker-compose down -v
```

Services:
- `redis` - Redis 7 (port 6379)
- `postgres` - PostgreSQL 16 (port 15432)
- `minio` - S3-compatible object storage (port 19000, console 19001)
- `fastpath` - Rust high-performance traffic processor (internal)
- `backend` - Node.js API (port 3005)
- `frontend` - Nginx serving React SPA (port 8080)

**Note:** Docker Compose requires these environment variables to be set:
- `JWT_SECRET`, `REDIS_PASSWORD`, `DEVICE_COMMAND_SECRET`, `AUDIT_LOG_SECRET`

### Agent Installation (Linux servers)

1. Configure `/etc/AetherGuard/agent.env`:
   - `AetherGuard_SERVER` - Control plane URL
   - `AetherGuard_ONBOARDING_CODE` - One-time onboarding code from admin API

2. Install systemd service:
```bash
cp deployment/production/AetherGuard-agent.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now AetherGuard-agent
```

3. Verify:
```bash
systemctl status AetherGuard-agent
journalctl -u AetherGuard-agent -f
```

### ESP32 Deployment Dongle

See `esp32/platformio.ini` for hardware specs. The dongle auto-registers when plugged into a server and executes deployment scripts via USB serial.

## API Key Patterns

- Agent API keys: `AetherGuard_test_key_*`, `agent_*`
- Device API keys: `device_key_*`, `AetherGuard-device-*`
- Default demo keys are in `.env.example`

## Security Features

The system implements multiple security layers:

- **Input Validation**: `security/input-validator.ts` detects SQL injection, XSS, path traversal
- **Rate Limiting**: Redis-backed with memory fallback (`middleware/rate-limit.middleware.ts`)
- **Command Signing**: HMAC-based command verification (`security/command-signing.service.ts`)
- **Audit Logging**: Tamper-evident audit logs (`security/audit-logger.service.ts`)
- **CORS**: Strict origin validation in production mode

## Development Constraints

### Route Registration

All API routes are registered in `backend/src/bootstrap/control-plane-app.ts` → `createControlPlaneApp()`, mounted on `apiRouter` at `/api`. Health endpoints (`/health`, `/health/live`, `/health/ready`) are registered directly and are not gated by `apiEnabled`.

Route modules (23 total): stats, config, logs, sites, admin, scanner, smart-fix, deployments, agents, devices, ai-endpoints, auth, ai-system, traffic, attack, alerts, system, agent-onboarding, dashboard, fix-history, investigation, seed, pipeline, rules.

### Database Access Rules
- **禁止在 `backend/src/api/routes` 中直接访问数据库** - 必须通过 repositories 或 services
- SQLite 写入是当前唯一的数据库后端（sql.js 或 better-sqlite3）
- `DB_MODE=postgres` 在 `.env` 中配置但 Postgres 实现尚未集成到 database.ts

### Schema Initialization
- **不能在请求或 WebSocket 处理器中调用 `ensureSchema()`**
- 服务拥有的表必须在 `backend/src/bootstrap/persistence.ts` 中准备
- 运行时诊断必须是只读的

### API Response Format
- 必须使用 `backend/src/core/http/api-response.ts` 中的 `sendSuccess` 和 `sendError`
- 成功响应: `{ success: true, data, error: null, meta? }`
- 失败响应: `{ success: false, data: null, error, code, message, meta? }`

### Frontend API Calls
- **只能通过 `frontend/src/services/api.ts` 调用后端 API**
- 禁止在前端代码中直接使用 `fetch('/api...')`

### Release Guard Scripts

```bash
# 检查路由层是否直接访问数据库
node scripts/guards/check-route-db-access.mjs

# 检查前端是否直接调用 /api
node scripts/guards/check-no-direct-api-fetch.mjs
```

### Backend Modules (`backend/src/modules/`)

Feature modules encapsulate persistence helpers and schema setup:

| Module | Contents |
|--------|----------|
| `admin/` | `admin.repository.ts` — user management, role/plan/status updates |
| `agent-onboarding/` | `agent-onboarding.repository.ts`, `agent-onboarding.schema.ts` |
| `auth/` | `auth-user.repository.ts` — user lookup, password verification |
| `deployments/` | `deployment-profile.repository.ts` |
| `pipeline/` | `pipeline-diagnostics.service.ts` |
| `scanner/` | `scanner-route.repository.ts` |
| `sites/` | `site.repository.ts` |

Per ADR, `services/` files remain integration-heavy until gradually migrated behind module boundaries.

### Detection Pipeline

The `services/detection-pipeline.service.ts` and `services/detection-engine.ts` implement rule-based threat detection:
- Rule matching with configurable severity levels
- AI escalation for suspicious traffic
- Attack family classification (SQL injection, XSS, path traversal, command injection, etc.)
- Candidate rule suggestions for new attack patterns

### Final Defense Mode

Final Defense Mode treats the backend, database, and API request as potentially untrusted for high-risk actions. High-risk actions (`host_remove`, `wipe_data`, `factory_reset`, `recovery_flash`, `critical_config_change`) must satisfy ALL of:

- Local companion reads a signed local policy from `/etc/aetherguard/final-defense-policy.json`.
- Action, target, script path, release window, and interlock target are in the local policy allow-list.
- Hardware grant signature verifies against the provisioned hardware public key.
- Grant message includes and matches `policyDigest`, `challenge`, `breakerTarget`, `interlockAction`, payload hash, expiry, and monotonic counter.
- Interlock feedback is healthy and matches the expected state.

Interlock states are normalized as `'isolated' | 'armed' | 'released' | 'fault' | 'disabled' | 'unknown'`. Legacy `asserted` maps to `isolated`. **Failure is fail-closed**: signature failure, counter rollback, policy digest mismatch, expired grant, missing external DC, feedback mismatch, board disconnect, or heartbeat loss returns the management link to `isolated`.

Final Defense API routes:
- `GET /api/final-defense/status`
- `POST /api/final-defense/policies`
- `POST /api/final-defense/actions`
- `POST /api/final-defense/gateways/status/report`
- `POST /api/final-defense/gateways/actions`

### Root-Resistant Final Defense

Threat model: protected server OS, local agent, local companion, scripts, and host logs may all be controlled by an attacker with root. The trusted boundary is the **external Network Isolation Gateway v1** — a dual 1GbE RJ45 transparent L2 bridge with `SERVER`, `LAN/WAN`, and independent `MGMT` ports. The `SERVER`↔`LAN/WAN` bridge is fail-closed; `isolated` blocks protected-server forwarding while preserving the gateway's own management channel. The gateway holds signed policy state, hardware identity, firmware measurement, and secure-element-backed release grants outside the protected server.

UI may show "root-resistant active" only when ALL of: external gateway present, policy digest match, firmware digest + attestation, secure element provisioned, both data ports linked, independent management path, and healthy `armed` or `isolated` bridge state. The claim only covers links physically cabled through the gateway; out-of-band BMC, Wi-Fi, spare NICs, local console, direct storage damage, and host disk encryption by root are outside v1 protection.

### Hardware

| Hardware | Status | Role |
|---|---|---|
| Legacy ESP32 serial deployment dongle | Supported | Physical confirmation for local deployment/removal over USB-TTL serial; uses `AG:REQ:*` allow-list protocol (`AG:BEGIN/*`, `AG:STEP/*`, `AG:OK/*`, `AG:ERR/*`) |
| Control Board v1 | Control-plane-compromise defense | ESP32-S3 + ATECC608C, isolated interlock output and feedback for local hardware grants |
| Network Isolation Gateway v1 | Root-resistant target | External dual-port 1GbE transparent L2 gateway controlling protected-server network release outside the host |

Control Board v1 protocol is newline-delimited JSON:
- Companion → board: `hello`, `command physical_confirmation_required`, `command interlock_assert`, `command interlock_release`
- Board → companion: `state`, `heartbeat`, `alert`, `physical_confirmation_ack`, `interlock_result`

The legacy ESP32 deployment dongle's `AG:REQ:*` protocol is separate from Control Board v1.

### Production Rules

- `DB_MODE=postgres` is **required** for production (SQLite is dev/demo only).
- `DISABLE_REDIS` must NOT be enabled in production.
- Do NOT call `ensureSchema()` in request handlers or WebSocket processors — prepare service-owned tables in `backend/src/bootstrap/persistence.ts`.
- Do NOT commit generated outputs, KiCad scratch trees, router exchange files, probe reports, or generated PPTX decks.
- Demo / pitch-only frontend routes (e.g. `/aetherguard-deck`) are disabled by default. Set `VITE_ENABLE_PITCH_ROUTES=true` only for local demo builds.
- Large generated artifacts and hardware experiment intermediates have been moved to `X:\repos\Networksafe-archive\20260513-pre-cleanup`. See `docs/artifact-archive-index.md` for the manifest.

### Architecture Decision Records (ADR)

架构决策记录位于 `docs/adr/`:
- `2026-03-12-api-envelope-compatibility.md` - API 响应格式统一
- `2026-03-12-module-boundaries-bootstrap-core-modules-integrations.md` - 模块边界划分
- `2026-03-12-postgres-primary-write-path.md` - Postgres 主写路径
- `2026-03-12-startup-entrypoint-unification.md` - 启动入口统一
- `2026-03-14-esp32-serial-deployer-wiring-baseline.md` - ESP32 跳线原型接线基线
