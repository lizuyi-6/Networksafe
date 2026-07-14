# Fusion Handoff

Use this folder when editing the AetherGuard enclosure in Autodesk Fusion.

The generated Fusion proxy is a layout/reference model only. It is not oriented for FDM printing.
For 3D printing, use the split STL files in `X:\repos\Networksafe\hardware\enclosure\printable`.

## Best Workflow

For editable mechanical CAD, do not treat the STL as the master model. Use it as a reference and rebuild the enclosure with Fusion sketches, extrudes, shells, fillets, and cut features.

1. Open Fusion and create a new design.
2. Run `aetherguard_fusion_parameters` from `Utilities > Scripts and Add-Ins`.
   - In Fusion, add this folder as the script folder:
     `X:\repos\Networksafe\hardware\enclosure\fusion\aetherguard_fusion_parameters`
3. Import reference meshes from `../` or `../printable/`:
   - `chassis.stl`
   - `front-panel.stl`
   - `top-cover.stl`
   - printable split STL files when checking printer fit
4. Rebuild the model natively in Fusion using the created user parameters.
5. Export manufacturing files from Fusion as STEP for CNC/vendor review. For FDM prototypes, prefer the split printable STL files.

## Suggested Fusion Components

- `Chassis`
- `Front Panel`
- `Top Cover`
- `Rear DIN Clip`
- `M1 Gateway Placeholder`
- `M2 NUCLEO Placeholder`
- `M3 Secure Element Placeholder`
- `M4 DIN Modules Placeholder`

## Rebuild Order

1. Base chassis box: sketch `enclosure_w x enclosure_d`, extrude `enclosure_h`, shell by `wall`.
2. Front and top openings: cut the service openings using `panel_t` and `roof_t`.
3. Internal deck: extrude a shelf at `deck_split_z`.
4. Lower DIN rail: create a 35 mm rail along `internal_din_len`.
5. Front panel: create RJ45, USB-C, status, E-stop, and confirm cutouts from parameters.
6. Top cover: add stack-light hole, vent slots, countersunk screw holes, and tamper-seal holes.
7. Add fillets/chamfers last.

## Mesh Import Notes

Fusion can import STL meshes, but editing converted mesh geometry is usually awkward. If you must convert:

1. Insert Mesh, units = millimeters.
2. Mesh workspace: Generate Face Groups.
3. Convert Mesh to BRep or prismatic conversion if available.
4. Use the converted body as a reference for sketches and measurements, not as the final master.
