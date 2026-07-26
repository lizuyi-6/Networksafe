# AetherGuard Control Board v1 Proto Release Note

## Release Package

The current KiCad export package lives under:

- `hardware/kicad/aetherguard-control-board-v1/release/v1-proto/`

It contains:

- `bom-proto.csv`
- `pick-and-place.csv`
- `gerbers/`
- `drill/`
- `assembly/top-assembly.pdf`
- `assembly/bottom-assembly.pdf`

## Fixed Baseline

- Board size: `90 mm x 60 mm`
- Stackup target: `4-layer`
- Interfaces: `USB-C Host`, `12/24V In`, `Interlock Out`, `Feedback In`, `Service UART`
- Core silicon: `ESP32-S3-WROOM-1-N8R2`, `ATECC608C-SSHDA-T`

## Current Maturity

This package is useful for release plumbing, file-format verification, and review of the current PCB file.

It is **not** yet a truthful "ready to order" proto board release because the KiCad PCB file is still a placement baseline rather than a fully routed, fully populated production-intent layout.

Current board metrics at export time:

- `22 footprints`
- `0 tracks`
- `1 net`
- `0 zones`

## Export Entry Points

Use:

```powershell
python hardware/kicad/aetherguard-control-board-v1/generate_release_bom.py
python hardware/kicad/aetherguard-control-board-v1/export_proto_release.py
```

These commands regenerate the current package without writing transient ERC/DRC reports into the repo.
