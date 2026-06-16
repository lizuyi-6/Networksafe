# Artifact Archive Index

Date: 2026-05-13 (initial cleanup) · updated 2026-06-13 (full ESP32 hardware retirement) · updated 2026-06-15 (ESP32-era KiCad and enclosure designs archived)

External archive root: `X:\repos\Networksafe-archive\20260513-pre-cleanup`

This cleanup moves generated artifacts and hardware experiment intermediates out of the production repository while preserving them locally for inspection. The archive is not part of Git; use release artifacts, object storage, or a separate asset repository if these files need to be shared.

## Active Hardware Baseline (post-2026-06-11)

The **AetherGuard Root-Resistant Gateway Appliance** is a four-module integration of commercial off-the-shelf components (M1 Protectli gateway + M2 NUCLEO-H563ZI controller + M3 OPTIGA Trust M SE + M4 DIN-rail relay + interlock). No custom PCB design is required for the Phase 0-4 prototype. Product framing: `docs/root-resistant-gateway-prd.md` v0.3 (2026-06-12).

The legacy ESP32 hardware family and **all ESP32-era KiCad/OpenSCAD designs** have been **fully retired and archived** to `X:\repos\Networksafe-archive\20260513-pre-cleanup`. This includes:

- ESP32-WROOM-32 serial-deployer dongle firmware and bundles.
- ESP32-S3 Control Board v1 / v2 KiCad trees, gerbers, drill, pick-and-place, and ERC reports.
- `esp32-serial-deployer-pcb` KiCad project, scratch routing experiments, probe reports, and Freerouting exchange files.
- The `esp32/` firmware source directory (formerly in-repo) and the legacy `AG:REQ:*` USB-TTL serial protocol.
- Any `aetherguard-gate` physical-confirmation board intermediates.
- **`hardware/kicad/aetherguard-network-isolation-gateway-v1/`** — KiCad design from ESP32 era (predates the 2026-06-11 Protectli+NUCLEO+relay module decision), now archived to `hardware-legacy-esp32-era/kicad/`.
- **`hardware/*.scad`, `*.stl`** — OpenSCAD enclosure designs (chassis, bridge, raceway_lid, clip), archived to `hardware-legacy-esp32-era/`.
- **`hardware/aetherguard-network-isolation-gateway-v1/README.md`** and associated specs, archived.

The active controller protocol is newline-delimited JSON (see `docs/root-resistant-gateway-prd.md` §4.2). Backend route names containing `esp32` (e.g. `/api/deployments/esp32-status`) are retained only for backward-compat with historically-registered legacy devices; new flows must target the Gateway Appliance.

## Archived Categories

| Original path | Archive path | Contents | Reason |
| --- | --- | --- | --- |
| `output/` | `X:\repos\Networksafe-archive\20260513-pre-cleanup\output\` | Rendered PDFs, screenshots, and local QA output | Generated build/QA artifacts |
| `outputs/` | `X:\repos\Networksafe-archive\20260513-pre-cleanup\outputs\` | Manual presentation QA outputs | Generated review artifacts |
| `docs/generated/` | `X:\repos\Networksafe-archive\20260513-pre-cleanup\docs\generated\` | Generated PPTX decks | Binary generated documents |
| `hardware/factory/aetherguard-serial-deployer-ev1-pcb-prototype-order-ready/` | `X:\repos\Networksafe-archive\20260513-pre-cleanup\hardware\factory\aetherguard-serial-deployer-ev1-pcb-prototype-order-ready\` | Prototype order package snapshot | Board-house output snapshot |
| `hardware/factory/aetherguard-serial-deployer-ev1/pcb/exports/drill/` | `X:\repos\Networksafe-archive\20260513-pre-cleanup\hardware\factory\aetherguard-serial-deployer-ev1\pcb\exports\drill\` | Drill manufacturing export | Generated PCB output |
| `hardware/factory/aetherguard-serial-deployer-ev1/pcb/exports/gerber/` | `X:\repos\Networksafe-archive\20260513-pre-cleanup\hardware\factory\aetherguard-serial-deployer-ev1\pcb\exports\gerber\` | Gerber manufacturing export | Generated PCB output |
| `hardware/factory/aetherguard-serial-deployer-ev1/pcb/exports/position.csv` | `X:\repos\Networksafe-archive\20260513-pre-cleanup\hardware\factory\aetherguard-serial-deployer-ev1\pcb\exports\position.csv` | Pick-and-place export | Generated PCB output |
| `hardware/kicad/esp32-serial-deployer-pcb/scratch/` | `X:\repos\Networksafe-archive\20260513-pre-cleanup\hardware\kicad\esp32-serial-deployer-pcb\scratch\` | KiCad routing experiments, local probes, temporary renderings | Experiment workspace, not production source |
| `hardware/kicad/esp32-serial-deployer-pcb/reports/probe-*` and `probe*.json` | `X:\repos\Networksafe-archive\20260513-pre-cleanup\hardware\kicad\esp32-serial-deployer-pcb\reports\` | Probe reports | Intermediate routing diagnostics |
| `hardware/kicad/esp32-serial-deployer-pcb/reports/current-ev1.dsn` and `.ses` | `X:\repos\Networksafe-archive\20260513-pre-cleanup\hardware\kicad\esp32-serial-deployer-pcb\reports\` | Freerouting exchange files | Generated router exchange artifacts |
| `hardware/kicad/esp32-serial-deployer-pcb/reports/autoroute-main.dsn` and `.ses` | `X:\repos\Networksafe-archive\20260513-pre-cleanup\hardware\kicad\esp32-serial-deployer-pcb\reports\` | Freerouting exchange files | Generated router exchange artifacts |
| `hardware/kicad/esp32-serial-deployer-pcb/reports/ev1-routing-all.svg` | `X:\repos\Networksafe-archive\20260513-pre-cleanup\hardware\kicad\esp32-serial-deployer-pcb\reports\ev1-routing-all.svg` | Temporary routing visualization | Generated visual diagnostic |
| `esp32-serial-deployer-pcb-erc.rpt` | `X:\repos\Networksafe-archive\20260513-pre-cleanup\esp32-serial-deployer-pcb-erc.rpt` | Root-level KiCad ERC report | Generated diagnostic misplaced at repository root |
| KiCad lock files | Preserved under matching archive path | Local editor locks | Machine-local transient files |
| `hardware/` (entire directory) | `X:\repos\Networksafe-archive\20260513-pre-cleanup\hardware-legacy-esp32-era\` | All ESP32-era hardware designs: KiCad gateway-v1 PCB (49 files, 18453 lines), OpenSCAD enclosures, bring-up/, factory/, renders/ | **2026-06-15:** Replaced by COTS module integration (Protectli+NUCLEO+relay); no custom PCB for Phase 0-4 |

The full file-level archive manifest is stored at `X:\repos\Networksafe-archive\20260513-pre-cleanup\archive-manifest.txt`.

## Kept In Repository

Production source, tests, documentation, firmware source, KiCad source, hardware factory source files, validation reports that document the current production baseline, and small scripts remain in the repository. Future generated artifacts should stay ignored unless they are explicitly promoted to source or release evidence.
