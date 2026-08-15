# Threat model

## Trusted computing base

| Entity | Status |
| --- | --- |
| Cat2 hardware, Debian kernel, bridge, systemd PID1, root filesystem | trusted for this prototype |
| Cat2 `usb0` management and operator SSH credentials | trusted |
| ECDSA private key on the operator laptop | trusted |
| Processes confined to `victim` network namespace | untrusted |
| Whole operator laptop and its root account | trusted and explicitly outside the attacker scope |
| Home router, external Internet availability | not a security oracle; external probes are supplemental |

The attacker controls networking inside the `victim` namespace and may send
ARP, IPv4, IPv6/NDP, TCP, UDP, broadcast, multicast, and raw Ethernet frames.
The namespace has only `agvictim0`. It has no Cat2 management credentials or
host capabilities that can move interfaces or alter the Cat2.

This is not a full-host-root experiment. The operator laptop contains SSH and
signing keys and owns both host-side logical RNDIS interfaces. Root on that
laptop can defeat the experiment boundary.

## Security invariants

1. `isolated` means `SERVER_IF` is not enslaved to any bridge.
2. `released` requires one exact active PID1 timer and a matching `active`
   lease record containing lease ID, timer unit, expiry, and configured
   interfaces.
3. `isolate`, `release`, `_expire`, and `reconcile` serialize on the stable
   transition lock.
4. Release closes the gate before replacing any existing lease. Failure at any
   subsequent step leaves or restores isolation and removes incomplete state.
5. A `prepared` state is not a valid released lease. `reconcile` closes an open
   gate with prepared, missing, malformed, expired, or conflicting state.
6. An old expiry token cannot close a newer complete valid lease.
7. Expiry close failure is nonzero and journaled; it is never logged as success.
8. Authorization security fields require exact JSON integer types and bounded
   values. Booleans, floats, strings, negative values, non-finite values, and
   oversized counters are rejected.
9. The stable counter lock covers validation through the release result. The
   counter is atomically replaced and fsynced before release and is never
   rolled back after release failure.
10. Uncertain state is resolved toward isolation, not merely reported.

## Out of scope

- Cat2 root/kernel compromise, physical access, supply-chain compromise, and
  side channels.
- Secure Element or hardware monotonic counter guarantees.
- Physical Ethernet PHYs, VLANs, cable pull, link flap, and throughput.
- Independent physical protected-host root compromise.
- Bypass paths on the enclosing laptop such as Wi-Fi and VPN.
- Management availability during USB gadget re-enumeration.
- Persistent USB topology and reboot boot-window guarantees.

## Evidence rule

Blocked application calls alone are insufficient. Isolated verdicts require a
victim-namespace probe, zero matching packets/bytes on Cat2 `UPLINK_IF`, and a
management availability check. Listing a neighbor table is observation only;
it is not an NDP escape probe.
