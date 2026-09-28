"""Aether Security World — Phase 2A 语义骨架与确定性编译器。

架构一句话：**LLM 创造安全语义，代码创造表示，程序决定真值**（brief §1）。
"""

from __future__ import annotations

from .compiler import (
    COMPILER_VERSION,
    CompileContext,
    SemanticSkeletonCompiler,
    SkeletonCompileError,
)
from .mechanisms import MECHANISMS, mechanism, mechanism_families
from .ontology import FACTS, fact_names, groups_summary
from .skeleton import Skeleton, SkeletonRejected, load_skeleton

__all__ = [
    "COMPILER_VERSION",
    "FACTS",
    "MECHANISMS",
    "CompileContext",
    "Skeleton",
    "SkeletonCompileError",
    "SkeletonRejected",
    "SemanticSkeletonCompiler",
    "fact_names",
    "groups_summary",
    "load_skeleton",
    "mechanism",
    "mechanism_families",
]
