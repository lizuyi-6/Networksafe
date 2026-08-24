# AetherGuard Cat2 fail-closed gateway prototype

This experiment evaluates a physically separate SBC gateway prototype.
Current run uses physical Ethernet transport (experimental single-cable).

## Evaluated topology (run: 20250824T082729Z-8lctnuk7)

victim netns/agvictim0 (10.99.0.2) on operator laptop
  <-> aguplink0 (10.99.0.1) <-> agbr0-host bridge <-> eno1
  <== Ethernet cable ==>
  LubanCat-2 eth1 (UPLINK_IF, bridge member, 1000Mb/s Full)
  <-> agbr0 (gateway bridge) <-> eth0 (SERVER_IF, gate-controlled)

Management: usb0 (192.168.100.2/24) NEVER in agbr0

## Hardware inventory

| Interface | State | Speed | Duplex | Role |
|-----------|-------|-------|--------|------|
| eth0 | DOWN/NO-CARRIER | N/A | N/A | SERVER_IF |
| eth1 | UP | 1000Mb/s | Full | UPLINK_IF |
| usb0 | UP | N/A | N/A | Management (not in agbr0) |

## Transport comparison

| Aspect | USB RNDIS (old) | Physical Ethernet (current) |
|--------|-----------------|----------------------------|
| SERVER_IF | usb1 | eth0 |
| UPLINK_IF | usb2 | eth1 |
| Link speed | USB 2.0 High Speed | 1000Mb/s Full Duplex |
| PHY tested | No | Yes (eth1 verified) |

## Campaign results (20250824T082729Z)

| Test | Status | Notes |
|------|--------|-------|
| eth0-eth1-inline-gateway | BLOCKED | Single cable |
| ethernet-vlan-forwarding | BLOCKED | No VLAN switch |
| ethernet-phy-link-flap | PARTIAL | eth0 no cable |
| ethernet-gigabit-negotiation | PARTIAL | eth1=1000/Full |
| management-channel | PASSED | usb0 independent |
| gateway-initial-state | PASSED | agbr0 correct |

## Evidence

Run: results/raw/20250824T082729Z-8lctnuk7/
Validation: PASSED (17 tests, 49 files)

## Transport scripts

transport/ethernet/
  cat2-setup.sh    - LubanCat-2 Ethernet setup
  cat2-teardown.sh - LubanCat-2 Ethernet teardown
  host-setup.sh    - Operator laptop setup
  host-teardown.sh - Operator laptop teardown
