#!/bin/bash
# Validate a complete snapshot, force isolation, and optionally restore owned files.
set -Eeuo pipefail

PATH=${AG_COMMAND_PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}
LOG_PATH=${AG_ROLLBACK_LOG_PATH:-/var/log/aetherguard-rollback.log}
BACKUP_ROOT=${AG_BACKUP_ROOT:-/root/aetherguard-cat2-backup}
TARGET_ROOT=${AG_ROLLBACK_TARGET_ROOT:-/}
TARGET_ROOT=${TARGET_ROOT%/}
[[ -n "$TARGET_ROOT" ]] || TARGET_ROOT=/
GATEWAY_CONFIG_PATH=${AG_GATEWAY_CONFIG_PATH:-/etc/aetherguard-cat2.conf}
SYS_CLASS_NET=${AG_SYS_CLASS_NET:-/sys/class/net}
USB_STATE_PATH=${AG_USB_STATE_PATH:-/var/lib/aetherguard-cat2/usb-rndis/cat2-state}
USB_TEARDOWN_PATH=${AG_USB_TEARDOWN_PATH:-/usr/local/libexec/aetherguard-cat2-usb-rndis/cat2-teardown.sh}
MANAGEMENT_INTERFACE=${AG_MANAGEMENT_INTERFACE:-usb0}
MANAGEMENT_ADDRESS=${AG_MANAGEMENT_ADDRESS:-192.168.100.2/24}
BACKUP_DIRECTORY=${1:-}

log_message() {
    printf '%s\n' "$1" | tee -a "$LOG_PATH"
    logger -t aetherguard-rollback -- "$1" 2>/dev/null || true
}

mkdir -p "$BACKUP_ROOT"
ROLLBACK_LOCK_FILE=${AG_ROLLBACK_LOCK_FILE:-$BACKUP_ROOT/.rollback.lock}
touch "$ROLLBACK_LOCK_FILE"
chmod 0600 "$ROLLBACK_LOCK_FILE"
exec 9>"$ROLLBACK_LOCK_FILE"
flock -x 9

if [[ -z "$BACKUP_DIRECTORY" ]]; then
    BACKUP_DIRECTORY=$(python3 - "$BACKUP_ROOT" <<'PYEOF'
import os
import sys

backup_root = os.path.realpath(sys.argv[1])
if not os.path.isdir(backup_root):
    raise SystemExit("backup root is missing")
completed_backups = []
for entry_name in os.listdir(backup_root):
    candidate_path = os.path.join(backup_root, entry_name)
    if os.path.isdir(candidate_path) and os.path.isfile(os.path.join(candidate_path, "COMPLETE")):
        completed_backups.append(candidate_path)
if not completed_backups:
    raise SystemExit("no completed backups")
print(sorted(completed_backups)[-1])
PYEOF
    )
fi

BACKUP_DIRECTORY=$(python3 - "$BACKUP_ROOT" "$BACKUP_DIRECTORY" <<'PYEOF'
import os
import sys

backup_root = os.path.realpath(sys.argv[1])
backup_directory = os.path.realpath(sys.argv[2])
if os.path.commonpath((backup_root, backup_directory)) != backup_root or backup_directory == backup_root:
    raise SystemExit("backup path escapes or equals backup root")
if not os.path.isdir(backup_directory):
    raise SystemExit("backup directory is missing")
print(backup_directory)
PYEOF
) || {
    log_message "FATAL reason=BACKUP_PATH_INVALID"
    exit 1
}

[[ -f "$BACKUP_DIRECTORY/COMPLETE" && ! -L "$BACKUP_DIRECTORY/COMPLETE" ]] \
    || { log_message "FATAL reason=BACKUP_NOT_COMPLETE"; exit 1; }
[[ -f "$BACKUP_DIRECTORY/manifest.json" && ! -L "$BACKUP_DIRECTORY/manifest.json" ]] \
    || { log_message "FATAL reason=BACKUP_MANIFEST_MISSING"; exit 1; }
[[ -f "$BACKUP_DIRECTORY/SHA256SUMS" && ! -L "$BACKUP_DIRECTORY/SHA256SUMS" ]] \
    || { log_message "FATAL reason=BACKUP_CHECKSUMS_MISSING"; exit 1; }

python3 - "$BACKUP_DIRECTORY" <<'PYEOF'
import hashlib
import json
import os
import posixpath
import re
import sys

backup_directory = os.path.realpath(sys.argv[1])
checksum_path = os.path.join(backup_directory, "SHA256SUMS")

def reject_duplicate_object_keys(object_pairs):
    parsed_object = {}
    for object_key, object_value in object_pairs:
        if object_key in parsed_object:
            raise ValueError("duplicate JSON object key: %s" % object_key)
        parsed_object[object_key] = object_value
    return parsed_object

def reject_nonstandard_json_constant(constant_text):
    raise ValueError("non-standard JSON constant: %s" % constant_text)

def path_has_symlink_parent(candidate_path):
    relative_path = os.path.relpath(candidate_path, backup_directory)
    current_path = backup_directory
    for path_component in relative_path.split(os.sep)[:-1]:
        current_path = os.path.join(current_path, path_component)
        if os.path.islink(current_path):
            return True
    return False

observed_paths = set()
with open(checksum_path, "r", encoding="ascii") as checksum_file:
    for line_number, checksum_line in enumerate(checksum_file, start=1):
        try:
            expected_digest, relative_path = checksum_line.rstrip("\n").split("  ", 1)
        except ValueError:
            raise SystemExit("malformed checksum line %d" % line_number)
        if not re.fullmatch(r"[a-f0-9]{64}", expected_digest):
            raise SystemExit("invalid checksum at line %d" % line_number)
        if relative_path in observed_paths:
            raise SystemExit("duplicate checksum path: %s" % relative_path)
        if (
            os.path.isabs(relative_path)
            or os.path.normpath(relative_path) != relative_path
            or relative_path in ("", ".")
        ):
            raise SystemExit("checksum path is not normalized and relative: %s" % relative_path)
        observed_paths.add(relative_path)
        candidate_path = os.path.abspath(os.path.join(backup_directory, relative_path))
        if os.path.commonpath((backup_directory, candidate_path)) != backup_directory:
            raise SystemExit("checksum path escapes backup: %s" % relative_path)
        if path_has_symlink_parent(candidate_path):
            raise SystemExit("checksum path traverses a symlink parent: %s" % relative_path)
        if not os.path.isfile(candidate_path) and not os.path.islink(candidate_path):
            raise SystemExit("checksummed object is missing: %s" % relative_path)
        if os.path.islink(candidate_path):
            file_bytes = os.readlink(candidate_path).encode("utf-8")
        else:
            with open(candidate_path, "rb") as input_file:
                file_bytes = input_file.read()
        if hashlib.sha256(file_bytes).hexdigest() != expected_digest:
            raise SystemExit("checksum mismatch: %s" % relative_path)

expected_paths = set()
for directory_path, directory_names, file_names in os.walk(backup_directory):
    directory_names.sort()
    for directory_name in directory_names:
        directory_entry_path = os.path.join(directory_path, directory_name)
        if os.path.islink(directory_entry_path):
            expected_paths.add(os.path.relpath(directory_entry_path, backup_directory))
    for file_name in sorted(file_names):
        if file_name in ("SHA256SUMS", "COMPLETE"):
            continue
        expected_paths.add(os.path.relpath(os.path.join(directory_path, file_name), backup_directory))
if observed_paths != expected_paths:
    raise SystemExit("checksum inventory is not exact")

with open(os.path.join(backup_directory, "manifest.json"), "r", encoding="utf-8") as manifest_file:
    manifest = json.load(
        manifest_file,
        object_pairs_hook=reject_duplicate_object_keys,
        parse_constant=reject_nonstandard_json_constant,
    )
if not isinstance(manifest, dict):
    raise SystemExit("manifest root is not an object")
if type(manifest.get("formatVersion")) is not int or manifest.get("formatVersion") != 1:
    raise SystemExit("manifest format version is invalid")
if manifest.get("complete") is not True:
    raise SystemExit("manifest format or complete flag is invalid")
if set(manifest) != {"formatVersion", "complete", "inventory"}:
    raise SystemExit("manifest field set is invalid")

shared_evidence_sources = {
    "/etc/nftables.conf",
    "/etc/network",
    "/etc/systemd/network",
    "/etc/NetworkManager/system-connections",
    "/etc/netplan",
    "/etc/resolv.conf",
}
deployment_owned_sources = {
    "/etc/systemd/system/aetherguard-cat2-gateway.service",
    "/etc/aetherguard-cat2.conf",
    "/usr/local/sbin/ag-cat2-gateway",
    "/usr/local/sbin/ag-auth-verify.py",
    "/usr/local/sbin/ag_auth_common.py",
    "/etc/aetherguard-cat2/authorizer-public.pem",
    "/var/lib/aetherguard-cat2/authorizer-counter",
}
expected_sources = shared_evidence_sources | deployment_owned_sources
inventory = manifest.get("inventory")
if not isinstance(inventory, list):
    raise SystemExit("manifest inventory is not an array")
observed_sources = set()
observed_archive_paths = set()
for inventory_entry in inventory:
    if not isinstance(inventory_entry, dict):
        raise SystemExit("manifest inventory entry is not an object")
    if set(inventory_entry) != {"source", "archivePath", "present", "objectType", "restorable"}:
        raise SystemExit("manifest inventory entry field set is invalid")
    source_path = inventory_entry.get("source", "")
    archive_path = inventory_entry.get("archivePath", "")
    if source_path not in expected_sources or posixpath.normpath(source_path) != source_path:
        raise SystemExit("manifest source is outside the exact inventory: %s" % source_path)
    if source_path in observed_sources:
        raise SystemExit("duplicate manifest source: %s" % source_path)
    observed_sources.add(source_path)
    if archive_path != "payload/" + source_path.lstrip("/"):
        raise SystemExit("manifest restore mapping is invalid")
    if archive_path in observed_archive_paths:
        raise SystemExit("duplicate manifest archive path: %s" % archive_path)
    observed_archive_paths.add(archive_path)
    expected_restorable = source_path in deployment_owned_sources
    if inventory_entry.get("restorable") is not expected_restorable:
        raise SystemExit("manifest restorable flag violates the fixed whitelist: %s" % source_path)
    present = inventory_entry.get("present")
    object_type = inventory_entry.get("objectType")
    if type(present) is not bool or object_type not in {"absent", "file", "symlink", "directory"}:
        raise SystemExit("manifest presence or object type is invalid: %s" % source_path)
    if present is (object_type == "absent"):
        raise SystemExit("manifest presence and object type disagree: %s" % source_path)
    archived_object = os.path.join(backup_directory, archive_path)
    if present:
        if path_has_symlink_parent(archived_object):
            raise SystemExit("archive path traverses a symlink parent: %s" % archive_path)
        if object_type == "symlink":
            archived_type_matches = os.path.islink(archived_object)
        elif object_type == "file":
            archived_type_matches = os.path.isfile(archived_object) and not os.path.islink(archived_object)
        else:
            archived_type_matches = os.path.isdir(archived_object) and not os.path.islink(archived_object)
        if not archived_type_matches:
            raise SystemExit("manifest object type does not match archive: %s" % source_path)
    elif os.path.lexists(archived_object):
        raise SystemExit("absent manifest source unexpectedly has archive payload: %s" % source_path)
    if expected_restorable and object_type == "directory":
        raise SystemExit("deployment-owned directory restore is forbidden: %s" % source_path)
if observed_sources != expected_sources:
    raise SystemExit("manifest source inventory is not exact")
PYEOF

log_message "ROLLBACK_START time=$(date -u +%Y-%m-%dT%H:%M:%SZ) backup=$BACKUP_DIRECTORY"

if command -v ag-cat2-gateway >/dev/null 2>&1; then
    ag-cat2-gateway isolate || { log_message "FATAL reason=GATE_ISOLATION_FAILED"; exit 1; }
else
    server_interface=$(sed -n 's/^SERVER_IF=\([A-Za-z0-9_.:-][A-Za-z0-9_.:-]*\)$/\1/p' \
        "$GATEWAY_CONFIG_PATH" 2>/dev/null || true)
    [[ -n "$server_interface" && "$server_interface" != *$'\n'* ]] \
        || { log_message "FATAL reason=SERVER_INTERFACE_UNAVAILABLE"; exit 1; }
    ip link set dev "$server_interface" nomaster
    [[ ! -d "$SYS_CLASS_NET/$server_interface/brport" ]] \
        || { log_message "FATAL reason=EMERGENCY_GATE_CLOSE_UNVERIFIED"; exit 1; }
fi

while IFS= read -r lease_timer; do
    [[ -n "$lease_timer" ]] || continue
    systemctl stop "$lease_timer" >/dev/null 2>&1 || true
done < <(systemctl list-units --type=timer --all --no-legend --no-pager \
    'ag-cat2-lease-*.timer' 2>/dev/null | awk '/^ag-cat2-lease-.*[.]timer/ {print $1}')

if [[ -r "$USB_STATE_PATH" ]]; then
    [[ -x "$USB_TEARDOWN_PATH" ]] \
        || { log_message "FATAL reason=USB_TEARDOWN_UNAVAILABLE"; exit 1; }
    "$USB_TEARDOWN_PATH"
fi

if [[ "${AG_RESTORE_BACKUP_FILES:-0}" == "1" ]]; then
    python3 - "$BACKUP_DIRECTORY" "$TARGET_ROOT" <<'PYEOF'
import json
import os
import secrets
import shutil
import sys
import tempfile

backup_directory = os.path.realpath(sys.argv[1])
target_root = os.path.realpath(sys.argv[2])
if not os.path.isdir(target_root) or os.path.islink(sys.argv[2]):
    raise SystemExit("rollback target root is not a regular directory")

def reject_duplicate_object_keys(object_pairs):
    parsed_object = {}
    for object_key, object_value in object_pairs:
        if object_key in parsed_object:
            raise ValueError("duplicate JSON object key: %s" % object_key)
        parsed_object[object_key] = object_value
    return parsed_object

deployment_owned_sources = {
    "/etc/systemd/system/aetherguard-cat2-gateway.service",
    "/etc/aetherguard-cat2.conf",
    "/usr/local/sbin/ag-cat2-gateway",
    "/usr/local/sbin/ag-auth-verify.py",
    "/usr/local/sbin/ag_auth_common.py",
    "/etc/aetherguard-cat2/authorizer-public.pem",
    "/var/lib/aetherguard-cat2/authorizer-counter",
}
with open(os.path.join(backup_directory, "manifest.json"), "r", encoding="utf-8") as manifest_file:
    manifest = json.load(manifest_file, object_pairs_hook=reject_duplicate_object_keys)

for inventory_entry in manifest["inventory"]:
    if not inventory_entry["restorable"]:
        continue
    source_path = inventory_entry["source"]
    if source_path not in deployment_owned_sources:
        raise SystemExit("restore source violates the fixed whitelist: %s" % source_path)
    target_path = os.path.join(target_root, source_path.lstrip("/"))
    archive_path = os.path.join(backup_directory, inventory_entry["archivePath"])
    target_parent = os.path.dirname(target_path)
    os.makedirs(target_parent, mode=0o700, exist_ok=True)
    resolved_target_parent = os.path.realpath(target_parent)
    if os.path.commonpath((target_root, resolved_target_parent)) != target_root:
        raise SystemExit("restore target parent escapes target root: %s" % source_path)
    if not inventory_entry["present"]:
        if os.path.lexists(target_path):
            if os.path.isdir(target_path) and not os.path.islink(target_path):
                raise SystemExit("refusing to recursively delete an originally absent path: %s" % source_path)
            os.unlink(target_path)
        continue
    object_type = inventory_entry["objectType"]
    if object_type == "directory":
        raise SystemExit("broad directory restore is forbidden: %s" % source_path)
    temporary_path = None
    try:
        if object_type == "file":
            temporary_descriptor, temporary_path = tempfile.mkstemp(
                prefix=".%s.restore." % os.path.basename(target_path),
                dir=target_parent,
            )
            os.close(temporary_descriptor)
            shutil.copy2(archive_path, temporary_path, follow_symlinks=False)
            restored_file_descriptor = os.open(temporary_path, os.O_RDONLY)
            try:
                os.fsync(restored_file_descriptor)
            finally:
                os.close(restored_file_descriptor)
        elif object_type == "symlink":
            for _ in range(100):
                temporary_path = os.path.join(
                    target_parent,
                    ".%s.restore.%s" % (os.path.basename(target_path), secrets.token_hex(8)),
                )
                try:
                    os.symlink(os.readlink(archive_path), temporary_path)
                    break
                except FileExistsError:
                    continue
            else:
                raise SystemExit("cannot allocate temporary restore symlink")
        else:
            raise SystemExit("unsupported restore type: %s" % object_type)
        os.replace(temporary_path, target_path)
    finally:
        if temporary_path is not None and os.path.lexists(temporary_path):
            os.unlink(temporary_path)
    directory_descriptor = os.open(target_parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(directory_descriptor)
    finally:
        os.close(directory_descriptor)
PYEOF
    systemctl daemon-reload
    log_message "BACKUP_FILES_RESTORED scope=deployment-owned-only"
fi

ip -o -4 address show dev "$MANAGEMENT_INTERFACE" \
    | awk -v expected_address="$MANAGEMENT_ADDRESS" '$4 == expected_address {found=1} END {exit !found}' \
    || { log_message "FATAL reason=USB0_MANAGEMENT_ADDRESS_MISSING"; exit 1; }
[[ ! -d "$SYS_CLASS_NET/$MANAGEMENT_INTERFACE/brport" ]] \
    || { log_message "FATAL reason=USB0_UNEXPECTEDLY_BRIDGED"; exit 1; }

reactor_failure=0
while IFS=$'\t' read -r reactor_service expected_state; do
    [[ -n "$reactor_service" ]] || continue
    if [[ "$expected_state" == "active" ]]; then
        systemctl is-active --quiet "$reactor_service" || reactor_failure=1
    fi
done < "$BACKUP_DIRECTORY/reactor-services.tsv"
(( reactor_failure == 0 )) \
    || { log_message "FATAL reason=PREVIOUSLY_ACTIVE_REACTOR_SERVICE_INACTIVE"; exit 1; }

log_message "ROLLBACK_DONE time=$(date -u +%Y-%m-%dT%H:%M:%SZ) gate=isolated usb0=available reactor=restored-or-unchanged"
