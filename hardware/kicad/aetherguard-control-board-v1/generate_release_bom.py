#!/usr/bin/env python3
from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
import re
from typing import Iterable

import normalize_child_sheets as n


PROJECT_DIR = Path(__file__).resolve().parent
SHEETS_DIR = PROJECT_DIR / "sheets"
OUTPUT_PATH = PROJECT_DIR / "release" / "v1-proto" / "bom-proto.csv"


@dataclass(frozen=True)
class BomItem:
    ref: str
    value: str
    footprint: str
    assembly: str
    dnp: str
    sheet: str


def property_value(entries: list[n.Node], name: str) -> str | None:
    for entry in entries:
        if not isinstance(entry, list) or not entry:
            continue
        if n.as_atom(entry[0]) != "property":
            continue
        if len(entry) > 2 and n.as_string(entry[1]) == name:
            return n.as_string(entry[2])
    return None


def bool_flag(entries: list[n.Node], name: str, default: str = "no") -> str:
    for entry in entries:
        if not isinstance(entry, list) or not entry:
            continue
        if n.as_atom(entry[0]) == name and len(entry) > 1:
            return n.as_atom(entry[1]) or default
    return default


def natural_key(ref: str) -> list[object]:
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", ref)]


def infer_assembly(ref: str, value: str, footprint: str) -> str:
    manual_markers = (
        "PhoenixContact_MCV",
        "PinHeader_1x06",
        "OLED_096_I2C_Module",
        "TestPoint",
    )
    if any(marker in footprint for marker in manual_markers):
        return "Hand"
    if ref.startswith("J") and "USB" not in value:
        return "Hand"
    return "SMT"


def collect_items() -> list[BomItem]:
    items: list[BomItem] = []
    for sheet_path in sorted(SHEETS_DIR.glob("*.kicad_sch")):
        root = n.parse(sheet_path.read_text(encoding="utf-8"))
        for entry in root[1:]:
            if not isinstance(entry, list) or not entry or n.as_atom(entry[0]) != "symbol":
                continue
            ref = property_value(entry[1:], "Reference")
            value = property_value(entry[1:], "Value")
            footprint = property_value(entry[1:], "Footprint")
            if not ref or ref.startswith("#"):
                continue
            if not value or not footprint:
                continue
            if bool_flag(entry[1:], "in_bom", "yes") != "yes":
                continue
            if bool_flag(entry[1:], "on_board", "yes") != "yes":
                continue
            dnp = "Yes" if bool_flag(entry[1:], "dnp", "no") == "yes" else "No"
            items.append(
                BomItem(
                    ref=ref,
                    value=value,
                    footprint=footprint,
                    assembly=infer_assembly(ref, value, footprint),
                    dnp=dnp,
                    sheet=sheet_path.stem,
                )
            )
    return items


def grouped_rows(items: Iterable[BomItem]) -> list[dict[str, str]]:
    groups: dict[tuple[str, str, str, str], list[BomItem]] = {}
    for item in items:
        groups.setdefault((item.value, item.footprint, item.assembly, item.dnp), []).append(item)

    rows: list[dict[str, str]] = []
    for (value, footprint, assembly, dnp), group in sorted(groups.items(), key=lambda x: (x[0][2], x[0][0], x[0][1])):
        refs = sorted((item.ref for item in group), key=natural_key)
        sheets = sorted({item.sheet for item in group})
        rows.append(
            {
                "Refs": ", ".join(refs),
                "Qty": str(len(group)),
                "Value": value,
                "Footprint": footprint,
                "Assembly": assembly,
                "DNP": dnp,
                "Sheets": ", ".join(sheets),
            }
        )
    return rows


def main() -> int:
    items = collect_items()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=["Refs", "Qty", "Value", "Footprint", "Assembly", "DNP", "Sheets"],
        )
        writer.writeheader()
        writer.writerows(grouped_rows(items))
    print(f"Wrote {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
