"""人工测试世界语料（M5 交付物，设计 §12.2 / §15.1 的 ``worlds/handcrafted/``）。

布局::

    worlds/
    ├── handcrafted.py     定义层：23 个世界的可复现构造器 + expected.md 渲染
    ├── corpus.py          23 个世界定义（HC-001..HC-023），每个带**人写**的预期
    ├── materialize.py     CLI：把定义落成磁盘语料（``--check`` 比对字节）
    ├── registry.py        磁盘语料的加载器（测试与集成管线唯一入口）
    └── handcrafted/ASW-HC-NNN/{world-spec.json, expected.md}

**磁盘文件是权威**，``corpus.py`` 是它的可复现来源：``py -3 -m worlds.materialize
--check`` 比对两者字节，任何手改 JSON 都会被抓到。

预期**不是**跑 oracle 抄下来的：``expected.md`` 的表格是人写的常量，
``tests/integration/test_handcrafted_corpus.py`` 断言 oracle 的判决逐字等于它。
不一致 ⇒ 这个世界写错了，修 spec，不是修 oracle（设计 §12.2）。
"""
from __future__ import annotations

from .handcrafted import (
    DEFAULT_IRRELEVANT_AXES,
    Expectation,
    ProbeAction,
    WorldDefinition,
    build_spec_document,
    render_expected_md,
)
from .registry import (
    CORPUS_DIR,
    HandcraftedWorld,
    iter_handcrafted,
    load_all,
    load_handcrafted,
)

__all__ = [
    "CORPUS_DIR",
    "DEFAULT_IRRELEVANT_AXES",
    "Expectation",
    "HandcraftedWorld",
    "ProbeAction",
    "WorldDefinition",
    "build_spec_document",
    "iter_handcrafted",
    "load_all",
    "load_handcrafted",
    "render_expected_md",
]
