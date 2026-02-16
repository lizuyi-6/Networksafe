# Agent Onboarding (One-time Code)

## 1. Create onboarding code (admin)

```bash
curl -X POST https://center.example.com/api/agent-onboarding/codes \
  -H "Content-Type: application/json" \
  -b "accessToken=<admin-session-cookie>" \
  -d '{"hostname":"web-01","ttlMinutes":10,"maxUses":1}'
```

## 2. Prepare protected host

1. Copy `deployment/production/agent.env.example` to `/etc/fluxguard/agent.env`
2. Fill `FLUXGUARD_SERVER` and `FLUXGUARD_ONBOARDING_CODE`
3. Install service file:

```bash
cp deployment/production/fluxguard-agent.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now fluxguard-agent
```

## 3. Verify

```bash
systemctl status fluxguard-agent
journalctl -u fluxguard-agent -f
```

After first successful exchange, the agent runs with long-lived credentials.
