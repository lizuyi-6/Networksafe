# Claim boundaries

These rules bind papers, presentations, result summaries, and PR descriptions.
Only a claim backed by a current `PASSED` per-test JSON and primary manifest
evidence may be used.

## Evaluated scope

- Gateway: physically separate LubanCat-2 / RK3568 SBC.
- Data plane: two logical USB RNDIS functions, Cat2 `usb1` and `usb2`.
- Gate: Linux bridge membership of `usb1`, serialized and lease-identified.
- Protected endpoint: single-path Linux network namespace `victim` with only
  `agvictim0`.
- Management: logical RNDIS function `usb0`; it shares the composite gadget,
  USB controller, and cable with the data functions.
- Authorization: ECDSA P-256 + SHA-256 and a root-owned file counter.

## Conditionally supported claims

When the corresponding current test is `PASSED`, this run can establish:

1. Traffic emitted by the single-path victim namespace does not appear on the
   Cat2 UPLINK capture while `usb1` is outside `agbr0`.
2. During a valid bounded lease, the victim reaches a local upstream target,
   establishes TCP, and produces matching UPLINK capture evidence.
3. After expiry, the identical probe fails and no matching UPLINK packet is
   observed.
4. Repeated release failure closes the gate, removes incomplete lease state,
   and leaves no active timer after reconciliation.
5. Expiry callbacks are lease-ID scoped and transitions are serialized.
6. The authorization verifier rejects the tested mutations, strict-type
   violations, replay, rollback/equal counters, expiry/future timestamps, and
   malformed signatures.
7. The counter is durably consumed before release; release failure does not
   permit the same authorization to be replayed.
8. `usb0` management and the recorded ReactorOS services remained available
   for the specifically executed checks.
9. The gateway recomputes the effective authorization lifetime from the signed
   `expiresAt` after it holds `transition.lock`, so an authorization that
   expires while waiting for the lock does not open the gate (unit-test scope;
   not yet covered by a hardware campaign bound to this code).
10. The dedicated data bridge converges to the exact closed member set
    `{UPLINK_IF}`: a rogue member or an old `SERVER_IF` is removed (or the
    gateway reports `fault`), never reported `isolated` while still forwarding
    (unit-test scope; not yet covered by a hardware campaign bound to this
    code).

## Campaign binding

The committed campaign `20260802T083236Z-dc5e1e9fe4e7f429` was captured against
the gateway build *prior* to the `expiresAt` locked re-check and the exact
closed-topology reconcile changes. It therefore establishes claims 1-8 above
for that prior build only. Claims 9-10 are currently established by
ordinary-Linux unit tests, not by a hardware campaign bound to the final code.
A new hardware campaign (fresh run ID, never overwriting the old one) is
required after explicit operator approval and redeployment before any hardware
claim is made for the new `expiresAt`/topology logic.

## Forbidden claims

- Fully compromised physical Linux host or full root on the operator laptop.
- Physical `eth0`/`eth1` inline gateway validation, dual-Ethernet data-plane
  validation, PHY/link-flap behavior, VLAN behavior, gigabit negotiation, or
  Ethernet performance.
- Hardware-enforced isolation, physical interlock, relay, air gap, Secure
  Element, hardware anti-rollback, STM32 safety controller, or relay feedback.
- Resistance to Cat2 root, Cat2 kernel compromise, gadget-controller failure,
  USB cable failure, or physical tampering.
- Production-grade, paper-ready, SLA, zero-risk, or absolute-security wording.
- Any metric or reliability conclusion from `PARTIAL`, `NOT_RUN`, or `BLOCKED`.
- A complete post-reboot fail-closed result, automatic USB restoration, or a
  zero boot window from the historical F06 observation.

## Reboot boundary

The historical reboot restored `usb0` management and ReactorOS but removed the
runtime-created `usb1`, `usb2`, and the runtime bridge. Interface absence prevented
forwarding; it did not demonstrate a restored operational gateway. Therefore:

- F06 is `PARTIAL` unless automatic topology recovery plus continuous UPLINK
  capture is rerun.
- F07 is `NOT_RUN`.
- No real power-cycle claim exists; physical power cycling requires explicit
  user confirmation.

## Trust and credential boundary

The victim namespace does not contain Cat2 credentials and cannot change the
Cat2 bridge. However, the enclosing operator laptop stores the Cat2 SSH key and
authorization private key. Root on that whole laptop can access those
credentials. Only namespace-confined processes, not whole-host root, are the
evaluated attacker.
