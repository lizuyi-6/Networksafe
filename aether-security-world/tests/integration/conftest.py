"""``tests/integration/`` 的 conftest：导入垫片 + 总成测试共享夹具。

两件事：

1. **导入垫片**——总成测试要 import ``tests/unit/`` 里的共享构造器；pytest 的默认
   import 模式下每个被测目录只在**收集到时**才进 ``sys.path``，没有这个垫片会
   ImportError。与 ``tests/metamorphic/conftest.py`` 同一手法。
2. **夹具**——人工语料（``worlds/handcrafted/``）是总成链路的输入，session 级加载。
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

_UNIT_DIR = Path(__file__).resolve().parent.parent / "unit"
if str(_UNIT_DIR) not in sys.path:
    sys.path.insert(0, str(_UNIT_DIR))

from worlds.registry import load_all


@pytest.fixture(scope="session")
def corpus() -> tuple[Any, ...]:
    """全部落盘的人工世界（23 个）。"""
    return load_all()
