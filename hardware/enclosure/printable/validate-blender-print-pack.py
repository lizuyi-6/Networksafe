"""Validate the generated Blender review scene without trusting its render."""

from __future__ import annotations

import sys

import bpy
from mathutils import Vector


EXPECTED_SOURCES = {
    "chassis-left.stl",
    "chassis-right.stl",
    "front-panel-left.stl",
    "front-panel-right.stl",
    "top-cover-left.stl",
    "top-cover-right.stl",
    "rear-din-clip.stl",
}
PRINT_BED_MM = 220.0
TOLERANCE_MM = 0.001


def world_bounds_mm(obj: bpy.types.Object) -> tuple[Vector, Vector, Vector]:
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    minimum = Vector(tuple(min(corner[axis] for corner in corners) * 1000 for axis in range(3)))
    maximum = Vector(tuple(max(corner[axis] for corner in corners) * 1000 for axis in range(3)))
    return minimum, maximum, maximum - minimum


def main() -> int:
    collection = bpy.data.collections.get("PRINTABLE_STL_MESHES")
    if collection is None:
        print("print_pack_collection: missing")
        return 1

    scene_meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    collection_meshes = [obj for obj in collection.objects if obj.type == "MESH"]
    checks = {
        "scene_mesh_count": len(scene_meshes) == 7,
        "collection_mesh_count": len(collection_meshes) == 7,
        "source_set": {obj.get("source_stl") for obj in collection_meshes} == EXPECTED_SOURCES,
        "all_slicer_inputs": all(obj.get("slicer_input") is True for obj in collection_meshes),
        "all_target_220x220": all(obj.get("target_bed_mm") == "220x220" for obj in collection_meshes),
    }

    part_results = []
    for obj in sorted(collection_meshes, key=lambda item: item.get("source_stl", "")):
        minimum, maximum, dimensions = world_bounds_mm(obj)
        part_checks = {
            "fits_x": dimensions.x <= PRINT_BED_MM + TOLERANCE_MM,
            "fits_y": dimensions.y <= PRINT_BED_MM + TOLERANCE_MM,
            "on_bed_z": abs(minimum.z) <= TOLERANCE_MM,
        }
        passed = all(part_checks.values())
        part_results.append(passed)
        print(
            f"{obj.get('source_stl')}: "
            f"world_min_mm={tuple(round(value, 3) for value in minimum)} "
            f"world_max_mm={tuple(round(value, 3) for value in maximum)} "
            f"dims_mm={tuple(round(value, 3) for value in dimensions)} "
            f"checks={part_checks} result={'PASS' if passed else 'FAIL'}"
        )

    passed = all(checks.values()) and all(part_results)
    print(f"print_pack_checks={checks}")
    print(
        "print_pack_summary: "
        f"passed={sum(part_results)} failed={len(part_results) - sum(part_results)} "
        f"total={len(part_results)} scene_result={'PASS' if passed else 'FAIL'}"
    )
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
