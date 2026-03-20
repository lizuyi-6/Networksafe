# Rule Operations Delivery

## Scope

This delivery closes the rule-first detection pipeline into a release-ready operating flow:

- rule-first detection across HTTP API, packet interception, and distributed agents
- AI escalation only for allowed high-risk traffic
- malicious-only learning into reviewable rule candidates
- two-stage learning verification that keeps the primary decision unchanged
- admin review and approval flow through the control plane
- agent hot sync for approved agent-channel rules
- `/rules` admin page for operations and audit visibility

## Runtime Surfaces

### Backend APIs

- `GET /api/rules`
- `GET /api/rules/events`
- `GET /api/rules/candidates`
- `GET /api/rules/candidates/:id`
- `POST /api/rules/candidates/:id/approve`
- `POST /api/rules/candidates/:id/reject`

All `/api/rules` endpoints require an authenticated admin user.

### Frontend

- admin route: `/rules`
- governance navigation entry: `Rules`
- alerts page shortcut: `Open Rules Ops`

### Storage

The backend auto-creates and upgrades these tables during bootstrap:

- `sec_detection_rules`
- `sec_rule_candidates`
- `sec_detection_events`

## Config

The platform config includes `detectionPipeline`:

- `ruleFirstEnabled`
- `aiEscalationMode`
- `enableHttpApi`
- `enablePacketInterceptor`
- `enableAgentAsyncReview`
- `aiEscalationThreshold`
- `candidateMinConfidence`
- `learningMode`

The default AI routing mode remains `local_preferred`.

The backend also ships internal learning defaults for release operation:

- `learningCloudVerificationEnabled = true`
- `learningCloudVerificationMode = cloud_only`
- `learningCloudVerificationChannels = ['http_api', 'packet', 'agent']`
- `learningCloudVerificationOnSuspicious = true`
- `learningCloudVerificationOnMissingConfidence = true`

These defaults are backend-managed and are not exposed as a separate frontend control in this release.

## Self-Learning Flow

1. The primary decision still follows `rules -> heuristics -> AI`.
2. If the primary AI pass is `suspicious`, missing confidence, or below candidate threshold, the same sample gets a second learning-only `cloud_only` verification pass.
3. The second pass can create or merge a pending candidate, but it does not rewrite the current request verdict.
4. Candidate evidence stores both `primaryAi` and `learningVerificationAi`.
5. When local rules or heuristics already identified a concrete family such as `automation` or `ssrf`, the pipeline now preserves that family even if the AI response falls back to `benign` or `other`.

## Operator Flow

1. Traffic hits seed rules, tenant rules, and heuristics first.
2. Allowed requests only escalate to AI when risk stays above threshold or a review rule matched.
3. High-confidence malicious AI results create or merge rule candidates.
4. If the primary AI pass is not strong enough for candidate creation, learning verification runs in `cloud_only`.
5. Admin reviews candidates in `/rules`.
6. Approval promotes a candidate into an active rule.
7. Agent-channel approvals broadcast `update_rules` to online agents and sync automatically for new agent connections.

`POST /api/rules/candidates/manual` remains available as an admin-only fallback for emergency recovery, but it is not the primary happy path for this release and is not required for the automated learning demo.

## Live Acceptance Evidence

Validated on `39.102.81.78` against the production Docker stack:

- `/api/health` remained `healthy` with `agents = 3`
- automatic agent learning created a pending candidate from `requestId = acceptance-auto-learning-agent-6`
- the resulting event `ec4f4d96-8702-4d75-9c01-d4b2e0097fc2` kept `attackFamily = automation` while the request verdict stayed `monitor`
- the candidate `32ab3b62-962a-4b49-ac02-88062ec85062` stored both `primaryAi` and `learningVerificationAi`
- approving that candidate produced `sync.attempted = 3` and `sync.succeeded = 3`
- after restarting `aetherguard-agent@prod-node-01-b`, the agent pulled rules automatically and logged `Updated remote detection rules {"ruleCount":4}`
- HTTP hard-block validation returned `403` and produced event `309a70d2-5eb5-455a-bc25-da3954bf4006` with `matchedRuleIds = ["seed-command-injection"]` and `escalatedToAI = false`

## Verification

Run these commands before release:

```powershell
cd backend
npx tsc --noEmit
npm test -- --runInBand

cd ..\frontend
npx tsc --noEmit
```

## Dataset Replay Evidence

- A safe replay helper is available at `scripts/dev/security_dataset_replay_safe.js`.
- The helper pulls `aetherguard-security-dataset` directly from GitHub, freezes the dataset commit and file hashes into `run-manifest.json` and `dataset-index.json`, replays mapped samples, and exports evidence into `artifacts/ops/live-dataset-replay-<runId>/`.
- The helper intentionally refuses public targets. It only supports `localhost`, private IPs, or internal hostnames, and it does not perform remote SSH or public-IP replay.
- Current supported replay mappings:
  - SQLi, XSS, command injection, path traversal, LDAP, SSTI, GraphQL, NoSQL and encoding variants through `/api/rules` query probes and `/api/auth/login`
  - SSRF through `/api/sites`
  - Log4j, Text4Shell, JWT and header-oriented probes through `/api/rules` headers
- Unsupported or semantically unsafe categories such as DDoS, port scan, HTTP smuggling, WebSocket attack, XXE, file upload, deserialization, and ReDoS are exported as `skipped` instead of being forced into an invalid route.
- Evidence bundle contents include:
  - `run-manifest.json`
  - `dataset-index.json`
  - `replay-results.ndjson`
  - `replay-results.csv`
  - `health-before.json`
  - `health-after.json`
  - `rules-events-before.json`
  - `rules-events-after.json`
  - `rules-candidates-before.json`
  - `rules-candidates-after.json`
  - `showcase-candidates.json`
  - `approve-sync.json`
  - `agent-reconnect.log`
  - `talk-evidence.md`
  - `screenshots/`

Example local run:

```powershell
set AETHERGUARD_BASE_URL=http://localhost:3005
set AETHERGUARD_ADMIN_EMAIL=admin@aetherguard.local
set AETHERGUARD_ADMIN_PASSWORD=AdminAccept123!
set AETHERGUARD_MAX_SAMPLES_PER_FILE=1
npm run replay:dataset:safe
```

Successful private replay proof captured on `2026-03-18`:

- evidence directory: `artifacts/ops/live-dataset-replay-dataset-replay-2026-03-18T11-51-25-890Z`
- dataset commit: `71fa3ee447b27c5505acae7cde9c3e175704e17c`
- mapped replay: `3` SSRF samples through `/api/sites`
- automatic candidate: `bb63a128-9527-48c1-bc48-fa8a45e55d44`
- final candidate state: `pending`
- normalized family: `automation`
- evidence includes both `primaryAi` and `learningVerificationAi`
- screenshot captured at `artifacts/ops/live-dataset-replay-dataset-replay-2026-03-18T11-51-25-890Z/screenshots/rules-candidate-local.png`

Combined hard-block plus learning proof captured on `2026-03-18`:

- evidence directory: `artifacts/ops/live-dataset-replay-dataset-replay-2026-03-18T11-58-43-082Z`
- replayed requests: `10`
- hard blocks: `7`
- learning-verified candidates: `1`
- block evidence:
  - `08d90d60-a314-4f98-81f9-21d80cfd0a6f` for `sqli_0000`
  - `42cc26de-993e-4164-a558-3d7c286a56f2` for `cmdi_0000`
  - `1c6c0543-013e-4e60-8d57-e4c45ba65d36` for `path_0000`
- learning evidence:
  - candidate `bb63a128-9527-48c1-bc48-fa8a45e55d44`
  - learning events `5caba73f-fc7e-4366-87fd-c3fa560ed3e4` and `7defbef6-b2fa-4e06-b2b6-26ab99b5dab0`
  - screenshot captured at `artifacts/ops/live-dataset-replay-dataset-replay-2026-03-18T11-58-43-082Z/screenshots/rules-candidate-local.png`

## Smoke Checklist

- hard-block HTTP rule returns `403` without calling AI
- suspicious allowed HTTP traffic escalates to AI and writes a detection event
- packet slow-path still falls back cleanly on AI timeout
- agent review samples create candidates without blocking the original request
- pending candidates store both `primaryAi` and `learningVerificationAi`
- candidate approval updates the active rule list
- approved agent-channel candidate syncs to online agents without restart
- restarting an online agent pulls the approved remote rules automatically

## 2026-03-19 Hardening Follow-Up

The live host `39.102.81.78` received a post-delivery hardening pass on `2026-03-19`:

- SSH host identity was re-accepted with the active ED25519 fingerprint `SHA256:c14UWgb+ITGAQ8R4O9blXG1PUS1qrXdi694IZtgZJa8` and the local `known_hosts` entry was refreshed.
- The host now has a persistent `2GiB` swapfile with:
  - `vm.swappiness = 10`
  - `vm.vfs_cache_pressure = 50`
- All three production agent instances now run with explicit production defaults:
  - `NODE_ENV=production`
  - `LOG_LEVEL=info`
- The agent service template now carries the same defaults and the wrapper injects them into the container runtime.
- Agent env files were cleaned to remove a UTF-8 BOM that caused `systemd` to ignore the first `AETHERGUARD_SERVER=...` assignment.
- Frontend ingress now rejects:
  - non-whitelisted `Host` headers
  - absolute-form request targets such as `GET http://example.com/...`
- Allowed hosts are restricted to:
  - `39.102.81.78`
  - `localhost`
  - `127.0.0.1`
- Verification after the hardening pass:
  - `http://39.102.81.78/` returns `200`
  - `http://39.102.81.78/api/health` returns `healthy`
  - `agents = 3`
  - `/dashboard`, `/rules`, and `/agents` load successfully
  - invalid `Host` and absolute-form probes no longer return `200`
  - agent journals are clean of `[DEBUG]` spam and `invalid environment assignment`

Because Docker Hub metadata requests timed out during the maintenance window, the backend and frontend runtime fixes were applied by patching the live containers and persisting the updated local images on the host, rather than by a full remote source rebuild. The current release source tree was still updated in `/opt/aetherguard/docker-stack/current` for the next normal rebuild.
