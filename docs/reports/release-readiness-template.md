# AetherGuard Release Readiness Template

## Environment
- Date:
- Operator:
- Workspace revision:
- Backend URL:
- Frontend URL:
- External Linux host:

## Local Acceptance
- `docker compose ps` healthy:
- Frontend reachable:
- Login successful:
- Core read APIs healthy:
- Deterministic AI proof returned `AETHERGUARD_REMOTE_AI_OK`:
- Attack simulator produced an AI-backed decision:
- Acceptance artifact: `artifacts/ops/local-platform-acceptance.json`

## External Publish Gate
- Real remote AI response captured:
- Business-path AI decision captured:
- Deployment bundle installed on Linux host:
- Health check passed:
- Rollback validated:
- Final report archived:

## Evidence
- Platform AI request ID:
- Attack simulator run ID:
- Deployment bundle ID:
- Logs or screenshots:

## Known Non-Blocking Issues
- 

## Release Decision
- Status: `GO` / `NO-GO`
- Notes:
