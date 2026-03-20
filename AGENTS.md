# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

AetherGuard (formerly AetherGuard) - 智能服务器安全防御平台。基于 Agent 的分布式安全防御系统，采用"中心化控制 + 分布式执行"架构。

**Core Components:**
- **Control Plane**: Backend API + SQLite + Redis (pub/sub, caching)
- **Distributed Agents**: Node.js processes on Linux servers (attack detection, firewall control)
- **Frontend Dashboard**: React SPA for monitoring and management
- **ESP32 Dongles**: Hardware deployment tools (optional)

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
npx tsc --noEmit

# Security audit
npm audit --audit-level=high

# Tests
npm test                          # Run all tests
npm run test:coverage             # With coverage
npm run test:agents               # AI agents tests only
npm run demo:agents               # Run AI agents demo locally

# Database seeding (demo data)
npm run seed                      # Seed demo data
npm run seed:clear                # Clear demo data
npm run cleanup:demo:dry-run      # Preview cleanup
npm run cleanup:demo              # Execute cleanup
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
npx tsc --noEmit

# Security audit
npm audit --audit-level=high

# Preview production build
npm run preview
```

### TypeScript Version

- **Node.js**: v18+ (CI uses Node 18)

### Key Environment Variables

Copy `.env.example` to `.env`:

**Required for Docker:**
- `JWT_SECRET` - JWT signing key (min 32 chars)
- `REDIS_PASSWORD` - Redis authentication

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
┌─────────────────────────────────────────────────────────────┐
│                     Control Plane                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Backend   │  │   SQLite    │  │      Redis          │ │
│  │  (Node.js)  │  │  Database   │  │   (Pub/Sub + Cache) │ │
│  └──────┬──────┘  └─────────────┘  └─────────────────────┘ │
│         │                                                   │
│  ┌──────┴──────────────────────────────────────────────┐   │
│  │           WebSocket Gateways                        │   │
│  │  - AgentGateway (bi-directional with agents)        │   │
│  │  - DeviceGateway (ESP32 dongles)                    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
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
| `config/` | App mode, database connection, configuration |
| `database/` | SQLite initialization, migrations, models, seeds |
| `middleware/` | Auth, rate limiting, request timing |
| `scanner/` | Nuclei-based vulnerability scanning |
| `security/` | Input validation, authentication utilities |
| `services/` | Business logic (scanner-task, investigation, simulation) |
| `websocket/` | AgentGateway and DeviceGateway for real-time communication |
| `traffic-interceptor/` | Traffic analysis and interception |

**Key Entry Points:**
- `index.ts` - Server startup, WebSocket initialization, database connection
- `app.ts` - Express app configuration, middleware, route registration
- `agent-cli.ts` - Standalone agent CLI for distributed deployment

### Frontend Structure (`frontend/src/`)

| Directory | Purpose |
|-----------|---------|
| `components/` | Reusable UI components |
| `pages/` | Route pages (Dashboard, Agents, Sites, Devices, etc.) |
| `services/` | API client services |
| `context/` | React context providers |
| `utils/` | Helper functions |
| `types/` | TypeScript type definitions |
| `locales/` | i18n translation files |

### Key Technologies

- **Backend:** Express, Socket.IO, SQLite (sql.js), TypeScript, Jest
- **Frontend:** React 18, Vite, TailwindCSS, Recharts, Socket.IO Client, i18next
- **Infrastructure:** Docker, Redis, Nginx (for SSL/Let's Encrypt)
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

**Test Environment Variables** (auto-set by `npm test`):
- `NODE_ENV=test`
- `DISABLE_REDIS=true` (tests use in-memory fallback)
- `JWT_SECRET` and `AUDIT_LOG_SECRET` set to test values

**Jest Configuration Notes:**
- AI agents investigation tests are excluded from `npm test` (see `testPathIgnorePatterns` in `jest.config.js`)
- Use `npm run test:agents` for AI-specific tests
- Tests run with `maxWorkers: 1` and `forceExit: true` for stability

Key test files:
- `agent-gateway.test.ts` - WebSocket communication
- `attack-detector.test.ts` - Attack detection logic
- `auth.test.ts` - Authentication and authorization
- `firewall-controller.test.ts` - Firewall operations
- `nuclei-scanner.test.ts` - Vulnerability scanning
- `ai-agents/investigation/__tests__/investigation.test.ts` - AI agent tests (run separately)

## Deployment

### Docker Compose (Recommended)

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
- `backend` - Node.js API (port 3005)
- `frontend` - Nginx serving React SPA (port 8080)

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
