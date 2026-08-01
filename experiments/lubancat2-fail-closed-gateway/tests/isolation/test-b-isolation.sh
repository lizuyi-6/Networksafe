#!/bin/bash
# TEST B - isolated multi-protocol probes with Cat2 UPLINK capture.
set -Eeuo pipefail
. "$(dirname "$0")/../../lib/test-lib.sh"
. "$(dirname "$0")/../../lib/usb-test-helpers.sh"
AG_TEST_TRAFFIC_PROFILE=ISOLATED_NEGATIVE_WITH_CONTROL

ag_begin_test \
    "b-isolated-multiprotocol" \
    "isolation" \
    "isolate; capture $AG_CAPTURE_IF; run ARP/IPv4/IPv6/TCP/UDP/DNS/broadcast/multicast/raw probes from netns $AG_VICTIM_NETNS interface $AG_PROTECTED_IF"

for required_command in arping ping dig python3 tcpdump; do
    if ! command -v "$required_command" >/dev/null 2>&1; then
        ag_finish_test BLOCKED 5 MISSING_PROBE_DEPENDENCY \
            "all probe and capture tools are installed" \
            "missing command: $required_command"
        exit 5
    fi
done

control_marker=$(ag_probe_marker)-CONTROL
marker=$(ag_probe_marker)-ISOLATED
listen_port=$((30000 + RANDOM % 20000))
control_server_log_path="$AG_EVIDENCE_DIR/$AG_TEST_ID-positive-control-server.txt"
server_log_path="$AG_EVIDENCE_DIR/$AG_TEST_ID-isolated-server.txt"
ag_add_evidence_file "$control_server_log_path"
ag_add_evidence_file "$server_log_path"
unauthorized_connections=0

ag_record_topology_preflight
ag_ssh "ag-cat2-gateway isolate"
ag_start_upstream_marker_server "$listen_port" "$control_server_log_path"
ag_start_uplink_capture "$control_marker" positive-control
ag_ssh "ag-cat2-gateway release 20"
ag_victim_tcp_marker "$AG_UPLINK_TARGET" "$listen_port" "$control_marker"
ag_finish_upstream_marker_server
ag_finish_uplink_capture
ag_record_traffic_observation positive-control RELEASED_REACHABLE \
    "$control_marker" "$control_server_log_path"
rg -F -q "$control_marker" "$control_server_log_path" || {
    ag_finish_test FAILED 1 OBSERVER_POSITIVE_CONTROL_SERVER_MISSING \
        "the released positive control reaches the same upstream observer" \
        "positive-control marker missing from server log"
}
(( AG_CAPTURED_MARKER_COUNT > 0 )) || {
    ag_finish_test FAILED 1 OBSERVER_POSITIVE_CONTROL_PCAP_MISSING \
        "the released positive control marker appears in the same UPLINK capture path" \
        "positive-control pcap markerCount=$AG_CAPTURED_MARKER_COUNT"
}

isolation_start_ms=$(date +%s%3N)
ag_ssh "ag-cat2-gateway isolate"
isolation_finished_ms=$(date +%s%3N)
AG_TEST_ISOLATION_LATENCY_MS=$((isolation_finished_ms - isolation_start_ms))
[[ "$(ag_gate_state)" == "isolated" ]]

ag_start_upstream_marker_server "$listen_port" "$server_log_path"
ag_start_uplink_capture "$marker"

if ag_run_victim arping -I "$AG_PROTECTED_IF" -c 2 -w 3 -f "$AG_UPLINK_TARGET"; then
    unauthorized_connections=$((unauthorized_connections + 1))
fi
if ag_run_victim ping -I "$AG_PROTECTED_IF" -c 2 -W 1 "$AG_UPLINK_TARGET"; then
    unauthorized_connections=$((unauthorized_connections + 1))
fi
if ag_victim_tcp_marker "$AG_UPLINK_TARGET" "$listen_port" "$marker"; then
    unauthorized_connections=$((unauthorized_connections + 1))
fi

# UDP send success means only that the probe command executed. Upstream receipt
# and the UPLINK capture decide whether it traversed the isolated gateway.
ag_victim_udp_marker "$AG_UPLINK_TARGET" "$listen_port" "$marker"
ag_run_victim dig -b 10.99.0.2 +time=1 +tries=1 -p "$listen_port" \
    @"$AG_UPLINK_TARGET" marker.invalid A >/dev/null 2>&1 || true
if ag_run_victim ping -6 -I "$AG_PROTECTED_IF" -c 2 -W 1 fd42:ae7e:6a7d::1; then
    unauthorized_connections=$((unauthorized_connections + 1))
fi
ag_victim_udp_marker 10.99.0.255 "$listen_port" "$marker"
ag_victim_udp_marker 239.255.42.99 "$listen_port" "$marker"
ag_victim_raw_marker "$marker"
AG_TEST_PROBE_COMMAND_EXECUTED=true

ag_finish_upstream_marker_server
ag_finish_uplink_capture
ag_record_traffic_observation isolated ISOLATED_BLOCKED "$marker" "$server_log_path"

upstream_marker_count=0
if [[ -s "$server_log_path" ]]; then
    upstream_marker_count=$(rg -c "$marker" "$server_log_path" || true)
fi
if (( upstream_marker_count > 0 )); then
    unauthorized_connections=$((unauthorized_connections + upstream_marker_count))
    AG_TEST_PROBE_REACHED_UPSTREAM=true
else
    AG_TEST_PROBE_REACHED_UPSTREAM=false
fi
if (( AG_CAPTURED_PACKET_COUNT > 0 || AG_CAPTURED_MARKER_COUNT > 0 )); then
    AG_TEST_PACKET_OBSERVED_ON_UPLINK=true
else
    AG_TEST_PACKET_OBSERVED_ON_UPLINK=false
fi

AG_TEST_UNAUTHORIZED_CONNECTIONS=$unauthorized_connections
AG_TEST_ESCAPED_PACKETS=$AG_CAPTURED_PACKET_COUNT
AG_TEST_ESCAPED_BYTES=$AG_CAPTURED_BYTE_COUNT
AG_TEST_UPLINK_OBSERVED_PACKETS=$AG_CAPTURED_PACKET_COUNT

if ! ag_management_available; then
    ag_finish_test FAILED 1 MANAGEMENT_UNAVAILABLE \
        "management remains available while the data gate is isolated" \
        "Cat2 SSH management failed after probes"
    exit 1
fi
if (( unauthorized_connections != 0 || AG_CAPTURED_PACKET_COUNT != 0 || AG_CAPTURED_BYTE_COUNT != 0 || AG_CAPTURED_MARKER_COUNT != 0 )); then
    ag_finish_test FAILED 1 ISOLATION_ESCAPE_OBSERVED \
        "all application probes fail and UPLINK emits zero victim frames" \
        "unauthorizedConnections=$unauthorized_connections escapedPackets=$AG_CAPTURED_PACKET_COUNT escapedBytes=$AG_CAPTURED_BYTE_COUNT"
    exit 1
fi

ag_finish_test PASSED 0 ISOLATION_NO_UPLINK_ESCAPE \
    "all application probes fail; UPLINK marker count is zero; management remains available" \
    "unauthorizedConnections=0 escapedPackets=0 escapedBytes=0 managementAvailable=true"
