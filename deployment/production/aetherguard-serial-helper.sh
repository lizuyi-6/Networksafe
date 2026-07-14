#!/usr/bin/env bash

set -uo pipefail

SERIAL_HELPER_DEVICE="${SERIAL_HELPER_DEVICE:-/dev/ttyUSB0}"
SERIAL_HELPER_BAUD="${SERIAL_HELPER_BAUD:-115200}"
SERIAL_HELPER_REOPEN_DELAY="${SERIAL_HELPER_REOPEN_DELAY:-2}"

DEFAULT_BACKUP_CMD='ts=$(date +%Y%m%d%H%M%S); backup_dir=/tmp/aetherguard_backup_$ts; mkdir -p "$backup_dir" && tar -czf "$backup_dir/etc_aetherguard.tgz" /etc/AetherGuard /etc/hosts 2>/dev/null'
DEFAULT_REMOVE_CMD='rm -rf /opt/AetherGuard'

AETHERGUARD_BACKUP_CMD="${AETHERGUARD_BACKUP_CMD:-$DEFAULT_BACKUP_CMD}"
AETHERGUARD_INSTALL_CMD="${AETHERGUARD_INSTALL_CMD:-}"
AETHERGUARD_REMOVE_CMD="${AETHERGUARD_REMOVE_CMD:-$DEFAULT_REMOVE_CMD}"

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
