# Local Platform Acceptance Report

Date: 2026-03-08
Environment: local Docker Compose on Windows host

## Scope

- Frontend availability
- Backend health and authenticated core APIs
- Deterministic remote AI proof
- Business-path AI proof through Attack Simulator
- UI smoke checks for Settings, Deployment History, and Attack Simulator

## Results

- Docker services healthy: `backend`, `frontend`, `postgres`, `redis`, `minio`, `fastpath`
- Frontend reachable at `http://localhost:8080`
- Backend health reachable at `http://localhost:3005/api/health`
- Authenticated control-plane APIs returned valid data:
  - `/api/auth/me`
  - `/api/alerts?limit=5`
  - `/api/admin/users?limit=5`
  - `/api/ai-endpoints`
  - `/api/deployments/history/list?limit=5`
  - `/api/admin/audit/segments?limit=3`
- Deterministic AI proof passed through the built-in platform route:
  - Prompt: `Reply with exactly the text: AETHERGUARD_REMOTE_AI_OK`
  - Response: `AETHERGUARD_REMOTE_AI_OK`
  - Provider: `dashscope-coding-plan`
  - Route: `cloud_only`
  - Latency: `973ms`
- Business-path AI proof passed through Attack Simulator:
  - Attack: `sql-1`
  - AI used: `true`
  - Route: `cloud`
  - Provider: `dashscope-coding-plan`
  - Model router delta: `total=3, cloud=3, local=0`
  - Decision verdict: `block`
  - Confidence: `0.98`
- Frontend smoke checks passed:
  - Settings page rendered and displayed platform AI proof output
  - Deployment page rendered and showed deployment history
  - Attack Simulator page rendered in demo mode and exposed the run button

## Evidence

- Machine-readable acceptance output:
  - `artifacts/ops/local-platform-acceptance.json`
- UI smoke output:
  - `artifacts/ops/ui-release-smoke.json`
- Deterministic AI proof is exposed in the Settings UI via the built-in platform proof panel.
- Attack Simulator result now includes explicit `aiAnalysis` metadata with `route`, `provider`, and `modelRouterDelta`.

## Remaining Publish Gates

- External Linux host install/upgrade/rollback proof for `binary_agent`
- Any stronger performance claims still require dedicated claim-bench runs on Linux
- Real hardware claims remain outside this acceptance batch
