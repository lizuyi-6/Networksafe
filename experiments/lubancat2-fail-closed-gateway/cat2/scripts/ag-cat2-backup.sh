#!/bin/bash
# Create an immutable, checksummed Cat2 pre-change snapshot.
set -Eeuo pipefail

PATH=${AG_COMMAND_PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}
BACKUP_ROOT=${AG_BACKUP_ROOT:-/root/aetherguard-cat2-backup}
SOURCE_ROOT=${AG_BACKUP_SOURCE_ROOT:-/}
SOURCE_ROOT=${SOURCE_ROOT%/}
[[ -n "$SOURCE_ROOT" ]] || SOURCE_ROOT=/

mkdir -p "$BACKUP_ROOT"
chmod 0700 "$BACKUP_ROOT"
TEMPORARY_DIRECTORY=$(mktemp -d "$BACKUP_ROOT/.backup.XXXXXXXX")
FINAL_DIRECTORY="$BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)-$(basename "$TEMPORARY_DIRECTORY" | cut -d. -f3)"
PAYLOAD_DIRECTORY=$TEMPORARY_DIRECTORY/payload
mkdir -m 0700 "$PAYLOAD_DIRECTORY"

cleanup_incomplete_backup() {
    local backup_exit_code=$?
    trap - EXIT HUP INT TERM
    [[ -d "$TEMPORARY_DIRECTORY" ]] && rm -rf "$TEMPORARY_DIRECTORY"
    exit "$backup_exit_code"
}
trap cleanup_incomplete_backup EXIT HUP INT TERM

source_path() {
    local absolute_path=$1
    if [[ "$SOURCE_ROOT" == "/" ]]; then
        printf '%s\n' "$absolute_path"
    else
        printf '%s%s\n' "$SOURCE_ROOT" "$absolute_path"
    fi
}

archive_path() {
    printf '%s/%s\n' "$PAYLOAD_DIRECTORY" "${1#/}"
}

copy_snapshot_path() {
    local absolute_path=$1 required=$2 restorable=$3
    local actual_source archive_destination presence=false object_type=absent
    actual_source=$(source_path "$absolute_path")
    archive_destination=$(archive_path "$absolute_path")
    if [[ -e "$actual_source" || -L "$actual_source" ]]; then
        presence=true
        mkdir -p "$(dirname "$archive_destination")"
        if [[ -d "$actual_source" && ! -L "$actual_source" ]]; then
            object_type=directory
            mkdir "$archive_destination"
            cp -a -- "$actual_source"/. "$archive_destination"/
        elif [[ -L "$actual_source" ]]; then
            object_type=symlink
            cp -a -- "$actual_source" "$archive_destination"
        elif [[ -f "$actual_source" ]]; then
            object_type=file
            cp -a -- "$actual_source" "$archive_destination"
        else
            echo "FATAL: unsupported backup object type: $absolute_path" >&2
            return 1
        fi
    elif [[ "$required" == "true" ]]; then
        echo "FATAL: required backup path is absent: $absolute_path" >&2
        return 1
    fi
    printf '%s\t%s\t%s\t%s\t%s\n' \
        "$absolute_path" "payload/${absolute_path#/}" "$presence" "$object_type" "$restorable" \
        >> "$TEMPORARY_DIRECTORY/inventory.tsv"
}

: > "$TEMPORARY_DIRECTORY/inventory.tsv"
# Shared network directories are evidence only and are never broad-restored.
copy_snapshot_path /etc/nftables.conf false false
copy_snapshot_path /etc/network false false
copy_snapshot_path /etc/systemd/network false false
copy_snapshot_path /etc/NetworkManager/system-connections false false
copy_snapshot_path /etc/netplan false false
copy_snapshot_path /etc/resolv.conf false false

# Deployment-owned files have exact one-to-one restore mappings.
copy_snapshot_path /etc/systemd/system/aetherguard-cat2-gateway.service false true
copy_snapshot_path /etc/aetherguard-cat2.conf false true
copy_snapshot_path /usr/local/sbin/ag-cat2-gateway false true
copy_snapshot_path /usr/local/sbin/ag-auth-verify.py false true
copy_snapshot_path /usr/local/sbin/ag_auth_common.py false true
copy_snapshot_path /etc/aetherguard-cat2/authorizer-public.pem false true
copy_snapshot_path /var/lib/aetherguard-cat2/authorizer-counter false true

# Runtime observations are required evidence. Any collection failure aborts the backup.
ip -j link > "$TEMPORARY_DIRECTORY/ip-link.json"
ip -j addr > "$TEMPORARY_DIRECTORY/ip-addr.json"
ip -j route > "$TEMPORARY_DIRECTORY/ip-route.json"
bridge link show > "$TEMPORARY_DIRECTORY/bridge-link.txt" 2>&1 || true
if command -v nmcli >/dev/null 2>&1; then
    nmcli connection show > "$TEMPORARY_DIRECTORY/nmcli-connections.txt"
    nmcli -t -f NAME,UUID,TYPE,DEVICE connection show --active > "$TEMPORARY_DIRECTORY/nmcli-active.txt"
else
    printf 'nmcli unavailable\n' > "$TEMPORARY_DIRECTORY/nmcli-connections.txt"
    printf 'nmcli unavailable\n' > "$TEMPORARY_DIRECTORY/nmcli-active.txt"
fi
systemctl is-enabled aetherguard-cat2-gateway.service > "$TEMPORARY_DIRECTORY/gateway-enabled.txt" 2>&1 || true
systemctl is-active aetherguard-cat2-gateway.service > "$TEMPORARY_DIRECTORY/gateway-active.txt" 2>&1 || true
for reactor_service in reactor-edge.service reactor-os-chromium.service reactor-sim-bridge.service; do
    printf '%s\t' "$reactor_service" >> "$TEMPORARY_DIRECTORY/reactor-services.tsv"
    systemctl is-active "$reactor_service" >> "$TEMPORARY_DIRECTORY/reactor-services.tsv" 2>&1 || true
done

python3 - "$TEMPORARY_DIRECTORY" <<'PYEOF'
import hashlib
import json
import os
import stat
import sys

backup_root = sys.argv[1]
inventory = []
with open(os.path.join(backup_root, "inventory.tsv"), "r", encoding="utf-8") as inventory_file:
    for inventory_line in inventory_file:
        source, archive_path, presence, object_type, restorable = inventory_line.rstrip("\n").split("\t")
        inventory.append(
            {
                "source": source,
                "archivePath": archive_path,
                "present": presence == "true",
                "objectType": object_type,
                "restorable": restorable == "true",
            }
        )
manifest = {
    "formatVersion": 1,
    "complete": True,
    "inventory": inventory,
}
manifest_path = os.path.join(backup_root, "manifest.json")
with open(manifest_path, "w", encoding="utf-8") as manifest_file:
    json.dump(manifest, manifest_file, indent=2, sort_keys=True)
    manifest_file.write("\n")
    manifest_file.flush()
    os.fsync(manifest_file.fileno())

checksum_entries = []
for directory_path, directory_names, file_names in os.walk(backup_root):
    directory_names.sort()
    for directory_name in directory_names:
        directory_entry_path = os.path.join(directory_path, directory_name)
        if os.path.islink(directory_entry_path):
            relative_path = os.path.relpath(directory_entry_path, backup_root)
            link_bytes = os.readlink(directory_entry_path).encode("utf-8")
            checksum_entries.append((relative_path, hashlib.sha256(link_bytes).hexdigest()))
    for file_name in sorted(file_names):
        if file_name in ("SHA256SUMS", "COMPLETE"):
            continue
        file_path = os.path.join(directory_path, file_name)
        relative_path = os.path.relpath(file_path, backup_root)
        if os.path.islink(file_path):
            file_bytes = os.readlink(file_path).encode("utf-8")
        else:
            with open(file_path, "rb") as input_file:
                file_bytes = input_file.read()
        checksum_entries.append((relative_path, hashlib.sha256(file_bytes).hexdigest()))
checksum_path = os.path.join(backup_root, "SHA256SUMS")
with open(checksum_path, "w", encoding="ascii") as checksum_file:
    for relative_path, digest_text in checksum_entries:
        checksum_file.write("%s  %s\n" % (digest_text, relative_path))
    checksum_file.flush()
    os.fsync(checksum_file.fileno())
complete_path = os.path.join(backup_root, "COMPLETE")
with open(complete_path, "x", encoding="ascii") as complete_file:
    complete_file.write("complete\n")
    complete_file.flush()
    os.fsync(complete_file.fileno())
directory_descriptor = os.open(backup_root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
try:
    for directory_path, directory_names, file_names in os.walk(backup_root, topdown=False):
        for file_name in file_names:
            file_path = os.path.join(directory_path, file_name)
            if os.path.islink(file_path):
                continue
            file_descriptor = os.open(file_path, os.O_RDONLY)
            try:
                os.fsync(file_descriptor)
            finally:
                os.close(file_descriptor)
        child_directory_descriptor = os.open(
            directory_path,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
        )
        try:
            os.fsync(child_directory_descriptor)
        finally:
            os.close(child_directory_descriptor)
    os.fsync(directory_descriptor)
finally:
    os.close(directory_descriptor)
PYEOF

mv "$TEMPORARY_DIRECTORY" "$FINAL_DIRECTORY"
TEMPORARY_DIRECTORY=
python3 - "$BACKUP_ROOT" <<'PYEOF'
import os
import sys

directory_descriptor = os.open(sys.argv[1], os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
try:
    os.fsync(directory_descriptor)
finally:
    os.close(directory_descriptor)
PYEOF
trap - EXIT HUP INT TERM
printf '%s\n' "$FINAL_DIRECTORY"
logger -t aetherguard-cat2 -- "action=backup result=complete dest=$FINAL_DIRECTORY" 2>/dev/null || true
