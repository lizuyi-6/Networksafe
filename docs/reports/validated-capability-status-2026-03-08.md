# AetherGuard Validated Capability Status (2026-03-08)

This report records what is implemented and what is actually evidenced in the current workspace as of 2026-03-08.

> **Historical snapshot — superseded for current software claims.** The current software-only evidence is `software-validation-status-2026-07-27.md` and its machine-readable JSON companion. Keep the Docker, Object Lock, notification, and device-flow statements below tied to the 2026-03-08 environment. Do not reuse the old `1329.79 QPS`, `21 ms`, `6.22%`, or `99.64 MB` snapshot as the latest result. The 2026-07-27 fixed-key Rust loopback reproduction measured 56.6k–61.6k QPS across three rounds with a 75.1k short-sweep peak, and did not reproduce a stable 100k result.

## 1. Scope

- Environment: `docker compose` runtime on the current repository workspace.
- Evidence sources:
  - `artifacts/ops/validation-snapshot.json`
  - `artifacts/ops/deployment-bundle-validation/deployment-bundle-validation.json`
  - `artifacts/ops/device-smoke.out.log`
  - `docs/reports/deployment-bundle-validation-2026-03-08.md`
  - `/api/config`
  - `/api/admin/benchmarks/history`
  - `/api/admin/audit/segments`
  - `/api/admin/audit/segments/:id/verify`
  - `/api/config/notifications/deliveries`
  - `/api/devices/esp32-smoke`
  - `/api/devices/esp32-smoke/events`

## 2. Validated Now

### 2.1 Runtime and Deployment Surface

- Docker runtime is healthy for `backend`, `frontend`, `fastpath`, `postgres`, and `redis`.
- Deployment bundle generation is implemented for:
  - `nginx`
  - `apache`
  - `caddy`
  - `docker_compose`
  - `binary_agent`
  - `k8s_daemonset`
- Current bundle validation evidence:
  - all 6 targets produced bundles with `install.sh`, `upgrade.sh`, `rollback.sh`, `healthcheck.sh`, and `bundle-manifest.json`
  - `nginx -t`, `httpd -t`, `caddy validate`, `docker compose config`, `kubeconform`, and containerized `binary_agent` install/upgrade/rollback smoke all passed in the current workspace
- Deployment defaults are exposed through `/api/config`.

### 2.2 Audit Archive and WORM-Oriented Chain

- Audit archive bucket: `aetherguard-audit-lock`
- Object lock required: `true`
- Default retention: `30` days
- Latest verification snapshot:
  - `valid: true`
  - `chainValid: true`
  - `contentValid: true`
  - `linkageValid: true`
  - `objectLockValid: true`
- Latest verified segment example:
  - `segmentId: 1d2b5550-e746-4b83-ae29-0a263150bb4b`
  - `versionId: acd53869-0bb8-4e74-9170-b7c3714003fa`
  - `retentionUntil: 2026-04-07T07:04:48.341Z`

### 2.3 Notification Outbox

- Notification config is centralized in `/api/config`.
- Outbox-backed delivery tracking is present in `notification_deliveries`.
- Supported channel implementations in the codepath:
  - `smtp` / `email`
  - `slack_webhook`
  - `generic_webhook`
- Smoke evidence captured in current workspace:
  - webhook channel `smoke-webhook`
  - retry state observed as `retrying`
  - terminal error text captured for failure/retry diagnostics

### 2.4 AI Routing and Fastpath

- Persistent config now exposes:
  - `aiRouting.mode`
  - `privacyMode`
  - `fastpath.enabled`
  - `fastpath.baseUrl`
- Rust fastpath sidecar is wired into API and socket rate checks.
- Current config snapshot:
  - `aiRouting.mode: cloud_only`
  - `privacyMode: off`
  - `fastpath.enabled: true`
  - `fastpath.baseUrl: http://fastpath:8081`

### 2.5 Device / ESP32-Compatible Flow

- Both WebSocket paths are active:
  - primary: `/ws/device`
  - alias: `/ws/status`
- Simulated device `esp32-smoke` successfully completed:
  - register
  - heartbeat
  - `ota_update`
  - `ota_status: downloading`
  - `ota_status: installing`
  - `ota_status: installed`
  - `physical_confirmation_required`
  - `physical_confirmation_ack` with `button: GPIO15`
  - follow-up `reboot` command dispatch
- Evidence is visible in `artifacts/ops/device-smoke.out.log` and `artifacts/ops/validation-snapshot.json`.

## 3. Current Measured Performance Snapshot

Latest benchmark run in the current workspace:

| Metric | Current smoke result | Historical strongest claim |
| --- | ---: | ---: |
| Fastpath QPS | `1329.79` | `100000+` |
| p95 latency | `21 ms` | `< 10 ms` local AI / faster data path claims |
| Agent CPU proxy | `6.22%` | `< 2%` |
| Agent memory proxy | `99.64 MB` | `< 50 MB` |
| Local AI latency | `unavailable` (`127.0.0.1:11434` refused) | `< 10 ms` |

Conclusion: the benchmark harness exists, but the strongest historical performance claims are not validated by the current workspace measurements.

## 4. Not Yet Validated Here

- `100,000+ QPS`
- `<10ms` local AI latency
- `<2%` agent CPU
- `<50MB` agent memory
- Physical ESP32 board flashing on real `ESP32-WROOM-32`
- External Linux host install / upgrade / rollback smoke for `binary_agent`
- Production execution of Caddy, Apache, and Kubernetes bundles on external target infrastructure

## 5. Repository Evidence Added

- `scripts/dev/device_gateway_smoke.js`
- `scripts/dev/export_validation_snapshot.js`
- `artifacts/ops/device-smoke.out.log`
- `artifacts/ops/validation-snapshot.json`
- `artifacts/ops/deployment-bundle-validation/deployment-bundle-validation.json`
- `docs/reports/deployment-bundle-validation-2026-03-08.md`

## 6. Claim Guidance

Use the following language externally unless stronger evidence is collected:

- Safe to claim:
  - Docker runtime
  - Deployment bundle generation and static validation for `nginx`, `apache`, `caddy`, `docker_compose`, `binary_agent`, and `k8s_daemonset`
  - Object-lock-backed audit archive with verification
  - Notification outbox and retry tracking
  - Configurable AI routing and fastpath integration
  - ESP32-compatible OTA and physical-confirmation flow demonstrated through simulated device validation
- Do not claim as completed:
  - `100,000+ QPS`
  - `<10ms local AI`
  - `<2% CPU`
  - `<50MB`
  - fully proven real-board rollout
  - fully proven external binary deployment lifecycle on a real Linux host
