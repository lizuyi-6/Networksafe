#!/usr/bin/env python3
"""Generate grouped BOM for AetherGuard Control Board v2 from child sheets."""

import csv
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

PROJECT_DIR = Path(__file__).parent
SHEETS_DIR = PROJECT_DIR / "sheets"
OUTPUT_BOM = PROJECT_DIR / "release" / "bom-proto.csv"

CHILD_SHEETS = [
    "power-input.kicad_sch",
    "mcu-usb-secure.kicad_sch",
    "ui-panel.kicad_sch",
    "isolated-io.kicad_sch",
    "rtc-storage.kicad_sch",
]

REF_PATTERN = re.compile(r'"Reference"\s+"([^"]+)"')
VAL_PATTERN = re.compile(r'"Value"\s+"([^"]+)"')
FP_PATTERN = re.compile(r'"Footprint"\s+"([^"]+)"')
LCSC_PATTERN = re.compile(r'"LCSC"\s+"([^"]+)"')
DNP_PATTERN = re.compile(r'\(dnp\s+yes\)')


def parse_sheet(sheet_path):
    """Extract components from a KiCad schematic child sheet."""
    components = []
    content = sheet_path.read_text(encoding="utf-8")

    symbol_blocks = re.split(r'\(symbol\s*\n?\s*\(lib_id', content)
    for block in symbol_blocks[1:]:
        ref_match = REF_PATTERN.search(block)
        val_match = VAL_PATTERN.search(block)
        fp_match = FP_PATTERN.search(block)
        lcsc_match = LCSC_PATTERN.search(block)
        is_dnp = bool(DNP_PATTERN.search(block[:200]))

        if ref_match and val_match:
            ref = ref_match.group(1)
            if ref.startswith("#") or ref.startswith("REF"):
                continue
            components.append({
                "ref": ref,
                "value": val_match.group(1),
                "footprint": fp_match.group(1) if fp_match else "",
                "lcsc": lcsc_match.group(1) if lcsc_match else "",
                "dnp": "Yes" if is_dnp else "No",
                "sheet": sheet_path.stem,
            })
    return components


def group_bom(components):
    """Group components by value+footprint for BOM consolidation."""
    groups = defaultdict(list)
    for comp in components:
        key = (comp["value"], comp["footprint"], comp["lcsc"], comp["dnp"])
        groups[key].append(comp["ref"])

    rows = []
    for (value, footprint, lcsc, dnp), refs in sorted(groups.items(), key=lambda x: x[1][0]):
        refs_sorted = sorted(refs, key=lambda r: (re.match(r'[A-Z]+', r).group(), int(re.search(r'\d+', r).group() if re.search(r'\d+', r) else 0)))
        sheets = sorted(set(c["sheet"] for c in components if c["ref"] in refs))
        rows.append({
            "Refs": ", ".join(refs_sorted),
            "Qty": len(refs_sorted),
            "Value": value,
            "Footprint": footprint,
            "LCSC": lcsc,
            "DNP": dnp,
            "Sheets": ", ".join(sheets),
        })
    return rows


def main():
    all_components = []
    for sheet_name in CHILD_SHEETS:
        sheet_path = SHEETS_DIR / sheet_name
        if sheet_path.exists():
            comps = parse_sheet(sheet_path)
            all_components.extend(comps)
            print(f"  {sheet_name}: {len(comps)} components")
        else:
            print(f"  {sheet_name}: NOT FOUND (skipped)")

    if not all_components:
        print("No components found in any sheet.")
        sys.exit(1)

    rows = group_bom(all_components)

    OUTPUT_BOM.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_BOM, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["Refs", "Qty", "Value", "Footprint", "LCSC", "DNP", "Sheets"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nBOM written to {OUTPUT_BOM}")
    print(f"Total: {len(all_components)} components in {len(rows)} groups")


if __name__ == "__main__":
    main()
