# Transport Substitution (why no ethernet cables, and what it means)

The user's environment had **no ethernet cables** available, so the canonical
topology (protected host --eth-- Cat2 SERVER port, Cat2 UPLINK port --eth--
router) could not be wired. To still produce hardware-real evidence on the
actual Cat2, the two gateway links are realized as **two extra USB RNDIS
gadget functions** on the Cat2's existing USB OTG port:

- `rndis.usb1` (host MAC `02:11:11:11:11:01`) = SERVER link  → laptop `agvictim0`
- `rndis.usb2` (host MAC `02:22:22:22:22:01`) = UPLINK link  → laptop `aguplink0`
- `rndis.gs0`  (host MAC `fe:12:29:d4:4c:e2`) = management  → laptop `board0` (unchanged)

The Cat2 kernel builds the RNDIS function (`CONFIG_USB_F_RNDIS=y`,
`CONFIG_USB_CONFIGFS_RNDIS=y`); ECM is not built, hence RNDIS. The laptop
distinguishes the three by MAC via systemd `.link` rules
(`10-board-rndis.link`, `11-ag-victim.link`, `12-ag-uplink.link`).

## What is still hardware-real on the Cat2

- The bridge `br0`, its two member ports, the **gate primitive (bridge
  membership of `usb1`)**, the PID1 lease timer, the `ag-cat2-gateway`
  state machine, Ed25519…/ECDSA authorization, journal logging, reboot
  behaviour — all run on the actual LubanCat-2 (RK3568, kernel 4.19.232).
- The protected host is a network namespace `victim` on the laptop that
  contains **only** `agvictim0` — it has no WiFi, no VPN, no other NIC, so
  the Cat2 is genuinely its only path out. This is at least as strong a
  no-bypass property as a cabled laptop.
- Upstream is the real home router + internet, reached through the laptop's
  NAT on `aguplink0`. `ping 192.168.3.1`, `ping 223.5.5.5`, and
  `tcp 1.1.1.1:443` from inside `victim` all succeed while the gate is
  released, and all fail while isolated (measured).

## What is NOT validated by this run (Ethernet-transport-specific)

- 1000 Mb/s full-duplex negotiation, PHY-level link flap / driver reset
  behaviour, VLAN-tagged frame forwarding, hardware offload differences.
- These require cabling eth0/eth1 to real Ethernet peers and are marked
  **NOT_RUN** in the results. The scripts are transport-agnostic and will
  run unchanged once cables are available (just set SERVER_IF/UPLINK_IF to
  eth0/eth1 and drop the gadget/NAT scaffolding).

## Reproducing the USB-net topology

See `protected-host/scripts/` (TODO: committed helpers) and the operator
runbook in `README.md`. Teardown removes the two gadget functions, the
netns, the NAT table, and the `.link` rules; the management RNDIS link and
all pre-existing configuration are untouched.
