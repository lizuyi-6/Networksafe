# Deployment Bundle Validation Report

Generated At: 2026-03-08T10:13:20.236Z
Base URL: http://localhost:3005
Overall Passed: yes

## Targets

### nginx
- Status: passed
- Deployment ID: 5a39c7b4-5eb1-40d3-9b21-ec41ad189752
- Bundle extractor: passed
- Target validation: passed (nginx -t)
- Required files: .env, README.md, install.sh, upgrade.sh, rollback.sh, healthcheck.sh, bundle-manifest.json

### apache
- Status: passed
- Deployment ID: 92d69937-c3b6-461e-94b5-ac9e8a555a0c
- Bundle extractor: passed
- Target validation: passed (httpd -t)
- Required files: .env, README.md, install.sh, upgrade.sh, rollback.sh, healthcheck.sh, bundle-manifest.json

### caddy
- Status: passed
- Deployment ID: 3b170796-6f6f-4ba7-b182-b1d74620b411
- Bundle extractor: passed
- Target validation: passed (caddy validate)
- Required files: .env, README.md, install.sh, upgrade.sh, rollback.sh, healthcheck.sh, bundle-manifest.json

### docker_compose
- Status: passed
- Deployment ID: 9e3dfb79-29a0-4ace-9722-98066dd97529
- Bundle extractor: passed
- Target validation: passed (docker compose config)
- Required files: .env, README.md, install.sh, upgrade.sh, rollback.sh, healthcheck.sh, bundle-manifest.json

### binary_agent
- Status: passed
- Deployment ID: 73825079-ac3a-458c-b93d-329d1f9baba3
- Bundle extractor: passed
- Target validation: passed (containerized install/healthcheck/upgrade/rollback smoke)
- Required files: .env, README.md, install.sh, upgrade.sh, rollback.sh, healthcheck.sh, bundle-manifest.json

### k8s_daemonset
- Status: passed
- Deployment ID: 79f687a7-99c3-4808-baeb-5217ae621eb9
- Bundle extractor: passed
- Target validation: passed (kubeconform -summary -strict -ignore-missing-schemas)
- Required files: .env, README.md, install.sh, upgrade.sh, rollback.sh, healthcheck.sh, bundle-manifest.json

## Notes

- `binary_agent` smoke runs in a disposable Ubuntu container with `AETHERGUARD_SKIP_SYSTEMCTL=1` and an isolated install root, so it validates bundle install/upgrade/rollback logic without claiming a real systemd host rollout.
- This report validates generated bundles and config syntax. It does not claim real ESP32 hardware flashing or an external Linux host acceptance run.
