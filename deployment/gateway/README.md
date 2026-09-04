# AetherGuard Gateway Appliance Deployment

> **EXPERIMENTAL (2026-08 security audit).** This deployment package is not
> release-ready: the nftables data plane does not yet implement the PRD's
> transparent L2 bridge family, and the package has not passed Linux
> namespace bridge gates, systemd-VM gates, or hardware-in-the-loop
> campaigns. Treat every status claim from this daemon as `reported`
> (self-report) only. See `docs/security-audit/2026-08-remediation-matrix.md`.

Gateway Daemon (M1) deployment package for Protectli Vault / industrial gateways.

## Prerequisites

- **Hardware**: Protectli VP2430/VP2420/VP4650 or compatible (≥3 GbE ports, ≥4GB RAM)
- **OS**: Debian 12+ / Ubuntu 22.04+ / OpenWrt 23+
- **Software**: Node.js 18+, nftables, systemd
- **Controller**: M2 STM32H563 controller connected via USB/UART (default: /dev/ttyACM0)
- **Secure Element**: M3 OPTIGA Trust M provisioned, public key exported

## Quick Start

```bash
# 1. Copy deployment package to gateway
scp -r deployment/gateway/ root@gateway-ip:/tmp/

# 2. Run install script
ssh root@gateway-ip
cd /tmp/gateway
chmod +x install.sh
./install.sh

# 3. Provision Secure Element (see docs/hardware-phase0-status.md)
# Export SE public key to /etc/aetherguard/se-public-key.pem

# 4. Edit configuration
vi /etc/aetherguard/gateway.conf
# Set: gatewayId, backendUrl, tenantId, serialPort

# 5. Start daemon
systemctl enable aetherguard-gateway-daemon
systemctl start aetherguard-gateway-daemon

# 6. Verify
systemctl status aetherguard-gateway-daemon
journalctl -u aetherguard-gateway-daemon -f
```

## Directory Structure

```
deployment/gateway/
├── bin/
│   └── aetherguard-gateway-daemon.ts    # M1 Gateway Daemon executable
├── nftables/
│   ├── isolated_ruleset.nft             # Default fail-closed
│   └── released_ruleset.nft             # Temporary release
├── systemd/
│   └── aetherguard-gateway-daemon.service
├── config/
│   └── gateway.conf.example
├── install.sh
└── README.md
```

## Configuration

`/etc/aetherguard/gateway.conf`:

```json
{
  "gatewayId": "gw-prod-001",
  "backendUrl": "https://control.example.com",
  "tenantId": "tenant-abc",
  "sePublicKeyPath": "/etc/aetherguard/se-public-key.pem",
  "breakerTarget": "server-lan-bridge",
  "serialPort": "/dev/ttyACM0",
  "serialBaud": 115200,
  "heartbeatStaleMs": 45000,
  "releaseTtlMs": 30000,
  "statusReportIntervalMs": 10000
}
```

## Network Interfaces

**Adjust in nftables/*.nft before deployment:**

```nft
define SERVER = eth0    # Protected server NIC → SERVER port
define LANWAN = eth1    # LAN/WAN uplink
define MGMT = eth2      # Independent management path
```

Use `ip link` to identify actual interface names on your gateway.

## Serial Protocol

Gateway Daemon ↔ Controller: newline-delimited JSON over UART/USB-CDC.

**Controller → Gateway:**
- `{ "type": "hello", "ts": ... }`
- `{ "type": "heartbeat", "secureElementPresent": true, "ts": ... }`
- `{ "type": "state", "interlockState": "isolated|released", "feedbackOk": true, "ts": ... }`
- `{ "type": "interlock_result", "interlockState": "released", "feedbackOk": true, "ts": ... }`
- `{ "type": "alert", "ts": ... }`

**Gateway → Controller:**
- `{ "type": "command", "command": "interlock_release|interlock_assert", "breakerTarget": "...", "ts": ... }`

## Fail-Closed Behavior

On boot, crash, or any trigger (PRD §4.4):
1. Daemon applies `isolated_ruleset.nft`
2. SERVER ↔ LAN/WAN forwarding **BLOCKED**
3. MGMT port remains reachable (appliance management)

Release requires:
1. Valid hardware grant (signed by SE, not expired, counter advanced)
2. Controller confirms interlock released
3. Feedback auxiliary contact confirms relay closed

Auto-reasserts isolated after release window (default 30s).

## Troubleshooting

```bash
# Check daemon status
systemctl status aetherguard-gateway-daemon

# View logs
journalctl -u aetherguard-gateway-daemon -f

# Check nftables rules
nft list ruleset

# Test serial port
cat /dev/ttyACM0  # Should see JSON frames from controller

# Manual isolated ruleset apply
nft -f /etc/aetherguard/nftables/isolated_ruleset.nft
```

## Security Notes

- Daemon runs as unprivileged `aetherguard` user (CAP_NET_ADMIN only)
- Configuration is 600 (root-only read)
- SE private key never leaves the secure element
- Default fail-closed: any error → isolated

## References

- PRD: `docs/root-resistant-gateway-prd.md`
- Phase 0 status: `docs/hardware-phase0-status.md`
- Simulator: `simulator/README.md`
- Gateway Daemon source: `backend/src/companion/gateway-daemon.ts`
