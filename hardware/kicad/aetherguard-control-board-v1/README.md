# AetherGuard Control Board v1 KiCad Project

This directory contains the KiCad 9 baseline for the AetherGuard single-host physical authorization board.

## Scope

- `KiCad 9` native project only.
- Full schematic split into four child sheets:
  - `sheets/power-input.kicad_sch`
  - `sheets/mcu-usb-secure.kicad_sch`
  - `sheets/ui-panel.kicad_sch`
  - `sheets/isolated-io.kicad_sch`
- PCB baseline:
  - `90 mm x 60 mm`
  - `4-layer`
  - board outline
  - mounting holes
  - antenna keepout
  - isolation boundary
  - first-pass key component placement
  - current release export package under `release/v1-proto/`

## Project Files

- `aetherguard-control-board-v1.kicad_pro`
- `aetherguard-control-board-v1.kicad_sch`
- `aetherguard-control-board-v1-flat.kicad_sch`
- `aetherguard-control-board-v1.kicad_pcb`
- `aetherguard-control-board-v1.kicad_sym`
- `aetherguard-control-board-v1.pretty/`
- `fp-lib-table`
- `sym-lib-table`

## Design Notes

- This EDA baseline consumes spare `GPIO21` for `externalPowerPresent` sensing. The repo-level `pin-map.md` documents the fixed user-facing assignments and does not yet call out this auxiliary ADC input.
- `GPIO10` is used as an ATECC wake-assist control by pulling the shared I2C data line low through a dedicated transistor, rather than by a separate secure-element pin.
- The interlock output is fail-closed in hardware by sourcing the output optocoupler LED from `5V_BUCK`. If external DC is absent and the board is running from USB only, the isolated output cannot energize.
- `normalize_child_sheets.py` is the repo-local repair tool for KiCad 9 child-sheet symbol metadata. It keeps placed symbol `pin` instances, nested cached-symbol names, and power-sheet fixups stable across reruns.
- Child sheets are intentionally normalized to rely on the project symbol libraries instead of committing unstable embedded `lib_symbols` caches. Standalone child-sheet CLI load/export works again after that change.
- `generate_release_bom.py` generates a grouped prototype BOM directly from the four child sheets.
- `generate_flat_release_schematic.py` builds `aetherguard-control-board-v1-flat.kicad_sch` as a flattened review/export view. Treat it as a convenience view rather than the primary schematic source.
- `export_proto_release.py` exports the current board state to `release/v1-proto/` with Gerber, drill, pick-and-place, and assembly PDF outputs.
- The current PCB file still represents a placement baseline rather than a fabrication-ready routed board. Current board metrics are `22 footprints / 0 tracks / 1 net / 0 zones`.

## Local Footprints

The project-local footprint library only contains the non-trivial parts that should stay pinned inside the repo:

- `AetherGuard_ESP32-S3-WROOM-1`
- `AetherGuard_USB4110_GFA`
- `AetherGuard_OLED_096_I2C_Module_1x4`
- `AetherGuard_BUZZER_SMD_9x9`
- `AetherGuard_SW_SPST_4P_4.2x3.2mm`
- `AetherGuard_LED_RGB_CC_PLCC4`

## Validation

This machine already has `KiCad 9.0.7` CLI installed at:

```powershell
C:\Program Files\KiCad\9.0\bin\kicad-cli.exe
```

Use a temporary output directory so ERC/DRC reports do not get written back into the repo:

```powershell
$cli = 'C:\Program Files\KiCad\9.0\bin\kicad-cli.exe'
$tmp = Join-Path $env:TEMP 'ag-kicad-test'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

& $cli sch export netlist hardware/kicad/aetherguard-control-board-v1/aetherguard-control-board-v1.kicad_sch `
  --output (Join-Path $tmp 'aetherguard-control-board-v1.net')

& $cli sch erc hardware/kicad/aetherguard-control-board-v1/aetherguard-control-board-v1.kicad_sch `
  --output (Join-Path $tmp 'erc.rpt')

& $cli pcb drc hardware/kicad/aetherguard-control-board-v1/aetherguard-control-board-v1.kicad_pcb `
  --output (Join-Path $tmp 'drc.rpt')
```

## Release Export

Generate the current prototype release package in-place:

```powershell
python hardware/kicad/aetherguard-control-board-v1/generate_release_bom.py
python hardware/kicad/aetherguard-control-board-v1/export_proto_release.py
```

Outputs land under:

- `hardware/kicad/aetherguard-control-board-v1/release/v1-proto/bom-proto.csv`
- `hardware/kicad/aetherguard-control-board-v1/release/v1-proto/pick-and-place.csv`
- `hardware/kicad/aetherguard-control-board-v1/release/v1-proto/gerbers/`
- `hardware/kicad/aetherguard-control-board-v1/release/v1-proto/drill/`
- `hardware/kicad/aetherguard-control-board-v1/release/v1-proto/assembly/`

## Current Limits

- Root hierarchical CLI export is still unstable under `KiCad 9.0.7`; the reliable automated BOM path is the child-sheet parser in `generate_release_bom.py`.
- The exported release package reflects the current board file exactly. It is useful for review and manufacturing-package plumbing, but it is not yet a truthful "ready to order" PCB release because the board is still unrouted and under-populated.

## Non-Goals For This Baseline

- No routed USB pair yet
- No assembly variants
- No `.kicad_prl`, `.kicad-cli`, `scratch`, or report artifacts committed
