# Artifact Archive Index

Date: 2026-05-13

External archive root: `X:\repos\Networksafe-archive\20260513-pre-cleanup`

This cleanup moves generated artifacts and hardware experiment intermediates out of the production repository while preserving them locally for inspection. The archive is not part of Git; use release artifacts, object storage, or a separate asset repository if these files need to be shared.

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
