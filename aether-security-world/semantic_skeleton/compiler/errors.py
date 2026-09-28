"""Phase 2A 编译期错误（brief §42 的失败分类目录）。

每一条都是**数据/合同问题**的可执行 reason code，不是崩溃。调用方按 reason code 决定
reject 还是 quarantine；``INTERNAL_COMPILER_ERROR`` 的目标是 0——出现即说明编译器
自己有 bug，必须停下来修而不是把骨架拒掉了事。
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CompilerFailure:
    """一次编译失败：阶段 + reason code + 语义字段 + 细节。"""

    stage: str
    code: str
    field: str
    detail: str

    def to_document(self) -> dict[str, str]:
        return {
            "stage": self.stage,
            "code": self.code,
            "field": self.field,
            "detail": self.detail,
        }


class SkeletonCompileError(ValueError):
    """骨架编译失败（携带 :class:`CompilerFailure`）。"""

    def __init__(self, failure: CompilerFailure) -> None:
        super().__init__(f"{failure.stage}/{failure.code}: {failure.detail}")
        self.failure = failure

    @property
    def code(self) -> str:
        return self.failure.code

    @property
    def stage(self) -> str:
        return self.failure.stage


#: brief §42 的失败分类全集（实现侧钉死，超出词表的 code 不允许出现）。
FAILURE_CODES: tuple[str, ...] = (
    "UNKNOWN_MECHANISM",
    "UNKNOWN_SEMANTIC_FACT",
    "UNKNOWN_SEMANTIC_TYPE",
    "UNSUPPORTED_INVARIANT",
    "HISTORY_INCONSISTENT",
    "MISSING_CRITICAL_FACT",
    "CONTRADICTORY_INVARIANTS",
    "COUNTERFACTUAL_UNRESOLVABLE",
    "COUNTERFACTUAL_NOOP",
    "EVIDENCE_UNRESOLVABLE",
    "TRUST_RELATION_UNSUPPORTED",
    "UNREACHABLE_FAILURE",
    "MASKING_TARGET_UNRESOLVABLE",
    "IRRELEVANT_FACT_CONFLICT",
    "SCHEMA_INVALID",
    "INTERNAL_COMPILER_ERROR",
)


def fail(stage: str, code: str, field: str, detail: str) -> SkeletonCompileError:
    if code not in FAILURE_CODES:
        raise SkeletonCompileError(
            CompilerFailure("compiler", "INTERNAL_COMPILER_ERROR", field,
                            f"未登记的失败码 {code!r}（brief §42 的词表是闭合的）")
        )
    return SkeletonCompileError(CompilerFailure(stage, code, field, detail))


__all__ = [
    "FAILURE_CODES",
    "CompilerFailure",
    "SkeletonCompileError",
    "fail",
]
