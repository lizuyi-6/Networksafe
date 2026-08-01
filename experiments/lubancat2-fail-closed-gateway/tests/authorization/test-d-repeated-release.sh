#!/bin/bash
# TEST D - deterministic hardware regression for repeated-release timer failure.
set -Eeuo pipefail
. "$(dirname "$0")/../../lib/test-lib.sh"
. "$(dirname "$0")/../../lib/usb-test-helpers.sh"
AG_TEST_TRAFFIC_PROFILE=ISOLATED_NEGATIVE_WITH_CONTROL

AG_TEST_CONFIG_REMOTE=${AG_TEST_CONFIG_REMOTE:-/root/aetherguard-cat2-test.conf}
AG_CAPTURE_SECONDS=4

ag_begin_test \
    "repeated_release_timer_registration_failure_must_close_gate" \
    "fault" \
    "release; repeated release; inject timer_register_failure with explicit Cat2 test config; reconcile; probe $AG_VICTIM_NETNS/$AG_PROTECTED_IF while capturing $AG_CAPTURE_IF"

ag_record_topology_preflight
ag_ssh "test -r '$AG_TEST_CONFIG_REMOTE'"
ag_ssh "awk -F= '\$1 == \"AG_ALLOW_TEST_FAILPOINTS\" && \$2 == \"1\" {found=1} END {exit !found}' '$AG_TEST_CONFIG_REMOTE'"
ag_ssh "ag-cat2-gateway isolate"
ag_ssh "ag-cat2-gateway release 30"
first_status=$(ag_ssh "ag-cat2-gateway status")
first_lease_id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["activeLeaseId"])' <<<"$first_status")
ag_ssh "ag-cat2-gateway release 30"
second_status=$(ag_ssh "ag-cat2-gateway status")
second_lease_id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["activeLeaseId"])' <<<"$second_status")
[[ "$first_lease_id" != "$second_lease_id" ]] || {
    ag_finish_test FAILED 1 REPEATED_RELEASE_DID_NOT_REPLACE_LEASE \
        "normal repeated release creates a new leaseId" \
        "first and second leaseId were identical"
    exit 1
}

listen_port=$((30000 + RANDOM % 20000))
control_marker=$(ag_probe_marker)-CONTROL
control_server_log="$AG_EVIDENCE_DIR/$AG_TEST_ID-positive-control-server.txt"
ag_add_evidence_file "$control_server_log"
ag_start_upstream_marker_server "$listen_port" "$control_server_log"
ag_start_uplink_capture "$control_marker" positive-control
ag_victim_tcp_marker "$AG_UPLINK_TARGET" "$listen_port" "$control_marker"
ag_finish_upstream_marker_server
ag_finish_uplink_capture
ag_record_traffic_observation positive-control RELEASED_REACHABLE \
    "$control_marker" "$control_server_log"
rg -F -q "$control_marker" "$control_server_log" || {
    ag_finish_test FAILED 1 OBSERVER_POSITIVE_CONTROL_SERVER_MISSING \
        "normal repeated release forwards the control marker to the upstream observer" \
        "control marker missing from server log"
}
(( AG_CAPTURED_MARKER_COUNT > 0 )) || {
    ag_finish_test FAILED 1 OBSERVER_POSITIVE_CONTROL_PCAP_MISSING \
        "normal repeated release emits the control marker on the Cat2 UPLINK" \
        "control pcap markerCount=$AG_CAPTURED_MARKER_COUNT"
}

test_mode_prefix="AG_TEST_MODE=1 AG_GATEWAY_CONFIG=$AG_TEST_CONFIG_REMOTE AG_STATE_DIR=/run/aetherguard-cat2 AG_SYS_CLASS_NET=/sys/class/net AG_TEST_COMMAND_PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin AG_GATEWAY_EXECUTABLE=/usr/local/sbin/ag-cat2-gateway"
set +e
ag_ssh "$test_mode_prefix AG_TEST_FAILPOINT=timer_register_failure ag-cat2-gateway release 30"
injected_release_exit_code=$?
set -e
[[ "$injected_release_exit_code" -ne 0 ]] || {
    ag_finish_test FAILED 1 INJECTED_FAILURE_RETURNED_ZERO \
        "timer registration failure returns nonzero" \
        "fault-injected repeated release returned zero"
    exit 1
}

ag_ssh "ag-cat2-gateway reconcile"
post_failure_status_path="$AG_EVIDENCE_DIR/$AG_TEST_ID-status.json"
ag_ssh "ag-cat2-gateway status" > "$post_failure_status_path"
ag_validate_gateway_status_file "$post_failure_status_path"
ag_add_evidence_file "$post_failure_status_path"
post_failure_state=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["state"])' < "$post_failure_status_path")
post_failure_timer_count=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["activeLeaseTimerCount"])' < "$post_failure_status_path")
post_failure_lease_id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["activeLeaseId"])' < "$post_failure_status_path")

[[ "$post_failure_state" == "isolated" && "$post_failure_timer_count" == "0" && "$post_failure_lease_id" == "None" ]] || {
    ag_finish_test FAILED 1 OPEN_OR_LEASE_REMAINS_AFTER_TIMER_FAILURE \
        "failed repeated release leaves isolated, no active timer, and no active leaseId" \
        "state=$post_failure_state timerCount=$post_failure_timer_count leaseId=$post_failure_lease_id"
    exit 1
}

marker=$(ag_probe_marker)
negative_server_log="$AG_EVIDENCE_DIR/$AG_TEST_ID-post-failure-server.txt"
ag_add_evidence_file "$negative_server_log"
ag_start_upstream_marker_server "$listen_port" "$negative_server_log"
ag_start_uplink_capture "$marker" post-failure
AG_TEST_PROBE_COMMAND_EXECUTED=true
if ag_run_victim ping -I "$AG_PROTECTED_IF" -c 1 -W 1 "$AG_UPLINK_TARGET"; then
    AG_TEST_UNAUTHORIZED_CONNECTIONS=1
fi
ag_victim_udp_marker "$AG_UPLINK_TARGET" "$listen_port" "$marker"
ag_victim_raw_marker "$marker"
ag_finish_upstream_marker_server
ag_finish_uplink_capture
ag_record_traffic_observation post-failure ISOLATED_BLOCKED \
    "$marker" "$negative_server_log"
AG_TEST_ESCAPED_PACKETS=$AG_CAPTURED_PACKET_COUNT
AG_TEST_ESCAPED_BYTES=$AG_CAPTURED_BYTE_COUNT
AG_TEST_UPLINK_OBSERVED_PACKETS=$AG_CAPTURED_PACKET_COUNT
AG_TEST_PROBE_REACHED_UPSTREAM=false
AG_TEST_PACKET_OBSERVED_ON_UPLINK=false
if [[ -s "$negative_server_log" ]] && rg -F -q "$marker" "$negative_server_log"; then
    AG_TEST_PROBE_REACHED_UPSTREAM=true
    AG_TEST_UNAUTHORIZED_CONNECTIONS=$((AG_TEST_UNAUTHORIZED_CONNECTIONS + 1))
fi

ag_ssh "ag-cat2-gateway verify"
ag_management_available || {
    ag_finish_test FAILED 1 MANAGEMENT_UNAVAILABLE \
        "management remains available after deterministic transition failure" \
        "Cat2 SSH management failed"
    exit 1
}
if (( AG_TEST_UNAUTHORIZED_CONNECTIONS != 0 || AG_CAPTURED_PACKET_COUNT != 0 || AG_CAPTURED_MARKER_COUNT != 0 )); then
    ag_finish_test FAILED 1 POST_FAILURE_UPLINK_ESCAPE \
        "failed replacement remains isolated with zero UPLINK packets" \
        "unauthorizedConnections=$AG_TEST_UNAUTHORIZED_CONNECTIONS escapedPackets=$AG_CAPTURED_PACKET_COUNT"
    exit 1
fi

ag_finish_test PASSED 0 REPEATED_RELEASE_TIMER_FAILURE_FAILS_CLOSED \
    "normal replacement changes leaseId; injected timer failure closes gate; reconcile sees isolated; timer count zero; UPLINK capture zero" \
    "firstLease=$first_lease_id secondLease=$second_lease_id failureRc=$injected_release_exit_code state=isolated timers=0 escapedPackets=0"
