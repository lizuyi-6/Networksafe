# Docker Acceptance Sign-Off

Date: 2026-03-18

## Baseline

- Acceptance environment rebuilt from the current workspace at `X:\github-repos\Networksafe`.
- Compose project used for sign-off: `fsce`.
- Production release host: `39.102.81.78`.
- Active Docker release path on the host: `/opt/aetherguard/docker-stack/releases/20260318-184204/app`.
- Fresh-stack verification:
  - Backend container label `com.docker.compose.project.working_dir` points to `X:\github-repos\Networksafe`.
  - Backend package in the running container is `AetherGuard-backend`.
  - Legacy `fluxguard-backend` / `internal-event-*` runtime artifacts are not present in the rebuilt backend image.
- Blocker cleared:
  - `internal_event_read_failed ... NOGROUP` is no longer present in backend logs after the fresh rebuild.

## Acceptance Fixes Applied During Rebuild

- Docker image builds no longer assume a lockfile:
  - `frontend/Dockerfile`
  - `backend.Dockerfile`
- Fresh backend builds no longer fail on native dependency compilation because `/root/.cache/node-gyp` is created before install:
  - `backend.Dockerfile`
- Frontend alerts page now unwraps API envelopes correctly instead of crashing on `/alerts`:
  - `frontend/src/services/api.ts`
- Unauthenticated and pre-auth API traffic is now attributed to the platform/admin tenant for detection events:
  - `backend/src/middleware/api-traffic-shadow.middleware.ts`
  - `backend/src/api/routes/rules.routes.ts`
- Agent runtime packaging is fixed for production containers:
  - `backend/package.json`
  - `backend/src/agent-cli.ts`
- Postgres shadow schema drift for `agent_registrations.tenant_id` is fixed:
  - `backend/src/services/postgres-shadow-store.service.ts`
- Learning verification now preserves a concrete locally identified family instead of letting cloud AI fall back to `benign` or `other`:
  - `backend/src/services/detection-pipeline.service.ts`
  - `backend/src/__tests__/services/detection-pipeline.learning.test.ts`

## Signed-Off Checks

### Environment health

- `backend`, `frontend`, `postgres`, `redis`, `fastpath` are healthy in the `fsce` stack.
- `http://localhost:3005/api/health` is healthy.
- `http://localhost:8080` is reachable.
- `http://39.102.81.78/api/health` is healthy with `agents = 3`.

### Rules operations UI

- `/rules` is reachable from the Governance navigation.
- `/alerts` contains the `Open Rules Ops` entry point.
- Rules summary, candidate review, approved rule list, and recent event stream render in the UI.

### HTTP rule-first detection

- Normal authenticated traffic is recorded as `allow` without AI escalation.
- High-risk allowed traffic is escalated to AI and recorded in `sec_detection_events`.
- Hard SQLi block was verified through detection events with:
  - `matchedRuleIds = ["seed-sqli-union"]`
  - `verdict = "block"`
  - `escalatedToAI = false`

### Candidate review and approval

- Automatic self-learning was re-verified live after the backend release:
  - requestId: `acceptance-auto-learning-agent-6`
  - detection event: `ec4f4d96-8702-4d75-9c01-d4b2e0097fc2`
  - candidate: `32ab3b62-962a-4b49-ac02-88062ec85062`
  - candidate `attackFamily = automation`
  - event `responseSnapshot` contains both `primaryAi` and `learningVerificationAi`
- The pre-fix acceptance probe that still produced a `benign` family label was explicitly rejected and left out of the signed-off rule set:
  - candidate: `fdc18faa-0581-4fe4-81d6-15a333430cc7`
  - status: `rejected`
- The corrected `agent` channel candidate was approved through the live review API.
- Approval produced a live sync result to online agents:
  - `attempted = 3`
  - `succeeded = 3`
- Approved rule created:
  - `ruleId = 7da26e04-8738-4756-ab6d-47ccf9d90277`

### Agent hot sync

- Existing online agent received `update_rules` immediately after approval.
- Fresh post-approval agent onboarding was explicitly re-verified:
  - hostname: `codex-acceptance-agent-3`
  - agentId: `agent-b99fc3f1-1389-4446-87cd-1aa50ed95fff`
- Fresh agent evidence from runtime logs:
  - `Executing verified command: update_rules`
  - `Updated remote detection rules {"ruleCount":1}`
  - `Updated detection rules {"ruleCount":1,"mode":"remote"}`
- Post-fix restart evidence on the live 3-agent set:
  - service: `aetherguard-agent@prod-node-01-b`
  - runtime logs:
    - `Executing verified command: update_rules`
    - `Updated remote detection rules {"ruleCount":4}`
    - `Updated detection rules {"ruleCount":4,"mode":"remote"}`

### HTTP hard block

- Live HTTP hard block was re-verified after the backend release:
  - request marker: `acceptance-http-block-3`
  - HTTP status: `403`
  - detection event: `309a70d2-5eb5-455a-bc25-da3954bf4006`
  - `matchedRuleIds = ["seed-command-injection"]`
  - `escalatedToAI = false`
  - `decisionSource = "seed:block"`

## Final Sign-Off Decision

- Accepted for Docker sign-off on a fresh rebuilt stack.
- Accepted for delivery sign-off on the rebuilt `fsce` environment and the live host `39.102.81.78`.
- The live host sign-off is based on the refreshed backend image running from `/opt/aetherguard/docker-stack/releases/20260318-184204/app`, not the earlier stale container set.

## Residual Notes

- Acceptance agent containers run without a firewall backend in the container, so they log `No firewall backend detected`. This is expected for the containerized acceptance probe and did not block rule sync validation.
- Cloud AI case files can still emit `attackFamily = benign` in their raw per-agent evidence for some samples. The delivery sign-off is based on the normalized detection event and candidate family preserved by the rule-first pipeline.
- A repeatable local-only dataset replay helper now exists at `scripts/dev/security_dataset_replay_safe.js`. It is intended for isolated acceptance and talk-evidence capture against localhost or private environments, not for replaying payloads at the public release host.
- A successful local evidence pack was captured at `artifacts/ops/live-dataset-replay-dataset-replay-2026-03-18T11-51-25-890Z`, including the pending candidate `bb63a128-9527-48c1-bc48-fa8a45e55d44`, replay CSV, and `/rules` screenshot.
- A second local evidence pack was captured at `artifacts/ops/live-dataset-replay-dataset-replay-2026-03-18T11-58-43-082Z`, combining `7` hard-blocked requests with a learning-verified pending candidate and updated `/rules` screenshot for talk use.

## 2026-03-19 Operations Hardening

The already signed-off live host received a follow-up operations hardening pass on `2026-03-19`:

- refreshed local SSH trust after the host key rotation:
  - active ED25519 fingerprint: `SHA256:c14UWgb+ITGAQ8R4O9blXG1PUS1qrXdi694IZtgZJa8`
- host memory protection:
  - persistent `/swapfile` enabled at `2GiB`
  - `vm.swappiness = 10`
  - `vm.vfs_cache_pressure = 50`
- agent runtime hardening:
  - `NODE_ENV=production`
  - `LOG_LEVEL=info`
  - UTF-8 BOM removed from `/etc/aetherguard/agents/*.env` to stop `systemd` from ignoring the first assignment
- frontend ingress hardening:
  - non-whitelisted `Host` requests now fail instead of returning the SPA shell
  - absolute-form request targets now fail instead of returning `index.html`
  - allowed hosts limited to `39.102.81.78`, `localhost`, and `127.0.0.1`
- live verification after hardening:
  - `/api/health = healthy`
  - `agents = 3`
  - `/dashboard`, `/rules`, and `/agents` still load successfully
  - all three agent journals are clean of repeated `[DEBUG]` traffic-check entries

During this window Docker Hub metadata requests timed out, so the host could not complete a clean remote source rebuild. To keep the maintenance window short, the new logger and nginx behavior were injected into the running `app-backend` and `app-frontend` containers, committed into the local host images, and then the containers were recreated from those updated local images. The release working tree under `/opt/aetherguard/docker-stack/current` was also updated so the next normal rebuild can proceed from the corrected source.
