# Claim boundaries

These rules bind papers, presentations, result summaries, and PR descriptions.
Only a claim backed by a current PASSED per-test JSON and primary manifest
evidence may be used.

## Evaluated scope

- Gateway: physically separate LubanCat-2 / RK3568 SBC.
- Data plane (current run 20250824T082729Z): physical Ethernet transport.
  eth0=SERVER_IF, eth1=UPLINK_IF, agbr0=bridge, usb0=management.
- Gate: Linux bridge membership of eth0, serialized and lease-identified.
- Protected endpoint: single-path Linux network namespace 'victim' with only agvictim0.
- Management: USB RNDIS usb0; never in agbr0.

## Campaign binding

The committed campaign 20260802T095611Z-b7940f333db02e89 was captured against
the USB RNDIS transport. It validates the prior gateway build with logical
USB data interfaces.

The committed campaign 20250824T082729Z-8lctnuk7 was captured against the same
gateway build (commit 98cce20ebd74274714991fe5ecf166171ea07e35) with physical
Ethernet transport. Ethernet-specific tests were conducted:

- eth0-eth1-inline-gateway: BLOCKED (only ONE cable, eth0 CARRIER=0)
- ethernet-vlan-forwarding: BLOCKED (no VLAN-capable switch)
- ethernet-phy-link-flap: PARTIAL (eth0 not testable, eth1 observed)
- ethernet-gigabit-negotiation: PARTIAL (eth1=1000Mb/s/Full verified, eth0 needs cable)

## Conditionally supported claims

When the corresponding current test is PASSED, this run can establish:

1. Traffic emitted by the single-path victim namespace does not appear on the
   Cat2 UPLINK capture while eth0 is outside agbr0 (BLOCKED for Ethernet inline)
2. During a valid bounded lease, the victim reaches a local upstream target,
   establishes TCP, and produces matching UPLINK capture evidence (BLOCKED)
3. After expiry, the identical probe fails and no matching UPLINK packet is
   observed (BLOCKED)
4. The dedicated data bridge converges to the exact closed member set {eth1}
5. The gateway recomputes the effective authorization lifetime from expiresAt
   after holding the transition lock
6. usb0 management and ReactorOS services remained available during Ethernet
   data plane configuration
7. Management plane is independent of Ethernet data plane (PASSED)

## Verified claims (20250824T082729Z)

1. LubanCat-2 can run the same gateway binary with physical Ethernet interfaces
   (eth0/eth1) instead of USB RNDIS (usb1/usb2)
2. agbr0 bridge correctly isolates eth0 (SERVER_IF) when gate=isolated
3. eth1 (UPLINK_IF) is the sole bridge member in isolated state
4. usb0 management channel is NOT affected by Ethernet data plane changes
5. ReactorOS services remain active during Ethernet gateway configuration
6. eth1 gigabit PHY: Speed=1000Mb/s, Duplex=Full, Link detected=yes
7. Carrier-detect prevents Layer-2 forwarding on disconnected ports (fail-closed)

## Forbidden claims

- Fully compromised physical Linux host or full root on operator laptop
- Hardware-enforced isolation, STM32 controller, Secure Element, relay interlock
- Resistance to Cat2 root, kernel compromise, gadget-controller failure
- Production-grade, paper-ready, SLA, zero-risk, or absolute-security wording
- Any metric or reliability conclusion from PARTIAL, NOT_RUN, or BLOCKED
- Complete post-reboot fail-closed result (F06 remains PARTIAL)

## Hardware constraints

Current run required only ONE Ethernet cable (eth1 connected).
eth0 has no Layer-2 peer (CARRIER=0).
Bidirectional inline forwarding test requires a SECOND cable.
No VLAN-capable switch in the test environment.
