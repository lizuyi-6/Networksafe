"""Phase 2B-0 的 collection guard 自测（brief §5）。

这两条测试存在的理由是一次真实的假绿：``testpaths = ["tests"]`` 期间，普通
``pytest`` 收集 1229 条 legacy 测试、**跳过全部 163 条 Phase 2A 测试**，退出码 0。
只看 "pytest 绿了" 的门会被它骗过，所以把同一断言搬进测试套件本身——CI 即使只跑
``pytest`` 也能发现分桶消失。
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

#: 与 ``scripts/check_test_collection.py`` 同一份冻结下限。
EXPECTED_MINIMUM = 1392


def _collected_by_suite() -> dict[str, int]:
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "--co", "-q", "-p", "no:cacheprovider"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    assert proc.returncode == 0, f"collection 失败:\n{proc.stdout[-2000:]}\n{proc.stderr[-2000:]}"
    counts = {"tests": 0, "semantic_skeleton/tests": 0, "other": 0}
    for line in proc.stdout.splitlines():
        line = line.strip()
        if "::" not in line:
            continue
        normalised = line.replace("\\", "/")
        for path in ("tests/", "semantic_skeleton/tests/"):
            if normalised.startswith(path):
                counts[path.rstrip("/")] += 1
                break
        else:
            counts["other"] += 1
    return counts


def test_both_suites_are_collected_by_a_bare_pytest():
    counts = _collected_by_suite()
    assert counts["tests"] > 0, "legacy suite 收集到 0 条"
    assert counts["semantic_skeleton/tests"] > 0, (
        "semantic_skeleton suite 收集到 0 条——testpaths 盲区复现（brief §5）"
    )
    assert counts["other"] == 0, f"有收集结果落在已知 testpath 之外: {counts}"
    total = counts["tests"] + counts["semantic_skeleton/tests"]
    assert total >= EXPECTED_MINIMUM, f"总收集 {total} < 冻结下限 {EXPECTED_MINIMUM}"


def test_collection_guard_writes_a_manifest_with_both_suites():
    sys.path.insert(0, str(ROOT / "scripts"))
    import check_test_collection as guard

    manifest = guard.check(quiet=True)
    assert manifest["passed"] is True, manifest["failures"]
    assert manifest["suites"]["legacy"]["collected"] > 0
    assert manifest["suites"]["semantic"]["collected"] > 0
    assert manifest["total_collected"] >= EXPECTED_MINIMUM
    on_disk = json.loads(guard.MANIFEST_PATH.read_text(encoding="utf-8"))
    assert on_disk["total_collected"] == manifest["total_collected"]


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
