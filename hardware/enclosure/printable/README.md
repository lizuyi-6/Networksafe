# Printable FDM Version

This directory contains the printable split enclosure for a roughly 220 x 220 mm bed.

The full appliance envelope is still 300 x 210 x 118 mm, but large panels are split into printable pieces.
Do not print the Fusion proxy assembly directly. Use the STL files in this directory for slicing.

| Part | Approx print footprint |
|---|---:|
| `chassis-left.stl` | 151 x 210 mm |
| `chassis-right.stl` | 151 x 210 mm |
| `front-panel-left.stl` | 148 x 115 mm |
| `front-panel-right.stl` | 148 x 115 mm |
| `top-cover-left.stl` | 148 x 204 mm |
| `top-cover-right.stl` | 148 x 204 mm |
| `rear-din-clip.stl` | 120 x 76 mm |

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

1. Glue or plastic-weld the two chassis halves along the center seam.
2. The left chassis half has two alignment lips; the right half has clearance pockets.
3. Attach the split front-panel halves to the chassis with M3 screws or heat-set inserts.
4. Join the two top-cover halves using the underside lap strip, then screw the cover down.
5. Attach `rear-din-clip.stl` to the rear wall with four M4 screws. The printable chassis has matching pilot holes.
6. Keep 24V relay terminals covered; add an insulating inner shield if the printed vent openings expose touchable conductors.

Run the wiring checks in `docs/hardware-wiring-diagram.md` before powering the appliance.
