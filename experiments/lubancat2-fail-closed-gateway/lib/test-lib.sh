#!/bin/bash
# Shared fail-fast runner and immutable result lifecycle for Cat2 experiments.
set -Eeuo pipefail

AG_ROOT=${AG_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
if [[ -z "${AG_RUN_ID:-}" ]]; then
    AG_RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
fi
AG_RUN_DIR=${AG_RUN_DIR:-$AG_ROOT/results/raw/$AG_RUN_ID}
AG_EVIDENCE_DIR=${AG_EVIDENCE_DIR:-$AG_RUN_DIR/evidence}
AG_BOARD=${AG_BOARD:-board}
AG_MANAGEMENT_SOURCE_ADDRESS=${AG_MANAGEMENT_SOURCE_ADDRESS:-192.168.100.1}
AG_MANAGEMENT_REMOTE_ADDRESS=${AG_MANAGEMENT_REMOTE_ADDRESS:-192.168.100.2}
AG_TRANSPORT=${AG_TRANSPORT:-usb-rndis}
AG_VICTIM_NETNS=${AG_VICTIM_NETNS:-victim}
AG_PROTECTED_IF=${AG_PROTECTED_IF:-agvictim0}
AG_SERVER_IF=${AG_SERVER_IF:-usb1}
AG_UPLINK_IF=${AG_UPLINK_IF:-usb2}
AG_MANAGEMENT_IF=${AG_MANAGEMENT_IF:-usb0}
AG_UPLINK_TARGET=${AG_UPLINK_TARGET:-10.99.0.1}
AG_CAPTURE_IF=${AG_CAPTURE_IF:-$AG_UPLINK_IF}
AG_PROTECTED_ENDPOINT=${AG_PROTECTED_ENDPOINT:-netns:$AG_VICTIM_NETNS/$AG_PROTECTED_IF}
AG_CLEANUP_GATEWAY=${AG_CLEANUP_GATEWAY:-1}
AG_GATEWAY_COMMIT=${AG_GATEWAY_COMMIT:-$(git -C "$AG_ROOT" rev-parse HEAD)}

AG_TEST_ID=
AG_TEST_CATEGORY=
AG_TEST_TRAFFIC_PROFILE=${AG_TEST_TRAFFIC_PROFILE:-NONE}
AG_TEST_COMMAND=
AG_TEST_TEXT_PATH=
AG_TEST_JSON_PATH=
AG_TEST_TEXT_TEMP_PATH=
AG_TEST_JSON_TEMP_PATH=
AG_TEST_STARTED_AT=
AG_TEST_FINISHED_AT=
AG_TEST_STATE_BEFORE=unknown
AG_TEST_STATE_AFTER=unknown
AG_TEST_CAT2_HOSTNAME=unknown
AG_TEST_MANAGEMENT_AVAILABLE=false
AG_TEST_RESULT_REQUESTED=0
AG_TEST_RESULT_PUBLISHED=0
AG_TEST_REQUESTED_STATUS=FAILED
AG_TEST_REQUESTED_EXIT_CODE=1
AG_TEST_EXPECTED=
AG_TEST_OBSERVED=
AG_TEST_REASON_CODE=UNSET
AG_TEST_RELEASE_LATENCY_MS=null
AG_TEST_ISOLATION_LATENCY_MS=null
AG_TEST_UNAUTHORIZED_CONNECTIONS=0
AG_TEST_ESCAPED_PACKETS=0
AG_TEST_ESCAPED_BYTES=0
AG_TEST_UPLINK_OBSERVED_PACKETS=0
AG_TEST_PROBE_COMMAND_EXECUTED=false
AG_TEST_PROBE_REACHED_UPSTREAM=null
AG_TEST_PACKET_OBSERVED_ON_UPLINK=null
AG_TEST_CLEANUP_ATTEMPTED=false
AG_TEST_CLEANUP_SUCCEEDED=true
AG_TEST_CLEANUP_DETAILS=not-required
AG_TEST_NOTES=()
AG_TEST_EVIDENCE_FILES=()
AG_TEST_TRAFFIC_OBSERVATIONS=()
AG_TEST_CLEANUP_COMMANDS=()
AG_LOGGER_PID=
AG_OWNS_CAMPAIGN_METADATA=0

if [[ ! -d "$AG_RUN_DIR" ]]; then
    mkdir -p -- "$(dirname "$AG_RUN_DIR")"
    mkdir -m 0700 -- "$AG_RUN_DIR"
fi
[[ -d "$AG_RUN_DIR" && ! -L "$AG_RUN_DIR" ]] || {
    echo "FATAL: result run directory is not a regular directory: $AG_RUN_DIR" >&2
    return 2 2>/dev/null || exit 2
}
mkdir -p -- "$AG_EVIDENCE_DIR"
chmod 0700 "$AG_EVIDENCE_DIR"

ag_now() {
    date -u +%Y-%m-%dT%H:%M:%SZ
}

ag_ssh() {
    timeout 25 ssh -b "$AG_MANAGEMENT_SOURCE_ADDRESS" \
        -o BatchMode=yes -o ConnectTimeout=8 "$AG_BOARD" "$@"
}

ag_scp_to_cat2() {
    local source_path=$1
    local destination_path=$2
    timeout 25 scp -q -o BindAddress="$AG_MANAGEMENT_SOURCE_ADDRESS" \
        -o BatchMode=yes -o ConnectTimeout=8 \
        "$source_path" "$AG_BOARD:$destination_path"
}

ag_gate_state() {
    local status_document
    if ! status_document=$(ag_ssh "ag-cat2-gateway status" 2>/dev/null); then
        printf 'unknown\n'
        return 0
    fi
    python3 -c 'import json,sys; print(json.load(sys.stdin).get("state", "unknown"))' \
        <<<"$status_document" 2>/dev/null || printf 'unknown\n'
}

ag_management_available() {
    local ssh_connection
    ssh_connection=$(ag_ssh 'printf "%s\n" "$SSH_CONNECTION"' 2>/dev/null) || return 1
    awk -v expected_source="$AG_MANAGEMENT_SOURCE_ADDRESS" \
        -v expected_remote="$AG_MANAGEMENT_REMOTE_ADDRESS" \
        '{exit !($1 == expected_source && $3 == expected_remote)}' <<<"$ssh_connection"
}

ag_run_victim() {
    sudo -n ip netns exec "$AG_VICTIM_NETNS" "$@"
}

ag_add_evidence_file() {
    local evidence_path=$1
    if [[ "$evidence_path" == "$AG_ROOT/"* ]]; then
        evidence_path=${evidence_path#"$AG_ROOT/"}
    fi
    AG_TEST_EVIDENCE_FILES+=("$evidence_path")
}

ag_add_note() {
    AG_TEST_NOTES+=("$1")
}

ag_validate_gateway_status_file() {
    local status_path=$1
    python3 - "$AG_ROOT/schemas/gateway-status.schema.json" "$status_path" <<'PYEOF'
import json
import sys

import jsonschema

schema_path, status_path = sys.argv[1:3]
with open(schema_path, "r", encoding="utf-8") as schema_file:
    schema = json.load(schema_file)
with open(status_path, "r", encoding="utf-8") as status_file:
    status_document = json.load(status_file)
jsonschema.Draft7Validator(schema).validate(status_document)
PYEOF
}

ag_register_cleanup() {
    [[ "$#" -ge 1 ]] || return 2
    local cleanup_command= cleanup_argument
    printf -v cleanup_command '%q' "$1"
    shift
    for cleanup_argument in "$@"; do
        printf -v cleanup_command '%s %q' "$cleanup_command" "$cleanup_argument"
    done
    AG_TEST_CLEANUP_COMMANDS+=("$cleanup_command")
}

ag_assert() {
    local reason_code=$1
    local assertion_description=$2
    shift 2
    if ! "$@"; then
        AG_TEST_REASON_CODE=$reason_code
        AG_TEST_OBSERVED=$assertion_description
        echo "ASSERTION_FAILED reason=$reason_code detail=$assertion_description" >&2
        return 1
    fi
}

ag_initialize_single_test_campaign() {
    local campaign_path="$AG_RUN_DIR/campaign.json"
    [[ ! -e "$campaign_path" ]] || return 0
    python3 - "$campaign_path" "$AG_RUN_ID" "$AG_TEST_ID" "$AG_TEST_CATEGORY" \
        "$AG_TEST_STARTED_AT" "$AG_GATEWAY_COMMIT" "$AG_TRANSPORT" <<'PYEOF'
import json
import os
import sys
import tempfile

(campaign_path, run_id, test_id, category, started_at,
 gateway_commit, transport) = sys.argv[1:8]
campaign_directory = os.path.dirname(campaign_path)
file_descriptor, temporary_path = tempfile.mkstemp(prefix=".campaign.", dir=campaign_directory)
try:
    os.fchmod(file_descriptor, 0o600)
    document = {
        "resultKind": "campaign",
        "schemaVersion": 1,
        "runId": run_id,
        "startedAt": started_at,
        "finishedAt": None,
        "complete": False,
        "gatewayCommit": gateway_commit,
        "transport": transport,
        "expectedTests": [{"testId": test_id, "category": category}],
    }
    with os.fdopen(file_descriptor, "w", encoding="utf-8") as campaign_file:
        json.dump(document, campaign_file, indent=2, sort_keys=True)
        campaign_file.write("\n")
        campaign_file.flush()
        os.fsync(campaign_file.fileno())
    os.link(temporary_path, campaign_path)
    os.unlink(temporary_path)
    directory_descriptor = os.open(campaign_directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(directory_descriptor)
    finally:
        os.close(directory_descriptor)
except Exception:
    try:
        os.close(file_descriptor)
    except OSError:
        pass
    try:
        os.unlink(temporary_path)
    except OSError:
        pass
    raise
PYEOF
    AG_OWNS_CAMPAIGN_METADATA=1
}

ag_begin_test() {
    [[ "$#" == "3" ]] || {
        echo "ag_begin_test requires: testId category exactCommand" >&2
        return 2
    }
    AG_TEST_ID=$1
    AG_TEST_CATEGORY=$2
    AG_TEST_COMMAND=$3
    AG_TEST_TEXT_PATH="$AG_RUN_DIR/$AG_TEST_ID.txt"
    AG_TEST_JSON_PATH="$AG_RUN_DIR/$AG_TEST_ID.result.json"
    [[ ! -e "$AG_TEST_TEXT_PATH" && ! -e "$AG_TEST_JSON_PATH" ]] || {
        echo "FATAL: immutable result already exists for $AG_TEST_ID" >&2
        return 2
    }
    AG_TEST_STARTED_AT=$(ag_now)
    AG_TEST_STATE_BEFORE=$(ag_gate_state)
    AG_TEST_CAT2_HOSTNAME=$(ag_ssh "hostname" 2>/dev/null || printf 'unknown')
    AG_TEST_TEXT_TEMP_PATH=$(mktemp "$AG_RUN_DIR/.$AG_TEST_ID.txt.XXXXXXXX")
    AG_TEST_JSON_TEMP_PATH=$(mktemp "$AG_RUN_DIR/.$AG_TEST_ID.result.json.XXXXXXXX")
    chmod 0600 "$AG_TEST_TEXT_TEMP_PATH" "$AG_TEST_JSON_TEMP_PATH"
    ag_add_evidence_file "$AG_TEST_TEXT_PATH"
    ag_initialize_single_test_campaign

    exec 3>&1 4>&2
    exec > >(tee -a "$AG_TEST_TEXT_TEMP_PATH") 2>&1
    AG_LOGGER_PID=$!
    trap 'ag_handle_exit $?' EXIT
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM
    echo "TEST_START testId=$AG_TEST_ID runId=$AG_RUN_ID startedAt=$AG_TEST_STARTED_AT stateBefore=$AG_TEST_STATE_BEFORE"
    echo "TEST_COMMAND $AG_TEST_COMMAND"
}

ag_finish_test() {
    [[ "$#" == "5" ]] || {
        echo "ag_finish_test requires: status exitCode reasonCode expected observed" >&2
        return 2
    }
    AG_TEST_REQUESTED_STATUS=$1
    AG_TEST_REQUESTED_EXIT_CODE=$2
    AG_TEST_REASON_CODE=$3
    AG_TEST_EXPECTED=$4
    AG_TEST_OBSERVED=$5
    AG_TEST_RESULT_REQUESTED=1
    exit "$AG_TEST_REQUESTED_EXIT_CODE"
}

ag_run_registered_cleanups() {
    local cleanup_index cleanup_exit_code=0
    if (( ${#AG_TEST_CLEANUP_COMMANDS[@]} > 0 )); then
        AG_TEST_CLEANUP_ATTEMPTED=true
    fi
    for (( cleanup_index=${#AG_TEST_CLEANUP_COMMANDS[@]} - 1; cleanup_index >= 0; cleanup_index -= 1 )); do
        if ! eval "${AG_TEST_CLEANUP_COMMANDS[$cleanup_index]}"; then
            cleanup_exit_code=1
        fi
    done
    return "$cleanup_exit_code"
}

ag_safe_cleanup() {
    local cleanup_failed=0
    ag_run_registered_cleanups || cleanup_failed=1
    if [[ "$AG_CLEANUP_GATEWAY" == "1" ]]; then
        AG_TEST_CLEANUP_ATTEMPTED=true
        ag_ssh "ag-cat2-gateway isolate" >/dev/null 2>&1 || cleanup_failed=1
        [[ "$(ag_gate_state)" == "isolated" ]] || cleanup_failed=1
    fi
    if (( cleanup_failed == 0 )); then
        AG_TEST_CLEANUP_SUCCEEDED=true
        AG_TEST_CLEANUP_DETAILS=all-registered-cleanups-completed
        return 0
    fi
    AG_TEST_CLEANUP_SUCCEEDED=false
    AG_TEST_CLEANUP_DETAILS=one-or-more-cleanups-failed
    return 1
}

ag_write_result_temp() {
    local test_status=$1
    local test_exit_code=$2
    local evidence_joined notes_joined traffic_observations_joined passed_value=false
    [[ "$test_status" == "PASSED" ]] && passed_value=true
    evidence_joined=$(printf '%s\x1f' "${AG_TEST_EVIDENCE_FILES[@]}")
    notes_joined=$(printf '%s\x1f' "${AG_TEST_NOTES[@]}")
    traffic_observations_joined=$(printf '%s\x1f' "${AG_TEST_TRAFFIC_OBSERVATIONS[@]}")

    AG_RESULT_EVIDENCE=$evidence_joined AG_RESULT_NOTES=$notes_joined \
    AG_RESULT_TRAFFIC_OBSERVATIONS=$traffic_observations_joined \
    python3 - "$AG_TEST_JSON_TEMP_PATH" "$AG_RUN_ID" "$AG_TEST_ID" "$AG_TEST_CATEGORY" \
        "$AG_TEST_TRAFFIC_PROFILE" "$test_status" "$AG_TRANSPORT" "$AG_GATEWAY_COMMIT" "$AG_TEST_CAT2_HOSTNAME" \
        "$AG_PROTECTED_ENDPOINT" "$AG_SERVER_IF" "$AG_UPLINK_IF" "$AG_MANAGEMENT_IF" \
        "$AG_TEST_STATE_BEFORE" "$AG_TEST_STATE_AFTER" "$AG_TEST_STARTED_AT" \
        "$AG_TEST_FINISHED_AT" "$AG_TEST_COMMAND" "$test_exit_code" "$AG_TEST_EXPECTED" \
        "$AG_TEST_OBSERVED" "$passed_value" "$AG_TEST_UNAUTHORIZED_CONNECTIONS" \
        "$AG_TEST_ESCAPED_PACKETS" "$AG_TEST_ESCAPED_BYTES" "$AG_TEST_UPLINK_OBSERVED_PACKETS" \
        "$AG_TEST_PROBE_COMMAND_EXECUTED" "$AG_TEST_PROBE_REACHED_UPSTREAM" \
        "$AG_TEST_PACKET_OBSERVED_ON_UPLINK" "$AG_TEST_RELEASE_LATENCY_MS" \
        "$AG_TEST_ISOLATION_LATENCY_MS" "$AG_TEST_MANAGEMENT_AVAILABLE" "$AG_TEST_REASON_CODE" \
        "$AG_CAPTURE_IF" "$AG_TEST_CLEANUP_ATTEMPTED" "$AG_TEST_CLEANUP_SUCCEEDED" \
        "$AG_TEST_CLEANUP_DETAILS" <<'PYEOF'
import json
import os
import sys

(result_path, run_id, test_id, category, traffic_profile, status, transport, gateway_commit,
 cat2_hostname, protected_endpoint, server_interface, uplink_interface,
 management_interface, state_before, state_after, started_at, finished_at,
 exact_command, exit_code, expected, observed, passed, unauthorized_connections,
 escaped_packets, escaped_bytes, uplink_observed_packets, probe_command_executed,
 probe_reached_upstream, packet_observed_on_uplink, release_latency_ms,
 isolation_latency_ms, management_available, reason_code, capture_interface,
 cleanup_attempted, cleanup_succeeded, cleanup_details) = sys.argv[1:38]

def parse_optional_number(raw_value):
    if raw_value in ("", "null"):
        return None
    return float(raw_value)

def parse_optional_boolean(raw_value):
    if raw_value == "null":
        return None
    return raw_value == "true"

def split_values(environment_name):
    return [value for value in os.environ.get(environment_name, "").split("\x1f") if value]

document = {
    "resultKind": "test-result",
    "schemaVersion": 2,
    "runId": run_id,
    "testId": test_id,
    "category": category,
    "trafficProfile": traffic_profile,
    "status": status,
    "transport": transport,
    "gatewayCommit": gateway_commit,
    "cat2Hostname": cat2_hostname,
    "protectedEndpoint": protected_endpoint,
    "serverInterface": server_interface,
    "uplinkInterface": uplink_interface,
    "managementInterface": management_interface,
    "captureInterface": capture_interface,
    "stateBefore": state_before,
    "stateAfter": state_after,
    "startedAt": started_at,
    "finishedAt": finished_at,
    "command": exact_command,
    "exitCode": int(exit_code),
    "expected": expected,
    "observed": observed,
    "passed": passed == "true",
    "unauthorizedConnections": int(unauthorized_connections),
    "escapedPackets": int(escaped_packets),
    "escapedBytes": int(escaped_bytes),
    "uplinkObservedPackets": int(uplink_observed_packets),
    "probeCommandExecuted": probe_command_executed == "true",
    "probeReachedUpstream": parse_optional_boolean(probe_reached_upstream),
    "packetObservedOnUplink": parse_optional_boolean(packet_observed_on_uplink),
    "releaseLatencyMs": parse_optional_number(release_latency_ms),
    "isolationLatencyMs": parse_optional_number(isolation_latency_ms),
    "managementAvailable": management_available == "true",
    "cleanupAttempted": cleanup_attempted == "true",
    "cleanupSucceeded": cleanup_succeeded == "true",
    "cleanupDetails": cleanup_details,
    "reasonCode": reason_code,
    "evidenceFiles": split_values("AG_RESULT_EVIDENCE"),
    "trafficObservations": split_values("AG_RESULT_TRAFFIC_OBSERVATIONS"),
    "notes": split_values("AG_RESULT_NOTES"),
}
with open(result_path, "w", encoding="utf-8") as result_file:
    json.dump(document, result_file, indent=2, sort_keys=True)
    result_file.write("\n")
    result_file.flush()
    os.fsync(result_file.fileno())
PYEOF
}

ag_publish_result_pair() {
    python3 - "$AG_TEST_TEXT_TEMP_PATH" "$AG_TEST_TEXT_PATH" \
        "$AG_TEST_JSON_TEMP_PATH" "$AG_TEST_JSON_PATH" <<'PYEOF'
import os
import sys

text_temporary_path, text_final_path, json_temporary_path, json_final_path = sys.argv[1:5]
result_directory = os.path.dirname(text_final_path)
if os.path.exists(text_final_path) or os.path.exists(json_final_path):
    raise SystemExit("immutable result destination already exists")
with open(text_temporary_path, "rb") as text_file:
    os.fsync(text_file.fileno())
os.link(text_temporary_path, text_final_path)
directory_descriptor = os.open(result_directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
try:
    os.fsync(directory_descriptor)
    os.link(json_temporary_path, json_final_path)
    os.fsync(directory_descriptor)
finally:
    os.close(directory_descriptor)
os.unlink(text_temporary_path)
os.unlink(json_temporary_path)
PYEOF
    AG_TEST_RESULT_PUBLISHED=1
}

ag_complete_owned_campaign() {
    [[ "$AG_OWNS_CAMPAIGN_METADATA" == "1" ]] || return 0
    python3 - "$AG_RUN_DIR/campaign.json" "$AG_TEST_FINISHED_AT" <<'PYEOF'
import json
import os
import sys
import tempfile

campaign_path, finished_at = sys.argv[1:3]
with open(campaign_path, "r", encoding="utf-8") as campaign_file:
    document = json.load(campaign_file)
document["finishedAt"] = finished_at
document["complete"] = True
campaign_directory = os.path.dirname(campaign_path)
file_descriptor, temporary_path = tempfile.mkstemp(prefix=".campaign-complete.", dir=campaign_directory)
try:
    os.fchmod(file_descriptor, 0o600)
    with os.fdopen(file_descriptor, "w", encoding="utf-8") as temporary_file:
        json.dump(document, temporary_file, indent=2, sort_keys=True)
        temporary_file.write("\n")
        temporary_file.flush()
        os.fsync(temporary_file.fileno())
    os.replace(temporary_path, campaign_path)
    directory_descriptor = os.open(campaign_directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(directory_descriptor)
    finally:
        os.close(directory_descriptor)
except Exception:
    try:
        os.close(file_descriptor)
    except OSError:
        pass
    try:
        os.unlink(temporary_path)
    except OSError:
        pass
    raise
PYEOF
}

ag_handle_exit() {
    local original_exit_code=$1
    local final_status final_exit_code logger_exit_code=0
    trap - EXIT HUP INT TERM
    set +e

    if (( AG_TEST_RESULT_REQUESTED == 1 )); then
        final_status=$AG_TEST_REQUESTED_STATUS
        final_exit_code=$AG_TEST_REQUESTED_EXIT_CODE
    else
        final_status=FAILED
        final_exit_code=$original_exit_code
        (( final_exit_code != 0 )) || final_exit_code=1
        [[ "$AG_TEST_REASON_CODE" != "UNSET" ]] || AG_TEST_REASON_CODE=UNHANDLED_TEST_EXIT
        [[ -n "$AG_TEST_EXPECTED" ]] || AG_TEST_EXPECTED="test completes with an explicit result"
        [[ -n "$AG_TEST_OBSERVED" ]] || AG_TEST_OBSERVED="test exited before explicit result finalization"
    fi

    if ! ag_safe_cleanup; then
        final_status=FAILED
        (( final_exit_code != 0 )) || final_exit_code=1
        AG_TEST_REASON_CODE=CLEANUP_FAILED
        AG_TEST_OBSERVED="$AG_TEST_OBSERVED; cleanup failed"
    fi
    AG_TEST_STATE_AFTER=$(ag_gate_state)
    if ag_management_available; then
        AG_TEST_MANAGEMENT_AVAILABLE=true
    else
        AG_TEST_MANAGEMENT_AVAILABLE=false
    fi
    AG_TEST_FINISHED_AT=$(ag_now)

    exec 1>&3 2>&4
    wait "$AG_LOGGER_PID" || logger_exit_code=$?
    if (( logger_exit_code != 0 )); then
        final_status=FAILED
        (( final_exit_code != 0 )) || final_exit_code=1
        AG_TEST_REASON_CODE=LOGGER_FAILED
        AG_TEST_OBSERVED="$AG_TEST_OBSERVED; logger exited $logger_exit_code"
    fi
    printf 'TEST_END testId=%s runId=%s status=%s exitCode=%s stateAfter=%s reason=%s cleanupSucceeded=%s\n' \
        "$AG_TEST_ID" "$AG_RUN_ID" "$final_status" "$final_exit_code" "$AG_TEST_STATE_AFTER" \
        "$AG_TEST_REASON_CODE" "$AG_TEST_CLEANUP_SUCCEEDED" >> "$AG_TEST_TEXT_TEMP_PATH"

    if ! ag_write_result_temp "$final_status" "$final_exit_code" || ! ag_publish_result_pair; then
        rm -f "$AG_TEST_TEXT_TEMP_PATH" "$AG_TEST_JSON_TEMP_PATH"
        echo "FATAL: failed to publish immutable result pair for $AG_TEST_ID" >&2
        exit 1
    fi
    ag_complete_owned_campaign || {
        echo "FATAL: result was published but campaign completion metadata failed" >&2
        exit 1
    }
    echo "RESULT_PUBLISHED testId=$AG_TEST_ID status=$final_status path=$AG_TEST_JSON_PATH"
    exit "$final_exit_code"
}
