"""Fail when printable enclosure meshes are not ready for a 220 mm bed."""

from __future__ import annotations

import importlib.util
import pathlib
import sys


PRINT_BED_X_MM = 220.0
PRINT_BED_Y_MM = 220.0
BED_TOLERANCE_MM = 0.001
PART_NAMES = (
    "chassis-left",
    "chassis-right",
    "front-panel-left",
    "front-panel-right",
    "top-cover-left",
    "top-cover-right",
    "rear-din-clip",
)


def load_mesh_validator():
    validator_path = pathlib.Path(__file__).resolve().parent.parent / "validate-mesh.py"
    spec = importlib.util.spec_from_file_location("aetherguard_mesh_validator", validator_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load mesh validator: {validator_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def validate_part(module, stl_path: pathlib.Path) -> bool:
    triangles = module.read_stl(stl_path)
    components = module.summarize_components(triangles)
    nonmanifold_edges = module.find_nonmanifold_edges(triangles)

    all_points = [point for triangle in triangles for point in triangle]
    minimum = tuple(min(point[axis] for point in all_points) for axis in range(3))
    maximum = tuple(max(point[axis] for point in all_points) for axis in range(3))
    dimensions = tuple(maximum[axis] - minimum[axis] for axis in range(3))

    checks = {
        "single_component": len(components) == 1,
        "manifold": len(nonmanifold_edges) == 0,
        "fits_x": dimensions[0] <= PRINT_BED_X_MM + BED_TOLERANCE_MM,
        "fits_y": dimensions[1] <= PRINT_BED_Y_MM + BED_TOLERANCE_MM,
        "on_bed_z": abs(minimum[2]) <= BED_TOLERANCE_MM,
    }
    passed = all(checks.values())
    print(
        f"{stl_path.name}: "
        f"bbox_min={tuple(round(value, 3) for value in minimum)} "
        f"bbox_max={tuple(round(value, 3) for value in maximum)} "
        f"dims={tuple(round(value, 3) for value in dimensions)} "
        f"checks={checks} result={'PASS' if passed else 'FAIL'}"
    )
    return passed


def main() -> int:
    script_dir = pathlib.Path(__file__).resolve().parent
    validator = load_mesh_validator()
    results = [
        validate_part(validator, script_dir / f"{part_name}.stl")
        for part_name in PART_NAMES
    ]
    passed_count = sum(results)
    print(f"print_bed_summary: passed={passed_count} failed={len(results) - passed_count} total={len(results)}")
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())

