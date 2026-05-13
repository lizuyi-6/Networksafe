#!/usr/bin/env bash

set -uo pipefail

SERIAL_HELPER_DEVICE="${SERIAL_HELPER_DEVICE:-/dev/ttyUSB0}"
SERIAL_HELPER_BAUD="${SERIAL_HELPER_BAUD:-115200}"
SERIAL_HELPER_REOPEN_DELAY="${SERIAL_HELPER_REOPEN_DELAY:-2}"
SERIAL_HELPER_ID="${SERIAL_HELPER_ID:-serial-helper-01}"
SERIAL_HELPER_CONTROL_PLANE="${SERIAL_HELPER_CONTROL_PLANE:-http://127.0.0.1:3005}"
SERIAL_HELPER_TENANT_ID="${SERIAL_HELPER_TENANT_ID:-platform}"
SERIAL_HELPER_VERSION="${SERIAL_HELPER_VERSION:-1.0.0-enterprise}"
SERIAL_HELPER_WRITABLE_PATHS="${SERIAL_HELPER_WRITABLE_PATHS:-/tmp,/etc/aetherguard,/usr/local/bin}"
SERIAL_HELPER_SHARED_SECRET="${SERIAL_HELPER_SHARED_SECRET:-${DEVICE_COMMAND_SECRET:-}}"

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

api_get() {
  local path="$1"
  curl -fsS \
    -H "x-aetherguard-helper-secret: ${SERIAL_HELPER_SHARED_SECRET}" \
    "${SERIAL_HELPER_CONTROL_PLANE}${path}"
}

api_post() {
  local path="$1"
  local payload="$2"
  curl -fsS -X POST \
    -H 'Content-Type: application/json' \
    -H "x-aetherguard-helper-secret: ${SERIAL_HELPER_SHARED_SECRET}" \
    -d "$payload" \
    "${SERIAL_HELPER_CONTROL_PLANE}${path}"
}

register_helper() {
  local hostname
  hostname="$(hostname)"
  api_post "/api/helpers/register" "$(cat <<JSON
{"helperId":"${SERIAL_HELPER_ID}","tenantId":"${SERIAL_HELPER_TENANT_ID}","fingerprint":"$(hostname)-$(uname -sr)","version":"${SERIAL_HELPER_VERSION}","hostname":"${hostname}","systemdStatus":"active","targetHost":"${hostname}","writablePaths":["$(printf '%s' "${SERIAL_HELPER_WRITABLE_PATHS}" | sed 's/,/","/g')"]}
JSON
)" >/dev/null || log "helper registration failed"
}

heartbeat_helper() {
  local hostname
  hostname="$(hostname)"
  api_post "/api/helpers/${SERIAL_HELPER_ID}/heartbeat" "$(cat <<JSON
{"systemdStatus":"active","targetHost":"${hostname}","writablePaths":["$(printf '%s' "${SERIAL_HELPER_WRITABLE_PATHS}" | sed 's/,/","/g')"]}
JSON
)" >/dev/null || true
}

extract_json_field() {
  local key="$1"
  node -e "const fs=require('fs'); const payload=JSON.parse(fs.readFileSync(0,'utf8')); const keys='${key}'.split('.'); let v=payload; for (const k of keys) v=v?.[k]; if (v===undefined||v===null) process.exit(1); process.stdout.write(typeof v==='string'?v:JSON.stringify(v));"
}

fetch_instruction() {
  local action="$1"
  api_get "/api/helpers/${SERIAL_HELPER_ID}/serial-request/${action}"
}

post_result() {
  local run_id="$1"
  local request_type="$2"
  local success="$3"
  local output="$4"
  local signature="$5"
  local payload_json="$6"
  api_post "/api/helpers/${SERIAL_HELPER_ID}/serial-request-result" "$(cat <<JSON
{"runId":"${run_id}","tenantId":"${SERIAL_HELPER_TENANT_ID}","requestType":"${request_type}","success":${success},"output":$(printf '%s' "$output" | node -p "JSON.stringify(require('fs').readFileSync(0,'utf8'))"),"signature":"${signature}","payload":${payload_json}}
JSON
)"
}

run_instruction() {
  local action="$1"
  local response
  local run_id
  local script
  local signature
  local payload_json
  local rc=0
  local output=""
  local temp_script

  response="$(fetch_instruction "$action")" || {
    write_line "AG:ERR:${action}:NOT_READY"
    return 1
  }

  run_id="$(printf '%s' "$response" | extract_json_field 'data.run.id')" || {
    write_line "AG:ERR:${action}:RUN_ID_MISSING"
    return 1
  }
  script="$(printf '%s' "$response" | extract_json_field 'data.script')" || {
    write_line "AG:ERR:${action}:SCRIPT_MISSING"
    return 1
  }
  signature="$(printf '%s' "$response" | extract_json_field 'data.signature')" || {
    write_line "AG:ERR:${action}:SIGNATURE_MISSING"
    return 1
  }
  payload_json="$(printf '%s' "$response" | extract_json_field 'data.payload')" || {
    write_line "AG:ERR:${action}:PAYLOAD_MISSING"
    return 1
  }

  temp_script="$(mktemp "/tmp/aetherguard-helper-${action,,}-XXXXXX.sh")"
  printf '%s\n' "$script" > "$temp_script"
  chmod 700 "$temp_script"

  write_line "AG:BEGIN:${action}"
  write_line "AG:STEP:${action}:RUN"

  output="$(bash "$temp_script" 2>&1)"
  rc=$?
  rm -f "$temp_script"

  if [[ "$rc" -eq 0 ]]; then
    post_result "$run_id" "$action" true "$output" "$signature" "$payload_json" >/dev/null 2>&1 || true
    write_line "AG:OK:${action}"
    return 0
  fi

  post_result "$run_id" "$action" false "$output" "$signature" "$payload_json" >/dev/null 2>&1 || true
  write_line "AG:ERR:${action}:${rc}"
  return "$rc"
}

handle_request() {
  local request="$1"

  case "$request" in
    AG:REQ:ENV)
      heartbeat_helper
      if [[ "$(uname -s)" == "Linux" ]]; then
        write_line "AG:ENV:LINUX"
      else
        write_line "AG:ENV:WINDOWS"
      fi
      ;;
    AG:REQ:BACKUP)
      run_instruction "BACKUP"
      ;;
    AG:REQ:INSTALL)
      run_instruction "INSTALL"
      ;;
    AG:REQ:REMOVE)
      run_instruction "REMOVE"
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

  register_helper
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
    heartbeat_helper

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
