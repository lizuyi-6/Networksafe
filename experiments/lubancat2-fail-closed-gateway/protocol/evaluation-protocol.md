# Evaluation protocol

Machine-readable mirror: [evaluation-protocol.json](evaluation-protocol.json).
Status vocabulary: `PASSED | FAILED | PARTIAL | NOT_RUN | BLOCKED`.

## Scope

The evaluated gateway is a physically separate Cat2 using logical USB RNDIS
`usb1`/`usb2`. The protected endpoint is the single-path `victim` namespace.
Physical Ethernet and independent-host-root tests are separate future phases.

## Safety preparation

Before Cat2 network changes:

1. record exact repository/deployed digests;
2. run `ag-cat2-gateway isolate` and verify no active lease;
3. record `usb0` address/MAC/function and SSH reachability;
4. record ReactorOS service state;
5. create a root-owned backup;
6. verify a local recovery channel and arm automatic rollback;
7. never flush global firewall state, delete user NetworkManager profiles, or
   modify the management gadget function.

No physical power cycle is performed without explicit user confirmation.

## Gate protocol

Mutating commands share the stable transition lock. A release must execute:

```text
gate_close -> cancel old timer -> clear old state -> register identified timer
-> verify exact timer active -> persist prepared lease -> gate_open
-> verify gate and timer -> persist active lease
```

Every failure closes, cancels, clears, journals, and returns nonzero.
`_expire <leaseId>` ignores a stale token only when a newer complete lease is
provably valid. `reconcile` closes every incomplete or uncertain open state.
`verify` and systemd startup invoke reconciliation.

## Traffic verdicts

Every network command runs inside `ip netns exec victim` and explicitly binds
`agvictim0` where supported. Isolated tests send ARP, IPv4 ICMP/TCP/UDP/DNS,
IPv6 NDP/ICMP, broadcast, multicast, and custom EtherType frames.

An isolated `PASSED` verdict requires all of:

- application connections fail;
- upstream server receives no marker;
- Cat2 `UPLINK_IF` capture has zero victim-source packets and bytes;
- `unauthorizedConnections=0`;
- management remains available.

`ip -6 neigh show` is never an escape probe. `SERVER_IF` RX counters are not
escape evidence. Results distinguish command execution, upstream receipt, and
UPLINK observation.

Released tests require a local upstream target, a successful TCP connection,
and UPLINK marker capture. The identical probe is repeated after expiry and
must then fail with zero UPLINK packets. Internet probes are optional only.

## Authorization protocol

Algorithm: ECDSA P-256 + SHA-256. Canonical input is the project-defined UTF-8,
sorted-key, compact JSON profile, not a complete RFC 8785 implementation. The
stable counter lock covers validation through release outcome, and atomic
counter persistence with file and directory fsync occurs before release.

Local tests cover the full strict matrix and controlled persistence failures;
hardware tests verify the deployed Cat2 path and counter-consumed release
failure behavior.

## Evidence protocol

Each test captures `stateBefore` before its command and `stateAfter` after the
test. It emits matching `.txt` and `.json` files. The JSON includes exact
command, commit, interfaces, transport, times, exit code, expected/observed,
traffic counts, latencies, management status, reason code, and evidence paths.

`scripts/generate-evidence.py` derives summary and manifest. The summary is
never the sole hand-written source. `scripts/validate-results.py` checks schema,
semantics, files, hashes, and reproducible counts.

## Reboot and unavailable hardware

F06 is `PARTIAL`: the historical reboot removed temporary data topology. F07,
power cycle, physical Ethernet, VLAN, PHY flap, gigabit, independent physical
host, and performance are `NOT_RUN` under current hardware conditions. A
`NOT_RUN` result supports no conclusion.
