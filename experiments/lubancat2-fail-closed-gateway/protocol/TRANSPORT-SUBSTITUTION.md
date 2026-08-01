# USB RNDIS transport substitution

No Ethernet cables were available for this run. The evaluated data links were
two additional logical RNDIS functions on the real Cat2:

| Role | Cat2 function/interface | Host interface | MAC seen by host |
| --- | --- | --- | --- |
| SERVER | `rndis.usb1` / `usb1` | `agvictim0` in `victim` | `02:11:11:11:11:01` |
| UPLINK | `rndis.usb2` / `usb2` | `aguplink0` | `02:22:22:22:22:01` |
| management | existing `rndis.gs0` / `usb0` | discovered by `192.168.100.1/24` | verified at runtime |

The Cat2 gate, bridge, transition lock, lease state, PID1 timer, ECDSA P-256 +
SHA-256 verifier, journal, and ReactorOS coexist on the actual RK3568 board.
The transport does not validate the Ethernet PHYs and does not make `usb0`
physically independent: all three logical functions share the gadget,
controller, physical cable, and re-enumeration event.

The protected endpoint is a network namespace with one non-loopback interface.
This proves only a namespace-confined single-path endpoint. The enclosing
laptop owns the interfaces and credentials and is trusted.

Primary released connectivity uses a local-only host upstream at
`10.99.0.1` and a local TCP marker server bound to `aguplink0`. The host
setup does not enable global `ip_forward`, does not create a NAT rule, does
not touch nftables, and does not write persistent `.link` profiles. Internet
endpoints are never the pass/fail oracle.

## Reproduction

Committed implementation:

```text
transport/usb-rndis/
  cat2-setup.sh
  cat2-teardown.sh
  host-setup.sh
  host-teardown.sh
  verify-topology.sh
  systemd/
  README.md
```

The scripts are ownership-tracked under a lifecycle lock. Cat2 setup validates
the management function, MAC, IP, and non-membership before modification and
rebinds the original UDC on failure. Host setup discovers the two fixed-MAC
RNDIS interfaces, renames them to `agvictim0`/`aguplink0`, moves the victim
into a dedicated `victim` namespace, and arms a finite auto-rollback watchdog.
No script enables global `ip_forward`, creates a NAT rule, writes a nftables
table, installs persistent `.link` profiles, or deletes NetworkManager
profiles.

## Non-transferable results

USB results cannot be extrapolated to:

- `eth0`/`eth1` inline operation;
- 1000BASE-T speed or duplex;
- VLAN tags or Ethernet offload;
- PHY/link flap or cable pull;
- Ethernet throughput or latency;
- a separate physical host with full root.

All such items remain `NOT_RUN`.

## Reboot status

The evaluated topology is runtime-only. The systemd units are unenabled
templates. Historical F06 showed eventual `usb0` management and ReactorOS
recovery while the experiment data interfaces and bridge (historically named
`usb1`, `usb2`, and `br0`; the current dedicated bridge is `agbr0`) were
absent. Therefore F06 is `PARTIAL`, F07 is `NOT_RUN`, and no zero-boot-window
or automatic-restoration claim is permitted.
