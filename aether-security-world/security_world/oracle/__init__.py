"""L3：确定性 oracle（ground truth 的唯一生产者）。

公共契约（设计 §15.3 的 L3 oracle 部分 + 本任务对 evidence 一侧的落地）::

    ORACLE_VERSION / OracleOutput / run_oracle
    EvidenceView / FactStatus / Fact / FactTable / build_fact_table / TRUSTED_ESTABLISHES

**没有占位实现**：``security_world.evidence``（设计 §15.3 归 Agent C）在本轮实现里
尚未落盘，oracle 没有它就无法运行。因此本包提供 :mod:`evidence_view` 作为**参考实现**，
并让 ``run_oracle`` 只依赖结构协议（``asserting`` / ``view_id``）——``security_world.evidence``
落盘后，它的 ``EvidenceView`` 可以**原样**传给 ``run_oracle``，无需改动调用侧。

分层纪律：本包 import L1/L2，**不** import L4/L5/L6/L7。
"""
from __future__ import annotations

from .evidence_view import (
    STALE_FRESHNESSES,
    TRUSTED_ESTABLISHES,
    TRUST_RANK,
    EvidenceView,
    Fact,
    FactStatus,
    FactTable,
    build_fact_table,
)
from .oracle import (
    MAX_OBSERVABLE_PASSES,
    OBSERVABLE_DECISIONS,
    ORACLE_VERSION,
    TRACE_RULES,
    WORLD_TRUTHS,
    OracleOutput,
    aggregate,
    run_oracle,
)
from .overlay import OverlayError, override_world_values, split_id_view

__all__ = [
    # oracle
    "MAX_OBSERVABLE_PASSES",
    "OBSERVABLE_DECISIONS",
    "ORACLE_VERSION",
    "TRACE_RULES",
    "WORLD_TRUTHS",
    "OracleOutput",
    "aggregate",
    "run_oracle",
    # evidence view（§15.3 的 L3 evidence 契约；本轮的参考实现）
    "STALE_FRESHNESSES",
    "TRUSTED_ESTABLISHES",
    "TRUST_RANK",
    "EvidenceView",
    "Fact",
    "FactStatus",
    "FactTable",
    "build_fact_table",
    # 世界覆盖（observable 趟）
    "OverlayError",
    "override_world_values",
    "split_id_view",
]
