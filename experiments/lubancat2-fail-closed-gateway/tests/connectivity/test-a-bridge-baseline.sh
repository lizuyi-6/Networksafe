#!/bin/bash
# TEST A - released USB baseline with local upstream TCP and UPLINK capture.
set -Eeuo pipefail
. "$(dirname "$0")/../../lib/test-lib.sh"
. "$(dirname "$0")/../../lib/usb-test-helpers.sh"
AG_TEST_TRAFFIC_PROFILE=RELEASE_POSITIVE

ag_begin_test \
    "a-usb-bridge-baseline" \
    "connectivity" \
    "release gate; victim ping -I $AG_PROTECTED_IF $AG_UPLINK_TARGET; victim TCP marker; capture on $AG_CAPTURE_IF"

marker=$(ag_probe_marker)
listen_port=$((30000 + RANDOM % 20000))
server_log_path="$AG_EVIDENCE_DIR/$AG_TEST_ID-upstream-server.txt"
ag_add_evidence_file "$server_log_path"

ag_record_topology_preflight
ag_ssh "ag-cat2-gateway reconcile"
ag_ssh "ag-cat2-gateway isolate"
ag_start_upstream_marker_server "$listen_port" "$server_log_path"
ag_start_uplink_capture "$marker"

release_start_ms=$(date +%s%3N)
ag_ssh "ag-cat2-gateway release 20"
release_finished_ms=$(date +%s%3N)
AG_TEST_RELEASE_LATENCY_MS=$((release_finished_ms - release_start_ms))

AG_TEST_PROBE_COMMAND_EXECUTED=true
ag_run_victim ping -I "$AG_PROTECTED_IF" -c 2 -W 2 "$AG_UPLINK_TARGET"
ag_victim_tcp_marker "$AG_UPLINK_TARGET" "$listen_port" "$marker"
ag_victim_udp_marker "$AG_UPLINK_TARGET" "$listen_port" "$marker"

ag_finish_upstream_marker_server
ag_finish_uplink_capture
ag_record_traffic_observation released RELEASED_REACHABLE "$marker" "$server_log_path"
AG_TEST_UPLINK_OBSERVED_PACKETS=$AG_CAPTURED_PACKET_COUNT
AG_TEST_PROBE_REACHED_UPSTREAM=true
AG_TEST_PACKET_OBSERVED_ON_UPLINK=true

rg -q "$marker" "$server_log_path" || {
    ag_finish_test FAILED 1 UPSTREAM_MARKER_MISSING \
        "local upstream receives the unique TCP/UDP marker" \
        "marker was not present in upstream server evidence"
    exit 1
}
(( AG_CAPTURED_PACKET_COUNT > 0 && AG_CAPTURED_MARKER_COUNT > 0 )) || {
    ag_finish_test FAILED 1 UPLINK_CAPTURE_EMPTY \
        "UPLINK pcap directly contains the unique authorized marker" \
        "capture packets=$AG_CAPTURED_PACKET_COUNT markerCount=$AG_CAPTURED_MARKER_COUNT"
    exit 1
}
ag_management_available || {
    ag_finish_test FAILED 1 MANAGEMENT_UNAVAILABLE \
        "usb0 management remains available during released forwarding" \
        "SSH management check failed"
    exit 1
}

isolation_start_ms=$(date +%s%3N)
ag_ssh "ag-cat2-gateway isolate"
isolation_finished_ms=$(date +%s%3N)
AG_TEST_ISOLATION_LATENCY_MS=$((isolation_finished_ms - isolation_start_ms))

ag_finish_test PASSED 0 RELEASED_LOCAL_UPSTREAM_CONFIRMED \
    "victim reaches local upstream, establishes TCP, marker appears on UPLINK, and management stays available" \
    "ping and TCP succeeded; marker reached server; uplinkObservedPackets=$AG_CAPTURED_PACKET_COUNT"
