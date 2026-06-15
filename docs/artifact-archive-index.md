# Artifact Archive Index

Date: 2026-05-13 (initial cleanup) · updated 2026-06-13 (full ESP32 hardware retirement)

External archive root: `X:\repos\Networksafe-archive\20260513-pre-cleanup`

This cleanup moves generated artifacts and hardware experiment intermediates out of the production repository while preserving them locally for inspection. The archive is not part of Git; use release artifacts, object storage, or a separate asset repository if these files need to be shared.

## Active Hardware Baseline (post-2026-06-13)

The **AetherGuard Root-Resistant Gateway Appliance** (STM32H5/U5 security controller, dual 1GbE L2 bridge + independent MGMT, hardware fail-closed interlock) is the sole active hardware baseline. Product framing: `docs/root-resistant-gateway-prd.md` §1.4.

The legacy ESP32 hardware family has been **fully retired and archived** to `X:\repos\Networksafe-archive\20260513-pre-cleanup`. This includes:

- ESP32-WROOM-32 serial-deployer dongle firmware and bundles.
- ESP32-S3 Control Board v1 / v2 KiCad trees, gerbers, drill, pick-and-place, and ERC reports.
- `esp32-serial-deployer-pcb` KiCad project, scratch routing experiments, probe reports, and Freerouting exchange files.
- The `esp32/` firmware source directory (formerly in-repo) and the legacy `AG:REQ:*` USB-TTL serial protocol.
- Any `aetherguard-gate` physical-confirmation board intermediates.

The active controller protocol is newline-delimited JSON (see `docs/root-resistant-gateway-prd.md`). Backend route names containing `esp32` (e.g. `/api/deployments/esp32-status`) are retained only for backward-compat with historically-registered legacy devices; new flows must target the Gateway Appliance.

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

The full file-level archive manifest is stored at `X:\repos\Networksafe-archive\20260513-pre-cleanup\archive-manifest.txt`.

## Kept In Repository

Production source, tests, documentation, firmware source, KiCad source, hardware factory source files, validation reports that document the current production baseline, and small scripts remain in the repository. Future generated artifacts should stay ignored unless they are explicitly promoted to source or release evidence.
