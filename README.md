# AetherGuard

AetherGuard is a server security platform with a control plane, distributed host agents, a Rust fastpath sidecar, and hardware-backed safety gates for dangerous operations.

Product claim: **AetherGuard 完全最后防线**. Engineering definition: Final Defense Mode is a detectable, auditable, fail-closed mode where the control plane can request and audit dangerous actions, but the final grant is enforced by hardware. The root-resistant variant moves that final network release decision outside the protected server into an external Network Isolation Gateway.

## Quick Start

```bash
# Docker, all services
docker-compose up -d --build

# Frontend: http://localhost:8080
# Backend:  http://localhost:3005
# Development credentials: admin / admin123
```

Local development:

```bash
cd backend
npm install
npm run dev

cd frontend
npm install
npm run dev
```

Release-relevant checks:

```bash
cd backend && npm run typecheck
cd frontend && npm run typecheck
node scripts/guards/check-route-db-access.mjs
node scripts/guards/check-no-direct-api-fetch.mjs
```

Focused Final Defense checks:

```bash
cd backend
npx jest src/__tests__/services/final-defense.service.test.ts
npx jest src/__tests__/services/hardware-authorization.service.test.ts
npx jest src/__tests__/services/deployment-run.service.test.ts
npx jest src/__tests__/services/device-control.service.test.ts
npx jest src/__tests__/companion/serial-device-companion.test.ts
```

## Architecture

```mermaid
flowchart LR
    User["Operator / API Client"] --> Frontend["React Console"]
    Frontend --> Backend["Node.js Control Plane"]
    Backend --> DB["SQLite / PostgreSQL"]
    Backend --> Redis["Redis"]
    Backend --> Agent["Host Agent"]
    Agent --> Fastpath["Rust Fastpath"]
    Agent --> Companion["Local Companion"]
    Companion --> Board["Control Board v1"]
    Board --> Interlock["Management Link Interlock"]
    Agent --> ServerNIC["Server Network Ports"]
    ServerNIC --> NIGW["Network Isolation Gateway v1"]
    NIGW --> Network["LAN / WAN"]
    NIGW --> Mgmt["Independent MGMT / Cellular"]
```

Primary components:

| Path | Purpose |
| --- | --- |
| `backend/` | Express API, Socket.IO gateways, services, repositories, companion logic, tests |
| `frontend/` | React console, typed API client, pages, demo data |
| `rust-fastpath/` | High-throughput traffic processing sidecar |
| `e2e/` | Playwright release and UI verification |
| `esp32/` | Legacy ESP32 serial deployment firmware |
| `deployment/` | Production helper scripts and deploy bundles |
| `hardware/aetherguard-control-board-v1/` | Final Defense hardware baseline |
| `hardware/aetherguard-network-isolation-gateway-v1/` | Root-resistant external L2 gateway hardware baseline |
| `hardware/factory/aetherguard-serial-deployer-ev1/` | Legacy serial deployer factory package |
| `hardware/kicad/esp32-serial-deployer-pcb/` | KiCad source for the legacy serial deployer PCB |
| `docs/` | Architecture, product, readiness, and archive index documents |

## Final Defense Mode

Final Defense Mode treats the backend, database, and API request as potentially untrusted for high-risk actions.

High-risk actions such as `host_remove`, `wipe_data`, `factory_reset`, `recovery_flash`, and `critical_config_change` must satisfy all of the following:

- The local companion reads a signed local policy from `/etc/aetherguard/final-defense-policy.json`.
- The requested action, target, script path, release window, and interlock target are in the local policy allow-list.
- The hardware grant signature verifies against the provisioned hardware public key.
- The grant message includes and matches `policyDigest`, `challenge`, `breakerTarget`, `interlockAction`, payload hash, expiry, and monotonic counter.
- Interlock feedback is healthy and matches the expected state.

Interlock states are normalized as:

```ts
type InterlockState = 'isolated' | 'armed' | 'released' | 'fault' | 'disabled' | 'unknown';
```

Legacy `asserted` is mapped to `isolated`.

Failure behavior is closed by default: signature failure, counter rollback, policy digest mismatch, expired grant, missing external DC, feedback mismatch, board disconnect, or heartbeat loss keeps or returns the management link to `isolated`.

The external product statement is conditional. “完全最后防线” is only valid when the management link is actually wired through the interlock, Final Defense Mode is enabled, the local policy is signed, the secure element is provisioned, and companion plus board health are confirmed. v1 controls the low-voltage network or management link only; it does not switch mains power or directly cut production host power.

## Root-Resistant Final Defense

Root-resistant mode assumes the protected server OS, local agent, local companion, scripts, and host logs may be fully controlled by an attacker with root. In that threat model, the trusted boundary is no longer the host companion. It is the external Network Isolation Gateway v1:

- Dual 1GbE RJ45 transparent L2 bridge with `SERVER`, `LAN/WAN`, and independent `MGMT` ports; cellular is an optional management path.
- The `SERVER` to `LAN/WAN` bridge is fail-closed. `isolated` blocks protected server forwarding while preserving the gateway's own management channel.
- The gateway holds signed policy state, hardware identity, firmware measurement, and secure-element backed release grants outside the protected server.
- Strong “root-resistant active” status requires an external gateway, policy digest match, firmware digest plus attestation, secure element, both data ports linked, independent management path, and a healthy `armed` or `isolated` bridge state.
- The claim only covers network links physically cabled through the gateway. Out-of-band BMC, Wi-Fi, spare NICs, local console, direct storage damage, and host disk encryption by root are outside v1 protection unless separately controlled.

## Hardware Shapes

| Hardware | Status | Role |
| --- | --- | --- |
| ESP32 serial deployment dongle | Legacy supported | Physical confirmation for local deployment and removal workflows over USB-TTL serial |
| Control Board v1 | Control-plane-compromise defense | ESP32-S3, ATECC608C, isolated interlock output and feedback for local hardware grants |
| Network Isolation Gateway v1 | Root-resistant Final Defense target | External dual-port 1GbE transparent L2 gateway that controls protected server network release outside the host |

Board protocol for Control Board v1 is newline-delimited JSON:

- Companion to board: `hello`, `command physical_confirmation_required`, `command interlock_assert`, `command interlock_release`
- Board to companion: `state`, `heartbeat`, `alert`, `physical_confirmation_ack`, `interlock_result`

The legacy ESP32 deployment dongle uses the `AG:REQ:*` allow-list protocol and remains separate from Control Board v1.

## API Surface

Final Defense API routes:

- `GET /api/final-defense/status`
- `POST /api/final-defense/policies`
- `POST /api/final-defense/actions`
- `POST /api/final-defense/gateways/status/report`
- `POST /api/final-defense/gateways/actions`

Route handlers must use `sendSuccess()` and `sendError()` from `backend/src/core/http/api-response.ts`. Route files under `backend/src/api/routes/` must not access the database directly; use services or repositories.

Frontend API calls must go through `frontend/src/services/api.ts`.

## Validation Status

Validated in the current production baseline:

- Backend and frontend typechecks for the Final Defense implementation.
- Route DB access guard.
- Frontend direct API fetch guard.
- Focused Jest coverage for hardware grant signing, Final Defense service policy checks, companion denial of untrusted scripts, deployment run, and device control paths.
- UI status model for root-resistant “Final Defense Active” only when an external Network Isolation Gateway v1 reports secure element, matching policy digest, firmware attestation, linked data ports, independent management path, and healthy bridge state.

Not yet validated in this workspace:

- Real Control Board v1 hardware-in-the-loop release and feedback test.
- Secure element provisioning ceremony on physical ATECC608C.
- Real Network Isolation Gateway v1 hardware-in-the-loop bridge isolation and release test.
- Secure boot / measured boot chain for physical gateway firmware.

## Production Rules

- Do not call `ensureSchema()` in request handlers or WebSocket processors. Prepare service-owned tables in `backend/src/bootstrap/persistence.ts`.
- `DB_MODE=postgres` is required for production.
- `DISABLE_REDIS` must not be enabled in production.
- Do not commit generated outputs, KiCad scratch trees, router exchange files, probe reports, or generated PPTX decks.
- Demo and pitch-only frontend routes such as `/aetherguard-deck` are disabled by default. Set `VITE_ENABLE_PITCH_ROUTES=true` only for local demo builds.

## Artifact Archive

Large generated artifacts and hardware experiment intermediates were moved out of the repository to:

```text
X:\repos\Networksafe-archive\20260513-pre-cleanup
```

See `docs/artifact-archive-index.md` for the archive categories and file-level manifest location.

## License

MIT. See `LICENSE`.
