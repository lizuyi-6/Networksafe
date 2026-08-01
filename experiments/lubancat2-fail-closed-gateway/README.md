# AetherGuard Cat2 fail-closed gateway prototype

This experiment evaluates a **physically separate SBC gateway prototype using
two logical USB RNDIS data interfaces**. The protected endpoint is a
**single-path Linux network namespace** named `victim`, not a separate physical
host. Read [CLAIM-BOUNDARIES.md](CLAIM-BOUNDARIES.md) before citing results.

## Evaluated topology

```text
victim netns/agvictim0 (10.99.0.2)
  <-> Cat2 usb1 (SERVER, normally not in agbr0)
  <-> Cat2 agbr0 membership gate
  <-> Cat2 usb2 (UPLINK, member of agbr0)
  <-> host aguplink0 (10.99.0.1, local upstream target)

operator host management interface
  <-> Cat2 usb0 (192.168.100.2, never in agbr0)
```

The Cat2 was physically separate from the protected endpoint, while the
evaluated data plane used two logical USB RNDIS interfaces. The board's two
Ethernet PHYs were present but not exercised. The operator laptop also hosted
the victim namespace and signing/SSH credentials; therefore this run does not
model root compromise of the whole laptop.

## Gate and lease transaction

`SERVER_IF` bridge membership is the kernel gate:

| State | `SERVER_IF` membership | Lease requirement |
| --- | --- | --- |
| `isolated` | not enslaved | no active lease |
| `released` | enslaved to configured `agbr0` | one exact active timer plus matching active lease record |
| `fault` | any uncertain open state | `reconcile` removes `SERVER_IF` from its master |

`release` takes `/run/aetherguard-cat2/transition.lock`, closes the gate,
cancels old timers, clears old state, registers and verifies a tokenized PID1
timer, atomically writes a `prepared` lease, opens and verifies the gate, then
commits the lease as `active`. Every failure path closes the gate, cancels the
candidate timer, clears incomplete state, journals a reason, and returns
nonzero. Old expiry callbacks carry a lease ID and cannot close a newer valid
lease. `isolate`, `release`, `_expire`, and `reconcile` use the same lock.

The vendor kernel does not provide the planned nftables bridge timed-set path;
`cat2/nftables/aetherguard-cat2.nft` remains reference-only. PID1 starts a new
userspace expiry process; no claim is made that this is a kernel packet-filter
timer.

## Authorization

Release documents use **ECDSA P-256 + SHA-256** over project-defined canonical
JSON: UTF-8, sorted object keys, compact separators, and no insignificant
whitespace. This is not represented as complete RFC 8785.

The verifier takes a stable `authorizer-counter.lock`, validates exact fields
and strict integer types, atomically replaces and fsyncs the counter file,
fsyncs its directory, and only then calls the gateway. A failed release burns
the counter and forces isolation; it never rolls the counter back. This file
counter does not resist Cat2 root or storage rollback.

## Installation on Cat2

Review machine-specific values before installation. Never overwrite a working
configuration without a backup and local recovery path.

```bash
install -m755 cat2/scripts/ag-cat2-gateway /usr/local/sbin/ag-cat2-gateway
install -m755 protocol/authorization/ag-auth-verify.py /usr/local/sbin/ag-auth-verify.py
install -m644 protocol/authorization/ag_auth_common.py /usr/local/sbin/ag_auth_common.py
install -m644 protocol/authorization/keys/authorizer-public.pem \
  /etc/aetherguard-cat2/authorizer-public.pem
test -e /etc/aetherguard-cat2.conf || \
  install -m600 cat2/config/aetherguard-cat2.conf.example /etc/aetherguard-cat2.conf
install -m644 cat2/systemd/aetherguard-cat2-gateway.service \
  /etc/systemd/system/aetherguard-cat2-gateway.service
systemctl daemon-reload
systemctl enable --now aetherguard-cat2-gateway.service
```

Do not install the private key on Cat2 or commit it. The example configuration
keeps `AG_ALLOW_TEST_FAILPOINTS=0`. Hardware fault injection uses a separate,
root-only temporary test configuration and removes it after the campaign.

## Reproducible USB transport

See [transport/usb-rndis/README.md](transport/usb-rndis/README.md). Setup and
teardown are serialized, intent-journaled, preserve `usb0`, refuse to adopt
pre-existing object names, avoid host forwarding/NAT/firewall changes, and arm
automatic rollback. No USB persistence units are shipped.

Consequently, reboot persistence is **not established**. The earlier F06
observation lost `usb1`, `usb2`, and the runtime bridge; `state=isolated` in
that condition means the temporary data topology was absent. It does not prove automatic
topology restoration, a zero forwarding boot window, or reboot-during-release
behavior. F06 remains `PARTIAL`; F07 remains `NOT_RUN` unless the complete boot
protocol is rerun.

## Tests and evidence

All shell campaigns use `set -Eeuo pipefail`, explicit assertions, cleanup
traps, victim-namespace probes, and real process exit codes. Each test writes:

```text
results/raw/<run-id>/<test-id>.txt
results/raw/<run-id>/<test-id>.result.json
```

Run the aggregate matrix under one campaign ID, then generate and validate only
from committed `*.result.json` files:

```bash
scripts/run-hardware-campaign.sh
# or, for an already completed campaign:
python3 scripts/generate-evidence.py --run-id <run-id>
python3 scripts/validate-results.py --run-id <run-id>
```

The validator checks campaign completeness, duplicate IDs, schema, exact
victim scope, cleanup success, category-specific traffic semantics, evidence
existence, manifest digests, SHA256SUMS, and a fully reproduced summary.

## Status vocabulary

Every result uses exactly one of:

`PASSED | FAILED | PARTIAL | NOT_RUN | BLOCKED`

`results/normalized/summary.json` is generated and is the machine-readable
result index. A `NOT_RUN` item supports no positive conclusion.
