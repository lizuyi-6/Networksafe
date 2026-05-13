# EV1 PCB Routing Closure

Package: `aetherguard-serial-deployer-ev1`

Status: `pcb-prototype-order-ready`

Date: 2026-05-13

## Current PCB Gate

The active KiCad source is ready for EV1 PCB prototype fabrication. The PCB is not mass-production ready and still requires first-article assembly and HIL acceptance before the hardware can be marked `prototype-ready`.

| Check | Result |
| --- | --- |
| KiCad ERC | 0 violations |
| KiCad PCB DRC violations | 0 violations |
| KiCad schematic parity | 0 issues |
| Unexpected unconnected items | 0 |
| Manufacturing Gerber/drill/position export | Generated |

## Routing Closure Notes

- The board uses the validated route set captured in `hardware/kicad/esp32-serial-deployer-pcb/tools/ev1_route_overlay.json`.
- The route overlay contains 298 segments and 103 vias and is replayed by `tools/generate_ev1_pcb.py`.
- The final cleanup rerouted `USB_CC1` away from the USB differential via/USB-C fuse clearance pinch point.
- A single GND stitching via at `(45.457, 15.671)` ties the remaining top-layer GND island back to the ground plane without introducing DRC violations.

## Validation Evidence

- Main DRC report: `hardware/kicad/esp32-serial-deployer-pcb/reports/ev1-verify-drc.json`.
- Main schematic parity report: `hardware/kicad/esp32-serial-deployer-pcb/reports/ev1-verify-parity.json`.
- Factory DRC report: `pcb/exports/reports/drc.json`.
- Factory schematic parity report: `pcb/exports/reports/schematic-parity.json`.
- Machine-readable readiness report: `readiness-report.json`.

## Remaining Non-PCB Gates

- Factory must review Gerber/drill in KiCad or an external viewer before board-house release.
- BOM critical part manufacturer numbers and alternates must be locked before assembly quote.
- First article must pass incoming electrical inspection, firmware flashing, enclosure fit, and `AG:REQ:ENV -> AG:ENV:LINUX` protocol smoke test.
- Full HIL acceptance must complete `ENV -> BACKUP -> INSTALL -> REMOVE` or `ENV -> BACKUP -> INSTALL -> ROLLBACK` before EV1 can be called `prototype-ready`.
