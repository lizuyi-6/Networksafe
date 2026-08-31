"""Create a Blender review file containing only the seven printable STL meshes.

The individual STL files remain the slicer inputs. The Blender file is a
catalog/review scene: each mesh is placed in a separate 220 mm tile and carries
its source filename as custom metadata.
"""

from __future__ import annotations

from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parent
OUTPUT_BLEND = ROOT / "aetherguard-print-pack-review.blend"
OUTPUT_RENDER = ROOT / "aetherguard-print-pack-preview.png"
MM = 0.001

PARTS = (
    ("chassis-left.stl", "Chassis_Left", (0, 0), (0.09, 0.45, 0.52, 1)),
    ("chassis-right.stl", "Chassis_Right", (250, 0), (0.12, 0.55, 0.60, 1)),
    ("top-cover-left.stl", "Top_Cover_Left", (500, 0), (0.22, 0.40, 0.48, 1)),
    ("top-cover-right.stl", "Top_Cover_Right", (750, 0), (0.28, 0.48, 0.56, 1)),
    ("front-panel-left.stl", "Front_Panel_Left", (0, 250), (0.38, 0.42, 0.46, 1)),
    ("front-panel-right.stl", "Front_Panel_Right", (250, 250), (0.46, 0.50, 0.54, 1)),
    ("rear-din-clip.stl", "Rear_DIN_Clip", (500, 250), (0.72, 0.32, 0.10, 1)),
)


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for existing_collection in list(bpy.data.collections):
        bpy.data.collections.remove(existing_collection)


def import_part(
    filename: str,
    name: str,
    tile_origin_mm: tuple[float, float],
    color: tuple[float, float, float, float],
    target_collection: bpy.types.Collection,
) -> bpy.types.Object:
    stl_path = ROOT / filename
    if not stl_path.exists():
        raise FileNotFoundError(stl_path)

    bpy.ops.object.select_all(action="DESELECT")
    if hasattr(bpy.ops.wm, "stl_import"):
        bpy.ops.wm.stl_import(filepath=str(stl_path), global_scale=MM)
    else:
        bpy.ops.import_mesh.stl(filepath=str(stl_path), global_scale=MM)

    imported = list(bpy.context.selected_objects)
    if len(imported) != 1:
        raise RuntimeError(f"Expected one mesh from {filename}, got {len(imported)}")

    obj = imported[0]
    obj.name = name
    world_corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    minimum = Vector(
        (
            min(corner.x for corner in world_corners),
            min(corner.y for corner in world_corners),
            min(corner.z for corner in world_corners),
        )
    )
    desired_minimum = Vector((tile_origin_mm[0] * MM, tile_origin_mm[1] * MM, 0))
    obj.location += desired_minimum - minimum
    obj.color = color
    obj["source_stl"] = filename
    obj["target_bed_mm"] = "220x220"
    obj["slicer_input"] = True

    for source_collection in list(obj.users_collection):
        source_collection.objects.unlink(obj)
    target_collection.objects.link(obj)
    return obj


def build_print_pack() -> None:
    reset_scene()
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "MILLIMETERS"
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(OUTPUT_RENDER)
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "OBJECT"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.015, 0.022, 0.030)

    printable_collection = bpy.data.collections.new("PRINTABLE_STL_MESHES")
    scene.collection.children.link(printable_collection)
    objects = [
        import_part(filename, name, tile_origin, color, printable_collection)
        for filename, name, tile_origin, color in PARTS
    ]

    camera_data = bpy.data.cameras.new("Print_Pack_Camera")
    camera = bpy.data.objects.new("Print_Pack_Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = (0.455, 0.175, 1.0)
    camera.rotation_euler = (0, 0, 0)
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 0.56
    scene.camera = camera

    note = bpy.data.texts.new("README - PRINT PACK")
    note.write(
        "Slicer inputs are the seven individual STL files in this directory.\n"
        "All seven are manifold, single-component, fit 220x220 mm, and rest at Z=0.\n"
        "The Blender transforms only separate the parts for catalog review.\n"
        "Do not export all seven objects as one combined print plate.\n"
    )

    assert len(objects) == 7
    assert all(obj.type == "MESH" for obj in objects)
    assert len(printable_collection.objects) == 7

    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT_BLEND))
    bpy.ops.render.render(write_still=True)


build_print_pack()
