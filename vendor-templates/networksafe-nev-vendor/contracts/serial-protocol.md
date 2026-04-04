# Serial Protocol Contract

New hardware boards talk to the Linux companion over newline-delimited JSON on the control channel.

## Goals

- Human-readable bench debugging
- Fail-closed confirmation flow for high-risk commands
- Stable frame schema that can be implemented without access to the private control plane

## Frames Sent From Companion To Board

```json
{"op":"hello","deviceId":"nev-demo-001","request":"state"}
{"op":"command","deviceId":"nev-demo-001","command":"collect","params":{},"envelope":{"timestamp":1760000000000,"nonce":"abc123","signature":"..."}}
{"op":"command","deviceId":"nev-demo-001","command":"physical_confirmation_required","params":{"confirmationSessionId":"sess-1","commandType":"host_remove","payloadHash":"...","prompt":"Press confirm to authorize host_remove"},"envelope":{"timestamp":1760000000001,"nonce":"abc124","signature":"..."}}
```

## Frames Sent From Board To Companion

```json
{"op":"state","version":"v1-nev-alpha","chipModel":"NEV-MCU-01","flashSize":8388608,"freeHeap":196608,"sdkVersion":"idf-5.x","externalPowerPresent":true,"secureElementPresent":true,"interlockState":"armed","hostActionState":"idle","publicKeyPem":"-----BEGIN PUBLIC KEY-----..."}
{"op":"heartbeat","cpuUsage":7,"memoryUsage":21,"freeHeap":188416}
{"op":"telemetry","timestamp":"2026-03-30T10:15:00.000Z","payload":{"pendingPhysicalApproval":false,"vehicleState":"ready"}}
{"op":"alert","alertType":"interlock_fault","message":"feedback mismatch"}
{"op":"ota_status","otaJobId":"job-1","status":"installed","version":"v1.0.4"}
{"op":"physical_confirmation_ack","confirmationSessionId":"sess-1","confirmed":true,"button":"confirm","timestamp":1760000000200,"monotonicCounter":4,"signature":"BASE64_SIGNATURE"}
```

## Required Events Exposed To The Vendor

- `register`
- `heartbeat`
- `data`
- `alert`
- `ota_status`
- `physical_confirmation_ack`

## Failure Rules

- Invalid JSON is ignored and logged by the companion.
- Missing required confirmation fields must be rejected.
- Stale timestamps, non-increasing counters, or invalid signatures must fail closed.
- The vendor must never invent undocumented frame shapes.
