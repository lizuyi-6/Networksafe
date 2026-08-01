# AetherGuard Cat2 External Gateway Prototype

**Externalized Fail-Closed Network Containment for Fully Compromised Hosts**

This directory contains a reproducible evaluation of a fail-closed network
gateway built from a stock **LubanCat-2 (RK3568) SBC** sitting *outside* the
protected Linux host. Even with full root on the protected host, an attacker
cannot lift the isolation, because the gate lives on a different machine they
have no credentials for.

> Read [CLAIM-BOUNDARIES.md](CLAIM-BOUNDARIES.md) before citing anything.
> This is a software-gated prototype. It is **not** a physical relay, has
> **no** Secure Element, and does **not** resist compromise of the Cat2 itself.

## Real topology (as tested)

```
protected host (HP laptop, Ubuntu 26.04)          upstream (home router LAN)
  eno1                                             192.168.3.1
     | ethernet                                        |
     |                                                 |
  +--+---------------------- Cat2 (LubanCat-2) --------+---+
  |  SERVER_IF (ethX)            UPLINK_IF (ethY)          |
  |        \-------- Linux bridge br0 (gated) -------/     |
  |                                                          |
  |  usb0 192.168.100.2  <-- out-of-band management (SSH)    |
  +----------------------------------------------------------+
            ^
            | USB cable (RNDIS)
   operator console (same laptop, board0 192.168.100.1)
```

Management reaches the Cat2 over a dedicated USB RNDIS link that never
touches the bridge, so the gate can never lock the operator out.

## Gate design (and why it is not nftables on this kernel)

The fail-closed gate is the **kernel bridge membership** of `SERVER_IF`:

| state    | SERVER_IF in br0? | effect |
|----------|-------------------|--------|
| isolated | no (nomaster)     | kernel has no path to forward the protected host's frames |
| released | yes (enslaved)    | normal L2 bridging, guarded by a lease |

Bridge *port state* was rejected during bring-up: this kernel refuses
`state forwarding` on carrier-less ports (ENETDOWN, verified) and resets the
port to forwarding on carrier regain, which would silently re-open the gate
after a cable re-plug. Membership is carrier-independent and idempotent.

Timed release uses a **PID1-registered systemd transient timer** created
*before* the gate opens. If every userspace helper dies (`kill -9`), PID1
still fires the timer and the port is un-enslaved (isolated). Reboot
clears all transient timers and the boot unit keeps the port out of the
bridge by default.

The canonical nftables timed-set design is kept in
[cat2/nftables/aetherguard-cat2.nft](cat2/nftables/aetherguard-cat2.nft) but
is **not deployed**: this vendor kernel 4.19.232 lacks
`CONFIG_NF_TABLES_BRIDGE`, `CONFIG_NF_TABLES_SET`, `CONFIG_NET_CLS_BPF` and
`CONFIG_BRIDGE_EBTABLES` (evidence: [inventory/cat2-system.json](inventory/cat2-system.json)).
No kernel-timer packet gate exists on this board; the PID1 lease is the
honest substitute and its limits are documented in the claim boundaries.

## Quick start (operator)

```bash
# 0) one-time on the Cat2 (as root): install config + scripts + service
install -m755 cat2/scripts/ag-cat2-gateway /usr/local/sbin/
install -m755 cat2/scripts/ag-cat2-backup.sh /usr/local/sbin/
install -m755 cat2/rollback/aetherguard-network-rollback.sh /root/
install -m644 cat2/config/aetherguard-cat2.conf /etc/   # fill in real ifnames
install -m644 cat2/systemd/aetherguard-cat2-gateway.service /etc/systemd/system/

# 1) backup + auto-rollback BEFORE any change
ag-cat2-backup.sh
systemd-run --unit=aetherguard-net-rollback --on-active=5m /root/aetherguard-network-rollback.sh

# 2) build the bridge (see protocol/evaluation-protocol.md phase 4)
# 3) gate operations
ag-cat2-gateway status      # JSON: state, interfaces, expiry, digests
ag-cat2-gateway isolate     # idempotent: close now
ag-cat2-gateway release 60  # open for 60s, PID1 timer closes it
ag-cat2-gateway verify      # sanity checks, nonzero on fault
ag-cat2-gateway diagnostics # full dump

# 4) full uninstall / rollback
/root/aetherguard-network-rollback.sh
```

## Test campaigns

| campaign | script | needs cables? |
|----------|--------|---------------|
| A bridge baseline | tests/connectivity/test-a-bridge-baseline.sh | yes |
| B isolation       | tests/isolation/test-b-isolation.sh          | yes |
| C timed release   | tests/authorization/test-c-timed-release.sh  | yes |
| D repeated release| tests/authorization/test-d-repeated-release.sh| yes |
| E authorization   | tests/authorization/test-e-authorization.sh  | no (crypto only) |
| F fault matrix    | tests/fault-injection/fault-matrix.sh        | partially |
| G performance     | tests/performance/perf-plan.sh               | 3rd machine |

Every test writes raw logs + schema-conformant JSON under `results/raw/`;
`results/SHA256SUMS` and `results/manifest.json` make them tamper-evident.

## Authorization prototype (phase 10)

ECDSA P-256 + SHA-256 signed, canonical-JSON release authorizations with a
monotonic counter. Signer lives on the operator machine (private key, 0600,
gitignored); verifier on the Cat2 rejects tampering, replay, counter
rollback, expiry, future issue dates and over-limit durations. **The counter
file is ordinary root-owned state: it resists the untrusted protected host,
not a compromised Cat2 root.** See [protocol/authorization/](protocol/authorization/).

## Verified / not verified

See [results/normalized/summary.json](results/normalized/summary.json) for the
machine-readable truth table and CLAIM-BOUNDARIES.md for the wording rules.
