# AetherGuard Root-Resistant Gateway Enclosure

From-scratch parametric OpenSCAD enclosure for the AetherGuard Root-Resistant Gateway Appliance.

> Status: Phase 0.6 industrial prototype enclosure, not a certified production housing.
> Tool: OpenSCAD 2021.01+
> Prototype material: ASA/ABS preferred; PETG minimum. A formed sheet-metal or PC/ABS hybrid is preferred for production.

## Architecture

The Phase 0.6 design replaces the former tall two-level box with a low-profile, single-service-plane appliance. The change is mechanical, not cosmetic: all field-serviceable hardware is visible after removing one lid, while the interlock bay remains physically separated from the logic bay.

- **Front logic bay**: M1 gateway and M2 STM32 controller mount side-by-side. There is no hidden lower electronics deck.
- **Guarded M3 carrier**: the Secure Element breakout sits in a small perimeter vault beside the controller, with short I2C routing and room for a tamper cover.
- **Rear M4 interlock bay**: the transverse 35 mm DIN rail is behind a solid partition. Only two grommeted harness passages cross the boundary.
- **Readable trust boundary**: the front panel is divided into data-plane, trusted management/service, state, and physical authorization zones.
- **Fail-closed operator controls**: the 22 mm E-stop and confirm controls have different guard diameters for visual and tactile distinction.
- **Passive cooling**: side gills, separate M1/M2 lid vent banks, and a rear interlock exhaust bank avoid a fan as a new single point of failure.
- **Serviceable mounting**: six front-panel fasteners, eight lid fasteners, registration skirts, anti-shear split joints, and dual rear DIN clips reduce panel flex and rail load concentration.
- **Auditable state visibility**: the four-segment front window and standardized 22 mm stack-light pattern expose `isolated`, `armed`, `released`, and `fault` state.

## Default Envelope

Structural chassis datum: **320 × 210 × 88 mm** (W × D × H). The raised armored lid reaches approximately **92 mm**; controls, cable glands, DIN carrier, and stack light are excluded from this datum.

| Zone | Hardware | Fit envelope / provision |
|---|---|---|
| Front left | M1 multi-port gateway, Protectli VP2430 class | 145 × 128 × 40 mm retained cradle |
| Front right | M2 NUCLEO-H563ZI controller | 122 × 108 mm, four M3 standoffs |
| Front-right trust pocket | M3 Secure Element breakout | 24 × 24 × 8 mm guarded carrier |
| Rear isolated bay | M4 relay, optocouplers, and 24V distribution | 288 mm transverse DIN rail |
| Front panel | SERVER / LAN-WAN / MGMT, USB-C, state, E-stop, confirm | panel-mount couplers and 22 mm controls |
| Top | Stack light | 22.5 mm shaft plus three-hole 36 mm bolt circle |

All dimensions are centralized in `parameters.scad`. Confirm actual purchased hardware before manufacturing.

## Mechanical Files

- `parameters.scad` - shared dimensions, fit envelopes, screw patterns, and bay locations
- `geometry.scad` - reusable rounded, slot, hex-ring, and countersink helpers
- `chassis.scad` - shell, partition, M1 cradle, M2/M3 mounts, internal DIN rail, cable anchors, and rear interfaces
- `front-panel.scad` - removable I/O and hardware-authorization faceplate
- `top-cover.scad` - armored service lid, passive vents, stack-light pattern, and tamper points
- `assembly.scad` - hero and service-mode fit preview with color-coded components
- `validate-mesh.py` - dependency-free STL connectivity and manifold-edge check
- `printable/` - 220 × 220 mm FDM split parts and export script
- `fusion/` - Autodesk Fusion parameter/proxy handoff

Generated `*.stl` and ad-hoc render `*.png` files remain ignored by git.

## 220 × 220 mm Printer Version

The 320 mm width is split at the center seam; the 210 mm depth stays within a common printer bed.

```powershell
cd X:\repos\Networksafe\hardware\enclosure\printable
.\export-printable.ps1
```

Approximate largest footprints:

| Part | Footprint |
|---|---:|
| Chassis left/right | 161 × 210 mm each |
| Front panel left/right | 157 × 82 mm each |
| Top cover left/right | 157 × 204 mm each |
| Dual rear DIN carrier | 205 × 64 mm |

The split chassis uses low and high anti-shear lips. The lid uses an underside lap strip. Fasteners are intentionally placed to either side of the split rather than directly on the seam.

## Render and Export

```powershell
cd X:\repos\Networksafe\hardware\enclosure

# Full-size manufacturing meshes
openscad -o chassis.stl chassis.scad
openscad -o front-panel.stl front-panel.scad
openscad -o top-cover.stl top-cover.scad
py -3 validate-mesh.py chassis.stl front-panel.stl top-cover.stl

# Closed hero view
openscad --imgsize 1600,1100 `
  --camera 175,145,110,68,0,42,940 --projection o `
  -o assembly.png assembly.scad

# Lid-up service view
openscad -D SERVICE_PREVIEW=true --imgsize 1600,1100 `
  --camera 170,175,150,66,0,52,1050 --projection o `
  -o assembly-service.png assembly.scad
```

### Blender presentation scene

`aetherguard-blender-scene.py` assembles the three manufacturing STL meshes in
Blender and adds materials, operator-control proxies, studio lighting, and a
hero camera. The script writes `aetherguard-enclosure.blend` and
`aetherguard-enclosure-blender.png`; both outputs are generated artifacts and
are ignored by Git.

Run the script from Blender's Python Console:

```python
script_path = r"X:\repos\Networksafe\hardware\enclosure\aetherguard-blender-scene.py"; exec(compile(open(script_path, encoding="utf-8").read(), script_path, "exec"), {"__file__": script_path, "__name__": "__main__"})
```

Only collection `01_Manufacturing_Geometry` is sourced from the OpenSCAD STL
exports. Collections `02_Visual_Controls_Not_For_Manufacture` and
`03_Visual_Graphics` are presentation-only and must not be exported for
fabrication.

## Prototype Print Guidance

- Layer height: 0.2 mm
- Walls: 4-5 perimeters
- Top/bottom: 5 layers
- Infill: 30-35% gyroid or cubic
- Material: ASA/ABS preferred; PETG minimum
- Inserts: M3 heat-set inserts for the front panel; M4 or M3 inserts for the lid according to the selected screw hardware
- Supports: button guards and the rear DIN carrier may require local supports
- Brim: 6-8 mm on chassis halves
- Finish: fill the engraved branding and trust-boundary channels with cyan paint; keep safety controls in standard red/yellow/green colors

## Safety and Fit Gates

1. Print a thin front-panel coupon first and verify the exact RJ45 couplers, USB-C passthrough, and both 22 mm controls.
2. Verify the purchased M1 gateway against the 145 × 128 × 40 mm cradle and confirm cable bend radius before printing the chassis.
3. Verify M2 header and USB connector clearance beneath the lid ribs.
4. Fit the actual DIN modules and confirm terminal wiring remains below the partition top and away from lid fasteners.
5. Use grommets in both partition passages; do not route loose conductors over the partition.
6. A printed FDM enclosure is not a certified mains enclosure. For prototype work, prefer certified external SELV supplies or a separately approved metal power-inlet subassembly.
7. Confirm the E-stop remains normally closed, latching, and reachable without opening the housing.
8. Ensure no vent exposes touchable terminals; install an insulating terminal shield where required.
9. After assembly, run the checklist in `docs/hardware-wiring-diagram.md` and verify that loss of power leaves the SERVER-to-LAN/WAN path isolated.

## Wiring Reference

See `docs/hardware-wiring-diagram.md` for GPIO, relay, feedback, stack-light, and three-plane wiring details.
