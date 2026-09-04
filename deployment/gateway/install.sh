#!/bin/bash
#
# AetherGuard Gateway Appliance Deployment Script
#
# Installs Gateway Daemon (M1) on Protectli/industrial gateway running Debian/Ubuntu.
# Assumes: Node.js 18+, nftables, systemd

set -e

echo "═══════════════════════════════════════════════════════════"
echo "  AetherGuard Gateway Appliance Deployment"
echo "═══════════════════════════════════════════════════════════"

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Error: Node.js not found"; exit 1; }
command -v nft >/dev/null 2>&1 || { echo "Error: nftables not found"; exit 1; }
command -v systemctl >/dev/null 2>&1 || { echo "Error: systemd not found"; exit 1; }

# Create directories
echo "[1/7] Creating directories..."
mkdir -p /etc/aetherguard/nftables
mkdir -p /var/lib/aetherguard
mkdir -p /var/log/aetherguard

# Create aetherguard user
echo "[2/7] Creating aetherguard user..."
id -u aetherguard &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin aetherguard

# Install nftables rulesets
echo "[3/7] Installing nftables rulesets..."
cp nftables/isolated_ruleset.nft /etc/aetherguard/nftables/
cp nftables/released_ruleset.nft /etc/aetherguard/nftables/
chmod 644 /etc/aetherguard/nftables/*.nft

# Install gateway daemon (AUD-05-1)
# The old flow ran `npm install --prefix ...` in a directory WITHOUT a
# package.json (a silent no-op) and symlinked systemd to the raw .ts entry —
# which never even compiled (its backend import depth was wrong). The new
# flow: the BUILD MACHINE runs `npm ci && npm run build` in this package and
# ships `dist/` + `node_modules/`; the target machine copies the compiled
# artifact and NEVER executes a .ts file.
echo "[4/7] Installing gateway daemon..."
INSTALL_ROOT=/usr/local/lib/aetherguard-gateway
mkdir -p "$INSTALL_ROOT"
[ -f dist/deployment/gateway/bin/aetherguard-gateway-daemon.js ] || {
  echo "Error: prebuilt artifact missing. On the build machine run:"
  echo "  cd deployment/gateway && npm ci && npm run build"
  exit 1
}
[ -d node_modules ] || {
  echo "Error: node_modules missing. On the build machine run:"
  echo "  cd deployment/gateway && npm ci && npm run build"
  exit 1
}
cp -r dist "$INSTALL_ROOT/"
cp -r node_modules "$INSTALL_ROOT/"
cp package.json package-lock.json "$INSTALL_ROOT/"

# Install the fail-closed preflight check (DP-006): the systemd unit's
# ExecStartPre references /usr/local/bin/aetherguard-gateway-preflight-check;
# it applies isolated_ruleset and only exits 0 when isolation is verifiably
# loaded, so systemd refuses to start the daemon without the safe baseline.
cp bin/aetherguard-gateway-preflight-check.sh /usr/local/bin/aetherguard-gateway-preflight-check
chmod 755 /usr/local/bin/aetherguard-gateway-preflight-check

# Install configuration (user must edit)
echo "[5/7] Installing configuration template..."
if [ ! -f /etc/aetherguard/gateway.conf ]; then
  cp config/gateway.conf.example /etc/aetherguard/gateway.conf
  chmod 600 /etc/aetherguard/gateway.conf
  echo "⚠️  EDIT /etc/aetherguard/gateway.conf (set gatewayId, backendUrl, tenantId)"
else
  echo "Configuration exists, skipping"
fi

# Install systemd service
echo "[6/7] Installing systemd service..."
cp systemd/aetherguard-gateway-daemon.service /etc/systemd/system/
systemctl daemon-reload

# Apply isolated ruleset (fail-closed default)
echo "[7/7] Applying default isolated ruleset..."
/usr/sbin/nft -f /etc/aetherguard/nftables/isolated_ruleset.nft

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Installation Complete"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "1. Provision Secure Element and copy public key to /etc/aetherguard/se-public-key.pem"
echo "2. Edit /etc/aetherguard/gateway.conf (set gatewayId, backendUrl, tenantId)"
echo "3. Connect M2 controller via USB/UART (default: /dev/ttyACM0)"
echo "4. Enable and start service:"
echo "     systemctl enable aetherguard-gateway-daemon"
echo "     systemctl start aetherguard-gateway-daemon"
echo "5. Check status:"
echo "     systemctl status aetherguard-gateway-daemon"
echo "     journalctl -u aetherguard-gateway-daemon -f"
