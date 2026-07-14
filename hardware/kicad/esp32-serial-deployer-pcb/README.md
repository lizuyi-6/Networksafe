# ESP32 Serial Deployer PCB v1

This directory contains the first single-board KiCad project for the ESP32 serial deployer.

## Scope

- Board size: `100 mm x 72 mm`
- Stack-up: `4-layer`, `1.6 mm FR-4`
- Mounting: `4 x M2` holes, `3.5 mm` inset from each edge
- Architecture:
  - `ESP32-WROOM-32E`
  - `CP2102N` service/debug bridge on rear `USB-C`
  - `CP2102N` host bridge on right-side `USB-A` pigtail pads
  - Dual `VBUS` inputs ORed into `5V_SYS`
  - `AP2112K-3.3` main regulator
  - On-board OLED header, three UI buttons, RGB LED, buzzer driver, BOOT/RESET, test points

## Files

- `esp32-serial-deployer-pcb.kicad_pro`
- `esp32-serial-deployer-pcb.kicad_sch`
- `esp32-serial-deployer-pcb.kicad_pcb`
- `esp32-serial-deployer-pcb.kicad_sym`
- `esp32-serial-deployer-pcb.pretty/`
- `fp-lib-table`
- `sym-lib-table`
- `reports/`
- `tools/generate_pcb_v1.py`
- `tools/repair_pcb_connectivity.py`

## Source Of Truth

- The KiCad project files in this directory are the active design source.
- `tools/generate_pcb_v1.py` is now a reference/base-board generator used to keep symbol, footprint, and net assignments synchronized.
- Recovery experiments live in `scratch/` and are not the fabrication source of truth.

## Interface Baseline

- OLED: `GPIO21` / `GPIO22`
- Buttons: `GPIO18` / `GPIO19` / `GPIO23`
- RGB: `GPIO25` / `GPIO26` / `GPIO27`
- Buzzer driver: `GPIO14`
- Host deployment UART: `GPIO16` / `GPIO17`
- Service/debug UART: `GPIO1` / `GPIO3`

## Power Strategy

- `USB-C VBUS -> PTC fuse -> Schottky OR -> 5V_SYS`
- `Host pigtail VBUS -> PTC fuse -> Schottky OR -> 5V_SYS`
- `5V_SYS -> AP2112K-3.3 -> 3V3`
- Both `CP2102N` bridges are modeled as `3V3`-powered devices with their respective USB `VBUS` pins sensed through divider networks.

## USB Split

- Rear `USB-C`: flashing, debug console, service power input
- Right-side `USB-A` pigtail: target-host deployment bridge only
- The two USB data paths are electrically separate

## BOM Direction

Use JLC/LCSC-friendly packages wherever possible:

- QFN-24 `CP2102N`
- `ESP32-WROOM-32E`
- `AP2112K-3.3` in `SOT-23-5`
- `0603` passives
- `SOD-123` Schottky diodes
- Small `SOT-23` NPNs for auto-download and buzzer drive

## KiCad 9 Status

The project now loads in `KiCad 9.0.7` CLI:

- `kicad-cli sch export netlist` succeeds
- `kicad-cli sch erc` runs and writes `reports/erc.rpt`
- `kicad-cli pcb drc` runs and writes `reports/drc.rpt`
- `kicad-cli pcb drc --schematic-parity` runs and writes `reports/parity.rpt`

Current validation is not yet clean and the board is not fabrication-ready:

- ERC: currently high-noise and still requires schematic cleanup
- PCB DRC: stable board baseline is down to `3` DRC violations plus `39` unconnected items
- The remaining PCB issues are concentrated in explicit ground/power closure, not broad project load failures
- Schematic parity still needs cleanup after the exposed-pad and ground-net corrections

This means the project is a KiCad 9 native, editable recovery baseline, but it is not ready for fabrication yet. The remaining work is board-quality cleanup:

- finish the remaining ground and power routing closure
- clean up ERC and schematic-parity drift introduced during recovery
- verify footprint drill sizes and custom footprints against final purchased parts
- re-run DRC/DRC parity after the next routing pass

## Firmware Profile

Use the new PlatformIO environment `serial_deployer_pcb_v1` for the PCB variant. It keeps the same GPIO map and switches `BUZZER_ACTIVE_LEVEL` to `HIGH`.
