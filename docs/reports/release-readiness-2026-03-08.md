# Release Readiness Report

Generated At: 2026-03-08T13:59:04.189Z
Status: `NO-GO`

## Environment
- Workspace: X:\want\fsce
- Backend URL: http://localhost:3005
- Frontend URL: http://localhost:8080
- External Linux host evidence file: X:\want\fsce\artifacts\ops\external-linux-binary-agent-validation.json

## Local Acceptance
- Machine-readable report present: yes
- Local acceptance pass: yes
- UI smoke pass: yes
- Deployment bundle static validation pass: yes

## AI Evidence
- Deterministic AI proof success: yes
- AI proof content: AETHERGUARD_REMOTE_AI_OK
- AI proof model: qwen3-max-2026-01-23
- AI proof latency: 973ms
- AI proof provider: dashscope-coding-plan
- AI proof request ID: missing
- Attack simulator decision verdict: block
- Attack simulator confidence: 0.98
- Attack simulator AI route: cloud
- Attack simulator AI provider: dashscope-coding-plan

## External Linux Host Gate
- Evidence present: yes
- Real install/healthcheck/upgrade/rollback pass: no
- Host: docker-systemd-container
- Bundle: d36ed7b5-5e93-492d-a48f-35643d37ac92
- Failed step: healthcheck1
- Failure reason: * aetherguard-agent.service - AetherGuard Binary Agent
     Loaded: loaded (/etc/systemd/system/aetherguard-agent.service; enabled; vendor preset: enabled)
     Active: activating (auto-restart) (Result: exit-code) since Sun 2026-03-08 13:58:58 UTC; 104ms ago
    Process: 77 ExecStart=/usr/local/bin/aetherguard-agent --listen 8084 (code=exited, status=203/EXEC)
   Main PID: 77 (code=exited, status=203/EXEC)
        CPU: 807us

## Evidence Files
- Local acceptance JSON: X:\want\fsce\artifacts\ops\local-platform-acceptance.json
- UI smoke JSON: X:\want\fsce\artifacts\ops\ui-release-smoke.json
- Deployment validation JSON: X:\want\fsce\artifacts\ops\deployment-bundle-validation\deployment-bundle-validation.json
- External host validation JSON: X:\want\fsce\artifacts\ops\external-linux-binary-agent-validation.json

## Release Decision
- Status: `NO-GO`
- Notes: external Linux host install/upgrade/rollback evidence is missing or failed.
