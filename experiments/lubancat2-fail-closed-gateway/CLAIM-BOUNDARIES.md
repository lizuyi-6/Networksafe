# Claim boundaries

Run: 20250824T082729Z-8lctnuk7 (commit 98cce20ebd74274714991fe5ecf166171ea07e35)
Transport: physical-ethernet (single-cable, single-host-port)

## Hardware constraints for this run

- Operator laptop: ONE physical Ethernet port (eno1)
- LubanCat-2 eth0 (SERVER_IF): NO cable, CARRIER=0
- LubanCat-2 eth1 (UPLINK_IF): connected to laptop eno1, 1000Mb/s Full
- No VLAN-capable switch available
- Victim namespace runs on operator laptop (10.99.0.2)

## What was verified

PASSED:
- Gateway binary runs on LubanCat-2 with physical Ethernet config (eth0/eth1)
- agbr0 bridge has exact closed topology: {eth1} only when gate=isolated
- eth0 correctly isolated (not in agbr0) when gate=isolated
- usb0 management channel independent of Ethernet data plane
- Management SSH reachable throughout experiment
- ReactorOS services active during Ethernet configuration
- eth1 PHY: Speed=1000Mb/s, Duplex=Full, Link detected=yes

BLOCKED:
- eth0-eth1-inline-gateway bidirectional test (needs second cable/port)
- ethernet-vlan-forwarding (needs VLAN-capable switch)

PARTIAL:
- ethernet-phy-link-flap (eth0 not testable, eth1 observed passively)
- ethernet-gigabit-negotiation (eth1 verified, eth0 not testable)

## What this run does NOT prove

- Bidirectional inline gateway forwarding (SERVER_IF <-> UPLINK_IF)
- Fail-closed behavior under Layer-2 traffic (isolated/released/expired)
- VLAN forwarding behavior
- Hardware-enforced isolation, relay interlock, STM32, Secure Element
- Resistance to Cat2 root or kernel compromise
