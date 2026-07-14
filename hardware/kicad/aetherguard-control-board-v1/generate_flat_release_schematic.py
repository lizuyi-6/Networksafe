#!/usr/bin/env python3
from __future__ import annotations

import copy
from pathlib import Path
import uuid

import normalize_child_sheets as n


PROJECT_DIR = Path(__file__).resolve().parent
OUTPUT_PATH = PROJECT_DIR / "aetherguard-control-board-v1-flat.kicad_sch"
ROOT_UUID = "6d80af17-cf69-4f8a-a6af-4e8158b3b001"

# Spread the four child pages onto one manufacturing-oriented overview sheet.
LAYOUT = [
    ("sheets/power-input.kicad_sch", 0.0, 0.0),
    ("sheets/mcu-usb-secure.kicad_sch", 260.0, 0.0),
    ("sheets/ui-panel.kicad_sch", 0.0, 200.0),
    ("sheets/isolated-io.kicad_sch", 260.0, 200.0),
]

OFFSET_HEADS = {"at", "xy", "start", "end", "mid", "center"}


def is_number_atom(node: n.Node) -> bool:
    text = n.as_atom(node)
    if text is None:
        return False
    try:
        float(text)
    except ValueError:
        return False
    return True


def offset_node(node: n.Node, dx: float, dy: float) -> None:
    if isinstance(node, (n.Atom, n.String)):
        return
    if not node:
        return

    head = n.as_atom(node[0])
    if head in OFFSET_HEADS and len(node) >= 3 and is_number_atom(node[1]) and is_number_atom(node[2]):
        node[1] = n.Atom(f"{float(n.as_atom(node[1])) + dx:.2f}".rstrip("0").rstrip("."))
        node[2] = n.Atom(f"{float(n.as_atom(node[2])) + dy:.2f}".rstrip("0").rstrip("."))

    for child in node:
        offset_node(child, dx, dy)


def top_level_items(root: list[n.Node]) -> list[list[n.Node]]:
    items: list[list[n.Node]] = []
    for entry in root[1:]:
        if not isinstance(entry, list) or not entry:
            continue
        head = n.as_atom(entry[0])
        if head in {
            "version",
            "generator",
            "generator_version",
            "uuid",
            "paper",
            "title_block",
            "lib_symbols",
            "sheet_instances",
            "embedded_fonts",
        }:
            continue
        items.append(entry)
    return items


def build_root() -> list[n.Node]:
    return [
        n.Atom("kicad_sch"),
        [n.Atom("version"), n.Atom("20250114")],
        [n.Atom("generator"), n.String("eeschema")],
        [n.Atom("generator_version"), n.String("9.0")],
        [n.Atom("uuid"), n.String(ROOT_UUID)],
        [n.Atom("paper"), n.String("A1")],
        [
            n.Atom("title_block"),
            [n.Atom("title"), n.String("AetherGuard Control Board v1")],
            [n.Atom("date"), n.String("2026-03-22")],
            [n.Atom("rev"), n.String("v1-flat-release")],
            [n.Atom("comment"), n.Atom("1"), n.String("Flattened export source for BOM/netlist/ERC and manufacturing release")],
        ],
    ]


def main() -> int:
    root = build_root()

    for rel_path, dx, dy in LAYOUT:
        sheet_root = n.parse((PROJECT_DIR / rel_path).read_text(encoding="utf-8"))
        for entry in top_level_items(sheet_root):
            cloned = copy.deepcopy(entry)
            offset_node(cloned, dx, dy)
            root.append(cloned)

    root.append(
        [
            n.Atom("text"),
            n.String("Flattened release schematic generated from child sheets. Use this file for ERC, BOM, and netlist export."),
            [n.Atom("at"), n.Atom("20"), n.Atom("16"), n.Atom("0")],
            [n.Atom("effects"), [n.Atom("font"), [n.Atom("size"), n.Atom("1.27"), n.Atom("1.27")]], [n.Atom("justify"), n.Atom("left")]],
            [n.Atom("uuid"), n.String(str(uuid.uuid4()))],
        ]
    )
    root.append([n.Atom("sheet_instances"), [n.Atom("path"), n.String("/"), [n.Atom("page"), n.String("1")]]])
    root.append([n.Atom("embedded_fonts"), n.Atom("no")])
    OUTPUT_PATH.write_text(n.dump(root) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
