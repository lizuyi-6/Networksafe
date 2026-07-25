"""Validate STL connectivity and edge manifoldness.

OpenSCAD reports volume counts during export, but this small dependency-free
check also identifies the bounding box of each disconnected component. It is
intended for enclosure export scripts and mechanical review, not mesh repair.
"""

from __future__ import annotations

import argparse
import collections
import dataclasses
import pathlib
import struct
import sys
from collections.abc import Iterable


STL_HEADER_SIZE_BYTES = 84
STL_TRIANGLE_SIZE_BYTES = 50
COORDINATE_DECIMAL_PLACES = 5

Point = tuple[float, float, float]
Edge = tuple[Point, Point]
Triangle = tuple[Point, Point, Point]


@dataclasses.dataclass(frozen=True)
class ComponentSummary:
    triangle_count: int
    minimum_point: Point
    maximum_point: Point


class DisjointSet:
    def __init__(self) -> None:
        self._parents: list[int] = []
        self._ranks: list[int] = []

    def add_item(self) -> int:
        item_index = len(self._parents)
        self._parents.append(item_index)
        self._ranks.append(0)
        return item_index

    def find_root(self, item_index: int) -> int:
        parent_index = self._parents[item_index]
        if parent_index != item_index:
            self._parents[item_index] = self.find_root(parent_index)
        return self._parents[item_index]

    def join_items(self, first_index: int, second_index: int) -> None:
        first_root = self.find_root(first_index)
        second_root = self.find_root(second_index)
        if first_root == second_root:
            return

        first_rank = self._ranks[first_root]
        second_rank = self._ranks[second_root]
        if first_rank < second_rank:
            self._parents[first_root] = second_root
        elif first_rank > second_rank:
            self._parents[second_root] = first_root
        else:
            self._parents[second_root] = first_root
            self._ranks[first_root] += 1


def normalize_point(raw_point: Iterable[float]) -> Point:
    normalized_coordinates = tuple(
        round(float(coordinate), COORDINATE_DECIMAL_PLACES)
        for coordinate in raw_point
    )
    return normalized_coordinates  # type: ignore[return-value]


def read_stl(stl_path: pathlib.Path) -> list[Triangle]:
    stl_bytes = stl_path.read_bytes()
    if len(stl_bytes) < STL_HEADER_SIZE_BYTES:
        raise ValueError("File is too small to be an STL mesh.")

    triangle_count = struct.unpack_from("<I", stl_bytes, 80)[0]
    expected_file_size = (
        STL_HEADER_SIZE_BYTES + triangle_count * STL_TRIANGLE_SIZE_BYTES
    )
    if len(stl_bytes) == expected_file_size:
        triangles: list[Triangle] = []
        for triangle_index in range(triangle_count):
            triangle_offset = (
                STL_HEADER_SIZE_BYTES + triangle_index * STL_TRIANGLE_SIZE_BYTES
            )
            vertex_offset = triangle_offset + 12
            triangle_points = tuple(
                normalize_point(
                    struct.unpack_from(
                        "<3f",
                        stl_bytes,
                        vertex_offset + vertex_index * 12,
                    )
                )
                for vertex_index in range(3)
            )
            triangles.append(triangle_points)  # type: ignore[arg-type]
        return triangles

    try:
        stl_text = stl_bytes.decode("ascii")
    except UnicodeDecodeError as decode_error:
        raise ValueError("File is neither binary nor ASCII STL.") from decode_error

    ascii_points: list[Point] = []
    for line in stl_text.splitlines():
        line_parts = line.split()
        if len(line_parts) == 4 and line_parts[0].lower() == "vertex":
            ascii_points.append(
                normalize_point(float(coordinate) for coordinate in line_parts[1:])
            )

    if not ascii_points or len(ascii_points) % 3 != 0:
        raise ValueError("ASCII STL does not contain complete triangle vertices.")

    return [
        tuple(ascii_points[point_index : point_index + 3])  # type: ignore[list-item]
        for point_index in range(0, len(ascii_points), 3)
    ]


def create_ordered_edge(first_point: Point, second_point: Point) -> Edge:
    if first_point <= second_point:
        return first_point, second_point
    return second_point, first_point


def summarize_components(triangles: list[Triangle]) -> list[ComponentSummary]:
    disjoint_set = DisjointSet()
    point_indices: dict[Point, int] = {}
    triangle_indices: list[tuple[int, int, int]] = []

    for triangle in triangles:
        current_triangle_indices: list[int] = []
        for point in triangle:
            if point not in point_indices:
                point_indices[point] = disjoint_set.add_item()
            current_triangle_indices.append(point_indices[point])

        disjoint_set.join_items(
            current_triangle_indices[0], current_triangle_indices[1]
        )
        disjoint_set.join_items(
            current_triangle_indices[1], current_triangle_indices[2]
        )
        triangle_indices.append(tuple(current_triangle_indices))  # type: ignore[arg-type]

    component_triangles: dict[int, list[int]] = collections.defaultdict(list)
    for triangle_index, current_triangle_indices in enumerate(triangle_indices):
        component_root = disjoint_set.find_root(current_triangle_indices[0])
        component_triangles[component_root].append(triangle_index)

    component_summaries: list[ComponentSummary] = []
    for component_triangle_indices in component_triangles.values():
        component_points = {
            point
            for triangle_index in component_triangle_indices
            for point in triangles[triangle_index]
        }
        minimum_point = tuple(
            min(point[axis_index] for point in component_points)
            for axis_index in range(3)
        )
        maximum_point = tuple(
            max(point[axis_index] for point in component_points)
            for axis_index in range(3)
        )
        component_summaries.append(
            ComponentSummary(
                triangle_count=len(component_triangle_indices),
                minimum_point=minimum_point,  # type: ignore[arg-type]
                maximum_point=maximum_point,  # type: ignore[arg-type]
            )
        )

    return sorted(
        component_summaries,
        key=lambda component: component.triangle_count,
        reverse=True,
    )


def find_nonmanifold_edges(triangles: list[Triangle]) -> list[tuple[Edge, int]]:
    edge_counts: collections.Counter[Edge] = collections.Counter()
    for first_point, second_point, third_point in triangles:
        edge_counts.update(
            [
                create_ordered_edge(first_point, second_point),
                create_ordered_edge(second_point, third_point),
                create_ordered_edge(third_point, first_point),
            ]
        )

    return [
        (edge, edge_count)
        for edge, edge_count in edge_counts.items()
        if edge_count != 2
    ]


def validate_stl(stl_path: pathlib.Path) -> bool:
    triangles = read_stl(stl_path)
    component_summaries = summarize_components(triangles)
    nonmanifold_edges = find_nonmanifold_edges(triangles)

    print(f"{stl_path.name}: {len(triangles)} triangles")
    print(f"  connected components: {len(component_summaries)}")
    for component_index, component in enumerate(component_summaries, start=1):
        print(
            f"  component {component_index}: "
            f"{component.triangle_count} triangles, "
            f"min={component.minimum_point}, max={component.maximum_point}"
        )
    print(f"  non-manifold/boundary edges: {len(nonmanifold_edges)}")
    for edge, incidence_count in nonmanifold_edges[:10]:
        print(f"    edge={edge}, triangle incidence={incidence_count}")

    return len(component_summaries) == 1 and not nonmanifold_edges


def parse_arguments() -> argparse.Namespace:
    argument_parser = argparse.ArgumentParser(
        description="Validate STL connectivity and manifold edges."
    )
    argument_parser.add_argument(
        "stl_paths",
        nargs="+",
        type=pathlib.Path,
        help="ASCII or binary STL files exported by OpenSCAD.",
    )
    return argument_parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    all_meshes_are_valid = True

    for stl_path in arguments.stl_paths:
        try:
            mesh_is_valid = validate_stl(stl_path)
        except (OSError, ValueError) as validation_error:
            print(f"{stl_path}: {validation_error}", file=sys.stderr)
            mesh_is_valid = False
        all_meshes_are_valid = all_meshes_are_valid and mesh_is_valid

    return 0 if all_meshes_are_valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
