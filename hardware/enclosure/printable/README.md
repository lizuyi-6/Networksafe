# Printable FDM Version

This directory contains the printable split Phase 0.6 enclosure for a roughly 220 x 220 mm bed.

The full appliance envelope is 320 x 210 x 88 mm, but large panels are split into printable pieces.
Do not print the Fusion proxy assembly directly. Use the STL files in this directory for slicing.

| Part | Approx print footprint |
|---|---:|
| `chassis-left.stl` | 161 x 210 mm |
| `chassis-right.stl` | 161 x 210 mm |
| `front-panel-left.stl` | 157 x 82 mm |
| `front-panel-right.stl` | 157 x 82 mm |
| `top-cover-left.stl` | 157 x 204 mm |
| `top-cover-right.stl` | 157 x 204 mm |
| `rear-din-clip.stl` | 205 x 64 mm |

The front-panel STL files are already oriented flat: back face on the bed, raised details facing up.

## Export STLs

```powershell
cd X:\repos\Networksafe\hardware\enclosure\printable
.\export-printable.ps1
```

Or export one part:

```powershell
openscad -o chassis-left.stl chassis-left.scad
```

## Print Settings

- Material: PETG minimum; ABS/ASA preferred
- Nozzle: 0.4 mm
- Layer height: 0.2 mm
- Walls: 4 perimeters
- Top/bottom: 5 layers
- Infill: 30% gyroid or cubic
- Supports: enabled for button guard rings and the rear DIN clip only
- Brim: 5-8 mm for chassis halves

## Assembly Notes

1. Plastic-weld or bolt the two chassis halves along the center seam. Adhesive alone is not preferred for a rail-mounted field unit.
2. The left chassis half has low and high anti-shear lips; the right half has matching clearance pockets.
3. Attach the split front-panel halves to the chassis with M3 screws or heat-set inserts.
4. Join the two top-cover halves using the underside lap strip, then screw the cover down.
5. Attach `rear-din-clip.stl` to the rear wall with four M4 screws. The dual-hook carrier and printable chassis have matching holes.
6. Install grommets in both logic/interlock partition passages.
7. Keep 24V relay terminals covered; add an insulating inner shield if any vent exposes touchable conductors.

Run the wiring checks in `docs/hardware-wiring-diagram.md` before powering the appliance.
