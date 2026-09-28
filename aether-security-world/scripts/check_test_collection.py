"""Phase 2B-0 的 test collection guard（brief §5）。

背景是一次真实的假绿：``pyproject.toml`` 的 ``testpaths = ["tests"]`` 让普通
``pytest`` 只收集 1229 条 legacy 测试，``semantic_skeleton/tests/`` 里的 163 条
Phase 2A 测试**一条都没跑**，而退出码是 0。任何只看 "pytest 绿了" 的门都会被它骗过。

本脚本是 repository guard：它自己跑一次 collection，按 testpath 分桶统计，任何一桶
为 0 或总数低于冻结下限就非零退出，并把结果写进 ``test-collection-manifest.json``
（Phase 2B 的 production contract freeze 会哈希这个文件）。

用法::

    py -3 scripts/check_test_collection.py            # 检查 + 写 manifest
    py -3 scripts/check_test_collection.py --quiet    # 只打一行摘要
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "test-collection-manifest.json"

#: 冻结的收集下限（Phase 2B-0 起点）：legacy 1229 + semantic 163 = 1392。
#: 只能往上长——新增测试会抬高实际值，但下限不被下调（brief §5）。
EXPECTED_MINIMUM = 1392

#: testpath → 分桶名。顺序即 manifest 里的展示顺序。
SUITES: tuple[tuple[str, str], ...] = (
    ("tests", "legacy"),
    ("semantic_skeleton/tests", "semantic"),
)


def _collect() -> tuple[int, list[str]]:
    """跑一次 ``pytest --co -q``，返回 (退出码, node id 列表)。"""
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "--co", "-q", "-p", "no:cacheprovider"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    nodes: list[str] = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if "::" not in line:
            continue
        nodes.append(line)
    return proc.returncode, nodes


def _bucket(node: str) -> str | None:
    for path, name in SUITES:
        prefix = path.replace("\\", "/") + "/"
        if node.replace("\\", "/").startswith(prefix):
            return name
    return None


def check(*, quiet: bool = False) -> dict[str, Any]:
    started = time.time()
    exit_code, nodes = _collect()
    counts: dict[str, int] = {name: 0 for _path, name in SUITES}
    per_file: dict[str, dict[str, int]] = {name: {} for _path, name in SUITES}
    outside: list[str] = []
    for node in nodes:
        name = _bucket(node)
        if name is None:
            outside.append(node)
            continue
        counts[name] += 1
        file_part = node.split("::", 1)[0].replace("\\", "/")
        per_file[name][file_part] = per_file[name].get(file_part, 0) + 1
    total = sum(counts.values())

    failures: list[str] = []
    if exit_code != 0:
        failures.append(f"pytest --co 退出码 {exit_code}（collection 本身失败）")
    for _path, name in SUITES:
        if counts[name] <= 0:
            failures.append(f"{name} suite 收集到 0 条测试（testpaths 盲区复现）")
    if outside:
        failures.append(
            f"{len(outside)} 条收集结果不在任何已知 testpath 内（例如 {outside[0]}）"
        )
    if total < EXPECTED_MINIMUM:
        failures.append(f"总收集数 {total} < 冻结下限 {EXPECTED_MINIMUM}")

    manifest: dict[str, Any] = {
        "artifact": "TEST-COLLECTION-MANIFEST",
        "phase": "2B-0",
        "generated_at_wallclock": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "command": "py -3 -m pytest --co -q",
        "pytest_collect_exit_code": exit_code,
        "testpaths": [path for path, _name in SUITES],
        "suites": {
            name: {
                "testpath": path,
                "collected": counts[name],
                "files": dict(sorted(per_file[name].items())),
            }
            for path, name in SUITES
        },
        "collected_outside_known_testpaths": outside[:20],
        "total_collected": total,
        "expected_minimum": EXPECTED_MINIMUM,
        "failures": failures,
        "passed": not failures,
        "wallclock_s": round(time.time() - started, 2),
    }
    # 显式 write_bytes + LF：Windows 的 write_text 会把 "\n" 翻成 "\r\n"，落盘字节与
    # 内存里的字符串不是同一个东西，而 production contract freeze 要哈希这个文件。
    MANIFEST_PATH.write_bytes(
        (json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    )
    if quiet:
        status = "PASS" if not failures else "FAIL"
        print(
            f"[{status}] legacy={counts['legacy']} semantic={counts['semantic']} "
            f"total={total} (minimum {EXPECTED_MINIMUM})"
        )
    else:
        for testpath, name in SUITES:
            print(f"{name:9s} collected={counts[name]:5d}  ({testpath})")
        print(f"total     collected={total:5d}  (frozen minimum {EXPECTED_MINIMUM})")
        for failure in failures:
            print(f"FAIL: {failure}")
        print(f"manifest -> {MANIFEST_PATH}")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="test collection guard (Phase 2B-0)")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()
    manifest = check(quiet=args.quiet)
    return 0 if manifest["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
