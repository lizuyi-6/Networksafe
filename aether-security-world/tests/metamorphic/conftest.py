"""``tests/metamorphic/`` 的导入垫片。

设计 §13.3 的元变形测试放在本目录（与 §15.2 的目录归属一致），而共享构造器
``asw_worlds`` / ``asw_expansion`` 在 ``tests/unit/``。pytest 的默认 import 模式下
每个被测目录只在**收集到时**才进 ``sys.path``，而 ``tests/metamorphic`` 按字母序
先于 ``tests/unit`` 收集——没有这个垫片，本目录的测试会 ImportError。

只做路径注入，不定义 fixture：fixture 归根 ``conftest.py``（架构师所有）与各测试
文件自己。
"""
from __future__ import annotations

import sys
from pathlib import Path

_UNIT_DIR = Path(__file__).resolve().parent.parent / "unit"
if str(_UNIT_DIR) not in sys.path:
    sys.path.insert(0, str(_UNIT_DIR))
