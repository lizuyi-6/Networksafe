#!/bin/bash
# aetherguard-network-rollback - restore Cat2 networking to the pre-experiment snapshot.
#
# SAFETY CONTRACT:
#   - never deletes backups;
#   - never touches usb0 unless it is actually broken (it is the management lifeline);
#   - idempotent; safe to run multiple times;
#   - writes a rollback log to /var/log/aetherguard-rollback.log and the journal.
#
# Usage: aetherguard-network-rollback.sh [backup-dir]
#   Without arguments, uses the newest backup under /root/aetherguard-cat2-backup/.
set -u
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
LOG=/var/log/aetherguard-rollback.log

say() { echo "$1" | tee -a "$LOG"; logger -t aetherguard-rollback -- "$1"; }

BACKUP_ROOT=/root/aetherguard-cat2-backup
BACKUP_DIR=${1:-$(ls -1d "$BACKUP_ROOT"/*/ 2>/dev/null | sort | tail -1)}
if [ -z "${BACKUP_DIR:-}" ] || [ ! -d "$BACKUP_DIR" ]; then
    say "FATAL: no backup directory found under $BACKUP_ROOT"
    exit 1
fi
say "ROLLBACK START $(date -u +%Y-%m-%dT%H%M%SZ) from $BACKUP_DIR"

# 1) cancel any pending lease timers and transient units
for unit in $(systemctl list-units --no-legend --no-pager 'ag-cat2-*' 2>/dev/null | awk '{print $1}'); do
    systemctl stop "$unit" 2>/dev/null || true
done
for timer in $(systemctl list-timers --no-legend --no-pager 'ag-cat2-lease-*.timer' 2>/dev/null | awk '{print $NF}'); do
    systemctl stop "$timer" 2>/dev/null || true
done

# 2) remove the experiment gateway service (keep usb0/ReactorOS services untouched)
systemctl disable --now aetherguard-cat2-gateway.service 2>/dev/null || true
rm -f /etc/systemd/system/aetherguard-cat2-gateway.service
systemctl daemon-reload 2>/dev/null || true

# 3) drop NM profiles created by the experiment (identified by name prefix)
for con in $(nmcli -t -f NAME connection show 2>/dev/null | grep -E '^aetherguard-' || true); do
    nmcli connection delete "$con" 2>/dev/null || true
done

# 4) tear down br0 if WE created it (usb0 is never a bridge member)
if ip link show dev br0 >/dev/null 2>&1; then
    ip link set dev br0 down 2>/dev/null || true
    ip link delete dev br0 type bridge 2>/dev/null || true
    say "br0 removed"
fi

# 5) re-up the two ethernet ports in their pre-experiment state (unenslaved, no IP)
for port in eth0 eth1; do
    ip link set dev "$port" nomaster 2>/dev/null || true
    ip addr flush dev "$port" 2>/dev/null || true
done

# 6) restore backed-up files (only directories that were backed up)
[ -d "$BACKUP_DIR/etc-network" ]        && cp -a "$BACKUP_DIR/etc-network/." /etc/network/ 2>/dev/null
[ -d "$BACKUP_DIR/systemd-network" ]    && cp -a "$BACKUP_DIR/systemd-network/." /etc/systemd/network/ 2>/dev/null
[ -d "$BACKUP_DIR/nm-connections" ]     && cp -a "$BACKUP_DIR/nm-connections/." /etc/NetworkManager/system-connections/ 2>/dev/null
[ -d "$BACKUP_DIR/dns" ]                && cp -a "$BACKUP_DIR/dns/resolv.conf" /etc/resolv.conf 2>/dev/null

# 7) restore nftables only if both nft exists and a real ruleset was backed up
if command -v nft >/dev/null 2>&1 && [ -s "$BACKUP_DIR/nftables-ruleset.nft" ] \
   && ! grep -q "not installed" "$BACKUP_DIR/nftables-ruleset.nft"; then
    nft -c -f "$BACKUP_DIR/nftables-ruleset.nft" && nft -f "$BACKUP_DIR/nftables-ruleset.nft"
    say "nftables ruleset restored"
fi

# 8) verify the management lifeline survived; repair only if broken
if ! ip addr show dev usb0 2>/dev/null | grep -q "inet 192\.168\.100\.2"; then
    say "usb0 management address missing - attempting NM re-up of usb0-static"
    nmcli connection up usb0-static 2>/dev/null \
        || ip addr add 192.168.100.2/24 dev usb0 2>/dev/null || true
fi

# 9) restart the original network manager to settle state
systemctl restart NetworkManager 2>/dev/null || true
sleep 2

say "ROLLBACK DONE $(date -u +%Y-%m-%dT%H%M%SZ) usb0=$(ip -br addr show usb0 2>/dev/null)"
exit 0
