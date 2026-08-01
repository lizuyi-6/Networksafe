# Reproducible USB RNDIS transport

This directory recreates the evaluated data plane without treating it as a
physical Ethernet result:

```text
victim netns/agvictim0
  <-> Cat2 rndis.usb1/usb1 (SERVER)
  <-> agbr0 membership gate
  <-> Cat2 rndis.usb2/usb2 (UPLINK)
  <-> host aguplink0/10.99.0.1
```

The Cat2 is a physically separate SBC. Both evaluated data interfaces are
logical RNDIS functions on the composite USB gadget. `eth0` and `eth1` are not
used by these scripts. `usb0` is management and is never added to `agbr0`.

## Safety properties

- Every script uses `set -Eeuo pipefail`.
- Cat2 setup verifies the `rndis.gs0` function, `usb0` MAC, management IP, and
  absence of bridge membership before changing the gadget.
- Setup and teardown share a root-only lifecycle lock and fsynced intent state.
- Setup refuses to adopt existing function, link, interface, namespace, or
  `agbr0` names. Active-state retries verify the complete topology.
- Gadget failure paths rebind the original UDC. They never edit the management
  function or its configuration link.
- Host setup requires `AG_EXPERIMENT_MODE=1` and pristine fixed-MAC RNDIS
  interfaces. It creates only a local upstream address on `aguplink0`.
- The transport does not enable global forwarding, NAT, or alter nftables,
  route-policy, VPN, or persistent NetworkManager profiles.
- Setup arms transient automatic teardown timers. Keep a local Cat2 serial
  console or other recovery path before running the Cat2 script because gadget
  re-enumeration temporarily interrupts `usb0`.

## Manual runtime-only setup

Do not run setup until the current Cat2 gate is isolated, a Cat2 backup exists,
`usb0` SSH works, and ReactorOS service state has been recorded.

On the Cat2 local console:

```bash
sudo AG_AUTO_ROLLBACK_MINUTES=15 ./cat2-setup.sh
```

On the host:

```bash
sudo AG_EXPERIMENT_MODE=1 AG_AUTO_ROLLBACK_MINUTES=30 ./host-setup.sh
sudo ./verify-topology.sh
```

Teardown in the reverse order:

```bash
sudo ./host-teardown.sh
# On the Cat2 local console:
sudo ./cat2-teardown.sh
```

`verify-topology.sh` writes only JSON to stdout and exits nonzero when topology
or management invariants fail.

## Persistence status

No persistence units are shipped: a finite watchdog and `RemainAfterExit=yes`
would let systemd report an active topology after automatic teardown. The
evaluated topology is runtime-only, so F06/F07 stay `PARTIAL`/`NOT_RUN`.
Persistence requires a separate reviewed design, local recovery console, boot
packet capture, ReactorOS checks, and explicit operator approval.
