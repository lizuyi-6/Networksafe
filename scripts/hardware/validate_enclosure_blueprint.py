"""Validate page geometry and 1:1 vectors in the enclosure blueprint PDF."""

from __future__ import annotations

from pathlib import Path

import pdfplumber
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[2]
PDF_PATH = ROOT / "output" / "pdf" / "aetherguard-enclosure-industrial-blueprint-a3.pdf"
PT_TO_MM = 25.4 / 72.0
TOLERANCE_MM = 0.03


def close(actual: float, expected: float) -> bool:
    return abs(actual - expected) <= TOLERANCE_MM


def object_dimensions_mm(item: dict) -> tuple[float, float]:
    return (
        (item["x1"] - item["x0"]) * PT_TO_MM,
        (item["y1"] - item["y0"]) * PT_TO_MM,
    )


def count_size(items: list[dict], width: float, height: float) -> int:
    return sum(
        1
        for item in items
        if close(object_dimensions_mm(item)[0], width)
        and close(object_dimensions_mm(item)[1], height)
    )


def count_horizontal_span(lines: list[dict], length: float) -> int:
    return sum(
        1
        for item in lines
        if close(abs(item["x1"] - item["x0"]) * PT_TO_MM, length)
        and close(abs(item["y1"] - item["y0"]) * PT_TO_MM, 0.0)
    )


def validate() -> int:
    reader = PdfReader(str(PDF_PATH))
    extracted = [page.extract_text() or "" for page in reader.pages]
    page_sizes = [
        (
            float(page.mediabox.width) * PT_TO_MM,
            float(page.mediabox.height) * PT_TO_MM,
        )
        for page in reader.pages
    ]

    checks: dict[str, bool] = {
        "page_count_4": len(reader.pages) == 4,
        "all_pages_a3_landscape": all(close(width, 420.0) and close(height, 297.0) for width, height in page_sizes),
        "no_replacement_chars": sum(text.count("\ufffd") for text in extracted) == 0,
        "page3_actual_size_instruction": "Actual Size" in extracted[2] and "100%" in extracted[2],
        "page4_actual_size_instruction": "Actual Size" in extracted[3] and "100%" in extracted[3],
    }

    with pdfplumber.open(str(PDF_PATH)) as pdf:
        front = pdf.pages[2]
        top = pdf.pages[3]

        checks.update(
            {
                "front_outer_313_6x81_4": count_size(front.curves, 313.6, 81.4) == 1,
                "front_rj45_3x18_2x15_4": count_size(front.rects, 18.2, 15.4) == 3,
                "front_usb_c_12x7": count_size(front.rects, 12.0, 7.0) == 1,
                "front_buttons_2x22_5": count_size(front.curves, 22.5, 22.5) == 2,
                "front_screws_6x3_4": count_size(front.curves, 3.4, 3.4) == 6,
                "front_status_120x13": count_size(front.rects, 120.0, 13.0) == 1,
                "front_calibration_span_100": count_horizontal_span(front.lines, 100.0) >= 1,
                "top_outer_313_6x203_6": count_size(top.curves, 313.6, 203.6) == 1,
                "top_screws_8x4_3": count_size(top.curves, 4.3, 4.3) == 8,
                "top_stack_shaft_22_5": count_size(top.curves, 22.5, 22.5) == 1,
                "top_stack_bcd_36": count_size(top.curves, 36.0, 36.0) == 1,
                "top_stack_mounts_3x3_4": count_size(top.curves, 3.4, 3.4) == 3,
                "top_calibration_span_100": count_horizontal_span(top.lines, 100.0) >= 1,
            }
        )

    failed = [name for name, result in checks.items() if not result]
    print(f"blueprint_checks={checks}")
    print(f"blueprint_page_sizes_mm={[(round(w, 2), round(h, 2)) for w, h in page_sizes]}")
    print(f"blueprint_text_chars={[len(text) for text in extracted]}")
    print(f"blueprint_summary: passed={sum(checks.values())} failed={len(failed)} total={len(checks)}")
    if failed:
        print(f"blueprint_failed_checks={failed}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(validate())
