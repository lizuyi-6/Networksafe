# Mock Control Plane

This service is the only backend the vendor may target.

It provides:

- Socket.IO device gateway on `/ws/device`
- HTTP APIs for OTA dispatch and physical confirmation session creation
- In-memory device state, OTA job state, and confirmation session state
- Test-only endpoints for negative-path confirmation validation

It intentionally excludes tenancy, production persistence, audit sinks, and deployment logic.

## Stable HTTP surface

- `GET /health`
- `GET /api/dashboard/events`
- `GET /api/devices`
- `GET /api/devices/:id/state`
- `POST /api/devices/:id/ota`
- `POST /api/devices/:id/confirm-required-action`
- `GET /api/ota-jobs/:id`
- `GET /api/confirmation-sessions/:id`
- `POST /api/test/devices/:id/physical-confirmation-ack`

## Stable Socket.IO surface

- Incoming from device: `register`, `heartbeat`, `data`, `alert`, `ota_status`, `physical_confirmation_ack`
- Outgoing to device: signed `command` envelopes

## Notes

- This service is the only allowed target for vendor development and acceptance.
- The negative-path confirmation endpoint exists only for automated verification.
- Production approval, audit, and tenancy behavior remain internal and are intentionally absent here.
