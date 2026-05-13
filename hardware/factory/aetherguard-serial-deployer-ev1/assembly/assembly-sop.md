# EV1 Prototype Assembly SOP

Status: `engineering-prototype-draft`

## Required Inputs

- Clean PCB fabrication files generated from the KiCad source after ERC/DRC/parity gates pass.
- Locked BOM from `../pcb/bom-ev1.csv`.
- 3D/CNC enclosure parts from `../mechanical/exports/`.
- Firmware binary built with PlatformIO environment `serial_deployer_pcb_v1`.
- USB-A pigtail cable assembly.
- OLED module.
- M2 screws and heat-set inserts.

## Assembly Flow

1. Perform SMT assembly using the locked BOM and the top/bottom placement files.
2. Inspect QFN exposed pads for U2/U3 and regulator soldering.
3. Inspect USB-C connector solder joints and shell anchors.
4. Inspect pigtail pads before cable soldering.
5. Solder or mount the OLED module and verify the pin order.
6. Solder the USB-A pigtail, add strain relief, and mark the target-host end.
7. Fit the PCB into the lower chassis with M2 hardware.
8. Check USB-C alignment against the rear opening before closing the case.
9. Install button caps and confirm free travel.
10. Install top lens and upper bezel.
11. Close enclosure and apply EV1 serial label.

## Assembly Holds

Stop assembly and escalate if any of the following are found:

- USB-C connector does not align with the case opening.
- OLED module touches the lens or has insufficient clearance.
- Button caps bind or hold switches pressed.
- Pigtail cable has no strain relief.
- 3V3 rail resistance to GND is below the factory threshold before power-on.
- CP2102N devices do not enumerate on a known-good host.

## Labeling

Each unit label should include:

- `AetherGuard Serial Deployer EV1`.
- Unit serial number.
- PCB revision.
- Firmware profile: `serial_deployer_pcb_v1`.
- Factory test result: `PASS` or `HOLD`.
