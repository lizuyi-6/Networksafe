# Manufacturing Readiness

Package: `aetherguard-serial-deployer-ev1`

Date: 2026-05-12

Current status: `factory-draft`

## Decision

This package is suitable for factory review, quoting, BOM discussion, and mechanical prototype preparation. It is not suitable for PCB ordering yet.

## Current Validation

| Gate | Current result | Status |
| --- | --- | --- |
| KiCad CLI | `C:\Program Files\KiCad\9.0\bin\kicad-cli.exe` | Pass |
| KiCad ERC | 0 violations | Pass |
| KiCad PCB DRC | 0 violations | Pass |
| KiCad schematic parity | 0 issues | Pass |
| Unexpected unconnected items | 118 | Blocked |
| Netlist | 55 components, 85 nets | Pass |
| BOM | 51 BOM components | Pass |
| Mechanical STL export | Generated with OpenSCAD 2021.01 | Pass after extended timeout |

## Manufacturing Gate

Gerber, drill, and position exports remain blocked until the PCB has 0 unexpected unconnected items. The review exports in `pcb/exports/` are useful for engineering review only.

Do not send the PCB to fabrication from this package yet.

## Required Before PCB Order

- Finish full EV1 routing for all power, ground, USB, UART, OLED, button, RGB, buzzer, boot/reset, and test-point nets.
- Re-run `kicad-cli sch erc`, `kicad-cli pcb drc`, and `kicad-cli pcb drc --schematic-parity`.
- Confirm DRC reports 0 violations and 0 unconnected items.
- Export Gerber, drill, position CSV, and assembly plots through `scripts/export-factory-package.ps1`.
- Review Gerber/drill in KiCad or an external Gerber viewer.
- Lock BOM critical parts and alternates before quoting.

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
