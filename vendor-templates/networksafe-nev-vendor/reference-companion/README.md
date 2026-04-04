# Sanitized Reference Companion

This companion is a safe reference implementation.

Included:

- Device registration
- Heartbeat and telemetry emission
- Signed command verification with a test HMAC secret
- OTA status reporting against the mock control plane
- Physical confirmation acknowledgements with test ECDSA keys
- Optional stdin JSONL bridge for vendor board bring-up

Excluded:

- Production secrets
- Real host install/remove scripts
- Real OTA artifact download logic
- Internal approval, audit, and tenancy behavior

## Responsibilities

- Open a Socket.IO connection to the mock control plane
- Register the device and send heartbeat/data events
- Verify signed HMAC command envelopes before acting on them
- Emit OTA status updates
- Emit signed physical confirmation acknowledgements with test-only ECDSA material
- Optionally bridge newline-delimited JSON board frames from stdin

## Environment

- `MOCK_CONTROL_PLANE_URL`
- `MOCK_DEVICE_GATEWAY_PATH`
- `MOCK_DEVICE_ID`
- `MOCK_DEVICE_API_KEY`
- `MOCK_DEVICE_COMMAND_SECRET`
- `MOCK_AUTO_CONFIRM_COMMANDS`
- `PHYSICAL_CONFIRMATION_PRIVATE_KEY_FILE`
- `PHYSICAL_CONFIRMATION_PUBLIC_KEY_FILE`

## Board bridge contract

When wired to a board-side process over stdin/stdout JSONL, the companion expects the stable frame contract documented in `../contracts/serial-protocol.md`.

The companion must not:

- depend on internal repo paths
- pull real OTA artifacts
- embed production secrets
- emulate approval decisions that belong to the internal control plane
