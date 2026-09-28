"""``analysis/`` —— 语料统计、分布报告与总成管线（Agent E）。

这个包是**报告与胶水**层：它读 L1-L6 的产物，算分布、跑管线、出人读摘要，
但不含任何判定逻辑（判定只在 ``security_world/oracle`` 里）。

公开入口::

    analysis.pipeline.run_pipeline()   # load → expand → mask → render → oracle → gates → split
"""
from __future__ import annotations

from .pipeline import (
    MAX_INSTANCES_PER_WORLD,
    MIN_INSTANCES_PER_WORLD,
    PipelineResult,
    WorldExpansion,
    action_from_binds,
    expand_handcrafted_world,
    run_pipeline,
)

__all__ = [
    "MAX_INSTANCES_PER_WORLD",
    "MIN_INSTANCES_PER_WORLD",
    "PipelineResult",
    "WorldExpansion",
    "action_from_binds",
    "expand_handcrafted_world",
    "run_pipeline",
]
