"""Phase 2A 编译器包。

分层（brief §19）::

    SemanticSkeleton
        → SkeletonNormalizer   (semantic_skeleton/skeleton.py)
        → EntityConstructor    (compiler/compiler.py: _entities)
        → StateConstructor     (compiler/compiler.py: _states)
        → HistoryCompiler      (compiler/compiler.py: _states / classify_history_line)
        → FactPathCompiler     (compiler/compiler.py: _facts + plan.WorldPlan)
        → InvariantCompiler    (compiler/archetypes.py)
        → PolicyCompiler       (compiler/archetypes.py)
        → EvidenceCompiler     (compiler/compiler.py: _evidence)
        → TrustCompiler        (compiler/compiler.py: _trust)
        → CounterfactualCompiler(compiler/compiler.py: _counterfactual / _irrelevant)
        → ASW world-spec 文档

每一层都是确定性的纯函数，失败带**稳定 reason code**（brief §41/§42）。
"""
from __future__ import annotations

from .compiler import (
    COMPILER_VERSION,
    IRRELEVANT_AXES,
    CompileContext,
    CompileResult,
    SemanticSkeletonCompiler,
    classify_history_line,
)
from .errors import FAILURE_CODES, CompilerFailure, SkeletonCompileError, fail

__all__ = [
    "COMPILER_VERSION",
    "FAILURE_CODES",
    "IRRELEVANT_AXES",
    "CompileContext",
    "CompileResult",
    "CompilerFailure",
    "SemanticSkeletonCompiler",
    "SkeletonCompileError",
    "classify_history_line",
    "fail",
]
