# AetherGuard Gateway Appliance — Enclosure

3D-printable DIN-rail enclosure for the AetherGuard Root-Resistant Gateway Appliance (COTS four-module integration).

> Status: Phase 0 prototype bench enclosure (not production product housing)
> Tool: OpenSCAD (parametric, editable in GUI or CLI)
> Material: PLA/PETG 3D print (prototype); consider ABS/PC for production

## Design Decisions (assumptions — adjust if needed)

- **Form**: DIN-rail mounted control box housing M2/M3/M4; M1 Protectli sits on its own adjacent DIN-rail clip (it has its own enclosure).
- **Mounting**: 35mm top-hat DIN-rail (standard industrial).
- **Access**: Front panel has E-stop + confirm buttons + status LED window; rear panel has USB-C passthrough + cable glands; top has optional stack-light mount.
- **Service**: Removable top cover (4 screws) for access to NUCLEO + wiring.
- ** ventilation**: Side vents for passive cooling (NUCLEO + relay dissipate heat).

## Modules Housed

| Module | Hardware | Approx Size (mm) | Location |
|---|---|---|---|
| M2 Controller | NUCLEO-H563ZI | 122 × 108 × 15 | Upper deck (standoffs) |
| M3 Secure Element | OPTIGA Trust M breakout | 20 × 20 × 5 | On/next to NUCLEO |
| M4 Relay | DIN-rail SPDT relay | 80 × 60 × 25 | Lower DIN-rail section |
| M4 Optocoupler | 4-ch opto module | 75 × 55 × 25 | Lower DIN-rail section |
| M4 PSU | 24V DC DIN-rail | 100 × 60 × 40 | Lower DIN-rail section |
| E-Stop | 22mm mushroom NC | panel-mount | Front panel |
| Confirm | 22mm momentary NO | panel-mount | Front panel |
| Stack light | 3-color + buzzer | Φ40 base | Top (external) |

M1 (Protectli VP2430, ~141×124×37mm) sits on its own DIN-rail clip adjacent to this box; only a USB-C cable enters this enclosure to reach the NUCLEO.

## Files

- `parameters.scad` — shared dimensions (edit these to resize)
- `chassis.scad` — main box body + DIN-rail clip + internal standoff mounts
- `front-panel.scad` — button holes + LED window + vents
- `top-cover.scad` — removable lid with stack-light mount

## Render / Export STL

```bash
# Render to STL (CLI)
openscad -o chassis.stl chassis.scad
openscad -o front-panel.stl front-panel.scad
openscad -o top-cover.stl top-cover.scad

# Or open in GUI to preview
openscad chassis.scad
```

## Print Settings (recommended)

- Layer height: 0.2mm
- Infill: 25% (gyroid)
- Walls: 3 perimeters
- Material: PETG (better heat resistance than PLA for relay area)
- Supports: needed for DIN-rail clip overhang + button holes

## Assembly

1. Print chassis, front-panel, top-cover
2. Press DIN-rail clip onto 35mm rail
3. Mount NUCLEO on standoffs (M3 screws) in upper deck
4. Wire OPTIGA Trust M to NUCLEO I2C (PB8/PB9)
5. Slide relay + optocoupler + PSU onto lower DIN-rail section
6. Wire relay/optocoupler to NUCLEO GPIO (PA5/PA6) via cable glands
7. Install E-stop + confirm buttons in front panel (22mm holes)
8. Route USB-C from front/rear to NUCLEO USB-C
9. Attach front panel (4 screws)
10. Attach top cover (4 screws)
11. Mount stack light on top (optional)

## Wiring Reference

See `docs/hardware-wiring-diagram.md` for full GPIO pinout and cable list.

## Dimensions (default parameters)

External: 200 × 130 × 110 mm (W × D × H)
Internal usable: 194 × 124 × 104 mm (3mm walls)

Adjust in `parameters.scad` if module sizes differ.
