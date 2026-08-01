#!/bin/bash
# ag-cat2-backup - snapshot every network-relevant file BEFORE any modification.
# Safe to run repeatedly; never deletes older backups.
set -u
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

TS=$(date -u +%Y%m%dT%H%M%SZ)
DEST=/root/aetherguard-cat2-backup/$TS
mkdir -p "$DEST"
chmod 700 /root/aetherguard-cat2-backup "$DEST"

copy_if_exists() {  # copy_if_exists <src-path> <dest-subdir>
    if [ -e "$1" ]; then
        mkdir -p "$DEST/$2"
        cp -a "$1" "$DEST/$2/" 2>/dev/null || true
    fi
}

# file/directory backups (only what exists; board uses NM + networkd + ifupdown remnants)
copy_if_exists /etc/nftables.conf                       nftables
copy_if_exists /etc/network                             etc-network
copy_if_exists /etc/systemd/network                     systemd-network
copy_if_exists /etc/NetworkManager/system-connections   nm-connections
copy_if_exists /etc/netplan                             netplan
copy_if_exists /etc/resolv.conf                         dns
copy_if_exists /etc/systemd/system/aetherguard-cat2-gateway.service systemd-unit
copy_if_exists /etc/aetherguard-cat2.conf               aetherguard

# runtime state snapshots (human-readable + machine-readable)
ip -j link   > "$DEST/ip-link.json"   2>/dev/null
ip -j addr   > "$DEST/ip-addr.json"   2>/dev/null
ip -j route  > "$DEST/ip-route.json"  2>/dev/null
bridge link show > "$DEST/bridge-link.txt" 2>/dev/null || true
nmcli connection show > "$DEST/nmcli-connections.txt" 2>/dev/null || true
nmcli -t -f NAME,UUID,TYPE,DEVICE connection show --active > "$DEST/nmcli-active.txt" 2>/dev/null || true
networkctl status > "$DEST/networkctl-status.txt" 2>/dev/null || true
command -v nft >/dev/null && nft list ruleset > "$DEST/nftables-ruleset.nft" 2>/dev/null || \
    echo "nft userspace not installed (kernel also lacks NF_TABLES_BRIDGE/SET)" > "$DEST/nftables-ruleset.nft"
cat /etc/resolv.conf > "$DEST/resolv.conf.copy" 2>/dev/null || true

# manifest for integrity
( cd "$DEST" && find . -type f -exec sha256sum {} + ) > "$DEST/SHA256SUMS"
echo "$DEST"
logger -t aetherguard-cat2 -- "action=backup dest=$DEST"
