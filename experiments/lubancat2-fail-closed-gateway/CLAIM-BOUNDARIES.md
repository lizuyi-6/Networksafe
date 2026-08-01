# CLAIM BOUNDARIES - AetherGuard Cat2 External Gateway Prototype

This file is the binding rule set for any statement made about this
experiment, including papers, presentations and PR descriptions. If a claim
is not explicitly listed under "supported", do not make it.

## Supported claims (only if the matching test actually PASSED)

1. The Cat2 is a physically separate dual-NIC SBC gateway in series between
   the protected Linux host and its upstream network. *(inventory)*
2. With only root on the protected host, an attacker cannot modify the Cat2
   gate, because the gate state lives in the Cat2 kernel and management
   requires credentials the host does not possess. *(fault tests F17-F20)*
3. The default and post-reboot state of the gate is **isolated**: no L2
   frames cross between the protected host and upstream. *(tests B, F06-F08)*
4. A release is always time-bounded (1..600 s); expiry is scheduled by PID1
   at release time and does not depend on any userspace process surviving.
   *(tests C, D, F01-F02)*
5. Signed release authorizations (Ed25519) are verified on the gateway;
   tampered, replayed, counter-rolled-back, expired, future-dated and
   over-duration authorizations are rejected. *(test E)*
6. The management plane (USB RNDIS) stayed available during every executed
   test, including reboots. *(test logs)*
7. Performance numbers exactly as measured, with their environment attached.
   *(test G, only where status = PASSED)*

## Unsupported claims (FORBIDDEN)

- "Secure Element-backed" anything. Keys are ordinary files.
- "Hardware-enforced", "physical interlock", "relay", "air-gap", "tamper-resistant".
- "Resists compromise of the Cat2 itself" (its root can change everything).
- "STM32 safety controller verified" / "relay feedback verified" (no such
  hardware is present or tested).
- "Root-Resistant Gateway Appliance complete" - this is a software-gate
  prototype on one board with one protected host.
- "Production-grade", "SLA", "zero risk", "absolute security".
- Any performance or reliability number whose test did not actually run.
- Any claim that PID1 lease expiry is equivalent to a kernel packet-filter
  timer. It is the strongest mechanism this kernel supports (evidence:
  inventory/cat2-system.json), and the difference is documented.

## Known limitations that MUST accompany any write-up

1. Gate enforcement is Linux bridge membership in software, on the same
   kernel that runs other services (ReactorOS). A Cat2 kernel compromise or
   Cat2 root shell defeats everything.
2. Boot-time isolation: the protected host's port is not a bridge member
   until explicitly enslaved by a verified release; the boot unit simply
   never enslaves it, so the boot window is zero by construction (verified
   in fault test F06).
3. The anti-replay counter is rollback-able by Cat2 root (no monotonic
   hardware counter on this board).
4. Bypass interfaces on the protected host (WiFi, VPN) are outside the
   gateway's control; experiments disable them with auto-restore, but a real
   deployment needs physical control of the host's radios.
5. The protected host and the operator console are the same laptop in this
   evaluation; a dedicated victim machine would be cleaner.
