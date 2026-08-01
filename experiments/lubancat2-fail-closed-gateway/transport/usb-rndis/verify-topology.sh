#!/bin/bash
# Emit one machine-readable JSON topology verdict.
set -Eeuo pipefail

AG_BOARD=${AG_BOARD:-board}
VICTIM_NAMESPACE=${AG_VICTIM_NETNS:-victim}
VICTIM_INTERFACE=${AG_PROTECTED_IF:-agvictim0}
HOST_UPLINK_INTERFACE=${AG_HOST_UPLINK_IF:-aguplink0}
CAT2_SERVER_INTERFACE=${AG_SERVER_IF:-usb1}
CAT2_UPLINK_INTERFACE=${AG_UPLINK_IF:-usb2}
CAT2_MANAGEMENT_INTERFACE=${AG_MANAGEMENT_IF:-usb0}
MANAGEMENT_SOURCE_ADDRESS=${AG_MANAGEMENT_SOURCE_ADDRESS:-192.168.100.1}
MANAGEMENT_REMOTE_ADDRESS=${AG_MANAGEMENT_REMOTE_ADDRESS:-192.168.100.2}
EXPECTED_VICTIM_MAC=${AG_EXPECTED_VICTIM_MAC:-02:11:11:11:11:01}
EXPECTED_HOST_UPLINK_MAC=02:22:22:22:22:01

host_victim_present=false
host_uplink_present=false
management_available=false
cat2_status_json=null
victim_interface_count=0
nft_table_absent=false
victim_mac=unknown
host_uplink_mac=unknown
victim_default_route_device=unknown
management_connection=

if ip netns list | awk '{print $1}' | awk -v expected="$VICTIM_NAMESPACE" '$1 == expected {found=1} END {exit !found}' \
    && sudo -n ip netns exec "$VICTIM_NAMESPACE" ip link show dev "$VICTIM_INTERFACE" >/dev/null 2>&1; then
    host_victim_present=true
    victim_interface_count=$(sudo -n ip netns exec "$VICTIM_NAMESPACE" ip -o link show \
        | awk -F': ' '$2 != "lo" {count += 1} END {print count + 0}')
    victim_mac=$(sudo -n ip netns exec "$VICTIM_NAMESPACE" \
        cat "/sys/class/net/$VICTIM_INTERFACE/address" | tr 'A-F' 'a-f')
    victim_default_route_device=$(sudo -n ip netns exec "$VICTIM_NAMESPACE" ip -o route show default \
        | awk '{for (field_index=1; field_index<=NF; field_index+=1) if ($field_index == "dev") print $(field_index+1)}')
fi
if ip link show dev "$HOST_UPLINK_INTERFACE" >/dev/null 2>&1; then
    host_uplink_present=true
    host_uplink_mac=$(cat "/sys/class/net/$HOST_UPLINK_INTERFACE/address" | tr 'A-F' 'a-f')
fi
if ! nft list table inet aetherguard_cat2_usb >/dev/null 2>&1; then
    nft_table_absent=true
fi

if management_connection=$(timeout 25 ssh -b "$MANAGEMENT_SOURCE_ADDRESS" \
    -o BatchMode=yes -o ConnectTimeout=8 "$AG_BOARD" 'printf "%s\n" "$SSH_CONNECTION"' 2>/dev/null) \
    && cat2_status_json=$(timeout 25 ssh -b "$MANAGEMENT_SOURCE_ADDRESS" \
    -o BatchMode=yes -o ConnectTimeout=8 "$AG_BOARD" \
    "ag-cat2-gateway status" 2>/dev/null); then
    if awk -v expected_source="$MANAGEMENT_SOURCE_ADDRESS" -v expected_remote="$MANAGEMENT_REMOTE_ADDRESS" \
        '{exit !($1 == expected_source && $3 == expected_remote)}' <<<"$management_connection"; then
        management_available=true
    fi
else
    cat2_status_json=null
fi

python3 - "$host_victim_present" "$host_uplink_present" "$management_available" \
    "$victim_interface_count" "$nft_table_absent" "$VICTIM_NAMESPACE" "$VICTIM_INTERFACE" \
    "$HOST_UPLINK_INTERFACE" "$CAT2_SERVER_INTERFACE" "$CAT2_UPLINK_INTERFACE" \
    "$CAT2_MANAGEMENT_INTERFACE" "$cat2_status_json" "$victim_mac" "$host_uplink_mac" \
    "$victim_default_route_device" "$EXPECTED_VICTIM_MAC" "$EXPECTED_HOST_UPLINK_MAC" \
    "$MANAGEMENT_SOURCE_ADDRESS" "$MANAGEMENT_REMOTE_ADDRESS" "$management_connection" <<'PYEOF'
import datetime
import json
import sys

(host_victim_present, host_uplink_present, management_available,
 victim_interface_count, nft_table_absent, victim_namespace, victim_interface,
 host_uplink_interface, server_interface, uplink_interface,
 management_interface, cat2_status_text, victim_mac, host_uplink_mac,
 victim_default_route_device, expected_victim_mac, expected_host_uplink_mac,
 management_source_address, management_remote_address,
 management_connection) = sys.argv[1:22]

faults = []
try:
    cat2_status = json.loads(cat2_status_text)
except (TypeError, ValueError):
    cat2_status = None
    faults.append("CAT2_STATUS_UNAVAILABLE")

if host_victim_present != "true":
    faults.append("VICTIM_NAMESPACE_INTERFACE_MISSING")
if int(victim_interface_count) != 1:
    faults.append("VICTIM_NOT_SINGLE_PATH")
if victim_mac.lower() != expected_victim_mac.lower():
    faults.append("VICTIM_MAC_MISMATCH")
if victim_default_route_device != victim_interface:
    faults.append("VICTIM_DEFAULT_ROUTE_DEVICE_MISMATCH")
if host_uplink_present != "true":
    faults.append("HOST_UPLINK_INTERFACE_MISSING")
if host_uplink_mac.lower() != expected_host_uplink_mac.lower():
    faults.append("HOST_UPLINK_MAC_MISMATCH")
if nft_table_absent != "true":
    faults.append("LEGACY_NFT_TABLE_STILL_PRESENT")
if management_available != "true":
    faults.append("MANAGEMENT_UNAVAILABLE")

if cat2_status is not None:
    expected_interfaces = {
        "serverInterface": server_interface,
        "uplinkInterface": uplink_interface,
        "managementInterface": management_interface,
    }
    for field_name, expected_value in expected_interfaces.items():
        if cat2_status.get(field_name) != expected_value:
            faults.append("CAT2_%s_MISMATCH" % field_name.upper())
    if not cat2_status.get("topologyReady"):
        faults.append("CAT2_TOPOLOGY_NOT_READY")
    if cat2_status.get("state") not in ("isolated", "released"):
        faults.append("CAT2_GATE_FAULT")
    if management_interface in (server_interface, uplink_interface):
        faults.append("MANAGEMENT_DATA_INTERFACE_COLLISION")

document = {
    "verifiedAt": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    "valid": not faults,
    "transport": "usb-rndis",
    "host": {
        "victimNamespace": victim_namespace,
        "victimInterface": victim_interface,
        "victimNonLoopbackInterfaceCount": int(victim_interface_count),
        "victimMac": victim_mac,
        "victimDefaultRouteDevice": victim_default_route_device,
        "uplinkInterface": host_uplink_interface,
        "uplinkMac": host_uplink_mac,
        "legacyNftTableAbsent": nft_table_absent == "true",
        "forwardingMode": "local-upstream-only",
    },
    "cat2": cat2_status,
    "managementAvailable": management_available == "true",
    "managementPath": {
        "sourceAddress": management_source_address,
        "remoteAddress": management_remote_address,
        "sshConnection": management_connection,
        "verified": management_available == "true",
    },
    "faults": faults,
}
print(json.dumps(document, indent=2, sort_keys=True))
sys.exit(0 if not faults else 1)
PYEOF
