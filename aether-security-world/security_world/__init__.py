"""Aether Security World —— 可执行的状态化安全数据工厂（Phase 1）。

本包是 Networksafe 仓库内**唯一新增顶层 Python 包**，与仓库其他部分完全解耦：
不联网、不读任何真实目标、不写任何真实凭据，只做合成世界的数据生成与判定。

分层（设计 ``docs/design-v0.1.md`` §3.1，依赖必须是 DAG）::

    L7  generation/        Step-5 prompt、parser、provenance、replay fixture
    L6  security_world/release/
    L5  security_world/validation/
    L4  security_world/expansion/
    L3  security_world/oracle/  security_world/evidence/
    L2  security_world/policy/  security_world/invariants/  security_world/workflows/
    L1  security_world/model/
    L0  schemas/ + configs/ + docs/

顶层 ``__init__`` **故意不导入任何子包**：每个子包由不同的实现子代理独占
（设计 §15.2），顶层 eager import 会把 A 的改动变成 B 的导入失败，也会让
``tests/test_import_boundaries.py`` 无法静态断言分层。需要符号时请从具体子包导入::

    from security_world.model import WorldInstance, compile_spec

公共契约符号见 ``security_world.model.__all__``（L1）与各子包自己的 ``__all__``。
"""
from __future__ import annotations

__version__ = "0.1.0"

#: Phase 1 的 schema 版本钉子（``schemas/*.schema.json`` 的 ``schema_version`` const）。
SCHEMA_VERSION = "0.1"

__all__ = ["SCHEMA_VERSION", "__version__"]
