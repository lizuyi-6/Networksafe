# Command Envelope Contract

The mock and production control planes classify commands into three groups.

## Command Classes

- `auto`: may run immediately after control-plane authorization
- `approval_required`: requires internal platform approval before dispatch
- `physical_confirmation_required`: requires internal approval plus on-device physical confirmation

## Current Baseline

### Auto

- `collect`
- `sync-config`
- `host_backup`

### Approval Required

- `host_install`

### Physical Confirmation Required

- `reboot`
- `host_remove`
- `recovery_flash`
- `factory_reset`
- `diagnostic_unlock`
- `vehicle_ota_flash`
- `cellular_breaker_assert`
- `cellular_breaker_release`

## Signed Device Command Envelope

Every command sent from the control plane to a device is wrapped in an HMAC-SHA256 envelope.

```json
{
  "deviceId": "nev-demo-001",
  "command": {
    "cmd": "ota_update",
    "params": {
      "otaJobId": "job-1",
      "firmwareId": "fw-1",
      "version": "v1.0.4",
      "channel": "stable",
      "artifactRef": "mock://firmware/fw-1",
      "fileName": "fw-v1.0.4.bin"
    },
    "timestamp": 1760000000000,
    "nonce": "52fa8b4d"
  },
  "signature": "hex-hmac"
}
```

## Physical Confirmation Signing Rules

The confirmation message is the newline-joined tuple:

1. `deviceId`
2. `confirmationSessionId`
3. `commandType`
4. `payloadHash`
5. `monotonicCounter`
6. `timestamp`

`payloadHash` is SHA-256 of a stable JSON serialization with sorted object keys.

The vendor repository ships test-only ECDSA keys under `contracts/test-keys/`.
Those keys exist only for local integration and acceptance tests.
