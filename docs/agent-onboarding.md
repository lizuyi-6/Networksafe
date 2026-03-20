# Agent Onboarding (One-time Code)

## 1. Create onboarding code (admin)

```bash
curl -X POST https://center.example.com/api/agent-onboarding/codes \
  -H "Content-Type: application/json" \
  -b "accessToken=<admin-session-cookie>" \
  -d '{"hostname":"web-01","ttlMinutes":10,"maxUses":1}'
```

## 2. Prepare protected host

### Single instance

1. Copy `deployment/production/agent.env.example` to `/etc/aetherguard/agents/prod-node-01.env`
2. Fill `AETHERGUARD_SERVER`, `AETHERGUARD_HOSTNAME`, and `AETHERGUARD_ONBOARDING_CODE`
3. Install the template service and helper:

```bash
install -m 0755 deployment/production/aetherguard-agent-container.sh /opt/aetherguard/docker-stack/current/deployment/production/aetherguard-agent-container.sh
cp deployment/production/aetherguard-agent@.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now aetherguard-agent@prod-node-01
```

### Same-host multi instance

Use one env file per instance:

- `/etc/aetherguard/agents/prod-node-01.env`
- `/etc/aetherguard/agents/prod-node-01-a.env`
- `/etc/aetherguard/agents/prod-node-01-b.env`

Each instance must have its own `AETHERGUARD_HOSTNAME` and `AETHERGUARD_ONBOARDING_CODE`.

```bash
systemctl enable --now aetherguard-agent@prod-node-01
systemctl enable --now aetherguard-agent@prod-node-01-a
systemctl enable --now aetherguard-agent@prod-node-01-b
```

After the first successful exchange, the agent clears `AETHERGUARD_ONBOARDING_CODE` and writes the long-lived credentials back into the same env file.

## 3. Verify

```bash
systemctl status aetherguard-agent@prod-node-01
journalctl -u aetherguard-agent@prod-node-01 -f
```
