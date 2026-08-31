#!/usr/bin/env bash

set -uo pipefail

SERIAL_HELPER_DEVICE="${SERIAL_HELPER_DEVICE:-/dev/ttyUSB0}"
SERIAL_HELPER_BAUD="${SERIAL_HELPER_BAUD:-115200}"
SERIAL_HELPER_REOPEN_DELAY="${SERIAL_HELPER_REOPEN_DELAY:-2}"

# NOTE (audit 2026-08, N1-4): the AG:REQ USB-TTL protocol is archived — the
# Gateway Appliance line speaks newline-delimited JSON (see
# deployments.routes.ts). This helper remains for legacy bare-metal rescue and
# its BACKUP/REMOVE actions are hardened below:
#   - backups land in a PERSISTENT dir (/var/backups/aetherguard), named by
#     timestamp + content sha256, never overwriting an earlier backup;
#   - the archive is verified readable before AG:OK is reported;
#   - REMOVE refuses to run unless a fresh verified backup exists
#     (AETHERGUARD_REMOVE_FORCE=1 is the explicit operator escape hatch) —
#     previously `rm -rf` executed with no backup-ordering guarantee, and the
#     /tmp backup vanished on reboot.
AETHERGUARD_BACKUP_DIR="${AETHERGUARD_BACKUP_DIR:-/var/backups/aetherguard}"
AETHERGUARD_REMOVE_MAX_BACKUP_AGE_S="${AETHERGUARD_REMOVE_MAX_BACKUP_AGE_S:-3600}"
DEFAULT_BACKUP_CMD='ts=$(date +%Y%m%d%H%M%S); mkdir -p "'"$AETHERGUARD_BACKUP_DIR"'" && tar -czf "'"$AETHERGUARD_BACKUP_DIR"'/.stage_$ts.tgz" /etc/AetherGuard /etc/hosts 2>/dev/null; rc=$?; [ $rc -eq 0 ] || exit $rc; sha=$(sha256sum "'"$AETHERGUARD_BACKUP_DIR"'/.stage_$ts.tgz" | cut -d" " -f1); tar -tzf "'"$AETHERGUARD_BACKUP_DIR"'/.stage_$ts.tgz" >/dev/null 2>&1 || exit 1; mv "'"$AETHERGUARD_BACKUP_DIR"'/.stage_$ts.tgz" "'"$AETHERGUARD_BACKUP_DIR"'/etc_aetherguard_${ts}_$sha.tgz"; printf "%s" "'"$AETHERGUARD_BACKUP_DIR"'/etc_aetherguard_${ts}_$sha.tgz" > "'"$AETHERGUARD_BACKUP_DIR"'/latest"'
DEFAULT_REMOVE_CMD='set -e; latest="'"$AETHERGUARD_BACKUP_DIR"'/latest"; [ -s "$latest" ] || { echo "no verified backup recorded — run BACKUP first (or set AETHERGUARD_REMOVE_FORCE=1)"; exit 3; }; backup=$(cat "$latest"); [ -f "$backup" ] || { echo "recorded backup missing: $backup"; exit 3; }; age=$(( $(date +%s) - $(stat -c %Y "$backup") )); [ "$age" -le '"$AETHERGUARD_REMOVE_MAX_BACKUP_AGE_S"' ] || { echo "backup too old (${age}s > '"$AETHERGUARD_REMOVE_MAX_BACKUP_AGE_S"'s) — re-run BACKUP first"; exit 3; }; tar -tzf "$backup" >/dev/null 2>&1 || { echo "backup archive unreadable: $backup"; exit 3; }; rm -rf /opt/AetherGuard'

AETHERGUARD_BACKUP_CMD="${AETHERGUARD_BACKUP_CMD:-$DEFAULT_BACKUP_CMD}"
AETHERGUARD_INSTALL_CMD="${AETHERGUARD_INSTALL_CMD:-}"
if [[ "${AETHERGUARD_REMOVE_FORCE:-0}" == "1" ]]; then
  # Explicit operator escape hatch: destructive remove WITHOUT the fresh-backup
  # guard. Must be set deliberately in the helper's environment, never by a
  # request line.
  AETHERGUARD_REMOVE_CMD="${AETHERGUARD_REMOVE_CMD:-rm -rf /opt/AetherGuard}"
else
  AETHERGUARD_REMOVE_CMD="${AETHERGUARD_REMOVE_CMD:-$DEFAULT_REMOVE_CMD}"
fi

log() {
  printf '[serial-helper] %s\n' "$*" >&2
}

write_line() {
  printf '%s\r\n' "$1" >&3
}

configure_serial() {
  stty -F "$SERIAL_HELPER_DEVICE" \
    "$SERIAL_HELPER_BAUD" \
    raw -echo -echoe -echok -echoctl -echoke \
    cs8 -cstopb -parenb -ixon -ixoff -crtscts
}

run_action() {
  local action="$1"
  local command="$2"
  local rc=0

  if [[ -z "$command" ]]; then
    write_line "AG:ERR:${action}:NOT_CONFIGURED"
    return 1
  fi

  write_line "AG:BEGIN:${action}"
  write_line "AG:STEP:${action}:RUN"

  bash -lc "$command"
  rc=$?

  if [[ "$rc" -eq 0 ]]; then
    write_line "AG:OK:${action}"
    return 0
  fi

  write_line "AG:ERR:${action}:${rc}"
  return "$rc"
}

handle_request() {
  local request="$1"

  case "$request" in
    AG:REQ:ENV)
      if [[ "$(uname -s)" == "Linux" ]]; then
        write_line "AG:ENV:LINUX"
      else
        write_line "AG:ENV:WINDOWS"
      fi
      ;;
    AG:REQ:BACKUP)
      run_action "BACKUP" "$AETHERGUARD_BACKUP_CMD"
      ;;
    AG:REQ:INSTALL)
      run_action "INSTALL" "$AETHERGUARD_INSTALL_CMD"
      ;;
    AG:REQ:REMOVE)
      run_action "REMOVE" "$AETHERGUARD_REMOVE_CMD"
      ;;
    *)
      if [[ -n "$request" ]]; then
        log "Ignoring unsupported request: $request"
      fi
      ;;
  esac
}

main() {
  local raw_line=""
  local line=""

  while true; do
    if [[ ! -e "$SERIAL_HELPER_DEVICE" ]]; then
      log "Waiting for serial device: $SERIAL_HELPER_DEVICE"
      sleep "$SERIAL_HELPER_REOPEN_DELAY"
      continue
    fi

    if ! exec 3<>"$SERIAL_HELPER_DEVICE"; then
      log "Unable to open serial device: $SERIAL_HELPER_DEVICE"
      sleep "$SERIAL_HELPER_REOPEN_DELAY"
      continue
    fi

    if ! configure_serial; then
      log "Unable to configure serial device: $SERIAL_HELPER_DEVICE"
      exec 3>&-
      exec 3<&-
      sleep "$SERIAL_HELPER_REOPEN_DELAY"
      continue
    fi

    log "Listening on $SERIAL_HELPER_DEVICE at ${SERIAL_HELPER_BAUD} baud"

    while IFS= read -r raw_line <&3; do
      line="${raw_line%$'\r'}"
      handle_request "$line"
    done

    log "Serial device disconnected: $SERIAL_HELPER_DEVICE"
    exec 3>&-
    exec 3<&-
    sleep "$SERIAL_HELPER_REOPEN_DELAY"
  done
}

main "$@"
