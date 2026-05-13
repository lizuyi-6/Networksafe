# AetherGuard Network Isolation Gateway v1A Prototype Release

This release package is a board-fab engineering review prototype for the root-resistant final defense gateway.

## Scope
- `SERVER` and `LAN/WAN` are the protected 1GbE RJ45 data bridge ports.
- `MGMT` is an independent 10/100 W5500 management port and must not forward protected server traffic.
- Default/failure state is `isolated`: KSZ9563R reset or power-gate disables SERVER to LAN/WAN forwarding.
- `release_temporary` may only be armed by firmware after signed local policy, ATECC608C identity, firmware digest, management independence and link-state checks pass.

## Deliverables
- KiCad 8-compatible project: `aetherguard-network-isolation-gateway-v1.kicad_pro`
- PCB: board outline, three RJ45 ports, ESP32-S3-WROOM-1, ATECC608C, KSZ9563R, W5500, rails, UI, test points and fab notes.
- Assembly: `bom-proto.csv`, `position-proto.csv`
- Gerbers/drill are exported into `gerbers/` and `drill/` when KiCad CLI export succeeds.

## Known Engineering Review Items
- Verify exact KSZ9563R package variant, strap pins, power rails and reset timing against the selected ordering code.
- Replace review-class MagJack/connector choices with purchasing-approved parts before production.
- Complete controlled-impedance stackup, length matching and SI review for all 1000BASE-T MDI pairs.
- Validate ESD, common-mode choke and Bob Smith termination values from vendor reference designs.
- Validate ESP32-S3 secure boot, flash encryption and ATECC608C provisioning flow in firmware before claiming production root resistance.

## API/Status Alignment
The board labels and firmware contract align with:
`gatewayId`, `policyDigest`, `firmwareDigest`, `bridgeState`, `serverPortLink`, `lanPortLink`, `mgmtPath`, `lastAttestationAt`, `isolationReason`, `degradedReasons`.

## KiCad CLI Validation
- ERC: none; issue classes: none.
- DRC: none; issue classes: none; unconnected_items=0.
- Gerber, drill and position exports completed; see `erc.log`, `drc.log`, `gerber-export.log`, `drill-export.log`, and `position-export.log`.

No ERC or DRC warnings remain in the exported prototype board.
