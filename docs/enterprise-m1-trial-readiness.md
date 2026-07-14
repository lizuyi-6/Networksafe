# AetherGuard Enterprise M1 Trial Readiness

Status: engineering-complete pending real HIL validation.

## Production Authority

M1 treats the production destructive-operation path as:

1. Control plane creates a tenant-scoped `deployment_run`.
2. Linux serial helper registers and attests host facts.
3. Helper executes `AG:REQ:BACKUP` from a signed bundle before approval.
4. Operator requests approval after backup completion.
5. ESP32 gate confirms `runId`, action, and checksum short code.
6. Control plane records the hardware grant and marks the run `approved`.
7. Helper executes `AG:REQ:INSTALL` or `AG:REQ:REMOVE`.
8. Control plane writes an evidence pack.

`/ws/device` and `/ws/status` remain experimental/status paths. In enterprise runtime, high-risk commands requiring physical confirmation are rejected there and must go through deployment runs.

## Runtime Baseline

Enterprise production uses:

- `AETHERGUARD_RUNTIME_MODE=prod-enterprise`
- `DB_MODE=postgres`
- `DISABLE_SQLITE_FALLBACK=true`
- `ARTIFACT_STORE=s3`
- `DEPLOYMENT_BUNDLE_SIGNING_SECRET`
- `SERIAL_HELPER_SHARED_SECRET` or `DEVICE_COMMAND_SECRET`
- OIDC configured for normal login

Local password login is denied for every role by default. Operators must explicitly set `ALLOW_BREAK_GLASS_PASSWORD_LOGIN=true` before the runtime reports or accepts local password login; otherwise an enterprise OIDC path is required.

## Evidence Pack Contents

Each completed or failed helper execution must preserve:

- Tenant, operator, helper, gate, and run identifiers.
- Bundle checksum and checksum short code.
- Hardware grant identifier.
- Helper attestation.
- Backup reference.
- Execution log.
- Rollback notes.

## Trial Acceptance Boundary

The repository can be marked engineering-complete when typecheck, focused M1 tests, release guards, Docker build, and release verification pass.

It must not be marked enterprise trial-ready until a real HIL run is attached:

- 1 ESP32 gate.
- 1 USB-TTL serial path.
- 1 Linux target host.
- `ENV -> BACKUP -> INSTALL -> REMOVE/ROLLBACK` completed.
- Evidence pack exported and reviewed.

## Current M1 Focused Tests

- `src/__tests__/security/enterprise-permissions.test.ts`
- `src/__tests__/security/deployment-bundle-signing.test.ts`
- `src/__tests__/middleware/helper-auth.middleware.test.ts`
- `src/__tests__/services/deployment-run.service.test.ts`
