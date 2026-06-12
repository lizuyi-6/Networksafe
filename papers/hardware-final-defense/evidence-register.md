# Evidence Register

Generated for the AetherGuard hardware-gated authorization manuscript on
2026-05-26.

## Current Local Verification

The following commands were run in this workspace on 2026-05-26:

```powershell
cd X:\repos\Networksafe\backend
npx jest src/__tests__/services/hardware-authorization.service.test.ts src/__tests__/services/final-defense.service.test.ts --runInBand
```

Result: 2 test suites passed, 8 tests passed.

```powershell
cd X:\repos\Networksafe
node scripts/guards/check-route-db-access.mjs
node scripts/guards/check-no-direct-api-fetch.mjs
```

Result: both guards passed.

## Claim Traceability

| Manuscript claim | Evidence source |
| --- | --- |
| High-risk command classes are mapped to physical confirmation requirements | `backend/src/security/command-risk-policy.ts` |
| Hardware grants bind action, tenant, scope, target, command type, payload hash, optional policy digest, challenge, breaker target, interlock action, expiry, and monotonic counter | `backend/src/security/hardware-grant.ts` |
| Hardware grant signatures are verified using SHA-256 with the registered public key, with legacy fallback only for grants without extended final-defense fields | `backend/src/security/hardware-grant.ts` |
| Hardware authorization maintains gate enrollment, command intent, confirmation session, and hardware grant records | `backend/src/services/hardware-authorization.service.ts` |
| Tampered final-defense context is rejected before dispatch | `backend/src/__tests__/services/hardware-authorization.service.test.ts` |
| Final Defense policy digests cover policy id, tenant, companion, gate, allowed actions, breaker target, release TTL, creation time, and status | `backend/src/security/final-defense-policy.ts` |
| Final Defense status is active only when policy digest, external power, secure element, feedback, companion freshness, and interlock state are acceptable | `backend/src/services/final-defense.service.ts`; `backend/src/__tests__/services/final-defense.service.test.ts` |
| Root-resistant high-risk actions require an active external gateway before request creation succeeds | `backend/src/services/final-defense.service.ts`; `backend/src/__tests__/services/final-defense.service.test.ts` |
| External gateway health requires policy digest match, firmware digest, attestation timestamp, secure element, linked server and LAN ports, independent management path, and healthy bridge state | `backend/src/services/final-defense.service.ts`; `backend/src/__tests__/services/final-defense.service.test.ts` |
| Final Defense HTTP routes use envelope helpers and call services rather than direct route-level SQL | `backend/src/api/routes/final-defense.routes.ts`; `scripts/guards/check-route-db-access.mjs` |
| Device gateway supports registration, heartbeat, OTA status, physical confirmation ack, rate limiting, API-key validation, command signing, and audit logging | `backend/src/websocket/device-gateway.ts`; `backend/src/__tests__/websocket/device-gateway.test.ts` |
| The legacy ESP32 serial deployer implements a local UI state machine with confirmation states for install and uninstall | `esp32/src/main.cpp`; `docs/adr/2026-03-14-esp32-serial-deployer-wiring-baseline.md` |
| Current validated workspace evidence includes Docker runtime, simulated ESP32-compatible physical confirmation flow, deployment bundle validation, object-lock audit-chain verification, and a smoke fastpath snapshot | `docs/reports/validated-capability-status-2026-03-08.md`; `docs/reports/deployment-bundle-validation-2026-03-08.md`; `docs/reports/local-platform-acceptance-2026-03-08.md` |
| Release readiness was not go for external Linux binary-agent lifecycle validation | `docs/reports/release-readiness-2026-03-08.md` |

## Claims Explicitly Excluded

The manuscript must not claim any of the following without new evidence:

- Real Gateway Appliance security controller hardware-in-the-loop release and feedback validation.
- Secure element provisioning ceremony on a physical ATECC608C.
- Real Root-Resistant Gateway Appliance bridge isolation and release validation.
- Secure boot or measured boot chain for physical gateway firmware.
- Production deployment across real customer servers.
- 100,000+ QPS, sub-10 ms local AI latency, below-2% CPU, or below-50 MB agent memory.
- Unconditional "complete final defense" against all root-compromise scenarios.

