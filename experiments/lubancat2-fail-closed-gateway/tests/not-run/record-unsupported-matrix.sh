#!/bin/bash
# Emit explicit machine-readable non-results for unavailable hardware scenarios.
set -Eeuo pipefail

case_name=${1:-all}
if [[ "$case_name" == "all" ]]; then
    echo "FATAL: use scripts/run-hardware-campaign.sh so all non-results share campaign metadata" >&2
    exit 2
fi

AG_CLEANUP_GATEWAY=0
. "$(dirname "$0")/../../lib/test-lib.sh"

case "$case_name" in
    f06)
        ag_begin_test \
            "f06-post-reboot-topology" \
            "reboot" \
            "PARTIAL historical observation only; no reboot in the fixed run"
        ag_add_note "The earlier reboot removed usb1, usb2, and the runtime bridge. Interface absence is not a restored-gateway isolation proof."
        ag_finish_test PARTIAL 3 REBOOT_REMOVED_RUNTIME_USB_TOPOLOGY \
            "automatic restoration of usb1, usb2, and the runtime bridge followed by zero-escape capture" \
            "historical reboot restored management and ReactorOS but did not restore the USB data topology; fixed implementation was not rebooted"
        ;;
    f07)
        ag_begin_test "f07-reboot-during-release" "reboot" "NOT_RUN: reboot during active release"
        ag_finish_test NOT_RUN 4 USB_TOPOLOGY_PERSISTENCE_NOT_DEPLOYED \
            "persistent USB topology, continuous capture, management recovery, and ReactorOS checks" \
            "runtime-only topology is not configured to recover after reboot"
        ;;
    power-cycle)
        ag_begin_test "f08-physical-power-cycle" "reboot" "NOT_RUN: physical power cycle requires explicit operator confirmation"
        ag_finish_test NOT_RUN 4 PHYSICAL_POWER_CYCLE_NOT_AUTHORIZED \
            "explicit operator confirmation and local recovery supervision" \
            "no physical power cycle was performed"
        ;;
    physical-ethernet)
        ag_begin_test "eth0-eth1-inline-gateway" "topology" "NOT_RUN: Cat2 physical Ethernet data plane"
        ag_finish_test NOT_RUN 4 ETHERNET_CABLES_UNAVAILABLE \
            "independent protected host connected exclusively through Cat2 eth0 and eth1" \
            "no Ethernet cables were available; the evaluated data plane used logical USB RNDIS interfaces"
        ;;
    vlan)
        ag_begin_test "ethernet-vlan-forwarding" "topology" "NOT_RUN: VLAN forwarding over Cat2 Ethernet PHYs"
        ag_finish_test NOT_RUN 4 PHYSICAL_ETHERNET_NOT_AVAILABLE \
            "tagged Ethernet peers and physical eth0/eth1 path" \
            "VLAN behavior was not measured"
        ;;
    phy-flap)
        ag_begin_test "ethernet-phy-link-flap" "fault" "NOT_RUN: physical link flap"
        ag_finish_test NOT_RUN 4 PHYSICAL_ETHERNET_NOT_AVAILABLE \
            "controlled cable or PHY flap on eth0 and eth1" \
            "physical Ethernet links were not connected"
        ;;
    gigabit)
        ag_begin_test "ethernet-gigabit-negotiation" "performance" "NOT_RUN: 1000BASE-T negotiation"
        ag_finish_test NOT_RUN 4 PHYSICAL_ETHERNET_NOT_AVAILABLE \
            "two gigabit peers, cables, and ethtool negotiation evidence" \
            "speed, duplex, and Ethernet throughput were not measured"
        ;;
    independent-host)
        ag_begin_test "independent-physical-host-root-attacker" "isolation" "NOT_RUN: independent compromised physical host"
        ag_finish_test NOT_RUN 4 INDEPENDENT_PROTECTED_HOST_UNAVAILABLE \
            "separate Linux machine connected exclusively through Cat2 eth0/eth1" \
            "protected endpoint was a single-path network namespace on the operator laptop"
        ;;
    *)
        echo "usage: $0 {all|f06|f07|power-cycle|physical-ethernet|vlan|phy-flap|gigabit|independent-host}" >&2
        exit 2
        ;;
esac
