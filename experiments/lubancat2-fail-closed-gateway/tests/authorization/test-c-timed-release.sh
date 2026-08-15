#!/bin/bash
# TEST C - authorized traffic appears during a bounded lease and disappears after expiry.
set -Eeuo pipefail
. "$(dirname "$0")/../../lib/test-lib.sh"
. "$(dirname "$0")/../../lib/usb-test-helpers.sh"
AG_TEST_TRAFFIC_PROFILE=RELEASE_THEN_ISOLATED

DURATION=${1:-6}
[[ "$DURATION" =~ ^[1-9][0-9]*$ ]] || { echo "duration must be a positive integer" >&2; exit 2; }
AG_CAPTURE_SECONDS=4

ag_begin_test \
    "c-timed-release-expiry" \
    "authorization" \
    "release $DURATION; probe from $AG_VICTIM_NETNS/$AG_PROTECTED_IF with UPLINK capture; wait for PID1 expiry; repeat identical probe and capture"

listen_port=$((30000 + RANDOM % 20000))
during_marker=$(ag_probe_marker)-DURING
during_server_log="$AG_EVIDENCE_DIR/$AG_TEST_ID-during-server.txt"
ag_add_evidence_file "$during_server_log"

ag_record_topology_preflight
ag_ssh "ag-cat2-gateway isolate"
ag_start_upstream_marker_server "$listen_port" "$during_server_log"
ag_start_uplink_capture "$during_marker" during
release_start_ms=$(ag_now_ms)
ag_ssh "ag-cat2-gateway release $DURATION"
release_finished_ms=$(ag_now_ms)
AG_TEST_RELEASE_LATENCY_MS=$((release_finished_ms - release_start_ms))

AG_TEST_PROBE_COMMAND_EXECUTED=true
ag_run_victim ping -I "$AG_PROTECTED_IF" -c 1 -W 2 "$AG_UPLINK_TARGET"
ag_victim_tcp_marker "$AG_UPLINK_TARGET" "$listen_port" "$during_marker"
ag_finish_upstream_marker_server
ag_finish_uplink_capture
ag_record_traffic_observation during-release RELEASED_REACHABLE \
    "$during_marker" "$during_server_log"
during_packet_count=$AG_CAPTURED_PACKET_COUNT
rg -q "$during_marker" "$during_server_log" || {
    ag_finish_test FAILED 1 RELEASED_MARKER_MISSING \
        "during lease the local upstream receives the TCP marker" \
        "during-lease server marker missing"
    exit 1
}
(( during_packet_count > 0 && AG_CAPTURED_MARKER_COUNT > 0 )) || {
    ag_finish_test FAILED 1 RELEASED_CAPTURE_EMPTY \
        "during lease UPLINK pcap directly contains the unique marker" \
        "duringPackets=$during_packet_count markerCount=$AG_CAPTURED_MARKER_COUNT"
    exit 1
}

expiry_deadline=$(( $(date +%s) + DURATION + 10 ))
while [[ "$(ag_gate_state)" != "isolated" ]]; do
    if (( $(date +%s) >= expiry_deadline )); then
        ag_finish_test FAILED 1 LEASE_DID_NOT_EXPIRE \
            "PID1 lease transitions to isolated by the deadline" \
            "gate remained non-isolated past duration plus tolerance"
        exit 1
    fi
    sleep 1
done
isolation_observed_ms=$(ag_now_ms)
AG_TEST_ISOLATION_LATENCY_MS=$((isolation_observed_ms - release_finished_ms))

after_marker=$(ag_probe_marker)-AFTER
after_server_log="$AG_EVIDENCE_DIR/$AG_TEST_ID-after-server.txt"
ag_add_evidence_file "$after_server_log"
ag_start_upstream_marker_server "$listen_port" "$after_server_log"
ag_start_uplink_capture "$after_marker" after-expiry

after_unauthorized_connections=0
if ag_run_victim ping -I "$AG_PROTECTED_IF" -c 1 -W 1 "$AG_UPLINK_TARGET"; then
    after_unauthorized_connections=$((after_unauthorized_connections + 1))
fi
if ag_victim_tcp_marker "$AG_UPLINK_TARGET" "$listen_port" "$after_marker"; then
    after_unauthorized_connections=$((after_unauthorized_connections + 1))
fi
ag_victim_udp_marker "$AG_UPLINK_TARGET" "$listen_port" "$after_marker"
ag_finish_upstream_marker_server
ag_finish_uplink_capture
ag_record_traffic_observation after-expiry ISOLATED_BLOCKED \
    "$after_marker" "$after_server_log"
after_packet_count=$AG_CAPTURED_PACKET_COUNT
after_byte_count=$AG_CAPTURED_BYTE_COUNT
after_marker_count=$AG_CAPTURED_MARKER_COUNT

if [[ -s "$after_server_log" ]] && rg -q "$after_marker" "$after_server_log"; then
    after_unauthorized_connections=$((after_unauthorized_connections + 1))
fi
AG_TEST_UNAUTHORIZED_CONNECTIONS=$after_unauthorized_connections
AG_TEST_ESCAPED_PACKETS=$after_packet_count
AG_TEST_ESCAPED_BYTES=$after_byte_count
AG_TEST_UPLINK_OBSERVED_PACKETS=$during_packet_count
AG_TEST_PROBE_REACHED_UPSTREAM=false
AG_TEST_PACKET_OBSERVED_ON_UPLINK=false

if (( after_unauthorized_connections != 0 || after_packet_count != 0 || after_byte_count != 0 || after_marker_count != 0 )); then
    ag_finish_test FAILED 1 POST_EXPIRY_ESCAPE_OBSERVED \
        "after expiry the identical probe fails and UPLINK emits zero victim packets" \
        "unauthorizedConnections=$after_unauthorized_connections escapedPackets=$after_packet_count escapedBytes=$after_byte_count"
    exit 1
fi
ag_management_available || {
    ag_finish_test FAILED 1 MANAGEMENT_UNAVAILABLE \
        "management remains available after automatic expiry" \
        "Cat2 SSH management failed"
    exit 1
}

ag_finish_test PASSED 0 TIMED_RELEASE_AND_POST_EXPIRY_CAPTURE_CONFIRMED \
    "authorized local TCP and UPLINK marker during lease; identical probe blocked with zero UPLINK packets after expiry" \
    "duringPackets=$during_packet_count afterPackets=0 state=isolated managementAvailable=true"
