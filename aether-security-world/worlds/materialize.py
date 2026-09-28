"""把 :mod:`worlds.corpus` 的定义物化成磁盘语料。

用法（从 ``aether-security-world/`` 根）::

    py -3 -m worlds.materialize [--check]

``--check`` 不写文件，只比对磁盘字节与重新物化的结果是否一致（退出码 0 == 一致）。
它让"语料以磁盘文件为准"与"语料可复现"同时成立：任何手改 JSON 都会被这个检查抓到。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .corpus import definitions
from .handcrafted import build_spec_document, render_expected_md

#: 语料根目录（相对本模块的父目录）。
CORPUS_DIR = Path(__file__).resolve().parent / "handcrafted"


def materialize(target: Path | None = None) -> list[Path]:
    """写出全部世界的 ``world-spec.json`` + ``expected.md``，返回写出的路径。"""
    root = target if target is not None else CORPUS_DIR
    written: list[Path] = []
    for definition in definitions():
        directory = root / definition.directory
        directory.mkdir(parents=True, exist_ok=True)
        spec_path = directory / "world-spec.json"
        expected_path = directory / "expected.md"
        spec_path.write_text(
            json.dumps(build_spec_document(definition), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        expected_path.write_text(render_expected_md(definition), encoding="utf-8")
        written.extend([spec_path, expected_path])
    return written


def check(target: Path | None = None) -> list[str]:
    """比对磁盘与重新物化的结果；返回不一致描述（空 == 一致）。"""
    root = target if target is not None else CORPUS_DIR
    problems: list[str] = []
    for definition in definitions():
        directory = root / definition.directory
        spec_path = directory / "world-spec.json"
        expected_path = directory / "expected.md"
        if not spec_path.is_file():
            problems.append(f"缺少 {spec_path}")
            continue
        if not expected_path.is_file():
            problems.append(f"缺少 {expected_path}")
            continue
        expected_spec = json.dumps(
            build_spec_document(definition), indent=2, ensure_ascii=False
        ) + "\n"
        if spec_path.read_text(encoding="utf-8") != expected_spec:
            problems.append(f"{spec_path} 与 worlds/corpus.py 的物化结果不一致")
        expected_md = render_expected_md(definition)
        if expected_path.read_text(encoding="utf-8") != expected_md:
            problems.append(f"{expected_path} 与 worlds/corpus.py 的物化结果不一致")
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="物化人工测试世界语料")
    parser.add_argument("--check", action="store_true", help="只比对，不写文件")
    parser.add_argument("--out", type=Path, default=None, help="输出目录（默认 worlds/handcrafted）")
    args = parser.parse_args(argv)
    if args.check:
        problems = check(args.out)
        for problem in problems:
            print(f"MISMATCH {problem}", file=sys.stderr)
        print(f"checked {len(definitions())} worlds; {len(problems)} mismatches")
        return 1 if problems else 0
    written = materialize(args.out)
    print(f"wrote {len(written)} files for {len(definitions())} worlds")
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI 入口
    raise SystemExit(main())
