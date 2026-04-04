# networksafe-nev-vendor

Restricted vendor repository template for a new NEV hardware program.

## Purpose

This repository is the only codebase an external hardware vendor should receive.
It intentionally excludes:

- Control-plane authentication and tenancy code
- Production audit logging and rate limiting internals
- Real API keys, device keys, and customer data
- AI agents, scanners, and unrelated dashboard modules
- Production migration history and full database internals
- Current `control board v1` KiCad, gerbers, BOM, and other proto hardware release assets

## What The Vendor Owns

- Hardware design files for the vendor-owned NEV device
- Firmware and local board logic
- Linux companion or equivalent local bridge
- Integration against the mock control plane in this repository
- Acceptance evidence under `deliverables/`

## What Stays Internal

- The real `DeviceGateway`
- The real OTA artifact store
- Real physical confirmation verification and approval flow
- Authentication, auditing, tenancy, deployment, and release operations

## V1 Stability Boundary

The following surfaces are the v1 external contract and must remain backward compatible:

- Stable contracts under `contracts/`
- Mock control plane under `mock-control-plane/`
- Sanitized companion under `reference-companion/`
- Black-box acceptance flow under `acceptance-tests/`

### Stable device events

- `register`
- `heartbeat`
- `data`
- `alert`
- `ota_status`
- `physical_confirmation_ack`

### Stable mock HTTP APIs

- `GET /health`
- `GET /api/dashboard/events`
- `GET /api/devices`
- `GET /api/devices/:id/state`
- `POST /api/devices/:id/ota`
- `POST /api/devices/:id/confirm-required-action`
- `GET /api/ota-jobs/:id`
- `GET /api/confirmation-sessions/:id`

### Stable command classes

- `auto`: `collect`, `sync-config`, `host_backup`
- `approval_required`: `host_install`
- `physical_confirmation_required`: `reboot`, `host_remove`, `recovery_flash`, `factory_reset`, `diagnostic_unlock`, `vehicle_ota_flash`, `cellular_breaker_assert`, `cellular_breaker_release`

### Physical confirmation rules

- The confirmation message is the newline-joined tuple `deviceId`, `confirmationSessionId`, `commandType`, `payloadHash`, `monotonicCounter`, `timestamp`.
- Timestamp drift, non-increasing counters, and invalid signatures must fail closed.
- Test-only ECDSA material under `contracts/test-keys/` is for local integration only and must never be used outside development.

## Quick Start

```bash
cp .env.example .env
npm install
npm run dev:mock-control-plane
npm run dev:companion
npm run typecheck
npm run test:acceptance
```

## Layout

- `contracts/`: stable interfaces the vendor may depend on
- `mock-control-plane/`: in-memory Socket.IO + HTTP mock for development
- `reference-companion/`: sanitized companion reference implementation
- `acceptance-tests/`: black-box acceptance flow against the mock control plane
- `deliverables/`: required evidence templates for the final handoff

## Validation

Before submitting any handoff package:

```bash
npm run validate
```

This repository is considered ready for internal review only when `typecheck` and `test:acceptance` both pass.

## Deliverables

The vendor must fill in the templates under `deliverables/` with:

- Firmware release and flashing instructions
- Companion package details
- Acceptance logs and exact command output
- Screenshots or recordings for board-side evidence
- Change requests for any contract drift

## Handoff Rules

- Do not add production secrets to this repository.
- Do not depend on internal repo paths or symbols.
- Request interface changes through a documented change request, not by editing hidden internal systems.
- Do not add proto board CAD from the internal control-plane repository to this repository.
