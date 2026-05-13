# Serial Protocol

The board and Linux companion daemon communicate over a newline-delimited JSON protocol on `CDC-CTRL`.

## Design Goals

- Human-readable bring-up and bench debugging.
- Fail-closed for high-risk action confirmation.
- No host-generated confirmation accepted without a board signature.

## Frames From Companion To Board

```json
{"op":"hello","deviceId":"host-edge-01","request":"state"}
{"op":"command","deviceId":"host-edge-01","command":"collect","params":{},"envelope":{...}}
{"op":"command","deviceId":"gate-01","command":"physical_confirmation_required","params":{"gateId":"gate-01","sessionId":"...","actionId":"...","tenantId":"...","scope":"device","targetId":"server-01","commandType":"host_remove","payloadHash":"...","prompt":"Press the board confirm key to authorize host_remove","summary":{"payloadShortHash":"..."},"expiresAt":"2026-05-11T12:00:00.000Z"},"envelope":{...}}
```

## Frames From Board To Companion

```json
{"op":"state","version":"v1","chipModel":"ESP32-S3-WROOM-1","flashSize":8388608,"freeHeap":196608,"sdkVersion":"idf-5.x","externalPowerPresent":true,"secureElementPresent":true,"interlockState":"armed","hostActionState":"idle","publicKeyPem":"-----BEGIN PUBLIC KEY-----..."}
{"op":"heartbeat","cpuUsage":7,"memoryUsage":21,"freeHeap":188416}
{"op":"telemetry","timestamp":"2026-03-21T10:15:00.000Z","payload":{"pendingPhysicalApproval":true}}
{"op":"alert","alertType":"interlock_fault","message":"feedback input mismatch"}
{"op":"ota_status","otaJobId":"...","status":"installed","version":"v1.0.4"}
{"op":"physical_confirmation_ack","confirmationSessionId":"...","confirmed":true,"button":"confirm","issuedAt":"2026-05-11T11:58:00.000Z","expiresAt":"2026-05-11T12:00:00.000Z","monotonicCounter":42,"signature":"BASE64_SIGNATURE"}
```

## Signing Rules

- Message format is fixed to newline-joined fields:
  - `gateId`
  - `sessionId`
  - `actionId`
  - `tenantId`
  - `scope`
  - `targetId`
  - `commandType`
  - `payloadHash`
  - `issuedAt`
  - `expiresAt`
  - `monotonicCounter`
- The signature is ECDSA over SHA-256 using the private key protected by `ATECC608C`.
- The board increments `monotonicCounter` on every confirmed physical action.
- If the board does not have a provisioned key, it must reject confirmation locally and emit an `alert`.
- `payloadHash` must be computed from stable JSON serialization with sorted keys.
- `issuedAt` / `expiresAt` define a narrow validity window and are part of the signed material.

## Failure Behavior

- Invalid JSON is ignored by the companion and logged.
- Missing `signature`, stale `timestamp`, or non-increasing `monotonicCounter` causes control-plane rejection.
- If external DC is absent, the board may still acknowledge UI state, but it must report `interlockState=disabled`.
