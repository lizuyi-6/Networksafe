#!/bin/bash
# Observer-controlled capture and marker helpers for USB victim tests.
set -Eeuo pipefail

AG_EXPECTED_VICTIM_MAC=${AG_EXPECTED_VICTIM_MAC:-02:11:11:11:11:01}
AG_VICTIM_MAC=
AG_CAPTURE_SECONDS=${AG_CAPTURE_SECONDS:-8}
AG_CAPTURE_SSH_PID=
AG_REMOTE_CAPTURE_PATH=
AG_REMOTE_CAPTURE_PID_PATH=
AG_REMOTE_CAPTURE_STATUS_PATH=
AG_REMOTE_CAPTURE_READY_PATH=
AG_REMOTE_CAPTURE_ERROR_PATH=
AG_LOCAL_CAPTURE_PATH=
AG_LOCAL_CAPTURE_TEXT_PATH=
AG_CAPTURED_PACKET_COUNT=0
AG_CAPTURED_BYTE_COUNT=0
AG_CAPTURED_MARKER_COUNT=0
AG_ACTIVE_CAPTURE_MARKER=
AG_CAPTURE_EXIT_CODE=null
AG_CAPTURE_READY=false
AG_UPSTREAM_SERVER_PID=
AG_UPSTREAM_SERVER_READY_PATH=
AG_UPSTREAM_SERVER_EXIT_CODE=null
AG_UPSTREAM_SERVER_READY=false

ag_probe_marker() {
    printf 'AGPROBE-%s-%s-%s\n' "$AG_RUN_ID" "$AG_TEST_ID" "$(date +%s%N)"
}

ag_verify_victim_and_capture_scope() {
    local non_loopback_interfaces actual_victim_mac default_route_count default_route_device
    [[ "$AG_EXPECTED_VICTIM_MAC" == "02:11:11:11:11:01" ]] || {
        echo "FATAL: experiment requires the fixed protected-endpoint MAC" >&2
        return 1
    }
    [[ "$AG_VICTIM_NETNS" == "victim" ]] || {
        echo "FATAL: victim namespace must be exactly victim" >&2
        return 1
    }
    [[ "$AG_PROTECTED_IF" == "agvictim0" ]] || {
        echo "FATAL: protected interface must be exactly agvictim0" >&2
        return 1
    }
    [[ "$AG_CAPTURE_IF" == "$AG_UPLINK_IF" ]] || {
        echo "FATAL: capture interface must equal the Cat2 UPLINK_IF" >&2
        return 1
    }
    sudo -n ip netns exec "$AG_VICTIM_NETNS" ip link show dev "$AG_PROTECTED_IF" >/dev/null
    non_loopback_interfaces=$(sudo -n ip netns exec "$AG_VICTIM_NETNS" ip -o link show \
        | awk -F': ' '$2 != "lo" {print $2}')
    [[ "$non_loopback_interfaces" == "$AG_PROTECTED_IF" ]] || {
        echo "FATAL: victim namespace is not single-path: $non_loopback_interfaces" >&2
        return 1
    }
    actual_victim_mac=$(sudo -n ip netns exec "$AG_VICTIM_NETNS" \
        cat "/sys/class/net/$AG_PROTECTED_IF/address" | tr 'A-F' 'a-f')
    [[ "$actual_victim_mac" == "${AG_EXPECTED_VICTIM_MAC,,}" ]] || {
        echo "FATAL: victim MAC mismatch expected=$AG_EXPECTED_VICTIM_MAC observed=$actual_victim_mac" >&2
        return 1
    }
    AG_VICTIM_MAC=$actual_victim_mac
    default_route_count=$(sudo -n ip netns exec "$AG_VICTIM_NETNS" ip -o route show default \
        | awk 'END {print NR + 0}')
    default_route_device=$(sudo -n ip netns exec "$AG_VICTIM_NETNS" ip -o route show default \
        | awk '{for (field_index=1; field_index<=NF; field_index+=1) if ($field_index == "dev") print $(field_index+1)}')
    [[ "$default_route_count" == "1" && "$default_route_device" == "$AG_PROTECTED_IF" ]] || {
        echo "FATAL: victim default route is not uniquely bound to $AG_PROTECTED_IF" >&2
        return 1
    }
}

ag_record_topology_preflight() {
    local topology_path="$AG_EVIDENCE_DIR/$AG_TEST_ID-topology.json"
    ag_verify_victim_and_capture_scope
    AG_VICTIM_NETNS="$AG_VICTIM_NETNS" AG_PROTECTED_IF="$AG_PROTECTED_IF" \
        AG_SERVER_IF="$AG_SERVER_IF" AG_UPLINK_IF="$AG_UPLINK_IF" \
        AG_MANAGEMENT_IF="$AG_MANAGEMENT_IF" AG_BOARD="$AG_BOARD" \
        "$AG_ROOT/transport/usb-rndis/verify-topology.sh" > "$topology_path"
    ag_add_evidence_file "$topology_path"
}

ag_cleanup_active_uplink_capture() {
    if [[ -n "$AG_CAPTURE_SSH_PID" ]] && kill -0 "$AG_CAPTURE_SSH_PID" 2>/dev/null; then
        kill "$AG_CAPTURE_SSH_PID" 2>/dev/null || true
        wait "$AG_CAPTURE_SSH_PID" 2>/dev/null || true
    fi
    if [[ -n "$AG_REMOTE_CAPTURE_PID_PATH" ]]; then
        ag_ssh "if test -r '$AG_REMOTE_CAPTURE_PID_PATH'; then kill \$(cat '$AG_REMOTE_CAPTURE_PID_PATH') 2>/dev/null || true; fi; rm -f '$AG_REMOTE_CAPTURE_PID_PATH' '$AG_REMOTE_CAPTURE_READY_PATH' '$AG_REMOTE_CAPTURE_STATUS_PATH' '$AG_REMOTE_CAPTURE_ERROR_PATH' '$AG_REMOTE_CAPTURE_PATH'" \
            >/dev/null 2>&1 || true
    fi
    AG_CAPTURE_SSH_PID=
    AG_REMOTE_CAPTURE_PATH=
    AG_REMOTE_CAPTURE_PID_PATH=
    AG_REMOTE_CAPTURE_STATUS_PATH=
    AG_REMOTE_CAPTURE_READY_PATH=
    AG_REMOTE_CAPTURE_ERROR_PATH=
}

ag_start_uplink_capture() {
    local marker=$1
    local capture_label=${2:-uplink}
    local readiness_attempt
    [[ -n "$AG_VICTIM_MAC" ]] || ag_verify_victim_and_capture_scope
    [[ "$AG_CAPTURE_IF" == "$AG_UPLINK_IF" ]] || return 1

    AG_ACTIVE_CAPTURE_MARKER=$marker
    AG_REMOTE_CAPTURE_PATH="/tmp/${marker}.pcap"
    AG_REMOTE_CAPTURE_PID_PATH="/tmp/${marker}.tcpdump.pid"
    AG_REMOTE_CAPTURE_STATUS_PATH="/tmp/${marker}.tcpdump.status"
    AG_REMOTE_CAPTURE_READY_PATH="/tmp/${marker}.tcpdump.ready"
    AG_REMOTE_CAPTURE_ERROR_PATH="/tmp/${marker}.tcpdump.stderr"
    AG_LOCAL_CAPTURE_PATH="$AG_EVIDENCE_DIR/${AG_TEST_ID}-${capture_label}.pcap"
    AG_LOCAL_CAPTURE_TEXT_PATH="$AG_EVIDENCE_DIR/${AG_TEST_ID}-${capture_label}.pcap.txt"
    AG_CAPTURED_PACKET_COUNT=0
    AG_CAPTURED_BYTE_COUNT=0
    AG_CAPTURED_MARKER_COUNT=0
    AG_CAPTURE_EXIT_CODE=null
    AG_CAPTURE_READY=false

    ag_ssh "rm -f '$AG_REMOTE_CAPTURE_PATH' '$AG_REMOTE_CAPTURE_PID_PATH' '$AG_REMOTE_CAPTURE_STATUS_PATH' '$AG_REMOTE_CAPTURE_READY_PATH' '$AG_REMOTE_CAPTURE_ERROR_PATH'; timeout '$AG_CAPTURE_SECONDS' tcpdump -U -nn -i '$AG_CAPTURE_IF' -w '$AG_REMOTE_CAPTURE_PATH' 'ether src $AG_VICTIM_MAC' 2>'$AG_REMOTE_CAPTURE_ERROR_PATH' & capture_pid=\$!; printf '%s\\n' \"\$capture_pid\" > '$AG_REMOTE_CAPTURE_PID_PATH'; for readiness_attempt in \$(seq 1 50); do if test -s '$AG_REMOTE_CAPTURE_PATH' && kill -0 \"\$capture_pid\" 2>/dev/null; then printf 'ready\\n' > '$AG_REMOTE_CAPTURE_READY_PATH'; break; fi; sleep 0.1; done; if ! test -r '$AG_REMOTE_CAPTURE_READY_PATH'; then kill \"\$capture_pid\" 2>/dev/null || true; wait \"\$capture_pid\" 2>/dev/null || true; printf '125\\n' > '$AG_REMOTE_CAPTURE_STATUS_PATH'; exit 1; fi; wait \"\$capture_pid\"; capture_rc=\$?; printf '%s\\n' \"\$capture_rc\" > '$AG_REMOTE_CAPTURE_STATUS_PATH'; exit 0" \
        >/dev/null 2>&1 &
    AG_CAPTURE_SSH_PID=$!
    ag_register_cleanup ag_cleanup_active_uplink_capture

    for readiness_attempt in $(seq 1 50); do
        if ag_ssh "test -r '$AG_REMOTE_CAPTURE_READY_PATH'" >/dev/null 2>&1; then
            AG_CAPTURE_READY=true
            return 0
        fi
        kill -0 "$AG_CAPTURE_SSH_PID" 2>/dev/null || break
        sleep 0.1
    done
    echo "FATAL: UPLINK tcpdump did not become ready" >&2
    ag_ssh "cat '$AG_REMOTE_CAPTURE_ERROR_PATH'" >&2 || true
    return 1
}

ag_finish_uplink_capture() {
    local capture_ssh_exit_code=0 capture_wait_exit_code
    [[ -n "$AG_CAPTURE_SSH_PID" ]] || {
        echo "FATAL: no active UPLINK capture" >&2
        return 1
    }
    wait "$AG_CAPTURE_SSH_PID" || capture_ssh_exit_code=$?
    capture_wait_exit_code=$(ag_ssh "cat '$AG_REMOTE_CAPTURE_STATUS_PATH'")
    AG_CAPTURE_EXIT_CODE=$capture_wait_exit_code
    [[ "$capture_ssh_exit_code" == "0" ]] || {
        echo "FATAL: capture SSH wrapper failed rc=$capture_ssh_exit_code" >&2
        return 1
    }
    [[ "$capture_wait_exit_code" == "124" ]] || {
        echo "FATAL: tcpdump timeout status was $capture_wait_exit_code, expected 124" >&2
        return 1
    }
    timeout 25 scp -q -o BindAddress="$AG_MANAGEMENT_SOURCE_ADDRESS" \
        -o BatchMode=yes -o ConnectTimeout=8 \
        "$AG_BOARD:$AG_REMOTE_CAPTURE_PATH" "$AG_LOCAL_CAPTURE_PATH"
    tcpdump -nn -e -A -r "$AG_LOCAL_CAPTURE_PATH" > "$AG_LOCAL_CAPTURE_TEXT_PATH" 2>&1
    read -r AG_CAPTURED_PACKET_COUNT AG_CAPTURED_BYTE_COUNT AG_CAPTURED_MARKER_COUNT < <(
        python3 - "$AG_LOCAL_CAPTURE_PATH" "$AG_ACTIVE_CAPTURE_MARKER" <<'PYEOF'
import struct
import sys

pcap_path, marker = sys.argv[1:3]
marker_bytes = marker.encode("ascii")
with open(pcap_path, "rb") as pcap_file:
    pcap_bytes = pcap_file.read()

endianness_by_magic = {
    b"\xa1\xb2\xc3\xd4": ">",
    b"\xd4\xc3\xb2\xa1": "<",
    b"\xa1\xb2\x3c\x4d": ">",
    b"\x4d\x3c\xb2\xa1": "<",
}
if len(pcap_bytes) < 24 or pcap_bytes[:4] not in endianness_by_magic:
    raise SystemExit("capture is not a complete classic pcap file")
endianness = endianness_by_magic[pcap_bytes[:4]]
major_version, minor_version = struct.unpack_from(endianness + "HH", pcap_bytes, 4)
if (major_version, minor_version) != (2, 4):
    raise SystemExit("unsupported pcap version")

packet_count = 0
captured_byte_count = 0
captured_marker_count = 0
record_offset = 24
while record_offset < len(pcap_bytes):
    if len(pcap_bytes) - record_offset < 16:
        raise SystemExit("truncated pcap packet header")
    _, _, included_length, original_length = struct.unpack_from(
        endianness + "IIII", pcap_bytes, record_offset
    )
    record_offset += 16
    if included_length > original_length or included_length > 64 * 1024 * 1024:
        raise SystemExit("invalid pcap packet length")
    if len(pcap_bytes) - record_offset < included_length:
        raise SystemExit("truncated pcap packet payload")
    packet_bytes = pcap_bytes[record_offset:record_offset + included_length]
    captured_marker_count += packet_bytes.count(marker_bytes)
    record_offset += included_length
    packet_count += 1
    captured_byte_count += original_length
print(packet_count, captured_byte_count, captured_marker_count)
PYEOF
    )
    ag_add_evidence_file "$AG_LOCAL_CAPTURE_PATH"
    ag_add_evidence_file "$AG_LOCAL_CAPTURE_TEXT_PATH"
    echo "uplinkCapturedPackets=$AG_CAPTURED_PACKET_COUNT uplinkCapturedBytes=$AG_CAPTURED_BYTE_COUNT markerCount=$AG_CAPTURED_MARKER_COUNT"
    ag_ssh "rm -f '$AG_REMOTE_CAPTURE_PID_PATH' '$AG_REMOTE_CAPTURE_READY_PATH' '$AG_REMOTE_CAPTURE_STATUS_PATH' '$AG_REMOTE_CAPTURE_ERROR_PATH' '$AG_REMOTE_CAPTURE_PATH'" \
        >/dev/null
    AG_CAPTURE_SSH_PID=
    AG_REMOTE_CAPTURE_PATH=
    AG_REMOTE_CAPTURE_PID_PATH=
    AG_REMOTE_CAPTURE_STATUS_PATH=
    AG_REMOTE_CAPTURE_READY_PATH=
    AG_REMOTE_CAPTURE_ERROR_PATH=
}

ag_cleanup_active_upstream_server() {
    if [[ -n "$AG_UPSTREAM_SERVER_PID" ]] && kill -0 "$AG_UPSTREAM_SERVER_PID" 2>/dev/null; then
        kill "$AG_UPSTREAM_SERVER_PID" 2>/dev/null || true
        wait "$AG_UPSTREAM_SERVER_PID" 2>/dev/null || true
    fi
    [[ -z "$AG_UPSTREAM_SERVER_READY_PATH" ]] || rm -f "$AG_UPSTREAM_SERVER_READY_PATH"
    AG_UPSTREAM_SERVER_PID=
    AG_UPSTREAM_SERVER_READY_PATH=
}

ag_start_upstream_marker_server() {
    local listen_port=$1
    local server_log_path=$2
    local readiness_attempt
    AG_UPSTREAM_SERVER_READY_PATH="$AG_EVIDENCE_DIR/.${AG_TEST_ID}-${listen_port}.server-ready"
    AG_UPSTREAM_SERVER_EXIT_CODE=null
    AG_UPSTREAM_SERVER_READY=false
    rm -f "$AG_UPSTREAM_SERVER_READY_PATH"
    python3 -u - "$AG_UPLINK_TARGET" "$listen_port" "$server_log_path" \
        "$AG_CAPTURE_SECONDS" "$AG_UPSTREAM_SERVER_READY_PATH" <<'PYEOF' &
import selectors
import socket
import sys
import time

listen_address = sys.argv[1]
listen_port = int(sys.argv[2])
server_log_path = sys.argv[3]
run_seconds = int(sys.argv[4])
ready_path = sys.argv[5]
selector = selectors.DefaultSelector()

tcp_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
tcp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
tcp_socket.bind((listen_address, listen_port))
tcp_socket.listen(8)
tcp_socket.setblocking(False)
selector.register(tcp_socket, selectors.EVENT_READ, "tcp-listener")

udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
udp_socket.bind(("0.0.0.0", listen_port))
udp_socket.setblocking(False)
selector.register(udp_socket, selectors.EVENT_READ, "udp")

with open(ready_path, "x", encoding="ascii") as ready_file:
    ready_file.write("ready\n")
deadline = time.monotonic() + run_seconds
with open(server_log_path, "ab", buffering=0) as server_log:
    while time.monotonic() < deadline:
        for selector_key, _ in selector.select(timeout=0.25):
            if selector_key.data == "tcp-listener":
                connection, peer_address = tcp_socket.accept()
                connection.settimeout(1)
                try:
                    received_data = connection.recv(4096)
                    server_log.write(b"TCP " + repr(peer_address).encode("ascii") + b" " + received_data + b"\n")
                finally:
                    connection.close()
            else:
                received_data, peer_address = udp_socket.recvfrom(4096)
                server_log.write(b"UDP " + repr(peer_address).encode("ascii") + b" " + received_data + b"\n")
tcp_socket.close()
udp_socket.close()
PYEOF
    AG_UPSTREAM_SERVER_PID=$!
    ag_register_cleanup ag_cleanup_active_upstream_server
    for readiness_attempt in $(seq 1 50); do
        if [[ -r "$AG_UPSTREAM_SERVER_READY_PATH" ]]; then
            AG_UPSTREAM_SERVER_READY=true
            return 0
        fi
        kill -0 "$AG_UPSTREAM_SERVER_PID" 2>/dev/null || break
        sleep 0.1
    done
    echo "FATAL: upstream marker server did not become ready" >&2
    wait "$AG_UPSTREAM_SERVER_PID" || true
    return 1
}

ag_finish_upstream_marker_server() {
    local server_exit_code=0
    [[ -n "$AG_UPSTREAM_SERVER_PID" ]] || {
        echo "FATAL: no active upstream marker server" >&2
        return 1
    }
    wait "$AG_UPSTREAM_SERVER_PID" || server_exit_code=$?
    AG_UPSTREAM_SERVER_EXIT_CODE=$server_exit_code
    rm -f "$AG_UPSTREAM_SERVER_READY_PATH"
    AG_UPSTREAM_SERVER_PID=
    AG_UPSTREAM_SERVER_READY_PATH=
    [[ "$server_exit_code" == "0" ]] || {
        echo "FATAL: upstream marker server failed rc=$server_exit_code" >&2
        return 1
    }
}

ag_record_traffic_observation() {
    local phase_name=$1 expectation=$2 marker=$3 server_log_path=$4
    local observation_path="$AG_EVIDENCE_DIR/$AG_TEST_ID-$phase_name.observation.json"
    local server_marker_count
    server_marker_count=$(python3 - "$server_log_path" "$marker" <<'PYEOF'
import sys

server_log_path, marker = sys.argv[1:3]
with open(server_log_path, "rb") as server_log_file:
    print(server_log_file.read().count(marker.encode("ascii")))
PYEOF
    )
    [[ -f "$AG_LOCAL_CAPTURE_PATH" && -f "$AG_LOCAL_CAPTURE_TEXT_PATH" ]] || {
        echo "FATAL: traffic observation lacks completed capture evidence" >&2
        return 1
    }
    python3 - "$observation_path" "$AG_ROOT" "$AG_RUN_ID" "$AG_TEST_ID" "$phase_name" \
        "$expectation" "$marker" "$AG_VICTIM_NETNS" "$AG_PROTECTED_IF" "$AG_VICTIM_MAC" \
        "$AG_CAPTURE_IF" "$AG_UPLINK_IF" "$AG_CAPTURE_READY" "$AG_CAPTURE_EXIT_CODE" \
        "$AG_CAPTURED_PACKET_COUNT" "$AG_CAPTURED_BYTE_COUNT" "$AG_CAPTURED_MARKER_COUNT" \
        "$server_log_path" "$server_marker_count" "$AG_UPSTREAM_SERVER_READY" \
        "$AG_UPSTREAM_SERVER_EXIT_CODE" "$AG_LOCAL_CAPTURE_PATH" "$AG_LOCAL_CAPTURE_TEXT_PATH" <<'PYEOF'
import json
import os
import sys

(observation_path, experiment_root, run_id, test_id, phase_name, expectation, marker,
 victim_namespace, victim_interface, victim_mac, capture_interface,
 uplink_interface, capture_ready, capture_exit_code, captured_packets,
 captured_bytes, captured_marker_count, server_log_path, server_marker_count,
 server_ready, server_exit_code, pcap_path, pcap_text_path) = sys.argv[1:24]

observation_directory = os.path.dirname(observation_path)
experiment_root = os.path.realpath(experiment_root)

def relative_evidence_path(absolute_path):
    return os.path.relpath(os.path.realpath(absolute_path), experiment_root).replace(os.sep, "/")

document = {
    "resultKind": "traffic-observation",
    "schemaVersion": 1,
    "runId": run_id,
    "testId": test_id,
    "phase": phase_name,
    "expectation": expectation,
    "marker": marker,
    "source": {
        "namespace": victim_namespace,
        "interface": victim_interface,
        "mac": victim_mac,
    },
    "capture": {
        "interface": capture_interface,
        "uplinkInterface": uplink_interface,
        "ready": capture_ready == "true",
        "exitCode": int(capture_exit_code),
        "packetCount": int(captured_packets),
        "byteCount": int(captured_bytes),
        "markerCount": int(captured_marker_count),
        "pcapPath": relative_evidence_path(pcap_path),
        "textPath": relative_evidence_path(pcap_text_path),
    },
    "server": {
        "ready": server_ready == "true",
        "exitCode": int(server_exit_code),
        "markerCount": int(server_marker_count),
        "logPath": relative_evidence_path(server_log_path),
    },
}
with open(observation_path, "x", encoding="utf-8") as observation_file:
    json.dump(document, observation_file, indent=2, sort_keys=True)
    observation_file.write("\n")
    observation_file.flush()
    os.fsync(observation_file.fileno())
directory_descriptor = os.open(observation_directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
try:
    os.fsync(directory_descriptor)
finally:
    os.close(directory_descriptor)
PYEOF
    ag_add_evidence_file "$observation_path"
    AG_TEST_TRAFFIC_OBSERVATIONS+=("${observation_path#"$AG_ROOT/"}")
}

ag_victim_tcp_marker() {
    local destination_address=$1 destination_port=$2 marker=$3
    ag_run_victim python3 - "$AG_PROTECTED_IF" "$destination_address" "$destination_port" "$marker" <<'PYEOF'
import socket
import sys

interface_name, destination_address, destination_port, marker = sys.argv[1:5]
client_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
client_socket.setsockopt(socket.SOL_SOCKET, socket.SO_BINDTODEVICE, interface_name.encode("ascii") + b"\0")
client_socket.settimeout(3)
client_socket.connect((destination_address, int(destination_port)))
client_socket.sendall(marker.encode("ascii"))
client_socket.close()
PYEOF
}

ag_victim_udp_marker() {
    local destination_address=$1 destination_port=$2 marker=$3
    ag_run_victim python3 - "$AG_PROTECTED_IF" "$destination_address" "$destination_port" "$marker" <<'PYEOF'
import socket
import sys

interface_name, destination_address, destination_port, marker = sys.argv[1:5]
client_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
client_socket.setsockopt(socket.SOL_SOCKET, socket.SO_BINDTODEVICE, interface_name.encode("ascii") + b"\0")
client_socket.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
client_socket.sendto(marker.encode("ascii"), (destination_address, int(destination_port)))
client_socket.close()
PYEOF
}

ag_victim_raw_marker() {
    local marker=$1
    ag_run_victim python3 - "$AG_PROTECTED_IF" "$marker" <<'PYEOF'
import socket
import sys

interface_name, marker = sys.argv[1:3]
with open("/sys/class/net/%s/address" % interface_name, "r") as address_file:
    source_mac = bytes.fromhex(address_file.read().strip().replace(":", ""))
raw_socket = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(0x88B5))
raw_socket.bind((interface_name, 0))
frame = (b"\xff" * 6) + source_mac + b"\x88\xb5" + marker.encode("ascii")
raw_socket.send(frame)
raw_socket.close()
PYEOF
}
