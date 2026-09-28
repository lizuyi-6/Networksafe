"""``semantic_skeleton/tests/`` 的导入垫片。

Phase 2A 的测试放在包内（brief §60 的目录约定），而共享构造器与引擎在仓库根的
``security_world`` / ``analysis`` 里。pytest 的默认 import 模式下每个被测目录只在
**收集到时**才进 ``sys.path``，没有这个垫片，包内测试会 ImportError。与
``tests/metamorphic/conftest.py`` 同一手法。
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

from semantic_skeleton import CompileContext, SemanticSkeletonCompiler, load_skeleton
from semantic_skeleton.compiler import CompileResult


@pytest.fixture(scope="session")
def compiler() -> SemanticSkeletonCompiler:
    return SemanticSkeletonCompiler()


@pytest.fixture(scope="session")
def context() -> CompileContext:
    return CompileContext()


@pytest.fixture(scope="session")
def phase2a_config_path() -> Path:
    return ROOT / "configs" / "phase2a.json"


@pytest.fixture(scope="session")
def fixture_skeleton() -> dict:
    import json

    path = Path(__file__).resolve().parents[1] / "fixtures" / "stale-tenant-context.json"
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def compiled_fixture(compiler, context, fixture_skeleton) -> CompileResult:
    return compiler.compile_with_plan(fixture_skeleton, context=context)


@pytest.fixture(scope="session")
def mechanism_selfcheck_skeleton():
    """按机制族合成一个最小合法骨架（与 scripts/mechanism_selfcheck.py 同一张表）。"""
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
    from mechanism_selfcheck import _skeleton_for

    def build(family: str) -> dict:
        return _skeleton_for(0, family)

    return build
