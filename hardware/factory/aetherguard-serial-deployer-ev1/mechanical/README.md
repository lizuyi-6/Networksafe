# Mechanical Package

Status: `factory-draft`

## Source

- OpenSCAD source: `../../../enclosure.scad`
- Export script: `export-mechanical.ps1`
- Generated output directory: `exports/`

## Nominal Design

- External body: `90 x 58 x 16.8 mm`.
- Top lens: OLED and RGB viewing area.
- Front buttons: three caps aligned with OK/NEXT/BACK.
- Rear cutout: USB-C service/debug/power.
- Right rear lower cutout: USB-A pigtail cable exit.
- Internal mounting: M2-class standoffs and heat-set insert concept.

## Prototype Material

- Preferred 3D print: black PETG or PLA+.
- CNC option: black ABS.
- Lens: clear or smoked acrylic/polycarbonate, prototype cut from STL/DXF reference or hand-fit.
- Fasteners: M2 screws with heat-set inserts where possible.

## Tolerance Targets

- General 3D print clearance: 0.30 mm minimum.
- USB-C opening clearance: verify against exact connector height after PCB source is locked.
- Button cap free clearance: 0.20-0.35 mm per side.
- Lens fit clearance: 0.20-0.30 mm per side.
- Pigtail slot: verify with final cable OD and strain-relief sleeve.

## Exported Parts

The default script exports factory single-part STL files:

- `lower-chassis.stl`
- `upper-bezel.stl`
- `service-door.stl`
- `lens.stl`
- `button-caps.stl`
- `inspection-plate.stl`
- `mechanical-export-manifest.json`

The full `assembly.stl` export can be requested with `-IncludeAssembly`, but it is intentionally not part of the default export path because it is slower and is only a visual reference, not a manufacturing input.

## Factory Review Items

- Check PCB mounting hole positions against the final KiCad board.
- Confirm USB-C cutout alignment after first article PCB is assembled.
- Confirm OLED window alignment and module height.
- Confirm RGB window visibility.
- Confirm button cap travel and no interference.
- Confirm buzzer sound holes are not blocked by the PCB or lens.
- Add strain relief or adhesive fixture for the USB-A pigtail before field demo use.
