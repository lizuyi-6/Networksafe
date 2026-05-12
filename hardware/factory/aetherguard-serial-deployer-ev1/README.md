# AetherGuard Serial Deployer EV1 Factory Package

Status: `factory-draft`

This package is for engineering prototype quote, factory review, and build preparation. It is not a ready-to-order production release until the readiness gates in `manufacturing-readiness.md` pass.

## Product Definition

- Product: AetherGuard ESP32 serial deployer physical confirmation gate.
- Build target: engineering prototype, 5-20 units.
- PCB source of truth: `../../kicad/esp32-serial-deployer-pcb/`.
- Enclosure source of truth: `../../enclosure.scad`.
- Firmware profile: `serial_deployer_pcb_v1`.
- Hardware route: `ESP32-WROOM-32E + dual CP2102N`.

## Electrical Baseline

- Rear USB-C: service/debug flashing and power input.
- Right-side USB-A pigtail: target Linux host serial deployment link.
- Service UART: ESP32 `GPIO1/GPIO3`.
- Target UART: ESP32 `GPIO16/GPIO17`.
- OLED I2C: ESP32 `GPIO21/GPIO22`.
- Buttons: ESP32 `GPIO18/GPIO19/GPIO23`.
- RGB LED: ESP32 `GPIO25/GPIO26/GPIO27`.
- Buzzer: ESP32 `GPIO14`, PCB profile active level `HIGH`.

## Mechanical Baseline

- Enclosure class: low-profile black engineering prototype box.
- Nominal outside dimensions: `90 x 58 x 16.8 mm`.
- Top features: OLED window and RGB indicator window.
- Front features: three operator buttons and buzzer sound holes.
- Rear feature: USB-C opening.
- Right rear lower feature: short pigtail cable exit.
- Prototype material: black PETG/PLA+ for 3D print, or black ABS for CNC.

## Suggested Prototype Build

- Quantity: 5-20 units.
- PCB stack-up: 4-layer FR-4, 1.6 mm.
- Copper: 1 oz outer layers unless assembler proposes otherwise.
- Finish: ENIG.
- Solder mask: black.
- Silkscreen: white.
- Assembly: SMT first, then hand-fit OLED module, pigtail, case hardware, lens, and button caps.

## Package Contents

- `pcb/`: board manufacturing notes, BOM draft, pin map, and PCB export area.
- `mechanical/`: enclosure export script, generated STL outputs, and fabrication notes.
- `assembly/`: prototype assembly SOP.
- `test/`: incoming inspection and functional acceptance SOP.
- `firmware/`: flashing and firmware profile instructions.
- `diagrams/`: factory-facing block and layout diagrams.
- `scripts/`: top-level export/readiness automation.
- `manufacturing-readiness.md`: current gate status and blockers.
- `package-manifest.json`: machine-readable package metadata.

## Factory Handling Rule

Do not fabricate the PCB from this package unless `scripts/export-factory-package.ps1` has produced Gerber, drill, and position outputs and `manufacturing-readiness.md` has been updated from `factory-draft` to a passing engineering release state. The current package intentionally does not include generated Gerber/drill data because the active KiCad PCB still has 118 unconnected items, even though ERC, DRC violations, and schematic parity are clean.
