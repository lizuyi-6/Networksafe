from __future__ import annotations

import html
import subprocess
import sys
from pathlib import Path

import markdown


REPO_ROOT = Path(__file__).resolve().parents[2]
TMP_DIR = REPO_ROOT / "tmp" / "pdfs"
OUTPUT_DIR = REPO_ROOT / "output" / "pdf"
RENDER_SCRIPT = REPO_ROOT / "scripts" / "legal" / "render-html-to-pdf.mjs"

DOCUMENTS = [
    {
        "source": REPO_ROOT / "docs" / "legal" / "nda_individual_xiongan_project_cn.md",
        "html": TMP_DIR / "nda_individual_xiongan_project_cn.html",
        "pdf": OUTPUT_DIR / "nda_individual_xiongan_project_cn.pdf",
    },
    {
        "source": REPO_ROOT / "docs" / "legal" / "confidentiality_undertaking_individual_xiongan_project_cn.md",
        "html": TMP_DIR / "confidentiality_undertaking_individual_xiongan_project_cn.html",
        "pdf": OUTPUT_DIR / "confidentiality_undertaking_individual_xiongan_project_cn.pdf",
    },
    {
        "source": REPO_ROOT / "docs" / "legal" / "nda_individual_xiongan_qiongyu_cn.md",
        "html": TMP_DIR / "nda_individual_xiongan_qiongyu_cn.html",
        "pdf": OUTPUT_DIR / "nda_individual_xiongan_qiongyu_cn.pdf",
    },
    {
        "source": REPO_ROOT / "docs" / "legal" / "confidentiality_undertaking_individual_xiongan_qiongyu_cn.md",
        "html": TMP_DIR / "confidentiality_undertaking_individual_xiongan_qiongyu_cn.html",
        "pdf": OUTPUT_DIR / "confidentiality_undertaking_individual_xiongan_qiongyu_cn.pdf",
    },
]


CSS = """
@page {
  size: A4;
  margin: 16mm 14mm 18mm 14mm;
}

html {
  color: #0f172a;
  background: #ffffff;
  font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "SimSun", sans-serif;
}

body {
  margin: 0;
  padding: 0;
  font-size: 11pt;
  line-height: 1.72;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

main.document {
  width: 100%;
}

h1, h2, h3 {
  color: #0b1f44;
  break-after: avoid-page;
}

h1 {
  margin: 0 0 6mm;
  text-align: center;
  font-size: 21pt;
  font-weight: 700;
  letter-spacing: 0.4px;
}

h2 {
  margin: 7mm 0 3mm;
  padding-bottom: 1.2mm;
  border-bottom: 0.55mm solid #d6deeb;
  font-size: 14.2pt;
  font-weight: 700;
}

h3 {
  margin: 5mm 0 2mm;
  font-size: 12.2pt;
}

p {
  margin: 0 0 3mm;
}

ul, ol {
  margin: 0 0 3.2mm 0;
  padding-left: 6mm;
}

li {
  margin: 0 0 1.2mm 0;
}

strong {
  color: #111827;
}

blockquote {
  margin: 3.5mm 0 4mm;
  padding: 3mm 4mm;
  border-left: 1.2mm solid #94a3b8;
  background: #f8fafc;
  color: #334155;
}

code {
  padding: 0.3mm 1.2mm;
  border-radius: 1mm;
  background: #f1f5f9;
  font-family: "Consolas", "Courier New", monospace;
  font-size: 9.5pt;
}

.signature-grid {
  display: flex;
  gap: 8mm;
  align-items: stretch;
  margin-top: 6mm;
  break-inside: avoid;
  page-break-inside: avoid;
}

.signature-grid.single {
  display: block;
}

.signature-card {
  flex: 1 1 0;
  min-height: 60mm;
  padding: 5mm 5.5mm;
  border: 0.4mm solid #d6deeb;
  border-radius: 3mm;
  background: #ffffff;
}

.signature-grid.single .signature-card {
  min-height: 0;
}

.signature-grid.single .signature-card.optional {
  margin-top: 5mm;
}

.fill-line {
  display: inline-block;
  height: 0.95em;
  vertical-align: -0.08em;
  border-bottom: 0.35mm solid #111827;
}

.fill-line.short {
  width: 24mm;
}

.fill-line.medium {
  width: 42mm;
}

.fill-line.long {
  width: 60mm;
}

.fill-line.xlong {
  width: 105mm;
}

.fill-line.project {
  width: 48mm;
}

.fill-line.unit {
  width: 74mm;
}

.fill-line.amount {
  width: 32mm;
}

.fill-line.year {
  width: 18mm;
}

.fill-line.month {
  width: 10mm;
}

.signature-card p {
  margin: 0 0 2.6mm;
}

.signature-stamp-box {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 62mm;
  min-height: 34mm;
  margin-top: 5mm;
  border: 0.55mm dashed #94a3b8;
  border-radius: 2.6mm;
  color: #64748b;
  text-align: center;
  font-size: 10.2pt;
  letter-spacing: 0.6px;
}
"""


def extract_title(markdown_text: str, fallback: str) -> str:
    for line in markdown_text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def render_html(markdown_text: str, page_title: str) -> str:
    body = markdown.markdown(
        markdown_text,
        extensions=[
            "extra",
            "sane_lists",
        ],
        output_format="html5",
    )
    return f"""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{html.escape(page_title)}</title>
    <style>{CSS}</style>
  </head>
  <body>
    <main class="document">
      {body}
    </main>
  </body>
</html>
"""


def write_html(doc: dict[str, Path]) -> None:
    source_text = doc["source"].read_text(encoding="utf-8")
    title = extract_title(source_text, doc["source"].stem)
    doc["html"].write_text(render_html(source_text, title), encoding="utf-8")


def render_pdf(doc: dict[str, Path]) -> None:
    relative_html = doc["html"].relative_to(REPO_ROOT)
    relative_pdf = doc["pdf"].relative_to(REPO_ROOT)
    command = [
        "node",
        str(RENDER_SCRIPT),
        str(relative_html),
        str(relative_pdf),
    ]
    subprocess.run(command, cwd=REPO_ROOT, check=True)


def main() -> int:
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for doc in DOCUMENTS:
        write_html(doc)
        render_pdf(doc)
        print(f"Generated {doc['pdf']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
