# Manufacturing Readiness

Package: `aetherguard-serial-deployer-ev1`

Date: 2026-05-13

Current status: `pcb-prototype-order-ready`

## Decision

This package is suitable for EV1 PCB prototype fabrication, factory quote, BOM discussion, and mechanical prototype preparation. It is not suitable for mass production, regulatory claims, or `prototype-ready` status until first-article assembly and hardware-in-loop acceptance pass.

## Current Validation

| Gate | Current result | Status |
| --- | --- | --- |
| KiCad CLI | `C:\Program Files\KiCad\9.0\bin\kicad-cli.exe` | Pass |
| KiCad ERC | 0 violations | Pass |
| KiCad PCB DRC | 0 violations | Pass |
| KiCad schematic parity | 0 issues | Pass |
| Unexpected unconnected items | 0 | Pass |
| Netlist | 55 components, 85 nets | Pass |
| BOM | 51 BOM components | Pass |
| Gerber export | Generated in `pcb/exports/gerber/` | Pass |
| Excellon drill export | Generated in `pcb/exports/drill/` | Pass |
| Position CSV export | Generated as `pcb/exports/position.csv` | Pass |
| Mechanical STL export | Existing OpenSCAD STL manifest present | Pass |

## Manufacturing Gate

Gerber, drill, position, schematic, BOM, assembly plots, ERC, DRC, and schematic-parity reports have been exported by `scripts/export-factory-package.ps1 -RequireReady`. The machine-readable readiness report is `readiness-report.json` and currently reports `pcb-prototype-order-ready`.

The PCB may be sent for 5-20 unit EV1 engineering prototype fabrication after factory review. Do not mark the hardware `prototype-ready` until first-article inspection, firmware flashing, enclosure fit, and HIL protocol acceptance pass.

## Required Before PCB Order

- Review Gerber/drill in KiCad or an external Gerber viewer before releasing files to the board house.
- Confirm exact USB-C, CP2102N, ESP32-WROOM-32E, regulator, RGB, buzzer, tactile switch, ESD, PTC, and Schottky manufacturer part numbers before assembly quote lock.
- Confirm the assembler can handle CP2102N exposed-pad QFN assembly and inspection.
- Confirm pigtail cable OD, strain relief, and enclosure exit details with the mechanical supplier.

## Required Before `prototype-ready`

- First article PCB passes incoming electrical inspection.
- One assembled unit flashes with `serial_deployer_pcb_v1`.
- OLED, buttons, RGB, buzzer, service UART, and target UART pass the factory acceptance test.
- Target Linux host completes `AG:REQ:ENV -> AG:ENV:LINUX`.
- One full deploy chain completes: `ENV -> BACKUP -> INSTALL -> REMOVE` or `ENV -> BACKUP -> INSTALL -> ROLLBACK`.
- Evidence pack for the run is exported and archived.

## Non-Goals For EV1

- No injection mold design.
- No EMC, ESD, safety, drop, or regulatory certification claim.
- No secure element or isolated I/O route from `control-board-v1`.
- No production-ready claim before first article validation.
