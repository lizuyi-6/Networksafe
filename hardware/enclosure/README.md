# AetherGuard Gateway Appliance Enclosure

Parametric OpenSCAD enclosure for the AetherGuard Root-Resistant Gateway Appliance.

> Status: Phase 0.5 industrial prototype enclosure, not a production injection-molded housing.
> Tool: OpenSCAD 2021.01+
> Default material: PETG/ABS for FDM prototype; PC/ABS or sheet-metal hybrid is preferred for production.

## Design Intent

This design turns the gateway into a single field-deployable appliance instead of a loose bench build.

- **Two-level internal layout**: lower interlock bay for 24V PSU, relay, and optocouplers; upper electronics deck for M1 gateway, M2 NUCLEO-H563ZI, and M3 Secure Element.
- **Root-resistant front interface**: three RJ45 ports are physically labeled `SERVER`, `LAN/WAN`, and `MGMT`; the MGMT port is visually separated from the data plane.
- **Human safety controls**: red E-stop and green confirm buttons are front-mounted with raised guard rings.
- **Auditable state visibility**: front status window and top stack-light mount expose isolated / armed / released / fault state without opening the case.
- **Serviceable, fail-closed build**: removable top cover, rear cable glands, internal 35mm DIN rail, side/top ventilation, and tamper-seal holes.

## Default Envelope

External dimensions: **300 × 210 × 118 mm** (W × D × H)

Internal concept:

| Zone | Hardware | Fit envelope |
|---|---|---|
| Upper left | M1 multi-port gateway, Protectli VP2430 class | 145 × 128 × 40 mm |
| Upper right | M2 NUCLEO-H563ZI controller | 122 × 108 × 15 mm |
| Upper right corner | M3 Secure Element breakout | 24 × 24 × 8 mm |
| Lower bay | 24V PSU + relay + optocoupler modules on DIN rail | 274 mm rail length |
| Front panel | SERVER / LAN-WAN / MGMT, USB-C, status, E-stop, confirm | panel-mounted |

Adjust `parameters.scad` when real hardware dimensions differ.

## Files

- `parameters.scad` - all shared dimensions and fit envelopes
- `chassis.scad` - main shell, two-level deck, DIN rail, bosses, vents, rear entries
- `front-panel.scad` - removable front I/O/control panel
- `top-cover.scad` - removable lid with stack-light mount and ventilation
- `assembly.scad` - visual fit check with color-coded dummy components
- `printable/` - split 220x220 mm FDM-printable version and STL export script
- `fusion/` - Autodesk Fusion parameter script and handoff notes

Generated `*.stl` and `*.png` files are intentionally ignored by git.

## 220x220 mm Printer Version

Use the split printable set when the full 300 mm chassis does not fit your printer bed:

```powershell
cd X:\repos\Networksafe\hardware\enclosure\printable
.\export-printable.ps1
```

This exports left/right chassis halves, left/right front-panel halves, left/right top-cover halves, and a screw-on rear DIN-rail clip.

## Render / Export

```bash
cd hardware/enclosure

# STL for printing
openscad -o chassis.stl chassis.scad
openscad -o front-panel.stl front-panel.scad
openscad -o top-cover.stl top-cover.scad

# Fit-check renders
openscad --imgsize 1400,1000 --camera 170,125,105,70,18,46,840 --projection o -o assembly.png assembly.scad
openscad --imgsize 1200,900 --camera 150,-120,86,60,0,42,680 --projection o -o front-panel.png front-panel.scad
```

## Prototype Print Guidance

- Layer height: 0.2 mm
- Wall count: 4 perimeters
- Infill: 25-35% gyroid
- Material: PETG minimum; ABS/ASA preferred for heat and field use
- Brass inserts: M3 for front panel and M4 for lid where repeated service is expected
- Supports: likely required for the rear DIN clip and button guard rings

## First Fit Checks

1. Confirm M1 gateway actual dimensions and front-port alignment before printing the full chassis.
2. Print a 20 mm front-panel slice first to validate RJ45, USB-C, and 22 mm button tolerances.
3. Verify lower DIN bay height: relay/PSU/opto modules must clear the upper deck by at least 3 mm.
4. Confirm E-stop wiring remains normally closed and reachable without opening the case.
5. Verify side/top vents do not expose touchable 24V terminals; add an internal insulating shield if needed.
6. After assembly, run the wiring checklist in `docs/hardware-wiring-diagram.md`.

## Wiring Reference

See `docs/hardware-wiring-diagram.md` for GPIO, relay, feedback, stack-light, and three-plane wiring details.
