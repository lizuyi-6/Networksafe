from __future__ import annotations

import shutil
import tempfile
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

from pypdf import PdfReader, PdfWriter


REPO_ROOT = Path(__file__).resolve().parents[2]


def sanitize_docx(path: Path, creator: str = "AetherGuard") -> None:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        with zipfile.ZipFile(path, "r") as source:
            source.extractall(tmp_path)

        core_path = tmp_path / "docProps" / "core.xml"
        if core_path.exists():
            xml = core_path.read_text(encoding="utf-8")
            xml = replace_tag(xml, "dc:creator", creator)
            xml = replace_tag(xml, "cp:lastModifiedBy", creator)
            core_path.write_text(xml, encoding="utf-8")

        custom_path = tmp_path / "docProps" / "custom.xml"
        if custom_path.exists():
            custom_path.write_text(
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" '
                'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"/>',
                encoding="utf-8",
            )

        backup = path.with_suffix(path.suffix + ".bak")
        if backup.exists():
            backup.unlink()
        path.replace(backup)
        try:
            with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as target:
                for item in sorted(tmp_path.rglob("*")):
                    if item.is_file():
                        target.write(item, item.relative_to(tmp_path).as_posix())
        except Exception:
            if path.exists():
                path.unlink()
            backup.replace(path)
            raise
        backup.unlink()


def replace_tag(xml: str, tag: str, value: str) -> str:
    import re

    escaped = escape(value)
    pattern = rf"<{re.escape(tag)}[^>]*>.*?</{re.escape(tag)}>"
    replacement = f"<{tag}>{escaped}</{tag}>"
    if re.search(pattern, xml):
        return re.sub(pattern, replacement, xml)
    return xml


def sanitize_pdf(path: Path, title: str) -> None:
    reader = PdfReader(str(path))
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    writer.add_metadata({
        "/Title": title,
        "/Author": "AetherGuard",
        "/Creator": "AetherGuard",
        "/Producer": "AetherGuard",
        "/Subject": "",
        "/Keywords": "",
    })
    backup = path.with_suffix(path.suffix + ".bak")
    if backup.exists():
        backup.unlink()
    shutil.move(path, backup)
    try:
        with path.open("wb") as f:
            writer.write(f)
    except Exception:
        if path.exists():
            path.unlink()
        shutil.move(backup, path)
        raise
    backup.unlink()


def main() -> None:
    sanitize_docx(REPO_ROOT / "docs/legal/softcopyright/aetherguard_v1_user_manual.docx")
    sanitize_pdf(REPO_ROOT / "output/pdf/aetherguard_v1_user_manual.pdf", "AetherGuard 智能服务器安全防御平台 V1.0 用户手册")
    sanitize_pdf(REPO_ROOT / "output/pdf/aetherguard_v1_frontend_source_print.pdf", "AetherGuard 智能服务器安全防御平台 V1.0 源代码 前端")
    sanitize_pdf(REPO_ROOT / "output/pdf/aetherguard_v1_backend_source_print.pdf", "AetherGuard 智能服务器安全防御平台 V1.0 源代码 后端")


if __name__ == "__main__":
    main()
