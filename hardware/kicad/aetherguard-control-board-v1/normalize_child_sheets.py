#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Atom:
    text: str


@dataclass(frozen=True)
class String:
    text: str


Node = list | Atom | String


class ParseError(RuntimeError):
    pass


def tokenize(text: str) -> list[tuple[str, str]]:
    tokens: list[tuple[str, str]] = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch in " \t\r\n":
            i += 1
            continue
        if ch == "(":
            tokens.append(("LPAREN", ch))
            i += 1
            continue
        if ch == ")":
            tokens.append(("RPAREN", ch))
            i += 1
            continue
        if ch == '"':
            i += 1
            buf: list[str] = []
            while i < n:
                ch = text[i]
                if ch == "\\":
                    if i + 1 >= n:
                        raise ParseError("unterminated escape sequence")
                    buf.append(text[i + 1])
                    i += 2
                    continue
                if ch == '"':
                    i += 1
                    break
                buf.append(ch)
                i += 1
            else:
                raise ParseError("unterminated string")
            tokens.append(("STRING", "".join(buf)))
            continue
        start = i
        while i < n and text[i] not in "()\" \t\r\n":
            i += 1
        tokens.append(("ATOM", text[start:i]))
    return tokens


def parse_node(tokens: list[tuple[str, str]], pos: int) -> tuple[Node, int]:
    kind, value = tokens[pos]
    if kind == "ATOM":
        return Atom(value), pos + 1
    if kind == "STRING":
        return String(value), pos + 1
    if kind != "LPAREN":
        raise ParseError(f"unexpected token {kind!r}")

    pos += 1
    items: list[Node] = []
    while pos < len(tokens) and tokens[pos][0] != "RPAREN":
        node, pos = parse_node(tokens, pos)
        items.append(node)
    if pos >= len(tokens):
        raise ParseError("missing closing parenthesis")
    return items, pos + 1


def parse(text: str) -> list[Node]:
    tokens = tokenize(text)
    node, pos = parse_node(tokens, 0)
    if pos != len(tokens):
        raise ParseError("extra tokens after root node")
    if not isinstance(node, list):
        raise ParseError("root node is not a list")
    return node


def dump_atom(node: Atom | String) -> str:
    if isinstance(node, Atom):
        return node.text
    escaped = node.text.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def dump(node: Node, indent: int = 0) -> str:
    if isinstance(node, (Atom, String)):
        return dump_atom(node)
    if not node:
        return "()"

    prefix: list[str] = []
    rest: list[Node] = []
    seen_list = False
    for child in node:
        if not seen_list and isinstance(child, (Atom, String)):
            prefix.append(dump_atom(child))
            continue
        seen_list = True
        rest.append(child)

    if not rest:
        return "(" + " ".join(prefix) + ")"

    line0 = "(" + " ".join(prefix)
    lines = [line0]
    pad = "\t" * (indent + 1)
    for child in rest:
        lines.append(pad + dump(child, indent + 1))
    lines[-1] += ")"
    return "\n".join(lines)


def as_atom(node: Node) -> str | None:
    if isinstance(node, Atom):
        return node.text
    return None


def as_string(node: Node) -> str | None:
    if isinstance(node, String):
        return node.text
    return None


def child_map(entries: list[Node], key: str) -> list[list[Node]]:
    found: list[list[Node]] = []
    for entry in entries:
        if isinstance(entry, list) and entry:
            head = as_atom(entry[0])
            if head == key:
                found.append(entry)
    return found


def first_child(entries: list[Node], key: str) -> list[Node] | None:
    matches = child_map(entries, key)
    return matches[0] if matches else None


def is_head(node: Node, key: str) -> bool:
    return isinstance(node, list) and bool(node) and as_atom(node[0]) == key


def parse_int(node: Node, default: int = 1) -> int:
    value = as_atom(node)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def pin_numbers_for_symbol(lib_symbol: list[Node]) -> dict[int, list[str]]:
    outer_name = as_string(lib_symbol[1]) if len(lib_symbol) > 1 else None
    if not outer_name:
        return {}
    bare_name = outer_name.split(":")[-1]

    by_unit: dict[int, list[str]] = {}
    for entry in lib_symbol[2:]:
        if not isinstance(entry, list) or not entry:
            continue
        if as_atom(entry[0]) != "symbol":
            continue
        sub_name = as_string(entry[1]) if len(entry) > 1 else None
        if not sub_name:
            continue
        if sub_name.startswith(f"{outer_name}_"):
            suffix = sub_name[len(outer_name) + 1 :]
        elif sub_name.startswith(f"{bare_name}_"):
            suffix = sub_name[len(bare_name) + 1 :]
        else:
            continue
        parts = suffix.split("_")
        if not parts or not parts[0].isdigit():
            continue
        unit = int(parts[0])
        pins = by_unit.setdefault(unit, [])
        for sub_entry in entry[2:]:
            if not isinstance(sub_entry, list) or not sub_entry:
                continue
            if as_atom(sub_entry[0]) != "pin":
                continue
            number = None
            for child in sub_entry[1:]:
                if isinstance(child, list) and child and as_atom(child[0]) == "number":
                    number = as_string(child[1]) if len(child) > 1 else None
                    break
            if number is not None and number not in pins:
                pins.append(number)
    return by_unit


def property_value(entries: list[Node], name: str) -> str | None:
    for entry in entries:
        if not isinstance(entry, list) or not entry:
            continue
        if as_atom(entry[0]) != "property":
            continue
        if len(entry) > 2 and as_string(entry[1]) == name:
            return as_string(entry[2])
    return None


def build_lib_pin_map(root: list[Node]) -> dict[str, dict[int, list[str]]]:
    lib_symbols = first_child(root[1:], "lib_symbols")
    if lib_symbols is None:
        return {}
    pin_map: dict[str, dict[int, list[str]]] = {}
    for entry in lib_symbols[1:]:
        if not isinstance(entry, list) or not entry:
            continue
        if as_atom(entry[0]) != "symbol":
            continue
        symbol_name = as_string(entry[1]) if len(entry) > 1 else None
        if symbol_name:
            pins = pin_numbers_for_symbol(entry)
            pin_map[symbol_name] = pins
            if ":" in symbol_name:
                pin_map[symbol_name.split(":")[-1]] = pins
    return pin_map


def build_lib_description_map(root: list[Node]) -> dict[str, str]:
    lib_symbols = first_child(root[1:], "lib_symbols")
    if lib_symbols is None:
        return {}
    descriptions: dict[str, str] = {}
    for entry in lib_symbols[1:]:
        if not isinstance(entry, list) or not entry:
            continue
        if as_atom(entry[0]) != "symbol":
            continue
        symbol_name = as_string(entry[1]) if len(entry) > 1 else None
        if symbol_name:
            description = property_value(entry[2:], "Description") or ""
            descriptions[symbol_name] = description
            if ":" in symbol_name:
                descriptions[symbol_name.split(":")[-1]] = description
    return descriptions


def build_placed_lib_id_map(root: list[Node]) -> dict[str, str]:
    placed: dict[str, str] = {}
    for entry in root:
        if not is_placed_symbol(entry):
            continue
        lib_id_node = first_child(entry[1:], "lib_id")
        if lib_id_node is None or len(lib_id_node) < 2:
            continue
        lib_id = as_string(lib_id_node[1])
        if lib_id:
            placed[lib_id.split(":")[-1]] = lib_id
    return placed


def normalize_lib_symbols(root: list[Node], placed_lib_ids: dict[str, str]) -> bool:
    lib_symbols = first_child(root[1:], "lib_symbols")
    if lib_symbols is None:
        raise ParseError("missing lib_symbols block")
    changed = False
    for entry in lib_symbols[1:]:
        if not isinstance(entry, list) or not entry or as_atom(entry[0]) != "symbol":
            continue
        symbol_name = as_string(entry[1]) if len(entry) > 1 else None
        if not symbol_name:
            continue
        normalized = placed_lib_ids.get(symbol_name, symbol_name)
        if normalized != symbol_name:
            entry[1] = String(normalized)
            symbol_name = normalized
            changed = True

        outer_name = symbol_name
        bare_name = outer_name.split(":")[-1]
        for child in entry[2:]:
            if not isinstance(child, list) or not child or as_atom(child[0]) != "symbol":
                continue
            child_name = as_string(child[1]) if len(child) > 1 else None
            if not child_name:
                continue
            if child_name.startswith(f"{outer_name}_"):
                continue
            if child_name.startswith(f"{bare_name}_"):
                suffix = child_name[len(bare_name) :]
                child[1] = String(f"{outer_name}{suffix}")
                changed = True
    return changed


def is_placed_symbol(entry: Node) -> bool:
    if not isinstance(entry, list) or not entry or as_atom(entry[0]) != "symbol":
        return False
    return first_child(entry[1:], "lib_id") is not None


def get_at(entry: list[Node]) -> list[Node] | None:
    return first_child(entry[1:], "at")


def get_pts(entry: list[Node]) -> list[Node] | None:
    return first_child(entry[1:], "pts")


def set_at(entry: list[Node], x: str, y: str, rotation: str | None = None) -> bool:
    at = get_at(entry)
    if at is None or len(at) < 4:
        return False
    changed = False
    if as_atom(at[1]) != x:
        at[1] = Atom(x)
        changed = True
    if as_atom(at[2]) != y:
        at[2] = Atom(y)
        changed = True
    if rotation is not None and len(at) > 3 and as_atom(at[3]) != rotation:
        at[3] = Atom(rotation)
        changed = True
    return changed


def get_wire_coords(entry: list[Node]) -> tuple[str, str, str, str] | None:
    pts = get_pts(entry)
    if pts is None or len(pts) != 3:
        return None
    first = pts[1]
    second = pts[2]
    if not is_head(first, "xy") or not is_head(second, "xy"):
        return None
    if len(first) < 3 or len(second) < 3:
        return None
    x1 = as_atom(first[1])
    y1 = as_atom(first[2])
    x2 = as_atom(second[1])
    y2 = as_atom(second[2])
    if None in (x1, y1, x2, y2):
        return None
    return x1, y1, x2, y2


def set_wire_coords(entry: list[Node], x1: str, y1: str, x2: str, y2: str) -> bool:
    pts = get_pts(entry)
    if pts is None or len(pts) != 3:
        return False
    first = pts[1]
    second = pts[2]
    if not is_head(first, "xy") or not is_head(second, "xy"):
        return False
    changed = False
    values = ((first, x1, y1), (second, x2, y2))
    for node, x, y in values:
        if as_atom(node[1]) != x:
            node[1] = Atom(x)
            changed = True
        if as_atom(node[2]) != y:
            node[2] = Atom(y)
            changed = True
    return changed


def matches_at(entry: list[Node], x: str, y: str) -> bool:
    at = get_at(entry)
    if at is None or len(at) < 3:
        return False
    return as_atom(at[1]) == x and as_atom(at[2]) == y


def matches_label(entry: Node, name: str, x: str, y: str) -> bool:
    if not is_head(entry, "global_label"):
        return False
    assert isinstance(entry, list)
    return as_string(entry[1]) == name and matches_at(entry, x, y)


def matches_wire(entry: Node, x1: str, y1: str, x2: str, y2: str) -> bool:
    if not is_head(entry, "wire"):
        return False
    assert isinstance(entry, list)
    return get_wire_coords(entry) == (x1, y1, x2, y2)


def get_uuid(entry: Node) -> str | None:
    if not isinstance(entry, list):
        return None
    uuid_node = first_child(entry[1:], "uuid")
    if uuid_node is None or len(uuid_node) < 2:
        return None
    return as_string(uuid_node[1])


def set_entry_by_uuid(
    root: list[Node],
    target_uuid: str,
    *,
    at: tuple[str, str, str | None] | None = None,
    wire: tuple[str, str, str, str] | None = None,
) -> bool:
    changed = False
    for entry in root:
        if not isinstance(entry, list):
            continue
        if get_uuid(entry) != target_uuid:
            continue
        if at is not None:
            x, y, rotation = at
            changed = set_at(entry, x, y, rotation) or changed
        if wire is not None:
            changed = set_wire_coords(entry, *wire) or changed
    return changed


def set_symbol_lib_id_by_uuid(root: list[Node], target_uuid: str, lib_id: str) -> bool:
    changed = False
    for entry in root:
        if not is_placed_symbol(entry):
            continue
        assert isinstance(entry, list)
        if get_uuid(entry) != target_uuid:
            continue
        lib_id_node = first_child(entry[1:], "lib_id")
        if lib_id_node is None or len(lib_id_node) < 2:
            continue
        if as_string(lib_id_node[1]) != lib_id:
            lib_id_node[1] = String(lib_id)
            changed = True
    return changed


def set_symbol_property_at_by_uuid(
    root: list[Node],
    target_uuid: str,
    property_name: str,
    x: str,
    y: str,
    rotation: str | None = None,
) -> bool:
    changed = False
    for entry in root:
        if not is_placed_symbol(entry):
            continue
        assert isinstance(entry, list)
        if get_uuid(entry) != target_uuid:
            continue
        for child in entry[1:]:
            if not isinstance(child, list) or not child:
                continue
            if as_atom(child[0]) != "property" or len(child) < 3 or as_string(child[1]) != property_name:
                continue
            changed = set_at(child, x, y, rotation) or changed
    return changed


def set_label_name_by_uuid(root: list[Node], target_uuid: str, name: str) -> bool:
    changed = False
    for entry in root:
        if not isinstance(entry, list):
            continue
        if get_uuid(entry) != target_uuid or not is_head(entry, "global_label"):
            continue
        if as_string(entry[1]) != name:
            entry[1] = String(name)
            changed = True
    return changed


def ensure_global_label(
    root: list[Node],
    name: str,
    x: str,
    y: str,
    rotation: str = "0",
) -> bool:
    for entry in root:
        if matches_label(entry, name, x, y):
            return False
    root.append(
        [
            Atom("global_label"),
            String(name),
            [Atom("shape"), Atom("bidirectional")],
            [Atom("at"), Atom(x), Atom(y), Atom(rotation)],
            [Atom("fields_autoplaced"), Atom("yes")],
            [
                Atom("effects"),
                [Atom("font"), [Atom("size"), Atom("1"), Atom("1")]],
                [Atom("justify"), Atom("left")],
            ],
            [Atom("uuid"), String(str(uuid.uuid4()))],
        ]
    )
    return True


def ensure_wire(root: list[Node], x1: str, y1: str, x2: str, y2: str) -> bool:
    for entry in root:
        if matches_wire(entry, x1, y1, x2, y2):
            return False
    root.append(
        [
            Atom("wire"),
            [
                Atom("pts"),
                [Atom("xy"), Atom(x1), Atom(y1)],
                [Atom("xy"), Atom(x2), Atom(y2)],
            ],
            [Atom("stroke"), [Atom("width"), Atom("0")], [Atom("type"), Atom("solid")]],
            [Atom("uuid"), String(str(uuid.uuid4()))],
        ]
    )
    return True


def ensure_no_connect(root: list[Node], x: str, y: str) -> bool:
    for entry in root:
        if is_head(entry, "no_connect") and matches_at(entry, x, y):
            return False
    root.append(
        [
            Atom("no_connect"),
            [Atom("at"), Atom(x), Atom(y)],
            [Atom("uuid"), String(str(uuid.uuid4()))],
        ]
    )
    return True


def remove_child_sheet_instances(root: list[Node]) -> bool:
    matches = child_map(root[1:], "sheet_instances")
    if not matches:
        return False

    changed = False
    for entry in matches:
        root.remove(entry)
        changed = True
    return changed


def reorder_schematic_sections(root: list[Node]) -> bool:
    section_order = {
        "junction": 10,
        "no_connect": 20,
        "bus_entry": 30,
        "wire": 40,
        "bus": 50,
        "image": 60,
        "polyline": 70,
        "bezier": 80,
        "rectangle": 90,
        "circle": 100,
        "arc": 110,
        "text": 120,
        "label": 130,
        "global_label": 140,
        "hierarchical_label": 150,
        "symbol": 160,
        "sheet": 170,
        "sheet_instances": 180,
    }
    preamble_heads = {"version", "generator", "generator_version", "uuid", "paper", "title_block", "lib_symbols"}
    trailing_heads = {"embedded_fonts"}

    original = copy.deepcopy(root)
    preamble: list[Node] = []
    body: list[tuple[int, int, Node]] = []
    trailing: list[Node] = []

    for idx, entry in enumerate(root[1:]):
        if not isinstance(entry, list) or not entry:
            body.append((1000, idx, entry))
            continue
        head = as_atom(entry[0]) or ""
        if head in preamble_heads:
            preamble.append(entry)
            continue
        if head in trailing_heads:
            trailing.append(entry)
            continue
        body.append((section_order.get(head, 1000), idx, entry))

    body.sort(key=lambda item: (item[0], item[1]))
    reordered = [root[0], *preamble, *(entry for _, _, entry in body), *trailing]
    root[:] = reordered
    return root != original


def move_label(
    entry: Node,
    name: str,
    old_x: str,
    old_y: str,
    new_x: str,
    new_y: str,
    rotation: str | None = None,
) -> bool:
    if not matches_label(entry, name, old_x, old_y):
        return False
    assert isinstance(entry, list)
    return set_at(entry, new_x, new_y, rotation)


def move_wire(
    entry: Node,
    old_x1: str,
    old_y1: str,
    old_x2: str,
    old_y2: str,
    new_x1: str,
    new_y1: str,
    new_x2: str,
    new_y2: str,
) -> bool:
    if not matches_wire(entry, old_x1, old_y1, old_x2, old_y2):
        return False
    assert isinstance(entry, list)
    return set_wire_coords(entry, new_x1, new_y1, new_x2, new_y2)


def move_label_and_wire(
    root: list[Node],
    name: str,
    old_x: str,
    old_y: str,
    new_x: str,
    new_y: str,
    wire_to_x: str,
) -> bool:
    changed = False
    for entry in root:
        changed = move_label(entry, name, old_x, old_y, new_x, new_y) or changed
        changed = move_wire(entry, old_x, old_y, wire_to_x, old_y, new_x, new_y, wire_to_x, new_y) or changed
    return changed


def remove_matching_entries(root: list[Node], predicate) -> bool:
    original_len = len(root)
    root[:] = [entry for entry in root if not predicate(entry)]
    return len(root) != original_len


def fix_ui_panel(root: list[Node]) -> bool:
    changed = False
    changed = set_entry_by_uuid(root, "620c6a73-ec38-41d9-be0e-ac90897128e9", at=("45.72", "53.34", "0")) or changed
    changed = set_entry_by_uuid(root, "7dd7c2c7-b425-49aa-87ce-5dc821ccfb16", wire=("45.72", "53.34", "50.8", "53.34")) or changed
    changed = set_entry_by_uuid(root, "f0d9e99b-ea6c-40dd-b3f5-c00f9039f361", at=("45.72", "58.42", "0")) or changed
    changed = set_entry_by_uuid(root, "3a66d2c3-3286-46f3-ba0d-cfc195d9cf02", wire=("45.72", "58.42", "50.8", "58.42")) or changed
    changed = set_entry_by_uuid(root, "7c62cd6a-23ad-4498-8112-1b37589674dc", at=("66.04", "58.42", "0")) or changed
    changed = set_entry_by_uuid(root, "b3530d2e-d184-404e-8611-7162c4f680ef", wire=("66.04", "58.42", "60.96", "58.42")) or changed
    changed = remove_matching_entries(
        root,
        lambda entry: matches_wire(entry, "60.96", "58.42", "60.96", "53.34"),
    ) or changed
    return changed


def fix_mcu_usb_secure(root: list[Node]) -> bool:
    changed = False
    changed = set_label_name_by_uuid(root, "6f925a66-2c50-4138-8b21-cec465cb3e5c", "3V3") or changed
    changed = set_label_name_by_uuid(root, "a2f8f163-20c6-4274-af29-e86edf7b22ba", "GND") or changed

    label_updates = {
        "6f925a66-2c50-4138-8b21-cec465cb3e5c": ("111.76", "54.61", "90"),
        "a2f8f163-20c6-4274-af29-e86edf7b22ba": ("111.76", "118.11", "90"),
        "960f998e-1b48-4b35-b379-ceaeee59dff3": ("83.82", "66.04", "0"),
        "fd46554b-e16f-4de7-8709-7c9256aaf7e5": ("83.82", "71.12", "0"),
        "ba6dba7e-e430-43ca-aaff-7e99c252d4eb": ("83.82", "73.66", "0"),
        "4348c1d4-6ea5-4677-8ca4-34b7bf290ca2": ("83.82", "76.2", "0"),
        "941ea149-8bb6-4987-b771-70567e6826a7": ("139.7", "66.04", "0"),
        "4e00669e-c391-46d8-af43-9d52de6b21d3": ("139.7", "68.58", "0"),
        "ba8422fc-4037-407f-a4a8-26cd2dbd06d7": ("139.7", "71.12", "0"),
        "13bcb335-6cde-4302-843e-ae8de5a07fdf": ("139.7", "73.66", "0"),
        "ab4c428b-e124-4b79-a5a8-ff394736efb0": ("139.7", "76.2", "0"),
        "44306a95-d782-4bc5-abba-15a29973da89": ("139.7", "78.74", "0"),
        "ee12d41b-b82f-4a10-9bdb-0f869f555970": ("139.7", "81.28", "0"),
        "4d6635a1-6a3c-454a-acb3-83b486eb34c2": ("139.7", "83.82", "0"),
        "54d216b3-1fd5-4077-8ab9-25928852b55f": ("139.7", "86.36", "0"),
        "cd807eda-0a0e-4c37-b4b9-f148120d8651": ("139.7", "88.9", "0"),
        "66ce36f7-76ac-45ba-9855-069e4c4458a0": ("139.7", "91.44", "0"),
        "e094c6ef-b406-4e31-ac0a-7491771c69aa": ("139.7", "93.98", "0"),
        "d6ef77c4-04d1-4b0f-a680-9067f74b3e50": ("139.7", "96.52", "0"),
        "d544cb12-650c-4893-82fd-63ca0d9c24e8": ("172.72", "71.12", "0"),
        "9f03ebde-9c35-48a6-8e48-9e74737570f3": ("193.04", "63.5", "0"),
        "98729258-8c84-471f-bd0e-d87c0fd6571c": ("193.04", "66.04", "0"),
        "3c69677a-58d5-4307-97bd-ad96790e8cc4": ("193.04", "71.12", "0"),
        "6e291663-ccb2-415e-948c-5919f25bde0a": ("27.94", "130.81", "0"),
        "891cdf54-28b4-4115-ada6-4610739c1c87": ("27.94", "133.35", "0"),
        "6d390e95-c1d2-4b45-be65-cabe5bb1690d": ("27.94", "135.89", "0"),
        "636b83e7-7c22-4234-8ba4-805ec5f57a10": ("27.94", "138.43", "0"),
        "9a8cec9d-986b-4999-8788-a45636759d36": ("27.94", "140.97", "0"),
        "ceae60d6-f695-426d-84f6-d4cb55a7d9be": ("27.94", "143.51", "0"),
    }
    wire_updates = {
        "21c85709-58ce-4698-b1ba-da8e7486defd": ("83.82", "66.04", "88.9", "66.04"),
        "61cb86be-7eb7-456b-8135-f53d034428dc": ("83.82", "71.12", "88.9", "71.12"),
        "5c326b25-a43f-4bfe-9af5-3a50fd71e4e5": ("83.82", "73.66", "88.9", "73.66"),
        "b5608145-f0b2-45de-838b-130ddc897bea": ("83.82", "76.2", "88.9", "76.2"),
        "d0417fe4-4f0f-4242-a246-4dd716f75887": ("139.7", "66.04", "134.62", "66.04"),
        "18a354fa-cc0e-4a78-a18a-81ee970f142c": ("139.7", "68.58", "134.62", "68.58"),
        "1a2b6915-0d7b-4744-85f7-b2b648ab733e": ("139.7", "71.12", "134.62", "71.12"),
        "af93bb68-53cf-4ab8-a554-ef2bb5fce082": ("139.7", "73.66", "134.62", "73.66"),
        "50b6eb9c-bc70-4e65-a7d1-b40baecda358": ("139.7", "76.2", "134.62", "76.2"),
        "165bd4ff-6321-4028-899d-a3027a7e9695": ("139.7", "78.74", "134.62", "78.74"),
        "71b67372-68ca-4413-a4cc-bb67577d19bb": ("139.7", "81.28", "134.62", "81.28"),
        "e1351d69-103b-4ba2-9dbe-abc43c09181f": ("139.7", "83.82", "134.62", "83.82"),
        "064b5e66-517a-4ed1-bb2e-4b20e65c4965": ("139.7", "86.36", "134.62", "86.36"),
        "3c207ad6-65d8-4a9d-a59c-19c0079e7fcf": ("139.7", "88.9", "134.62", "88.9"),
        "73cd3f43-6b57-4e3d-9528-c2bd44d121ee": ("139.7", "91.44", "134.62", "91.44"),
        "5f36fc39-c0e4-421b-8a0d-9d565eca8197": ("139.7", "93.98", "134.62", "93.98"),
        "687428b9-a823-4864-9bed-e910530048dc": ("139.7", "96.52", "134.62", "96.52"),
        "e4ce2b12-7bd1-4955-a88b-d8a68d1b7f07": ("172.72", "71.12", "177.8", "71.12"),
        "65a054d2-c71f-4607-8fb5-117470124749": ("193.04", "63.5", "187.96", "63.5"),
        "d5c1ed1c-7e62-412e-bc2f-9df103dcee4e": ("193.04", "66.04", "187.96", "66.04"),
        "0e608cb7-0625-4ffa-9bd2-279ed5ab281f": ("193.04", "71.12", "187.96", "71.12"),
        "39eac6b5-fdea-4698-bbfd-607f3b3e8b83": ("27.94", "130.81", "33.02", "130.81"),
        "37cc1953-d05d-472b-846b-77832661f4a5": ("27.94", "133.35", "33.02", "133.35"),
        "650ad119-2285-4d0d-bc2e-002b7b332d9c": ("27.94", "135.89", "33.02", "135.89"),
        "78a06ac3-18da-4e58-ab42-7c277e2bbc1a": ("27.94", "138.43", "33.02", "138.43"),
        "1f905184-bb33-4196-ba90-44af475bfab1": ("27.94", "140.97", "33.02", "140.97"),
        "2e32a327-51d2-4d7e-8926-7b70e568093a": ("27.94", "143.51", "33.02", "143.51"),
    }
    for target_uuid, target_at in label_updates.items():
        changed = set_entry_by_uuid(root, target_uuid, at=target_at) or changed
    for target_uuid, target_wire in wire_updates.items():
        changed = set_entry_by_uuid(root, target_uuid, wire=target_wire) or changed

    changed = remove_matching_entries(
        root,
        lambda entry: matches_label(entry, "ESP_BOOT", "83.82", "104.14")
        or matches_wire(entry, "83.82", "104.14", "88.9", "104.14"),
    ) or changed
    changed = ensure_global_label(root, "ESP_BOOT", "83.82", "68.58") or changed
    changed = ensure_wire(root, "83.82", "68.58", "88.9", "68.58") or changed

    changed = set_entry_by_uuid(root, "a1c81e79-3a53-427c-afec-a173ae013c35", at=("177.8", "63.5", None)) or changed
    changed = set_entry_by_uuid(root, "a7d86bc4-10b4-4a38-8451-6f18ba131632", at=("177.8", "66.04", None)) or changed
    changed = set_entry_by_uuid(root, "575b8cd7-88c8-4a1b-8d19-c3a38847fe1a", at=("177.8", "68.58", None)) or changed
    changed = set_entry_by_uuid(root, "3c669e4c-c2cb-4ac1-8968-d12c67613ef0", at=("187.96", "68.58", None)) or changed

    changed = remove_matching_entries(
        root,
        lambda entry: matches_wire(entry, "88.9", "66.04", "88.9", "106.68")
        or matches_wire(entry, "88.9", "71.12", "88.9", "101.6")
        or matches_wire(entry, "88.9", "73.66", "88.9", "99.06")
        or matches_wire(entry, "88.9", "76.2", "88.9", "96.52")
        or matches_wire(entry, "134.62", "66.04", "134.62", "106.68")
        or matches_wire(entry, "134.62", "68.58", "134.62", "104.14")
        or matches_wire(entry, "134.62", "71.12", "134.62", "101.6")
        or matches_wire(entry, "134.62", "73.66", "134.62", "99.06")
        or matches_wire(entry, "177.8", "63.5", "177.8", "66.04")
        or matches_wire(entry, "177.8", "68.58", "177.8", "66.04")
        or matches_wire(entry, "177.8", "71.12", "177.8", "66.04")
        or matches_wire(entry, "187.96", "63.5", "187.96", "73.66")
        or matches_wire(entry, "187.96", "68.58", "187.96", "66.04"),
    ) or changed

    return changed


def fix_power_input(root: list[Node]) -> bool:
    changed = False
    changed = set_symbol_lib_id_by_uuid(root, "5c4a0926-d202-49fd-ac26-2f156946fda8", "aetherguard-control-board-v1:AG_PWR_FLAG") or changed
    changed = set_symbol_lib_id_by_uuid(root, "4b539c1c-4137-46df-93a2-cbcb10712c65", "aetherguard-control-board-v1:AG_DIODE") or changed
    changed = set_symbol_lib_id_by_uuid(root, "1f524404-eabe-4c10-a5c6-4e2c73e29c4d", "aetherguard-control-board-v1:AG_DIODE") or changed
    changed = set_entry_by_uuid(root, "5c4a0926-d202-49fd-ac26-2f156946fda8", at=("82.55", "147.32", "0")) or changed
    changed = set_symbol_property_at_by_uuid(root, "5c4a0926-d202-49fd-ac26-2f156946fda8", "Reference", "80.01", "142.24", "0") or changed
    changed = set_symbol_property_at_by_uuid(root, "5c4a0926-d202-49fd-ac26-2f156946fda8", "Value", "82.55", "152.4", "0") or changed
    changed = set_symbol_property_at_by_uuid(root, "5c4a0926-d202-49fd-ac26-2f156946fda8", "Footprint", "82.55", "154.94", "0") or changed
    changed = set_symbol_property_at_by_uuid(root, "5c4a0926-d202-49fd-ac26-2f156946fda8", "Datasheet", "82.55", "157.48", "0") or changed
    changed = set_symbol_property_at_by_uuid(root, "5c4a0926-d202-49fd-ac26-2f156946fda8", "Description", "82.55", "157.48", "0") or changed
    changed = set_label_name_by_uuid(root, "2caad160-ef4d-4eea-95aa-ffca44ce05af", "VIN_EXT_PROT") or changed
    changed = set_label_name_by_uuid(root, "671840a1-949a-4761-a6fa-34ff18042d37", "VIN_EXT_PROT") or changed
    changed = set_label_name_by_uuid(root, "24f58d6c-c3b7-44f4-81fe-f31dde4457c8", "GND") or changed
    changed = set_label_name_by_uuid(root, "adb5f9a3-9d99-4945-9882-f47c87aa8162", "BUCK_FB") or changed
    changed = set_label_name_by_uuid(root, "55e767a7-c3bb-4f40-8856-ea2616f71818", "BUCK_SW") or changed

    label_targets = {
        "2caad160-ef4d-4eea-95aa-ffca44ce05af": ("101.6", "137.16", "0"),
        "671840a1-949a-4761-a6fa-34ff18042d37": ("101.6", "139.7", "0"),
        "24f58d6c-c3b7-44f4-81fe-f31dde4457c8": ("101.6", "144.78", "0"),
        "adb5f9a3-9d99-4945-9882-f47c87aa8162": ("121.92", "139.7", "0"),
        "55e767a7-c3bb-4f40-8856-ea2616f71818": ("121.92", "144.78", "0"),
        "88843035-7031-4d5b-b446-2e03d8eae9f7": ("163.83", "97.79", "0"),
        "2eb1785f-eaf1-4db1-b696-bdfa51d16a07": ("163.83", "100.33", "0"),
        "2b8e45f1-da41-4dcf-9daa-856ddb9ffc3d": ("228.6", "137.16", "0"),
        "ee40a888-081e-4462-b352-9f54d176c919": ("231.14", "149.86", "90"),
        "aa5c679b-62b1-4eea-9431-d3f449adc4f2": ("231.14", "154.94", "90"),
        "9fb0ebf7-7c5b-40f6-803a-1b7b650f7a0a": ("231.14", "160.02", "90"),
        "966495a8-2482-43cb-b929-0440647dd5eb": ("231.14", "165.10", "90"),
        "f7aa4113-9211-4189-aeb2-fc7d71fe4c48": ("231.14", "170.18", "90"),
        "2e01db36-340e-4117-b62a-fb3e48689943": ("231.14", "175.26", "90"),
    }
    wire_targets = {
        "ff1cf9c3-c62a-48a3-ba2a-79ee883fccb5": ("101.6", "137.16", "106.68", "137.16"),
        "0f71ffb3-28cc-450b-a5c7-99298ebc4bc4": ("101.6", "139.7", "106.68", "139.7"),
        "451548c6-4fcb-4c44-b9b6-26af1fe52f1c": ("101.6", "144.78", "106.68", "144.78"),
        "a6b4e218-caa3-4c44-ba6d-4728c9038219": ("121.92", "139.7", "116.84", "139.7"),
        "e7231d1e-cc34-4c2a-9539-f20871d759ea": ("121.92", "144.78", "116.84", "144.78"),
        "77a3c663-6769-4446-9457-f1dfcff1712d": ("163.83", "97.79", "168.91", "97.79"),
        "d4877552-7f7e-48fe-8df7-41fd19b176e9": ("163.83", "100.33", "168.91", "100.33"),
        "a4f9d4e3-5bcd-496c-b238-29383f032154": ("186.69", "101.6", "181.61", "101.6"),
        "b7f008e4-7f46-438d-946f-8538769b6635": ("228.6", "137.16", "223.52", "137.16"),
    }
    for target_uuid, target_at in label_targets.items():
        changed = set_entry_by_uuid(root, target_uuid, at=target_at) or changed
    for target_uuid, target_wire in wire_targets.items():
        changed = set_entry_by_uuid(root, target_uuid, wire=target_wire) or changed

    changed = remove_matching_entries(
        root,
        lambda entry: get_uuid(entry)
        in {
            "ed8f8460-244b-48c3-9d36-2edae478e955",
            "33ab1581-a879-4bca-95c0-07477de49e2b",
            "82c2607d-3f76-4c7f-a6b8-67051acd5da2",
            "62b49a2f-5e21-4b21-8713-5bfe23f3021d",
            "5d7945f6-0b66-45b2-abf2-f424ee649ff6",
            "20bd3249-6afe-4021-9d9b-f4284ff63a2a",
            "d496502f-0289-40c9-b692-94e7d5aedb23",
            "bef1095f-bfd4-4fc6-b1c7-b25facb331f9",
        }
        or matches_label(entry, "GND", "163.83", "97.79")
        or matches_wire(entry, "163.83", "97.79", "168.91", "97.79")
        or (is_head(entry, "no_connect") and isinstance(entry, list) and matches_at(entry, "168.91", "100.33")),
    ) or changed
    changed = ensure_wire(root, "163.83", "97.79", "168.91", "97.79") or changed
    changed = ensure_global_label(root, "GND", "163.83", "110.49") or changed
    changed = ensure_wire(root, "163.83", "110.49", "168.91", "110.49") or changed

    changed = remove_matching_entries(
        root,
        lambda entry: get_uuid(entry)
        in {
            "7073979d-c4cb-4137-b842-5f001e5287de",
            "716ba744-306b-4e10-8c50-6bc08ff0c8a3",
        },
    ) or changed

    changed = ensure_no_connect(root, "168.91", "102.87") or changed
    changed = ensure_no_connect(root, "168.91", "105.41") or changed
    changed = ensure_no_connect(root, "168.91", "107.95") or changed
    changed = ensure_no_connect(root, "181.61", "106.68") or changed

    has_c3_link = any(matches_wire(entry, "186.69", "101.6", "186.69", "106.68") for entry in root)
    if not has_c3_link:
        root.append(
            [
                Atom("wire"),
                [
                    Atom("pts"),
                    [Atom("xy"), Atom("186.69"), Atom("101.6")],
                    [Atom("xy"), Atom("186.69"), Atom("106.68")],
                ],
                [Atom("stroke"), [Atom("width"), Atom("0")], [Atom("type"), Atom("solid")]],
                [Atom("uuid"), String(str(uuid.uuid4()))],
            ]
        )
        changed = True
    return changed


def apply_sheet_fixups(path: Path, root: list[Node]) -> bool:
    name = path.name
    if name == "ui-panel.kicad_sch":
        return fix_ui_panel(root)
    if name == "mcu-usb-secure.kicad_sch":
        return fix_mcu_usb_secure(root)
    if name == "power-input.kicad_sch":
        return fix_power_input(root)
    return False


def make_pin_node(symbol_uuid: str, pin_number: str) -> list[Node]:
    pin_uuid = str(uuid.uuid5(uuid.UUID(symbol_uuid), f"pin:{pin_number}"))
    return [
        Atom("pin"),
        String(pin_number),
        [Atom("uuid"), String(pin_uuid)],
    ]


def make_description_node(source_property: list[Node] | None, description: str) -> list[Node]:
    node: list[Node] = [Atom("property"), String("Description"), String(description)]
    if source_property is not None:
        for child in source_property[3:]:
            node.append(copy.deepcopy(child))
        return node
    node.append([Atom("at"), Atom("0"), Atom("0"), Atom("0")])
    node.append(
        [
            Atom("effects"),
            [Atom("font"), [Atom("size"), Atom("1"), Atom("1")]],
            [Atom("hide"), Atom("yes")],
        ]
    )
    return node


def normalize_symbol(
    entry: list[Node],
    pin_map: dict[str, dict[int, list[str]]],
    description_map: dict[str, str],
) -> bool:
    lib_id_node = first_child(entry[1:], "lib_id")
    unit_node = first_child(entry[1:], "unit")
    uuid_node = first_child(entry[1:], "uuid")
    if lib_id_node is None or uuid_node is None:
        return False

    lib_id = as_string(lib_id_node[1]) if len(lib_id_node) > 1 else None
    symbol_uuid = as_string(uuid_node[1]) if len(uuid_node) > 1 else None
    if not lib_id or not symbol_uuid:
        return False

    unit = parse_int(unit_node[1], 1) if unit_node and len(unit_node) > 1 else 1
    unit_pins = pin_map.get(lib_id) or pin_map.get(lib_id.split(":")[-1], {})
    pins = unit_pins.get(unit)
    if not pins and unit_pins:
        pins = next(iter(unit_pins.values()))
    if not pins:
        return False
    description = description_map.get(lib_id) or description_map.get(lib_id.split(":")[-1], "")

    original = list(entry)
    rebuilt: list[Node] = []
    instances_node: list[Node] | None = None
    description_found = False
    description_source: list[Node] | None = None
    for child in entry:
        if isinstance(child, list) and child and as_atom(child[0]) == "pin":
            continue
        if isinstance(child, list) and child and as_atom(child[0]) == "instances":
            instances_node = child
            continue
        if isinstance(child, list) and child and as_atom(child[0]) == "property":
            name = as_string(child[1]) if len(child) > 1 else None
            if name == "Description":
                description_found = True
            if name == "Datasheet":
                description_source = child
        rebuilt.append(child)

    if not description_found:
        rebuilt.append(make_description_node(description_source, description))
    for pin_number in pins:
        rebuilt.append(make_pin_node(symbol_uuid, pin_number))
    if instances_node is not None:
        rebuilt.append(instances_node)

    entry[:] = rebuilt
    return entry != original


def normalize_sheet(path: Path) -> bool:
    root = parse(path.read_text(encoding="utf-8"))
    changed = apply_sheet_fixups(path, root)
    if first_child(root[1:], "lib_symbols") is not None:
        placed_lib_ids = build_placed_lib_id_map(root)
        changed = normalize_lib_symbols(root, placed_lib_ids) or changed
    pin_map = build_lib_pin_map(root)
    description_map = build_lib_description_map(root)

    filtered_root: list[Node] = []
    trailing_embedded_fonts: list[Node] = []
    for entry in root:
        if isinstance(entry, list) and entry and as_atom(entry[0]) == "lib_symbols":
            changed = True
            continue
        if isinstance(entry, list) and entry and as_atom(entry[0]) == "embedded_fonts":
            trailing_embedded_fonts.append(entry)
            continue
        filtered_root.append(entry)
    root[:] = filtered_root

    for entry in root:
        if is_placed_symbol(entry):
            changed = normalize_symbol(entry, pin_map, description_map) or changed

    if trailing_embedded_fonts:
        root.extend(trailing_embedded_fonts)
        changed = True
    elif not any(is_head(entry, "embedded_fonts") for entry in root):
        root.append([Atom("embedded_fonts"), Atom("no")])
        changed = True

    changed = remove_child_sheet_instances(root) or changed
    changed = reorder_schematic_sections(root) or changed

    if changed:
        path.write_text(dump(root) + "\n", encoding="utf-8")
    return changed


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Normalize KiCad 9 child-sheet symbol metadata.")
    parser.add_argument(
        "paths",
        nargs="*",
        help="Child sheet paths to normalize. Defaults to sheets/*.kicad_sch relative to the script.",
    )
    args = parser.parse_args(argv)

    base = Path(__file__).resolve().parent
    if args.paths:
        targets = [Path(p).resolve() for p in args.paths]
    else:
        targets = sorted((base / "sheets").glob("*.kicad_sch"))

    if not targets:
        raise SystemExit("no child sheets found")

    changed_any = False
    for target in targets:
        changed = normalize_sheet(target)
        changed_any = changed_any or changed
        print(f"{target}: {'updated' if changed else 'unchanged'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
