# AetherGuard Serial Deployer EV1 Factory Package

Status: `pcb-prototype-order-ready`

This package is ready for EV1 PCB prototype fabrication and engineering prototype quote. It is not a mass-production release and it is not `prototype-ready` until first-article assembly and hardware-in-loop acceptance pass.

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
- `pcb-routing-blockers.md`: closed PCB routing summary and traceability notes.
- `package-manifest.json`: machine-readable package metadata.

## Factory Handling Rule

PCB fabrication may use the generated files in `pcb/exports/gerber/`, `pcb/exports/drill/`, and `pcb/exports/position.csv` after the factory reviews `readiness-report.json` and `manufacturing-readiness.md`. Do not treat this as a production release: first-article electrical inspection, enclosure fit, firmware flashing, and HIL protocol acceptance are still required before marking the EV1 hardware `prototype-ready`.
