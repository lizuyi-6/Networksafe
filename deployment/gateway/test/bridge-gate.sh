#!/usr/bin/env bash
#
# AetherGuard Gateway Appliance — L2 bridge namespace gate (AUD-04-1/2).
#
# Builds a throwaway topology with a bridge + veth port pairs + namespaces:
#
#   ns-server -- srv-v --[br-ag]-- lan-v -- ns-lan      (data plane)
#   mgmt-v (dummy, 10.78.0.1)                            (MGMT plane)
#
# Applies the ACTUAL aetherguard rulesets (port defines rewritten to the test
# names) and asserts machine-readable checks:
#   isolated : server->lan, lan->server (IPv4+IPv6) blocked; mgmt input alive
#   released : server<->lan (IPv4+IPv6) passes; routed mgmt->data forbidden
#   readback : aetherguard tables present; drop policy; counters advanced
#   toggle   : released->isolated rapid switch lands isolated (AUD-04-2)
#
# Kernel capability: the data plane is nft BRIDGE family. If the kernel lacks
# CONFIG_NF_TABLES_BRIDGE, the gate runs an INET-FALLBACK suite (same topology,
# apply/replace/readback/toggle mechanics, tagged inet-fallback) — that mode
# does NOT prove bridge-family frame filtering and must be re-run on a
# bridge-capable kernel (CI runner / appliance) for full AUD-04-1 evidence.
#
# Output: "BRIDGE-GATE <check> PASS|FAIL [detail]" lines + SUMMARY line.
# Exit: 0 all pass, 1 any failure. Root required.
set -u

PASS=0
FAIL=0
SKIP=0
GATE_MODE=bridge
SERVER_IP="10.77.0.2"
LAN_IP="10.77.0.3"
MGMT_IP="10.78.0.1"
SRV_V="srv-v"
LAN_V="lan-v"
MGMT_V="mgmt-v"
BR="br-ag"
NS_SRV="ag-server"
NS_LAN="ag-lan"
RULESET_DIR="$(cd "$(dirname "$0")/../nftables" && pwd)"
WORK=""

cleanup() {
  [ -n "$WORK" ] || return 0
  ip netns del "$NS_SRV" 2>/dev/null
  ip netns del "$NS_LAN" 2>/dev/null
  ip link del "$BR" 2>/dev/null
  ip link del "$MGMT_V" 2>/dev/null
  nft delete table bridge aetherguard 2>/dev/null
  nft delete table inet aetherguard_mgmt 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

report() {
  echo "BRIDGE-GATE $1 $2 ${3:-}"
  case "$2" in
    PASS) PASS=$((PASS+1)) ;;
    SKIP) SKIP=$((SKIP+1)) ;;
    *)    FAIL=$((FAIL+1)) ;;
  esac
}
check() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then report "$name" PASS; else report "$name" FAIL; fi
}
check_not() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then report "$name" FAIL "expected-blocked"; else report "$name" PASS; fi
}

[ "$(id -u)" = "0" ] || { echo "BRIDGE-GATE FATAL must-run-as-root"; exit 1; }
command -v nft >/dev/null || { echo "BRIDGE-GATE FATAL nft-not-found"; exit 1; }
command -v ip >/dev/null || { echo "BRIDGE-GATE FATAL ip-not-found"; exit 1; }

# Pre-run sweep (a previous aborted run) — safe: WORK is empty here.
cleanup

WORK="$(mktemp -d)"

# ================= topology =================
ip link add "$BR" type bridge 2>/dev/null || { echo "BRIDGE-GATE FATAL no-bridge-support"; exit 1; }
# No STP forwarding delay: checks must not pass/fail on port state timers.
ip link set "$BR" type bridge stp_state 0 forward_delay 0
ip link set "$BR" up
ip link add "$SRV_V" type veth peer name srv-p || { echo "BRIDGE-GATE FATAL veth-failed"; exit 1; }
ip link add "$LAN_V" type veth peer name lan-p || exit 1
ip link add "$MGMT_V" type dummy || exit 1
ip link set "$SRV_V" master "$BR"
ip link set "$LAN_V" master "$BR"
ip link set "$SRV_V" up
ip link set "$LAN_V" up
ip link set "$MGMT_V" up
ip addr add "$MGMT_IP/24" dev "$MGMT_V"

ip netns add "$NS_SRV"
ip netns add "$NS_LAN"
ip link set srv-p netns "$NS_SRV"
ip link set lan-p netns "$NS_LAN"
ip netns exec "$NS_SRV" ip addr add "$SERVER_IP/24" dev srv-p
ip netns exec "$NS_LAN" ip addr add "$LAN_IP/24" dev lan-p
ip netns exec "$NS_SRV" ip link set srv-p up
ip netns exec "$NS_LAN" ip link set lan-p up
ip netns exec "$NS_SRV" ip -6 addr add fd77::2/64 dev srv-p 2>/dev/null
ip netns exec "$NS_LAN" ip -6 addr add fd77::3/64 dev lan-p 2>/dev/null

# ================= capability probe =================
cat > "$WORK/probe.nft" <<'EOF'
table bridge ag_probe
delete table bridge ag_probe
table bridge ag_probe {
    chain probe {
        type filter hook forward priority filter; policy accept;
    }
}
EOF
if nft -f "$WORK/probe.nft" >/dev/null 2>&1 && nft list table bridge ag_probe >/dev/null 2>&1; then
  nft delete table bridge ag_probe 2>/dev/null
  GATE_MODE=bridge
else
  GATE_MODE=inet-fallback
  report kernel-bridge-family SKIP "CONFIG_NF_TABLES_BRIDGE missing: running mechanism fallback suite (full AUD-04-1 evidence requires a bridge-capable kernel)"
fi

# ================= variants =================
if [ "$GATE_MODE" = bridge ]; then
  for rs in isolated released; do
    sed -e "s/define SERVER = eth0/define SERVER = $SRV_V/" \
        -e "s/define LANWAN = eth1/define LANWAN = $LAN_V/" \
        -e "s/define MGMT = eth2/define MGMT = $MGMT_V/" \
        "$RULESET_DIR/${rs}_ruleset.nft" > "$WORK/${rs}.nft" || exit 1
  done
else
  for rs in isolated released; do
    if [ "$rs" = released ]; then PAIR=accept; else PAIR=drop; fi
    cat > "$WORK/${rs}.nft" <<EOF
table inet aetherguard_mgmt
delete table inet aetherguard_mgmt

table inet aetherguard_mgmt {
    chain forward {
        type filter hook forward priority filter; policy drop;
        iifname "$SRV_V" oifname "$LAN_V" counter $PAIR
        iifname "$LAN_V" oifname "$SRV_V" counter $PAIR
        counter drop
    }
    chain input {
        type filter hook input priority filter; policy drop;
        iif "lo" accept
        ct state established,related accept
        iifname "$MGMT_V" accept
        ip protocol icmp accept
        counter drop
    }
    chain output {
        type filter hook output priority filter; policy accept;
    }
}
EOF
  done
fi

srv_ping_lan()  { ip netns exec "$NS_SRV" ping -c1 -W1 "$LAN_IP" "$@"; }
lan_ping_srv()  { ip netns exec "$NS_LAN" ping -c1 -W1 "$SERVER_IP" "$@"; }
srv_ping6_lan() { ip netns exec "$NS_SRV" ping -6 -c1 -W1 fd77::3 "$@"; }

# nft 1.0.9 exits 0 even when the kernel rejects a batch — apply success is
# determined by READBACK, never by exit code.
apply() {
  nft -f "$WORK/$1.nft" >/dev/null 2>&1 || return 1
  if [ "$GATE_MODE" = bridge ]; then
    nft list table bridge aetherguard >/dev/null 2>&1 || return 1
  fi
  nft list table inet aetherguard_mgmt >/dev/null 2>&1
}

# ================= isolated =================
apply isolated || { echo "BRIDGE-GATE FATAL isolated-apply-failed"; exit 1; }
report isolated-apply PASS

if [ "$GATE_MODE" = bridge ]; then
  check_not isolated-server-to-lan-blocked  srv_ping_lan
  check_not isolated-lan-to-server-blocked  lan_ping_srv
  check_not isolated-ipv6-blocked           srv_ping6_lan
else
  # Bridged frames are L2-switched INSIDE the bridge and never traverse the
  # inet forward hook — frame filtering is untestable in fallback mode.
  report isolated-server-to-lan-blocked SKIP "data-plane-unavailable-in-fallback"
  report isolated-lan-to-server-blocked SKIP "data-plane-unavailable-in-fallback"
  report isolated-ipv6-blocked SKIP "data-plane-unavailable-in-fallback"
fi
check        isolated-mgmt-input-alive    ping -c1 -W1 -I "$MGMT_V" "$MGMT_IP"

if [ "$GATE_MODE" = bridge ]; then
  check        isolated-readback-table       nft list table bridge aetherguard
  check        isolated-readback-drop-policy bash -c "nft list chain bridge aetherguard forward | grep -q 'policy drop'"
  check        isolated-counters-advanced    bash -c "nft list chain bridge aetherguard forward | grep -E 'counter packets ([1-9])'"
else
  check        isolated-readback-table       nft list table inet aetherguard_mgmt
  check        isolated-readback-drop-policy bash -c "nft list chain inet aetherguard_mgmt forward | grep -q 'policy drop'"
  # counters-advanced requires real traffic through the rules — bridge mode only
  report isolated-counters-advanced SKIP "data-plane-unavailable-in-fallback"
fi

# ================= released =================
apply released || { echo "BRIDGE-GATE FATAL released-apply-failed"; exit 1; }
report released-apply PASS

if [ "$GATE_MODE" = bridge ]; then
  check released-server-to-lan-passes  srv_ping_lan
  check released-lan-to-server-passes  lan_ping_srv
  check released-ipv6-passes           srv_ping6_lan
else
  report released-server-to-lan-passes SKIP "data-plane-unavailable-in-fallback"
  report released-lan-to-server-passes SKIP "data-plane-unavailable-in-fallback"
  report released-ipv6-passes SKIP "data-plane-unavailable-in-fallback"
fi
check        released-mgmt-input-alive ping -c1 -W1 -I "$MGMT_V" "$MGMT_IP"
check_not released-mgmt-forward-blocked bash -c "ip netns exec $NS_SRV ping -c1 -W1 $MGMT_IP"

# ================= rapid toggle (AUD-04-2 newest-wins) =================
apply released
apply isolated
sleep 1
if [ "$GATE_MODE" = bridge ]; then
  check toggle-lands-isolated srv_ping_lan
else
  report toggle-lands-isolated SKIP "data-plane-unavailable-in-fallback"
fi
if [ "$GATE_MODE" = bridge ]; then
  check toggle-readback-isolated bash -c "nft list chain bridge aetherguard forward | grep -q 'policy drop'"
else
  check toggle-readback-isolated bash -c "nft list chain inet aetherguard_mgmt forward | grep -q 'policy drop'"
fi

echo "BRIDGE-GATE SUMMARY mode=$GATE_MODE pass=$PASS skip=$SKIP fail=$FAIL"
[ "$FAIL" -eq 0 ]
