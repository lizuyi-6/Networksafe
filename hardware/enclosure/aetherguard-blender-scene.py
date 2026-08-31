"""Build the AetherGuard Gateway enclosure presentation scene in Blender.

The printable geometry stays sourced from the OpenSCAD-generated STL files in
this directory.  Blender adds assembly transforms, materials, operator-control
proxies, lighting, and a camera; those visual proxies are not manufacturing
geometry.

Run inside Blender 4.2+ / 5.x:
    script_path = r"X:\\repos\\Networksafe\\hardware\\enclosure\\aetherguard-blender-scene.py"; exec(compile(open(script_path, encoding="utf-8").read(), script_path, "exec"), {"__file__": script_path, "__name__": "__main__"})
"""

from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parent
OUTPUT_BLEND = ROOT / "aetherguard-enclosure.blend"
OUTPUT_RENDER = ROOT / "aetherguard-enclosure-blender.png"

MM = 0.001
WALL = 3.2 * MM
FLOOR_T = 3.4 * MM
ROOF_T = 3.2 * MM
ENCLOSURE_W = 320 * MM
ENCLOSURE_D = 210 * MM
ENCLOSURE_H = 88 * MM


def mm(value: float) -> float:
    return value * MM


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    for existing_collection in list(bpy.data.collections):
        bpy.data.collections.remove(existing_collection)


def collection(name: str) -> bpy.types.Collection:
    result = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(result)
    return result


def move_to_collection(obj: bpy.types.Object, target: bpy.types.Collection) -> None:
    for source in list(obj.users_collection):
        source.objects.unlink(obj)
    target.objects.link(obj)


def material(
    name: str,
    color: tuple[float, float, float, float],
    *,
    metallic: float = 0.0,
    roughness: float = 0.4,
    emission: tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    bsdf = next(
        (node for node in result.node_tree.nodes if node.type == "BSDF_PRINCIPLED"),
        None,
    )
    if bsdf is None:
        raise RuntimeError(f"Material {name} has no Principled BSDF node")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        emission_input = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
        if emission_input is not None:
            emission_input.default_value = emission
        strength_input = bsdf.inputs.get("Emission Strength")
        if strength_input is not None:
            strength_input.default_value = emission_strength
    return result


def assign_material(obj: bpy.types.Object, value: bpy.types.Material) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(value)


def add_bevel(obj: bpy.types.Object, width: float = mm(0.7), segments: int = 3) -> None:
    modifier = obj.modifiers.new(name="Presentation bevel", type="BEVEL")
    modifier.width = width
    modifier.segments = segments


def import_stl(
    filename: str,
    name: str,
    location_mm: tuple[float, float, float],
    target_collection: bpy.types.Collection,
    target_material: bpy.types.Material,
) -> bpy.types.Object:
    path = ROOT / filename
    if not path.exists():
        raise FileNotFoundError(f"Required manufacturing mesh is missing: {path}")

    bpy.ops.object.select_all(action="DESELECT")
    if hasattr(bpy.ops.wm, "stl_import"):
        bpy.ops.wm.stl_import(filepath=str(path), global_scale=MM)
    else:
        bpy.ops.import_mesh.stl(filepath=str(path), global_scale=MM)

    imported = list(bpy.context.selected_objects)
    if len(imported) != 1:
        raise RuntimeError(f"Expected one object from {filename}, got {len(imported)}")

    obj = imported[0]
    obj.name = name
    obj.location = tuple(mm(axis) for axis in location_mm)
    assign_material(obj, target_material)
    move_to_collection(obj, target_collection)

    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    return obj


def add_cube(
    name: str,
    location: tuple[float, float, float],
    dimensions: tuple[float, float, float],
    target_collection: bpy.types.Collection,
    target_material: bpy.types.Material,
    bevel: float = mm(0.6),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        add_bevel(obj, bevel)
    assign_material(obj, target_material)
    move_to_collection(obj, target_collection)
    return obj


def add_cylinder(
    name: str,
    location: tuple[float, float, float],
    radius: float,
    depth: float,
    target_collection: bpy.types.Collection,
    target_material: bpy.types.Material,
    *,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    vertices: int = 64,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    add_bevel(obj, mm(0.45), 3)
    assign_material(obj, target_material)
    move_to_collection(obj, target_collection)
    return obj


def add_torus(
    name: str,
    location: tuple[float, float, float],
    major_radius: float,
    minor_radius: float,
    target_collection: bpy.types.Collection,
    target_material: bpy.types.Material,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=64,
        minor_segments=20,
        location=location,
        rotation=(math.radians(90), 0, 0),
    )
    obj = bpy.context.object
    obj.name = name
    assign_material(obj, target_material)
    move_to_collection(obj, target_collection)
    return obj


def add_text(
    body: str,
    name: str,
    location: tuple[float, float, float],
    size: float,
    target_collection: bpy.types.Collection,
    target_material: bpy.types.Material,
) -> bpy.types.Object:
    bpy.ops.object.text_add(location=location, rotation=(math.radians(90), 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.data.body = body
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    obj.data.size = size
    obj.data.extrude = mm(0.18)
    obj.data.bevel_depth = mm(0.04)
    assign_material(obj, target_material)
    move_to_collection(obj, target_collection)
    return obj


def look_at(obj: bpy.types.Object, point: tuple[float, float, float]) -> None:
    direction = Vector(point) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_area_light(
    name: str,
    location: tuple[float, float, float],
    energy: float,
    size: float,
    color_value: tuple[float, float, float],
    target: tuple[float, float, float],
) -> bpy.types.Object:
    data = bpy.data.lights.new(name=name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color_value
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    look_at(obj, target)
    return obj


def build_scene() -> None:
    reset_scene()

    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "MILLIMETERS"
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(OUTPUT_RENDER)
    scene.render.film_transparent = False
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        # Blender 5.2 exposes the same renderer under the shorter enum name.
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.image_settings.color_mode = "RGBA"

    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = 64

    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except (TypeError, ValueError):
        pass
    scene.view_settings.exposure = -1.15

    world = bpy.data.worlds.new("AetherGuard studio") if not scene.world else scene.world
    scene.world = world
    world.use_nodes = True
    background = next(
        (node for node in world.node_tree.nodes if node.type == "BACKGROUND"),
        None,
    )
    if background is None:
        raise RuntimeError("World node tree has no Background node")
    background.inputs["Color"].default_value = (0.006, 0.009, 0.014, 1)
    background.inputs["Strength"].default_value = 0.055

    structural = collection("01_Manufacturing_Geometry")
    controls = collection("02_Visual_Controls_Not_For_Manufacture")
    graphics = collection("03_Visual_Graphics")

    obsidian = material("Obsidian anodized shell", (0.014, 0.022, 0.029, 1), metallic=0.72, roughness=0.25)
    gunmetal = material("Armored gunmetal lid", (0.035, 0.075, 0.095, 1), metallic=0.78, roughness=0.23)
    panel_black = material("Front panel black", (0.009, 0.014, 0.018, 1), metallic=0.52, roughness=0.29)
    connector_black = material("Connector black", (0.004, 0.006, 0.008, 1), metallic=0.12, roughness=0.34)
    trust_teal = material("Trust port teal", (0.005, 0.09, 0.105, 1), metallic=0.42, roughness=0.27)
    cyan = material("Aether cyan", (0.01, 0.45, 0.50, 1), metallic=0.18, roughness=0.24, emission=(0.01, 0.65, 0.68, 1), emission_strength=2.1)
    red = material("Emergency red", (0.54, 0.012, 0.018, 1), metallic=0.08, roughness=0.24)
    amber = material("Safety amber", (0.88, 0.34, 0.015, 1), metallic=0.15, roughness=0.28, emission=(0.95, 0.18, 0.01, 1), emission_strength=0.6)
    green = material("Confirm green", (0.015, 0.48, 0.13, 1), metallic=0.12, roughness=0.24, emission=(0.01, 0.52, 0.09, 1), emission_strength=0.45)
    magenta = material("Fault magenta", (0.63, 0.015, 0.23, 1), metallic=0.08, roughness=0.27, emission=(0.72, 0.01, 0.24, 1), emission_strength=0.6)
    silver = material("Lettering silver", (0.56, 0.69, 0.75, 1), metallic=0.7, roughness=0.22)
    floor_mat = material("Studio floor", (0.012, 0.018, 0.024, 1), metallic=0.18, roughness=0.38)

    import_stl("chassis.stl", "Chassis_Manufacturing_Mesh", (0, 0, 0), structural, obsidian)
    import_stl("front-panel.stl", "Front_Panel_Manufacturing_Mesh", (3.2, 0, 3.4), structural, panel_black)
    import_stl("top-cover.stl", "Top_Cover_Manufacturing_Mesh", (3.2, 3.2, 84.8), structural, gunmetal)

    # Front connectors: visual inserts make the existing cutouts readable.
    for label, center_x, mat in (
        ("SERVER", 32, connector_black),
        ("LAN_WAN", 76, connector_black),
        ("MGMT", 128, trust_teal),
    ):
        add_cube(
            f"{label}_RJ45_visual_insert",
            (WALL + mm(center_x), mm(-3.6), FLOOR_T + mm(29)),
            (mm(18.2), mm(7.2), mm(15.4)),
            controls,
            mat,
            mm(0.8),
        )

    add_cube(
        "SERVICE_USB_C_visual_insert",
        (WALL + mm(168), mm(-3.0), FLOOR_T + mm(29)),
        (mm(12), mm(6), mm(7)),
        controls,
        connector_black,
        mm(1.4),
    )

    # Four-state audit window: isolated, armed, released, fault.
    add_cube(
        "Status_Window_Backplate",
        (WALL + mm(246), mm(-1.9), FLOOR_T + mm(59)),
        (mm(120), mm(2.6), mm(13)),
        controls,
        connector_black,
        mm(1.1),
    )
    for index, mat in enumerate((red, amber, green, magenta)):
        add_cube(
            f"Status_Segment_{index + 1}",
            (WALL + mm(205.5 + index * 27), mm(-3.35), FLOOR_T + mm(59)),
            (mm(20), mm(0.8), mm(4.8)),
            controls,
            mat,
            mm(0.35),
        )

    # Differentiated guarded controls: red mushroom E-stop and green confirm.
    add_torus("E_STOP_guard", (WALL + mm(236), mm(-3.4), FLOOR_T + mm(27)), mm(16), mm(4), controls, amber)
    add_cylinder(
        "E_STOP_mushroom",
        (WALL + mm(236), mm(-10.2), FLOOR_T + mm(27)),
        mm(15.5),
        mm(13.5),
        controls,
        red,
        rotation=(math.radians(90), 0, 0),
    )
    add_torus("CONFIRM_guard", (WALL + mm(286), mm(-3.2), FLOOR_T + mm(27)), mm(14), mm(2), controls, silver)
    add_cylinder(
        "CONFIRM_button",
        (WALL + mm(286), mm(-8.2), FLOOR_T + mm(27)),
        mm(12.8),
        mm(10.5),
        controls,
        green,
        rotation=(math.radians(90), 0, 0),
    )

    # Top-mounted three-color state beacon, matching the 22.5 mm shaft datum.
    beacon_x = mm(286)
    beacon_y = mm(172)
    beacon_z = ENCLOSURE_H + mm(3.6)
    add_cylinder("Stack_Light_Base", (beacon_x, beacon_y, beacon_z + mm(3.5)), mm(21.5), mm(7), controls, connector_black)
    for name, z_offset, mat in (
        ("Stack_Light_Red", 12.5, red),
        ("Stack_Light_Amber", 23.5, amber),
        ("Stack_Light_Green", 34.5, green),
    ):
        add_cylinder(name, (beacon_x, beacon_y, beacon_z + mm(z_offset)), mm(14.5), mm(11), controls, mat)
    add_cylinder("Stack_Light_Cap", (beacon_x, beacon_y, beacon_z + mm(41.5)), mm(15), mm(3), controls, connector_black)

    # Thin visual identity strip. Branding and port labels already exist in the
    # manufacturing front-panel mesh, so do not duplicate them here.
    add_cube(
        "Aether_Cyan_Trust_Line",
        (WALL + mm(100), mm(-2.05), FLOOR_T + mm(48.4)),
        (mm(164), mm(0.35), mm(1.2)),
        graphics,
        cyan,
        0,
    )
    # Studio ground and a beveled plinth keep the render legible at thumbnail size.
    add_cube(
        "Presentation_Plinth",
        (ENCLOSURE_W / 2, ENCLOSURE_D / 2, mm(-5.2)),
        (mm(355), mm(245), mm(8)),
        graphics,
        floor_mat,
        mm(4),
    )
    add_cube(
        "Ground",
        (ENCLOSURE_W / 2, ENCLOSURE_D / 2, mm(-11)),
        (mm(1200), mm(900), mm(4)),
        graphics,
        floor_mat,
        mm(2),
    )

    target = (ENCLOSURE_W * 0.50, ENCLOSURE_D * 0.47, ENCLOSURE_H * 0.43)
    camera_data = bpy.data.cameras.new("Hero_Camera")
    camera = bpy.data.objects.new("Hero_Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = (mm(505), mm(-420), mm(330))
    camera_data.lens = 58
    camera_data.sensor_width = 36
    look_at(camera, target)
    scene.camera = camera

    add_area_light("Key", (mm(80), mm(-210), mm(430)), 280, mm(310), (0.72, 0.88, 1.0), target)
    add_area_light("Fill", (mm(-260), mm(90), mm(220)), 105, mm(280), (0.20, 0.56, 0.70), target)
    add_area_light("Rim", (mm(480), mm(320), mm(390)), 240, mm(260), (0.10, 0.95, 0.82), target)
    add_area_light("Front softbox", (mm(200), mm(-300), mm(120)), 90, mm(230), (1.0, 0.45, 0.24), target)

    # Keep a simple provenance note inside the .blend file.
    note = bpy.data.texts.new("README - MODEL PROVENANCE")
    note.write(
        "Manufacturing geometry: chassis.stl, front-panel.stl, top-cover.stl\n"
        "Source of truth: parameters.scad and the corresponding OpenSCAD files.\n"
        "Collection 02 contains visual controls only; do not export it for manufacture.\n"
        "Envelope datum: 320 x 210 x 88 mm.\n"
    )

    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT_BLEND))
    bpy.ops.render.render(write_still=True)


build_scene()
